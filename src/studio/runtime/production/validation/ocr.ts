import { canonicalSha256 } from "../canonicalIdentity.ts";
import {
  OCR_LIMITS,
  type OcrArtifactState,
  type OcrBoundingBox,
  type OcrEvidenceCitationInput,
  type OcrGrantScope,
  type OcrLimits,
  type OcrObservations,
  type OcrProducerLineage,
  type OcrReceipt,
  type OcrRequest,
  type OcrRuntimeFileIdentity,
} from "../model.ts";
import {
  array,
  boolean,
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

const LIMIT_KEYS = Object.keys(OCR_LIMITS) as Array<keyof OcrLimits>;
const FRAME_STATES = new Set(["available", "empty", "unknown", "truncated"] as const);
const ARTIFACT_STATES = new Set<OcrArtifactState>(["available", "empty", "unknown", "truncated"]);
const REASONS = new Set([
  "hypotheses_emitted", "no_text_detected", "all_text_below_confidence", "conflicting_hypotheses_withheld", "output_limit_exceeded",
] as const);

export function normalizeOcrText(value: string): string {
  return value.normalize("NFC").replace(/\s+/gu, " ").trim();
}

export function validateOcrLimits(value: unknown, context: string, path: string): OcrLimits {
  const item = object(value, context, path);
  exact(item, LIMIT_KEYS, context, path);
  for (const key of LIMIT_KEYS) {
    const measured = integer(item[key], context, `${path}.${key}`, 1);
    if (measured !== OCR_LIMITS[key]) {
      fail(context, `${path}.${key}`, `must equal the registered U5 limit ${OCR_LIMITS[key]}`);
    }
  }
  return item as unknown as OcrLimits;
}

export function validateOcrGrantScope(value: unknown, context: string, path: string): OcrGrantScope {
  const item = object(value, context, path);
  exact(item, ["schema", "limits"], context, path);
  literal(item.schema, "studio.ocr-grant.v1", context, `${path}.schema`);
  validateOcrLimits(item.limits, context, `${path}.limits`);
  return item as unknown as OcrGrantScope;
}

export function assertOcrRequest(value: unknown, context = "OCR request"): asserts value is OcrRequest {
  const item = object(value, context, "request");
  exact(item, ["operationId", "taskId", "agentId", "grantId", "frameSamplingOperationId"], context, "request");
  for (const key of ["operationId", "taskId", "agentId", "grantId", "frameSamplingOperationId"]) {
    string(item[key], context, `request.${key}`);
  }
}

export function ocrRequestFingerprint(input: {
  sourceContentId: string;
  trackId: string;
  startMs: number;
  endMs: number;
  frameSamplingOperationId: string;
  frameIds: string[];
}): string {
  return `ocr-request:${canonicalSha256(input)}`;
}

export function ocrObservationId(input: {
  operationId: string;
  frameId: string;
  candidateIndex: number;
  boundingBox: OcrBoundingBox;
  normalizedText: string | null;
  confidence: number;
  state: "available" | "unknown";
  reason: "confidence_at_or_above_threshold" | "below_confidence_threshold" | "conflicting_hypotheses";
}): string {
  return `ocr-observation:${canonicalSha256(input)}`;
}

export function ocrReceiptId(value: Omit<OcrReceipt, "receiptId">): string {
  const { schema: _schema, ...body } = value;
  return `ocr-receipt:${canonicalSha256(body)}`;
}

function runtimeFile(value: unknown, context: string, path: string): OcrRuntimeFileIdentity {
  const item = object(value, context, path);
  exact(item, ["name", "content"], context, path);
  const name = string(item.name, context, `${path}.name`);
  hash(item.content, context, `${path}.content`);
  return { name, content: item.content as OcrRuntimeFileIdentity["content"] };
}

function runtimeFiles(value: unknown, context: string, path: string): OcrRuntimeFileIdentity[] {
  const files = array(value, context, path).map((entry, index) => runtimeFile(entry, context, `${path}[${index}]`));
  if (files.length === 0 || new Set(files.map((entry) => entry.name)).size !== files.length) {
    fail(context, path, "must identify a non-empty unique runtime file set");
  }
  return files;
}

export function validateOcrProducerLineage(value: unknown, context: string, path: string): OcrProducerLineage {
  const item = object(value, context, path);
  exact(item, ["schema", "adapter", "runtime", "models", "configuration"], context, path);
  literal(item.schema, "studio.ocr-producer-lineage.v1", context, `${path}.schema`);
  const adapter = object(item.adapter, context, `${path}.adapter`);
  exact(adapter, ["id", "version"], context, `${path}.adapter`);
  literal(adapter.id, "tesseract-js-ocr", context, `${path}.adapter.id`);
  literal(adapter.version, "1", context, `${path}.adapter.version`);
  const runtime = object(item.runtime, context, `${path}.runtime`);
  exact(runtime, ["package", "core", "featureDetection", "node"], context, `${path}.runtime`);
  for (const [key, name, version] of [["package", "tesseract.js", "7.0.0"], ["core", "tesseract.js-core", "7.0.0"], ["featureDetection", "wasm-feature-detect", "1.8.0"]] as const) {
    const found = object(runtime[key], context, `${path}.runtime.${key}`);
    exact(found, ["name", "version", "files"], context, `${path}.runtime.${key}`);
    literal(found.name, name, context, `${path}.runtime.${key}.name`);
    literal(found.version, version, context, `${path}.runtime.${key}.version`);
    runtimeFiles(found.files, context, `${path}.runtime.${key}.files`);
  }
  const node = object(runtime.node, context, `${path}.runtime.node`);
  exact(node, ["version", "platform", "arch"], context, `${path}.runtime.node`);
  string(node.version, context, `${path}.runtime.node.version`);
  string(node.platform, context, `${path}.runtime.node.platform`);
  string(node.arch, context, `${path}.runtime.node.arch`);
  const models = array(item.models, context, `${path}.models`);
  if (models.length !== 2) fail(context, `${path}.models`, "must contain the pinned Korean and English models");
  for (const [index, expectedLanguage] of ["kor", "eng"].entries()) {
    const model = object(models[index], context, `${path}.models[${index}]`);
    exact(model, ["language", "release", "commit", "repository", "license", "content"], context, `${path}.models[${index}]`);
    literal(model.language, expectedLanguage, context, `${path}.models[${index}].language`);
    literal(model.release, "4.1.0", context, `${path}.models[${index}].release`);
    literal(model.commit, "65727574dfcd264acbb0c3e07860e4e9e9b22185", context, `${path}.models[${index}].commit`);
    literal(model.repository, "https://github.com/tesseract-ocr/tessdata_fast", context, `${path}.models[${index}].repository`);
    literal(model.license, "Apache-2.0", context, `${path}.models[${index}].license`);
    hash(model.content, context, `${path}.models[${index}].content`);
  }
  const configuration = object(item.configuration, context, `${path}.configuration`);
  exact(configuration, ["languages", "engineMode", "pageSegmentationMode", "preserveInterwordSpaces", "trainedDataCache", "networkFetch", "textNormalization"], context, `${path}.configuration`);
  const languages = array(configuration.languages, context, `${path}.configuration.languages`);
  if (languages.length !== 2 || languages[0] !== "kor" || languages[1] !== "eng") fail(context, `${path}.configuration.languages`, "must equal kor, eng");
  literal(configuration.engineMode, "lstm_only", context, `${path}.configuration.engineMode`);
  literal(configuration.pageSegmentationMode, "auto", context, `${path}.configuration.pageSegmentationMode`);
  if (!boolean(configuration.preserveInterwordSpaces, context, `${path}.configuration.preserveInterwordSpaces`)) {
    fail(context, `${path}.configuration.preserveInterwordSpaces`, "must be enabled");
  }
  literal(configuration.trainedDataCache, "disabled", context, `${path}.configuration.trainedDataCache`);
  literal(configuration.networkFetch, "disabled", context, `${path}.configuration.networkFetch`);
  literal(configuration.textNormalization, "unicode_nfc_whitespace_collapse", context, `${path}.configuration.textNormalization`);
  return item as unknown as OcrProducerLineage;
}

function mediaRange(value: unknown, context: string, path: string): { startMs: number; endMs: number } {
  const item = object(value, context, path);
  exact(item, ["startMs", "endMs"], context, path);
  const startMs = integer(item.startMs, context, `${path}.startMs`);
  const endMs = integer(item.endMs, context, `${path}.endMs`, 1);
  if (endMs <= startMs) fail(context, path, "must be a non-empty range");
  return { startMs, endMs };
}

function source(value: unknown, context: string, path: string): void {
  const item = object(value, context, path);
  exact(item, ["artifactId", "contentId", "videoTrackId", "grantedRange"], context, path);
  string(item.artifactId, context, `${path}.artifactId`);
  contentId(item.contentId, context, `${path}.contentId`);
  string(item.videoTrackId, context, `${path}.videoTrackId`);
  mediaRange(item.grantedRange, context, `${path}.grantedRange`);
}

function frameSampling(value: unknown, context: string, path: string): void {
  const item = object(value, context, path);
  exact(item, ["operationId", "manifestArtifactId", "manifestContentId", "receiptId", "receiptArtifactId", "receiptContentId"], context, path);
  for (const key of ["operationId", "manifestArtifactId", "receiptId", "receiptArtifactId"]) string(item[key], context, `${path}.${key}`);
  contentId(item.manifestContentId, context, `${path}.manifestContentId`);
  contentId(item.receiptContentId, context, `${path}.receiptContentId`);
}

function nonClaims(value: unknown, context: string, path: string): void {
  const item = object(value, context, path);
  exact(item, ["textTruth", "identity", "spellingTruth", "translation", "culturalMeaning", "dialogueAuthority", "personIdentification"], context, path);
  literal(item.textTruth, "not_assessed", context, `${path}.textTruth`);
  literal(item.identity, "not_assessed", context, `${path}.identity`);
  literal(item.spellingTruth, "not_assessed", context, `${path}.spellingTruth`);
  literal(item.translation, "not_performed", context, `${path}.translation`);
  literal(item.culturalMeaning, "not_assessed", context, `${path}.culturalMeaning`);
  literal(item.dialogueAuthority, "not_granted", context, `${path}.dialogueAuthority`);
  literal(item.personIdentification, "not_performed", context, `${path}.personIdentification`);
}

function boundingBox(value: unknown, context: string, path: string, width: number, height: number): OcrBoundingBox {
  const item = object(value, context, path);
  exact(item, ["x0", "y0", "x1", "y1"], context, path);
  const x0 = integer(item.x0, context, `${path}.x0`);
  const y0 = integer(item.y0, context, `${path}.y0`);
  const x1 = integer(item.x1, context, `${path}.x1`, 1);
  const y1 = integer(item.y1, context, `${path}.y1`, 1);
  if (x1 <= x0 || y1 <= y0 || x1 > width || y1 > height) fail(context, path, "must be a non-empty box inside the frame");
  return { x0, y0, x1, y1 };
}

export function validateOcrObservations(value: unknown, context = "OCR observations", path = "observations"): OcrObservations {
  const item = object(value, context, path);
  exact(item, ["schema", "operationId", "runId", "source", "frameSampling", "producer", "limits", "state", "reason", "frames", "nonClaims"], context, path);
  literal(item.schema, "studio.ocr-observations.v1", context, `${path}.schema`);
  const operationId = string(item.operationId, context, `${path}.operationId`);
  string(item.runId, context, `${path}.runId`);
  source(item.source, context, `${path}.source`);
  frameSampling(item.frameSampling, context, `${path}.frameSampling`);
  validateOcrProducerLineage(item.producer, context, `${path}.producer`);
  validateOcrLimits(item.limits, context, `${path}.limits`);
  const state = oneOf<OcrArtifactState>(item.state, ARTIFACT_STATES, context, `${path}.state`);
  oneOf(item.reason, REASONS, context, `${path}.reason`);
  const frames = array(item.frames, context, `${path}.frames`);
  if (frames.length < 1 || frames.length > OCR_LIMITS.maxFrames) fail(context, `${path}.frames`, "exceeds the closed frame count");
  let totalBoxes = 0;
  let totalCodePoints = 0;
  const frameIds = new Set<string>();
  const observationIds = new Set<string>();
  for (const [frameIndex, frameValue] of frames.entries()) {
    const frame = object(frameValue, context, `${path}.frames[${frameIndex}]`);
    exact(frame, ["frameId", "frameArtifactId", "frameContentId", "requestedTimestampMs", "actualTimestampUs", "width", "height", "state", "reason", "observations"], context, `${path}.frames[${frameIndex}]`);
    const frameId = string(frame.frameId, context, `${path}.frames[${frameIndex}].frameId`);
    if (frameIds.has(frameId)) fail(context, `${path}.frames`, "must not repeat frame identities");
    frameIds.add(frameId);
    string(frame.frameArtifactId, context, `${path}.frames[${frameIndex}].frameArtifactId`);
    contentId(frame.frameContentId, context, `${path}.frames[${frameIndex}].frameContentId`);
    integer(frame.requestedTimestampMs, context, `${path}.frames[${frameIndex}].requestedTimestampMs`);
    integer(frame.actualTimestampUs, context, `${path}.frames[${frameIndex}].actualTimestampUs`);
    const width = integer(frame.width, context, `${path}.frames[${frameIndex}].width`, 1);
    const height = integer(frame.height, context, `${path}.frames[${frameIndex}].height`, 1);
    const frameState = oneOf(frame.state, FRAME_STATES, context, `${path}.frames[${frameIndex}].state`);
    const frameReason = oneOf(frame.reason, REASONS, context, `${path}.frames[${frameIndex}].reason`);
    const observations = array(frame.observations, context, `${path}.frames[${frameIndex}].observations`);
    if (observations.length > OCR_LIMITS.maxBoxesPerFrame) fail(context, `${path}.frames[${frameIndex}].observations`, "exceeds the per-frame box limit");
    if ((frameState === "empty" || frameState === "truncated") && observations.length !== 0) fail(context, `${path}.frames[${frameIndex}]`, "empty or truncated frames cannot leak partial text");
    for (const [observationIndex, observationValue] of observations.entries()) {
      const observationPath = `${path}.frames[${frameIndex}].observations[${observationIndex}]`;
      const observation = object(observationValue, context, observationPath);
      exact(observation, ["observationId", "frameId", "boundingBox", "normalizedText", "confidence", "state", "reason"], context, observationPath);
      const observationId = string(observation.observationId, context, `${observationPath}.observationId`);
      if (observationIds.has(observationId)) fail(context, `${path}.frames`, "must not repeat observation identities");
      observationIds.add(observationId);
      literal(observation.frameId, frameId, context, `${observationPath}.frameId`);
      const box = boundingBox(observation.boundingBox, context, `${observationPath}.boundingBox`, width, height);
      const confidence = integer(observation.confidence, context, `${observationPath}.confidence`);
      if (confidence > 100) fail(context, `${observationPath}.confidence`, "must not exceed 100");
      const observationState = oneOf<"available" | "unknown">(observation.state, new Set(["available", "unknown"] as const), context, `${observationPath}.state`);
      const reason = oneOf(observation.reason, new Set(["confidence_at_or_above_threshold", "below_confidence_threshold", "conflicting_hypotheses"] as const), context, `${observationPath}.reason`);
      const normalizedText = observation.normalizedText === null ? null : string(observation.normalizedText, context, `${observationPath}.normalizedText`);
      if (observationState === "available") {
        if (reason !== "confidence_at_or_above_threshold" || confidence < OCR_LIMITS.minConfidence || normalizedText === null || normalizedText !== normalizeOcrText(normalizedText)) fail(context, observationPath, "available OCR text must be normalized and meet the confidence threshold");
      } else if (normalizedText !== null ||
          (reason === "below_confidence_threshold" && confidence >= OCR_LIMITS.minConfidence) ||
          (reason !== "below_confidence_threshold" && reason !== "conflicting_hypotheses")) {
        fail(context, observationPath, "weak OCR text must be withheld as unknown");
      }
      const codePoints = normalizedText === null ? 0 : [...normalizedText].length;
      if (codePoints > OCR_LIMITS.maxTextCodePointsPerBox) fail(context, `${observationPath}.normalizedText`, "exceeds the per-box text limit");
      totalCodePoints += codePoints;
      totalBoxes += 1;
      const expectedId = ocrObservationId({ operationId, frameId, candidateIndex: observationIndex, boundingBox: box, normalizedText, confidence, state: observationState, reason });
      if (expectedId !== observationId) fail(context, `${observationPath}.observationId`, "does not close the hypothesis body");
    }
    const expectedFrameReason = frameState === "available" ? "hypotheses_emitted"
      : frameState === "empty" ? "no_text_detected"
        : frameState === "truncated" ? "output_limit_exceeded"
          : observations.some((entry) => (entry as { reason: string }).reason === "conflicting_hypotheses")
            ? "conflicting_hypotheses_withheld" : "all_text_below_confidence";
    if (frameReason !== expectedFrameReason) fail(context, `${path}.frames[${frameIndex}].reason`, "does not match the closed frame state");
  }
  if (totalBoxes > OCR_LIMITS.maxTotalBoxes || totalCodePoints > OCR_LIMITS.maxTotalTextCodePoints) fail(context, path, "exceeds aggregate OCR output limits");
  const derivedState: OcrArtifactState = frames.some((entry) => (entry as { state: string }).state === "truncated")
    ? "truncated"
    : frames.some((entry) => (entry as { state: string }).state === "available")
      ? "available"
      : frames.every((entry) => (entry as { state: string }).state === "empty") ? "empty" : "unknown";
  if (state !== derivedState) fail(context, `${path}.state`, "does not match the closed frame states");
  const expectedReason = state === "available" ? "hypotheses_emitted"
    : state === "empty" ? "no_text_detected"
      : state === "truncated" ? "output_limit_exceeded"
        : frames.some((entry) => (entry as { reason: string }).reason === "conflicting_hypotheses_withheld")
          ? "conflicting_hypotheses_withheld" : "all_text_below_confidence";
  if (item.reason !== expectedReason) fail(context, `${path}.reason`, "does not match the closed artifact state");
  nonClaims(item.nonClaims, context, `${path}.nonClaims`);
  return item as unknown as OcrObservations;
}

export function validateOcrReceipt(value: unknown, context = "OCR receipt", path = "receipt"): OcrReceipt {
  const item = object(value, context, path);
  exact(item, ["schema", "receiptId", "operationId", "capability", "authorization", "request", "input", "producer", "limits", "execution", "output", "nonClaims"], context, path);
  literal(item.schema, "studio.ocr-producer.receipt.v1", context, `${path}.schema`);
  string(item.receiptId, context, `${path}.receiptId`);
  string(item.operationId, context, `${path}.operationId`);
  literal(item.capability, "media.frames.ocr", context, `${path}.capability`);
  const authorization = object(item.authorization, context, `${path}.authorization`);
  exact(authorization, ["grantId", "taskId", "agentId", "executionId", "launchClaimId"], context, `${path}.authorization`);
  for (const key of ["grantId", "taskId", "agentId", "executionId", "launchClaimId"]) string(authorization[key], context, `${path}.authorization.${key}`);
  const request = object(item.request, context, `${path}.request`);
  exact(request, ["frameSamplingOperationId"], context, `${path}.request`);
  string(request.frameSamplingOperationId, context, `${path}.request.frameSamplingOperationId`);
  const input = object(item.input, context, `${path}.input`);
  exact(input, ["artifactId", "contentId", "videoTrackId", "grantedRange", "operationId", "manifestArtifactId", "manifestContentId", "receiptId", "receiptArtifactId", "receiptContentId", "frames"], context, `${path}.input`);
  source({ artifactId: input.artifactId, contentId: input.contentId, videoTrackId: input.videoTrackId, grantedRange: input.grantedRange }, context, `${path}.input.source`);
  frameSampling({ operationId: input.operationId, manifestArtifactId: input.manifestArtifactId, manifestContentId: input.manifestContentId, receiptId: input.receiptId, receiptArtifactId: input.receiptArtifactId, receiptContentId: input.receiptContentId }, context, `${path}.input.frameSampling`);
  const frames = array(input.frames, context, `${path}.input.frames`);
  if (frames.length < 1 || frames.length > OCR_LIMITS.maxFrames) fail(context, `${path}.input.frames`, "exceeds the closed frame count");
  let inputBytes = 0;
  for (const [index, frameValue] of frames.entries()) {
    const frame = object(frameValue, context, `${path}.input.frames[${index}]`);
    exact(frame, ["frameId", "artifactId", "contentId", "bytes", "actualTimestampUs"], context, `${path}.input.frames[${index}]`);
    string(frame.frameId, context, `${path}.input.frames[${index}].frameId`);
    string(frame.artifactId, context, `${path}.input.frames[${index}].artifactId`);
    contentId(frame.contentId, context, `${path}.input.frames[${index}].contentId`);
    const bytes = integer(frame.bytes, context, `${path}.input.frames[${index}].bytes`, 1);
    if (bytes > OCR_LIMITS.maxInputFrameBytes) fail(context, `${path}.input.frames[${index}].bytes`, "exceeds the per-frame input limit");
    inputBytes += bytes;
    integer(frame.actualTimestampUs, context, `${path}.input.frames[${index}].actualTimestampUs`);
  }
  if (inputBytes > OCR_LIMITS.maxTotalInputBytes) fail(context, `${path}.input.frames`, "exceeds the aggregate input limit");
  validateOcrProducerLineage(item.producer, context, `${path}.producer`);
  validateOcrLimits(item.limits, context, `${path}.limits`);
  const execution = object(item.execution, context, `${path}.execution`);
  exact(execution, ["wallMs", "measuredBeforeReceiptMs", "wallAccounting", "frameCount", "inputBytes", "emittedBoxes"], context, `${path}.execution`);
  const wallMs = integer(execution.wallMs, context, `${path}.execution.wallMs`, 1);
  const measured = integer(execution.measuredBeforeReceiptMs, context, `${path}.execution.measuredBeforeReceiptMs`);
  literal(execution.wallAccounting, "full_grant_charged_before_atomic_completion", context, `${path}.execution.wallAccounting`);
  if (wallMs > OCR_LIMITS.maxWallMs || measured > wallMs || integer(execution.frameCount, context, `${path}.execution.frameCount`, 1) !== frames.length || integer(execution.inputBytes, context, `${path}.execution.inputBytes`, 1) !== inputBytes || integer(execution.emittedBoxes, context, `${path}.execution.emittedBoxes`) > OCR_LIMITS.maxTotalBoxes) fail(context, `${path}.execution`, "exceeds or disagrees with the registered limits");
  const output = object(item.output, context, `${path}.output`);
  exact(output, ["artifactId", "contentId", "bytes", "state"], context, `${path}.output`);
  string(output.artifactId, context, `${path}.output.artifactId`);
  contentId(output.contentId, context, `${path}.output.contentId`);
  if (integer(output.bytes, context, `${path}.output.bytes`, 1) > OCR_LIMITS.maxObservationBytes) fail(context, `${path}.output.bytes`, "exceeds the observations byte limit");
  oneOf(output.state, ARTIFACT_STATES, context, `${path}.output.state`);
  nonClaims(item.nonClaims, context, `${path}.nonClaims`);
  const receipt = item as unknown as OcrReceipt;
  const { receiptId: _receiptId, ...withoutId } = receipt;
  if (receipt.receiptId !== ocrReceiptId(withoutId)) fail(context, `${path}.receiptId`, "does not close the receipt body");
  return receipt;
}

export function validateOcrEvidenceCitationInput(value: unknown, context: string, path: string): OcrEvidenceCitationInput {
  const item = object(value, context, path);
  exact(item, ["operationId", "artifactId", "contentId", "receiptArtifactId", "receiptId", "receiptContentId", "observationIds"], context, path);
  const result: OcrEvidenceCitationInput = {
    operationId: string(item.operationId, context, `${path}.operationId`),
    artifactId: string(item.artifactId, context, `${path}.artifactId`),
    contentId: contentId(item.contentId, context, `${path}.contentId`),
    receiptArtifactId: string(item.receiptArtifactId, context, `${path}.receiptArtifactId`),
    receiptId: string(item.receiptId, context, `${path}.receiptId`),
    receiptContentId: contentId(item.receiptContentId, context, `${path}.receiptContentId`),
    observationIds: uniqueStrings(item.observationIds, context, `${path}.observationIds`),
  };
  if (result.observationIds.length > OCR_LIMITS.maxTotalBoxes) fail(context, `${path}.observationIds`, "must remain inside the bounded OCR observation count");
  return result;
}
