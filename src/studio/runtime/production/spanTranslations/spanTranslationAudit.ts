import { createHash } from "node:crypto";

import {
  canonicalJsonContentId,
  canonicalSha256,
  ContentAddressedArtifactStore,
  createSpanTranslationArtifactId,
  createSpanTranslationReceiptArtifactId,
} from "../artifactStore.ts";
import { reopenCaptionProductionResults } from "../captions/captionProductionAudit.ts";
import { materializeCaptionProductionLines } from "../captions/captionArtifactCompaction.ts";
import type {
  RuntimeProjection,
  SpanTranslationReceipt,
  VerifiedSpanTranslationResult,
} from "../model.ts";
import { SPAN_TRANSLATION_LIMITS } from "../model.ts";
import type { RuntimeEvent } from "../protocol.ts";
import {
  validateSpanTranslationArtifact,
  validateSpanTranslationReceipt,
} from "../validation/spanTranslations.ts";
import { languageExplanationCaptionSnapshot } from "../languageExplanations/languageExplanationHost.ts";
import { spanTranslationContextWindow } from "./spanTranslationHost.ts";
import {
  createSpanTranslationGrantId,
  createSpanTranslationJobId,
  createSpanTranslationRequestFingerprint,
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
  if (bytes.byteLength <= 0 || bytes.byteLength > SPAN_TRANSLATION_LIMITS.maxArtifactBytes) {
    throw new Error("Stored span translation exceeds its byte bound");
  }
  const measured = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  if (measured !== contentId) throw new Error("Stored span translation changed content identity");
  let value: unknown;
  try {
    value = JSON.parse(bytes.toString("utf8")) as unknown;
  } catch {
    throw new Error("Stored span translation is invalid JSON");
  }
  if (canonicalJsonContentId(value) !== contentId) {
    throw new Error("Stored span translation is not canonical JSON");
  }
  return { value, bytes: bytes.byteLength };
}

function receiptIdentity(receipt: SpanTranslationReceipt): string {
  const body = structuredClone(receipt) as unknown as Record<string, unknown>;
  delete body.schema;
  delete body.receiptId;
  return `span-translation-receipt:${canonicalSha256(body)}`;
}

function same(left: unknown, right: unknown): boolean {
  return canonicalSha256(left) === canonicalSha256(right);
}

/** Cold audit for private span-translation artifacts. Caption authority is recursively reopened first. */
export async function reopenSpanTranslationResults(
  state: RuntimeProjection,
  events: readonly RuntimeEvent[],
  artifacts: ContentAddressedArtifactStore,
): Promise<VerifiedSpanTranslationResult[]> {
  const captions = await reopenCaptionProductionResults(state, events, artifacts);
  const results: VerifiedSpanTranslationResult[] = [];
  const completed = Object.values(state.spanTranslations)
    .filter((record) => record.status === "completed")
    .sort((left, right) => left.jobId.localeCompare(right.jobId));

  for (const record of completed) {
    if (
      !record.artifactId || !record.contentId || !record.receiptArtifactId ||
      !record.receiptId || !record.receiptContentId || !record.result
    ) throw new Error(`Completed span translation ${record.jobId} has an incomplete projection`);
    const caption = captions.find((candidate) =>
      candidate.verification.jobId === record.caption.jobId &&
      candidate.verification.captionArtifactId === record.caption.artifactId &&
      candidate.verification.captionContentId === record.caption.contentId &&
      candidate.verification.receiptArtifactId === record.caption.receiptArtifactId &&
      candidate.verification.receiptId === record.caption.receiptId &&
      candidate.verification.receiptContentId === record.caption.receiptContentId
    );
    if (!caption) throw new Error(`Span translation ${record.jobId} lost its exact verified caption`);
    const sourceArtifact = state.artifacts[caption.verification.source.artifactId];
    const recordedRightsScope = sourceArtifact?.origin.kind === "ingest"
      ? sourceArtifact.publication === "public" ? "redistribution" : "local_processing"
      : null;
    if (recordedRightsScope === null) {
      throw new Error(`Span translation ${record.jobId} lost its registered source rights`);
    }
    const started = events.find((event) =>
      event.type === "translation.span_started" && event.data.jobId === record.jobId);
    const completion = events.find((event) =>
      event.type === "translation.span_completed" && event.data.jobId === record.jobId);
    if (!started || started.type !== "translation.span_started" ||
        !completion || completion.type !== "translation.span_completed") {
      throw new Error(`Span translation ${record.jobId} has no closed journal lineage`);
    }
    const expectedFingerprint = createSpanTranslationRequestFingerprint({
      runId: state.runId,
      request: started.data.request,
      authority: started.data.input,
      executor: started.data.grant.executor,
      rightsScope: recordedRightsScope,
    });
    const expectedGrantId = createSpanTranslationGrantId({
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
      record.jobId !== createSpanTranslationJobId(expectedGrantId)
    ) throw new Error(`Span translation ${record.jobId} changed its request or grant identity`);
    const revocation = Object.values(state.publishReviewRevocations)
      .find((candidate) => candidate.reviewId === caption.verification.approval.reviewId && candidate.status !== "failed");
    if (revocation) {
      const revocationStart = events.find((event) =>
        event.type === "publish.review.revocation_started" && event.data.revocationId === revocation.id);
      if (!revocationStart || revocationStart.seq <= completion.seq) {
        throw new Error(`Span translation ${record.jobId} overlapped or followed caption authority revocation`);
      }
    }

    const translationArtifact = state.artifacts[record.artifactId];
    const receiptArtifact = state.artifacts[record.receiptArtifactId];
    if (
      !translationArtifact || translationArtifact.origin.kind !== "span_translation_output" ||
      !receiptArtifact || receiptArtifact.origin.kind !== "span_translation_receipt"
    ) throw new Error(`Span translation ${record.jobId} lost its private artifacts`);
    const expectedTranslationId = createSpanTranslationArtifactId(state.runId, record.jobId, record.contentId);
    const expectedReceiptId = createSpanTranslationReceiptArtifactId(state.runId, record.jobId, record.receiptContentId);
    const expectedCommonSources = [
      record.caption.artifactId,
      record.caption.receiptArtifactId,
      caption.verification.source.artifactId,
      caption.verification.study.artifactId,
      caption.verification.readiness.artifactId,
      caption.verification.approval.artifactId,
    ];
    if (
      translationArtifact.id !== expectedTranslationId ||
      translationArtifact.kind !== "span-translation-output" ||
      translationArtifact.mediaClass !== "non_media" || translationArtifact.publication !== "private" ||
      translationArtifact.storageKey !== expectedStorageKey(record.contentId) ||
      translationArtifact.producerTaskId !== null || translationArtifact.producerAgentId !== null ||
      !same(translationArtifact.sourceArtifactIds, expectedCommonSources) ||
      translationArtifact.origin.jobId !== record.jobId ||
      translationArtifact.origin.receiptId !== record.receiptId ||
      translationArtifact.origin.receiptContentId !== record.receiptContentId ||
      translationArtifact.origin.captionArtifactId !== record.caption.artifactId ||
      translationArtifact.origin.captionContentId !== record.caption.contentId ||
      translationArtifact.origin.captionReceiptArtifactId !== record.caption.receiptArtifactId ||
      translationArtifact.origin.captionReceiptContentId !== record.caption.receiptContentId ||
      receiptArtifact.id !== expectedReceiptId ||
      receiptArtifact.kind !== "span-translation-receipt" ||
      receiptArtifact.mediaClass !== "non_media" || receiptArtifact.publication !== "private" ||
      receiptArtifact.storageKey !== expectedStorageKey(record.receiptContentId) ||
      receiptArtifact.producerTaskId !== null || receiptArtifact.producerAgentId !== null ||
      !same(receiptArtifact.sourceArtifactIds, [translationArtifact.id, ...expectedCommonSources]) ||
      receiptArtifact.origin.jobId !== record.jobId ||
      receiptArtifact.origin.receiptId !== record.receiptId ||
      receiptArtifact.origin.receiptContentId !== record.receiptContentId ||
      receiptArtifact.origin.translationArtifactId !== translationArtifact.id ||
      receiptArtifact.origin.translationContentId !== translationArtifact.content.contentId ||
      completion.data.artifactId !== translationArtifact.id ||
      completion.data.contentId !== translationArtifact.content.contentId ||
      completion.data.receiptArtifactId !== receiptArtifact.id ||
      completion.data.receiptContentId !== receiptArtifact.content.contentId
    ) throw new Error(`Span translation ${record.jobId} artifact identities do not close`);

    const [storedTranslation, storedReceipt] = await Promise.all([
      storedJson(artifacts, record.contentId),
      storedJson(artifacts, record.receiptContentId),
    ]);
    const translation = validateSpanTranslationArtifact(storedTranslation.value);
    const receipt = validateSpanTranslationReceipt(storedReceipt.value);
    const captionLines = materializeCaptionProductionLines(caption.artifact);
    const lineIndex = captionLines.findIndex((line) => line.id === record.lineId);
    if (lineIndex < 0) throw new Error(`Span translation ${record.jobId} lost its selected caption line`);
    const selectedCaptionLine = captionLines[lineIndex];
    const selectedSide = record.selection.side === "source" ? selectedCaptionLine.source : selectedCaptionLine.target;
    const exactText = selectedSide.text === null
      ? null
      : Array.from(selectedSide.text).slice(record.selection.start, record.selection.end).join("");
    const semanticCitations = selectedCaptionLine.lineage.study.semanticCitations;
    if (
      translationArtifact.content.bytes !== storedTranslation.bytes ||
      receiptArtifact.content.bytes !== storedReceipt.bytes ||
      translation.jobId !== record.jobId || translation.runId !== state.runId ||
      translation.grant.grantId !== record.grantId ||
      translation.grant.requestFingerprint !== record.requestFingerprint ||
      !same(translation.executor, record.executor) ||
      !same(translation.grant.limits, record.limits) ||
      !same(translation.input.caption, record.caption) ||
      translation.input.line.lineId !== record.lineId ||
      !same(translation.input.selection, record.selection) ||
      exactText !== record.selection.text ||
      !same(translation.input.line, languageExplanationCaptionSnapshot(selectedCaptionLine)) ||
      !same(translation.input.contextLines, spanTranslationContextWindow(captionLines, lineIndex)) ||
      !same(translation.input.source, {
        artifactId: caption.verification.source.artifactId,
        contentId: caption.verification.source.contentId,
        analysisRequestId: caption.verification.source.analysisRequestId,
        rightsScope: recordedRightsScope,
      }) ||
      !same(translation.input.study, {
        studyId: caption.verification.study.studyId,
        artifactId: caption.verification.study.artifactId,
        contentId: caption.verification.study.contentId,
      }) ||
      !same(translation.input.readiness, caption.verification.readiness) ||
      !same(translation.input.approval, caption.verification.approval) ||
      translation.grant.rightsScope !== recordedRightsScope ||
      translation.rights.sourceScope !== recordedRightsScope ||
      !same(translation.input.inputContextLineage, {
        claimIds: selectedCaptionLine.lineage.study.claimIds,
        citationIds: semanticCitations.map((citation) => citation.operationId),
        semanticEvidenceArtifactIds: semanticCitations.map((citation) => citation.artifactId),
        semanticEvidenceReceiptIds: semanticCitations.map((citation) => citation.receiptId),
      }) ||
      receipt.receiptId !== receiptIdentity(receipt) || receipt.receiptId !== record.receiptId ||
      receipt.jobId !== record.jobId ||
      !same(receipt.grant, translation.grant) || !same(receipt.input, translation.input) ||
      !same(receipt.producer.executor, translation.executor) ||
      receipt.result.artifactId !== translationArtifact.id ||
      receipt.result.contentId !== translationArtifact.content.contentId ||
      receipt.result.bytes !== translationArtifact.content.bytes ||
      receipt.result.availability !== translation.translation.availability ||
      receipt.result.reasonCode !== translation.translation.reasonCode ||
      !same(translation.result, record.result) ||
      !same(receipt, completion.data.receipt) ||
      !same(started.data.grant, translation.grant) ||
      !same(started.data.input, translation.input)
    ) throw new Error(`Stored span translation ${record.jobId} changed authority, selection, or receipt closure`);

    results.push({
      verification: {
        integrity: "stored_translation_and_receipt_with_verified_current_caption",
        jobId: record.jobId,
        artifactId: translationArtifact.id,
        contentId: translationArtifact.content.contentId,
        receiptArtifactId: receiptArtifact.id,
        receiptId: receipt.receiptId,
        receiptContentId: receiptArtifact.content.contentId,
        caption: structuredClone(record.caption),
        lineId: record.lineId,
        selection: structuredClone(record.selection),
        executor: structuredClone(record.executor),
        result: structuredClone(translation.result),
      },
      artifact: structuredClone(translation),
      receipt: structuredClone(receipt),
    });
  }
  return results;
}
