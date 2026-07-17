import type { SpeechActivityReceipt } from "../preflight/contracts.ts";
import type { AcousticObservations } from "./contracts.ts";
import { validateAcousticObservations } from "./validation.ts";

export type DialogueScopeState =
  | "requested_dialogue_scope_candidate"
  | "not_in_requested_dialogue_scope"
  | "unknown"
  | "unavailable"
  | "withheld";

export type DialogueScopeReason =
  | "vad_speech_acoustic_speech_candidate"
  | "vad_non_speech_acoustic_noise"
  | "vad_non_speech_acoustic_music_lyrics_excluded"
  | "vad_non_speech_acoustic_music_lyrics_requested"
  | "vad_acoustic_disagreement"
  | "mixed_speech_music"
  | "weak_or_ambiguous_acoustic_confidence"
  | "missing_or_failed_evidence"
  | "truncated_evidence";

export interface DialogueScopeRange {
  index: number;
  startSample: number;
  endSample: number;
  startMs: number;
  endMs: number;
  state: DialogueScopeState;
  reason: DialogueScopeReason;
  vad: "speech" | "non_speech" | "missing";
  acoustic: AcousticObservations["observations"][number]["classification"] | "missing";
}

export interface DialogueScopePolicy {
  schema: "studio.dialogue-scope-policy.v1";
  input: {
    sourceArtifactId: string;
    sourceContentId: string;
    trackId: string;
    includeLyrics: boolean;
    requestedRange: { startMs: number; endMs: number; startSample: number; endSample: number };
    speechEvidence: { artifactId: string; contentId: string } | null;
    acousticEvidence: { artifactId: string; contentId: string; producerReceiptContentId: string } | null;
  };
  producer: {
    id: "studio.deterministic-dialogue-scope-policy";
    version: "1";
    policy: "strong_vad_acoustic_agreement_only";
  };
  ranges: DialogueScopeRange[];
  accounting: {
    requestedSamples: number;
    requestedDialogueScopeCandidateSamples: number;
    notInRequestedDialogueScopeSamples: number;
    unknownSamples: number;
    unavailableSamples: number;
    withheldSamples: number;
    semanticCoverageDenominatorSamples: number;
  };
  nonClaims: {
    semanticUnderstanding: "not_assessed";
    absenceOfSpeech: "not_proven";
    acousticAccuracy: "not_established";
  };
}

export interface DialogueScopePolicyInput {
  sourceArtifactId: string;
  sourceContentId: string;
  trackId: string;
  includeLyrics: boolean;
  requestedRange: { startMs: number; endMs: number };
  speechEvidence: { artifactId: string; contentId: string; value: SpeechActivityReceipt } | null;
  acousticEvidence: { artifactId: string; contentId: string; producerReceiptContentId: string; value: AcousticObservations } | null;
}

function classify(vad: DialogueScopeRange["vad"], acoustic: DialogueScopeRange["acoustic"], certainty: "strong" | "weak" | "missing", includeLyrics: boolean): Pick<DialogueScopeRange, "state" | "reason"> {
  if (vad === "missing" || acoustic === "missing") return { state: "unavailable", reason: "missing_or_failed_evidence" };
  if (certainty === "weak" || acoustic === "unknown") return { state: "unknown", reason: "weak_or_ambiguous_acoustic_confidence" };
  if (acoustic === "mixed") return { state: "unknown", reason: "mixed_speech_music" };
  if (vad === "speech" && acoustic === "speech_candidate") return { state: "requested_dialogue_scope_candidate", reason: "vad_speech_acoustic_speech_candidate" };
  if (vad === "non_speech" && acoustic === "noise") return { state: "not_in_requested_dialogue_scope", reason: "vad_non_speech_acoustic_noise" };
  if (vad === "non_speech" && acoustic === "music") return includeLyrics
    ? { state: "requested_dialogue_scope_candidate", reason: "vad_non_speech_acoustic_music_lyrics_requested" }
    : { state: "not_in_requested_dialogue_scope", reason: "vad_non_speech_acoustic_music_lyrics_excluded" };
  return { state: "unknown", reason: "vad_acoustic_disagreement" };
}

/** Closed U1 truth table. Neither detector may declare exclusion unilaterally. */
export function deriveDialogueScopePolicy(input: DialogueScopePolicyInput): DialogueScopePolicy {
  const startSample = input.requestedRange.startMs * 16; const endSample = input.requestedRange.endMs * 16;
  if (!Number.isSafeInteger(startSample) || !Number.isSafeInteger(endSample) || startSample < 0 || endSample <= startSample) throw new Error("Dialogue-scope policy requires a non-empty half-open integer-ms range");
  const acoustic = input.acousticEvidence ? validateAcousticObservations(input.acousticEvidence.value) : null;
  if (acoustic && acoustic.status !== "complete") {
    const state = acoustic.status === "truncated" ? "withheld" : "unavailable";
    const range: DialogueScopeRange = { index: 0, startSample, endSample, startMs: input.requestedRange.startMs, endMs: input.requestedRange.endMs, state, reason: acoustic.status === "truncated" ? "truncated_evidence" : "missing_or_failed_evidence", vad: "missing", acoustic: "missing" };
    return policy(input, startSample, endSample, [range]);
  }
  const speech = input.speechEvidence?.value;
  if (!speech || !acoustic || speech.schema !== "studio.speech-activity.v1" || speech.normalization.sample_rate_hz !== 16_000) {
    return policy(input, startSample, endSample, [{ index: 0, startSample, endSample, startMs: input.requestedRange.startMs, endMs: input.requestedRange.endMs, state: "unavailable", reason: "missing_or_failed_evidence", vad: "missing", acoustic: "missing" }]);
  }
  if (endSample > speech.normalization.sample_count || startSample < acoustic.returnedRange.startSample || endSample > acoustic.returnedRange.endSample) throw new Error("Dialogue-scope evidence does not cover the exact requested range");
  const vadRanges = [
    ...speech.speech_windows.map((range) => ({ ...range, vad: "speech" as const })),
    ...speech.non_speech_windows.map((range) => ({ ...range, vad: "non_speech" as const })),
  ].sort((left, right) => left.start_sample - right.start_sample);
  const boundaries = new Set([startSample, endSample]);
  for (const range of vadRanges) { if (range.end_sample > startSample && range.start_sample < endSample) { boundaries.add(Math.max(startSample, range.start_sample)); boundaries.add(Math.min(endSample, range.end_sample)); } }
  for (const range of acoustic.observations) { if (range.endSample > startSample && range.startSample < endSample) { boundaries.add(Math.max(startSample, range.startSample)); boundaries.add(Math.min(endSample, range.endSample)); } }
  const sorted = [...boundaries].sort((left, right) => left - right); const ranges: DialogueScopeRange[] = [];
  for (let index = 0; index < sorted.length - 1; index += 1) {
    const segmentStart = sorted[index] ?? 0; const segmentEnd = sorted[index + 1] ?? 0; if (segmentEnd <= segmentStart) continue;
    const vadRange = vadRanges.find((range) => range.start_sample <= segmentStart && range.end_sample >= segmentEnd);
    const acousticRange = acoustic.observations.find((range) => range.startSample <= segmentStart && range.endSample >= segmentEnd);
    const vad = vadRange?.vad ?? "missing"; const acousticClass = acousticRange?.classification ?? "missing";
    ranges.push({ index: ranges.length, startSample: segmentStart, endSample: segmentEnd, startMs: Math.floor(segmentStart / 16), endMs: Math.ceil(segmentEnd / 16), ...classify(vad, acousticClass, acousticRange?.certainty ?? "missing", input.includeLyrics), vad, acoustic: acousticClass });
  }
  if (ranges.length === 0 || ranges[0]?.startSample !== startSample || ranges.at(-1)?.endSample !== endSample || ranges.some((range, index) => index > 0 && ranges[index - 1]?.endSample !== range.startSample)) throw new Error("Dialogue-scope policy failed to create an exact partition");
  return policy(input, startSample, endSample, ranges);
}

function policy(input: DialogueScopePolicyInput, startSample: number, endSample: number, ranges: DialogueScopeRange[]): DialogueScopePolicy {
  const samples = (state: DialogueScopeState) => ranges.filter((range) => range.state === state).reduce((sum, range) => sum + range.endSample - range.startSample, 0);
  const excluded = samples("not_in_requested_dialogue_scope");
  return { schema: "studio.dialogue-scope-policy.v1", input: { sourceArtifactId: input.sourceArtifactId, sourceContentId: input.sourceContentId, trackId: input.trackId, includeLyrics: input.includeLyrics, requestedRange: { ...input.requestedRange, startSample, endSample }, speechEvidence: input.speechEvidence ? { artifactId: input.speechEvidence.artifactId, contentId: input.speechEvidence.contentId } : null, acousticEvidence: input.acousticEvidence ? { artifactId: input.acousticEvidence.artifactId, contentId: input.acousticEvidence.contentId, producerReceiptContentId: input.acousticEvidence.producerReceiptContentId } : null }, producer: { id: "studio.deterministic-dialogue-scope-policy", version: "1", policy: "strong_vad_acoustic_agreement_only" }, ranges, accounting: { requestedSamples: endSample - startSample, requestedDialogueScopeCandidateSamples: samples("requested_dialogue_scope_candidate"), notInRequestedDialogueScopeSamples: excluded, unknownSamples: samples("unknown"), unavailableSamples: samples("unavailable"), withheldSamples: samples("withheld"), semanticCoverageDenominatorSamples: endSample - startSample - excluded }, nonClaims: { semanticUnderstanding: "not_assessed", absenceOfSpeech: "not_proven", acousticAccuracy: "not_established" } };
}

export function rangeIsEntirelyNonDialogue(policy: DialogueScopePolicy, startMs: number, endMs: number): boolean {
  let cursor = startMs * 16; const end = endMs * 16;
  for (const range of policy.ranges.filter((candidate) => candidate.endSample > cursor && candidate.startSample < end)) {
    if (range.startSample > cursor || range.state !== "not_in_requested_dialogue_scope") return false;
    cursor = Math.min(end, range.endSample); if (cursor === end) return true;
  }
  return false;
}

export function rangeOverlapsNonDialogue(policy: DialogueScopePolicy, startMs: number, endMs: number): boolean {
  const start = startMs * 16; const end = endMs * 16;
  return policy.ranges.some((range) => range.state === "not_in_requested_dialogue_scope" && range.endSample > start && range.startSample < end);
}

export function validateDialogueScopePolicy(value: unknown): DialogueScopePolicy {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Dialogue-scope policy must be an object");
  const policy = value as DialogueScopePolicy;
  if (policy.schema !== "studio.dialogue-scope-policy.v1" || policy.producer?.id !== "studio.deterministic-dialogue-scope-policy" || !Array.isArray(policy.ranges) || policy.ranges.length === 0) throw new Error("Dialogue-scope policy has an unregistered shape");
  const requested = policy.input?.requestedRange; if (!requested || requested.startSample !== requested.startMs * 16 || requested.endSample !== requested.endMs * 16 || requested.endSample <= requested.startSample) throw new Error("Dialogue-scope policy requested range is invalid");
  let cursor = requested.startSample; const totals = new Map<DialogueScopeState, number>();
  const states = new Set<DialogueScopeState>(["requested_dialogue_scope_candidate", "not_in_requested_dialogue_scope", "unknown", "unavailable", "withheld"]);
  for (const [index, range] of policy.ranges.entries()) {
    if (range.index !== index || range.startSample !== cursor || range.endSample <= range.startSample || !states.has(range.state)) throw new Error("Dialogue-scope policy ranges are not an exact ordered partition");
    if (range.startMs !== Math.floor(range.startSample / 16) || range.endMs !== Math.ceil(range.endSample / 16)) throw new Error("Dialogue-scope policy range milliseconds do not bound samples");
    totals.set(range.state, (totals.get(range.state) ?? 0) + range.endSample - range.startSample); cursor = range.endSample;
  }
  if (cursor !== requested.endSample) throw new Error("Dialogue-scope policy does not close its requested range");
  const expected = { requestedSamples: requested.endSample - requested.startSample, requestedDialogueScopeCandidateSamples: totals.get("requested_dialogue_scope_candidate") ?? 0, notInRequestedDialogueScopeSamples: totals.get("not_in_requested_dialogue_scope") ?? 0, unknownSamples: totals.get("unknown") ?? 0, unavailableSamples: totals.get("unavailable") ?? 0, withheldSamples: totals.get("withheld") ?? 0, semanticCoverageDenominatorSamples: requested.endSample - requested.startSample - (totals.get("not_in_requested_dialogue_scope") ?? 0) };
  if (JSON.stringify(policy.accounting) !== JSON.stringify(expected)) throw new Error("Dialogue-scope policy accounting does not match its full partition");
  if (policy.input.includeLyrics && policy.ranges.some((range) => range.state === "not_in_requested_dialogue_scope" && range.acoustic === "music")) throw new Error("Dialogue-scope policy excluded music while lyrics are requested");
  return structuredClone(policy);
}
