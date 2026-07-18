import type { ContentIdentity } from "./source.ts";

export const VISUAL_TRANSITION_LIMITS = {
  minFrames: 2,
  maxFrames: 4,
  maxInputFrameBytes: 2 * 1024 * 1024,
  maxTotalInputBytes: 8 * 1024 * 1024,
  gridWidth: 32,
  gridHeight: 32,
  candidateThresholdPpm: 250_000,
  maxObservationBytes: 256 * 1024,
  maxReceiptBytes: 256 * 1024,
  maxWallMs: 5_000,
  maxCalls: 1,
} as const;

export interface VisualTransitionLimits {
  minFrames: number;
  maxFrames: number;
  maxInputFrameBytes: number;
  maxTotalInputBytes: number;
  gridWidth: number;
  gridHeight: number;
  candidateThresholdPpm: number;
  maxObservationBytes: number;
  maxReceiptBytes: number;
  maxWallMs: number;
  maxCalls: number;
}

export interface VisualTransitionGrantScope {
  schema: "studio.visual-transition-grant.v1";
  limits: VisualTransitionLimits;
}

export interface VisualTransitionRequest {
  operationId: string;
  taskId: string;
  agentId: string;
  grantId: string;
  frameSamplingOperationId: string;
  ocrOperationId: string;
}

export interface VisualTransitionFrameIdentity {
  frameId: string;
  artifactId: string;
  contentId: string;
  bytes: number;
  width: number;
  height: number;
  actualTimestampUs: number;
  ocrState: "available" | "empty" | "unknown" | "truncated";
  availableOcrHypothesisCount: number;
  availableOcrHypothesisSetFingerprint: string;
}

export interface VisualTransitionProducer {
  id: "studio.rgb-grid-visual-change";
  version: "1";
  algorithm: "mean_absolute_rgb_channel_delta";
  sampling: {
    gridWidth: 32;
    gridHeight: 32;
    coordinateRule: "nearest_cell_center_per_frame";
    channels: "rgb24";
  };
  candidateThresholdPpm: 250_000;
  ocrUse: "hypothesis_change_lineage_only_no_threshold_effect";
}

export const VISUAL_TRANSITION_PRODUCER: VisualTransitionProducer = {
  id: "studio.rgb-grid-visual-change",
  version: "1",
  algorithm: "mean_absolute_rgb_channel_delta",
  sampling: {
    gridWidth: 32,
    gridHeight: 32,
    coordinateRule: "nearest_cell_center_per_frame",
    channels: "rgb24",
  },
  candidateThresholdPpm: 250_000,
  ocrUse: "hypothesis_change_lineage_only_no_threshold_effect",
};

export interface VisualTransitionInterval {
  intervalId: string;
  index: number;
  fromFrameId: string;
  toFrameId: string;
  startMs: number;
  endMs: number;
  pixelDifferencePpm: number;
  classification: "visual_change_candidate" | "below_visual_change_threshold";
  ocrHypotheses: {
    comparison: "changed" | "unchanged" | "unavailable";
    beforeAvailableCount: number;
    afterAvailableCount: number;
    beforeSetFingerprint: string;
    afterSetFingerprint: string;
  };
}

export interface VisualTransitionObservations {
  schema: "studio.visual-transition-observations.v1";
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
  ocr: {
    operationId: string;
    observationsArtifactId: string;
    observationsContentId: string;
    receiptId: string;
    receiptArtifactId: string;
    receiptContentId: string;
  };
  producer: VisualTransitionProducer;
  limits: VisualTransitionLimits;
  frames: VisualTransitionFrameIdentity[];
  intervals: VisualTransitionInterval[];
  nonClaims: VisualTransitionNonClaims;
}

export interface VisualTransitionNonClaims {
  sceneBoundary: "not_assessed";
  shotBoundary: "not_assessed";
  visualUnderstanding: "not_assessed";
  rightFrameSelection: "not_assessed";
  ocrTextTruth: "not_assessed";
  semanticCorrectness: "not_assessed";
  dialogueAuthority: "not_granted";
  captionAuthority: "not_granted";
  personIdentification: "not_performed";
}

export interface VisualTransitionReceipt {
  schema: "studio.visual-transition-producer.receipt.v1";
  receiptId: string;
  operationId: string;
  capability: "media.visual-transitions.analyze";
  authorization: {
    grantId: string;
    taskId: string;
    agentId: string;
    executionId: string;
    launchClaimId: string;
  };
  request: { frameSamplingOperationId: string; ocrOperationId: string };
  input: {
    source: VisualTransitionObservations["source"];
    frameSampling: VisualTransitionObservations["frameSampling"];
    ocr: VisualTransitionObservations["ocr"];
    frames: VisualTransitionFrameIdentity[];
  };
  producer: VisualTransitionProducer;
  limits: VisualTransitionLimits;
  execution: {
    wallMs: number;
    measuredBeforeReceiptMs: number;
    wallAccounting: "full_grant_charged_before_atomic_completion";
    frameCount: number;
    intervalCount: number;
    inputBytes: number;
    sampledRgbValues: number;
  };
  output: {
    artifactId: string;
    content: ContentIdentity;
    intervalIds: string[];
  };
  nonClaims: VisualTransitionNonClaims;
}

export type VisualTransitionFailureReason =
  | "input_lineage_invalid"
  | "frame_set_mismatch"
  | "input_limit_exceeded"
  | "producer_timeout"
  | "producer_failed";

export interface VisualTransitionOperationRecord {
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
  ocrOperationId: string;
  requestFingerprint: string;
  limits: VisualTransitionLimits;
  status: "started" | "completed" | "failed";
  outputArtifactId: string | null;
  receiptArtifactId: string | null;
  receiptId: string | null;
  receiptContentId: string | null;
  failure: VisualTransitionFailureReason | null;
}

export interface VisualTransitionEvidenceCitationInput {
  operationId: string;
  observationsArtifactId: string;
  observationsContentId: string;
  receiptArtifactId: string;
  receiptId: string;
  receiptContentId: string;
  intervalIds: string[];
}

export function isVisualTransitionHostArtifactKind(value: string): boolean {
  return value === "studio.visual-transition-observations.v1" ||
    value === "studio.visual-transition-producer.receipt.v1";
}
