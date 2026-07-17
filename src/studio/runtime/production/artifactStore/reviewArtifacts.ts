import { assertRuntimeArtifact } from "../assertions.ts";
import type {
  ContentIdentity,
  PublishReviewDecisionReceipt,
  PublishReviewIntakeReceipt,
  PublishReviewRevocationReceipt,
  RuntimeArtifact,
} from "../model.ts";
import { canonicalSha256 } from "./contentIdentity.ts";

export function buildPublishReviewIntakeArtifact(input: {
    runId: string;
    receipt: PublishReviewIntakeReceipt;
    storedReceipt: { content: ContentIdentity; storageKey: string };
  }): RuntimeArtifact {
    const readiness = input.receipt.input.readiness;
    const artifact: RuntimeArtifact = {
      schema: "studio.runtime.artifact.v1",
      id: `artifact:${canonicalSha256({
        runId: input.runId,
        intakeId: input.receipt.intakeId,
        kind: "publish-review-intake-receipt",
        contentId: input.storedReceipt.content.contentId,
      })}`,
      runId: input.runId,
      kind: "publish-review-intake-receipt",
      mediaClass: "non_media",
      publication: "private",
      content: input.storedReceipt.content,
      storageKey: input.storedReceipt.storageKey,
      durationMs: null,
      tracks: [],
      sourceArtifactIds: [readiness.artifactId],
      producerTaskId: null,
      producerAgentId: null,
      origin: {
        kind: "publish_review_intake",
        intakeId: input.receipt.intakeId,
        receiptId: input.receipt.receiptId,
        receiptContentId: input.storedReceipt.content.contentId,
        readinessId: readiness.readinessId,
        readinessArtifactId: readiness.artifactId,
        readinessReceiptId: readiness.receiptId,
        readinessReceiptContentId: readiness.receiptContentId,
      },
    };
    assertRuntimeArtifact(artifact);
    return artifact;
  }

export function buildPublishReviewDecisionArtifact(input: {
    runId: string;
    receipt: PublishReviewDecisionReceipt;
    storedReceipt: { content: ContentIdentity; storageKey: string };
  }): RuntimeArtifact {
    const intake = input.receipt.input.intake;
    const artifact: RuntimeArtifact = {
      schema: "studio.runtime.artifact.v1",
      id: `artifact:${canonicalSha256({
        runId: input.runId,
        reviewId: input.receipt.reviewId,
        kind: "publish-review-decision-receipt",
        contentId: input.storedReceipt.content.contentId,
      })}`,
      runId: input.runId,
      kind: "publish-review-decision-receipt",
      mediaClass: "non_media",
      publication: "private",
      content: input.storedReceipt.content,
      storageKey: input.storedReceipt.storageKey,
      durationMs: null,
      tracks: [],
      sourceArtifactIds: [intake.artifactId],
      producerTaskId: null,
      producerAgentId: null,
      origin: {
        kind: "publish_review_decision",
        reviewId: input.receipt.reviewId,
        receiptId: input.receipt.receiptId,
        receiptContentId: input.storedReceipt.content.contentId,
        intakeId: intake.intakeId,
        intakeArtifactId: intake.artifactId,
        intakeReceiptId: intake.receiptId,
        intakeReceiptContentId: intake.receiptContentId,
      },
    };
    assertRuntimeArtifact(artifact);
    return artifact;
  }

export function buildPublishReviewRevocationArtifact(input: {
    runId: string;
    receipt: PublishReviewRevocationReceipt;
    storedReceipt: { content: ContentIdentity; storageKey: string };
  }): RuntimeArtifact {
    const approval = input.receipt.input.approval;
    const artifact: RuntimeArtifact = {
      schema: "studio.runtime.artifact.v1",
      id: `artifact:${canonicalSha256({
        runId: input.runId,
        revocationId: input.receipt.revocationId,
        kind: "publish-review-revocation-receipt",
        contentId: input.storedReceipt.content.contentId,
      })}`,
      runId: input.runId,
      kind: "publish-review-revocation-receipt",
      mediaClass: "non_media",
      publication: "private",
      content: input.storedReceipt.content,
      storageKey: input.storedReceipt.storageKey,
      durationMs: null,
      tracks: [],
      sourceArtifactIds: [approval.artifactId],
      producerTaskId: null,
      producerAgentId: null,
      origin: {
        kind: "publish_review_revocation",
        revocationId: input.receipt.revocationId,
        receiptId: input.receipt.receiptId,
        receiptContentId: input.storedReceipt.content.contentId,
        reviewId: approval.reviewId,
        approvalArtifactId: approval.artifactId,
        approvalReceiptId: approval.receiptId,
        approvalReceiptContentId: approval.receiptContentId,
      },
    };
    assertRuntimeArtifact(artifact);
    return artifact;
  }
