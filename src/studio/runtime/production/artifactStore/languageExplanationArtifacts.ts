import { assertRuntimeArtifact } from "../assertions.ts";
import type {
  ContentIdentity,
  LanguageExplanationArtifact,
  LanguageExplanationReceipt,
  RuntimeArtifact,
} from "../model.ts";
import {
  createLanguageExplanationArtifactId,
  createLanguageExplanationReceiptArtifactId,
} from "./contentIdentity.ts";

export function buildLanguageExplanationArtifacts(input: {
  runId: string;
  explanation: LanguageExplanationArtifact;
  receipt: LanguageExplanationReceipt;
  storedExplanation: { content: ContentIdentity; storageKey: string };
  storedReceipt: { content: ContentIdentity; storageKey: string };
}): { explanationArtifact: RuntimeArtifact; receiptArtifact: RuntimeArtifact } {
  const authority = input.explanation.input;
  const explanationArtifactId = createLanguageExplanationArtifactId(
    input.runId,
    input.explanation.jobId,
    input.storedExplanation.content.contentId,
  );
  if (
    input.explanation.runId !== input.runId ||
    input.explanation.jobId !== input.receipt.jobId ||
    input.receipt.result.artifactId !== explanationArtifactId ||
    input.receipt.result.contentId !== input.storedExplanation.content.contentId ||
    input.receipt.result.bytes !== input.storedExplanation.content.bytes
  ) throw new Error("Language-explanation receipt does not bind the exact stored artifact");

  const commonSources = [
    authority.caption.artifactId,
    authority.caption.receiptArtifactId,
    authority.source.artifactId,
    authority.study.artifactId,
    authority.readiness.artifactId,
    authority.approval.artifactId,
  ];
  const commonOrigin = {
    jobId: input.explanation.jobId,
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
  const explanationArtifact: RuntimeArtifact = {
    schema: "studio.runtime.artifact.v1",
    id: explanationArtifactId,
    runId: input.runId,
    kind: "language-explanation-output",
    mediaClass: "non_media",
    publication: "private",
    content: input.storedExplanation.content,
    storageKey: input.storedExplanation.storageKey,
    durationMs: null,
    tracks: [],
    sourceArtifactIds: commonSources,
    producerTaskId: null,
    producerAgentId: null,
    origin: { kind: "language_explanation_output", ...commonOrigin },
  };
  const receiptArtifact: RuntimeArtifact = {
    schema: "studio.runtime.artifact.v1",
    id: createLanguageExplanationReceiptArtifactId(
      input.runId,
      input.receipt.jobId,
      input.storedReceipt.content.contentId,
    ),
    runId: input.runId,
    kind: "language-explanation-receipt",
    mediaClass: "non_media",
    publication: "private",
    content: input.storedReceipt.content,
    storageKey: input.storedReceipt.storageKey,
    durationMs: null,
    tracks: [],
    sourceArtifactIds: [explanationArtifact.id, ...commonSources],
    producerTaskId: null,
    producerAgentId: null,
    origin: {
      kind: "language_explanation_receipt",
      ...commonOrigin,
      explanationArtifactId: explanationArtifact.id,
      explanationContentId: explanationArtifact.content.contentId,
    },
  };
  assertRuntimeArtifact(explanationArtifact);
  assertRuntimeArtifact(receiptArtifact);
  return { explanationArtifact, receiptArtifact };
}
