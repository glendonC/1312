import type { ContentIdentity } from "./source.ts";

export const SPEAKER_OVERLAP_HOST_ARTIFACT_KINDS = [
  "studio.speaker-overlap-observations.v1",
  "studio.speaker-overlap-producer.receipt.v1",
] as const;

export function isSpeakerOverlapHostArtifactKind(value: string): boolean {
  return (SPEAKER_OVERLAP_HOST_ARTIFACT_KINDS as readonly string[]).includes(value);
}

export const SPEAKER_OVERLAP_LIMITS = {
  maxRangeMs: 120_000,
  maxSourceBytes: 512 * 1024 * 1024,
  maxDecodedSamples: 1_920_000,
  maxNormalizedAudioBytes: 3_840_000,
  maxTurns: 256,
  maxAccountingCells: 512,
  maxLocalSpeakerClusters: 16,
  maxObservationBytes: 512 * 1024,
  maxReceiptBytes: 256 * 1024,
  maxWallMs: 60_000,
  maxCalls: 1,
  minReliableTurnMs: 500,
} as const;

export const SPEAKER_OVERLAP_PINNED_CONTENT_IDS = [
  "sha256:220ad67ca923bef2fa91f2390c786097bf305bceb5e261d4af67b38e938e1079",
  "sha256:1a331345f04805badbb495c775a6ddffcdd1a732567d5ec8b3d5749e3c7a5e4b",
  "sha256:62bcb019dd59696542bdfe74c7c0d5cb62a07cbcb26d67b7fdb0da38635638f3",
] as const;

export interface SpeakerOverlapLimits {
  maxRangeMs: number;
  maxSourceBytes: number;
  maxDecodedSamples: number;
  maxNormalizedAudioBytes: number;
  maxTurns: number;
  maxAccountingCells: number;
  maxLocalSpeakerClusters: number;
  maxObservationBytes: number;
  maxReceiptBytes: number;
  maxWallMs: number;
  maxCalls: number;
  minReliableTurnMs: number;
}

export interface SpeakerOverlapGrantScope {
  schema: "studio.speaker-overlap-grant.v1";
  limits: SpeakerOverlapLimits;
}

/** The task-private bridge injects every field. The child request is the closed empty object. */
export interface SpeakerOverlapRequest {
  operationId: string;
  taskId: string;
  agentId: string;
  grantId: string;
}

export interface SpeakerRuntimeFileIdentity {
  name: string;
  content: ContentIdentity;
}

export interface SpeakerOverlapProducerLineage {
  schema: "studio.speaker-overlap-producer-lineage.v1";
  adapter: { id: "sherpa-onnx-anonymous-speaker-overlap"; version: "1" };
  runtime: {
    package: {
      name: "sherpa-onnx-node";
      version: "1.13.4";
      gitRevision: "142807252687d81b40d6315f23470a1512a00de3";
      license: "Apache-2.0";
      files: SpeakerRuntimeFileIdentity[];
    };
    node: { version: string; platform: string; arch: string };
    execution: { engine: "native_node_addon"; provider: "cpu"; threads: 1; network: "disabled" };
  };
  models: {
    segmentation: {
      id: "pyannote/segmentation-3.0";
      format: "onnx";
      source: "k2-fsa/sherpa-onnx:speaker-segmentation-models";
      releaseDate: "2024-10-08";
      license: "MIT";
      content: ContentIdentity;
    };
    embedding: {
      id: "3D-Speaker/ERes2Net-base-16k";
      format: "onnx";
      source: "k2-fsa/sherpa-onnx:speaker-recongition-models";
      releaseDate: "2024-10-14";
      license: "Apache-2.0";
      content: ContentIdentity;
    };
  };
  configuration: {
    sampleRateHz: 16_000;
    channels: 1;
    sampleFormat: "f32le_normalized_from_s16le";
    numClusters: -1;
    clusteringThreshold: 0.5;
    minDurationOnSeconds: 0.3;
    minDurationOffSeconds: 0.5;
    timing: "integer_millisecond_half_open_absolute_source";
    speakerLabels: "first_appearance_anon_cluster_index";
    uncertainty: "model_scores_unavailable_boundary_policy_v1";
  };
}

export type SpeakerAccountingState = "available" | "unknown" | "conflicting" | "truncated";
export type SpeakerAccountingKind =
  | "anonymous_turn"
  | "overlap"
  | "rapid_turn"
  | "no_hypothesis"
  | "output_limit_exceeded";

export interface AnonymousSpeakerTurnHypothesis {
  turnId: string;
  startMs: number;
  endMs: number;
  speakerLabel: string;
  uncertainty: {
    state: "unquantified";
    reason: "runtime_does_not_expose_segment_scores";
  };
}

/** Ordered, gap-free, non-overlapping partition of the complete scheduler-granted range. */
export interface SpeakerAccountingCell {
  observationId: string;
  index: number;
  startMs: number;
  endMs: number;
  state: SpeakerAccountingState;
  kind: SpeakerAccountingKind;
  speakerLabels: string[];
  turnIds: string[];
  uncertainty: {
    state: "unquantified" | "weak" | "not_applicable";
    reason:
      | "runtime_does_not_expose_segment_scores"
      | "overlap_hypothesis_requires_speech_restudy"
      | "rapid_turn_boundary_below_reliability_floor"
      | "no_speaker_hypothesis_is_not_non_speech_proof"
      | "output_limit_replaced_partial_result";
  };
}

export type SpeakerOverlapArtifactState = "available" | "empty" | "unknown" | "truncated";

export interface SpeakerOverlapObservations {
  schema: "studio.speaker-overlap-observations.v1";
  operationId: string;
  runId: string;
  source: {
    artifactId: string;
    contentId: string;
    audioTrackId: string;
    grantedRange: { startMs: number; endMs: number };
  };
  producer: SpeakerOverlapProducerLineage;
  limits: SpeakerOverlapLimits;
  labelScope: {
    kind: "run_artifact_operation_local";
    runId: string;
    sourceArtifactId: string;
    operationId: string;
  };
  state: SpeakerOverlapArtifactState;
  reason: "hypotheses_emitted" | "no_speaker_hypotheses" | "all_cells_uncertain" | "output_limit_exceeded";
  turns: AnonymousSpeakerTurnHypothesis[];
  accounting: SpeakerAccountingCell[];
  nonClaims: {
    personIdentity: "not_assessed";
    biometricIdentity: "not_performed";
    crossRunIdentity: "not_available";
    namedSpeakers: "not_available";
    transcriptCorrectness: "not_assessed";
    translationCorrectness: "not_assessed";
    dialogueAuthority: "not_granted";
    perfectDiarization: "not_claimed";
  };
}

export interface SpeakerOverlapReceipt {
  schema: "studio.speaker-overlap-producer.receipt.v1";
  receiptId: string;
  operationId: string;
  capability: "media.speakers.analyze";
  authorization: {
    grantId: string;
    taskId: string;
    agentId: string;
    executionId: string;
    launchClaimId: string;
  };
  input: SpeakerOverlapObservations["source"] & {
    sourceBytes: number;
    normalizedAudio: {
      content: ContentIdentity;
      sampleRateHz: 16_000;
      channels: 1;
      sampleFormat: "s16le";
      sampleCount: number;
    };
  };
  producer: SpeakerOverlapProducerLineage;
  limits: SpeakerOverlapLimits;
  execution: {
    wallMs: number;
    measuredBeforeReceiptMs: number;
    wallAccounting: "full_grant_charged_before_atomic_completion";
    rawTurnCount: number;
    accountingCellCount: number;
    localSpeakerClusterCount: number;
    inputBytes: number;
  };
  output: {
    artifactId: string;
    contentId: string;
    bytes: number;
    state: SpeakerOverlapArtifactState;
  };
  nonClaims: SpeakerOverlapObservations["nonClaims"];
}

export type SpeakerOverlapFailureReason =
  | "source_unavailable"
  | "input_oversized"
  | "model_unavailable"
  | "runtime_drift"
  | "decoder_failed"
  | "diarizer_timeout"
  | "diarizer_failed"
  | "artifact_oversized";

export interface SpeakerOverlapOperationRecord {
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
  requestFingerprint: string;
  limits: SpeakerOverlapLimits;
  status: "started" | "completed" | "failed";
  outputArtifactId: string | null;
  receiptArtifactId: string | null;
  receiptId: string | null;
  receiptContentId: string | null;
  failure: SpeakerOverlapFailureReason | null;
}

/** Exact authenticated echo accepted by U3 for coverage qualification only. */
export interface SpeakerOverlapEvidenceCitationInput {
  operationId: string;
  artifactId: string;
  contentId: string;
  receiptArtifactId: string;
  receiptId: string;
  receiptContentId: string;
}
