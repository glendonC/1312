import { canonicalSha256 } from "../canonicalIdentity.ts";
import {
  VISUAL_TRANSITION_LIMITS,
  VISUAL_TRANSITION_PRODUCER,
  type VisualTransitionEvidenceCitationInput,
  type VisualTransitionFrameIdentity,
  type VisualTransitionGrantScope,
  type VisualTransitionInterval,
  type VisualTransitionLimits,
  type VisualTransitionNonClaims,
  type VisualTransitionObservations,
  type VisualTransitionProducer,
  type VisualTransitionReceipt,
  type VisualTransitionRequest,
} from "../model/visualTransitions.ts";
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

const LIMIT_KEYS = Object.keys(VISUAL_TRANSITION_LIMITS) as Array<keyof VisualTransitionLimits>;

export function validateVisualTransitionLimits(value: unknown, context: string, path: string): VisualTransitionLimits {
  const item = object(value, context, path);
  exact(item, LIMIT_KEYS, context, path);
  for (const key of LIMIT_KEYS) {
    const measured = integer(item[key], context, `${path}.${key}`, 1);
    if (measured !== VISUAL_TRANSITION_LIMITS[key]) {
      fail(context, `${path}.${key}`, `must equal the registered visual-transition limit ${VISUAL_TRANSITION_LIMITS[key]}`);
    }
  }
  return item as unknown as VisualTransitionLimits;
}

export function validateVisualTransitionGrantScope(value: unknown, context: string, path: string): VisualTransitionGrantScope {
  const item = object(value, context, path);
  exact(item, ["schema", "limits"], context, path);
  literal(item.schema, "studio.visual-transition-grant.v1", context, `${path}.schema`);
  validateVisualTransitionLimits(item.limits, context, `${path}.limits`);
  return item as unknown as VisualTransitionGrantScope;
}

export function assertVisualTransitionRequest(value: unknown, context = "Visual-transition request"): asserts value is VisualTransitionRequest {
  const item = object(value, context, "request");
  exact(item, ["operationId", "taskId", "agentId", "grantId", "frameSamplingOperationId", "ocrOperationId"], context, "request");
  for (const key of ["operationId", "taskId", "agentId", "grantId", "frameSamplingOperationId", "ocrOperationId"]) {
    string(item[key], context, `request.${key}`);
  }
}

export function visualTransitionRequestFingerprint(input: {
  sourceContentId: string;
  trackId: string;
  startMs: number;
  endMs: number;
  frameSamplingOperationId: string;
  ocrOperationId: string;
  frameIds: string[];
  frameContentIds: string[];
}): string {
  return `visual-transition-request:${canonicalSha256(input)}`;
}

export function visualTransitionReceiptId(value: Omit<VisualTransitionReceipt, "receiptId">): string {
  const { schema: _schema, ...body } = value;
  return `visual-transition-receipt:${canonicalSha256(body)}`;
}

function mediaRange(value: unknown, context: string, path: string): { startMs: number; endMs: number } {
  const item = object(value, context, path);
  exact(item, ["startMs", "endMs"], context, path);
  const startMs = integer(item.startMs, context, `${path}.startMs`);
  const endMs = integer(item.endMs, context, `${path}.endMs`, 1);
  if (endMs <= startMs) fail(context, path, "must be a non-empty range");
  return { startMs, endMs };
}

function source(value: unknown, context: string, path: string): VisualTransitionObservations["source"] {
  const item = object(value, context, path);
  exact(item, ["artifactId", "contentId", "videoTrackId", "grantedRange"], context, path);
  return {
    artifactId: string(item.artifactId, context, `${path}.artifactId`),
    contentId: contentId(item.contentId, context, `${path}.contentId`),
    videoTrackId: string(item.videoTrackId, context, `${path}.videoTrackId`),
    grantedRange: mediaRange(item.grantedRange, context, `${path}.grantedRange`),
  };
}

function lineage(value: unknown, context: string, path: string, kind: "frameSampling" | "ocr") {
  const item = object(value, context, path);
  const keys = kind === "frameSampling"
    ? ["operationId", "manifestArtifactId", "manifestContentId", "receiptId", "receiptArtifactId", "receiptContentId"]
    : ["operationId", "observationsArtifactId", "observationsContentId", "receiptId", "receiptArtifactId", "receiptContentId"];
  exact(item, keys, context, path);
  for (const key of keys) {
    if (key.endsWith("ContentId")) contentId(item[key], context, `${path}.${key}`);
    else string(item[key], context, `${path}.${key}`);
  }
  return item;
}

function producer(value: unknown, context: string, path: string): VisualTransitionProducer {
  const item = object(value, context, path);
  exact(item, ["id", "version", "algorithm", "sampling", "candidateThresholdPpm", "ocrUse"], context, path);
  literal(item.id, VISUAL_TRANSITION_PRODUCER.id, context, `${path}.id`);
  literal(item.version, VISUAL_TRANSITION_PRODUCER.version, context, `${path}.version`);
  literal(item.algorithm, VISUAL_TRANSITION_PRODUCER.algorithm, context, `${path}.algorithm`);
  const sampling = object(item.sampling, context, `${path}.sampling`);
  exact(sampling, ["gridWidth", "gridHeight", "coordinateRule", "channels"], context, `${path}.sampling`);
  for (const key of ["gridWidth", "gridHeight"] as const) {
    if (integer(sampling[key], context, `${path}.sampling.${key}`, 1) !== VISUAL_TRANSITION_PRODUCER.sampling[key]) {
      fail(context, `${path}.sampling.${key}`, "changed the registered grid");
    }
  }
  literal(sampling.coordinateRule, VISUAL_TRANSITION_PRODUCER.sampling.coordinateRule, context, `${path}.sampling.coordinateRule`);
  literal(sampling.channels, VISUAL_TRANSITION_PRODUCER.sampling.channels, context, `${path}.sampling.channels`);
  if (integer(item.candidateThresholdPpm, context, `${path}.candidateThresholdPpm`, 1) !== VISUAL_TRANSITION_PRODUCER.candidateThresholdPpm) {
    fail(context, `${path}.candidateThresholdPpm`, "changed the registered candidate threshold");
  }
  literal(item.ocrUse, VISUAL_TRANSITION_PRODUCER.ocrUse, context, `${path}.ocrUse`);
  return item as unknown as VisualTransitionProducer;
}

function nonClaims(value: unknown, context: string, path: string): VisualTransitionNonClaims {
  const item = object(value, context, path);
  exact(item, ["sceneBoundary", "shotBoundary", "visualUnderstanding", "rightFrameSelection", "ocrTextTruth", "semanticCorrectness", "dialogueAuthority", "captionAuthority", "personIdentification"], context, path);
  for (const key of ["sceneBoundary", "shotBoundary", "visualUnderstanding", "rightFrameSelection", "ocrTextTruth", "semanticCorrectness"] as const) {
    literal(item[key], "not_assessed", context, `${path}.${key}`);
  }
  literal(item.dialogueAuthority, "not_granted", context, `${path}.dialogueAuthority`);
  literal(item.captionAuthority, "not_granted", context, `${path}.captionAuthority`);
  literal(item.personIdentification, "not_performed", context, `${path}.personIdentification`);
  return item as unknown as VisualTransitionNonClaims;
}

function frame(value: unknown, context: string, path: string): VisualTransitionFrameIdentity {
  const item = object(value, context, path);
  exact(item, ["frameId", "artifactId", "contentId", "bytes", "width", "height", "actualTimestampUs", "ocrState", "availableOcrHypothesisCount", "availableOcrHypothesisSetFingerprint"], context, path);
  const fingerprint = string(item.availableOcrHypothesisSetFingerprint, context, `${path}.availableOcrHypothesisSetFingerprint`);
  if (!/^ocr-hypothesis-set:[a-f0-9]{64}$/.test(fingerprint)) fail(context, `${path}.availableOcrHypothesisSetFingerprint`, "must be a closed OCR hypothesis-set fingerprint");
  return {
    frameId: string(item.frameId, context, `${path}.frameId`),
    artifactId: string(item.artifactId, context, `${path}.artifactId`),
    contentId: contentId(item.contentId, context, `${path}.contentId`),
    bytes: integer(item.bytes, context, `${path}.bytes`, 1),
    width: integer(item.width, context, `${path}.width`, 1),
    height: integer(item.height, context, `${path}.height`, 1),
    actualTimestampUs: integer(item.actualTimestampUs, context, `${path}.actualTimestampUs`),
    ocrState: oneOf(item.ocrState, new Set(["available", "empty", "unknown", "truncated"]), context, `${path}.ocrState`),
    availableOcrHypothesisCount: integer(item.availableOcrHypothesisCount, context, `${path}.availableOcrHypothesisCount`),
    availableOcrHypothesisSetFingerprint: fingerprint,
  };
}

function interval(
  value: unknown,
  operationId: string,
  index: number,
  before: VisualTransitionFrameIdentity,
  after: VisualTransitionFrameIdentity,
  grantedRange: { startMs: number; endMs: number },
  context: string,
  path: string,
): VisualTransitionInterval {
  const item = object(value, context, path);
  exact(item, ["intervalId", "index", "fromFrameId", "toFrameId", "startMs", "endMs", "pixelDifferencePpm", "classification", "ocrHypotheses"], context, path);
  if (integer(item.index, context, `${path}.index`) !== index) fail(context, `${path}.index`, "must preserve adjacent-frame order");
  literal(item.fromFrameId, before.frameId, context, `${path}.fromFrameId`);
  literal(item.toFrameId, after.frameId, context, `${path}.toFrameId`);
  const startMs = integer(item.startMs, context, `${path}.startMs`);
  const endMs = integer(item.endMs, context, `${path}.endMs`, 1);
  if (endMs <= startMs || startMs < grantedRange.startMs || endMs > grantedRange.endMs) fail(context, path, "must be a non-empty interval inside the granted range");
  const pixelDifferencePpm = integer(item.pixelDifferencePpm, context, `${path}.pixelDifferencePpm`);
  if (pixelDifferencePpm > 1_000_000) fail(context, `${path}.pixelDifferencePpm`, "must not exceed one million");
  const classification = oneOf<VisualTransitionInterval["classification"]>(item.classification, new Set(["visual_change_candidate", "below_visual_change_threshold"]), context, `${path}.classification`);
  const expectedClassification = pixelDifferencePpm >= VISUAL_TRANSITION_LIMITS.candidateThresholdPpm ? "visual_change_candidate" : "below_visual_change_threshold";
  if (classification !== expectedClassification) fail(context, `${path}.classification`, "must follow the registered pixel threshold");
  const ocr = object(item.ocrHypotheses, context, `${path}.ocrHypotheses`);
  exact(ocr, ["comparison", "beforeAvailableCount", "afterAvailableCount", "beforeSetFingerprint", "afterSetFingerprint"], context, `${path}.ocrHypotheses`);
  const beforeAvailableCount = integer(ocr.beforeAvailableCount, context, `${path}.ocrHypotheses.beforeAvailableCount`);
  const afterAvailableCount = integer(ocr.afterAvailableCount, context, `${path}.ocrHypotheses.afterAvailableCount`);
  if (beforeAvailableCount !== before.availableOcrHypothesisCount || afterAvailableCount !== after.availableOcrHypothesisCount) fail(context, `${path}.ocrHypotheses`, "changed the bound U5 available-hypothesis counts");
  literal(ocr.beforeSetFingerprint, before.availableOcrHypothesisSetFingerprint, context, `${path}.ocrHypotheses.beforeSetFingerprint`);
  literal(ocr.afterSetFingerprint, after.availableOcrHypothesisSetFingerprint, context, `${path}.ocrHypotheses.afterSetFingerprint`);
  const comparison = oneOf<VisualTransitionInterval["ocrHypotheses"]["comparison"]>(ocr.comparison, new Set(["changed", "unchanged", "unavailable"]), context, `${path}.ocrHypotheses.comparison`);
  const expectedComparison = beforeAvailableCount === 0 && afterAvailableCount === 0
    ? "unavailable"
    : before.availableOcrHypothesisSetFingerprint === after.availableOcrHypothesisSetFingerprint ? "unchanged" : "changed";
  if (comparison !== expectedComparison) fail(context, `${path}.ocrHypotheses.comparison`, "does not match the bound U5 hypothesis sets");
  const ocrHypotheses = {
    comparison,
    beforeAvailableCount,
    afterAvailableCount,
    beforeSetFingerprint: before.availableOcrHypothesisSetFingerprint,
    afterSetFingerprint: after.availableOcrHypothesisSetFingerprint,
  };
  const body = { operationId, index, fromFrameId: before.frameId, toFrameId: after.frameId, startMs, endMs, pixelDifferencePpm, candidateThresholdPpm: VISUAL_TRANSITION_LIMITS.candidateThresholdPpm, ocrHypotheses };
  const intervalId = string(item.intervalId, context, `${path}.intervalId`);
  if (intervalId !== `visual-transition-interval:${canonicalSha256(body)}`) fail(context, `${path}.intervalId`, "does not close the measured interval");
  return { intervalId, index, fromFrameId: before.frameId, toFrameId: after.frameId, startMs, endMs, pixelDifferencePpm, classification, ocrHypotheses };
}

export function validateVisualTransitionObservations(value: unknown, context = "Visual-transition observations", path = "observations"): VisualTransitionObservations {
  const item = object(value, context, path);
  exact(item, ["schema", "operationId", "runId", "source", "frameSampling", "ocr", "producer", "limits", "frames", "intervals", "nonClaims"], context, path);
  literal(item.schema, "studio.visual-transition-observations.v1", context, `${path}.schema`);
  const operationId = string(item.operationId, context, `${path}.operationId`);
  string(item.runId, context, `${path}.runId`);
  const parsedSource = source(item.source, context, `${path}.source`);
  lineage(item.frameSampling, context, `${path}.frameSampling`, "frameSampling");
  lineage(item.ocr, context, `${path}.ocr`, "ocr");
  producer(item.producer, context, `${path}.producer`);
  validateVisualTransitionLimits(item.limits, context, `${path}.limits`);
  const frames = array(item.frames, context, `${path}.frames`).map((entry, index) => frame(entry, context, `${path}.frames[${index}]`));
  if (frames.length < VISUAL_TRANSITION_LIMITS.minFrames || frames.length > VISUAL_TRANSITION_LIMITS.maxFrames || new Set(frames.map((entry) => entry.frameId)).size !== frames.length) fail(context, `${path}.frames`, "must contain the bounded unique ordered U2/U5 frame set");
  for (let index = 1; index < frames.length; index += 1) if (frames[index].actualTimestampUs <= frames[index - 1].actualTimestampUs) fail(context, `${path}.frames`, "must be ordered by actual presentation time");
  const intervals = array(item.intervals, context, `${path}.intervals`).map((entry, index) => interval(entry, operationId, index, frames[index], frames[index + 1], parsedSource.grantedRange, context, `${path}.intervals[${index}]`));
  if (intervals.length !== frames.length - 1) fail(context, `${path}.intervals`, "must account for every adjacent frame pair exactly once");
  nonClaims(item.nonClaims, context, `${path}.nonClaims`);
  return item as unknown as VisualTransitionObservations;
}

export function validateVisualTransitionReceipt(value: unknown, context = "Visual-transition receipt", path = "receipt"): VisualTransitionReceipt {
  const item = object(value, context, path);
  exact(item, ["schema", "receiptId", "operationId", "capability", "authorization", "request", "input", "producer", "limits", "execution", "output", "nonClaims"], context, path);
  literal(item.schema, "studio.visual-transition-producer.receipt.v1", context, `${path}.schema`);
  string(item.receiptId, context, `${path}.receiptId`);
  string(item.operationId, context, `${path}.operationId`);
  literal(item.capability, "media.visual-transitions.analyze", context, `${path}.capability`);
  const authorization = object(item.authorization, context, `${path}.authorization`);
  exact(authorization, ["grantId", "taskId", "agentId", "executionId", "launchClaimId"], context, `${path}.authorization`);
  for (const key of ["grantId", "taskId", "agentId", "executionId", "launchClaimId"]) string(authorization[key], context, `${path}.authorization.${key}`);
  const request = object(item.request, context, `${path}.request`);
  exact(request, ["frameSamplingOperationId", "ocrOperationId"], context, `${path}.request`);
  string(request.frameSamplingOperationId, context, `${path}.request.frameSamplingOperationId`);
  string(request.ocrOperationId, context, `${path}.request.ocrOperationId`);
  const input = object(item.input, context, `${path}.input`);
  exact(input, ["source", "frameSampling", "ocr", "frames"], context, `${path}.input`);
  source(input.source, context, `${path}.input.source`);
  lineage(input.frameSampling, context, `${path}.input.frameSampling`, "frameSampling");
  lineage(input.ocr, context, `${path}.input.ocr`, "ocr");
  const frames = array(input.frames, context, `${path}.input.frames`).map((entry, index) => frame(entry, context, `${path}.input.frames[${index}]`));
  producer(item.producer, context, `${path}.producer`);
  validateVisualTransitionLimits(item.limits, context, `${path}.limits`);
  const execution = object(item.execution, context, `${path}.execution`);
  exact(execution, ["wallMs", "measuredBeforeReceiptMs", "wallAccounting", "frameCount", "intervalCount", "inputBytes", "sampledRgbValues"], context, `${path}.execution`);
  const wallMs = integer(execution.wallMs, context, `${path}.execution.wallMs`, 1);
  const measuredBeforeReceiptMs = integer(execution.measuredBeforeReceiptMs, context, `${path}.execution.measuredBeforeReceiptMs`);
  literal(execution.wallAccounting, "full_grant_charged_before_atomic_completion", context, `${path}.execution.wallAccounting`);
  const inputBytes = frames.reduce((sum, entry) => sum + entry.bytes, 0);
  if (wallMs > VISUAL_TRANSITION_LIMITS.maxWallMs || measuredBeforeReceiptMs > wallMs ||
      integer(execution.frameCount, context, `${path}.execution.frameCount`, 1) !== frames.length ||
      integer(execution.intervalCount, context, `${path}.execution.intervalCount`, 1) !== frames.length - 1 ||
      integer(execution.inputBytes, context, `${path}.execution.inputBytes`, 1) !== inputBytes ||
      integer(execution.sampledRgbValues, context, `${path}.execution.sampledRgbValues`, 1) !== frames.length * VISUAL_TRANSITION_LIMITS.gridWidth * VISUAL_TRANSITION_LIMITS.gridHeight * 3) {
    fail(context, `${path}.execution`, "changed or exceeded measured bounded execution");
  }
  const output = object(item.output, context, `${path}.output`);
  exact(output, ["artifactId", "content", "intervalIds"], context, `${path}.output`);
  string(output.artifactId, context, `${path}.output.artifactId`);
  hash(output.content, context, `${path}.output.content`);
  const intervalIds = uniqueStrings(output.intervalIds, context, `${path}.output.intervalIds`);
  if (intervalIds.length !== frames.length - 1) fail(context, `${path}.output.intervalIds`, "must retain every adjacent interval identity");
  nonClaims(item.nonClaims, context, `${path}.nonClaims`);
  const receipt = item as unknown as VisualTransitionReceipt;
  const { receiptId: _receiptId, ...withoutId } = receipt;
  if (receipt.receiptId !== visualTransitionReceiptId(withoutId)) fail(context, `${path}.receiptId`, "does not close the receipt body");
  return receipt;
}

export function validateVisualTransitionEvidenceCitationInput(value: unknown, context: string, path: string): VisualTransitionEvidenceCitationInput {
  const item = object(value, context, path);
  exact(item, ["operationId", "observationsArtifactId", "observationsContentId", "receiptArtifactId", "receiptId", "receiptContentId", "intervalIds"], context, path);
  const intervalIds = uniqueStrings(item.intervalIds, context, `${path}.intervalIds`);
  if (intervalIds.length < 1 || intervalIds.length >= VISUAL_TRANSITION_LIMITS.maxFrames) {
    fail(context, `${path}.intervalIds`, "must retain the bounded non-empty adjacent interval set");
  }
  return {
    operationId: string(item.operationId, context, `${path}.operationId`),
    observationsArtifactId: string(item.observationsArtifactId, context, `${path}.observationsArtifactId`),
    observationsContentId: contentId(item.observationsContentId, context, `${path}.observationsContentId`),
    receiptArtifactId: string(item.receiptArtifactId, context, `${path}.receiptArtifactId`),
    receiptId: string(item.receiptId, context, `${path}.receiptId`),
    receiptContentId: contentId(item.receiptContentId, context, `${path}.receiptContentId`),
    intervalIds,
  };
}
