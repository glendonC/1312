import type { SpeakerOverlapFailureReason, SpeakerOverlapProducerLineage } from "../model.ts";

export interface SpeakerDiarizerInput {
  pcm16: Buffer;
  sampleRateHz: 16_000;
}

export interface SpeakerDiarizerSegment {
  startMs: number;
  endMs: number;
  speakerCluster: number;
}

export interface SpeakerDiarizerResult {
  lineage: SpeakerOverlapProducerLineage;
  segments: SpeakerDiarizerSegment[];
}

/** Replaceable inference seam. The host owns labels, range accounting, receipts, and policy. */
export interface SpeakerDiarizer {
  diarize(input: SpeakerDiarizerInput, deadlineAtMs: number): Promise<SpeakerDiarizerResult>;
  currentLineage(deadlineAtMs: number): Promise<SpeakerOverlapProducerLineage>;
}

export class SpeakerDiarizerFailure extends Error {
  readonly reason: Extract<SpeakerOverlapFailureReason, "model_unavailable" | "diarizer_timeout" | "diarizer_failed">;

  constructor(
    reason: Extract<SpeakerOverlapFailureReason, "model_unavailable" | "diarizer_timeout" | "diarizer_failed">,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "SpeakerDiarizerFailure";
    this.reason = reason;
  }
}
