import { createHash } from "node:crypto";

import {
  canonicalJsonContentId,
  canonicalSha256,
  ContentAddressedArtifactStore,
} from "../artifactStore.ts";
import type {
  PublishReviewDecisionOutcome,
  PublishReviewDecisionReasonCode,
  PublishReviewDecisionReceipt,
  PublishReviewIntakeReceiptIdentity,
  PublishReviewOperator,
  PublishReviewRevocationReasonCode,
  PublishReviewRevocationReceipt,
  RuntimeProjection,
  StudyReadinessReceiptIdentity,
} from "../model.ts";
import { reopenPublishReviewIntakes } from "./publishReviewIntakeAudit.ts";
import type { RuntimeEvent } from "../protocol.ts";
import {
  validatePublishReviewDecisionReceipt,
  validatePublishReviewRevocationReceipt,
} from "../validation/publishReviewDecision.ts";

const MAX_STORED_PUBLISH_REVIEW_BYTES = 64 * 1024;

export interface PublishReviewRevocationVerification {
  revocationId: string;
  artifactId: string;
  receiptId: string;
  receiptContentId: string;
  integrity: "stored_revocation_and_verified_approval";
  producer: "host_publish_review_v1";
  reviewer: PublishReviewOperator & { attestation: string };
  reasonCodes: PublishReviewRevocationReasonCode[];
  note: string | null;
}

export interface PublishReviewDecisionVerification {
  reviewId: string;
  artifactId: string;
  receiptId: string;
  receiptContentId: string;
  integrity: "stored_review_and_verified_queued_intake";
  producer: "host_publish_review_v1";
  intake: PublishReviewIntakeReceiptIdentity;
  readiness: StudyReadinessReceiptIdentity;
  reviewer: PublishReviewOperator & { attestation: string };
  outcome: PublishReviewDecisionOutcome;
  reasonCodes: PublishReviewDecisionReasonCode[];
  note: string | null;
  state: "approved_for_caption_production" | "rejected" | "approval_revoked";
  revocation: PublishReviewRevocationVerification | null;
}

function expectedStorageKey(contentId: string): string {
  const digest = contentId.replace(/^sha256:/, "");
  return `objects/sha256/${digest.slice(0, 2)}/${digest}`;
}

function sameCanonical(left: unknown, right: unknown): boolean {
  return canonicalSha256(left) === canonicalSha256(right);
}

function decisionReceiptId(receipt: PublishReviewDecisionReceipt): string {
  const body = structuredClone(receipt) as unknown as Record<string, unknown>;
  delete body.schema;
  delete body.receiptId;
  return `publish-review-decision-receipt:${canonicalSha256(body)}`;
}

function revocationReceiptId(receipt: PublishReviewRevocationReceipt): string {
  const body = structuredClone(receipt) as unknown as Record<string, unknown>;
  delete body.schema;
  delete body.receiptId;
  return `publish-review-revocation-receipt:${canonicalSha256(body)}`;
}

async function storedJson(
  artifacts: ContentAddressedArtifactStore,
  contentId: string,
): Promise<{ value: unknown; bytes: number }> {
  const bytes = await artifacts.receiptBytes(contentId);
  if (bytes.byteLength <= 0 || bytes.byteLength > MAX_STORED_PUBLISH_REVIEW_BYTES) {
    throw new Error("Stored publish-review receipt exceeds its byte bound");
  }
  const measured = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  if (measured !== contentId) throw new Error("Stored publish-review receipt changed content identity");
  let value: unknown;
  try {
    value = JSON.parse(bytes.toString("utf8")) as unknown;
  } catch {
    throw new Error("Stored publish-review receipt is invalid JSON");
  }
  if (canonicalJsonContentId(value) !== contentId) {
    throw new Error("Stored publish-review receipt is not canonical JSON");
  }
  return { value, bytes: bytes.byteLength };
}

/** Reopens every review/revocation byte and repeats intake plus complete upstream verification. */
export async function reopenPublishReviewDecisions(
  state: RuntimeProjection,
  events: readonly RuntimeEvent[],
  artifacts: ContentAddressedArtifactStore,
): Promise<PublishReviewDecisionVerification[]> {
  const intakes = await reopenPublishReviewIntakes(state, events, artifacts);
  const verified: PublishReviewDecisionVerification[] = [];
  const completed = Object.values(state.publishReviewDecisions)
    .filter((review) => review.status === "completed")
    .sort((left, right) => left.id.localeCompare(right.id));

  for (const review of completed) {
    if (!review.artifactId || !review.receiptId || !review.receiptContentId || !review.outcome) {
      throw new Error(`Completed publish-review decision ${review.id} has an incomplete projection`);
    }
    const artifact = state.artifacts[review.artifactId];
    const started = events.find((event) =>
      event.type === "publish.review.decision_started" && event.data.reviewId === review.id);
    const completion = events.find((event) =>
      event.type === "publish.review.decision_completed" && event.data.reviewId === review.id);
    if (
      !artifact || artifact.origin.kind !== "publish_review_decision" ||
      !started || started.type !== "publish.review.decision_started" ||
      !completion || completion.type !== "publish.review.decision_completed"
    ) throw new Error(`Completed publish-review decision ${review.id} has no closed journal/artifact lineage`);

    const expectedArtifactId = `artifact:${canonicalSha256({
      runId: state.runId,
      reviewId: review.id,
      kind: "publish-review-decision-receipt",
      contentId: review.receiptContentId,
    })}`;
    if (
      artifact.id !== expectedArtifactId ||
      artifact.runId !== state.runId ||
      artifact.kind !== "publish-review-decision-receipt" ||
      artifact.mediaClass !== "non_media" ||
      artifact.publication !== "private" ||
      artifact.content.contentId !== review.receiptContentId ||
      artifact.storageKey !== expectedStorageKey(review.receiptContentId) ||
      artifact.producerTaskId !== null ||
      artifact.producerAgentId !== null ||
      artifact.origin.reviewId !== review.id ||
      artifact.origin.receiptId !== review.receiptId ||
      artifact.origin.receiptContentId !== review.receiptContentId ||
      artifact.origin.intakeId !== review.intakeId ||
      artifact.origin.intakeArtifactId !== review.intakeArtifactId ||
      artifact.origin.intakeReceiptId !== review.intakeReceiptId ||
      artifact.origin.intakeReceiptContentId !== review.intakeReceiptContentId ||
      !sameCanonical(artifact.sourceArtifactIds, [review.intakeArtifactId]) ||
      completion.data.outputArtifactId !== artifact.id ||
      completion.data.receiptContentId !== review.receiptContentId
    ) throw new Error(`Publish-review decision artifact ${artifact.id} does not close against the journal`);

    const stored = await storedJson(artifacts, review.receiptContentId);
    validatePublishReviewDecisionReceipt(stored.value, "Publish-review decision verification", "receipt");
    const receipt = stored.value;
    if (
      artifact.content.bytes !== stored.bytes ||
      receipt.receiptId !== decisionReceiptId(receipt) ||
      receipt.receiptId !== review.receiptId ||
      receipt.reviewId !== review.id ||
      !sameCanonical(started.data.request.intake, receipt.input.intake) ||
      started.data.request.reviewer.id !== receipt.reviewer.id ||
      started.data.reviewerLabel !== receipt.reviewer.label ||
      !sameCanonical(started.data.request.decision, receipt.decision) ||
      !sameCanonical(completion.data.receipt, receipt) ||
      receipt.reviewer.id !== review.reviewerId ||
      receipt.reviewer.label !== review.reviewerLabel ||
      receipt.decision.outcome !== review.outcome ||
      !sameCanonical(receipt.decision.reasonCodes, review.reasonCodes) ||
      receipt.decision.note !== review.note
    ) throw new Error(`Stored publish-review decision ${receipt.receiptId} changed its reviewer, input, or completion`);

    const intake = intakes.find((candidate) =>
      candidate.intakeId === receipt.input.intake.intakeId &&
      candidate.artifactId === receipt.input.intake.artifactId &&
      candidate.receiptId === receipt.input.intake.receiptId &&
      candidate.receiptContentId === receipt.input.intake.receiptContentId);
    if (
      !intake || intake.outcome !== "queued" ||
      receipt.input.verification.integrity !== intake.integrity ||
      receipt.input.verification.producer !== intake.producer ||
      receipt.input.verification.outcome !== intake.outcome
    ) throw new Error(`Stored publish-review decision ${receipt.receiptId} no longer has verified queued intake`);

    verified.push({
      reviewId: review.id,
      artifactId: artifact.id,
      receiptId: receipt.receiptId,
      receiptContentId: review.receiptContentId,
      integrity: "stored_review_and_verified_queued_intake",
      producer: "host_publish_review_v1",
      intake: structuredClone(receipt.input.intake),
      readiness: structuredClone(intake.readiness),
      reviewer: {
        id: receipt.reviewer.id,
        label: receipt.reviewer.label,
        attestation: receipt.reviewer.attestation.statement,
      },
      outcome: receipt.decision.outcome,
      reasonCodes: [...receipt.decision.reasonCodes],
      note: receipt.decision.note,
      state: receipt.decision.outcome === "approve_for_caption_production"
        ? "approved_for_caption_production"
        : "rejected",
      revocation: null,
    });
  }

  const completedRevocations = Object.values(state.publishReviewRevocations)
    .filter((revocation) => revocation.status === "completed")
    .sort((left, right) => left.id.localeCompare(right.id));
  for (const revocation of completedRevocations) {
    if (!revocation.artifactId || !revocation.receiptId || !revocation.receiptContentId) {
      throw new Error(`Completed publish-review revocation ${revocation.id} has an incomplete projection`);
    }
    const approval = verified.find((review) =>
      review.reviewId === revocation.reviewId &&
      review.artifactId === revocation.approvalArtifactId &&
      review.receiptId === revocation.approvalReceiptId &&
      review.receiptContentId === revocation.approvalReceiptContentId);
    if (!approval || approval.outcome !== "approve_for_caption_production" || approval.revocation !== null) {
      throw new Error(`Publish-review revocation ${revocation.id} has no exact verified approval`);
    }
    const artifact = state.artifacts[revocation.artifactId];
    const started = events.find((event) =>
      event.type === "publish.review.revocation_started" && event.data.revocationId === revocation.id);
    const completion = events.find((event) =>
      event.type === "publish.review.revocation_completed" && event.data.revocationId === revocation.id);
    if (
      !artifact || artifact.origin.kind !== "publish_review_revocation" ||
      !started || started.type !== "publish.review.revocation_started" ||
      !completion || completion.type !== "publish.review.revocation_completed"
    ) throw new Error(`Completed publish-review revocation ${revocation.id} has no closed journal/artifact lineage`);

    const expectedArtifactId = `artifact:${canonicalSha256({
      runId: state.runId,
      revocationId: revocation.id,
      kind: "publish-review-revocation-receipt",
      contentId: revocation.receiptContentId,
    })}`;
    if (
      artifact.id !== expectedArtifactId ||
      artifact.runId !== state.runId ||
      artifact.kind !== "publish-review-revocation-receipt" ||
      artifact.mediaClass !== "non_media" ||
      artifact.publication !== "private" ||
      artifact.content.contentId !== revocation.receiptContentId ||
      artifact.storageKey !== expectedStorageKey(revocation.receiptContentId) ||
      artifact.producerTaskId !== null ||
      artifact.producerAgentId !== null ||
      artifact.origin.revocationId !== revocation.id ||
      artifact.origin.receiptId !== revocation.receiptId ||
      artifact.origin.receiptContentId !== revocation.receiptContentId ||
      artifact.origin.reviewId !== approval.reviewId ||
      artifact.origin.approvalArtifactId !== approval.artifactId ||
      artifact.origin.approvalReceiptId !== approval.receiptId ||
      artifact.origin.approvalReceiptContentId !== approval.receiptContentId ||
      !sameCanonical(artifact.sourceArtifactIds, [approval.artifactId]) ||
      completion.data.outputArtifactId !== artifact.id ||
      completion.data.receiptContentId !== revocation.receiptContentId
    ) throw new Error(`Publish-review revocation artifact ${artifact.id} does not close against the journal`);

    const stored = await storedJson(artifacts, revocation.receiptContentId);
    validatePublishReviewRevocationReceipt(stored.value, "Publish-review revocation verification", "receipt");
    const receipt = stored.value;
    if (
      artifact.content.bytes !== stored.bytes ||
      receipt.receiptId !== revocationReceiptId(receipt) ||
      receipt.receiptId !== revocation.receiptId ||
      receipt.revocationId !== revocation.id ||
      !sameCanonical(started.data.request.approval, receipt.input.approval) ||
      started.data.request.reviewer.id !== receipt.reviewer.id ||
      started.data.reviewerLabel !== receipt.reviewer.label ||
      !sameCanonical(started.data.request.revocation, receipt.revocation) ||
      !sameCanonical(completion.data.receipt, receipt) ||
      receipt.reviewer.id !== revocation.reviewerId ||
      receipt.reviewer.label !== revocation.reviewerLabel ||
      !sameCanonical(receipt.revocation.reasonCodes, revocation.reasonCodes) ||
      receipt.revocation.note !== revocation.note ||
      receipt.input.approval.reviewId !== approval.reviewId ||
      receipt.input.approval.artifactId !== approval.artifactId ||
      receipt.input.approval.receiptId !== approval.receiptId ||
      receipt.input.approval.receiptContentId !== approval.receiptContentId ||
      receipt.input.verification.integrity !== approval.integrity ||
      receipt.input.verification.producer !== approval.producer ||
      receipt.input.verification.outcome !== approval.outcome
    ) throw new Error(`Stored publish-review revocation ${receipt.receiptId} changed its approval, reviewer, or completion`);

    approval.revocation = {
      revocationId: revocation.id,
      artifactId: artifact.id,
      receiptId: receipt.receiptId,
      receiptContentId: revocation.receiptContentId,
      integrity: "stored_revocation_and_verified_approval",
      producer: "host_publish_review_v1",
      reviewer: {
        id: receipt.reviewer.id,
        label: receipt.reviewer.label,
        attestation: receipt.reviewer.attestation.statement,
      },
      reasonCodes: [...receipt.revocation.reasonCodes],
      note: receipt.revocation.note,
    };
    approval.state = "approval_revoked";
  }

  return verified;
}
