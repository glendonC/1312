import type { RuntimeProjection } from "../model.ts";
import type {
  ProductionStudioCaptionArtifactView,
  ProductionStudioCaptionProductionView,
  ProductionStudioCaptionQualityControlView,
  ProductionStudioPublishReviewDecisionArtifactView,
  ProductionStudioPublishReviewDecisionView,
  ProductionStudioPublishReviewIntakeArtifactView,
  ProductionStudioPublishReviewIntakeView,
  ProductionStudioPublishReviewRevocationArtifactView,
  ProductionStudioPublishReviewRevocationView,
} from "./model.ts";

export function projectPublishReviewIntakes(state: RuntimeProjection) {
  const publishReviewIntakes = Object.values(state.publishReviewIntakes)
    .map((intake): ProductionStudioPublishReviewIntakeView => ({
      intakeId: intake.id,
      status: intake.status,
      readinessId: intake.readinessId,
      readinessArtifactId: intake.readinessArtifactId,
      readinessReceiptId: intake.readinessReceiptId,
      readinessReceiptContentId: intake.readinessReceiptContentId,
      outputArtifactId: intake.artifactId,
      receiptId: intake.receiptId,
      receiptContentId: intake.receiptContentId,
      outcome: intake.outcome,
      reasonCodes: [...intake.reasonCodes],
      failure: intake.failure,
    }))
    .sort((left, right) => left.intakeId.localeCompare(right.intakeId));
  return publishReviewIntakes;
}


export function projectPublishReviewDecisions(state: RuntimeProjection) {
  const publishReviewDecisions = Object.values(state.publishReviewDecisions)
    .map((review): ProductionStudioPublishReviewDecisionView => ({
      reviewId: review.id,
      status: review.status,
      intakeId: review.intakeId,
      intakeArtifactId: review.intakeArtifactId,
      intakeReceiptId: review.intakeReceiptId,
      intakeReceiptContentId: review.intakeReceiptContentId,
      reviewerId: review.reviewerId,
      reviewerLabel: review.reviewerLabel,
      outputArtifactId: review.artifactId,
      receiptId: review.receiptId,
      receiptContentId: review.receiptContentId,
      outcome: review.outcome,
      reasonCodes: [...review.reasonCodes],
      note: review.note,
      failure: review.failure,
    }))
    .sort((left, right) => left.reviewId.localeCompare(right.reviewId));
  return publishReviewDecisions;
}


export function projectPublishReviewRevocations(state: RuntimeProjection) {
  const publishReviewRevocations = Object.values(state.publishReviewRevocations)
    .map((revocation): ProductionStudioPublishReviewRevocationView => ({
      revocationId: revocation.id,
      status: revocation.status,
      reviewId: revocation.reviewId,
      approvalArtifactId: revocation.approvalArtifactId,
      approvalReceiptId: revocation.approvalReceiptId,
      approvalReceiptContentId: revocation.approvalReceiptContentId,
      reviewerId: revocation.reviewerId,
      reviewerLabel: revocation.reviewerLabel,
      outputArtifactId: revocation.artifactId,
      receiptId: revocation.receiptId,
      receiptContentId: revocation.receiptContentId,
      reasonCodes: [...revocation.reasonCodes],
      note: revocation.note,
      failure: revocation.failure,
    }))
    .sort((left, right) => left.revocationId.localeCompare(right.revocationId));
  return publishReviewRevocations;
}


export function projectCaptionProductions(state: RuntimeProjection) {
  const captionProductions = Object.values(state.captionProductions)
    .map((job): ProductionStudioCaptionProductionView => ({
      jobId: job.id,
      status: job.status,
      approvalReviewId: job.approvalReviewId,
      approvalArtifactId: job.approvalArtifactId,
      approvalReceiptId: job.approvalReceiptId,
      approvalReceiptContentId: job.approvalReceiptContentId,
      sourceArtifactId: job.sourceArtifactId,
      sourceContentId: job.sourceContentId,
      analysisRequestId: job.analysisRequestId,
      range: structuredClone(job.range),
      study: structuredClone(job.study),
      readiness: structuredClone(job.readiness),
      executorClassification: job.executor.classification,
      executorExecutionScope: job.executor.executionScope,
      cognitionClaim: job.executor.cognitionClaim,
      captionArtifactId: job.captionArtifactId,
      captionContentId: job.captionContentId,
      receiptArtifactId: job.receiptArtifactId,
      receiptId: job.receiptId,
      receiptContentId: job.receiptContentId,
      resultStatus: job.resultStatus,
      lineCount: job.lineCount,
      sourceAvailableCount: job.sourceAvailableCount,
      targetAvailableCount: job.targetAvailableCount,
      withheldCount: job.withheldCount,
      unavailableCount: job.unavailableCount,
      lines: structuredClone(job.lines),
      authorityState: Object.values(state.publishReviewRevocations).some((revocation) =>
        revocation.reviewId === job.approvalReviewId && revocation.status !== "failed")
        ? "revocation_started_or_completed"
        : "unrevoked",
      failure: job.failure,
    }))
    .sort((left, right) => left.jobId.localeCompare(right.jobId));
  return captionProductions;
}


export function projectCaptionQualityControls(state: RuntimeProjection) {
  const qualityControls = Object.values(state.captionQualityControls)
    .map((qc): ProductionStudioCaptionQualityControlView => ({
      qcId: qc.id,
      jobId: qc.jobId,
      captionArtifactId: qc.captionArtifactId,
      captionContentId: qc.captionContentId,
      captionReceiptId: qc.captionReceiptId,
      captionReceiptContentId: qc.captionReceiptContentId,
      outputArtifactId: qc.outputArtifactId,
      receiptId: qc.receiptId,
      receiptContentId: qc.receiptContentId,
      outcome: qc.outcome,
      reasonCodes: [...qc.reasonCodes],
      study: structuredClone(state.captionProductions[qc.jobId].study),
      readiness: structuredClone(state.captionProductions[qc.jobId].readiness),
      approvalReviewId: state.captionProductions[qc.jobId].approvalReviewId,
      lines: qc.lines.map((line) => ({
        ...structuredClone(line),
        causality: structuredClone(state.captionProductions[qc.jobId].lines.find((candidate) =>
          candidate.lineId === line.lineId)!),
      })),
    }))
    .sort((left, right) => left.qcId.localeCompare(right.qcId));
  return qualityControls;
}


export function projectPublishReviewIntakeArtifacts(state: RuntimeProjection) {
  const publishReviewIntakeArtifacts = Object.values(state.artifacts)
    .filter((artifact) => {
      if (artifact.origin.kind !== "publish_review_intake") return false;
      const intake = state.publishReviewIntakes[artifact.origin.intakeId];
      return intake?.status === "completed" && intake.artifactId === artifact.id;
    })
    .map((artifact): ProductionStudioPublishReviewIntakeArtifactView => {
      if (artifact.origin.kind !== "publish_review_intake") {
        throw new Error(`Production Studio projection: publish-review intake artifact ${artifact.id} changed origin`);
      }
      if (
        artifact.kind !== "publish-review-intake-receipt" ||
        artifact.producerTaskId !== null ||
        artifact.producerAgentId !== null ||
        artifact.mediaClass !== "non_media" ||
        artifact.publication !== "private"
      ) throw new Error(`Production Studio projection: publish-review intake artifact ${artifact.id} is invalid`);
      return {
        artifactId: artifact.id,
        kind: artifact.kind,
        contentId: artifact.content.contentId,
        bytes: artifact.content.bytes,
        intakeId: artifact.origin.intakeId,
        receiptId: artifact.origin.receiptId,
        receiptContentId: artifact.origin.receiptContentId,
        readinessId: artifact.origin.readinessId,
        readinessArtifactId: artifact.origin.readinessArtifactId,
        readinessReceiptId: artifact.origin.readinessReceiptId,
        readinessReceiptContentId: artifact.origin.readinessReceiptContentId,
      };
    })
    .sort((left, right) => left.artifactId.localeCompare(right.artifactId));
  return publishReviewIntakeArtifacts;
}


export function projectPublishReviewDecisionArtifacts(state: RuntimeProjection) {
  const publishReviewDecisionArtifacts = Object.values(state.artifacts)
    .filter((artifact) => {
      if (artifact.origin.kind !== "publish_review_decision") return false;
      const review = state.publishReviewDecisions[artifact.origin.reviewId];
      return review?.status === "completed" && review.artifactId === artifact.id;
    })
    .map((artifact): ProductionStudioPublishReviewDecisionArtifactView => {
      if (artifact.origin.kind !== "publish_review_decision") {
        throw new Error(`Production Studio projection: publish-review decision artifact ${artifact.id} changed origin`);
      }
      if (
        artifact.kind !== "publish-review-decision-receipt" ||
        artifact.producerTaskId !== null ||
        artifact.producerAgentId !== null ||
        artifact.mediaClass !== "non_media" ||
        artifact.publication !== "private"
      ) throw new Error(`Production Studio projection: publish-review decision artifact ${artifact.id} is invalid`);
      return {
        artifactId: artifact.id,
        kind: artifact.kind,
        contentId: artifact.content.contentId,
        bytes: artifact.content.bytes,
        reviewId: artifact.origin.reviewId,
        receiptId: artifact.origin.receiptId,
        receiptContentId: artifact.origin.receiptContentId,
        intakeId: artifact.origin.intakeId,
        intakeArtifactId: artifact.origin.intakeArtifactId,
        intakeReceiptId: artifact.origin.intakeReceiptId,
        intakeReceiptContentId: artifact.origin.intakeReceiptContentId,
      };
    })
    .sort((left, right) => left.artifactId.localeCompare(right.artifactId));
  return publishReviewDecisionArtifacts;
}


export function projectPublishReviewRevocationArtifacts(state: RuntimeProjection) {
  const publishReviewRevocationArtifacts = Object.values(state.artifacts)
    .filter((artifact) => {
      if (artifact.origin.kind !== "publish_review_revocation") return false;
      const revocation = state.publishReviewRevocations[artifact.origin.revocationId];
      return revocation?.status === "completed" && revocation.artifactId === artifact.id;
    })
    .map((artifact): ProductionStudioPublishReviewRevocationArtifactView => {
      if (artifact.origin.kind !== "publish_review_revocation") {
        throw new Error(`Production Studio projection: publish-review revocation artifact ${artifact.id} changed origin`);
      }
      if (
        artifact.kind !== "publish-review-revocation-receipt" ||
        artifact.producerTaskId !== null ||
        artifact.producerAgentId !== null ||
        artifact.mediaClass !== "non_media" ||
        artifact.publication !== "private"
      ) throw new Error(`Production Studio projection: publish-review revocation artifact ${artifact.id} is invalid`);
      return {
        artifactId: artifact.id,
        kind: artifact.kind,
        contentId: artifact.content.contentId,
        bytes: artifact.content.bytes,
        revocationId: artifact.origin.revocationId,
        receiptId: artifact.origin.receiptId,
        receiptContentId: artifact.origin.receiptContentId,
        reviewId: artifact.origin.reviewId,
        approvalArtifactId: artifact.origin.approvalArtifactId,
        approvalReceiptId: artifact.origin.approvalReceiptId,
        approvalReceiptContentId: artifact.origin.approvalReceiptContentId,
      };
    })
    .sort((left, right) => left.artifactId.localeCompare(right.artifactId));
  return publishReviewRevocationArtifacts;
}


export function projectCaptionArtifacts(state: RuntimeProjection) {
  const captionArtifacts = Object.values(state.artifacts)
    .filter((artifact) =>
      artifact.origin.kind === "caption_production_output" ||
      artifact.origin.kind === "caption_production_receipt")
    .map((artifact): ProductionStudioCaptionArtifactView => {
      if (
        artifact.origin.kind !== "caption_production_output" &&
        artifact.origin.kind !== "caption_production_receipt"
      ) throw new Error(`Production Studio projection: caption artifact ${artifact.id} changed origin`);
      if (
        artifact.producerTaskId !== null || artifact.producerAgentId !== null ||
        artifact.mediaClass !== "non_media" || artifact.publication !== "private"
      ) throw new Error(`Production Studio projection: caption artifact ${artifact.id} is invalid`);
      return {
        artifactId: artifact.id,
        role: artifact.origin.kind === "caption_production_output" ? "timed_captions" : "production_receipt",
        kind: artifact.kind as "caption-production-output" | "caption-production-receipt",
        contentId: artifact.content.contentId,
        bytes: artifact.content.bytes,
        jobId: artifact.origin.jobId,
        approvalReviewId: artifact.origin.approvalReviewId,
        approvalArtifactId: artifact.origin.approvalArtifactId,
        studyId: artifact.origin.studyId,
        studyArtifactId: artifact.origin.studyArtifactId,
        readinessId: artifact.origin.readinessId,
        readinessArtifactId: artifact.origin.readinessArtifactId,
      };
    })
    .sort((left, right) => left.artifactId.localeCompare(right.artifactId));
  return captionArtifacts;
}
