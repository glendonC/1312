import type {
  FrameDecoderLineage,
  FramePresentationTimestamp,
  FrameSamplingFailureReason,
  FrameVideoTrackProbe,
  MediaTrackDescriptor,
} from "../model.ts";

export class FrameDecoderFailure extends Error {
  readonly reason: FrameSamplingFailureReason;

  constructor(reason: FrameSamplingFailureReason, message: string, options: { cause?: unknown } = {}) {
    super(message, options);
    this.name = "FrameDecoderFailure";
    this.reason = reason;
  }
}

export interface DecodedFrame {
  path: string;
  requestedTimestampMs: number;
  actualPresentationTimestamp: FramePresentationTimestamp;
  width: number;
  height: number;
}

export interface FrameDecodeResult {
  lineage: FrameDecoderLineage;
  videoTrack: FrameVideoTrackProbe;
  frames: DecodedFrame[];
  decoderProcesses: number;
}

export interface FrameDecoder {
  sample(input: {
    sourcePath: string;
    registeredTrack: MediaTrackDescriptor;
    grantedRange: { startMs: number; endMs: number };
    requestedTimestampsMs: number[];
    outputDirectory: string;
    deadlineAtMs: number;
  }): Promise<FrameDecodeResult>;

  currentLineage(deadlineAtMs: number): Promise<FrameDecoderLineage>;

  /** Re-identifies every executable after the last decode process has exited. */
  verifyLineage(deadlineAtMs: number): Promise<{
    lineage: FrameDecoderLineage;
    decoderProcesses: number;
  }>;
}
