import type { ArtifactOriginValidationInput } from "./artifactOrigin.ts";
import { contentId, exact, fail, string } from "./primitives.ts";

const APPLY_RECEIPT_OUTPUT_KEYS: Record<string, [string, string]> = {
  language_explanation_receipt: ["explanationArtifactId", "explanationContentId"],
  learning_prep_receipt: ["prepArtifactId", "prepContentId"],
};

export function validateApplyArtifactOrigin(
  kind: string,
  input: ArtifactOriginValidationInput,
): boolean {
  const { item, origin, mediaClass, sources, task, agent, context, path } = input;
  if (
    kind !== "language_explanation_output" && kind !== "language_explanation_receipt" &&
    kind !== "learning_prep_output" && kind !== "learning_prep_receipt"
  ) return false;
  const receiptKeys = APPLY_RECEIPT_OUTPUT_KEYS[kind] ?? null;

  const commonKeys = [
    "kind",
    "jobId",
    "receiptId",
    "receiptContentId",
    "captionArtifactId",
    "captionContentId",
    "captionReceiptArtifactId",
    "captionReceiptContentId",
    "sourceArtifactId",
    "studyArtifactId",
    "readinessArtifactId",
    "approvalArtifactId",
  ];
  exact(
    origin,
    receiptKeys ? [...commonKeys, ...receiptKeys] : commonKeys,
    context,
    `${path}.origin`,
  );
  string(origin.jobId, context, `${path}.origin.jobId`);
  string(origin.receiptId, context, `${path}.origin.receiptId`);
  const receiptContentId = contentId(origin.receiptContentId, context, `${path}.origin.receiptContentId`);
  const captionArtifactId = string(origin.captionArtifactId, context, `${path}.origin.captionArtifactId`);
  contentId(origin.captionContentId, context, `${path}.origin.captionContentId`);
  const captionReceiptArtifactId = string(origin.captionReceiptArtifactId, context, `${path}.origin.captionReceiptArtifactId`);
  contentId(origin.captionReceiptContentId, context, `${path}.origin.captionReceiptContentId`);
  const sourceArtifactId = string(origin.sourceArtifactId, context, `${path}.origin.sourceArtifactId`);
  const studyArtifactId = string(origin.studyArtifactId, context, `${path}.origin.studyArtifactId`);
  const readinessArtifactId = string(origin.readinessArtifactId, context, `${path}.origin.readinessArtifactId`);
  const approvalArtifactId = string(origin.approvalArtifactId, context, `${path}.origin.approvalArtifactId`);
  const outputArtifactId = receiptKeys
    ? string(origin[receiptKeys[0]], context, `${path}.origin.${receiptKeys[0]}`)
    : null;
  if (receiptKeys) {
    contentId(origin[receiptKeys[1]], context, `${path}.origin.${receiptKeys[1]}`);
  }
  const expectedSources = receiptKeys
    ? [outputArtifactId!, captionArtifactId, captionReceiptArtifactId, sourceArtifactId, studyArtifactId, readinessArtifactId, approvalArtifactId]
    : [captionArtifactId, captionReceiptArtifactId, sourceArtifactId, studyArtifactId, readinessArtifactId, approvalArtifactId];
  if (
    mediaClass !== "non_media" ||
    item.publication !== "private" ||
    item.durationMs !== null ||
    (item.tracks as unknown[]).length !== 0 ||
    task !== null ||
    agent !== null ||
    JSON.stringify(sources) !== JSON.stringify(expectedSources) ||
    (receiptKeys !== null && receiptContentId !== (item.content as { contentId: string }).contentId)
  ) {
    fail(context, path, "private Apply outputs must be private host-produced non-media artifacts over exact caption authority");
  }
  return true;
}
