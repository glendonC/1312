import { createHash } from "node:crypto";

import {
  canonicalJsonContentId,
  canonicalSha256,
  ContentAddressedArtifactStore,
  createLanguageExplanationArtifactId,
  createLanguageExplanationReceiptArtifactId,
} from "../artifactStore.ts";
import { reopenCaptionProductionResults } from "../captions/captionProductionAudit.ts";
import { materializeCaptionProductionLines } from "../captions/captionArtifactCompaction.ts";
import type {
  LanguageExplanationReceipt,
  RuntimeProjection,
  VerifiedLanguageExplanationResult,
} from "../model.ts";
import { LANGUAGE_EXPLANATION_LIMITS } from "../model.ts";
import type { RuntimeEvent } from "../protocol.ts";
import {
  validateLanguageExplanationArtifact,
  validateLanguageExplanationReceipt,
} from "../validation/languageExplanations.ts";
import {
  languageExplanationCaptionSnapshot,
  languageExplanationContextWindow,
} from "./languageExplanationHost.ts";
import {
  createLanguageExplanationGrantId,
  createLanguageExplanationJobId,
  createLanguageExplanationRequestFingerprint,
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
  if (bytes.byteLength <= 0 || bytes.byteLength > LANGUAGE_EXPLANATION_LIMITS.maxArtifactBytes) {
    throw new Error("Stored language explanation exceeds its byte bound");
  }
  const measured = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  if (measured !== contentId) throw new Error("Stored language explanation changed content identity");
  let value: unknown;
  try {
    value = JSON.parse(bytes.toString("utf8")) as unknown;
  } catch {
    throw new Error("Stored language explanation is invalid JSON");
  }
  if (canonicalJsonContentId(value) !== contentId) {
    throw new Error("Stored language explanation is not canonical JSON");
  }
  return { value, bytes: bytes.byteLength };
}

function receiptIdentity(receipt: LanguageExplanationReceipt): string {
  const body = structuredClone(receipt) as unknown as Record<string, unknown>;
  delete body.schema;
  delete body.receiptId;
  return `language-explanation-receipt:${canonicalSha256(body)}`;
}

function same(left: unknown, right: unknown): boolean {
  return canonicalSha256(left) === canonicalSha256(right);
}

/** Cold audit for private explanation artifacts. Caption authority is recursively reopened first. */
export async function reopenLanguageExplanationResults(
  state: RuntimeProjection,
  events: readonly RuntimeEvent[],
  artifacts: ContentAddressedArtifactStore,
): Promise<VerifiedLanguageExplanationResult[]> {
  const captions = await reopenCaptionProductionResults(state, events, artifacts);
  const results: VerifiedLanguageExplanationResult[] = [];
  const completed = Object.values(state.languageExplanations)
    .filter((record) => record.status === "completed")
    .sort((left, right) => left.jobId.localeCompare(right.jobId));

  for (const record of completed) {
    if (
      !record.artifactId || !record.contentId || !record.receiptArtifactId ||
      !record.receiptId || !record.receiptContentId || !record.result
    ) throw new Error(`Completed language explanation ${record.jobId} has an incomplete projection`);
    const caption = captions.find((candidate) =>
      candidate.verification.jobId === record.caption.jobId &&
      candidate.verification.captionArtifactId === record.caption.artifactId &&
      candidate.verification.captionContentId === record.caption.contentId &&
      candidate.verification.receiptArtifactId === record.caption.receiptArtifactId &&
      candidate.verification.receiptId === record.caption.receiptId &&
      candidate.verification.receiptContentId === record.caption.receiptContentId
    );
    if (!caption) throw new Error(`Language explanation ${record.jobId} lost its exact verified caption`);
    const sourceArtifact = state.artifacts[caption.verification.source.artifactId];
    const recordedRightsScope = sourceArtifact?.origin.kind === "ingest"
      ? sourceArtifact.publication === "public" ? "redistribution" : "local_processing"
      : null;
    if (recordedRightsScope === null) {
      throw new Error(`Language explanation ${record.jobId} lost its registered source rights`);
    }
    const started = events.find((event) =>
      event.type === "language.explanation_started" && event.data.jobId === record.jobId);
    const completion = events.find((event) =>
      event.type === "language.explanation_completed" && event.data.jobId === record.jobId);
    if (!started || started.type !== "language.explanation_started" ||
        !completion || completion.type !== "language.explanation_completed") {
      throw new Error(`Language explanation ${record.jobId} has no closed journal lineage`);
    }
    const expectedFingerprint = createLanguageExplanationRequestFingerprint({
      runId: state.runId,
      request: started.data.request,
      authority: started.data.input,
      executor: started.data.grant.executor,
      rightsScope: recordedRightsScope,
    });
    const expectedGrantId = createLanguageExplanationGrantId({
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
      record.jobId !== createLanguageExplanationJobId(expectedGrantId)
    ) throw new Error(`Language explanation ${record.jobId} changed its request or grant identity`);
    const revocation = Object.values(state.publishReviewRevocations)
      .find((candidate) => candidate.reviewId === caption.verification.approval.reviewId && candidate.status !== "failed");
    if (revocation) {
      const revocationStart = events.find((event) =>
        event.type === "publish.review.revocation_started" && event.data.revocationId === revocation.id);
      if (!revocationStart || revocationStart.seq <= completion.seq) {
        throw new Error(`Language explanation ${record.jobId} overlapped or followed caption authority revocation`);
      }
    }

    const explanationArtifact = state.artifacts[record.artifactId];
    const receiptArtifact = state.artifacts[record.receiptArtifactId];
    if (
      !explanationArtifact || explanationArtifact.origin.kind !== "language_explanation_output" ||
      !receiptArtifact || receiptArtifact.origin.kind !== "language_explanation_receipt"
    ) throw new Error(`Language explanation ${record.jobId} lost its private artifacts`);
    const expectedExplanationId = createLanguageExplanationArtifactId(state.runId, record.jobId, record.contentId);
    const expectedReceiptId = createLanguageExplanationReceiptArtifactId(state.runId, record.jobId, record.receiptContentId);
    const expectedCommonSources = [
      record.caption.artifactId,
      record.caption.receiptArtifactId,
      caption.verification.source.artifactId,
      caption.verification.study.artifactId,
      caption.verification.readiness.artifactId,
      caption.verification.approval.artifactId,
    ];
    if (
      explanationArtifact.id !== expectedExplanationId ||
      explanationArtifact.kind !== "language-explanation-output" ||
      explanationArtifact.mediaClass !== "non_media" || explanationArtifact.publication !== "private" ||
      explanationArtifact.storageKey !== expectedStorageKey(record.contentId) ||
      explanationArtifact.producerTaskId !== null || explanationArtifact.producerAgentId !== null ||
      !same(explanationArtifact.sourceArtifactIds, expectedCommonSources) ||
      explanationArtifact.origin.jobId !== record.jobId ||
      explanationArtifact.origin.receiptId !== record.receiptId ||
      explanationArtifact.origin.receiptContentId !== record.receiptContentId ||
      explanationArtifact.origin.captionArtifactId !== record.caption.artifactId ||
      explanationArtifact.origin.captionContentId !== record.caption.contentId ||
      explanationArtifact.origin.captionReceiptArtifactId !== record.caption.receiptArtifactId ||
      explanationArtifact.origin.captionReceiptContentId !== record.caption.receiptContentId ||
      receiptArtifact.id !== expectedReceiptId ||
      receiptArtifact.kind !== "language-explanation-receipt" ||
      receiptArtifact.mediaClass !== "non_media" || receiptArtifact.publication !== "private" ||
      receiptArtifact.storageKey !== expectedStorageKey(record.receiptContentId) ||
      receiptArtifact.producerTaskId !== null || receiptArtifact.producerAgentId !== null ||
      !same(receiptArtifact.sourceArtifactIds, [explanationArtifact.id, ...expectedCommonSources]) ||
      receiptArtifact.origin.jobId !== record.jobId ||
      receiptArtifact.origin.receiptId !== record.receiptId ||
      receiptArtifact.origin.receiptContentId !== record.receiptContentId ||
      receiptArtifact.origin.explanationArtifactId !== explanationArtifact.id ||
      receiptArtifact.origin.explanationContentId !== explanationArtifact.content.contentId ||
      completion.data.artifactId !== explanationArtifact.id ||
      completion.data.contentId !== explanationArtifact.content.contentId ||
      completion.data.receiptArtifactId !== receiptArtifact.id ||
      completion.data.receiptContentId !== receiptArtifact.content.contentId
    ) throw new Error(`Language explanation ${record.jobId} artifact identities do not close`);

    const [storedExplanation, storedReceipt] = await Promise.all([
      storedJson(artifacts, record.contentId),
      storedJson(artifacts, record.receiptContentId),
    ]);
    const explanation = validateLanguageExplanationArtifact(storedExplanation.value);
    const receipt = validateLanguageExplanationReceipt(storedReceipt.value);
    const captionLines = materializeCaptionProductionLines(caption.artifact);
    const lineIndex = captionLines.findIndex((line) => line.id === record.lineId);
    if (lineIndex < 0) throw new Error(`Language explanation ${record.jobId} lost its selected caption line`);
    const selectedCaptionLine = captionLines[lineIndex];
    const selectedSide = record.selection.side === "source" ? selectedCaptionLine.source : selectedCaptionLine.target;
    const exactText = selectedSide.text === null
      ? null
      : Array.from(selectedSide.text).slice(record.selection.start, record.selection.end).join("");
    const semanticCitations = selectedCaptionLine.lineage.study.semanticCitations;
    if (
      explanationArtifact.content.bytes !== storedExplanation.bytes ||
      receiptArtifact.content.bytes !== storedReceipt.bytes ||
      explanation.jobId !== record.jobId || explanation.runId !== state.runId ||
      explanation.grant.grantId !== record.grantId ||
      explanation.grant.requestFingerprint !== record.requestFingerprint ||
      !same(explanation.executor, record.executor) ||
      !same(explanation.grant.limits, record.limits) ||
      !same(explanation.input.caption, record.caption) ||
      explanation.input.line.lineId !== record.lineId ||
      !same(explanation.input.selection, record.selection) ||
      exactText !== record.selection.text ||
      !same(explanation.input.line, languageExplanationCaptionSnapshot(selectedCaptionLine)) ||
      !same(explanation.input.contextLines, languageExplanationContextWindow(captionLines, lineIndex)) ||
      !same(explanation.input.source, {
        artifactId: caption.verification.source.artifactId,
        contentId: caption.verification.source.contentId,
        analysisRequestId: caption.verification.source.analysisRequestId,
        rightsScope: recordedRightsScope,
      }) ||
      !same(explanation.input.study, {
        studyId: caption.verification.study.studyId,
        artifactId: caption.verification.study.artifactId,
        contentId: caption.verification.study.contentId,
      }) ||
      !same(explanation.input.readiness, caption.verification.readiness) ||
      !same(explanation.input.approval, caption.verification.approval) ||
      explanation.grant.rightsScope !== recordedRightsScope ||
      explanation.rights.sourceScope !== recordedRightsScope ||
      !same(explanation.input.inputContextLineage, {
        claimIds: selectedCaptionLine.lineage.study.claimIds,
        citationIds: semanticCitations.map((citation) => citation.operationId),
        semanticEvidenceArtifactIds: semanticCitations.map((citation) => citation.artifactId),
        semanticEvidenceReceiptIds: semanticCitations.map((citation) => citation.receiptId),
      }) ||
      receipt.receiptId !== receiptIdentity(receipt) || receipt.receiptId !== record.receiptId ||
      receipt.jobId !== record.jobId ||
      !same(receipt.grant, explanation.grant) || !same(receipt.input, explanation.input) ||
      !same(receipt.producer.executor, explanation.executor) ||
      receipt.result.artifactId !== explanationArtifact.id ||
      receipt.result.contentId !== explanationArtifact.content.contentId ||
      receipt.result.bytes !== explanationArtifact.content.bytes ||
      !same(receipt.result.facets, explanation.facets.map((facet) => ({
        kind: facet.kind,
        availability: facet.availability,
        reasonCode: facet.reasonCode,
      }))) ||
      !same(explanation.result, record.result) ||
      !same(receipt, completion.data.receipt) ||
      !same(started.data.grant, explanation.grant) ||
      !same(started.data.input, explanation.input)
    ) throw new Error(`Stored language explanation ${record.jobId} changed authority, selection, or receipt closure`);

    results.push({
      verification: {
        integrity: "stored_explanation_and_receipt_with_verified_current_caption",
        jobId: record.jobId,
        artifactId: explanationArtifact.id,
        contentId: explanationArtifact.content.contentId,
        receiptArtifactId: receiptArtifact.id,
        receiptId: receipt.receiptId,
        receiptContentId: receiptArtifact.content.contentId,
        caption: structuredClone(record.caption),
        lineId: record.lineId,
        selection: structuredClone(record.selection),
        executor: structuredClone(record.executor),
        result: structuredClone(explanation.result),
      },
      artifact: structuredClone(explanation),
      receipt: structuredClone(receipt),
    });
  }
  return results;
}
