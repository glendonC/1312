import { canonicalSha256 } from "../canonicalIdentity.ts";
import {
  ACOUSTIC_CONFIGURATION,
  ACOUSTIC_LIMITS,
  ACOUSTIC_SAMPLE_RATE_HZ,
  type AcousticObservations,
  type AcousticTriageReceipt,
} from "./contracts.ts";

const CONTENT_ID = /^sha256:[a-f0-9]{64}$/;

function fail(message: string): never { throw new Error(`Acoustic evidence: ${message}`); }
function object(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${path} must be an object`);
  return value as Record<string, unknown>;
}
function exact(value: Record<string, unknown>, keys: string[], path: string): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail(`${path} must contain exactly ${expected.join(", ")}`);
  }
}
function integer(value: unknown, path: string, minimum = 0): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) fail(`${path} must be a safe integer >= ${minimum}`);
  return value as number;
}
function finite(value: unknown, path: string, minimum = 0, maximum = 1): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) fail(`${path} must be within ${minimum}..${maximum}`);
  return value;
}
function content(value: unknown, path: string): { id: string; hash: { algorithm: "sha256"; digest: string }; bytes: number } {
  const item = object(value, path); exact(item, ["id", "hash", "bytes"], path);
  const hash = object(item.hash, `${path}.hash`); exact(hash, ["algorithm", "digest"], `${path}.hash`);
  if (typeof item.id !== "string" || !CONTENT_ID.test(item.id) || hash.algorithm !== "sha256" || item.id !== `sha256:${hash.digest}`) fail(`${path} has an invalid content identity`);
  return item as ReturnType<typeof content>;
}
function range(value: unknown, path: string): AcousticObservations["requestedRange"] {
  const item = object(value, path); exact(item, ["startMs", "endMs", "startSample", "endSample"], path);
  const startMs = integer(item.startMs, `${path}.startMs`); const endMs = integer(item.endMs, `${path}.endMs`, 1);
  const startSample = integer(item.startSample, `${path}.startSample`); const endSample = integer(item.endSample, `${path}.endSample`, 1);
  if (endMs <= startMs || endSample <= startSample || startSample !== startMs * 16 || endSample !== endMs * 16) fail(`${path} must be a non-empty exact 16-sample-per-ms range`);
  return { startMs, endMs, startSample, endSample };
}

export function validateAcousticObservations(value: unknown): AcousticObservations {
  const item = object(value, "observations");
  exact(item, ["schema", "source", "normalization", "requestedRange", "returnedRange", "status", "observations"], "observations");
  if (item.schema !== "studio.acoustic-observations.v1") fail("observations.schema is not registered");
  const source = object(item.source, "observations.source"); exact(source, ["contentId", "bytes", "trackIndex"], "observations.source");
  if (typeof source.contentId !== "string" || !CONTENT_ID.test(source.contentId)) fail("observations.source.contentId is invalid");
  integer(source.bytes, "observations.source.bytes", 1); integer(source.trackIndex, "observations.source.trackIndex");
  const normalization = object(item.normalization, "observations.normalization");
  exact(normalization, ["content", "sampleRateHz", "channels", "sampleFormat", "sampleCount"], "observations.normalization");
  content(normalization.content, "observations.normalization.content");
  if (normalization.sampleRateHz !== 16_000 || normalization.channels !== 1 || normalization.sampleFormat !== "s16le") fail("observations.normalization contract changed");
  const sampleCount = integer(normalization.sampleCount, "observations.normalization.sampleCount", 1);
  const requestedRange = range(item.requestedRange, "observations.requestedRange");
  const returnedRange = range(item.returnedRange, "observations.returnedRange");
  if (returnedRange.startSample < requestedRange.startSample || returnedRange.endSample > requestedRange.endSample) fail("returned range escapes the requested range");
  if (requestedRange.endMs - requestedRange.startMs > ACOUSTIC_LIMITS.maxRangeMs || requestedRange.endSample > sampleCount) fail("requested range exceeds source or hard limit");
  const statuses = new Set(["complete", "unavailable", "truncated", "failed"]);
  if (typeof item.status !== "string" || !statuses.has(item.status)) fail("observations.status is invalid");
  if (item.status === "complete" && JSON.stringify(requestedRange) !== JSON.stringify(returnedRange)) fail("complete evidence must return the exact requested range");
  if (!Array.isArray(item.observations) || item.observations.length > ACOUSTIC_LIMITS.maxItems) fail("observations exceed the item limit");
  let cursor = returnedRange.startSample;
  for (const [index, raw] of item.observations.entries()) {
    const observation = object(raw, `observations.observations[${index}]`);
    exact(observation, ["index", "startSample", "endSample", "startMs", "endMs", "classification", "confidence", "certainty", "reason"], `observations.observations[${index}]`);
    const startSample = integer(observation.startSample, `observation[${index}].startSample`);
    const endSample = integer(observation.endSample, `observation[${index}].endSample`, 1);
    if (observation.index !== index || startSample !== cursor || endSample <= startSample || endSample > returnedRange.endSample) fail("observation partition has a gap, overlap, or invalid index");
    if (observation.startMs !== Math.floor(startSample / 16) || observation.endMs !== Math.ceil(endSample / 16)) fail("observation millisecond range does not conservatively bound samples");
    if (!new Set(["speech_candidate", "music", "noise", "mixed", "unknown"]).has(observation.classification as string)) fail("observation classification is invalid");
    if (!new Set(["strong", "weak"]).has(observation.certainty as string)) fail("observation certainty is invalid");
    if (!new Set(["strong_single_family", "supported_speech_and_music", "below_threshold_or_margin", "insufficient_samples"]).has(observation.reason as string)) fail("observation reason is invalid");
    const confidence = object(observation.confidence, `observation[${index}].confidence`);
    exact(confidence, ["speechCandidate", "music", "noise", "winningScore", "margin"], `observation[${index}].confidence`);
    for (const key of ["speechCandidate", "music", "noise", "winningScore", "margin"] as const) finite(confidence[key], `observation[${index}].confidence.${key}`);
    if (observation.certainty === "weak" && observation.classification !== "unknown") fail("weak confidence cannot be upgraded to a definite class");
    if (observation.certainty === "strong" && observation.classification === "unknown") fail("strong confidence cannot retain an unknown class");
    const scores = [confidence.speechCandidate as number, confidence.music as number, confidence.noise as number].sort((left, right) => right - left);
    if (Math.abs((confidence.winningScore as number) - (scores[0] ?? 0)) > 1e-8 || Math.abs((confidence.margin as number) - ((scores[0] ?? 0) - (scores[1] ?? 0))) > 2e-8) fail("observation confidence winner or margin is inconsistent");
    if (observation.classification === "mixed" && ((confidence.speechCandidate as number) < ACOUSTIC_CONFIGURATION.supportThreshold || (confidence.music as number) < ACOUSTIC_CONFIGURATION.supportThreshold || observation.reason !== "supported_speech_and_music")) fail("mixed classification lacks supported speech and music scores");
    if (["speech_candidate", "music", "noise"].includes(observation.classification as string)) {
      const expectedWinner = (confidence.speechCandidate as number) >= (confidence.music as number) && (confidence.speechCandidate as number) >= (confidence.noise as number) ? "speech_candidate" : (confidence.music as number) >= (confidence.noise as number) ? "music" : "noise";
      if (observation.classification !== expectedWinner || (confidence.winningScore as number) < ACOUSTIC_CONFIGURATION.strongThreshold || (confidence.margin as number) < ACOUSTIC_CONFIGURATION.marginThreshold || observation.reason !== "strong_single_family") fail("definite classification does not meet its strong score and margin contract");
    }
    if (item.status === "complete" && (startSample !== requestedRange.startSample + index * 15_360 || endSample !== Math.min(requestedRange.endSample, startSample + 15_360))) fail("complete observations must use exact 15,360-sample cells");
    cursor = endSample;
  }
  if (item.status === "complete" && (item.observations.length === 0 || cursor !== returnedRange.endSample)) fail("complete evidence must be a full non-empty partition");
  if (item.status !== "complete" && cursor > returnedRange.endSample) fail("non-complete evidence exceeds its returned range");
  return value as AcousticObservations;
}

export function validateAcousticReceipt(value: unknown, observations?: AcousticObservations): AcousticTriageReceipt {
  const item = object(value, "receipt");
  exact(item, ["schema", "receiptId", "run", "input", "producer", "normalization", "configuration", "limits", "execution", "output", "determinism", "nonClaims"], "receipt");
  if (item.schema !== "studio.acoustic-triage.receipt.v1" || typeof item.receiptId !== "string" || !item.receiptId.startsWith("acoustic-triage:")) fail("receipt identity/schema is invalid");
  if (typeof item.run !== "string" || !item.run.trim()) fail("receipt.run is required");
  const receiptBody = structuredClone(item); delete receiptBody.schema; delete receiptBody.receiptId;
  if (item.receiptId !== `acoustic-triage:${canonicalSha256(receiptBody)}`) fail("receiptId does not match canonical receipt content");
  const input = object(item.input, "receipt.input"); exact(input, ["media", "normalizedAudio", "speechActivity", "requestedRange"], "receipt.input");
  const media = object(input.media, "receipt.input.media"); exact(media, ["path", "content", "trackIndex"], "receipt.input.media"); content(media.content, "receipt.input.media.content"); integer(media.trackIndex, "receipt.input.media.trackIndex");
  if (typeof media.path !== "string" || !media.path || media.path.startsWith("/") || media.path.split(/[\\/]/).includes("..")) fail("receipt media path must stay inside its preflight directory");
  const pcm = object(input.normalizedAudio, "receipt.input.normalizedAudio"); exact(pcm, ["path", "content", "sampleCount"], "receipt.input.normalizedAudio");
  if (pcm.path !== "speech-input.pcm") fail("receipt must use sealed speech PCM"); content(pcm.content, "receipt.input.normalizedAudio.content"); integer(pcm.sampleCount, "receipt.input.normalizedAudio.sampleCount", 1);
  const speech = object(input.speechActivity, "receipt.input.speechActivity"); exact(speech, ["path", "content"], "receipt.input.speechActivity"); if (speech.path !== "speech-activity.json") fail("speech receipt path changed"); content(speech.content, "receipt.input.speechActivity.content");
  const requested = range(input.requestedRange, "receipt.input.requestedRange");
  const producer = object(item.producer, "receipt.producer"); exact(producer, ["id", "version", "implementation", "model", "runtime"], "receipt.producer");
  if (producer.id !== "yamnet-acoustic-triage" || producer.version !== "1.0.0" || producer.implementation !== "scripts/detect-acoustics.mjs") fail("registered producer identity changed");
  const model = object(producer.model, "receipt.producer.model"); exact(model, ["id", "revision", "upstream", "license", "files"], "receipt.producer.model");
  if (model.id !== "qualcomm/YamNet" || model.revision !== "v0.58.0" || model.upstream !== "w-hc/torch_audioset@e8852c5" || model.license !== "MIT" || !Array.isArray(model.files) || model.files.length !== 5) fail("registered model identity changed");
  const modelPaths = ["vendor/yamnet/v0.58.0/yamnet.onnx", "vendor/yamnet/v0.58.0/yamnet.data", "vendor/yamnet/v0.58.0/LICENSE", "vendor/yamnet/v0.58.0/yamnet_class_map.csv", "vendor/yamnet/v0.58.0/ONTOLOGY_LICENSE"];
  for (const [index, raw] of model.files.entries()) { const file = object(raw, `receipt.producer.model.files[${index}]`); exact(file, ["path", "content"], `receipt.producer.model.files[${index}]`); if (file.path !== modelPaths[index]) fail("model file path or order changed"); content(file.content, `receipt.producer.model.files[${index}].content`); }
  const runtime = object(producer.runtime, "receipt.producer.runtime"); exact(runtime, ["id", "version", "executionProvider", "executionMode", "intraOpThreads", "interOpThreads", "binary", "platform"], "receipt.producer.runtime");
  if (runtime.id !== "onnxruntime-node" || runtime.version !== "1.27.0" || runtime.executionProvider !== "cpu" || runtime.executionMode !== "sequential" || runtime.intraOpThreads !== 1 || runtime.interOpThreads !== 1) fail("registered runtime identity changed");
  const binary = object(runtime.binary, "receipt.producer.runtime.binary"); exact(binary, ["path", "content"], "receipt.producer.runtime.binary"); content(binary.content, "receipt.producer.runtime.binary.content");
  if (typeof binary.path !== "string" || !binary.path.startsWith("node_modules/onnxruntime-node/bin/")) fail("runtime binary path changed");
  const platform = object(runtime.platform, "receipt.producer.runtime.platform"); exact(platform, ["os", "arch", "node"], "receipt.producer.runtime.platform");
  for (const key of ["os", "arch", "node"]) if (typeof platform[key] !== "string" || !(platform[key] as string).trim()) fail(`runtime platform ${key} is invalid`);
  const normalization = object(item.normalization, "receipt.normalization"); exact(normalization, ["contract", "sampleRateHz", "channels", "sampleFormat", "amplitudeScale", "featureExtraction", "windowSamples", "hopSamples", "fftSamples", "melBands", "melMinHz", "melMaxHz", "logOffset", "patchSamples", "patchFrames", "finalPatch"], "receipt.normalization");
  if (normalization.contract !== "sealed_speech_pcm_v1" || normalization.sampleRateHz !== 16000 || normalization.channels !== 1 || normalization.sampleFormat !== "s16le" || normalization.amplitudeScale !== "int16_div_32768" || normalization.featureExtraction !== "yamnet_vggish_log_mel_v1" || normalization.windowSamples !== 400 || normalization.hopSamples !== 160 || normalization.fftSamples !== 512 || normalization.melBands !== 64 || normalization.melMinHz !== 125 || normalization.melMaxHz !== 7500 || normalization.logOffset !== 0.001 || normalization.patchSamples !== 15360 || normalization.patchFrames !== 96 || normalization.finalPatch !== "right_zero_pad_and_mark_weak_below_min_samples") fail("normalization contract changed");
  if (JSON.stringify(item.configuration) !== JSON.stringify(ACOUSTIC_CONFIGURATION)) fail("classification configuration changed");
  const output = object(item.output, "receipt.output"); exact(output, ["path", "content", "status", "itemCount", "requestedRange", "returnedRange"], "receipt.output");
  if (output.path !== "acoustic-observations.json") fail("output path changed");
  const outputContent = content(output.content, "receipt.output.content");
  if (outputContent.bytes > ACOUSTIC_LIMITS.maxObservationBytes) fail("observation artifact exceeds its byte limit");
  range(output.requestedRange, "receipt.output.requestedRange"); range(output.returnedRange, "receipt.output.returnedRange");
  integer(output.itemCount, "receipt.output.itemCount");
  if (!new Set(["complete", "unavailable", "truncated", "failed"]).has(output.status as string)) fail("receipt output status is invalid");
  const execution = object(item.execution, "receipt.execution"); exact(execution, ["startedAt", "completedAt", "wallMs", "toolCalls", "decodedSamples"], "receipt.execution");
  if (typeof execution.startedAt !== "string" || typeof execution.completedAt !== "string" || !Number.isFinite(Date.parse(execution.startedAt)) || !Number.isFinite(Date.parse(execution.completedAt)) || Date.parse(execution.completedAt) < Date.parse(execution.startedAt)) fail("receipt execution timestamps are invalid");
  integer(execution.wallMs, "receipt.execution.wallMs"); integer(execution.decodedSamples, "receipt.execution.decodedSamples");
  if (execution.toolCalls !== 1 || (execution.wallMs as number) > ACOUSTIC_LIMITS.maxWallMs || (execution.decodedSamples as number) > ACOUSTIC_LIMITS.maxDecodedSamples) fail("receipt execution exceeded hard limits");
  if (JSON.stringify(item.limits) !== JSON.stringify(ACOUSTIC_LIMITS)) fail("receipt hard limits changed");
  if (observations) {
    if (JSON.stringify(requested) !== JSON.stringify(observations.requestedRange) || JSON.stringify(output.returnedRange) !== JSON.stringify(observations.returnedRange) || output.status !== observations.status || output.itemCount !== observations.observations.length) fail("receipt does not close over its observation body");
    if ((media.content as Record<string, unknown>).id !== observations.source.contentId || media.trackIndex !== observations.source.trackIndex || (pcm.content as Record<string, unknown>).id !== observations.normalization.content.id) fail("receipt input does not close over observation lineage");
  }
  return value as AcousticTriageReceipt;
}

export function sampleRangeFromMilliseconds(startMs: number, endMs: number): { startSample: number; endSample: number } {
  if (!Number.isSafeInteger(startMs) || !Number.isSafeInteger(endMs) || startMs < 0 || endMs <= startMs) fail("authorized range must be non-empty half-open integer milliseconds");
  return { startSample: startMs * (ACOUSTIC_SAMPLE_RATE_HZ / 1_000), endSample: endMs * (ACOUSTIC_SAMPLE_RATE_HZ / 1_000) };
}
