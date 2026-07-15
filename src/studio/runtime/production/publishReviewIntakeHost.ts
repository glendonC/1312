import {
  canonicalJsonContentId,
  canonicalSha256,
  ContentAddressedArtifactStore,
} from "./artifactStore.ts";
import { reopenEvidenceDecisionReceipts } from "./decisionReceiptAudit.ts";
import type { RuntimeLedger } from "./journal.ts";
import type {
  EvidenceDecisionReceiptIdentity,
  PublishReviewIntakeReceipt,
} from "./model.ts";
import type { PendingRuntimeEvent } from "./protocol.ts";
import {
  assertPublishReviewIntakeRequest,
  validatePublishReviewIntakeReceipt,
} from "./validation/publishReview.ts";

function sameDecision(
  candidate: Awaited<ReturnType<typeof reopenEvidenceDecisionReceipts>>[number],
  identity: EvidenceDecisionReceiptIdentity,
): boolean {
  return candidate.operationId === identity.operationId &&
    candidate.artifactId === identity.artifactId &&
    candidate.receiptId === identity.receiptId &&
    candidate.receiptContentId === identity.receiptContentId;
}

export interface PublishReviewIntakeHostResult {
  receipt: PublishReviewIntakeReceipt;
  receiptContentId: string;
  outputArtifactId: string;
}

/** Produces queue/reject lineage only after reopening the exact decision at the read-path integrity bar. */
export class PublishReviewIntakeHost {
  private readonly ledger: RuntimeLedger;
  private readonly artifacts: ContentAddressedArtifactStore;

  constructor(ledger: RuntimeLedger, artifacts: ContentAddressedArtifactStore) {
    this.ledger = ledger;
    this.artifacts = artifacts;
  }

  async create(requestValue: unknown): Promise<PublishReviewIntakeHostResult> {
    const decisionIdentity = assertPublishReviewIntakeRequest(requestValue);
    const verifiedDecisions = await reopenEvidenceDecisionReceipts(
      this.ledger.state(),
      await this.ledger.events(),
      this.artifacts,
    );
    const decision = verifiedDecisions.find((candidate) => sameDecision(candidate, decisionIdentity));
    if (!decision) {
      throw new Error("Publish-review intake requires one exact host-verified decision receipt identity");
    }

    const intakeId = `publish-review-intake:${canonicalSha256({
      runId: this.ledger.runId,
      decision: decisionIdentity,
    })}`;
    let started = false;
    try {
      await this.ledger.transact(
        {
          producer: { kind: "publish_review_intake_host", id: "host-publish-review-intake" },
          causationId: decision.operationId,
        },
        ({ state }) => {
          if (state.publishReviewIntakes[intakeId] || Object.values(state.publishReviewIntakes).some((intake) =>
            intake.decisionOperationId === decision.operationId)) {
            throw new Error("Publish-review intake already exists for this verified decision");
          }
          return {
            pending: [{
              type: "publish.review.intake_started",
              data: { intakeId, decision: structuredClone(decisionIdentity) },
            }] satisfies PendingRuntimeEvent[],
            result: undefined,
          };
        },
      );
      started = true;

      const body = {
        intakeId,
        input: {
          decision: structuredClone(decisionIdentity),
          verification: {
            integrity: decision.integrity,
            producer: decision.producer,
          },
        },
        producer: {
          id: "studio.host-publish-review-intake" as const,
          version: "1" as const,
          policy: "queue_verified_proceed_reject_verified_withheld" as const,
        },
        result: {
          outcome: decision.outcome === "proceed_to_publish_review" ? "queued" as const : "rejected" as const,
          reasonCodes: [...decision.reasonCodes],
        },
      };
      const receipt: PublishReviewIntakeReceipt = {
        schema: "studio.publish-review-intake.receipt.v1",
        receiptId: `publish-review-intake-receipt:${canonicalSha256(body)}`,
        ...body,
      };
      validatePublishReviewIntakeReceipt(receipt);
      const stored = await this.artifacts.storeJson(receipt);
      if (canonicalJsonContentId(receipt) !== stored.content.contentId) {
        throw new Error("Stored publish-review intake changed its canonical content identity");
      }
      const artifact = this.artifacts.buildPublishReviewIntakeArtifact({
        runId: this.ledger.runId,
        receipt,
        storedReceipt: stored,
      });
      await this.artifacts.record(this.ledger, artifact, intakeId);
      await this.ledger.transact(
        {
          producer: { kind: "publish_review_intake_host", id: "host-publish-review-intake" },
          causationId: intakeId,
        },
        () => ({
          pending: [{
            type: "publish.review.intake_completed",
            data: {
              intakeId,
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
      if (started && this.ledger.state().publishReviewIntakes[intakeId]?.status === "started") {
        await this.ledger.transact(
          {
            producer: { kind: "publish_review_intake_host", id: "host-publish-review-intake" },
            causationId: intakeId,
          },
          () => ({
            pending: [{
              type: "publish.review.intake_failed",
              data: { intakeId, reason: "The publish-review intake failed closed." },
            }] satisfies PendingRuntimeEvent[],
            result: undefined,
          }),
        );
      }
      throw error;
    }
  }
}
