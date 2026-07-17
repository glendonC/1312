import {
  canonicalJsonContentId,
  canonicalSha256,
  ContentAddressedArtifactStore,
} from "../artifactStore.ts";
import type { RuntimeLedger } from "../journal.ts";
import type {
  PublishReviewIntakeReceipt,
  StudyReadinessReceiptIdentity,
} from "../model.ts";
import type { PendingRuntimeEvent } from "../protocol.ts";
import { reopenStudyReadiness, type VerifiedStudyReadiness } from "../study/studyReadinessAudit.ts";
import { reopenGeneralizedReadiness } from "../study/generalizedStudyRuntime.ts";
import { reopenRestudiedReadiness } from "../study/restudiedStudyRuntime.ts";
import {
  assertPublishReviewIntakeRequest,
  validatePublishReviewIntakeReceipt,
} from "../validation/publishReview.ts";

function sameReadiness(
  candidate: VerifiedStudyReadiness,
  identity: StudyReadinessReceiptIdentity,
): boolean {
  return candidate.readinessId === identity.readinessId &&
    candidate.artifactId === identity.artifactId &&
    candidate.receiptId === identity.receiptId &&
    candidate.receiptContentId === identity.receiptContentId;
}

export interface PublishReviewIntakeHostResult {
  receipt: PublishReviewIntakeReceipt;
  receiptContentId: string;
  outputArtifactId: string;
}

/** Produces queue/reject lineage only after recursively reopening the exact deterministic study-readiness gate. */
export class PublishReviewIntakeHost {
  private readonly ledger: RuntimeLedger;
  private readonly artifacts: ContentAddressedArtifactStore;

  constructor(ledger: RuntimeLedger, artifacts: ContentAddressedArtifactStore) {
    this.ledger = ledger;
    this.artifacts = artifacts;
  }

  async create(requestValue: unknown): Promise<PublishReviewIntakeHostResult> {
    const readinessIdentity = assertPublishReviewIntakeRequest(requestValue);
    const generalized = this.ledger.state().generalizedStudyReadiness[readinessIdentity.readinessId];
    const readiness = generalized
      ? generalized.schema === "studio.study-readiness.receipt.v4"
        ? await reopenRestudiedReadiness(this.ledger, this.artifacts, readinessIdentity.readinessId)
        : await reopenGeneralizedReadiness(this.ledger, this.artifacts, readinessIdentity.readinessId)
      : await reopenStudyReadiness(this.ledger.state(), this.artifacts, readinessIdentity.readinessId);
    if (
      readiness.readinessId !== readinessIdentity.readinessId ||
      (generalized ? generalized.artifactId : (readiness as VerifiedStudyReadiness).artifactId) !== readinessIdentity.artifactId ||
      readiness.receiptId !== readinessIdentity.receiptId ||
      readiness.receiptContentId !== readinessIdentity.receiptContentId
    ) {
      throw new Error("Publish-review intake requires one exact recursively verified study-readiness receipt identity");
    }

    const intakeId = `publish-review-intake:${canonicalSha256({
      runId: this.ledger.runId,
      readiness: readinessIdentity,
    })}`;
    let started = false;
    try {
      await this.ledger.transact(
        {
          producer: { kind: "publish_review_intake_host", id: "host-publish-review-intake" },
          causationId: readiness.readinessId,
        },
        ({ state }) => {
          if (state.publishReviewIntakes[intakeId] || Object.values(state.publishReviewIntakes).some((intake) =>
            intake.readinessId === readiness.readinessId)) {
            throw new Error("Publish-review intake already exists for this verified study readiness");
          }
          return {
            pending: [{
              type: "publish.review.intake_started",
              data: { intakeId, readiness: structuredClone(readinessIdentity) },
            }] satisfies PendingRuntimeEvent[],
            result: undefined,
          };
        },
      );
      started = true;

      const body = {
        intakeId,
        input: {
          readiness: structuredClone(readinessIdentity),
          verification: {
            integrity: "stored_study_readiness_and_recursive_inputs_verified" as const,
            producer: generalized
              ? generalized.schema === "studio.study-readiness.receipt.v4"
                ? "deterministic_study_readiness_gate_v4" as const
                : "deterministic_study_readiness_gate_v3" as const
              : "deterministic_study_readiness_gate_v1" as const,
          },
        },
        producer: {
          id: "studio.host-publish-review-intake" as const,
          version: "1" as const,
          policy: "queue_exact_verified_study_readiness_only" as const,
        },
        result: {
          outcome: readiness.receipt.result.outcome === "proceed_to_caption_review" ? "queued" as const : "rejected" as const,
          reasonCodes: [...readiness.receipt.result.reasonCodes],
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
