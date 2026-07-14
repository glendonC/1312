import type { RunBundle } from "../transport";
import type { CueState, Trace } from "../types";
import type {
  RecordedArtifactKind,
  RecordedCueDecision,
  RecordedCueDecisionState,
  RecordedEvidenceArtifact,
  RecordedEvidenceIndex,
} from "./types";

const SHA256 = /^[a-f0-9]{64}$/;
const ARTIFACT_ID = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const REGISTERED_ARTIFACTS = new Map<string, { id: string; kind: RecordedArtifactKind }>([
  ["captions.json", { id: "captions", kind: "captions" }],
  ["corrections.json", { id: "corrections", kind: "corrections" }],
  ["glossary.json", { id: "glossary", kind: "glossary" }],
  ["score.json", { id: "score", kind: "score" }],
  ["traces.json", { id: "traces", kind: "traces" }],
  // This indexes proposal bytes only. Acceptance still requires the separate memory gate.
  ["memory-proposals.json", { id: "memory-proposals", kind: "memory_proposals" }],
]);

function fail(context: string, path: string, message: string): never {
  throw new Error(`${context}: ${path} ${message}`);
}

function record(value: unknown, context: string, path: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail(context, path, "must be an object");
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[], context: string, path: string): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    fail(context, path, `must contain exactly ${wanted.join(", ")}`);
  }
}

function list(value: unknown, context: string, path: string): unknown[] {
  if (!Array.isArray(value)) fail(context, path, "must be an array");
  return value;
}

function text(value: unknown, context: string, path: string): string {
  if (typeof value !== "string" || value.trim().length === 0) fail(context, path, "must be a non-empty string");
  return value;
}

function exact(value: unknown, expected: string, context: string, path: string): void {
  if (text(value, context, path) !== expected) fail(context, path, `must equal ${expected}`);
}

function finite(value: unknown, context: string, path: string, min = 0): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min) {
    fail(context, path, `must be finite and at least ${min}`);
  }
  return value;
}

function integer(value: unknown, context: string, path: string): number {
  const parsed = finite(value, context, path);
  if (!Number.isSafeInteger(parsed)) fail(context, path, "must be a safe integer");
  return parsed;
}

function contentId(value: unknown, context: string, path: string): string {
  const id = text(value, context, path);
  if (!id.startsWith("sha256:") || !SHA256.test(id.slice("sha256:".length))) {
    fail(context, path, "must be a sha256:<lowercase digest> content id");
  }
  return id;
}

function artifactId(value: unknown, context: string, path: string): string {
  const id = text(value, context, path);
  if (!ARTIFACT_ID.test(id)) fail(context, path, "must be a lowercase kebab-case artifact id");
  return id;
}

function evidenceArtifact(value: unknown, context: string, path: string): RecordedEvidenceArtifact {
  const artifact = record(value, context, path);
  exactKeys(artifact, ["artifact_id", "kind", "path", "content", "source_artifact_ids"], context, path);
  artifactId(artifact.artifact_id, context, `${path}.artifact_id`);
  const kind = text(artifact.kind, context, `${path}.kind`);
  if (![...REGISTERED_ARTIFACTS.values()].some((candidate) => candidate.kind === kind)) {
    fail(context, `${path}.kind`, `has no registered artifact kind ${kind}`);
  }
  text(artifact.path, context, `${path}.path`);
  const content = record(artifact.content, context, `${path}.content`);
  exactKeys(content, ["id", "hash", "bytes"], context, `${path}.content`);
  const id = contentId(content.id, context, `${path}.content.id`);
  const hash = record(content.hash, context, `${path}.content.hash`);
  exactKeys(hash, ["algorithm", "digest"], context, `${path}.content.hash`);
  exact(hash.algorithm, "sha256", context, `${path}.content.hash.algorithm`);
  const digest = text(hash.digest, context, `${path}.content.hash.digest`);
  if (!SHA256.test(digest)) fail(context, `${path}.content.hash.digest`, "must be a lowercase SHA-256 digest");
  if (id !== `sha256:${digest}`) fail(context, `${path}.content.id`, "does not match its digest");
  const bytes = integer(content.bytes, context, `${path}.content.bytes`);
  if (bytes <= 0) fail(context, `${path}.content.bytes`, "must be positive");
  const sources = list(artifact.source_artifact_ids, context, `${path}.source_artifact_ids`).map((source, index) =>
    artifactId(source, context, `${path}.source_artifact_ids[${index}]`),
  );
  if (new Set(sources).size !== sources.length) {
    fail(context, `${path}.source_artifact_ids`, "must not contain duplicate artifact ids");
  }
  return value as RecordedEvidenceArtifact;
}

function cueDecision(value: unknown, context: string, path: string): RecordedCueDecision {
  const decision = record(value, context, path);
  exactKeys(
    decision,
    ["cue_id", "terminal_state", "caption_owner_id", "gate", "evidence_artifact_ids", "terminal_effect"],
    context,
    path,
  );
  text(decision.cue_id, context, `${path}.cue_id`);
  const state = text(decision.terminal_state, context, `${path}.terminal_state`);
  if (state !== "committed" && state !== "withheld" && state !== "dropped") {
    fail(context, `${path}.terminal_state`, `has non-terminal value ${state}`);
  }
  text(decision.caption_owner_id, context, `${path}.caption_owner_id`);
  if (decision.gate !== null) {
    const gate = record(decision.gate, context, `${path}.gate`);
    exactKeys(gate, ["id", "reason"], context, `${path}.gate`);
    text(gate.id, context, `${path}.gate.id`);
    text(gate.reason, context, `${path}.gate.reason`);
  }
  const artifacts = list(decision.evidence_artifact_ids, context, `${path}.evidence_artifact_ids`).map((id, index) =>
    artifactId(id, context, `${path}.evidence_artifact_ids[${index}]`),
  );
  if (new Set(artifacts).size !== artifacts.length) {
    fail(context, `${path}.evidence_artifact_ids`, "must not contain duplicate artifact ids");
  }
  const effect = record(decision.terminal_effect, context, `${path}.terminal_effect`);
  exactKeys(effect, ["trace_index", "at", "agent_id", "action"], context, `${path}.terminal_effect`);
  integer(effect.trace_index, context, `${path}.terminal_effect.trace_index`);
  finite(effect.at, context, `${path}.terminal_effect.at`);
  text(effect.agent_id, context, `${path}.terminal_effect.agent_id`);
  text(effect.action, context, `${path}.terminal_effect.action`);
  return value as RecordedCueDecision;
}

function terminalCueEffects(traces: Trace[]): Map<string, { state: CueState; trace: Trace; index: number }> {
  const terminal = new Map<string, { state: CueState; trace: Trace; index: number }>();
  traces.forEach((trace, index) => {
    for (const effect of trace.effects ?? []) {
      if (effect.type === "cue") terminal.set(effect.id, { state: effect.state, trace, index });
    }
  });
  return terminal;
}

function registeredGateIds(bundle: RunBundle): Set<string> {
  const ids = new Set<string>();
  for (const gate of bundle.pack.gates) {
    ids.add(gate.id);
    ids.add(gate.id.slice(gate.id.lastIndexOf(".") + 1));
  }
  return ids;
}

function assertNoLineageCycle(
  artifacts: Map<string, RecordedEvidenceArtifact>,
  context: string,
): void {
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): void => {
    if (visiting.has(id)) fail(context, "artifacts", `contains a lineage cycle at ${id}`);
    if (visited.has(id)) return;
    visiting.add(id);
    const artifact = artifacts.get(id);
    if (!artifact) fail(context, "artifacts", `references unknown source artifact ${id}`);
    for (const source of artifact.source_artifact_ids) visit(source);
    visiting.delete(id);
    visited.add(id);
  };
  for (const id of artifacts.keys()) visit(id);
}

function expectedCaptionState(bundle: RunBundle, cueId: string, terminal: RecordedCueDecisionState, context: string): void {
  const cue = bundle.captions.cues.find((candidate) => candidate.id === cueId);
  if (!cue) fail(context, `cue_decisions.${cueId}.cue_id`, `references unknown cue ${cueId}`);
  const target = cue.targets.find((line) => line.lang === bundle.run.pair.target);
  if (!target) fail(context, `cue_decisions.${cueId}`, "has no recorded target-language caption");
  if (terminal === "committed" && (target.text === null || target.withheld !== undefined)) {
    fail(context, `cue_decisions.${cueId}.terminal_state`, "contradicts the committed caption");
  }
  if (terminal === "withheld" && (target.text !== null || target.withheld === undefined)) {
    fail(context, `cue_decisions.${cueId}.terminal_state`, "contradicts the withheld caption");
  }
  if (terminal === "dropped" && (target.text !== null || target.withheld !== undefined || cue.silence !== true)) {
    fail(context, `cue_decisions.${cueId}.terminal_state`, "contradicts the recorded silence/drop caption");
  }
}

/** Validate a post-run index without promoting its recorded labels into original provenance. */
export function assertRecordedEvidenceIndex(
  value: unknown,
  bundle: RunBundle,
  context = "Studio recorded evidence index",
): asserts value is RecordedEvidenceIndex {
  const index = record(value, context, "index");
  exactKeys(index, ["schema", "producer", "mode", "run", "clip", "claims", "artifacts", "cue_decisions", "note"], context, "index");
  exact(index.schema, "studio.recorded-evidence-index.v1", context, "index.schema");
  exact(index.producer, "scripts/index-recorded-evidence.mjs", context, "index.producer");
  exact(index.mode, "post_run_index", context, "index.mode");
  exact(index.run, bundle.run.id, context, "index.run");
  exact(index.clip, bundle.run.clip.id, context, "index.clip");
  text(index.note, context, "index.note");

  const claims = record(index.claims, context, "index.claims");
  exactKeys(
    claims,
    ["artifact_byte_identity", "terminal_caption_decisions", "original_worker_lineage", "structured_handoffs"],
    context,
    "index.claims",
  );
  if (claims.artifact_byte_identity !== true || claims.terminal_caption_decisions !== true) {
    fail(context, "index.claims", "must retain the two post-run index claims");
  }
  if (claims.original_worker_lineage !== false || claims.structured_handoffs !== false) {
    fail(context, "index.claims", "must not claim original worker lineage or structured handoffs");
  }

  const entries = list(index.artifacts, context, "index.artifacts").map((entry, position) =>
    evidenceArtifact(entry, context, `index.artifacts[${position}]`),
  );
  const artifacts = new Map(entries.map((entry) => [entry.artifact_id, entry]));
  if (artifacts.size !== entries.length) fail(context, "index.artifacts", "must not contain duplicate artifact ids");
  const expectedArtifacts = bundle.run.artifacts.map((path) => {
    const registered = REGISTERED_ARTIFACTS.get(path);
    if (!registered) fail(context, "index.artifacts", `has no registered index kind for ${path}`);
    return { path, ...registered };
  });
  if (entries.length !== expectedArtifacts.length) {
    fail(context, "index.artifacts", "must index every declared run artifact exactly once");
  }
  for (const expected of expectedArtifacts) {
    const artifact = artifacts.get(expected.id);
    if (!artifact) fail(context, "index.artifacts", `is missing declared artifact ${expected.id}`);
    if (artifact.path !== expected.path || artifact.kind !== expected.kind) {
      fail(context, `index.artifacts.${expected.id}`, "does not match the declared artifact path and kind");
    }
  }
  for (const artifact of entries) {
    for (const source of artifact.source_artifact_ids) {
      if (!artifacts.has(source)) fail(context, `index.artifacts.${artifact.artifact_id}`, `references unknown source artifact ${source}`);
    }
  }
  assertNoLineageCycle(artifacts, context);

  const decisions = list(index.cue_decisions, context, "index.cue_decisions").map((entry, position) =>
    cueDecision(entry, context, `index.cue_decisions[${position}]`),
  );
  const byCue = new Map(decisions.map((decision) => [decision.cue_id, decision]));
  if (byCue.size !== decisions.length) fail(context, "index.cue_decisions", "must not contain duplicate cue ids");
  if (decisions.length !== bundle.captions.cues.length) {
    fail(context, "index.cue_decisions", "must contain one terminal decision for every caption cue");
  }
  for (const decision of decisions) {
    if (!bundle.captions.cues.some((cue) => cue.id === decision.cue_id)) {
      fail(context, `index.cue_decisions.${decision.cue_id}.cue_id`, `references unknown cue ${decision.cue_id}`);
    }
  }
  const knownAgents = new Set(["orchestrator", ...bundle.run.agents.map((agent) => agent.id)]);
  const knownGates = registeredGateIds(bundle);
  const terminal = terminalCueEffects(bundle.traces);

  for (const cue of bundle.captions.cues) {
    const decision = byCue.get(cue.id);
    if (!decision) fail(context, "index.cue_decisions", `is missing cue ${cue.id}`);
    if (!knownAgents.has(decision.caption_owner_id)) {
      fail(context, `index.cue_decisions.${cue.id}.caption_owner_id`, `references unknown owner ${decision.caption_owner_id}`);
    }
    if (decision.caption_owner_id !== cue.owner) {
      fail(context, `index.cue_decisions.${cue.id}.caption_owner_id`, "does not match captions.json");
    }
    for (const artifact of decision.evidence_artifact_ids) {
      if (!artifacts.has(artifact)) {
        fail(context, `index.cue_decisions.${cue.id}.evidence_artifact_ids`, `references unknown artifact ${artifact}`);
      }
    }
    if (
      decision.evidence_artifact_ids.length !== 2 ||
      decision.evidence_artifact_ids[0] !== "captions" ||
      decision.evidence_artifact_ids[1] !== "traces"
    ) {
      fail(context, `index.cue_decisions.${cue.id}.evidence_artifact_ids`, "must name captions and traces evidence");
    }

    const recorded = terminal.get(cue.id);
    if (!recorded || (recorded.state !== "committed" && recorded.state !== "withheld" && recorded.state !== "dropped")) {
      fail(context, `index.cue_decisions.${cue.id}`, "has no recorded terminal cue effect");
    }
    expectedCaptionState(bundle, cue.id, decision.terminal_state, context);
    if (decision.terminal_state !== recorded.state) {
      fail(context, `index.cue_decisions.${cue.id}.terminal_state`, "does not match the terminal trace effect");
    }
    const effect = decision.terminal_effect;
    if (
      effect.trace_index !== recorded.index ||
      effect.at !== recorded.trace.t ||
      effect.agent_id !== recorded.trace.agent ||
      effect.action !== recorded.trace.action
    ) {
      fail(context, `index.cue_decisions.${cue.id}.terminal_effect`, "does not match the recorded terminal trace effect");
    }
    if (!knownAgents.has(effect.agent_id)) {
      fail(context, `index.cue_decisions.${cue.id}.terminal_effect.agent_id`, `references unknown agent ${effect.agent_id}`);
    }

    const target = cue.targets.find((line) => line.lang === bundle.run.pair.target);
    const captionGate = target?.withheld;
    if (decision.terminal_state === "withheld") {
      if (decision.gate && !knownGates.has(decision.gate.id)) {
        fail(context, `index.cue_decisions.${cue.id}.gate.id`, `references unknown gate ${decision.gate.id}`);
      }
      if (!decision.gate || !captionGate || decision.gate.id !== captionGate.gate || decision.gate.reason !== captionGate.reason) {
        fail(context, `index.cue_decisions.${cue.id}.gate`, "does not match the withheld caption gate");
      }
    } else if (decision.gate !== null) {
      fail(context, `index.cue_decisions.${cue.id}.gate`, "must be null for a non-withheld decision");
    }
  }
}
