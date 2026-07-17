import type {
  CaptionExecutorClassification,
  CaptionProductionReceipt,
  CaptionProductionStatus,
  CaptionQualityControlReasonCode,
  CaptionStudyIdentity,
  PublishReviewDecisionReasonCode,
  PublishReviewRevocationReasonCode,
  StudyReadinessReasonCode,
  StudyReadinessReceiptIdentity,
} from "../model.ts";

export interface ProductionStudioPublishReviewIntakeView {
  intakeId: string;
  status: "started" | "completed" | "failed";
  readinessId: string;
  readinessArtifactId: string;
  readinessReceiptId: string;
  readinessReceiptContentId: string;
  outputArtifactId: string | null;
  receiptId: string | null;
  receiptContentId: string | null;
  outcome: "queued" | "rejected" | null;
  reasonCodes: StudyReadinessReasonCode[];
  failure: string | null;
}

export interface ProductionStudioPublishReviewIntakeArtifactView {
  artifactId: string;
  kind: "publish-review-intake-receipt";
  contentId: string;
  bytes: number;
  intakeId: string;
  receiptId: string;
  receiptContentId: string;
  readinessId: string;
  readinessArtifactId: string;
  readinessReceiptId: string;
  readinessReceiptContentId: string;
}

export interface ProductionStudioPublishReviewDecisionView {
  reviewId: string;
  status: "started" | "completed" | "failed";
  intakeId: string;
  intakeArtifactId: string;
  intakeReceiptId: string;
  intakeReceiptContentId: string;
  reviewerId: string;
  reviewerLabel: string;
  outputArtifactId: string | null;
  receiptId: string | null;
  receiptContentId: string | null;
  outcome: "approve_for_caption_production" | "reject_with_reasons" | null;
  reasonCodes: PublishReviewDecisionReasonCode[];
  note: string | null;
  failure: string | null;
}

export interface ProductionStudioPublishReviewRevocationView {
  revocationId: string;
  status: "started" | "completed" | "failed";
  reviewId: string;
  approvalArtifactId: string;
  approvalReceiptId: string;
  approvalReceiptContentId: string;
  reviewerId: string;
  reviewerLabel: string;
  outputArtifactId: string | null;
  receiptId: string | null;
  receiptContentId: string | null;
  reasonCodes: PublishReviewRevocationReasonCode[];
  note: string | null;
  failure: string | null;
}

export interface ProductionStudioPublishReviewDecisionArtifactView {
  artifactId: string;
  kind: "publish-review-decision-receipt";
  contentId: string;
  bytes: number;
  reviewId: string;
  receiptId: string;
  receiptContentId: string;
  intakeId: string;
  intakeArtifactId: string;
  intakeReceiptId: string;
  intakeReceiptContentId: string;
}

export interface ProductionStudioPublishReviewRevocationArtifactView {
  artifactId: string;
  kind: "publish-review-revocation-receipt";
  contentId: string;
  bytes: number;
  revocationId: string;
  receiptId: string;
  receiptContentId: string;
  reviewId: string;
  approvalArtifactId: string;
  approvalReceiptId: string;
  approvalReceiptContentId: string;
}

export interface ProductionStudioCaptionProductionView {
  jobId: string;
  status: "started" | "completed" | "failed";
  approvalReviewId: string;
  approvalArtifactId: string;
  approvalReceiptId: string;
  approvalReceiptContentId: string;
  sourceArtifactId: string;
  sourceContentId: string;
  analysisRequestId: string;
  range: { startMs: number; endMs: number };
  study: CaptionStudyIdentity;
  readiness: StudyReadinessReceiptIdentity;
  executorClassification: CaptionExecutorClassification;
  executorExecutionScope: "test_demo_only" | "current_run";
  cognitionClaim: "none";
  captionArtifactId: string | null;
  captionContentId: string | null;
  receiptArtifactId: string | null;
  receiptId: string | null;
  receiptContentId: string | null;
  resultStatus: CaptionProductionStatus | null;
  lineCount: number | null;
  sourceAvailableCount: number | null;
  targetAvailableCount: number | null;
  withheldCount: number | null;
  unavailableCount: number | null;
  lines: CaptionProductionReceipt["result"]["lines"];
  authorityState: "unrevoked" | "revocation_started_or_completed";
  failure: string | null;
}

export interface ProductionStudioCaptionQualityControlView {
  qcId: string;
  jobId: string;
  captionArtifactId: string;
  captionContentId: string;
  captionReceiptId: string;
  captionReceiptContentId: string;
  outputArtifactId: string;
  receiptId: string;
  receiptContentId: string;
  outcome: "accepted" | "withheld";
  reasonCodes: CaptionQualityControlReasonCode[];
  study: CaptionStudyIdentity;
  readiness: StudyReadinessReceiptIdentity;
  approvalReviewId: string;
  lines: Array<{
    lineId: string;
    outcome: "accepted" | "withheld";
    reasonCode: CaptionQualityControlReasonCode;
    causality: CaptionProductionReceipt["result"]["lines"][number];
  }>;
}

export interface ProductionStudioCaptionArtifactView {
  artifactId: string;
  role: "timed_captions" | "production_receipt";
  kind: "caption-production-output" | "caption-production-receipt";
  contentId: string;
  bytes: number;
  jobId: string;
  approvalReviewId: string;
  approvalArtifactId: string;
  studyId: string;
  studyArtifactId: string;
  readinessId: string;
  readinessArtifactId: string;
}
