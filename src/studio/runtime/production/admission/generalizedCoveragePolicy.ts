import type { DialogueScopePolicy } from "../../../acoustic/dialogueScopePolicy.ts";
import type {
  EvidenceCitationEnvelope,
  GeneralizedCoverageReasonCode,
  GeneralizedCoverageState,
  QualifiedMediaRange,
} from "../model.ts";

interface WeakStateEvidence {
  state: Exclude<GeneralizedCoverageState, "supported">;
  raw: string;
}

const STATE_PRIORITY: Array<Exclude<GeneralizedCoverageState, "supported">> = [
  "conflicting",
  "failed",
  "truncated",
  "unavailable",
  "withheld",
  "unknown",
  "not_in_scope",
];

function citationEvidence(citation: EvidenceCitationEnvelope): WeakStateEvidence[] {
  const result: WeakStateEvidence[] = [];
  if (citation.upstreamState !== "available") {
    result.push({
      state: citation.upstreamState,
      raw: `${citation.citationId}:upstream:${citation.upstreamState}:${citation.upstreamReason}`,
    });
  }
  for (const observation of citation.observations) {
    if (observation.state !== "available") {
      result.push({
        state: observation.state,
        raw: `${observation.observationId}:${observation.state}:${observation.rawState}`,
      });
    }
  }
  return result;
}

function dialogueScopeEvidence(
  policy: DialogueScopePolicy | null,
  range: QualifiedMediaRange,
): WeakStateEvidence[] {
  if (!policy || policy.input.sourceArtifactId !== range.artifactId || policy.input.trackId !== range.trackId) return [];
  const cells = policy.ranges.filter((candidate) => candidate.endMs > range.startMs && candidate.startMs < range.endMs);
  let cursor = range.startMs;
  const result: WeakStateEvidence[] = [];
  for (const cell of cells) {
    if (cell.startMs > cursor) throw new Error("Dialogue-scope policy leaves a gap inside report coverage");
    cursor = Math.min(range.endMs, cell.endMs);
    if (cell.state === "requested_dialogue_scope_candidate") continue;
    const state: WeakStateEvidence["state"] =
      cell.state === "not_in_requested_dialogue_scope" ? "not_in_scope" :
      cell.state === "unknown" && cell.reason === "vad_acoustic_disagreement" ? "conflicting" :
      cell.state === "withheld" && cell.reason === "truncated_evidence" ? "truncated" :
      cell.state;
    result.push({ state, raw: `dialogue-scope:${cell.index}:${state}:${cell.reason}` });
  }
  if (cells.length > 0 && cursor !== range.endMs) {
    throw new Error("Dialogue-scope policy does not close report coverage");
  }
  return result;
}

function reasonFor(state: GeneralizedCoverageState): GeneralizedCoverageReasonCode | null {
  if (state === "supported") return null;
  if (state === "unknown") return "evidence_unknown";
  if (state === "withheld") return "worker_withheld";
  if (state === "unavailable") return "evidence_unavailable";
  if (state === "truncated") return "evidence_truncated";
  if (state === "conflicting") return "evidence_conflicting";
  if (state === "failed") return "operation_failed";
  return "not_in_requested_scope";
}

/**
 * Deterministic admission policy. Report prose is not an input. A worker may explicitly abstain
 * or report operation failure, while every producer-derived state is reconstructed from receipts.
 */
export function deriveGeneralizedCoverageDecision(input: {
  claimCount: number;
  citations: readonly EvidenceCitationEnvelope[];
  dialogueScopePolicy: DialogueScopePolicy | null;
  range: QualifiedMediaRange;
  declaredReasonCode: GeneralizedCoverageReasonCode | null;
}): {
  state: GeneralizedCoverageState;
  rawStates: string[];
  reasonCode: GeneralizedCoverageReasonCode | null;
} {
  const evidence = [
    ...input.citations.flatMap(citationEvidence),
    ...dialogueScopeEvidence(input.dialogueScopePolicy, input.range),
  ];
  const addExplicitStateUnlessDominated = (
    state: Extract<WeakStateEvidence["state"], "failed" | "withheld">,
    raw: "operation_failed" | "worker_withheld",
  ) => {
    const priority = STATE_PRIORITY.indexOf(state);
    const dominated = evidence.some((entry) => {
      const entryPriority = STATE_PRIORITY.indexOf(entry.state);
      return entryPriority >= 0 && entryPriority < priority;
    });
    // The report persists only the final reason code. If a stronger producer state wins, retaining
    // the weaker model-declared raw marker would make the stored report impossible to re-derive
    // during cold admission because that superseded declaration is no longer authoritative input.
    if (!dominated) evidence.push({ state, raw });
  };
  if (input.declaredReasonCode === "operation_failed") {
    addExplicitStateUnlessDominated("failed", "operation_failed");
  }
  if (input.declaredReasonCode === "worker_withheld") {
    addExplicitStateUnlessDominated("withheld", "worker_withheld");
  }
  if (input.claimCount === 0 && evidence.length === 0) {
    evidence.push({ state: "unknown", raw: "unobserved_range" });
  }
  const states = new Set(evidence.map((entry) => entry.state));
  const onlyNotInScope = states.size === 1 && states.has("not_in_scope");
  const state = onlyNotInScope
    ? "not_in_scope" as const
    : STATE_PRIORITY.find((candidate) => states.has(candidate)) ?? "supported";
  return {
    state,
    rawStates: [...new Set(evidence.map((entry) => entry.raw))].sort(),
    reasonCode: reasonFor(state),
  };
}
