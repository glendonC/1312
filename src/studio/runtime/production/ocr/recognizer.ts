import type { OcrBoundingBox, OcrFailureReason, OcrProducerLineage } from "../model.ts";
import type { VerifiedSampledFrame } from "../frameAudit.ts";

export interface OcrRecognizerCandidate {
  text: string;
  confidence: number;
  boundingBox: OcrBoundingBox;
}

export interface OcrRecognizerFrameResult {
  frameId: string;
  candidates: OcrRecognizerCandidate[];
}

export interface OcrRecognizerResult {
  lineage: OcrProducerLineage;
  frames: OcrRecognizerFrameResult[];
}

export interface OcrRecognizer {
  recognize(frames: readonly VerifiedSampledFrame[], deadlineAtMs: number): Promise<OcrRecognizerResult>;
  currentLineage(deadlineAtMs: number): Promise<OcrProducerLineage>;
}

export class OcrRecognizerFailure extends Error {
  readonly reason: Extract<OcrFailureReason, "model_unavailable" | "recognizer_timeout" | "recognizer_failed">;

  constructor(
    reason: Extract<OcrFailureReason, "model_unavailable" | "recognizer_timeout" | "recognizer_failed">,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "OcrRecognizerFailure";
    this.reason = reason;
  }
}
