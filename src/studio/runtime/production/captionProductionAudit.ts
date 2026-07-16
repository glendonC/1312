import { createHash } from "node:crypto";

import {
  canonicalJsonContentId,
  canonicalSha256,
  ContentAddressedArtifactStore,
  createCaptionArtifactId,
} from "./artifactStore.ts";
import type {
  CaptionExecutorDescriptor,
  CaptionProductionArtifact,
  CaptionProductionReceipt,
  CaptionProductionStatus,
  RuntimeProjection,
} from "./model.ts";
import { CAPTION_PRODUCTION_LIMITS } from "./model.ts";
import { reopenPublishReviewDecisions } from "./publishReviewDecisionAudit.ts";
import type { RuntimeEvent } from "./protocol.ts";
import {
  validateCaptionProductionArtifact,
  validateCaptionProductionReceipt,
} from "./validation/captionProduction.ts";

export interface CaptionProductionVerification {
  jobId: string;
  approval: {
    reviewId: string;
    artifactId: string;
    receiptId: string;
    receiptContentId: string;
  };
  authorityState: "unrevoked" | "revoked_after_completion";
  integrity: "stored_caption_and_receipt_with_verified_approval";
  captionArtifactId: string;
  captionContentId: string;
  receiptArtifactId: string;
  receiptId: string;
  receiptContentId: string;
  executor: CaptionExecutorDescriptor;
  result: {
    status: CaptionProductionStatus;
    lineCount: number;
    sourceAvailableCount: number;
    targetAvailableCount: number;
    withheldCount: number;
    unavailableCount: number;
  };
}

export interface VerifiedCaptionProductionResult {
  verification: CaptionProductionVerification;
  artifact: CaptionProductionArtifact;
}

function expectedStorageKey(contentId: string): string {
  const digest = contentId.replace(/^sha256:/, "");
  return `objects/sha256/${digest.slice(0, 2)}/${digest}`;
}

function sameCanonical(left: unknown, right: unknown): boolean {
  return canonicalSha256(left) === canonicalSha256(right);
}

async function storedJson(
  artifacts: ContentAddressedArtifactStore,
  contentId: string,
): Promise<{ value: unknown; bytes: number }> {
  const bytes = await artifacts.receiptBytes(contentId);
  if (bytes.byteLength <= 0 || bytes.byteLength > CAPTION_PRODUCTION_LIMITS.maxArtifactBytes) {
    throw new Error("Stored caption production exceeds its byte bound");
  }
  const measured = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  if (measured !== contentId) throw new Error("Stored caption production changed content identity");
  let value: unknown;
  try {
    value = JSON.parse(bytes.toString("utf8")) as unknown;
  } catch {
    throw new Error("Stored caption production is invalid JSON");
  }
  if (canonicalJsonContentId(value) !== contentId) {
    throw new Error("Stored caption production is not canonical JSON");
  }
  return { value, bytes: bytes.byteLength };
}

function receiptIdentity(receipt: CaptionProductionReceipt): string {
  const body = structuredClone(receipt) as unknown as Record<string, unknown>;
  delete body.schema;
  delete body.receiptId;
  return `caption-production-receipt:${canonicalSha256(body)}`;
}

/** Reopens immutable KO+EN artifacts and repeats the full approval/revocation integrity audit. */
export async function reopenCaptionProductionResults(
  state: RuntimeProjection,
  events: readonly RuntimeEvent[],
  artifacts: ContentAddressedArtifactStore,
): Promise<VerifiedCaptionProductionResult[]> {
  const reviews = await reopenPublishReviewDecisions(state, events, artifacts);
  const verified: VerifiedCaptionProductionResult[] = [];
  const completed = Object.values(state.captionProductions)
    .filter((job) => job.status === "completed")
    .sort((left, right) => left.id.localeCompare(right.id));

  for (const job of completed) {
    if (
      !job.captionArtifactId || !job.captionContentId || !job.receiptArtifactId ||
      !job.receiptId || !job.receiptContentId || !job.resultStatus ||
      job.lineCount === null || job.sourceAvailableCount === null ||
      job.targetAvailableCount === null || job.withheldCount === null || job.unavailableCount === null
    ) throw new Error(`Completed caption production ${job.id} has an incomplete projection`);

    const approval = reviews.find((review) =>
      review.reviewId === job.approvalReviewId &&
      review.artifactId === job.approvalArtifactId &&
      review.receiptId === job.approvalReceiptId &&
      review.receiptContentId === job.approvalReceiptContentId
    );
    if (!approval || approval.outcome !== "approve_for_caption_production") {
      throw new Error(`Caption production ${job.id} no longer has its exact verified approval`);
    }

    const started = events.find((event) =>
      event.type === "caption.production_started" && event.data.jobId === job.id);
    const completion = events.find((event) =>
      event.type === "caption.production_completed" && event.data.jobId === job.id);
    const captionArtifact = state.artifacts[job.captionArtifactId];
    const receiptArtifact = state.artifacts[job.receiptArtifactId];
    if (
      !started || started.type !== "caption.production_started" ||
      !completion || completion.type !== "caption.production_completed" ||
      !captionArtifact || captionArtifact.origin.kind !== "caption_production_output" ||
      !receiptArtifact || receiptArtifact.origin.kind !== "caption_production_receipt"
    ) throw new Error(`Caption production ${job.id} has no closed journal and artifact lineage`);

    let authorityState: CaptionProductionVerification["authorityState"] = "unrevoked";
    if (approval.revocation) {
      const revocationStart = events.find((event) =>
        event.type === "publish.review.revocation_started" &&
        event.data.revocationId === approval.revocation?.revocationId);
      if (!revocationStart || revocationStart.seq <= completion.seq) {
        throw new Error(`Caption production ${job.id} overlapped or followed approval revocation`);
      }
      authorityState = "revoked_after_completion";
    }

    const expectedCaptionArtifactId = createCaptionArtifactId(state.runId, job.id, job.captionContentId);
    const expectedReceiptArtifactId = `artifact:${canonicalSha256({
      runId: state.runId,
      jobId: job.id,
      kind: "caption-production-receipt",
      contentId: job.receiptContentId,
    })}`;
    if (
      captionArtifact.id !== expectedCaptionArtifactId ||
      captionArtifact.runId !== state.runId || captionArtifact.kind !== "caption-production-output" ||
      captionArtifact.mediaClass !== "non_media" || captionArtifact.publication !== "private" ||
      captionArtifact.content.contentId !== job.captionContentId ||
      captionArtifact.storageKey !== expectedStorageKey(job.captionContentId) ||
      captionArtifact.producerTaskId !== null || captionArtifact.producerAgentId !== null ||
      captionArtifact.origin.jobId !== job.id || captionArtifact.origin.receiptId !== job.receiptId ||
      captionArtifact.origin.receiptContentId !== job.receiptContentId ||
      captionArtifact.origin.approvalReviewId !== approval.reviewId ||
      captionArtifact.origin.approvalArtifactId !== approval.artifactId ||
      captionArtifact.origin.sourceArtifactId !== job.sourceArtifactId ||
      !sameCanonical(captionArtifact.sourceArtifactIds, [job.sourceArtifactId, approval.artifactId]) ||
      receiptArtifact.id !== expectedReceiptArtifactId || receiptArtifact.runId !== state.runId ||
      receiptArtifact.kind !== "caption-production-receipt" || receiptArtifact.mediaClass !== "non_media" ||
      receiptArtifact.publication !== "private" || receiptArtifact.content.contentId !== job.receiptContentId ||
      receiptArtifact.storageKey !== expectedStorageKey(job.receiptContentId) ||
      receiptArtifact.producerTaskId !== null || receiptArtifact.producerAgentId !== null ||
      receiptArtifact.origin.jobId !== job.id || receiptArtifact.origin.receiptId !== job.receiptId ||
      receiptArtifact.origin.receiptContentId !== job.receiptContentId ||
      receiptArtifact.origin.approvalReviewId !== approval.reviewId ||
      receiptArtifact.origin.approvalArtifactId !== approval.artifactId ||
      receiptArtifact.origin.captionArtifactId !== captionArtifact.id ||
      receiptArtifact.origin.captionContentId !== captionArtifact.content.contentId ||
      !sameCanonical(receiptArtifact.sourceArtifactIds, [captionArtifact.id, approval.artifactId]) ||
      completion.data.captionArtifactId !== captionArtifact.id ||
      completion.data.captionContentId !== captionArtifact.content.contentId ||
      completion.data.receiptArtifactId !== receiptArtifact.id ||
      completion.data.receiptContentId !== receiptArtifact.content.contentId
    ) throw new Error(`Caption production ${job.id} artifact identities do not close`);

    const [storedCaption, storedReceipt] = await Promise.all([
      storedJson(artifacts, job.captionContentId),
      storedJson(artifacts, job.receiptContentId),
    ]);
    const caption = validateCaptionProductionArtifact(
      storedCaption.value,
      "Caption-production verification",
      "caption",
    );
    const receipt = validateCaptionProductionReceipt(
      storedReceipt.value,
      "Caption-production verification",
      "receipt",
    );
    if (
      captionArtifact.content.bytes !== storedCaption.bytes ||
      receiptArtifact.content.bytes !== storedReceipt.bytes ||
      caption.jobId !== job.id || caption.runId !== state.runId ||
      !sameCanonical(caption.input, started.data.input) ||
      !sameCanonical(caption.executor, started.data.executor) ||
      receipt.receiptId !== receiptIdentity(receipt) || receipt.receiptId !== job.receiptId ||
      receipt.jobId !== job.id || !sameCanonical(receipt.authority.approval, started.data.request.approval) ||
      !sameCanonical(receipt.authority.approval, {
        reviewId: approval.reviewId,
        artifactId: approval.artifactId,
        receiptId: approval.receiptId,
        receiptContentId: approval.receiptContentId,
      }) ||
      !sameCanonical(receipt.input, caption.input) ||
      !sameCanonical(receipt.producer.executor, caption.executor) ||
      !sameCanonical(receipt.limits, started.data.limits) ||
      receipt.result.captionArtifactId !== captionArtifact.id ||
      receipt.result.captionContentId !== captionArtifact.content.contentId ||
      receipt.result.captionBytes !== captionArtifact.content.bytes ||
      !sameCanonical(caption.result, {
        status: receipt.result.status,
        lineCount: receipt.result.lineCount,
        sourceAvailableCount: receipt.result.sourceAvailableCount,
        targetAvailableCount: receipt.result.targetAvailableCount,
        withheldCount: receipt.result.withheldCount,
        unavailableCount: receipt.result.unavailableCount,
      }) ||
      !sameCanonical(receipt, completion.data.receipt) ||
      receipt.result.status !== job.resultStatus || receipt.result.lineCount !== job.lineCount ||
      receipt.result.sourceAvailableCount !== job.sourceAvailableCount ||
      receipt.result.targetAvailableCount !== job.targetAvailableCount ||
      receipt.result.withheldCount !== job.withheldCount ||
      receipt.result.unavailableCount !== job.unavailableCount
    ) throw new Error(`Stored caption production ${job.id} changed its authority, content, or result counts`);

    verified.push({
      verification: {
        jobId: job.id,
        approval: {
          reviewId: approval.reviewId,
          artifactId: approval.artifactId,
          receiptId: approval.receiptId,
          receiptContentId: approval.receiptContentId,
        },
        authorityState,
        integrity: "stored_caption_and_receipt_with_verified_approval",
        captionArtifactId: captionArtifact.id,
        captionContentId: captionArtifact.content.contentId,
        receiptArtifactId: receiptArtifact.id,
        receiptId: receipt.receiptId,
        receiptContentId: receiptArtifact.content.contentId,
        executor: structuredClone(caption.executor),
        result: structuredClone(caption.result),
      },
      artifact: structuredClone(caption),
    });
  }
  return verified;
}

export async function reopenCaptionProductions(
  state: RuntimeProjection,
  events: readonly RuntimeEvent[],
  artifacts: ContentAddressedArtifactStore,
): Promise<CaptionProductionVerification[]> {
  return (await reopenCaptionProductionResults(state, events, artifacts))
    .map((result) => result.verification);
}
