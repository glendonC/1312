import type { EvidenceAssessmentAudit } from "../../runtime/production/assessmentAudit";
import type { CaptionProductionVerification } from "../../runtime/production/captionProductionAudit";
import type { EvidenceDecisionReceiptVerification } from "../../runtime/production/decisionReceiptAudit";
import type { PublishReviewDecisionVerification } from "../../runtime/production/publishReviewDecisionAudit";
import type { PublishReviewIntakeVerification } from "../../runtime/production/publishReviewIntakeAudit";
import type { ProductionStudioProjection } from "../../runtime/production/studioProjection";

export function buildProductionFactsContext({
  projection,
  assessmentAudits,
  decisionReceipts,
  publishReviewIntakes,
  publishReviewDecisions,
  captionProductions,
}: {
  projection: ProductionStudioProjection;
  assessmentAudits: readonly EvidenceAssessmentAudit[];
  decisionReceipts: readonly EvidenceDecisionReceiptVerification[];
  publishReviewIntakes: readonly PublishReviewIntakeVerification[];
  publishReviewDecisions: readonly PublishReviewDecisionVerification[];
  captionProductions: readonly CaptionProductionVerification[];
}) {
  const outputArtifactIds = new Set(projection.outputArtifacts.map((artifact) => artifact.artifactId));
  const renderedArtifactIds = new Set([
    ...projection.sourceArtifacts.map((artifact) => artifact.artifactId),
    ...projection.evidenceArtifacts.map((artifact) => artifact.artifactId),
    ...projection.assessmentArtifacts.map((artifact) => artifact.artifactId),
    ...projection.decisionArtifacts.map((artifact) => artifact.artifactId),
    ...projection.publishReviewIntakeArtifacts.map((artifact) => artifact.artifactId),
    ...projection.publishReviewDecisionArtifacts.map((artifact) => artifact.artifactId),
    ...projection.publishReviewRevocationArtifacts.map((artifact) => artifact.artifactId),
    ...projection.captionArtifacts.map((artifact) => artifact.artifactId),
    ...outputArtifactIds,
  ]);
  const operationIds = new Set([
    ...projection.operations.map((operation) => operation.operationId),
    ...projection.evidenceReads.map((operation) => operation.operationId),
    ...projection.evidenceAssessments.map((operation) => operation.operationId),
    ...projection.evidenceDecisions.map((operation) => operation.operationId),
  ]);
  const taskIds = new Set(projection.tasks.map((task) => task.taskId));
  const workerIds = new Set(projection.workers.map((worker) => worker.agentId));
  const readReceiptIds = new Set(projection.evidenceReads.flatMap((read) =>
    read.receiptId && read.status === "completed" ? [read.receiptId] : []));
  const visibleAssessmentAudits = assessmentAudits.filter((audit) =>
    projection.evidenceAssessments.some((assessment) =>
      assessment.operationId === audit.operationId &&
      assessment.status === "completed" &&
      assessment.outputArtifactId === audit.artifactId &&
      assessment.receiptId === audit.receiptId &&
      assessment.receiptContentId === audit.receiptContentId) &&
    renderedArtifactIds.has(audit.artifactId));
  const visibleDecisionReceipts = decisionReceipts.filter((receipt) =>
    projection.evidenceDecisions.some((decision) =>
      decision.operationId === receipt.operationId &&
      decision.status === "completed" &&
      decision.outputArtifactId === receipt.artifactId &&
      decision.receiptId === receipt.receiptId &&
      decision.receiptContentId === receipt.receiptContentId &&
      decision.outcome === receipt.outcome) &&
    renderedArtifactIds.has(receipt.artifactId));
  const visiblePublishReviewIntakes = publishReviewIntakes.filter((intake) =>
    projection.publishReviewIntakes.some((projected) =>
      projected.intakeId === intake.intakeId &&
      projected.status === "completed" &&
      projected.outputArtifactId === intake.artifactId &&
      projected.receiptId === intake.receiptId &&
      projected.receiptContentId === intake.receiptContentId &&
      projected.readinessId === intake.readiness.readinessId &&
      projected.readinessArtifactId === intake.readiness.artifactId &&
      projected.readinessReceiptId === intake.readiness.receiptId &&
      projected.readinessReceiptContentId === intake.readiness.receiptContentId &&
      projected.outcome === intake.outcome) &&
    renderedArtifactIds.has(intake.artifactId));
  const visiblePublishReviewDecisions = publishReviewDecisions.filter((review) =>
    projection.publishReviewDecisions.some((projected) =>
      projected.reviewId === review.reviewId &&
      projected.status === "completed" &&
      projected.outputArtifactId === review.artifactId &&
      projected.receiptId === review.receiptId &&
      projected.receiptContentId === review.receiptContentId &&
      projected.intakeId === review.intake.intakeId &&
      projected.intakeArtifactId === review.intake.artifactId &&
      projected.intakeReceiptId === review.intake.receiptId &&
      projected.intakeReceiptContentId === review.intake.receiptContentId &&
      projected.outcome === review.outcome) &&
    renderedArtifactIds.has(review.artifactId) &&
    visiblePublishReviewIntakes.some((intake) => intake.intakeId === review.intake.intakeId));
  const verifiedQueuedIntakes = visiblePublishReviewIntakes.filter((intake) => intake.outcome === "queued");
  const verifiedRejectedIntakes = visiblePublishReviewIntakes.filter((intake) => intake.outcome === "rejected");
  const unreviewedQueuedIntakes = verifiedQueuedIntakes.filter((intake) =>
    !visiblePublishReviewDecisions.some((review) => review.intake.intakeId === intake.intakeId));
  const hasUnverifiedQueuedProjection = projection.publishReviewIntakes.some((intake) =>
    intake.status === "completed" &&
    intake.outcome === "queued" &&
    !visiblePublishReviewIntakes.some((verified) => verified.intakeId === intake.intakeId));
  const visibleCaptionProductions = captionProductions.filter((caption) =>
    projection.captionProductions.some((job) =>
      job.jobId === caption.jobId &&
      job.status === "completed" &&
      job.approvalReviewId === caption.approval.reviewId &&
      job.captionArtifactId === caption.captionArtifactId &&
      job.captionContentId === caption.captionContentId &&
      job.receiptArtifactId === caption.receiptArtifactId &&
      job.receiptId === caption.receiptId &&
      job.receiptContentId === caption.receiptContentId) &&
    renderedArtifactIds.has(caption.captionArtifactId) &&
    renderedArtifactIds.has(caption.receiptArtifactId));
  const eligibleCaptionApprovals = visiblePublishReviewDecisions.filter((review) =>
    review.outcome === "approve_for_caption_production" &&
    review.state === "approved_for_caption_production" &&
    review.revocation === null &&
    !projection.captionProductions.some((job) => job.approvalReviewId === review.reviewId));
  const executionIds = new Set(
    projection.workers.flatMap((worker) => worker.execution ? [worker.execution.id] : []),
  );
  return {
    outputArtifactIds,
    renderedArtifactIds,
    operationIds,
    taskIds,
    workerIds,
    readReceiptIds,
    visibleAssessmentAudits,
    visibleDecisionReceipts,
    visiblePublishReviewIntakes,
    visiblePublishReviewDecisions,
    verifiedQueuedIntakes,
    verifiedRejectedIntakes,
    unreviewedQueuedIntakes,
    hasUnverifiedQueuedProjection,
    visibleCaptionProductions,
    eligibleCaptionApprovals,
    executionIds,
    projection,
  };
}

export type ProductionFactsContext = ReturnType<typeof buildProductionFactsContext>;
