export const SEMANTIC_EVIDENCE_LIMITS = {
  maxDurationMs: 120_000,
  maxSegments: 64,
  maxTextBytes: 32 * 1024,
  maxArtifactBytes: 128 * 1024,
  maxNormalizedAudioBytes: 16 * 1024 * 1024,
  maxWallMs: 60_000,
} as const;

export interface SpeechTranscribeRequest {
  operationId: string;
  taskId: string;
  agentId: string;
  artifactId: string;
  trackId: string;
  startMs: number;
  endMs: number;
}

export interface SemanticEvidenceNormalization {
  audio: {
    container: "wav";
    codec: "pcm_s16le";
    channels: 1;
    sampleRateHz: 16_000;
  };
  text: {
    unicode: "NFC";
    whitespace: "trim_and_collapse";
    preserveCase: true;
  };
  timing: {
    unit: "integer_millisecond";
    range: "half_open_absolute_source";
  };
}

export interface CurrentRunRecognizerDescriptor {
  id: string;
  version: string;
  model: string | null;
  runtime: { id: string; version: string };
  configuration: {
    id: string;
    contentId: string;
    language: string | null;
    timestampMode: "segment";
    segmentation: "server_vad" | "producer_defined";
  };
  executionScope: "current_run";
  fixtureContentId: null;
}

export type SemanticEvidenceAvailabilityState = "available" | "empty" | "unavailable" | "unknown";

export type SemanticEvidenceAvailabilityReason =
  | "current_run_hypotheses_returned"
  | "recognizer_returned_no_segments"
  | "recognizer_unavailable"
  | "recognizer_output_unknown"
  | "segment_or_byte_ceiling";

export interface TimedTranscriptHypothesis {
  kind: "timed_transcript_hypothesis";
  observationId: string;
  range: { startMs: number; endMs: number };
  state: "available" | "unavailable" | "unknown";
  text: string | null;
}

/** Extend this union for later acoustic/overlap/speaker/OCR/visual producers. */
export type SemanticMediaObservation = TimedTranscriptHypothesis;

export interface SemanticMediaEvidenceArtifact {
  schema: "studio.semantic-media-evidence.v1";
  operationId: string;
  runId: string;
  capability: "speech.transcribe";
  authorization: {
    grantId: string;
    taskId: string;
    agentId: string;
    executionId: string;
    launchClaimId: string;
  };
  source: {
    artifactId: string;
    contentId: string;
    trackId: string;
  };
  requestedRange: { startMs: number; endMs: number };
  returnedRange: { startMs: number; endMs: number } | null;
  normalization: SemanticEvidenceNormalization;
  producer: CurrentRunRecognizerDescriptor;
  limits: typeof SEMANTIC_EVIDENCE_LIMITS;
  availability: {
    id: string;
    state: SemanticEvidenceAvailabilityState;
    reason: SemanticEvidenceAvailabilityReason;
    truncated: boolean;
  };
  observations: SemanticMediaObservation[];
}

export interface SemanticMediaEvidenceReceipt {
  schema: "studio.semantic-media-evidence.receipt.v1";
  receiptId: string;
  operationId: string;
  capability: "speech.transcribe";
  authorization: SemanticMediaEvidenceArtifact["authorization"];
  source: SemanticMediaEvidenceArtifact["source"];
  request: { startMs: number; endMs: number };
  returnedRange: { startMs: number; endMs: number } | null;
  normalization: SemanticEvidenceNormalization;
  producer: CurrentRunRecognizerDescriptor;
  limits: typeof SEMANTIC_EVIDENCE_LIMITS;
  output: {
    artifactId: string;
    contentId: string;
    bytes: number;
    schema: "studio.semantic-media-evidence.v1";
  };
  availability: SemanticMediaEvidenceArtifact["availability"];
  observations: SemanticMediaObservation[];
  claims: {
    accuracy: "not_assessed";
    understanding: "not_claimed";
  };
}

export interface SemanticEvidenceRecord {
  id: string;
  capability: "speech.transcribe";
  taskId: string;
  agentId: string;
  executionId: string;
  launchClaimId: string;
  grantId: string;
  sourceArtifactId: string;
  sourceContentId: string;
  trackId: string;
  startMs: number;
  endMs: number;
  status: "started" | "completed" | "failed";
  producer: CurrentRunRecognizerDescriptor;
  limits: typeof SEMANTIC_EVIDENCE_LIMITS;
  outputArtifactId: string | null;
  outputContentId: string | null;
  receiptId: string | null;
  receiptContentId: string | null;
  returnedRange: { startMs: number; endMs: number } | null;
  observationCount: number | null;
  availability: SemanticMediaEvidenceArtifact["availability"] | null;
  failure: string | null;
}

export interface SemanticEvidenceCitationInput {
  operationId: string;
  artifactId: string;
  contentId: string;
  receiptId: string;
  receiptContentId: string;
  observations: Array<{
    observationId: string;
    startMs: number;
    endMs: number;
  }>;
}
