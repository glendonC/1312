import { canonicalSha256 } from "../canonicalIdentity.ts";
import {
  SPEAKER_OVERLAP_LIMITS,
  type SpeakerAccountingCell,
  type SpeakerOverlapArtifactState,
  type SpeakerOverlapEvidenceCitationInput,
  type SpeakerOverlapGrantScope,
  type SpeakerOverlapLimits,
  type SpeakerOverlapObservations,
  type SpeakerOverlapProducerLineage,
  type SpeakerOverlapReceipt,
  type SpeakerOverlapRequest,
  type SpeakerRuntimeFileIdentity,
} from "../model.ts";
import {
  array,
  contentId,
  exact,
  fail,
  hash,
  integer,
  literal,
  object,
  oneOf,
  string,
  uniqueStrings,
} from "./primitives.ts";

const LIMIT_KEYS = Object.keys(SPEAKER_OVERLAP_LIMITS) as Array<keyof SpeakerOverlapLimits>;
const CELL_STATES = new Set(["available", "unknown", "conflicting", "truncated"] as const);
const CELL_KINDS = new Set(["anonymous_turn", "overlap", "rapid_turn", "no_hypothesis", "output_limit_exceeded"] as const);
const ARTIFACT_STATES = new Set<SpeakerOverlapArtifactState>(["available", "empty", "unknown", "truncated"]);
const ARTIFACT_REASONS = new Set(["hypotheses_emitted", "no_speaker_hypotheses", "all_cells_uncertain", "output_limit_exceeded"] as const);
const UNCERTAINTY_STATES = new Set(["unquantified", "weak", "not_applicable"] as const);
const UNCERTAINTY_REASONS = new Set([
  "runtime_does_not_expose_segment_scores",
  "overlap_hypothesis_requires_speech_restudy",
  "rapid_turn_boundary_below_reliability_floor",
  "no_speaker_hypothesis_is_not_non_speech_proof",
  "output_limit_replaced_partial_result",
] as const);

export function validateSpeakerOverlapLimits(value: unknown, context: string, path: string): SpeakerOverlapLimits {
  const item = object(value, context, path);
  exact(item, LIMIT_KEYS, context, path);
  for (const key of LIMIT_KEYS) {
    const measured = integer(item[key], context, `${path}.${key}`, 1);
    if (measured !== SPEAKER_OVERLAP_LIMITS[key]) {
      fail(context, `${path}.${key}`, `must equal the registered U6 limit ${SPEAKER_OVERLAP_LIMITS[key]}`);
    }
  }
  return item as unknown as SpeakerOverlapLimits;
}

export function validateSpeakerOverlapGrantScope(value: unknown, context: string, path: string): SpeakerOverlapGrantScope {
  const item = object(value, context, path);
  exact(item, ["schema", "limits"], context, path);
  literal(item.schema, "studio.speaker-overlap-grant.v1", context, `${path}.schema`);
  validateSpeakerOverlapLimits(item.limits, context, `${path}.limits`);
  return item as unknown as SpeakerOverlapGrantScope;
}

export function assertSpeakerOverlapRequest(value: unknown, context = "Speaker/overlap request"): asserts value is SpeakerOverlapRequest {
  const item = object(value, context, "request");
  exact(item, ["operationId", "taskId", "agentId", "grantId"], context, "request");
  for (const key of ["operationId", "taskId", "agentId", "grantId"]) string(item[key], context, `request.${key}`);
}

export function speakerOverlapRequestFingerprint(input: {
  sourceContentId: string;
  trackId: string;
  startMs: number;
  endMs: number;
  configurationContentIds: string[];
}): string {
  return `speaker-overlap-request:${canonicalSha256(input)}`;
}

export function speakerTurnId(input: {
  operationId: string;
  startMs: number;
  endMs: number;
  speakerLabel: string;
}): string {
  return `anonymous-speaker-turn:${canonicalSha256(input)}`;
}

export function speakerAccountingObservationId(input: Omit<SpeakerAccountingCell, "observationId"> & { operationId: string }): string {
  return `speaker-accounting:${canonicalSha256(input)}`;
}

export function speakerOverlapReceiptId(value: Omit<SpeakerOverlapReceipt, "receiptId">): string {
  const { schema: _schema, ...body } = value;
  return `speaker-overlap-receipt:${canonicalSha256(body)}`;
}

function runtimeFile(value: unknown, context: string, path: string): SpeakerRuntimeFileIdentity {
  const item = object(value, context, path);
  exact(item, ["name", "content"], context, path);
  const name = string(item.name, context, `${path}.name`);
  hash(item.content, context, `${path}.content`);
  return { name, content: item.content as SpeakerRuntimeFileIdentity["content"] };
}

export function validateSpeakerOverlapProducerLineage(value: unknown, context: string, path: string): SpeakerOverlapProducerLineage {
  const item = object(value, context, path);
  exact(item, ["schema", "adapter", "runtime", "models", "configuration"], context, path);
  literal(item.schema, "studio.speaker-overlap-producer-lineage.v1", context, `${path}.schema`);
  const adapter = object(item.adapter, context, `${path}.adapter`);
  exact(adapter, ["id", "version"], context, `${path}.adapter`);
  literal(adapter.id, "sherpa-onnx-anonymous-speaker-overlap", context, `${path}.adapter.id`);
  literal(adapter.version, "1", context, `${path}.adapter.version`);
  const runtime = object(item.runtime, context, `${path}.runtime`);
  exact(runtime, ["package", "node", "execution"], context, `${path}.runtime`);
  const pkg = object(runtime.package, context, `${path}.runtime.package`);
  exact(pkg, ["name", "version", "gitRevision", "license", "files"], context, `${path}.runtime.package`);
  literal(pkg.name, "sherpa-onnx-node", context, `${path}.runtime.package.name`);
  literal(pkg.version, "1.13.4", context, `${path}.runtime.package.version`);
  literal(pkg.gitRevision, "142807252687d81b40d6315f23470a1512a00de3", context, `${path}.runtime.package.gitRevision`);
  literal(pkg.license, "Apache-2.0", context, `${path}.runtime.package.license`);
  const files = array(pkg.files, context, `${path}.runtime.package.files`).map((entry, index) =>
    runtimeFile(entry, context, `${path}.runtime.package.files[${index}]`));
  if (files.length < 2 || new Set(files.map((entry) => entry.name)).size !== files.length) {
    fail(context, `${path}.runtime.package.files`, "must identify the unique JS adapter and native runtime files");
  }
  const requiredRuntimeContent = new Map([
    ["sherpa-onnx-node/sherpa-onnx.js", "sha256:cdfe88a1a55358dbee071f57aea874ae16a2862c83fbc720d2f2830343057185"],
    ["sherpa-onnx-darwin-arm64/sherpa-onnx.node", "sha256:62bcb019dd59696542bdfe74c7c0d5cb62a07cbcb26d67b7fdb0da38635638f3"],
  ]);
  for (const [name, expected] of requiredRuntimeContent) {
    if (files.find((entry) => entry.name === name)?.content.contentId !== expected) fail(context, `${path}.runtime.package.files`, `changed pinned runtime file ${name}`);
  }
  const node = object(runtime.node, context, `${path}.runtime.node`);
  exact(node, ["version", "platform", "arch"], context, `${path}.runtime.node`);
  for (const key of ["version", "platform", "arch"]) string(node[key], context, `${path}.runtime.node.${key}`);
  const execution = object(runtime.execution, context, `${path}.runtime.execution`);
  exact(execution, ["engine", "provider", "threads", "network"], context, `${path}.runtime.execution`);
  literal(execution.engine, "native_node_addon", context, `${path}.runtime.execution.engine`);
  literal(execution.provider, "cpu", context, `${path}.runtime.execution.provider`);
  if (integer(execution.threads, context, `${path}.runtime.execution.threads`, 1) !== 1) fail(context, `${path}.runtime.execution.threads`, "must remain single-threaded");
  literal(execution.network, "disabled", context, `${path}.runtime.execution.network`);
  const models = object(item.models, context, `${path}.models`);
  exact(models, ["segmentation", "embedding"], context, `${path}.models`);
  for (const [key, id, source, date, license] of [
    ["segmentation", "pyannote/segmentation-3.0", "k2-fsa/sherpa-onnx:speaker-segmentation-models", "2024-10-08", "MIT"],
    ["embedding", "3D-Speaker/ERes2Net-base-16k", "k2-fsa/sherpa-onnx:speaker-recongition-models", "2024-10-14", "Apache-2.0"],
  ] as const) {
    const model = object(models[key], context, `${path}.models.${key}`);
    exact(model, ["id", "format", "source", "releaseDate", "license", "content"], context, `${path}.models.${key}`);
    literal(model.id, id, context, `${path}.models.${key}.id`);
    literal(model.format, "onnx", context, `${path}.models.${key}.format`);
    literal(model.source, source, context, `${path}.models.${key}.source`);
    literal(model.releaseDate, date, context, `${path}.models.${key}.releaseDate`);
    literal(model.license, license, context, `${path}.models.${key}.license`);
    hash(model.content, context, `${path}.models.${key}.content`);
    const expectedContentId = key === "segmentation"
      ? "sha256:220ad67ca923bef2fa91f2390c786097bf305bceb5e261d4af67b38e938e1079"
      : "sha256:1a331345f04805badbb495c775a6ddffcdd1a732567d5ec8b3d5749e3c7a5e4b";
    if ((model.content as { contentId: string }).contentId !== expectedContentId) fail(context, `${path}.models.${key}.content`, "changed pinned model bytes");
  }
  const configuration = object(item.configuration, context, `${path}.configuration`);
  exact(configuration, ["sampleRateHz", "channels", "sampleFormat", "numClusters", "clusteringThreshold", "minDurationOnSeconds", "minDurationOffSeconds", "timing", "speakerLabels", "uncertainty"], context, `${path}.configuration`);
  if (configuration.sampleRateHz !== 16_000 || configuration.channels !== 1 || configuration.numClusters !== -1 ||
      configuration.clusteringThreshold !== 0.5 || configuration.minDurationOnSeconds !== 0.3 || configuration.minDurationOffSeconds !== 0.5) {
    fail(context, `${path}.configuration`, "changed the pinned clustering or timing configuration");
  }
  literal(configuration.sampleFormat, "f32le_normalized_from_s16le", context, `${path}.configuration.sampleFormat`);
  literal(configuration.timing, "integer_millisecond_half_open_absolute_source", context, `${path}.configuration.timing`);
  literal(configuration.speakerLabels, "first_appearance_anon_cluster_index", context, `${path}.configuration.speakerLabels`);
  literal(configuration.uncertainty, "model_scores_unavailable_boundary_policy_v1", context, `${path}.configuration.uncertainty`);
  return item as unknown as SpeakerOverlapProducerLineage;
}

function range(value: unknown, context: string, path: string): { startMs: number; endMs: number } {
  const item = object(value, context, path);
  exact(item, ["startMs", "endMs"], context, path);
  const startMs = integer(item.startMs, context, `${path}.startMs`);
  const endMs = integer(item.endMs, context, `${path}.endMs`, 1);
  if (endMs <= startMs) fail(context, path, "must be a non-empty half-open range");
  return { startMs, endMs };
}

function source(value: unknown, context: string, path: string): SpeakerOverlapObservations["source"] {
  const item = object(value, context, path);
  exact(item, ["artifactId", "contentId", "audioTrackId", "grantedRange"], context, path);
  return {
    artifactId: string(item.artifactId, context, `${path}.artifactId`),
    contentId: contentId(item.contentId, context, `${path}.contentId`),
    audioTrackId: string(item.audioTrackId, context, `${path}.audioTrackId`),
    grantedRange: range(item.grantedRange, context, `${path}.grantedRange`),
  };
}

function nonClaims(value: unknown, context: string, path: string): void {
  const item = object(value, context, path);
  exact(item, ["personIdentity", "biometricIdentity", "crossRunIdentity", "namedSpeakers", "transcriptCorrectness", "translationCorrectness", "dialogueAuthority", "perfectDiarization"], context, path);
  literal(item.personIdentity, "not_assessed", context, `${path}.personIdentity`);
  literal(item.biometricIdentity, "not_performed", context, `${path}.biometricIdentity`);
  literal(item.crossRunIdentity, "not_available", context, `${path}.crossRunIdentity`);
  literal(item.namedSpeakers, "not_available", context, `${path}.namedSpeakers`);
  literal(item.transcriptCorrectness, "not_assessed", context, `${path}.transcriptCorrectness`);
  literal(item.translationCorrectness, "not_assessed", context, `${path}.translationCorrectness`);
  literal(item.dialogueAuthority, "not_granted", context, `${path}.dialogueAuthority`);
  literal(item.perfectDiarization, "not_claimed", context, `${path}.perfectDiarization`);
}

export function validateSpeakerOverlapObservations(value: unknown, context = "Speaker/overlap observations", path = "observations"): SpeakerOverlapObservations {
  const item = object(value, context, path);
  exact(item, ["schema", "operationId", "runId", "source", "producer", "limits", "labelScope", "state", "reason", "turns", "accounting", "nonClaims"], context, path);
  literal(item.schema, "studio.speaker-overlap-observations.v1", context, `${path}.schema`);
  const operationId = string(item.operationId, context, `${path}.operationId`);
  const runId = string(item.runId, context, `${path}.runId`);
  const inputSource = source(item.source, context, `${path}.source`);
  validateSpeakerOverlapProducerLineage(item.producer, context, `${path}.producer`);
  validateSpeakerOverlapLimits(item.limits, context, `${path}.limits`);
  const labelScope = object(item.labelScope, context, `${path}.labelScope`);
  exact(labelScope, ["kind", "runId", "sourceArtifactId", "operationId"], context, `${path}.labelScope`);
  literal(labelScope.kind, "run_artifact_operation_local", context, `${path}.labelScope.kind`);
  if (labelScope.runId !== runId || labelScope.sourceArtifactId !== inputSource.artifactId || labelScope.operationId !== operationId) fail(context, `${path}.labelScope`, "must bind the exact run, source artifact, and operation");
  const turns = array(item.turns, context, `${path}.turns`);
  if (turns.length > SPEAKER_OVERLAP_LIMITS.maxTurns) fail(context, `${path}.turns`, "exceeds the raw turn ceiling");
  const turnIds = new Set<string>();
  const speakerLabels = new Set<string>();
  let priorStart = inputSource.grantedRange.startMs;
  for (const [index, value] of turns.entries()) {
    const turn = object(value, context, `${path}.turns[${index}]`);
    exact(turn, ["turnId", "startMs", "endMs", "speakerLabel", "uncertainty"], context, `${path}.turns[${index}]`);
    const startMs = integer(turn.startMs, context, `${path}.turns[${index}].startMs`);
    const endMs = integer(turn.endMs, context, `${path}.turns[${index}].endMs`, 1);
    const speakerLabel = string(turn.speakerLabel, context, `${path}.turns[${index}].speakerLabel`);
    const turnId = string(turn.turnId, context, `${path}.turns[${index}].turnId`);
    if (!/^anon_cluster_[1-9][0-9]*$/.test(speakerLabel) || startMs < inputSource.grantedRange.startMs || endMs > inputSource.grantedRange.endMs || endMs <= startMs || startMs < priorStart) fail(context, `${path}.turns[${index}]`, "must be ordered, in range, and use only an operation-local anonymous label");
    priorStart = startMs;
    if (turnIds.has(turnId) || turnId !== speakerTurnId({ operationId, startMs, endMs, speakerLabel })) fail(context, `${path}.turns[${index}].turnId`, "is repeated or does not close the turn body");
    turnIds.add(turnId);
    speakerLabels.add(speakerLabel);
    const uncertainty = object(turn.uncertainty, context, `${path}.turns[${index}].uncertainty`);
    exact(uncertainty, ["state", "reason"], context, `${path}.turns[${index}].uncertainty`);
    literal(uncertainty.state, "unquantified", context, `${path}.turns[${index}].uncertainty.state`);
    literal(uncertainty.reason, "runtime_does_not_expose_segment_scores", context, `${path}.turns[${index}].uncertainty.reason`);
  }
  if (speakerLabels.size > SPEAKER_OVERLAP_LIMITS.maxLocalSpeakerClusters) fail(context, `${path}.turns`, "exceeds the anonymous-cluster ceiling");
  const accounting = array(item.accounting, context, `${path}.accounting`);
  if (accounting.length < 1 || accounting.length > SPEAKER_OVERLAP_LIMITS.maxAccountingCells) fail(context, `${path}.accounting`, "must contain a bounded complete partition");
  let cursor = inputSource.grantedRange.startMs;
  const observationIds = new Set<string>();
  for (const [index, value] of accounting.entries()) {
    const cell = object(value, context, `${path}.accounting[${index}]`);
    exact(cell, ["observationId", "index", "startMs", "endMs", "state", "kind", "speakerLabels", "turnIds", "uncertainty"], context, `${path}.accounting[${index}]`);
    if (integer(cell.index, context, `${path}.accounting[${index}].index`) !== index) fail(context, `${path}.accounting[${index}].index`, "must be contiguous");
    const startMs = integer(cell.startMs, context, `${path}.accounting[${index}].startMs`);
    const endMs = integer(cell.endMs, context, `${path}.accounting[${index}].endMs`, 1);
    if (startMs !== cursor || endMs <= startMs || endMs > inputSource.grantedRange.endMs) fail(context, `${path}.accounting[${index}]`, "leaves a gap, overlaps, or escapes the granted range");
    cursor = endMs;
    const state = oneOf<SpeakerAccountingCell["state"]>(cell.state, CELL_STATES, context, `${path}.accounting[${index}].state`);
    const kind = oneOf<SpeakerAccountingCell["kind"]>(cell.kind, CELL_KINDS, context, `${path}.accounting[${index}].kind`);
    const labels = uniqueStrings(cell.speakerLabels, context, `${path}.accounting[${index}].speakerLabels`).sort();
    const ids = uniqueStrings(cell.turnIds, context, `${path}.accounting[${index}].turnIds`).sort();
    if (labels.some((label) => !speakerLabels.has(label)) || ids.some((id) => !turnIds.has(id))) fail(context, `${path}.accounting[${index}]`, "references a turn or anonymous label outside the artifact");
    const uncertainty = object(cell.uncertainty, context, `${path}.accounting[${index}].uncertainty`);
    exact(uncertainty, ["state", "reason"], context, `${path}.accounting[${index}].uncertainty`);
    const uncertaintyState = oneOf<SpeakerAccountingCell["uncertainty"]["state"]>(uncertainty.state, UNCERTAINTY_STATES, context, `${path}.accounting[${index}].uncertainty.state`);
    const uncertaintyReason = oneOf<SpeakerAccountingCell["uncertainty"]["reason"]>(uncertainty.reason, UNCERTAINTY_REASONS, context, `${path}.accounting[${index}].uncertainty.reason`);
    if ((kind === "anonymous_turn" && (state !== "available" || labels.length !== 1)) ||
        (kind === "overlap" && (state !== "conflicting" || labels.length < 2)) ||
        (kind === "rapid_turn" && (state !== "unknown" || labels.length !== 1 || endMs - startMs >= SPEAKER_OVERLAP_LIMITS.minReliableTurnMs)) ||
        (kind === "no_hypothesis" && (state !== "unknown" || labels.length !== 0 || ids.length !== 0)) ||
        (kind === "output_limit_exceeded" && (state !== "truncated" || labels.length !== 0 || ids.length !== 0))) {
      fail(context, `${path}.accounting[${index}]`, "state, kind, and anonymous labels disagree");
    }
    const body = { operationId, index, startMs, endMs, state, kind, speakerLabels: labels, turnIds: ids, uncertainty: { state: uncertaintyState, reason: uncertaintyReason } } as const;
    const observationId = string(cell.observationId, context, `${path}.accounting[${index}].observationId`);
    if (observationIds.has(observationId) || observationId !== speakerAccountingObservationId(body)) fail(context, `${path}.accounting[${index}].observationId`, "is repeated or does not close the accounting cell");
    observationIds.add(observationId);
  }
  if (cursor !== inputSource.grantedRange.endMs) fail(context, `${path}.accounting`, "does not close the complete granted range");
  const state = oneOf<SpeakerOverlapArtifactState>(item.state, ARTIFACT_STATES, context, `${path}.state`);
  oneOf(item.reason, ARTIFACT_REASONS, context, `${path}.reason`);
  const hasTruncated = accounting.some((entry) => (entry as { state: string }).state === "truncated");
  const hasAvailable = accounting.some((entry) => (entry as { state: string }).state === "available");
  const derivedState: SpeakerOverlapArtifactState = hasTruncated ? "truncated" : turns.length === 0 ? "empty" : hasAvailable ? "available" : "unknown";
  const derivedReason = derivedState === "truncated" ? "output_limit_exceeded" : derivedState === "empty" ? "no_speaker_hypotheses" : derivedState === "available" ? "hypotheses_emitted" : "all_cells_uncertain";
  if (state !== derivedState || item.reason !== derivedReason) fail(context, path, "artifact state does not match complete accounting");
  nonClaims(item.nonClaims, context, `${path}.nonClaims`);
  return item as unknown as SpeakerOverlapObservations;
}

export function validateSpeakerOverlapReceipt(value: unknown, context = "Speaker/overlap receipt", path = "receipt"): SpeakerOverlapReceipt {
  const item = object(value, context, path);
  exact(item, ["schema", "receiptId", "operationId", "capability", "authorization", "input", "producer", "limits", "execution", "output", "nonClaims"], context, path);
  literal(item.schema, "studio.speaker-overlap-producer.receipt.v1", context, `${path}.schema`);
  string(item.receiptId, context, `${path}.receiptId`);
  string(item.operationId, context, `${path}.operationId`);
  literal(item.capability, "media.speakers.analyze", context, `${path}.capability`);
  const authorization = object(item.authorization, context, `${path}.authorization`);
  exact(authorization, ["grantId", "taskId", "agentId", "executionId", "launchClaimId"], context, `${path}.authorization`);
  for (const key of ["grantId", "taskId", "agentId", "executionId", "launchClaimId"]) string(authorization[key], context, `${path}.authorization.${key}`);
  const input = object(item.input, context, `${path}.input`);
  exact(input, ["artifactId", "contentId", "audioTrackId", "grantedRange", "sourceBytes", "normalizedAudio"], context, `${path}.input`);
  source({ artifactId: input.artifactId, contentId: input.contentId, audioTrackId: input.audioTrackId, grantedRange: input.grantedRange }, context, `${path}.input.source`);
  if (integer(input.sourceBytes, context, `${path}.input.sourceBytes`, 1) > SPEAKER_OVERLAP_LIMITS.maxSourceBytes) fail(context, `${path}.input.sourceBytes`, "exceeds the source byte limit");
  const normalized = object(input.normalizedAudio, context, `${path}.input.normalizedAudio`);
  exact(normalized, ["content", "sampleRateHz", "channels", "sampleFormat", "sampleCount"], context, `${path}.input.normalizedAudio`);
  hash(normalized.content, context, `${path}.input.normalizedAudio.content`);
  if ((normalized.content as { bytes: number }).bytes > SPEAKER_OVERLAP_LIMITS.maxNormalizedAudioBytes || normalized.sampleRateHz !== 16_000 || normalized.channels !== 1) fail(context, `${path}.input.normalizedAudio`, "changed normalization or exceeded byte limits");
  literal(normalized.sampleFormat, "s16le", context, `${path}.input.normalizedAudio.sampleFormat`);
  if (integer(normalized.sampleCount, context, `${path}.input.normalizedAudio.sampleCount`, 1) > SPEAKER_OVERLAP_LIMITS.maxDecodedSamples) fail(context, `${path}.input.normalizedAudio.sampleCount`, "exceeds the decoded sample limit");
  validateSpeakerOverlapProducerLineage(item.producer, context, `${path}.producer`);
  validateSpeakerOverlapLimits(item.limits, context, `${path}.limits`);
  const execution = object(item.execution, context, `${path}.execution`);
  exact(execution, ["wallMs", "measuredBeforeReceiptMs", "wallAccounting", "rawTurnCount", "accountingCellCount", "localSpeakerClusterCount", "inputBytes"], context, `${path}.execution`);
  const wallMs = integer(execution.wallMs, context, `${path}.execution.wallMs`, 1);
  const measured = integer(execution.measuredBeforeReceiptMs, context, `${path}.execution.measuredBeforeReceiptMs`);
  const rawTurnCount = integer(execution.rawTurnCount, context, `${path}.execution.rawTurnCount`);
  const accountingCellCount = integer(execution.accountingCellCount, context, `${path}.execution.accountingCellCount`, 1);
  const localSpeakerClusterCount = integer(execution.localSpeakerClusterCount, context, `${path}.execution.localSpeakerClusterCount`);
  literal(execution.wallAccounting, "full_grant_charged_before_atomic_completion", context, `${path}.execution.wallAccounting`);
  if (wallMs > SPEAKER_OVERLAP_LIMITS.maxWallMs || measured > wallMs ||
      rawTurnCount > SPEAKER_OVERLAP_LIMITS.maxTurns + 1 ||
      accountingCellCount > SPEAKER_OVERLAP_LIMITS.maxAccountingCells ||
      localSpeakerClusterCount > SPEAKER_OVERLAP_LIMITS.maxLocalSpeakerClusters + 1 ||
      integer(execution.inputBytes, context, `${path}.execution.inputBytes`, 1) !== (normalized.content as { bytes: number }).bytes) fail(context, `${path}.execution`, "exceeds or disagrees with registered limits");
  const output = object(item.output, context, `${path}.output`);
  exact(output, ["artifactId", "contentId", "bytes", "state"], context, `${path}.output`);
  string(output.artifactId, context, `${path}.output.artifactId`);
  contentId(output.contentId, context, `${path}.output.contentId`);
  if (integer(output.bytes, context, `${path}.output.bytes`, 1) > SPEAKER_OVERLAP_LIMITS.maxObservationBytes) fail(context, `${path}.output.bytes`, "exceeds the observation byte limit");
  const outputState = oneOf<SpeakerOverlapArtifactState>(output.state, ARTIFACT_STATES, context, `${path}.output.state`);
  if ((rawTurnCount > SPEAKER_OVERLAP_LIMITS.maxTurns || localSpeakerClusterCount > SPEAKER_OVERLAP_LIMITS.maxLocalSpeakerClusters) && outputState !== "truncated") {
    fail(context, `${path}.execution`, "over-limit model output must be represented only by a truncated artifact");
  }
  nonClaims(item.nonClaims, context, `${path}.nonClaims`);
  const receipt = item as unknown as SpeakerOverlapReceipt;
  const { receiptId: _receiptId, ...withoutId } = receipt;
  if (receipt.receiptId !== speakerOverlapReceiptId(withoutId)) fail(context, `${path}.receiptId`, "does not close the receipt body");
  return receipt;
}

export function validateSpeakerOverlapEvidenceCitationInput(value: unknown, context: string, path: string): SpeakerOverlapEvidenceCitationInput {
  const item = object(value, context, path);
  exact(item, ["operationId", "artifactId", "contentId", "receiptArtifactId", "receiptId", "receiptContentId"], context, path);
  return {
    operationId: string(item.operationId, context, `${path}.operationId`),
    artifactId: string(item.artifactId, context, `${path}.artifactId`),
    contentId: contentId(item.contentId, context, `${path}.contentId`),
    receiptArtifactId: string(item.receiptArtifactId, context, `${path}.receiptArtifactId`),
    receiptId: string(item.receiptId, context, `${path}.receiptId`),
    receiptContentId: contentId(item.receiptContentId, context, `${path}.receiptContentId`),
  };
}
