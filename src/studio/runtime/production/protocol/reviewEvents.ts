import type {
  CaptionExecutorDescriptor,
  CaptionProductionArtifact,
  CaptionProductionReceipt,
  CaptionProductionRequest,
  CaptionQualityControlReceipt,
  ParentArtifactAdmissionReceipt,
  ParentArtifactDispositionReceipt,
  ParentArtifactReadReceipt,
  ParentArtifactReadRequest,
  PublishReviewDecisionReceipt,
  PublishReviewDecisionRequest,
  PublishReviewIntakeReceipt,
  PublishReviewRevocationReceipt,
  PublishReviewRevocationRequest,
  RootOutputDispositionReceipt,
  StudyReadinessReceiptIdentity,
} from "../model.ts";
import type { RuntimeEventBase } from "./base.ts";

export interface PublishReviewIntakeStartedEvent extends RuntimeEventBase {
  type: "publish.review.intake_started";
  data: { intakeId: string; readiness: StudyReadinessReceiptIdentity };
}

export interface PublishReviewIntakeCompletedEvent extends RuntimeEventBase {
  type: "publish.review.intake_completed";
  data: {
    intakeId: string;
    outputArtifactId: string;
    receiptContentId: string;
    receipt: PublishReviewIntakeReceipt;
  };
}

export interface PublishReviewIntakeFailedEvent extends RuntimeEventBase {
  type: "publish.review.intake_failed";
  data: { intakeId: string; reason: string };
}

export interface PublishReviewDecisionStartedEvent extends RuntimeEventBase {
  type: "publish.review.decision_started";
  data: {
    reviewId: string;
    request: PublishReviewDecisionRequest;
    reviewerLabel: string;
  };
}

export interface PublishReviewDecisionCompletedEvent extends RuntimeEventBase {
  type: "publish.review.decision_completed";
  data: {
    reviewId: string;
    outputArtifactId: string;
    receiptContentId: string;
    receipt: PublishReviewDecisionReceipt;
  };
}

export interface PublishReviewDecisionFailedEvent extends RuntimeEventBase {
  type: "publish.review.decision_failed";
  data: { reviewId: string; reason: string };
}

export interface PublishReviewRevocationStartedEvent extends RuntimeEventBase {
  type: "publish.review.revocation_started";
  data: {
    revocationId: string;
    request: PublishReviewRevocationRequest;
    reviewerLabel: string;
  };
}

export interface PublishReviewRevocationCompletedEvent extends RuntimeEventBase {
  type: "publish.review.revocation_completed";
  data: {
    revocationId: string;
    outputArtifactId: string;
    receiptContentId: string;
    receipt: PublishReviewRevocationReceipt;
  };
}

export interface PublishReviewRevocationFailedEvent extends RuntimeEventBase {
  type: "publish.review.revocation_failed";
  data: { revocationId: string; reason: string };
}

export interface CaptionProductionStartedEvent extends RuntimeEventBase {
  type: "caption.production_started";
  data: {
    jobId: string;
    request: CaptionProductionRequest;
    input: CaptionProductionArtifact["input"];
    limits: CaptionProductionReceipt["limits"];
    executor: CaptionExecutorDescriptor;
  };
}

export interface CaptionProductionCompletedEvent extends RuntimeEventBase {
  type: "caption.production_completed";
  data: {
    jobId: string;
    captionArtifactId: string;
    captionContentId: string;
    receiptArtifactId: string;
    receiptContentId: string;
    receipt: CaptionProductionReceipt;
  };
}

export interface CaptionProductionFailedEvent extends RuntimeEventBase {
  type: "caption.production_failed";
  data: { jobId: string; reason: string };
}

export interface CaptionQualityControlDecidedEvent extends RuntimeEventBase {
  type: "caption.quality_control_decided";
  data: {
    qcId: string;
    outputArtifactId: string;
    receiptContentId: string;
    receipt: CaptionQualityControlReceipt;
  };
}

export interface RootOutputDispositionRecordedEvent extends RuntimeEventBase {
  type: "root.output_disposition_recorded";
  data: {
    dispositionId: string;
    outputArtifactId: string;
    receiptContentId: string;
    receipt: RootOutputDispositionReceipt;
  };
}

export interface ParentArtifactDispositionRecordedEvent extends RuntimeEventBase {
  type: "parent.artifact_disposition_recorded";
  data: {
    dispositionArtifactId: string;
    dispositionReceiptContentId: string;
    dispositionReceipt: ParentArtifactDispositionReceipt;
    admissionArtifactId: string | null;
    admissionReceiptContentId: string | null;
    admissionReceipt: ParentArtifactAdmissionReceipt | null;
  };
}

export interface ParentArtifactReadStartedEvent extends RuntimeEventBase {
  type: "parent.artifact_read_started";
  data: { request: ParentArtifactReadRequest };
}

export interface ParentArtifactReadCompletedEvent extends RuntimeEventBase {
  type: "parent.artifact_read_completed";
  data: { operationId: string; receipt: ParentArtifactReadReceipt };
}

export interface ParentArtifactReadFailedEvent extends RuntimeEventBase {
  type: "parent.artifact_read_failed";
  data: { operationId: string; reason: string };
}
