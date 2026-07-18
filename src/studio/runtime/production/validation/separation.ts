import { canonicalSha256 } from "../canonicalIdentity.ts";
import {
  CONDITIONAL_SEPARATION_LIMITS,
  SEPARATION_METHOD,
  type ConditionalSeparationGrantScope,
  type ConditionalSeparationLimits,
  type ConditionalSeparationReceipt,
  type ConditionalSeparationRequest,
  type ConditionalSeparationTrigger,
  type RawStemComparison,
  type RawStemComparisonReceipt,
  type SeparationProducerLineage,
  type SeparationRecognizerResult,
  type SeparationStemOutput,
  type U1AcousticSeparationTrigger,
  type U6SpeakerOverlapSeparationTrigger,
} from "../model.ts";
import { validateCurrentRunRecognizerDescriptor } from "./semanticEvidence.ts";
import { array, contentId, exact, fail, hash, integer, literal, object, oneOf, string } from "./primitives.ts";

const LIMIT_KEYS = Object.keys(CONDITIONAL_SEPARATION_LIMITS) as Array<keyof ConditionalSeparationLimits>;

function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function range(value: unknown, context: string, path: string): { startMs: number; endMs: number } {
  const item = object(value, context, path);
  exact(item, ["startMs", "endMs"], context, path);
  const startMs = integer(item.startMs, context, `${path}.startMs`);
  const endMs = integer(item.endMs, context, `${path}.endMs`, 1);
  if (endMs <= startMs) fail(context, path, "must be a non-empty half-open range");
  return { startMs, endMs };
}

export function validateConditionalSeparationLimits(value: unknown, context: string, path: string): ConditionalSeparationLimits {
  const item = object(value, context, path);
  exact(item, LIMIT_KEYS, context, path);
  for (const key of LIMIT_KEYS) {
    if (integer(item[key], context, `${path}.${key}`, 1) !== CONDITIONAL_SEPARATION_LIMITS[key]) {
      fail(context, `${path}.${key}`, `must equal registered U7 limit ${CONDITIONAL_SEPARATION_LIMITS[key]}`);
    }
  }
  return item as unknown as ConditionalSeparationLimits;
}

export function validateU6SpeakerOverlapSeparationTrigger(value: unknown, context: string, path: string): U6SpeakerOverlapSeparationTrigger {
  const item = object(value, context, path);
  exact(item, ["kind", "operationId", "observationsArtifactId", "observationsContentId", "receiptArtifactId", "receiptId", "receiptContentId", "observationId", "range"], context, path);
  literal(item.kind, "u6_speaker_overlap", context, `${path}.kind`);
  for (const key of ["operationId", "observationsArtifactId", "receiptArtifactId", "receiptId", "observationId"]) string(item[key], context, `${path}.${key}`);
  contentId(item.observationsContentId, context, `${path}.observationsContentId`);
  contentId(item.receiptContentId, context, `${path}.receiptContentId`);
  range(item.range, context, `${path}.range`);
  return item as unknown as U6SpeakerOverlapSeparationTrigger;
}

export function validateU1AcousticSeparationTrigger(value: unknown, context: string, path: string): U1AcousticSeparationTrigger {
  const item = object(value, context, path);
  exact(item, ["kind", "observationsArtifactId", "observationsContentId", "receiptId", "receiptContentId", "observationId", "observationIndex", "trackId", "range"], context, path);
  literal(item.kind, "u1_acoustic_mixed", context, `${path}.kind`);
  for (const key of ["observationsArtifactId", "receiptId", "observationId", "trackId"]) string(item[key], context, `${path}.${key}`);
  contentId(item.observationsContentId, context, `${path}.observationsContentId`);
  contentId(item.receiptContentId, context, `${path}.receiptContentId`);
  integer(item.observationIndex, context, `${path}.observationIndex`);
  range(item.range, context, `${path}.range`);
  return item as unknown as U1AcousticSeparationTrigger;
}

/** Kind-dispatching validator; the grant-scope, receipt, and event validators call this one seam. */
export function validateConditionalSeparationTrigger(value: unknown, context: string, path: string): ConditionalSeparationTrigger {
  const item = object(value, context, path);
  if (item.kind === "u6_speaker_overlap") return validateU6SpeakerOverlapSeparationTrigger(value, context, path);
  if (item.kind === "u1_acoustic_mixed") return validateU1AcousticSeparationTrigger(value, context, path);
  return fail(context, `${path}.kind`, "must be a registered conditional separation trigger kind");
}

function source(value: unknown, context: string, path: string): ConditionalSeparationGrantScope["source"] {
  const item = object(value, context, path);
  exact(item, ["artifactId", "contentId", "trackId", "range"], context, path);
  return {
    artifactId: string(item.artifactId, context, `${path}.artifactId`),
    contentId: contentId(item.contentId, context, `${path}.contentId`),
    trackId: string(item.trackId, context, `${path}.trackId`),
    range: range(item.range, context, `${path}.range`),
  };
}

export function validateConditionalSeparationGrantScope(value: unknown, context: string, path: string): ConditionalSeparationGrantScope {
  const item = object(value, context, path);
  exact(item, ["schema", "source", "trigger", "producerPolicy", "limits"], context, path);
  literal(item.schema, "studio.conditional-separation-grant.v1", context, `${path}.schema`);
  const inputSource = source(item.source, context, `${path}.source`);
  const trigger = validateConditionalSeparationTrigger(item.trigger, context, `${path}.trigger`);
  if (!same(inputSource.range, trigger.range)) fail(context, `${path}.trigger.range`, "must exactly equal the granted source range");
  const policy = object(item.producerPolicy, context, `${path}.producerPolicy`);
  exact(policy, ["methodId", "methodVersion", "modelId", "modelRevision", "modelContentIds", "configurationContentId", "stemRoles"], context, `${path}.producerPolicy`);
  literal(policy.methodId, SEPARATION_METHOD.id, context, `${path}.producerPolicy.methodId`);
  literal(policy.methodVersion, SEPARATION_METHOD.version, context, `${path}.producerPolicy.methodVersion`);
  literal(policy.modelId, SEPARATION_METHOD.modelId, context, `${path}.producerPolicy.modelId`);
  literal(policy.modelRevision, SEPARATION_METHOD.modelRevision, context, `${path}.producerPolicy.modelRevision`);
  const modelContentIds = array(policy.modelContentIds, context, `${path}.producerPolicy.modelContentIds`).map((entry, index) => contentId(entry, context, `${path}.producerPolicy.modelContentIds[${index}]`));
  if (!same(modelContentIds, [...SEPARATION_METHOD.modelContentIds])) fail(context, `${path}.producerPolicy.modelContentIds`, "changed pinned model bytes");
  literal(policy.configurationContentId, SEPARATION_METHOD.configurationContentId, context, `${path}.producerPolicy.configurationContentId`);
  if (!same(policy.stemRoles, ["source_estimate_1", "source_estimate_2"])) fail(context, `${path}.producerPolicy.stemRoles`, "must retain anonymous ordered estimate roles");
  validateConditionalSeparationLimits(item.limits, context, `${path}.limits`);
  return item as unknown as ConditionalSeparationGrantScope;
}

export function assertConditionalSeparationRequest(value: unknown, context = "Conditional separation request"): asserts value is ConditionalSeparationRequest {
  const item = object(value, context, "request");
  exact(item, ["operationId", "taskId", "agentId", "grantId"], context, "request");
  for (const key of ["operationId", "taskId", "agentId", "grantId"]) string(item[key], context, `request.${key}`);
}

export function conditionalSeparationRequestFingerprint(input: {
  sourceContentId: string;
  trackId: string;
  range: { startMs: number; endMs: number };
  trigger: ConditionalSeparationTrigger;
  modelContentIds: string[];
  configurationContentId: string;
}): string {
  return `conditional-separation-request:${canonicalSha256(input)}`;
}

function runtimeFile(value: unknown, context: string, path: string): void {
  const item = object(value, context, path);
  exact(item, ["name", "content"], context, path);
  string(item.name, context, `${path}.name`);
  hash(item.content, context, `${path}.content`);
}

export function validateSeparationProducerLineage(value: unknown, context: string, path: string): SeparationProducerLineage {
  const item = object(value, context, path);
  exact(item, ["schema", "adapter", "runtime", "model", "configuration"], context, path);
  literal(item.schema, "studio.source-separation-lineage.v1", context, `${path}.schema`);
  const adapter = object(item.adapter, context, `${path}.adapter`);
  exact(adapter, ["id", "version"], context, `${path}.adapter`);
  literal(adapter.id, SEPARATION_METHOD.id, context, `${path}.adapter.id`);
  literal(adapter.version, SEPARATION_METHOD.version, context, `${path}.adapter.version`);
  const runtime = object(item.runtime, context, `${path}.runtime`);
  exact(runtime, ["python", "packages", "files", "execution"], context, `${path}.runtime`);
  const python = object(runtime.python, context, `${path}.runtime.python`);
  exact(python, ["version", "platform", "arch"], context, `${path}.runtime.python`);
  literal(python.version, "3.14", context, `${path}.runtime.python.version`);
  literal(python.platform, "darwin", context, `${path}.runtime.python.platform`);
  literal(python.arch, "arm64", context, `${path}.runtime.python.arch`);
  const packages = object(runtime.packages, context, `${path}.runtime.packages`);
  exact(packages, ["speechbrain", "torch", "torchaudio"], context, `${path}.runtime.packages`);
  for (const [name, version] of [["speechbrain", "1.1.0"], ["torch", "2.11.0"], ["torchaudio", "2.11.0"]] as const) {
    const pkg = object(packages[name], context, `${path}.runtime.packages.${name}`);
    exact(pkg, ["version"], context, `${path}.runtime.packages.${name}`);
    literal(pkg.version, version, context, `${path}.runtime.packages.${name}.version`);
  }
  const runtimeFiles = array(runtime.files, context, `${path}.runtime.files`);
  if (runtimeFiles.length < 4) fail(context, `${path}.runtime.files`, "must close the adapter and package runtime files");
  runtimeFiles.forEach((entry, index) => runtimeFile(entry, context, `${path}.runtime.files[${index}]`));
  const execution = object(runtime.execution, context, `${path}.runtime.execution`);
  exact(execution, ["engine", "provider", "threads", "network"], context, `${path}.runtime.execution`);
  literal(execution.engine, "python_subprocess", context, `${path}.runtime.execution.engine`);
  literal(execution.provider, "cpu", context, `${path}.runtime.execution.provider`);
  if (integer(execution.threads, context, `${path}.runtime.execution.threads`, 1) !== 1) fail(context, `${path}.runtime.execution.threads`, "must remain single-threaded");
  literal(execution.network, "disabled", context, `${path}.runtime.execution.network`);
  const model = object(item.model, context, `${path}.model`);
  exact(model, ["id", "revision", "license", "trainingDomain", "files"], context, `${path}.model`);
  literal(model.id, SEPARATION_METHOD.modelId, context, `${path}.model.id`);
  literal(model.revision, SEPARATION_METHOD.modelRevision, context, `${path}.model.revision`);
  literal(model.license, "Apache-2.0-model-card-declaration", context, `${path}.model.license`);
  literal(model.trainingDomain, "wsj0-2mix", context, `${path}.model.trainingDomain`);
  const modelFiles = array(model.files, context, `${path}.model.files`);
  if (modelFiles.length !== 4) fail(context, `${path}.model.files`, "must contain the four executable pinned model files");
  modelFiles.forEach((entry, index) => runtimeFile(entry, context, `${path}.model.files[${index}]`));
  const observedModelIds = modelFiles.map((entry) => (entry as { content: { contentId: string } }).content.contentId);
  if (!same(observedModelIds, [...SEPARATION_METHOD.modelContentIds])) fail(context, `${path}.model.files`, "changed pinned model bytes or order");
  const configuration = object(item.configuration, context, `${path}.configuration`);
  exact(configuration, ["contentId", "sampleRateHz", "channels", "sampleFormat", "estimatedSources", "outputRoles", "timing"], context, `${path}.configuration`);
  literal(configuration.contentId, SEPARATION_METHOD.configurationContentId, context, `${path}.configuration.contentId`);
  if (configuration.sampleRateHz !== 8_000 || configuration.channels !== 1 || configuration.estimatedSources !== 2 || !same(configuration.outputRoles, ["source_estimate_1", "source_estimate_2"])) fail(context, `${path}.configuration`, "changed pinned audio or source-count configuration");
  literal(configuration.sampleFormat, "pcm_s16le_wav", context, `${path}.configuration.sampleFormat`);
  literal(configuration.timing, "exact_granted_range_relative_audio", context, `${path}.configuration.timing`);
  return item as unknown as SeparationProducerLineage;
}

function nonClaims(value: unknown, context: string, path: string): void {
  const item = object(value, context, path);
  exact(item, ["speakerIdentity", "sourceIdentity", "separationQuality", "semanticPreference", "captionAuthority", "publication"], context, path);
  literal(item.speakerIdentity, "not_assessed", context, `${path}.speakerIdentity`);
  literal(item.sourceIdentity, "anonymous_estimate_only", context, `${path}.sourceIdentity`);
  literal(item.separationQuality, "not_assessed", context, `${path}.separationQuality`);
  literal(item.semanticPreference, "not_granted", context, `${path}.semanticPreference`);
  literal(item.captionAuthority, "not_granted", context, `${path}.captionAuthority`);
  literal(item.publication, "not_granted", context, `${path}.publication`);
}

function stemOutput(value: unknown, context: string, path: string): SeparationStemOutput {
  const item = object(value, context, path);
  exact(item, ["role", "artifactId", "contentId", "bytes", "trackId", "durationMs", "sampleCount"], context, path);
  const role = oneOf<SeparationStemOutput["role"]>(item.role, new Set(["source_estimate_1", "source_estimate_2"]), context, `${path}.role`);
  const bytes = integer(item.bytes, context, `${path}.bytes`, 1);
  if (bytes > CONDITIONAL_SEPARATION_LIMITS.maxStemBytes) fail(context, `${path}.bytes`, "exceeds the stem byte limit");
  const durationMs = integer(item.durationMs, context, `${path}.durationMs`, 1);
  const sampleCount = integer(item.sampleCount, context, `${path}.sampleCount`, 1);
  if (durationMs > CONDITIONAL_SEPARATION_LIMITS.maxRangeMs || sampleCount > CONDITIONAL_SEPARATION_LIMITS.maxDecodedSamples) fail(context, path, "exceeds duration or sample limits");
  return { role, artifactId: string(item.artifactId, context, `${path}.artifactId`), contentId: contentId(item.contentId, context, `${path}.contentId`), bytes, trackId: string(item.trackId, context, `${path}.trackId`), durationMs, sampleCount };
}

export function conditionalSeparationReceiptId(value: Omit<ConditionalSeparationReceipt, "receiptId">): string {
  const { schema: _schema, ...body } = value;
  return `conditional-separation-receipt:${canonicalSha256(body)}`;
}

export function validateConditionalSeparationReceipt(value: unknown, context = "Conditional separation receipt", path = "receipt"): ConditionalSeparationReceipt {
  const item = object(value, context, path);
  exact(item, ["schema", "receiptId", "operationId", "capability", "authorization", "source", "trigger", "producer", "limits", "execution", "outputs", "nonClaims"], context, path);
  literal(item.schema, "studio.conditional-separation.receipt.v1", context, `${path}.schema`);
  string(item.receiptId, context, `${path}.receiptId`);
  string(item.operationId, context, `${path}.operationId`);
  literal(item.capability, "media.audio.separate", context, `${path}.capability`);
  const authorization = object(item.authorization, context, `${path}.authorization`);
  exact(authorization, ["grantId", "taskId", "agentId", "executionId", "launchClaimId"], context, `${path}.authorization`);
  for (const key of ["grantId", "taskId", "agentId", "executionId", "launchClaimId"]) string(authorization[key], context, `${path}.authorization.${key}`);
  const receiptSource = object(item.source, context, `${path}.source`);
  exact(receiptSource, ["artifactId", "contentId", "trackId", "range", "sourceBytes", "normalizedAudio"], context, `${path}.source`);
  source({ artifactId: receiptSource.artifactId, contentId: receiptSource.contentId, trackId: receiptSource.trackId, range: receiptSource.range }, context, `${path}.source.input`);
  if (integer(receiptSource.sourceBytes, context, `${path}.source.sourceBytes`, 1) > CONDITIONAL_SEPARATION_LIMITS.maxSourceBytes) fail(context, `${path}.source.sourceBytes`, "exceeds source limit");
  const normalized = object(receiptSource.normalizedAudio, context, `${path}.source.normalizedAudio`);
  exact(normalized, ["content", "sampleRateHz", "channels", "sampleFormat", "sampleCount"], context, `${path}.source.normalizedAudio`);
  hash(normalized.content, context, `${path}.source.normalizedAudio.content`);
  if ((normalized.content as { bytes: number }).bytes > CONDITIONAL_SEPARATION_LIMITS.maxNormalizedAudioBytes || normalized.sampleRateHz !== 8_000 || normalized.channels !== 1 || integer(normalized.sampleCount, context, `${path}.source.normalizedAudio.sampleCount`, 1) > CONDITIONAL_SEPARATION_LIMITS.maxDecodedSamples) fail(context, `${path}.source.normalizedAudio`, "changed normalization or exceeded limits");
  literal(normalized.sampleFormat, "pcm_s16le_wav", context, `${path}.source.normalizedAudio.sampleFormat`);
  validateConditionalSeparationTrigger(item.trigger, context, `${path}.trigger`);
  validateSeparationProducerLineage(item.producer, context, `${path}.producer`);
  validateConditionalSeparationLimits(item.limits, context, `${path}.limits`);
  const execution = object(item.execution, context, `${path}.execution`);
  exact(execution, ["wallMs", "measuredBeforeReceiptMs", "wallAccounting"], context, `${path}.execution`);
  const wallMs = integer(execution.wallMs, context, `${path}.execution.wallMs`, 1);
  if (wallMs > CONDITIONAL_SEPARATION_LIMITS.maxWallMs || integer(execution.measuredBeforeReceiptMs, context, `${path}.execution.measuredBeforeReceiptMs`) > wallMs) fail(context, `${path}.execution`, "exceeds wall limit");
  literal(execution.wallAccounting, "full_grant_charged_before_atomic_completion", context, `${path}.execution.wallAccounting`);
  const outputs = array(item.outputs, context, `${path}.outputs`).map((entry, index) => stemOutput(entry, context, `${path}.outputs[${index}]`));
  if (outputs.length !== 2 || outputs[0].role !== "source_estimate_1" || outputs[1].role !== "source_estimate_2" || new Set(outputs.map((entry) => entry.artifactId)).size !== 2) fail(context, `${path}.outputs`, "must contain exactly two unique anonymous source estimates");
  nonClaims(item.nonClaims, context, `${path}.nonClaims`);
  const receipt = item as unknown as ConditionalSeparationReceipt;
  const { receiptId: _receiptId, ...withoutId } = receipt;
  if (receipt.receiptId !== conditionalSeparationReceiptId(withoutId)) fail(context, `${path}.receiptId`, "does not close the receipt body");
  return receipt;
}

function recognizerResult(value: unknown, context: string, path: string, absoluteRange: { startMs: number; endMs: number }): SeparationRecognizerResult {
  const item = object(value, context, path);
  exact(item, ["availability", "reason", "segments"], context, path);
  const availability = oneOf<SeparationRecognizerResult["availability"]>(item.availability, new Set(["available", "empty", "unavailable", "unknown", "truncated"]), context, `${path}.availability`);
  const reason = string(item.reason, context, `${path}.reason`);
  const segments = array(item.segments, context, `${path}.segments`);
  if (segments.length > CONDITIONAL_SEPARATION_LIMITS.maxRecognizerSegmentsPerInput) fail(context, `${path}.segments`, "exceeds the recognizer segment limit");
  for (const [index, entry] of segments.entries()) {
    const segment = object(entry, context, `${path}.segments[${index}]`);
    exact(segment, ["startMs", "endMs", "state", "text"], context, `${path}.segments[${index}]`);
    const startMs = integer(segment.startMs, context, `${path}.segments[${index}].startMs`);
    const endMs = integer(segment.endMs, context, `${path}.segments[${index}].endMs`, 1);
    if (startMs < absoluteRange.startMs || endMs > absoluteRange.endMs || endMs <= startMs) fail(context, `${path}.segments[${index}]`, "escapes the exact source range");
    oneOf(segment.state, new Set(["available", "unavailable", "unknown"]), context, `${path}.segments[${index}].state`);
    if (segment.text !== null && typeof segment.text !== "string") fail(context, `${path}.segments[${index}].text`, "must be string or null");
  }
  return { availability, reason, segments: segments as SeparationRecognizerResult["segments"] };
}

function normalizedRecognizerText(result: SeparationRecognizerResult): string {
  return result.segments
    .filter((segment) => segment.state === "available" && segment.text !== null)
    .map((segment) => segment.text!.normalize("NFC").trim().replace(/\s+/g, " "))
    .filter(Boolean)
    .join(" ");
}

export function validateRawStemComparison(value: unknown, context = "Raw/stem comparison", path = "comparison"): RawStemComparison {
  const item = object(value, context, path);
  exact(item, ["schema", "operationId", "runId", "source", "separationReceiptId", "recognizer", "requestedSourceLanguage", "inputs", "outcome", "reason", "deterministicGate"], context, path);
  literal(item.schema, "studio.raw-stem-comparison.v1", context, `${path}.schema`);
  string(item.operationId, context, `${path}.operationId`);
  string(item.runId, context, `${path}.runId`);
  const inputSource = source(item.source, context, `${path}.source`);
  string(item.separationReceiptId, context, `${path}.separationReceiptId`);
  validateCurrentRunRecognizerDescriptor(item.recognizer, context, `${path}.recognizer`);
  const language = object(item.requestedSourceLanguage, context, `${path}.requestedSourceLanguage`);
  exact(language, ["mode", "languages", "reason"], context, `${path}.requestedSourceLanguage`);
  oneOf(language.mode, new Set(["declared", "automatic", "mixed", "unknown", "withheld"]), context, `${path}.requestedSourceLanguage.mode`);
  array(language.languages, context, `${path}.requestedSourceLanguage.languages`).forEach((entry, index) => string(entry, context, `${path}.requestedSourceLanguage.languages[${index}]`));
  if (language.reason !== null) string(language.reason, context, `${path}.requestedSourceLanguage.reason`);
  const inputs = object(item.inputs, context, `${path}.inputs`);
  exact(inputs, ["raw", "stems"], context, `${path}.inputs`);
  const raw = object(inputs.raw, context, `${path}.inputs.raw`);
  exact(raw, ["artifactId", "contentId", "result"], context, `${path}.inputs.raw`);
  string(raw.artifactId, context, `${path}.inputs.raw.artifactId`);
  contentId(raw.contentId, context, `${path}.inputs.raw.contentId`);
  const rawResult = recognizerResult(raw.result, context, `${path}.inputs.raw.result`, inputSource.range);
  const stems = array(inputs.stems, context, `${path}.inputs.stems`);
  if (stems.length !== 2) fail(context, `${path}.inputs.stems`, "must contain exactly two selected estimates");
  const stemRoles: string[] = [];
  const stemResults = stems.map((entry, index) => {
    const stem = object(entry, context, `${path}.inputs.stems[${index}]`);
    exact(stem, ["role", "artifactId", "contentId", "result"], context, `${path}.inputs.stems[${index}]`);
    stemRoles.push(oneOf(stem.role, new Set(["source_estimate_1", "source_estimate_2"]), context, `${path}.inputs.stems[${index}].role`));
    string(stem.artifactId, context, `${path}.inputs.stems[${index}].artifactId`);
    contentId(stem.contentId, context, `${path}.inputs.stems[${index}].contentId`);
    return recognizerResult(stem.result, context, `${path}.inputs.stems[${index}].result`, inputSource.range);
  });
  if (!same(stemRoles, ["source_estimate_1", "source_estimate_2"])) fail(context, `${path}.inputs.stems`, "must preserve the two ordered anonymous estimates");
  const outcome = oneOf<RawStemComparison["outcome"]>(item.outcome, new Set(["agreement", "disagreement", "abstention"]), context, `${path}.outcome`);
  const reason = oneOf<RawStemComparison["reason"]>(item.reason, new Set(["normalized_text_agrees", "normalized_text_disagrees", "recognizer_unavailable_or_incomplete"]), context, `${path}.reason`);
  const allAvailable = [rawResult, ...stemResults].every((result) => result.availability === "available");
  const normalizedTexts = [rawResult, ...stemResults].map(normalizedRecognizerText);
  const agreement = allAvailable && normalizedTexts.every((text) => text === normalizedTexts[0]);
  const expectedOutcome: RawStemComparison["outcome"] = !allAvailable ? "abstention" : agreement ? "agreement" : "disagreement";
  const expectedReason: RawStemComparison["reason"] = !allAvailable ? "recognizer_unavailable_or_incomplete" : agreement ? "normalized_text_agrees" : "normalized_text_disagrees";
  if (outcome !== expectedOutcome || reason !== expectedReason) fail(context, `${path}.outcome`, "does not follow the deterministic normalized-text comparison");
  const gate = object(item.deterministicGate, context, `${path}.deterministicGate`);
  exact(gate, ["lineage", "comparable", "sameRecognizer", "exactRange", "semanticPreference", "semanticAuthority", "captionAuthority"], context, `${path}.deterministicGate`);
  literal(gate.lineage, "verified", context, `${path}.deterministicGate.lineage`);
  if (gate.comparable !== true || gate.sameRecognizer !== true || gate.exactRange !== true || gate.semanticPreference !== null) fail(context, `${path}.deterministicGate`, "may establish comparability only and cannot prefer an input");
  literal(gate.semanticAuthority, "not_granted", context, `${path}.deterministicGate.semanticAuthority`);
  literal(gate.captionAuthority, "not_granted", context, `${path}.deterministicGate.captionAuthority`);
  return item as unknown as RawStemComparison;
}

export function rawStemComparisonReceiptId(value: Omit<RawStemComparisonReceipt, "receiptId">): string {
  const { schema: _schema, ...body } = value;
  return `raw-stem-comparison-receipt:${canonicalSha256(body)}`;
}

export function validateRawStemComparisonReceipt(value: unknown, context = "Raw/stem comparison receipt", path = "receipt"): RawStemComparisonReceipt {
  const item = object(value, context, path);
  exact(item, ["schema", "receiptId", "operationId", "separationReceiptId", "comparison", "recognizer", "inputArtifactIds", "nonClaims"], context, path);
  literal(item.schema, "studio.raw-stem-comparison.receipt.v1", context, `${path}.schema`);
  string(item.receiptId, context, `${path}.receiptId`);
  string(item.operationId, context, `${path}.operationId`);
  string(item.separationReceiptId, context, `${path}.separationReceiptId`);
  const comparison = object(item.comparison, context, `${path}.comparison`);
  exact(comparison, ["artifactId", "contentId", "bytes", "outcome"], context, `${path}.comparison`);
  string(comparison.artifactId, context, `${path}.comparison.artifactId`);
  contentId(comparison.contentId, context, `${path}.comparison.contentId`);
  if (integer(comparison.bytes, context, `${path}.comparison.bytes`, 1) > CONDITIONAL_SEPARATION_LIMITS.maxComparisonBytes) fail(context, `${path}.comparison.bytes`, "exceeds comparison limit");
  oneOf(comparison.outcome, new Set(["agreement", "disagreement", "abstention"]), context, `${path}.comparison.outcome`);
  validateCurrentRunRecognizerDescriptor(item.recognizer, context, `${path}.recognizer`);
  const ids = array(item.inputArtifactIds, context, `${path}.inputArtifactIds`).map((entry, index) => string(entry, context, `${path}.inputArtifactIds[${index}]`));
  if (ids.length !== 3 || new Set(ids).size !== 3) fail(context, `${path}.inputArtifactIds`, "must identify raw and both unique stems");
  nonClaims(item.nonClaims, context, `${path}.nonClaims`);
  const receipt = item as unknown as RawStemComparisonReceipt;
  const { receiptId: _receiptId, ...withoutId } = receipt;
  if (receipt.receiptId !== rawStemComparisonReceiptId(withoutId)) fail(context, `${path}.receiptId`, "does not close the receipt body");
  return receipt;
}
