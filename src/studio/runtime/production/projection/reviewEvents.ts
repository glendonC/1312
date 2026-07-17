import type { RuntimeProjection } from "../model.ts";
import type { RuntimeEvent } from "../protocol.ts";
import { invariant } from "./shared.ts";

export function applyReviewEvent(next: RuntimeProjection, event: RuntimeEvent): boolean {
  if (event.type === "publish.review.intake_started") {
    invariant(
      event.producer.kind === "publish_review_intake_host",
      event,
      "publish-review intake must come from the intake host",
    );
    const readiness = next.studyReadiness[event.data.readiness.readinessId];
    invariant(
      readiness?.status === "completed" &&
        readiness.artifactId === event.data.readiness.artifactId &&
        readiness.receiptId === event.data.readiness.receiptId &&
        readiness.receiptContentId === event.data.readiness.receiptContentId,
      event,
      `publish-review intake ${event.data.intakeId} has no completed exact study-readiness identity`,
    );
    invariant(!next.publishReviewIntakes[event.data.intakeId], event, `publish-review intake ${event.data.intakeId} is duplicated`);
    invariant(
      !Object.values(next.publishReviewIntakes).some((intake) =>
        intake.readinessId === event.data.readiness.readinessId),
      event,
      `study readiness ${event.data.readiness.readinessId} already has publish-review intake lineage`,
    );
    next.publishReviewIntakes[event.data.intakeId] = {
      id: event.data.intakeId,
      readinessId: event.data.readiness.readinessId,
      readinessArtifactId: event.data.readiness.artifactId,
      readinessReceiptId: event.data.readiness.receiptId,
      readinessReceiptContentId: event.data.readiness.receiptContentId,
      status: "started",
      artifactId: null,
      receiptId: null,
      receiptContentId: null,
      outcome: null,
      reasonCodes: [],
      failure: null,
    };
    return true;
  }

  if (event.type === "publish.review.intake_completed") {
    invariant(
      event.producer.kind === "publish_review_intake_host",
      event,
      "publish-review intake completion must come from the intake host",
    );
    const intake = next.publishReviewIntakes[event.data.intakeId];
    invariant(intake?.status === "started", event, `publish-review intake ${event.data.intakeId} is not active`);
    const artifact = next.artifacts[event.data.outputArtifactId];
    const receipt = event.data.receipt;
    invariant(
      artifact?.origin.kind === "publish_review_intake" &&
        artifact.origin.intakeId === intake.id &&
        artifact.origin.receiptId === receipt.receiptId &&
        artifact.origin.receiptContentId === event.data.receiptContentId &&
        artifact.content.contentId === event.data.receiptContentId,
      event,
      `publish-review intake ${intake.id} has no content-addressed receipt artifact`,
    );
    invariant(
      receipt.intakeId === intake.id &&
        receipt.input.readiness.readinessId === intake.readinessId &&
        receipt.input.readiness.artifactId === intake.readinessArtifactId &&
        receipt.input.readiness.receiptId === intake.readinessReceiptId &&
        receipt.input.readiness.receiptContentId === intake.readinessReceiptContentId,
      event,
      `publish-review intake ${intake.id} receipt changed its verified study-readiness identity`,
    );
    const readiness = next.studyReadiness[intake.readinessId];
    invariant(
      (readiness.outcome === "proceed_to_caption_review" && receipt.result.outcome === "queued") ||
        (readiness.outcome === "withheld" && receipt.result.outcome === "rejected"),
      event,
      `publish-review intake ${intake.id} outcome does not follow the study-readiness outcome`,
    );
    invariant(
      JSON.stringify(receipt.result.reasonCodes) === JSON.stringify(readiness.reasonCodes),
      event,
      `publish-review intake ${intake.id} changed the study-readiness reason codes`,
    );
    intake.status = "completed";
    intake.artifactId = artifact.id;
    intake.receiptId = receipt.receiptId;
    intake.receiptContentId = event.data.receiptContentId;
    intake.outcome = receipt.result.outcome;
    intake.reasonCodes = [...receipt.result.reasonCodes];
    return true;
  }

  if (event.type === "publish.review.intake_failed") {
    invariant(
      event.producer.kind === "publish_review_intake_host",
      event,
      "publish-review intake failure must come from the intake host",
    );
    const intake = next.publishReviewIntakes[event.data.intakeId];
    invariant(intake?.status === "started", event, `publish-review intake ${event.data.intakeId} is not active`);
    intake.status = "failed";
    intake.failure = event.data.reason;
    return true;
  }

  if (event.type === "publish.review.decision_started") {
    invariant(event.producer.kind === "publish_review_host", event, "publish-review decisions must come from the review host");
    const request = event.data.request;
    const intake = next.publishReviewIntakes[request.intake.intakeId];
    invariant(
      intake?.status === "completed" &&
        intake.outcome === "queued" &&
        intake.artifactId === request.intake.artifactId &&
        intake.receiptId === request.intake.receiptId &&
        intake.receiptContentId === request.intake.receiptContentId,
      event,
      `publish-review decision ${event.data.reviewId} has no completed exact queued intake identity`,
    );
    invariant(!next.publishReviewDecisions[event.data.reviewId], event, `publish-review decision ${event.data.reviewId} is duplicated`);
    invariant(
      !Object.values(next.publishReviewDecisions).some((review) => review.intakeId === intake.id),
      event,
      `queued intake ${intake.id} already has immutable review lineage`,
    );
    next.publishReviewDecisions[event.data.reviewId] = {
      id: event.data.reviewId,
      intakeId: intake.id,
      intakeArtifactId: request.intake.artifactId,
      intakeReceiptId: request.intake.receiptId,
      intakeReceiptContentId: request.intake.receiptContentId,
      reviewerId: request.reviewer.id,
      reviewerLabel: event.data.reviewerLabel,
      status: "started",
      artifactId: null,
      receiptId: null,
      receiptContentId: null,
      outcome: null,
      reasonCodes: [],
      note: null,
      failure: null,
    };
    return true;
  }

  if (event.type === "publish.review.decision_completed") {
    invariant(event.producer.kind === "publish_review_host", event, "publish-review completion must come from the review host");
    const review = next.publishReviewDecisions[event.data.reviewId];
    invariant(review?.status === "started", event, `publish-review decision ${event.data.reviewId} is not active`);
    const artifact = next.artifacts[event.data.outputArtifactId];
    const receipt = event.data.receipt;
    invariant(
      artifact?.origin.kind === "publish_review_decision" &&
        artifact.origin.reviewId === review.id &&
        artifact.origin.receiptId === receipt.receiptId &&
        artifact.origin.receiptContentId === event.data.receiptContentId &&
        artifact.content.contentId === event.data.receiptContentId,
      event,
      `publish-review decision ${review.id} has no content-addressed receipt artifact`,
    );
    invariant(
      receipt.reviewId === review.id &&
        receipt.input.intake.intakeId === review.intakeId &&
        receipt.input.intake.artifactId === review.intakeArtifactId &&
        receipt.input.intake.receiptId === review.intakeReceiptId &&
        receipt.input.intake.receiptContentId === review.intakeReceiptContentId &&
        receipt.reviewer.id === review.reviewerId &&
        receipt.reviewer.label === review.reviewerLabel,
      event,
      `publish-review decision ${review.id} receipt changed its intake or reviewer identity`,
    );
    review.status = "completed";
    review.artifactId = artifact.id;
    review.receiptId = receipt.receiptId;
    review.receiptContentId = event.data.receiptContentId;
    review.outcome = receipt.decision.outcome;
    review.reasonCodes = [...receipt.decision.reasonCodes];
    review.note = receipt.decision.note;
    return true;
  }

  if (event.type === "publish.review.decision_failed") {
    invariant(event.producer.kind === "publish_review_host", event, "publish-review failure must come from the review host");
    const review = next.publishReviewDecisions[event.data.reviewId];
    invariant(review?.status === "started", event, `publish-review decision ${event.data.reviewId} is not active`);
    review.status = "failed";
    review.failure = event.data.reason;
    return true;
  }

  if (event.type === "publish.review.revocation_started") {
    invariant(event.producer.kind === "publish_review_host", event, "publish-review revocations must come from the review host");
    const request = event.data.request;
    const approval = next.publishReviewDecisions[request.approval.reviewId];
    invariant(
      approval?.status === "completed" &&
        approval.outcome === "approve_for_caption_production" &&
        approval.artifactId === request.approval.artifactId &&
        approval.receiptId === request.approval.receiptId &&
        approval.receiptContentId === request.approval.receiptContentId,
      event,
      `publish-review revocation ${event.data.revocationId} has no completed exact approval identity`,
    );
    invariant(!next.publishReviewRevocations[event.data.revocationId], event, `publish-review revocation ${event.data.revocationId} is duplicated`);
    invariant(
      !Object.values(next.publishReviewRevocations).some((revocation) => revocation.reviewId === approval.id),
      event,
      `approval ${approval.id} already has immutable revocation lineage`,
    );
    next.publishReviewRevocations[event.data.revocationId] = {
      id: event.data.revocationId,
      reviewId: approval.id,
      approvalArtifactId: request.approval.artifactId,
      approvalReceiptId: request.approval.receiptId,
      approvalReceiptContentId: request.approval.receiptContentId,
      reviewerId: request.reviewer.id,
      reviewerLabel: event.data.reviewerLabel,
      status: "started",
      artifactId: null,
      receiptId: null,
      receiptContentId: null,
      reasonCodes: [],
      note: null,
      failure: null,
    };
    return true;
  }

  if (event.type === "publish.review.revocation_completed") {
    invariant(event.producer.kind === "publish_review_host", event, "publish-review revocation completion must come from the review host");
    const revocation = next.publishReviewRevocations[event.data.revocationId];
    invariant(revocation?.status === "started", event, `publish-review revocation ${event.data.revocationId} is not active`);
    const artifact = next.artifacts[event.data.outputArtifactId];
    const receipt = event.data.receipt;
    invariant(
      artifact?.origin.kind === "publish_review_revocation" &&
        artifact.origin.revocationId === revocation.id &&
        artifact.origin.receiptId === receipt.receiptId &&
        artifact.origin.receiptContentId === event.data.receiptContentId &&
        artifact.content.contentId === event.data.receiptContentId,
      event,
      `publish-review revocation ${revocation.id} has no content-addressed receipt artifact`,
    );
    invariant(
      receipt.revocationId === revocation.id &&
        receipt.input.approval.reviewId === revocation.reviewId &&
        receipt.input.approval.artifactId === revocation.approvalArtifactId &&
        receipt.input.approval.receiptId === revocation.approvalReceiptId &&
        receipt.input.approval.receiptContentId === revocation.approvalReceiptContentId &&
        receipt.reviewer.id === revocation.reviewerId &&
        receipt.reviewer.label === revocation.reviewerLabel &&
        receipt.result.state === "approval_revoked",
      event,
      `publish-review revocation ${revocation.id} receipt changed its approval or reviewer identity`,
    );
    revocation.status = "completed";
    revocation.artifactId = artifact.id;
    revocation.receiptId = receipt.receiptId;
    revocation.receiptContentId = event.data.receiptContentId;
    revocation.reasonCodes = [...receipt.revocation.reasonCodes];
    revocation.note = receipt.revocation.note;
    return true;
  }

  if (event.type === "publish.review.revocation_failed") {
    invariant(event.producer.kind === "publish_review_host", event, "publish-review revocation failure must come from the review host");
    const revocation = next.publishReviewRevocations[event.data.revocationId];
    invariant(revocation?.status === "started", event, `publish-review revocation ${event.data.revocationId} is not active`);
    revocation.status = "failed";
    revocation.failure = event.data.reason;
    return true;
  }

  return false;
}
