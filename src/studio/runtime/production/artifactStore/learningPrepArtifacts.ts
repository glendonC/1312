import { assertRuntimeArtifact } from "../assertions.ts";
import type {
  ContentIdentity,
  LearningPrepArtifact,
  LearningPrepReceipt,
  RuntimeArtifact,
} from "../model.ts";
import {
  createLearningPrepArtifactId,
  createLearningPrepReceiptArtifactId,
} from "./contentIdentity.ts";

export function buildLearningPrepArtifacts(input: {
  runId: string;
  prep: LearningPrepArtifact;
  receipt: LearningPrepReceipt;
  storedPrep: { content: ContentIdentity; storageKey: string };
  storedReceipt: { content: ContentIdentity; storageKey: string };
}): { prepArtifact: RuntimeArtifact; receiptArtifact: RuntimeArtifact } {
  const authority = input.prep.input;
  const prepArtifactId = createLearningPrepArtifactId(
    input.runId,
    input.prep.jobId,
    input.storedPrep.content.contentId,
  );
  if (
    input.prep.runId !== input.runId ||
    input.prep.jobId !== input.receipt.jobId ||
    input.receipt.result.artifactId !== prepArtifactId ||
    input.receipt.result.contentId !== input.storedPrep.content.contentId ||
    input.receipt.result.bytes !== input.storedPrep.content.bytes
  ) throw new Error("Learning-prep receipt does not bind the exact stored artifact");

  const commonSources = [
    authority.caption.artifactId,
    authority.caption.receiptArtifactId,
    authority.source.artifactId,
    authority.study.artifactId,
    authority.readiness.artifactId,
    authority.approval.artifactId,
  ];
  const commonOrigin = {
    jobId: input.prep.jobId,
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
  const prepArtifact: RuntimeArtifact = {
    schema: "studio.runtime.artifact.v1",
    id: prepArtifactId,
    runId: input.runId,
    kind: "learning-prep-output",
    mediaClass: "non_media",
    publication: "private",
    content: input.storedPrep.content,
    storageKey: input.storedPrep.storageKey,
    durationMs: null,
    tracks: [],
    sourceArtifactIds: commonSources,
    producerTaskId: null,
    producerAgentId: null,
    origin: { kind: "learning_prep_output", ...commonOrigin },
  };
  const receiptArtifact: RuntimeArtifact = {
    schema: "studio.runtime.artifact.v1",
    id: createLearningPrepReceiptArtifactId(
      input.runId,
      input.receipt.jobId,
      input.storedReceipt.content.contentId,
    ),
    runId: input.runId,
    kind: "learning-prep-receipt",
    mediaClass: "non_media",
    publication: "private",
    content: input.storedReceipt.content,
    storageKey: input.storedReceipt.storageKey,
    durationMs: null,
    tracks: [],
    sourceArtifactIds: [prepArtifact.id, ...commonSources],
    producerTaskId: null,
    producerAgentId: null,
    origin: {
      kind: "learning_prep_receipt",
      ...commonOrigin,
      prepArtifactId: prepArtifact.id,
      prepContentId: prepArtifact.content.contentId,
    },
  };
  assertRuntimeArtifact(prepArtifact);
  assertRuntimeArtifact(receiptArtifact);
  return { prepArtifact, receiptArtifact };
}
