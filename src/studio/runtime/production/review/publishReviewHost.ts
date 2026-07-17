import {
  canonicalJsonContentId,
  canonicalSha256,
  ContentAddressedArtifactStore,
} from "../artifactStore.ts";
import type { RuntimeLedger } from "../journal.ts";
import type {
  PublishReviewDecisionReceipt,
  PublishReviewDecisionRequest,
  PublishReviewOperator,
  PublishReviewRevocationReceipt,
  PublishReviewRevocationRequest,
} from "../model.ts";
import { reopenPublishReviewIntakes } from "./publishReviewIntakeAudit.ts";
import { reopenPublishReviewDecisions } from "./publishReviewDecisionAudit.ts";
import type { PendingRuntimeEvent } from "../protocol.ts";
import {
  assertPublishReviewDecisionRequest,
  assertPublishReviewRevocationRequest,
  validatePublishReviewDecisionReceipt,
  validatePublishReviewOperator,
  validatePublishReviewRevocationReceipt,
} from "../validation/publishReviewDecision.ts";

export type PublishReviewHostErrorCode =
  | "reviewer_identity_mismatch"
  | "verified_queued_intake_required"
  | "verified_approval_required"
  | "illegal_review_transition"
  | "stored_lineage_invalid";

export class PublishReviewHostError extends Error {
  readonly code: PublishReviewHostErrorCode;

  constructor(code: PublishReviewHostErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "PublishReviewHostError";
    this.code = code;
  }
}

export interface PublishReviewDecisionHostResult {
  receipt: PublishReviewDecisionReceipt;
  receiptContentId: string;
  outputArtifactId: string;
}

export interface PublishReviewRevocationHostResult {
  receipt: PublishReviewRevocationReceipt;
  receiptContentId: string;
  outputArtifactId: string;
}

/** Host-authoritative human review over verified queued intake; it has no caption or publication capability. */
export class PublishReviewHost {
  private readonly ledger: RuntimeLedger;
  private readonly artifacts: ContentAddressedArtifactStore;
  private readonly reviewer: PublishReviewOperator;

  constructor(
    ledger: RuntimeLedger,
    artifacts: ContentAddressedArtifactStore,
    reviewerValue: unknown,
  ) {
    this.ledger = ledger;
    this.artifacts = artifacts;
    this.reviewer = validatePublishReviewOperator(reviewerValue);
  }

  private assertReviewer(reviewerId: string): void {
    if (reviewerId !== this.reviewer.id) {
      throw new PublishReviewHostError(
        "reviewer_identity_mismatch",
        "The attested reviewer id does not match the host-configured review operator",
      );
    }
  }

  async decide(requestValue: unknown): Promise<PublishReviewDecisionHostResult> {
    const request: PublishReviewDecisionRequest = assertPublishReviewDecisionRequest(requestValue);
    this.assertReviewer(request.reviewer.id);
    let verifiedIntakes;
    try {
      verifiedIntakes = await reopenPublishReviewIntakes(
        this.ledger.state(),
        await this.ledger.events(),
        this.artifacts,
      );
    } catch (error) {
      throw new PublishReviewHostError(
        "stored_lineage_invalid",
        "The publish-review intake lineage failed closed verification",
        { cause: error },
      );
    }
    const intake = verifiedIntakes.find((candidate) =>
      candidate.intakeId === request.intake.intakeId &&
      candidate.artifactId === request.intake.artifactId &&
      candidate.receiptId === request.intake.receiptId &&
      candidate.receiptContentId === request.intake.receiptContentId
    );
    if (!intake || intake.outcome !== "queued") {
      throw new PublishReviewHostError(
        "verified_queued_intake_required",
        "Publish review requires one exact host-verified queued intake identity",
      );
    }

    const reviewId = `publish-review:${canonicalSha256({
      runId: this.ledger.runId,
      intake: request.intake,
    })}`;
    let started = false;
    try {
      await this.ledger.transact(
        {
          producer: { kind: "publish_review_host", id: "host-publish-review" },
          causationId: intake.intakeId,
        },
        ({ state }) => {
          if (
            state.publishReviewDecisions[reviewId] ||
            Object.values(state.publishReviewDecisions).some((review) => review.intakeId === intake.intakeId)
          ) {
            throw new PublishReviewHostError(
              "illegal_review_transition",
              "The queued intake already has immutable review decision lineage",
            );
          }
          return {
            pending: [{
              type: "publish.review.decision_started",
              data: {
                reviewId,
                request: structuredClone(request),
                reviewerLabel: this.reviewer.label,
              },
            }] satisfies PendingRuntimeEvent[],
            result: undefined,
          };
        },
      );
      started = true;

      const body = {
        reviewId,
        input: {
          intake: structuredClone(request.intake),
          verification: {
            integrity: intake.integrity,
            producer: intake.producer,
            outcome: "queued" as const,
          },
        },
        reviewer: {
          ...structuredClone(this.reviewer),
          attestation: {
            kind: "local_operator_attestation_v1" as const,
            statement: request.reviewer.attestation,
          },
        },
        producer: {
          id: "studio.host-publish-review" as const,
          version: "1" as const,
          policy: "attested_review_of_verified_queued_intake" as const,
        },
        decision: structuredClone(request.decision),
      };
      const receipt: PublishReviewDecisionReceipt = {
        schema: "studio.publish-review-decision.receipt.v1",
        receiptId: `publish-review-decision-receipt:${canonicalSha256(body)}`,
        ...body,
      };
      validatePublishReviewDecisionReceipt(receipt);
      const stored = await this.artifacts.storeJson(receipt);
      if (canonicalJsonContentId(receipt) !== stored.content.contentId) {
        throw new Error("Stored publish-review decision changed its canonical content identity");
      }
      const artifact = this.artifacts.buildPublishReviewDecisionArtifact({
        runId: this.ledger.runId,
        receipt,
        storedReceipt: stored,
      });
      await this.artifacts.record(this.ledger, artifact, reviewId);
      await this.ledger.transact(
        {
          producer: { kind: "publish_review_host", id: "host-publish-review" },
          causationId: reviewId,
        },
        () => ({
          pending: [{
            type: "publish.review.decision_completed",
            data: {
              reviewId,
              outputArtifactId: artifact.id,
              receiptContentId: stored.content.contentId,
              receipt,
            },
          }] satisfies PendingRuntimeEvent[],
          result: undefined,
        }),
      );
      return { receipt, receiptContentId: stored.content.contentId, outputArtifactId: artifact.id };
    } catch (error) {
      if (started && this.ledger.state().publishReviewDecisions[reviewId]?.status === "started") {
        await this.ledger.transact(
          {
            producer: { kind: "publish_review_host", id: "host-publish-review" },
            causationId: reviewId,
          },
          () => ({
            pending: [{
              type: "publish.review.decision_failed",
              data: { reviewId, reason: "The publish-review decision failed closed." },
            }] satisfies PendingRuntimeEvent[],
            result: undefined,
          }),
        );
      }
      throw error;
    }
  }

  async revoke(requestValue: unknown): Promise<PublishReviewRevocationHostResult> {
    const request: PublishReviewRevocationRequest = assertPublishReviewRevocationRequest(requestValue);
    this.assertReviewer(request.reviewer.id);
    let verifiedReviews;
    try {
      verifiedReviews = await reopenPublishReviewDecisions(
        this.ledger.state(),
        await this.ledger.events(),
        this.artifacts,
      );
    } catch (error) {
      throw new PublishReviewHostError(
        "stored_lineage_invalid",
        "The publish-review approval lineage failed closed verification",
        { cause: error },
      );
    }
    const approval = verifiedReviews.find((candidate) =>
      candidate.reviewId === request.approval.reviewId &&
      candidate.artifactId === request.approval.artifactId &&
      candidate.receiptId === request.approval.receiptId &&
      candidate.receiptContentId === request.approval.receiptContentId
    );
    if (!approval || approval.outcome !== "approve_for_caption_production" || approval.revocation !== null) {
      throw new PublishReviewHostError(
        "verified_approval_required",
        "Revocation requires one exact unrevoked host-verified approval identity",
      );
    }

    const revocationId = `publish-review-revocation:${canonicalSha256({
      runId: this.ledger.runId,
      approval: request.approval,
    })}`;
    let started = false;
    try {
      await this.ledger.transact(
        {
          producer: { kind: "publish_review_host", id: "host-publish-review" },
          causationId: approval.reviewId,
        },
        ({ state }) => {
          if (
            state.publishReviewRevocations[revocationId] ||
            Object.values(state.publishReviewRevocations).some((revocation) =>
              revocation.reviewId === approval.reviewId)
          ) {
            throw new PublishReviewHostError(
              "illegal_review_transition",
              "The approval already has immutable revocation lineage",
            );
          }
          return {
            pending: [{
              type: "publish.review.revocation_started",
              data: {
                revocationId,
                request: structuredClone(request),
                reviewerLabel: this.reviewer.label,
              },
            }] satisfies PendingRuntimeEvent[],
            result: undefined,
          };
        },
      );
      started = true;

      const body = {
        revocationId,
        input: {
          approval: structuredClone(request.approval),
          verification: {
            integrity: approval.integrity,
            producer: approval.producer,
            outcome: "approve_for_caption_production" as const,
          },
        },
        reviewer: {
          ...structuredClone(this.reviewer),
          attestation: {
            kind: "local_operator_attestation_v1" as const,
            statement: request.reviewer.attestation,
          },
        },
        producer: {
          id: "studio.host-publish-review" as const,
          version: "1" as const,
          policy: "immutable_revocation_of_verified_approval" as const,
        },
        revocation: structuredClone(request.revocation),
        result: { state: "approval_revoked" as const },
      };
      const receipt: PublishReviewRevocationReceipt = {
        schema: "studio.publish-review-revocation.receipt.v1",
        receiptId: `publish-review-revocation-receipt:${canonicalSha256(body)}`,
        ...body,
      };
      validatePublishReviewRevocationReceipt(receipt);
      const stored = await this.artifacts.storeJson(receipt);
      if (canonicalJsonContentId(receipt) !== stored.content.contentId) {
        throw new Error("Stored publish-review revocation changed its canonical content identity");
      }
      const artifact = this.artifacts.buildPublishReviewRevocationArtifact({
        runId: this.ledger.runId,
        receipt,
        storedReceipt: stored,
      });
      await this.artifacts.record(this.ledger, artifact, revocationId);
      await this.ledger.transact(
        {
          producer: { kind: "publish_review_host", id: "host-publish-review" },
          causationId: revocationId,
        },
        () => ({
          pending: [{
            type: "publish.review.revocation_completed",
            data: {
              revocationId,
              outputArtifactId: artifact.id,
              receiptContentId: stored.content.contentId,
              receipt,
            },
          }] satisfies PendingRuntimeEvent[],
          result: undefined,
        }),
      );
      return { receipt, receiptContentId: stored.content.contentId, outputArtifactId: artifact.id };
    } catch (error) {
      if (started && this.ledger.state().publishReviewRevocations[revocationId]?.status === "started") {
        await this.ledger.transact(
          {
            producer: { kind: "publish_review_host", id: "host-publish-review" },
            causationId: revocationId,
          },
          () => ({
            pending: [{
              type: "publish.review.revocation_failed",
              data: { revocationId, reason: "The publish-review revocation failed closed." },
            }] satisfies PendingRuntimeEvent[],
            result: undefined,
          }),
        );
      }
      throw error;
    }
  }
}
