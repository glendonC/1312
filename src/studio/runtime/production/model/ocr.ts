import type { ContentIdentity } from "./source.ts";

export const OCR_HOST_ARTIFACT_KINDS = [
  "studio.ocr-observations.v1",
  "studio.ocr-producer.receipt.v1",
] as const;

export function isOcrHostArtifactKind(value: string): boolean {
  return (OCR_HOST_ARTIFACT_KINDS as readonly string[]).includes(value);
}

export const OCR_LIMITS = {
  maxFrames: 4,
  maxBoxesPerFrame: 64,
  maxTotalBoxes: 128,
  maxInputFrameBytes: 2 * 1024 * 1024,
  maxTotalInputBytes: 8 * 1024 * 1024,
  maxTextCodePointsPerBox: 256,
  maxTotalTextCodePoints: 4_096,
  maxObservationBytes: 256 * 1024,
  maxReceiptBytes: 256 * 1024,
  maxWallMs: 45_000,
  maxCalls: 1,
  minConfidence: 70,
} as const;

export interface OcrLimits {
  maxFrames: number;
  maxBoxesPerFrame: number;
  maxTotalBoxes: number;
  maxInputFrameBytes: number;
  maxTotalInputBytes: number;
  maxTextCodePointsPerBox: number;
  maxTotalTextCodePoints: number;
  maxObservationBytes: number;
  maxReceiptBytes: number;
  maxWallMs: number;
  maxCalls: number;
  minConfidence: number;
}

export interface OcrGrantScope {
  schema: "studio.ocr-grant.v1";
  limits: OcrLimits;
}

/** The task-private bridge injects every field except the completed U2 frame operation identity. */
export interface OcrRequest {
  operationId: string;
  taskId: string;
  agentId: string;
  grantId: string;
  frameSamplingOperationId: string;
}

export interface OcrBoundingBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export type OcrObservationState = "available" | "unknown";
export type OcrFrameState = "available" | "empty" | "unknown" | "truncated";
export type OcrArtifactState = "available" | "empty" | "unknown" | "truncated";

export interface OcrTextHypothesis {
  observationId: string;
  frameId: string;
  boundingBox: OcrBoundingBox;
  /** Withheld for weak output. Never contains low-confidence recognizer text. */
  normalizedText: string | null;
  confidence: number;
  state: OcrObservationState;
  reason: "confidence_at_or_above_threshold" | "below_confidence_threshold" | "conflicting_hypotheses";
}

export interface OcrFrameObservations {
  frameId: string;
  frameArtifactId: string;
  frameContentId: string;
  requestedTimestampMs: number;
  actualTimestampUs: number;
  width: number;
  height: number;
  state: OcrFrameState;
  reason: "hypotheses_emitted" | "no_text_detected" | "all_text_below_confidence" | "conflicting_hypotheses_withheld" | "output_limit_exceeded";
  observations: OcrTextHypothesis[];
}

export interface OcrRuntimeFileIdentity {
  name: string;
  content: ContentIdentity;
}

export interface OcrProducerLineage {
  schema: "studio.ocr-producer-lineage.v1";
  adapter: { id: "tesseract-js-ocr"; version: "1" };
  runtime: {
    package: { name: "tesseract.js"; version: "7.0.0"; files: OcrRuntimeFileIdentity[] };
    core: { name: "tesseract.js-core"; version: "7.0.0"; files: OcrRuntimeFileIdentity[] };
    featureDetection: { name: "wasm-feature-detect"; version: "1.8.0"; files: OcrRuntimeFileIdentity[] };
    node: { version: string; platform: string; arch: string };
  };
  models: Array<{
    language: "kor" | "eng";
    release: "4.1.0";
    commit: "65727574dfcd264acbb0c3e07860e4e9e9b22185";
    repository: "https://github.com/tesseract-ocr/tessdata_fast";
    license: "Apache-2.0";
    content: ContentIdentity;
  }>;
  configuration: {
    languages: ["kor", "eng"];
    engineMode: "lstm_only";
    pageSegmentationMode: "auto";
    preserveInterwordSpaces: true;
    trainedDataCache: "disabled";
    networkFetch: "disabled";
    textNormalization: "unicode_nfc_whitespace_collapse";
  };
}

export interface OcrObservations {
  schema: "studio.ocr-observations.v1";
  operationId: string;
  runId: string;
  source: {
    artifactId: string;
    contentId: string;
    videoTrackId: string;
    grantedRange: { startMs: number; endMs: number };
  };
  frameSampling: {
    operationId: string;
    manifestArtifactId: string;
    manifestContentId: string;
    receiptId: string;
    receiptArtifactId: string;
    receiptContentId: string;
  };
  producer: OcrProducerLineage;
  limits: OcrLimits;
  state: OcrArtifactState;
  reason: "hypotheses_emitted" | "no_text_detected" | "all_text_below_confidence" | "conflicting_hypotheses_withheld" | "output_limit_exceeded";
  frames: OcrFrameObservations[];
  nonClaims: {
    textTruth: "not_assessed";
    identity: "not_assessed";
    spellingTruth: "not_assessed";
    translation: "not_performed";
    culturalMeaning: "not_assessed";
    dialogueAuthority: "not_granted";
    personIdentification: "not_performed";
  };
}

export interface OcrReceipt {
  schema: "studio.ocr-producer.receipt.v1";
  receiptId: string;
  operationId: string;
  capability: "media.frames.ocr";
  authorization: {
    grantId: string;
    taskId: string;
    agentId: string;
    executionId: string;
    launchClaimId: string;
  };
  request: { frameSamplingOperationId: string };
  input: OcrObservations["source"] & OcrObservations["frameSampling"] & {
    frames: Array<{
      frameId: string;
      artifactId: string;
      contentId: string;
      bytes: number;
      actualTimestampUs: number;
    }>;
  };
  producer: OcrProducerLineage;
  limits: OcrLimits;
  execution: {
    wallMs: number;
    measuredBeforeReceiptMs: number;
    wallAccounting: "full_grant_charged_before_atomic_completion";
    frameCount: number;
    inputBytes: number;
    emittedBoxes: number;
  };
  output: {
    artifactId: string;
    contentId: string;
    bytes: number;
    state: OcrArtifactState;
  };
  nonClaims: OcrObservations["nonClaims"];
}

export type OcrFailureReason =
  | "frame_lineage_unavailable"
  | "input_oversized"
  | "model_unavailable"
  | "runtime_drift"
  | "recognizer_timeout"
  | "recognizer_failed"
  | "artifact_oversized";

export interface OcrOperationRecord {
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
  frameSamplingOperationId: string;
  requestFingerprint: string;
  limits: OcrLimits;
  status: "started" | "completed" | "failed";
  outputArtifactId: string | null;
  receiptArtifactId: string | null;
  receiptId: string | null;
  receiptContentId: string | null;
  failure: OcrFailureReason | null;
}

/** Exact model-facing echo required before OCR observations can enter a report as cite-only context. */
export interface OcrEvidenceCitationInput {
  operationId: string;
  artifactId: string;
  contentId: string;
  receiptArtifactId: string;
  receiptId: string;
  receiptContentId: string;
  observationIds: string[];
}
