import { canonicalSha256 } from "../canonicalIdentity.ts";
import {
  FRAME_SAMPLING_LIMITS,
  type FrameDecoderLineage,
  type FramePresentationTimestamp,
  type FrameSampleManifest,
  type FrameSampleRequest,
  type FrameSamplingGrantScope,
  type FrameSamplingLimits,
  type FrameSamplingReceipt,
  type FrameTransformation,
  type FrameVideoTrackProbe,
  type SampledFrameIdentity,
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
  string,
} from "./primitives.ts";

const LIMIT_KEYS = Object.keys(FRAME_SAMPLING_LIMITS) as Array<keyof FrameSamplingLimits>;

export const FRAME_TRANSFORMATION: FrameTransformation = {
  displayMatrix: "apply_if_present",
  sampleAspectRatio: "reset_to_1_1",
  scale: "fit_without_upscale",
  maxWidthPx: 1_024,
  maxHeightPx: 1_024,
  pixelFormat: "rgb24",
  encoding: "png",
  mimeType: "image/png",
};

export function validateFrameSamplingLimits(
  value: unknown,
  context: string,
  path: string,
): FrameSamplingLimits {
  const item = object(value, context, path);
  exact(item, LIMIT_KEYS, context, path);
  for (const key of LIMIT_KEYS) {
    const measured = integer(item[key], context, `${path}.${key}`, 1);
    if (measured !== FRAME_SAMPLING_LIMITS[key]) {
      fail(context, `${path}.${key}`, `must equal the registered U2 limit ${FRAME_SAMPLING_LIMITS[key]}`);
    }
  }
  return item as unknown as FrameSamplingLimits;
}

export function validateFrameSamplingGrantScope(
  value: unknown,
  context: string,
  path: string,
): FrameSamplingGrantScope {
  const item = object(value, context, path);
  exact(item, ["schema", "limits"], context, path);
  literal(item.schema, "studio.frame-sampling-grant.v1", context, `${path}.schema`);
  validateFrameSamplingLimits(item.limits, context, `${path}.limits`);
  return item as unknown as FrameSamplingGrantScope;
}

function requestedTimestamps(value: unknown, context: string, path: string): number[] {
  const timestamps = array(value, context, path).map((entry, index) =>
    integer(entry, context, `${path}[${index}]`));
  if (timestamps.length < 1 || timestamps.length > FRAME_SAMPLING_LIMITS.maxFrames) {
    fail(context, path, `must contain 1-${FRAME_SAMPLING_LIMITS.maxFrames} timestamps`);
  }
  for (let index = 1; index < timestamps.length; index += 1) {
    if (timestamps[index] <= timestamps[index - 1]) {
      fail(context, path, "must be strictly increasing without duplicates");
    }
  }
  return timestamps;
}

export function assertFrameSampleRequest(
  value: unknown,
  context = "Frame sample request",
): asserts value is FrameSampleRequest {
  const item = object(value, context, "request");
  exact(item, ["operationId", "taskId", "agentId", "grantId", "requestedTimestampsMs"], context, "request");
  string(item.operationId, context, "request.operationId");
  string(item.taskId, context, "request.taskId");
  string(item.agentId, context, "request.agentId");
  string(item.grantId, context, "request.grantId");
  requestedTimestamps(item.requestedTimestampsMs, context, "request.requestedTimestampsMs");
}

function rational(value: unknown, context: string, path: string): { numerator: number; denominator: number } {
  const item = object(value, context, path);
  exact(item, ["numerator", "denominator"], context, path);
  const numerator = integer(item.numerator, context, `${path}.numerator`, 1);
  const denominator = integer(item.denominator, context, `${path}.denominator`, 1);
  return { numerator, denominator };
}

function presentationTimestamp(
  value: unknown,
  context: string,
  path: string,
): FramePresentationTimestamp {
  const item = object(value, context, path);
  exact(item, ["pts", "sourceStartPts", "timeBase", "microseconds"], context, path);
  const pts = integer(item.pts, context, `${path}.pts`);
  const sourceStartPts = integer(item.sourceStartPts, context, `${path}.sourceStartPts`);
  if (pts < sourceStartPts) fail(context, `${path}.pts`, "must not precede source start PTS");
  const timeBase = rational(item.timeBase, context, `${path}.timeBase`);
  const microseconds = integer(item.microseconds, context, `${path}.microseconds`);
  const expected = Math.round(((pts - sourceStartPts) * timeBase.numerator * 1_000_000) / timeBase.denominator);
  if (!Number.isSafeInteger(expected) || expected !== microseconds) {
    fail(context, path, "microseconds do not equal the exact decoder PTS and time base");
  }
  return { pts, sourceStartPts, timeBase, microseconds };
}

export function validateFrameTransformation(
  value: unknown,
  context: string,
  path: string,
): FrameTransformation {
  const item = object(value, context, path);
  exact(item, Object.keys(FRAME_TRANSFORMATION), context, path);
  for (const [key, expected] of Object.entries(FRAME_TRANSFORMATION)) {
    if (item[key] !== expected) fail(context, `${path}.${key}`, `must equal ${expected}`);
  }
  return item as unknown as FrameTransformation;
}

function executableIdentity(value: unknown, context: string, path: string): void {
  const item = object(value, context, path);
  exact(item, ["version", "binary"], context, path);
  string(item.version, context, `${path}.version`);
  hash(item.binary, context, `${path}.binary`);
}

export function validateFrameDecoderLineage(
  value: unknown,
  context: string,
  path: string,
): FrameDecoderLineage {
  const item = object(value, context, path);
  exact(item, ["schema", "adapter", "ffmpeg", "ffprobe", "platform", "transformation"], context, path);
  literal(item.schema, "studio.frame-decoder-lineage.v1", context, `${path}.schema`);
  const adapter = object(item.adapter, context, `${path}.adapter`);
  exact(adapter, ["id", "version"], context, `${path}.adapter`);
  literal(adapter.id, "ffmpeg-frame-decoder", context, `${path}.adapter.id`);
  literal(adapter.version, "1", context, `${path}.adapter.version`);
  executableIdentity(item.ffmpeg, context, `${path}.ffmpeg`);
  executableIdentity(item.ffprobe, context, `${path}.ffprobe`);
  const platform = object(item.platform, context, `${path}.platform`);
  exact(platform, ["os", "arch"], context, `${path}.platform`);
  string(platform.os, context, `${path}.platform.os`);
  string(platform.arch, context, `${path}.platform.arch`);
  validateFrameTransformation(item.transformation, context, `${path}.transformation`);
  return item as unknown as FrameDecoderLineage;
}

export function validateFrameVideoTrackProbe(
  value: unknown,
  context: string,
  path: string,
): FrameVideoTrackProbe {
  const item = object(value, context, path);
  exact(item, [
    "id", "index", "codec", "width", "height", "durationMs", "startPts", "timeBase",
    "sourceSampleAspectRatio", "displayMatrix",
  ], context, path);
  string(item.id, context, `${path}.id`);
  const index = integer(item.index, context, `${path}.index`);
  string(item.codec, context, `${path}.codec`);
  const width = integer(item.width, context, `${path}.width`, 1);
  const height = integer(item.height, context, `${path}.height`, 1);
  if (
    width > FRAME_SAMPLING_LIMITS.maxInputEdgePx ||
    height > FRAME_SAMPLING_LIMITS.maxInputEdgePx ||
    width * height > FRAME_SAMPLING_LIMITS.maxInputPixels
  ) fail(context, path, "exceeds the registered input dimension limits");
  const durationMs = item.durationMs === null
    ? null
    : integer(item.durationMs, context, `${path}.durationMs`, 1);
  const startPts = integer(item.startPts, context, `${path}.startPts`);
  const timeBase = rational(item.timeBase, context, `${path}.timeBase`);
  const sourceSampleAspectRatio = string(item.sourceSampleAspectRatio, context, `${path}.sourceSampleAspectRatio`);
  if (!/^\d+:\d+$/.test(sourceSampleAspectRatio)) {
    fail(context, `${path}.sourceSampleAspectRatio`, "must be a measured integer ratio");
  }
  const displayMatrix = object(item.displayMatrix, context, `${path}.displayMatrix`);
  exact(displayMatrix, ["present", "rotationDegrees"], context, `${path}.displayMatrix`);
  if (typeof displayMatrix.present !== "boolean") fail(context, `${path}.displayMatrix.present`, "must be boolean");
  const rotationDegrees = displayMatrix.rotationDegrees === null
    ? null
    : integer(displayMatrix.rotationDegrees, context, `${path}.displayMatrix.rotationDegrees`);
  if ((displayMatrix.present && rotationDegrees === null) || (!displayMatrix.present && rotationDegrees !== null)) {
    fail(context, `${path}.displayMatrix`, "must close display-matrix presence and measured rotation together");
  }
  return {
    id: item.id as string,
    index,
    codec: item.codec as string,
    width,
    height,
    durationMs,
    startPts,
    timeBase,
    sourceSampleAspectRatio,
    displayMatrix: { present: displayMatrix.present as boolean, rotationDegrees },
  };
}

function sampledFrame(
  value: unknown,
  context: string,
  path: string,
  grantedRange?: { startMs: number; endMs: number },
): SampledFrameIdentity {
  const item = object(value, context, path);
  exact(item, [
    "index", "frameId", "artifactId", "content", "requestedTimestampMs",
    "actualPresentationTimestamp", "width", "height", "mimeType", "transformation",
  ], context, path);
  const index = integer(item.index, context, `${path}.index`);
  const frameId = string(item.frameId, context, `${path}.frameId`);
  if (!frameId.startsWith("frame:")) fail(context, `${path}.frameId`, "must be a frame identity");
  const artifactId = string(item.artifactId, context, `${path}.artifactId`);
  if (!artifactId.startsWith("artifact:")) fail(context, `${path}.artifactId`, "must be an artifact identity");
  hash(item.content, context, `${path}.content`);
  const content = item.content as unknown as SampledFrameIdentity["content"];
  if (content.bytes > FRAME_SAMPLING_LIMITS.maxFrameBytes) fail(context, `${path}.content.bytes`, "exceeds the frame byte limit");
  const requestedTimestampMs = integer(item.requestedTimestampMs, context, `${path}.requestedTimestampMs`);
  const actualPresentationTimestamp = presentationTimestamp(item.actualPresentationTimestamp, context, `${path}.actualPresentationTimestamp`);
  const width = integer(item.width, context, `${path}.width`, 1);
  const height = integer(item.height, context, `${path}.height`, 1);
  if (
    width > FRAME_SAMPLING_LIMITS.maxOutputWidthPx ||
    height > FRAME_SAMPLING_LIMITS.maxOutputHeightPx ||
    width * height > FRAME_SAMPLING_LIMITS.maxOutputPixels
  ) fail(context, path, "exceeds the registered output dimension limits");
  literal(item.mimeType, "image/png", context, `${path}.mimeType`);
  const transformation = validateFrameTransformation(item.transformation, context, `${path}.transformation`);
  if (grantedRange && (
    requestedTimestampMs < grantedRange.startMs || requestedTimestampMs >= grantedRange.endMs ||
    actualPresentationTimestamp.microseconds < requestedTimestampMs * 1_000 ||
    actualPresentationTimestamp.microseconds >= grantedRange.endMs * 1_000
  )) fail(context, path, "requested or actual presentation timestamp escapes the granted range");
  return {
    index,
    frameId,
    artifactId,
    content,
    requestedTimestampMs,
    actualPresentationTimestamp,
    width,
    height,
    mimeType: "image/png",
    transformation,
  };
}

export function validateFrameSampleManifest(
  value: unknown,
  context = "Frame sample manifest",
  path = "manifest",
): FrameSampleManifest {
  const item = object(value, context, path);
  exact(item, ["schema", "operationId", "runId", "source", "videoTrack", "grantedRange", "requestedTimestampsMs", "frames"], context, path);
  literal(item.schema, "studio.frame-sample-manifest.v1", context, `${path}.schema`);
  string(item.operationId, context, `${path}.operationId`);
  string(item.runId, context, `${path}.runId`);
  const source = object(item.source, context, `${path}.source`);
  exact(source, ["artifactId", "contentId"], context, `${path}.source`);
  string(source.artifactId, context, `${path}.source.artifactId`);
  contentId(source.contentId, context, `${path}.source.contentId`);
  validateFrameVideoTrackProbe(item.videoTrack, context, `${path}.videoTrack`);
  const grantedRange = object(item.grantedRange, context, `${path}.grantedRange`);
  exact(grantedRange, ["startMs", "endMs"], context, `${path}.grantedRange`);
  const startMs = integer(grantedRange.startMs, context, `${path}.grantedRange.startMs`);
  const endMs = integer(grantedRange.endMs, context, `${path}.grantedRange.endMs`, 1);
  if (endMs <= startMs || endMs - startMs > FRAME_SAMPLING_LIMITS.maxDurationMs) {
    fail(context, `${path}.grantedRange`, "is empty or exceeds the frame duration limit");
  }
  const timestamps = requestedTimestamps(item.requestedTimestampsMs, context, `${path}.requestedTimestampsMs`);
  const frames = array(item.frames, context, `${path}.frames`).map((entry, index) =>
    sampledFrame(entry, context, `${path}.frames[${index}]`, { startMs, endMs }));
  if (frames.length !== timestamps.length) fail(context, `${path}.frames`, "must close every requested timestamp");
  let totalBytes = 0;
  for (const [index, frame] of frames.entries()) {
    if (frame.index !== index || frame.requestedTimestampMs !== timestamps[index]) {
      fail(context, `${path}.frames[${index}]`, "index or requested timestamp changed");
    }
    if (index > 0 && frame.actualPresentationTimestamp.microseconds <= frames[index - 1].actualPresentationTimestamp.microseconds) {
      fail(context, `${path}.frames`, "actual presentation timestamps must be unique and increasing");
    }
    totalBytes += frame.content.bytes;
  }
  if (totalBytes > FRAME_SAMPLING_LIMITS.maxTotalFrameBytes) fail(context, `${path}.frames`, "exceed the aggregate byte limit");
  if (new Set(frames.map((frame) => frame.frameId)).size !== frames.length ||
      new Set(frames.map((frame) => frame.artifactId)).size !== frames.length) {
    fail(context, `${path}.frames`, "must contain unique frame and artifact identities");
  }
  return item as unknown as FrameSampleManifest;
}

export function frameSamplingReceiptId(value: Omit<FrameSamplingReceipt, "receiptId">): string {
  const { schema: _schema, ...body } = value;
  return `frame-sampling:${canonicalSha256(body)}`;
}

export function frameSamplingRequestFingerprint(input: {
  sourceContentId: string;
  trackId: string;
  startMs: number;
  endMs: number;
  requestedTimestampsMs: number[];
}): string {
  return `frame-request:${canonicalSha256({ ...input, transformation: FRAME_TRANSFORMATION })}`;
}

export function validateFrameSamplingReceipt(
  value: unknown,
  context = "Frame sampling receipt",
  path = "receipt",
): FrameSamplingReceipt {
  const item = object(value, context, path);
  exact(item, ["schema", "receiptId", "operationId", "capability", "authorization", "request", "source", "decoder", "limits", "execution", "output", "nonClaims"], context, path);
  literal(item.schema, "studio.frame-sampling.receipt.v1", context, `${path}.schema`);
  string(item.receiptId, context, `${path}.receiptId`);
  string(item.operationId, context, `${path}.operationId`);
  literal(item.capability, "media.frames.sample", context, `${path}.capability`);
  const authorization = object(item.authorization, context, `${path}.authorization`);
  exact(authorization, ["grantId", "taskId", "agentId", "executionId", "launchClaimId"], context, `${path}.authorization`);
  for (const key of ["grantId", "taskId", "agentId", "executionId", "launchClaimId"]) string(authorization[key], context, `${path}.authorization.${key}`);
  const request = object(item.request, context, `${path}.request`);
  exact(request, ["requestedTimestampsMs"], context, `${path}.request`);
  const timestamps = requestedTimestamps(request.requestedTimestampsMs, context, `${path}.request.requestedTimestampsMs`);
  const source = object(item.source, context, `${path}.source`);
  exact(source, ["artifactId", "contentId", "videoTrack", "grantedRange"], context, `${path}.source`);
  string(source.artifactId, context, `${path}.source.artifactId`);
  contentId(source.contentId, context, `${path}.source.contentId`);
  validateFrameVideoTrackProbe(source.videoTrack, context, `${path}.source.videoTrack`);
  const grantedRange = object(source.grantedRange, context, `${path}.source.grantedRange`);
  exact(grantedRange, ["startMs", "endMs"], context, `${path}.source.grantedRange`);
  const startMs = integer(grantedRange.startMs, context, `${path}.source.grantedRange.startMs`);
  const endMs = integer(grantedRange.endMs, context, `${path}.source.grantedRange.endMs`, 1);
  if (endMs <= startMs || endMs - startMs > FRAME_SAMPLING_LIMITS.maxDurationMs) fail(context, `${path}.source.grantedRange`, "is outside the registered duration limit");
  validateFrameDecoderLineage(item.decoder, context, `${path}.decoder`);
  validateFrameSamplingLimits(item.limits, context, `${path}.limits`);
  const execution = object(item.execution, context, `${path}.execution`);
  exact(execution, [
    "wallMs", "measuredBeforeReceiptMs", "wallAccounting", "decoderProcesses", "frameCount", "totalFrameBytes",
  ], context, `${path}.execution`);
  const wallMs = integer(execution.wallMs, context, `${path}.execution.wallMs`);
  const measuredBeforeReceiptMs = integer(
    execution.measuredBeforeReceiptMs,
    context,
    `${path}.execution.measuredBeforeReceiptMs`,
  );
  literal(
    execution.wallAccounting,
    "full_grant_charged_before_atomic_completion",
    context,
    `${path}.execution.wallAccounting`,
  );
  const decoderProcesses = integer(execution.decoderProcesses, context, `${path}.execution.decoderProcesses`, 1);
  const frameCount = integer(execution.frameCount, context, `${path}.execution.frameCount`, 1);
  const totalFrameBytes = integer(execution.totalFrameBytes, context, `${path}.execution.totalFrameBytes`, 1);
  if (
    wallMs > FRAME_SAMPLING_LIMITS.maxWallMs ||
    frameCount !== timestamps.length ||
    measuredBeforeReceiptMs > wallMs ||
    decoderProcesses !== frameCount + 5 ||
    totalFrameBytes > FRAME_SAMPLING_LIMITS.maxTotalFrameBytes
  ) {
    fail(context, `${path}.execution`, "exceeds or disagrees with the registered execution limits");
  }
  const output = object(item.output, context, `${path}.output`);
  exact(output, ["manifestArtifactId", "manifestContentId", "manifestBytes", "frames"], context, `${path}.output`);
  string(output.manifestArtifactId, context, `${path}.output.manifestArtifactId`);
  contentId(output.manifestContentId, context, `${path}.output.manifestContentId`);
  const manifestBytes = integer(output.manifestBytes, context, `${path}.output.manifestBytes`, 1);
  if (manifestBytes > FRAME_SAMPLING_LIMITS.maxManifestBytes) fail(context, `${path}.output.manifestBytes`, "exceeds the manifest byte limit");
  const frames = array(output.frames, context, `${path}.output.frames`).map((entry, index) => sampledFrame(entry, context, `${path}.output.frames[${index}]`, { startMs, endMs }));
  if (frames.length !== frameCount || frames.reduce((sum, frame) => sum + frame.content.bytes, 0) !== totalFrameBytes) {
    fail(context, `${path}.output.frames`, "do not close the execution accounting");
  }
  for (const [index, frame] of frames.entries()) {
    if (frame.index !== index || frame.requestedTimestampMs !== timestamps[index]) fail(context, `${path}.output.frames[${index}]`, "does not close the request");
  }
  const nonClaims = object(item.nonClaims, context, `${path}.nonClaims`);
  exact(nonClaims, ["visualUnderstanding", "sceneUnderstanding", "rightFrameSelection", "ocr"], context, `${path}.nonClaims`);
  literal(nonClaims.visualUnderstanding, "not_assessed", context, `${path}.nonClaims.visualUnderstanding`);
  literal(nonClaims.sceneUnderstanding, "not_assessed", context, `${path}.nonClaims.sceneUnderstanding`);
  literal(nonClaims.rightFrameSelection, "not_assessed", context, `${path}.nonClaims.rightFrameSelection`);
  literal(nonClaims.ocr, "not_performed", context, `${path}.nonClaims.ocr`);
  const receipt = item as unknown as FrameSamplingReceipt;
  const { receiptId: _receiptId, ...withoutReceiptId } = receipt;
  if (receipt.receiptId !== frameSamplingReceiptId(withoutReceiptId)) fail(context, `${path}.receiptId`, "does not match canonical receipt content");
  return receipt;
}
