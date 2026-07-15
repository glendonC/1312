import { createHash } from "node:crypto";

import {
  canonicalJsonContentId,
  canonicalSha256,
  ContentAddressedArtifactStore,
} from "./artifactStore.ts";
import { reopenEvidenceDecisionReceipts } from "./decisionReceiptAudit.ts";
import type {
  EvidenceDecisionReasonCode,
  EvidenceDecisionReceiptIdentity,
  PublishReviewIntakeOutcome,
  PublishReviewIntakeReceipt,
  RuntimeProjection,
} from "./model.ts";
import type { RuntimeEvent } from "./protocol.ts";
import { validatePublishReviewIntakeReceipt } from "./validation/publishReview.ts";

const MAX_STORED_PUBLISH_REVIEW_INTAKE_BYTES = 64 * 1024;

export interface PublishReviewIntakeVerification {
  intakeId: string;
  artifactId: string;
  receiptId: string;
  receiptContentId: string;
  integrity: "stored_intake_and_verified_decision_receipt";
  producer: "host_publish_review_intake_v1";
  decision: EvidenceDecisionReceiptIdentity;
  outcome: PublishReviewIntakeOutcome;
  reasonCodes: EvidenceDecisionReasonCode[];
}

function expectedStorageKey(contentId: string): string {
  const digest = contentId.replace(/^sha256:/, "");
  return `objects/sha256/${digest.slice(0, 2)}/${digest}`;
}

function sameCanonical(left: unknown, right: unknown): boolean {
  return canonicalSha256(left) === canonicalSha256(right);
}

function intakeReceiptId(receipt: PublishReviewIntakeReceipt): string {
  const body = structuredClone(receipt) as unknown as Record<string, unknown>;
  delete body.schema;
  delete body.receiptId;
  return `publish-review-intake-receipt:${canonicalSha256(body)}`;
}

async function storedReceipt(
  artifacts: ContentAddressedArtifactStore,
  contentId: string,
): Promise<{ receipt: PublishReviewIntakeReceipt; bytes: number }> {
  const bytes = await artifacts.receiptBytes(contentId);
  if (bytes.byteLength <= 0 || bytes.byteLength > MAX_STORED_PUBLISH_REVIEW_INTAKE_BYTES) {
    throw new Error("Stored publish-review intake receipt exceeds its byte bound");
  }
  const measured = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  if (measured !== contentId) throw new Error("Stored publish-review intake receipt changed content identity");
  let value: unknown;
  try {
    value = JSON.parse(bytes.toString("utf8")) as unknown;
  } catch {
    throw new Error("Stored publish-review intake receipt is invalid JSON");
  }
  if (canonicalJsonContentId(value) !== contentId) {
    throw new Error("Stored publish-review intake receipt is not canonical JSON");
  }
  validatePublishReviewIntakeReceipt(value, "Publish-review intake verification", "receipt");
  return { receipt: value, bytes: bytes.byteLength };
}

/** Reopens intake bytes and re-verifies the exact underlying decision and all of its audits. */
export async function reopenPublishReviewIntakes(
  state: RuntimeProjection,
  events: readonly RuntimeEvent[],
  artifacts: ContentAddressedArtifactStore,
): Promise<PublishReviewIntakeVerification[]> {
  const decisions = await reopenEvidenceDecisionReceipts(state, events, artifacts);
  const verified: PublishReviewIntakeVerification[] = [];
  const completed = Object.values(state.publishReviewIntakes)
    .filter((intake) => intake.status === "completed")
    .sort((left, right) => left.id.localeCompare(right.id));

  for (const intake of completed) {
    if (!intake.artifactId || !intake.receiptId || !intake.receiptContentId || !intake.outcome) {
      throw new Error(`Completed publish-review intake ${intake.id} has an incomplete projection`);
    }
    const artifact = state.artifacts[intake.artifactId];
    const started = events.find((event) =>
      event.type === "publish.review.intake_started" && event.data.intakeId === intake.id);
    const completion = events.find((event) =>
      event.type === "publish.review.intake_completed" && event.data.intakeId === intake.id);
    if (
      !artifact || artifact.origin.kind !== "publish_review_intake" ||
      !started || started.type !== "publish.review.intake_started" ||
      !completion || completion.type !== "publish.review.intake_completed"
    ) throw new Error(`Completed publish-review intake ${intake.id} has no closed journal/artifact lineage`);

    const expectedArtifactId = `artifact:${canonicalSha256({
      runId: state.runId,
      intakeId: intake.id,
      kind: "publish-review-intake-receipt",
      contentId: intake.receiptContentId,
    })}`;
    if (
      artifact.id !== expectedArtifactId ||
      artifact.runId !== state.runId ||
      artifact.kind !== "publish-review-intake-receipt" ||
      artifact.mediaClass !== "non_media" ||
      artifact.publication !== "private" ||
      artifact.content.contentId !== intake.receiptContentId ||
      artifact.storageKey !== expectedStorageKey(intake.receiptContentId) ||
      artifact.producerTaskId !== null ||
      artifact.producerAgentId !== null ||
      artifact.origin.intakeId !== intake.id ||
      artifact.origin.receiptId !== intake.receiptId ||
      artifact.origin.receiptContentId !== intake.receiptContentId ||
      completion.data.outputArtifactId !== artifact.id ||
      completion.data.receiptContentId !== intake.receiptContentId
    ) throw new Error(`Publish-review intake artifact ${artifact.id} does not close against the journal`);

    const stored = await storedReceipt(artifacts, intake.receiptContentId);
    const receipt = stored.receipt;
    const identity = receipt.input.decision;
    if (
      artifact.content.bytes !== stored.bytes ||
      receipt.receiptId !== intakeReceiptId(receipt) ||
      receipt.receiptId !== intake.receiptId ||
      receipt.intakeId !== intake.id ||
      !sameCanonical(started.data.decision, identity) ||
      !sameCanonical(completion.data.receipt, receipt) ||
      artifact.origin.decisionOperationId !== identity.operationId ||
      artifact.origin.decisionArtifactId !== identity.artifactId ||
      artifact.origin.decisionReceiptId !== identity.receiptId ||
      artifact.origin.decisionReceiptContentId !== identity.receiptContentId ||
      !sameCanonical(artifact.sourceArtifactIds, [identity.artifactId])
    ) throw new Error(`Stored publish-review intake ${receipt.receiptId} changed its decision identity or completion`);

    const decision = decisions.find((candidate) =>
      candidate.operationId === identity.operationId &&
      candidate.artifactId === identity.artifactId &&
      candidate.receiptId === identity.receiptId &&
      candidate.receiptContentId === identity.receiptContentId);
    if (!decision) {
      throw new Error(`Stored publish-review intake ${receipt.receiptId} no longer has a verified decision input`);
    }
    const expectedOutcome = decision.outcome === "proceed_to_publish_review" ? "queued" : "rejected";
    if (
      receipt.input.verification.integrity !== decision.integrity ||
      receipt.input.verification.producer !== decision.producer ||
      receipt.result.outcome !== expectedOutcome ||
      receipt.result.outcome !== intake.outcome ||
      !sameCanonical(receipt.result.reasonCodes, decision.reasonCodes) ||
      !sameCanonical(receipt.result.reasonCodes, intake.reasonCodes)
    ) throw new Error(`Stored publish-review intake ${receipt.receiptId} no longer matches verified decision policy`);

    verified.push({
      intakeId: intake.id,
      artifactId: artifact.id,
      receiptId: receipt.receiptId,
      receiptContentId: intake.receiptContentId,
      integrity: "stored_intake_and_verified_decision_receipt",
      producer: "host_publish_review_intake_v1",
      decision: structuredClone(identity),
      outcome: receipt.result.outcome,
      reasonCodes: [...receipt.result.reasonCodes],
    });
  }
  return verified;
}
