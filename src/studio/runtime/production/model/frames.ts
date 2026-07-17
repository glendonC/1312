import type { ContentIdentity } from "./source.ts";

export const FRAME_HOST_ARTIFACT_KINDS = [
  "sampled-video-frame",
  "studio.frame-sample-manifest.v1",
  "studio.frame-sampling.receipt.v1",
] as const;

export function isFrameHostArtifactKind(value: string): boolean {
  return (FRAME_HOST_ARTIFACT_KINDS as readonly string[]).includes(value);
}

export const FRAME_SAMPLING_LIMITS = {
  maxDurationMs: 30_000,
  maxFrames: 8,
  maxInputEdgePx: 8_192,
  maxInputPixels: 33_177_600,
  maxOutputWidthPx: 1_024,
  maxOutputHeightPx: 1_024,
  maxOutputPixels: 1_048_576,
  maxFrameBytes: 2 * 1024 * 1024,
  maxTotalFrameBytes: 8 * 1024 * 1024,
  maxManifestBytes: 256 * 1024,
  maxReceiptBytes: 256 * 1024,
  maxWallMs: 20_000,
  maxCalls: 1,
} as const;

export interface FrameSamplingLimits {
  maxDurationMs: number;
  maxFrames: number;
  maxInputEdgePx: number;
  maxInputPixels: number;
  maxOutputWidthPx: number;
  maxOutputHeightPx: number;
  maxOutputPixels: number;
  maxFrameBytes: number;
  maxTotalFrameBytes: number;
  maxManifestBytes: number;
  maxReceiptBytes: number;
  maxWallMs: number;
  maxCalls: number;
}

/** Additive, frame-only scheduler envelope. Existing capability grants retain their closed shape. */
export interface FrameSamplingGrantScope {
  schema: "studio.frame-sampling-grant.v1";
  limits: FrameSamplingLimits;
}

/** Host-facing request. The task-private bridge injects every field except requestedTimestampsMs. */
export interface FrameSampleRequest {
  operationId: string;
  taskId: string;
  agentId: string;
  grantId: string;
  requestedTimestampsMs: number[];
}

export interface FramePresentationTimestamp {
  pts: number;
  sourceStartPts: number;
  timeBase: { numerator: number; denominator: number };
  /** Source-relative presentation time derived from (pts - sourceStartPts) and timeBase. */
  microseconds: number;
}

export interface FrameTransformation {
  displayMatrix: "apply_if_present";
  sampleAspectRatio: "reset_to_1_1";
  scale: "fit_without_upscale";
  maxWidthPx: 1_024;
  maxHeightPx: 1_024;
  pixelFormat: "rgb24";
  encoding: "png";
  mimeType: "image/png";
}

export interface FrameDecoderExecutableIdentity {
  version: string;
  binary: ContentIdentity;
}

export interface FrameDecoderLineage {
  schema: "studio.frame-decoder-lineage.v1";
  adapter: { id: "ffmpeg-frame-decoder"; version: "1" };
  ffmpeg: FrameDecoderExecutableIdentity;
  ffprobe: FrameDecoderExecutableIdentity;
  platform: { os: string; arch: string };
  transformation: FrameTransformation;
}

export interface FrameVideoTrackProbe {
  id: string;
  index: number;
  codec: string;
  width: number;
  height: number;
  durationMs: number | null;
  startPts: number;
  timeBase: { numerator: number; denominator: number };
  sourceSampleAspectRatio: string;
  displayMatrix: { present: boolean; rotationDegrees: number | null };
}

export interface SampledFrameIdentity {
  index: number;
  frameId: string;
  artifactId: string;
  content: ContentIdentity;
  requestedTimestampMs: number;
  actualPresentationTimestamp: FramePresentationTimestamp;
  width: number;
  height: number;
  mimeType: "image/png";
  transformation: FrameTransformation;
}

export interface FrameSampleManifest {
  schema: "studio.frame-sample-manifest.v1";
  operationId: string;
  runId: string;
  source: { artifactId: string; contentId: string };
  videoTrack: FrameVideoTrackProbe;
  grantedRange: { startMs: number; endMs: number };
  requestedTimestampsMs: number[];
  frames: SampledFrameIdentity[];
}

export interface FrameSamplingReceipt {
  schema: "studio.frame-sampling.receipt.v1";
  receiptId: string;
  operationId: string;
  capability: "media.frames.sample";
  authorization: {
    grantId: string;
    taskId: string;
    agentId: string;
    executionId: string;
    launchClaimId: string;
  };
  request: { requestedTimestampsMs: number[] };
  source: {
    artifactId: string;
    contentId: string;
    videoTrack: FrameVideoTrackProbe;
    grantedRange: { startMs: number; endMs: number };
  };
  decoder: FrameDecoderLineage;
  limits: FrameSamplingLimits;
  execution: {
    /** Conservative accounting: every successful call is charged its entire authorized wall grant. */
    wallMs: number;
    measuredBeforeReceiptMs: number;
    wallAccounting: "full_grant_charged_before_atomic_completion";
    decoderProcesses: number;
    frameCount: number;
    totalFrameBytes: number;
  };
  output: {
    manifestArtifactId: string;
    manifestContentId: string;
    manifestBytes: number;
    frames: SampledFrameIdentity[];
  };
  nonClaims: {
    visualUnderstanding: "not_assessed";
    sceneUnderstanding: "not_assessed";
    rightFrameSelection: "not_assessed";
    ocr: "not_performed";
  };
}

export type FrameSamplingFailureReason =
  | "source_drift"
  | "video_track_unavailable"
  | "frame_unavailable"
  | "duplicate_actual_frame"
  | "decoded_frame_oversized"
  | "decoder_timeout"
  | "decoder_failed";

export interface FrameSampleRecord {
  id: string;
  taskId: string;
  agentId: string;
  grantId: string;
  executionId: string;
  launchClaimId: string;
  sourceArtifactId: string;
  trackId: string;
  startMs: number;
  endMs: number;
  requestedTimestampsMs: number[];
  requestFingerprint: string;
  limits: FrameSamplingLimits;
  status: "started" | "completed" | "failed";
  manifestArtifactId: string | null;
  receiptArtifactId: string | null;
  receiptId: string | null;
  receiptContentId: string | null;
  frameArtifactIds: string[];
  failure: FrameSamplingFailureReason | null;
}
