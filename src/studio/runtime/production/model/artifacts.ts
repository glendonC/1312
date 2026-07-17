import type { ContentIdentity, MediaTrackDescriptor } from "./source.ts";
import type { EvidenceKind } from "./tasks.ts";
import type { SemanticEvidenceCitationInput } from "./semanticEvidence.ts";

export interface SourceArtifactOrigin {
  kind: "ingest";
  adapterId: string;
  sourceReceiptRef: string;
}

export interface MediaOperationArtifactOrigin {
  kind: "media_operation";
  operationId: string;
  receiptId: string;
  receiptContentId: string;
}

export interface MediaObservationArtifactOrigin {
  kind: "media_observation";
  operationId: string;
  receiptId: string;
  receiptContentId: string;
}

export interface SampledFrameArtifactOrigin {
  kind: "sampled_frame";
  operationId: string;
  frameId: string;
  manifestArtifactId: string;
  receiptId: string;
  receiptContentId: string;
}

export interface FrameSampleManifestArtifactOrigin {
  kind: "frame_sample_manifest";
  operationId: string;
  receiptId: string;
  receiptContentId: string;
}

export interface FrameSamplingReceiptArtifactOrigin {
  kind: "frame_sampling_receipt";
  operationId: string;
  receiptId: string;
  manifestArtifactId: string;
}

export interface OcrObservationsArtifactOrigin {
  kind: "ocr_observations";
  operationId: string;
  receiptId: string;
  receiptContentId: string;
  frameSamplingOperationId: string;
}

export interface OcrReceiptArtifactOrigin {
  kind: "ocr_receipt";
  operationId: string;
  receiptId: string;
  observationsArtifactId: string;
  frameSamplingOperationId: string;
}

export interface SpeakerOverlapObservationsArtifactOrigin {
  kind: "speaker_overlap_observations";
  operationId: string;
  receiptId: string;
  receiptContentId: string;
}

export interface SpeakerOverlapReceiptArtifactOrigin {
  kind: "speaker_overlap_receipt";
  operationId: string;
  receiptId: string;
  observationsArtifactId: string;
}

export interface SeparationStemArtifactOrigin {
  kind: "separation_stem";
  operationId: string;
  receiptId: string;
  receiptContentId: string;
  stemRole: "source_estimate_1" | "source_estimate_2";
  sourceArtifactId: string;
  sourceContentId: string;
  trackId: string;
  startMs: number;
  endMs: number;
  triggerOperationId: string;
  triggerObservationId: string;
  methodId: "speechbrain-sepformer-wsj02mix";
  modelContentIds: string[];
  configurationContentId: string;
}

export interface ConditionalSeparationReceiptArtifactOrigin {
  kind: "conditional_separation_receipt";
  operationId: string;
  receiptId: string;
  stemArtifactIds: [string, string];
}

export interface RawStemComparisonArtifactOrigin {
  kind: "raw_stem_comparison";
  operationId: string;
  separationReceiptId: string;
  receiptId: string;
  receiptContentId: string;
}

export interface RawStemComparisonReceiptArtifactOrigin {
  kind: "raw_stem_comparison_receipt";
  operationId: string;
  receiptId: string;
  comparisonArtifactId: string;
  separationReceiptId: string;
}

export interface SemanticMediaEvidenceArtifactOrigin {
  kind: "semantic_media_evidence";
  operationId: string;
  receiptId: string;
  receiptContentId: string;
  availabilityId: string;
}

export interface WorkerOutputArtifactOrigin {
  kind: "worker_output";
  executionId: string;
  receiptId: string;
  receiptContentId: string;
}

export interface StudyReportArtifactOrigin {
  kind: "study_report";
  executionId: string;
  receiptId: string;
  receiptContentId: string;
  jobContextId: string;
  outputSlotName: string;
}

export interface ParentArtifactDispositionArtifactOrigin {
  kind: "parent_artifact_disposition";
  dispositionId: string;
  reportId: string;
  inputArtifactId: string;
  outcome: "accepted" | "rejected";
  receiptId: string;
  receiptContentId: string;
}

export interface ParentAdmissionArtifactOrigin {
  kind: "parent_admission";
  admissionId: string;
  dispositionId: string;
  reportId: string;
  inputArtifactId: string;
  grantId: string;
  receiptId: string;
  receiptContentId: string;
}

export interface GeneralizedParentAdmissionArtifactOrigin {
  kind: "generalized_parent_admission";
  admissionId: string;
  reportId: string;
  reportArtifactId: string;
  receiptId: string;
  receiptContentId: string;
}

export interface GeneralizedParentArtifactReadArtifactOrigin {
  kind: "generalized_parent_artifact_read";
  operationId: string;
  admissionId: string;
  reportArtifactId: string;
  receiptId: string;
  receiptContentId: string;
}

export interface StudyPlanningDecisionArtifactOrigin {
  kind: "study_planning_decision";
  decisionId: string;
  inputId: string;
  executionId: string;
  receiptId: string;
  receiptContentId: string;
}

export interface OwnedMediaStudyArtifactOrigin {
  kind: "owned_media_study";
  studyId: string;
  planningDecisionId: string;
  executionId: string;
  executorReceiptId: string;
  executorReceiptContentId: string;
}

export interface GeneralizedOwnedMediaStudyArtifactOrigin {
  kind: "generalized_owned_media_study";
  studyId: string;
  executionId: string;
  executorReceiptId: string;
  executorReceiptContentId: string;
}

export interface StudyReadinessArtifactOrigin {
  kind: "study_readiness";
  readinessId: string;
  studyId: string;
  studyArtifactId: string;
  receiptId: string;
  receiptContentId: string;
  outcome: "proceed_to_caption_review" | "withheld";
}

export interface GeneralizedStudyReadinessArtifactOrigin {
  kind: "generalized_study_readiness";
  readinessId: string;
  studyId: string;
  studyArtifactId: string;
  receiptId: string;
  receiptContentId: string;
  outcome: "proceed_to_caption_review" | "withheld";
}

export interface RootOutputDispositionArtifactOrigin {
  kind: "root_output_disposition";
  dispositionId: string;
  reportId: string;
  inputArtifactId: string;
  outcome: "promoted_to_root" | "rejected_by_root";
  receiptId: string;
  receiptContentId: string;
}

export interface PreflightEvidenceArtifactOrigin {
  kind: "preflight_evidence";
  evidenceKind: EvidenceKind;
  receiptSchema: "studio.speech-activity.v1" | "studio.language-ranges.v1" | "studio.acoustic-observations.v1";
  producerId: "silero-vad" | "whisper-language-id" | "yamnet-acoustic-triage";
  preflightId: string;
  preflightContentId: string;
  producerReceiptContentId?: string;
}

export interface EvidenceAssessmentArtifactOrigin {
  kind: "evidence_assessment";
  operationId: string;
  receiptId: string;
  receiptContentId: string;
  readReceiptIds: string[];
  readReceiptContentIds: string[];
}

export interface EvidenceDecisionArtifactOrigin {
  kind: "evidence_decision";
  operationId: string;
  receiptId: string;
  receiptContentId: string;
  assessmentOperationIds: string[];
  assessmentArtifactIds: string[];
  assessmentReceiptIds: string[];
  assessmentReceiptContentIds: string[];
}

export interface PublishReviewIntakeArtifactOrigin {
  kind: "publish_review_intake";
  intakeId: string;
  receiptId: string;
  receiptContentId: string;
  readinessId: string;
  readinessArtifactId: string;
  readinessReceiptId: string;
  readinessReceiptContentId: string;
}

export interface PublishReviewDecisionArtifactOrigin {
  kind: "publish_review_decision";
  reviewId: string;
  receiptId: string;
  receiptContentId: string;
  intakeId: string;
  intakeArtifactId: string;
  intakeReceiptId: string;
  intakeReceiptContentId: string;
}

export interface PublishReviewRevocationArtifactOrigin {
  kind: "publish_review_revocation";
  revocationId: string;
  receiptId: string;
  receiptContentId: string;
  reviewId: string;
  approvalArtifactId: string;
  approvalReceiptId: string;
  approvalReceiptContentId: string;
}

export interface CaptionProductionOutputArtifactOrigin {
  kind: "caption_production_output";
  jobId: string;
  receiptId: string;
  receiptContentId: string;
  approvalReviewId: string;
  approvalArtifactId: string;
  sourceArtifactId: string;
  studyId: string;
  studyArtifactId: string;
  readinessId: string;
  readinessArtifactId: string;
}

export interface CaptionProductionReceiptArtifactOrigin {
  kind: "caption_production_receipt";
  jobId: string;
  receiptId: string;
  receiptContentId: string;
  approvalReviewId: string;
  approvalArtifactId: string;
  captionArtifactId: string;
  captionContentId: string;
  studyId: string;
  studyArtifactId: string;
  readinessId: string;
  readinessArtifactId: string;
}

export interface CaptionQualityControlArtifactOrigin {
  kind: "caption_quality_control";
  qcId: string;
  jobId: string;
  captionArtifactId: string;
  captionContentId: string;
  studyId: string;
  readinessId: string;
  approvalReviewId: string;
  receiptId: string;
  receiptContentId: string;
  outcome: "accepted" | "withheld";
}

export interface RuntimeArtifact {
  schema: "studio.runtime.artifact.v1";
  id: string;
  runId: string;
  kind: string;
  mediaClass: "raw" | "derived" | "non_media";
  publication: "private" | "public";
  content: ContentIdentity;
  storageKey: string;
  durationMs: number | null;
  tracks: MediaTrackDescriptor[];
  sourceArtifactIds: string[];
  producerTaskId: string | null;
  producerAgentId: string | null;
  origin:
    | SourceArtifactOrigin
    | MediaOperationArtifactOrigin
    | MediaObservationArtifactOrigin
    | SampledFrameArtifactOrigin
    | FrameSampleManifestArtifactOrigin
    | FrameSamplingReceiptArtifactOrigin
    | OcrObservationsArtifactOrigin
    | OcrReceiptArtifactOrigin
    | SpeakerOverlapObservationsArtifactOrigin
    | SpeakerOverlapReceiptArtifactOrigin
    | SeparationStemArtifactOrigin
    | ConditionalSeparationReceiptArtifactOrigin
    | RawStemComparisonArtifactOrigin
    | RawStemComparisonReceiptArtifactOrigin
    | SemanticMediaEvidenceArtifactOrigin
    | WorkerOutputArtifactOrigin
    | StudyReportArtifactOrigin
    | ParentArtifactDispositionArtifactOrigin
    | ParentAdmissionArtifactOrigin
    | GeneralizedParentAdmissionArtifactOrigin
    | GeneralizedParentArtifactReadArtifactOrigin
    | StudyPlanningDecisionArtifactOrigin
    | OwnedMediaStudyArtifactOrigin
    | GeneralizedOwnedMediaStudyArtifactOrigin
    | StudyReadinessArtifactOrigin
    | GeneralizedStudyReadinessArtifactOrigin
    | RootOutputDispositionArtifactOrigin
    | PreflightEvidenceArtifactOrigin
    | EvidenceAssessmentArtifactOrigin
    | EvidenceDecisionArtifactOrigin
    | PublishReviewIntakeArtifactOrigin
    | PublishReviewDecisionArtifactOrigin
    | PublishReviewRevocationArtifactOrigin
    | CaptionProductionOutputArtifactOrigin
    | CaptionProductionReceiptArtifactOrigin
    | CaptionQualityControlArtifactOrigin;
}

export interface WorkerOutputEnvelope {
  schema: "studio.worker-output.v1";
  executionId: string;
  taskId: string;
  agentId: string;
  /** Present and closed whenever this child consumed current-run semantic evidence. */
  semanticEvidenceInputs?: SemanticEvidenceCitationInput[];
  output: {
    name: string;
    kind: string;
    content: string;
  };
}
