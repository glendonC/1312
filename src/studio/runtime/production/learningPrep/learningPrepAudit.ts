import { createHash } from "node:crypto";

import {
  canonicalJsonContentId,
  canonicalSha256,
  ContentAddressedArtifactStore,
  createLearningPrepArtifactId,
  createLearningPrepReceiptArtifactId,
} from "../artifactStore.ts";
import { reopenCaptionProductionResults } from "../captions/captionProductionAudit.ts";
import { materializeCaptionProductionLines } from "../captions/captionArtifactCompaction.ts";
import type {
  LearningPrepReceipt,
  RuntimeProjection,
  VerifiedLearningPrepResult,
} from "../model.ts";
import { LEARNING_PREP_LIMITS } from "../model.ts";
import type { RuntimeEvent } from "../protocol.ts";
import {
  validateLearningPrepArtifact,
  validateLearningPrepReceipt,
} from "../validation/learningPrep.ts";
import { learningPrepLineSnapshots } from "./learningPrepHost.ts";
import {
  createLearningPrepGrantId,
  createLearningPrepJobId,
  createLearningPrepRequestFingerprint,
} from "./identity.ts";

function expectedStorageKey(contentId: string): string {
  const digest = contentId.replace(/^sha256:/, "");
  return `objects/sha256/${digest.slice(0, 2)}/${digest}`;
}

async function storedJson(
  artifacts: ContentAddressedArtifactStore,
  contentId: string,
): Promise<{ value: unknown; bytes: number }> {
  const bytes = await artifacts.receiptBytes(contentId);
  if (bytes.byteLength <= 0 || bytes.byteLength > LEARNING_PREP_LIMITS.maxArtifactBytes) {
    throw new Error("Stored learning prep exceeds its byte bound");
  }
  const measured = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  if (measured !== contentId) throw new Error("Stored learning prep changed content identity");
  let value: unknown;
  try {
    value = JSON.parse(bytes.toString("utf8")) as unknown;
  } catch {
    throw new Error("Stored learning prep is invalid JSON");
  }
  if (canonicalJsonContentId(value) !== contentId) {
    throw new Error("Stored learning prep is not canonical JSON");
  }
  return { value, bytes: bytes.byteLength };
}

function receiptIdentity(receipt: LearningPrepReceipt): string {
  const body = structuredClone(receipt) as unknown as Record<string, unknown>;
  delete body.schema;
  delete body.receiptId;
  return `learning-prep-receipt:${canonicalSha256(body)}`;
}

function same(left: unknown, right: unknown): boolean {
  return canonicalSha256(left) === canonicalSha256(right);
}

/** Cold audit for private learning-prep artifacts. Caption authority is recursively reopened first. */
export async function reopenLearningPrepResults(
  state: RuntimeProjection,
  events: readonly RuntimeEvent[],
  artifacts: ContentAddressedArtifactStore,
): Promise<VerifiedLearningPrepResult[]> {
  const captions = await reopenCaptionProductionResults(state, events, artifacts);
  const results: VerifiedLearningPrepResult[] = [];
  const completed = Object.values(state.learningPreps)
    .filter((record) => record.status === "completed")
    .sort((left, right) => left.jobId.localeCompare(right.jobId));

  for (const record of completed) {
    if (
      !record.artifactId || !record.contentId || !record.receiptArtifactId ||
      !record.receiptId || !record.receiptContentId || !record.result
    ) throw new Error(`Completed learning prep ${record.jobId} has an incomplete projection`);
    const caption = captions.find((candidate) =>
      candidate.verification.jobId === record.caption.jobId &&
      candidate.verification.captionArtifactId === record.caption.artifactId &&
      candidate.verification.captionContentId === record.caption.contentId &&
      candidate.verification.receiptArtifactId === record.caption.receiptArtifactId &&
      candidate.verification.receiptId === record.caption.receiptId &&
      candidate.verification.receiptContentId === record.caption.receiptContentId
    );
    if (!caption) throw new Error(`Learning prep ${record.jobId} lost its exact verified caption`);
    const sourceArtifact = state.artifacts[caption.verification.source.artifactId];
    const recordedRightsScope = sourceArtifact?.origin.kind === "ingest"
      ? sourceArtifact.publication === "public" ? "redistribution" : "local_processing"
      : null;
    if (recordedRightsScope === null) {
      throw new Error(`Learning prep ${record.jobId} lost its registered source rights`);
    }
    const started = events.find((event) =>
      event.type === "learning.prep_started" && event.data.jobId === record.jobId);
    const completion = events.find((event) =>
      event.type === "learning.prep_completed" && event.data.jobId === record.jobId);
    if (!started || started.type !== "learning.prep_started" ||
        !completion || completion.type !== "learning.prep_completed") {
      throw new Error(`Learning prep ${record.jobId} has no closed journal lineage`);
    }
    const expectedFingerprint = createLearningPrepRequestFingerprint({
      runId: state.runId,
      request: started.data.request,
      authority: started.data.input,
      executor: started.data.grant.executor,
      rightsScope: recordedRightsScope,
    });
    const expectedGrantId = createLearningPrepGrantId({
      runId: state.runId,
      requestFingerprint: expectedFingerprint,
      caption: started.data.request.caption,
      attempt: record.attempt,
    });
    if (
      record.requestFingerprint !== expectedFingerprint ||
      started.data.grant.requestFingerprint !== expectedFingerprint ||
      record.grantId !== expectedGrantId ||
      started.data.grant.grantId !== expectedGrantId ||
      started.data.grant.attempt !== record.attempt ||
      record.jobId !== createLearningPrepJobId(expectedGrantId)
    ) throw new Error(`Learning prep ${record.jobId} changed its request or grant identity`);
    const revocation = Object.values(state.publishReviewRevocations)
      .find((candidate) => candidate.reviewId === caption.verification.approval.reviewId && candidate.status !== "failed");
    if (revocation) {
      const revocationStart = events.find((event) =>
        event.type === "publish.review.revocation_started" && event.data.revocationId === revocation.id);
      if (!revocationStart || revocationStart.seq <= completion.seq) {
        throw new Error(`Learning prep ${record.jobId} overlapped or followed caption authority revocation`);
      }
    }

    const prepArtifact = state.artifacts[record.artifactId];
    const receiptArtifact = state.artifacts[record.receiptArtifactId];
    if (
      !prepArtifact || prepArtifact.origin.kind !== "learning_prep_output" ||
      !receiptArtifact || receiptArtifact.origin.kind !== "learning_prep_receipt"
    ) throw new Error(`Learning prep ${record.jobId} lost its private artifacts`);
    const expectedPrepId = createLearningPrepArtifactId(state.runId, record.jobId, record.contentId);
    const expectedReceiptId = createLearningPrepReceiptArtifactId(state.runId, record.jobId, record.receiptContentId);
    const expectedCommonSources = [
      record.caption.artifactId,
      record.caption.receiptArtifactId,
      caption.verification.source.artifactId,
      caption.verification.study.artifactId,
      caption.verification.readiness.artifactId,
      caption.verification.approval.artifactId,
    ];
    if (
      prepArtifact.id !== expectedPrepId ||
      prepArtifact.kind !== "learning-prep-output" ||
      prepArtifact.mediaClass !== "non_media" || prepArtifact.publication !== "private" ||
      prepArtifact.storageKey !== expectedStorageKey(record.contentId) ||
      prepArtifact.producerTaskId !== null || prepArtifact.producerAgentId !== null ||
      !same(prepArtifact.sourceArtifactIds, expectedCommonSources) ||
      prepArtifact.origin.jobId !== record.jobId ||
      prepArtifact.origin.receiptId !== record.receiptId ||
      prepArtifact.origin.receiptContentId !== record.receiptContentId ||
      prepArtifact.origin.captionArtifactId !== record.caption.artifactId ||
      prepArtifact.origin.captionContentId !== record.caption.contentId ||
      prepArtifact.origin.captionReceiptArtifactId !== record.caption.receiptArtifactId ||
      prepArtifact.origin.captionReceiptContentId !== record.caption.receiptContentId ||
      receiptArtifact.id !== expectedReceiptId ||
      receiptArtifact.kind !== "learning-prep-receipt" ||
      receiptArtifact.mediaClass !== "non_media" || receiptArtifact.publication !== "private" ||
      receiptArtifact.storageKey !== expectedStorageKey(record.receiptContentId) ||
      receiptArtifact.producerTaskId !== null || receiptArtifact.producerAgentId !== null ||
      !same(receiptArtifact.sourceArtifactIds, [prepArtifact.id, ...expectedCommonSources]) ||
      receiptArtifact.origin.jobId !== record.jobId ||
      receiptArtifact.origin.receiptId !== record.receiptId ||
      receiptArtifact.origin.receiptContentId !== record.receiptContentId ||
      receiptArtifact.origin.prepArtifactId !== prepArtifact.id ||
      receiptArtifact.origin.prepContentId !== prepArtifact.content.contentId ||
      completion.data.artifactId !== prepArtifact.id ||
      completion.data.contentId !== prepArtifact.content.contentId ||
      completion.data.receiptArtifactId !== receiptArtifact.id ||
      completion.data.receiptContentId !== receiptArtifact.content.contentId
    ) throw new Error(`Learning prep ${record.jobId} artifact identities do not close`);

    const [storedPrep, storedReceipt] = await Promise.all([
      storedJson(artifacts, record.contentId),
      storedJson(artifacts, record.receiptContentId),
    ]);
    const prep = validateLearningPrepArtifact(storedPrep.value);
    const receipt = validateLearningPrepReceipt(storedReceipt.value);
    const captionLines = materializeCaptionProductionLines(caption.artifact);
    if (
      prepArtifact.content.bytes !== storedPrep.bytes ||
      receiptArtifact.content.bytes !== storedReceipt.bytes ||
      prep.jobId !== record.jobId || prep.runId !== state.runId ||
      prep.grant.grantId !== record.grantId ||
      prep.grant.requestFingerprint !== record.requestFingerprint ||
      !same(prep.executor, record.executor) ||
      !same(prep.grant.limits, record.limits) ||
      !same(prep.input.caption, record.caption) ||
      !same(prep.grant.fineTune, record.fineTune) ||
      !same(prep.input.lines, learningPrepLineSnapshots(captionLines)) ||
      !same(prep.input.source, {
        artifactId: caption.verification.source.artifactId,
        contentId: caption.verification.source.contentId,
        analysisRequestId: caption.verification.source.analysisRequestId,
        rightsScope: recordedRightsScope,
      }) ||
      !same(prep.input.study, {
        studyId: caption.verification.study.studyId,
        artifactId: caption.verification.study.artifactId,
        contentId: caption.verification.study.contentId,
      }) ||
      !same(prep.input.readiness, caption.verification.readiness) ||
      !same(prep.input.approval, caption.verification.approval) ||
      prep.grant.rightsScope !== recordedRightsScope ||
      prep.rights.sourceScope !== recordedRightsScope ||
      receipt.receiptId !== receiptIdentity(receipt) || receipt.receiptId !== record.receiptId ||
      receipt.jobId !== record.jobId ||
      !same(receipt.grant, prep.grant) || !same(receipt.input, prep.input) ||
      !same(receipt.producer.executor, prep.executor) ||
      receipt.result.artifactId !== prepArtifact.id ||
      receipt.result.contentId !== prepArtifact.content.contentId ||
      receipt.result.bytes !== prepArtifact.content.bytes ||
      !same(receipt.result.lenses, prep.lenses.map((lens) => ({
        lens: lens.lens,
        state: lens.state,
        reasonCode: lens.reasonCode,
        candidateCount: lens.candidateCount,
      }))) ||
      !same(prep.result, record.result) ||
      !same(receipt, completion.data.receipt) ||
      !same(started.data.grant, prep.grant) ||
      !same(started.data.input, prep.input)
    ) throw new Error(`Stored learning prep ${record.jobId} changed authority, fine-tune, or receipt closure`);

    results.push({
      verification: {
        integrity: "stored_learning_prep_and_receipt_with_verified_current_caption",
        jobId: record.jobId,
        artifactId: prepArtifact.id,
        contentId: prepArtifact.content.contentId,
        receiptArtifactId: receiptArtifact.id,
        receiptId: receipt.receiptId,
        receiptContentId: receiptArtifact.content.contentId,
        caption: structuredClone(record.caption),
        fineTune: structuredClone(record.fineTune),
        executor: structuredClone(record.executor),
        result: structuredClone(prep.result),
      },
      artifact: structuredClone(prep),
      receipt: structuredClone(receipt),
    });
  }
  return results;
}
