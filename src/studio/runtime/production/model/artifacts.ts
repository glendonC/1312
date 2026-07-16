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
  receiptSchema: "studio.speech-activity.v1" | "studio.language-ranges.v1";
  producerId: "silero-vad" | "whisper-language-id";
  preflightId: string;
  preflightContentId: string;
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
  decisionOperationId: string;
  decisionArtifactId: string;
  decisionReceiptId: string;
  decisionReceiptContentId: string;
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
  acceptedChildArtifactId: string;
  rootPromotionArtifactId: string;
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
  rootPromotionArtifactId: string;
}

export interface CaptionQualityControlArtifactOrigin {
  kind: "caption_quality_control";
  qcId: string;
  jobId: string;
  captionArtifactId: string;
  captionContentId: string;
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
    | SemanticMediaEvidenceArtifactOrigin
    | WorkerOutputArtifactOrigin
    | StudyReportArtifactOrigin
    | ParentArtifactDispositionArtifactOrigin
    | ParentAdmissionArtifactOrigin
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
