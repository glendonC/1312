import { assertRuntimeArtifact } from "../assertions.ts";
import type {
  ContentIdentity,
  RuntimeArtifact,
  SpanTranslationArtifact,
  SpanTranslationReceipt,
} from "../model.ts";
import {
  createSpanTranslationArtifactId,
  createSpanTranslationReceiptArtifactId,
} from "./contentIdentity.ts";

export function buildSpanTranslationArtifacts(input: {
  runId: string;
  translation: SpanTranslationArtifact;
  receipt: SpanTranslationReceipt;
  storedTranslation: { content: ContentIdentity; storageKey: string };
  storedReceipt: { content: ContentIdentity; storageKey: string };
}): { translationArtifact: RuntimeArtifact; receiptArtifact: RuntimeArtifact } {
  const authority = input.translation.input;
  const translationArtifactId = createSpanTranslationArtifactId(
    input.runId,
    input.translation.jobId,
    input.storedTranslation.content.contentId,
  );
  if (
    input.translation.runId !== input.runId ||
    input.translation.jobId !== input.receipt.jobId ||
    input.receipt.result.artifactId !== translationArtifactId ||
    input.receipt.result.contentId !== input.storedTranslation.content.contentId ||
    input.receipt.result.bytes !== input.storedTranslation.content.bytes
  ) throw new Error("Span-translation receipt does not bind the exact stored artifact");

  const commonSources = [
    authority.caption.artifactId,
    authority.caption.receiptArtifactId,
    authority.source.artifactId,
    authority.study.artifactId,
    authority.readiness.artifactId,
    authority.approval.artifactId,
  ];
  const commonOrigin = {
    jobId: input.translation.jobId,
    receiptId: input.receipt.receiptId,
    receiptContentId: input.storedReceipt.content.contentId,
    captionArtifactId: authority.caption.artifactId,
    captionContentId: authority.caption.contentId,
    captionReceiptArtifactId: authority.caption.receiptArtifactId,
    captionReceiptContentId: authority.caption.receiptContentId,
    sourceArtifactId: authority.source.artifactId,
    studyArtifactId: authority.study.artifactId,
    readinessArtifactId: authority.readiness.artifactId,
    approvalArtifactId: authority.approval.artifactId,
  };
  const translationArtifact: RuntimeArtifact = {
    schema: "studio.runtime.artifact.v1",
    id: translationArtifactId,
    runId: input.runId,
    kind: "span-translation-output",
    mediaClass: "non_media",
    publication: "private",
    content: input.storedTranslation.content,
    storageKey: input.storedTranslation.storageKey,
    durationMs: null,
    tracks: [],
    sourceArtifactIds: commonSources,
    producerTaskId: null,
    producerAgentId: null,
    origin: { kind: "span_translation_output", ...commonOrigin },
  };
  const receiptArtifact: RuntimeArtifact = {
    schema: "studio.runtime.artifact.v1",
    id: createSpanTranslationReceiptArtifactId(
      input.runId,
      input.receipt.jobId,
      input.storedReceipt.content.contentId,
    ),
    runId: input.runId,
    kind: "span-translation-receipt",
    mediaClass: "non_media",
    publication: "private",
    content: input.storedReceipt.content,
    storageKey: input.storedReceipt.storageKey,
    durationMs: null,
    tracks: [],
    sourceArtifactIds: [translationArtifact.id, ...commonSources],
    producerTaskId: null,
    producerAgentId: null,
    origin: {
      kind: "span_translation_receipt",
      ...commonOrigin,
      translationArtifactId: translationArtifact.id,
      translationContentId: translationArtifact.content.contentId,
    },
  };
  assertRuntimeArtifact(translationArtifact);
  assertRuntimeArtifact(receiptArtifact);
  return { translationArtifact, receiptArtifact };
}
