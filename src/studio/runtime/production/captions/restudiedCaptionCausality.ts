import { canonicalSha256, type ContentAddressedArtifactStore } from "../artifactStore.ts";
import type { CaptionLineCausalityV4, EvidenceCitationEnvelope, QualifiedMediaRange, RuntimeProjection } from "../model.ts";
import { RestudiedStudyReadinessHost, type RestudiedReadinessV4Reference } from "../study/restudiedStudyReadinessHost.ts";

type CaptionCausalityTextInput =
  | { sourceText: string; targetText: string; sourceUnavailableReason?: never }
  | { sourceText: null; targetText: null; sourceUnavailableReason: "recognizer_unavailable" | "recognizer_empty" };

function closesLine(range: QualifiedMediaRange, citations: EvidenceCitationEnvelope[]): boolean {
  const observations = citations.flatMap((citation) => citation.observations)
    .filter((entry) => entry.state === "available" && entry.locator.kind === "temporal_range")
    .map((entry) => entry.locator.kind === "temporal_range" ? entry.locator.media : null)
    .filter((entry): entry is QualifiedMediaRange => entry !== null && entry.artifactId === range.artifactId && entry.trackId === range.trackId && entry.endMs > range.startMs && entry.startMs < range.endMs)
    .map((entry) => ({ ...entry, startMs: Math.max(entry.startMs, range.startMs), endMs: Math.min(entry.endMs, range.endMs) }))
    .sort((left, right) => left.startMs - right.startMs || left.endMs - right.endMs);
  let cursor = range.startMs;
  for (const found of observations) {
    if (found.startMs > cursor) return false;
    cursor = Math.max(cursor, found.endMs);
    if (cursor >= range.endMs) return true;
  }
  return false;
}

function reason(state: CaptionLineCausalityV4["lineage"]["coverageState"]): string {
  if (state === "not_in_scope") return "not_in_requested_dialogue_scope";
  if (state === "conflicting") return "study_coverage_conflict";
  if (state === "truncated") return "study_coverage_truncated";
  if (state === "unavailable") return "study_coverage_unavailable";
  if (state === "failed") return "study_coverage_failed";
  if (state === "withheld") return "study_coverage_withheld";
  if (state === "unknown") return "study_coverage_unknown";
  return "study_coverage_uncovered";
}

/** V4 line causality authorizes only supported cells; terminal weak cells are withheld locally. */
export class RestudiedCaptionCausalityHost {
  private readonly readiness: RestudiedStudyReadinessHost;
  private readonly reopenedReadiness = new Map<
    string,
    ReturnType<RestudiedStudyReadinessHost["reopen"]>
  >();

  constructor(state: RuntimeProjection, artifacts: ContentAddressedArtifactStore) {
    this.readiness = new RestudiedStudyReadinessHost(state, artifacts);
  }

  private reopen(reference: RestudiedReadinessV4Reference): ReturnType<RestudiedStudyReadinessHost["reopen"]> {
    const key = canonicalSha256(reference);
    const existing = this.reopenedReadiness.get(key);
    if (existing) return existing;
    const reopened = this.readiness.reopen(reference);
    this.reopenedReadiness.set(key, reopened);
    return reopened;
  }

  async close(input: {
    readiness: RestudiedReadinessV4Reference;
    range: QualifiedMediaRange;
  } & CaptionCausalityTextInput): Promise<CaptionLineCausalityV4> {
    const unavailable = input.sourceText === null && input.targetText === null && input.sourceUnavailableReason !== undefined;
    if (!unavailable && (typeof input.sourceText !== "string" || typeof input.targetText !== "string")) {
      throw new Error("Restudied caption causality requires either available text or one typed unavailable recognizer reason");
    }
    const ready = await this.reopen(input.readiness);
    const study = ready.reopenedStudy;
    const covering = study?.envelope.coverage.filter((entry) => entry.artifactId === input.range.artifactId && entry.trackId === input.range.trackId && entry.startMs <= input.range.startMs && entry.endMs >= input.range.endMs) ?? [];
    const coverage = covering.length === 1 ? covering[0] : null;
    let claimIds: string[] = [];
    let citationIds: string[] = [];
    let allowed = false;
    if (ready.receipt.result.outcome === "proceed_to_caption_review" && study && coverage?.state === "supported") {
      const citationById = new Map(study.envelope.evidenceCitations.map((entry) => [entry.citationId, entry]));
      const claim = coverage.claimIds.map((id) => study.envelope.claims.find((entry) => entry.claimId === id)).find((entry) => {
        if (!entry || entry.startMs > input.range.startMs || entry.endMs < input.range.endMs) return false;
        const citations = entry.citationIds.map((id) => citationById.get(id)).filter((value): value is EvidenceCitationEnvelope => Boolean(value));
        return citations.length === entry.citationIds.length && citations.every((citation) => citation.use === "claim_support" && citation.evidenceKind === "current_run_speech") && closesLine(input.range, citations);
      });
      if (claim) {
        allowed = true;
        claimIds = [claim.claimId];
        citationIds = [...claim.citationIds];
      }
    }
    const coverageState = coverage?.state ?? "uncovered";
    const withheldReason = allowed ? null : ready.receipt.result.outcome === "withheld" ? "study_readiness_withheld" : reason(coverageState);
    const source = allowed
      ? unavailable
        ? { language: "ko" as const, state: "unavailable" as const, text: null, reasonCode: input.sourceUnavailableReason }
        : { language: "ko" as const, state: "available" as const, text: input.sourceText, reasonCode: null }
      : { language: "ko" as const, state: "withheld" as const, text: null, reasonCode: withheldReason };
    const target = allowed
      ? unavailable
        ? { language: "en" as const, state: "unavailable" as const, text: null, reasonCode: "source_unavailable" }
        : { language: "en" as const, state: "available" as const, text: input.targetText, reasonCode: null }
      : { language: "en" as const, state: "withheld" as const, text: null, reasonCode: withheldReason };
    return {
      schema: "studio.caption-line-causality.v4",
      range: structuredClone(input.range),
      source,
      target,
      lineage: {
        study: structuredClone(input.readiness.study.study),
        readiness: { readinessId: input.readiness.readinessId, receiptId: input.readiness.receiptId, receiptContentId: input.readiness.receiptContentId },
        coverageId: coverage?.coverageId ?? null,
        coverageState,
        preservedStates: coverage?.preservedStates ?? [],
        claimIds,
        citationIds,
        passIds: coverage?.passIds ?? [],
      },
    };
  }
}
