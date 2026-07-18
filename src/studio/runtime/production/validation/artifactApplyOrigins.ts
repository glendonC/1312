import type { ArtifactOriginValidationInput } from "./artifactOrigin.ts";
import { contentId, exact, fail, string } from "./primitives.ts";

export function validateApplyArtifactOrigin(
  kind: string,
  input: ArtifactOriginValidationInput,
): boolean {
  const { item, origin, mediaClass, sources, task, agent, context, path } = input;
  if (kind !== "language_explanation_output" && kind !== "language_explanation_receipt") return false;

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
    kind === "language_explanation_receipt"
      ? [...commonKeys, "explanationArtifactId", "explanationContentId"]
      : commonKeys,
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
  const explanationArtifactId = kind === "language_explanation_receipt"
    ? string(origin.explanationArtifactId, context, `${path}.origin.explanationArtifactId`)
    : null;
  if (kind === "language_explanation_receipt") {
    contentId(origin.explanationContentId, context, `${path}.origin.explanationContentId`);
  }
  const expectedSources = kind === "language_explanation_receipt"
    ? [explanationArtifactId!, captionArtifactId, captionReceiptArtifactId, sourceArtifactId, studyArtifactId, readinessArtifactId, approvalArtifactId]
    : [captionArtifactId, captionReceiptArtifactId, sourceArtifactId, studyArtifactId, readinessArtifactId, approvalArtifactId];
  if (
    mediaClass !== "non_media" ||
    item.publication !== "private" ||
    item.durationMs !== null ||
    (item.tracks as unknown[]).length !== 0 ||
    task !== null ||
    agent !== null ||
    JSON.stringify(sources) !== JSON.stringify(expectedSources) ||
    (kind === "language_explanation_receipt" && receiptContentId !== (item.content as { contentId: string }).contentId)
  ) {
    fail(context, path, "language explanations must be private host-produced non-media artifacts over exact caption authority");
  }
  return true;
}
