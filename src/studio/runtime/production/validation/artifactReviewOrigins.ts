import type { ArtifactOriginValidationInput } from "./artifactOrigin.ts";
import { contentId, exact, fail, oneOf, string } from "./primitives.ts";

export function validateReviewArtifactOrigin(
  kind: string,
  input: ArtifactOriginValidationInput,
): boolean {
  const { item, origin, mediaClass, sources, task, agent, context, path } = input;
  if (kind === "publish_review_intake") {
    exact(
      origin,
      [
        "kind",
        "intakeId",
        "receiptId",
        "receiptContentId",
        "readinessId",
        "readinessArtifactId",
        "readinessReceiptId",
        "readinessReceiptContentId",
      ],
      context,
      `${path}.origin`,
    );
    string(origin.intakeId, context, `${path}.origin.intakeId`);
    string(origin.receiptId, context, `${path}.origin.receiptId`);
    const receiptContentId = contentId(origin.receiptContentId, context, `${path}.origin.receiptContentId`);
    string(origin.readinessId, context, `${path}.origin.readinessId`);
    const readinessArtifactId = string(origin.readinessArtifactId, context, `${path}.origin.readinessArtifactId`);
    string(origin.readinessReceiptId, context, `${path}.origin.readinessReceiptId`);
    contentId(origin.readinessReceiptContentId, context, `${path}.origin.readinessReceiptContentId`);
    if (
      mediaClass !== "non_media" ||
      item.publication !== "private" ||
      item.durationMs !== null ||
      (item.tracks as unknown[]).length !== 0 ||
      task !== null ||
      agent !== null ||
      JSON.stringify(sources) !== JSON.stringify([readinessArtifactId]) ||
      receiptContentId !== (item.content as { contentId: string }).contentId
    ) {
      fail(
        context,
        path,
        "publish-review intake artifacts must be private host-produced receipt lineage over one verified study-readiness artifact",
      );
    }
  } else if (kind === "publish_review_decision") {
    exact(
      origin,
      [
        "kind",
        "reviewId",
        "receiptId",
        "receiptContentId",
        "intakeId",
        "intakeArtifactId",
        "intakeReceiptId",
        "intakeReceiptContentId",
      ],
      context,
      `${path}.origin`,
    );
    string(origin.reviewId, context, `${path}.origin.reviewId`);
    string(origin.receiptId, context, `${path}.origin.receiptId`);
    const receiptContentId = contentId(origin.receiptContentId, context, `${path}.origin.receiptContentId`);
    string(origin.intakeId, context, `${path}.origin.intakeId`);
    const intakeArtifactId = string(origin.intakeArtifactId, context, `${path}.origin.intakeArtifactId`);
    string(origin.intakeReceiptId, context, `${path}.origin.intakeReceiptId`);
    contentId(origin.intakeReceiptContentId, context, `${path}.origin.intakeReceiptContentId`);
    if (
      mediaClass !== "non_media" ||
      item.publication !== "private" ||
      item.durationMs !== null ||
      (item.tracks as unknown[]).length !== 0 ||
      task !== null ||
      agent !== null ||
      JSON.stringify(sources) !== JSON.stringify([intakeArtifactId]) ||
      receiptContentId !== (item.content as { contentId: string }).contentId
    ) {
      fail(context, path, "publish-review decisions must be private host-produced receipts over one verified intake artifact");
    }
  } else if (kind === "publish_review_revocation") {
    exact(
      origin,
      [
        "kind",
        "revocationId",
        "receiptId",
        "receiptContentId",
        "reviewId",
        "approvalArtifactId",
        "approvalReceiptId",
        "approvalReceiptContentId",
      ],
      context,
      `${path}.origin`,
    );
    string(origin.revocationId, context, `${path}.origin.revocationId`);
    string(origin.receiptId, context, `${path}.origin.receiptId`);
    const receiptContentId = contentId(origin.receiptContentId, context, `${path}.origin.receiptContentId`);
    string(origin.reviewId, context, `${path}.origin.reviewId`);
    const approvalArtifactId = string(origin.approvalArtifactId, context, `${path}.origin.approvalArtifactId`);
    string(origin.approvalReceiptId, context, `${path}.origin.approvalReceiptId`);
    contentId(origin.approvalReceiptContentId, context, `${path}.origin.approvalReceiptContentId`);
    if (
      mediaClass !== "non_media" ||
      item.publication !== "private" ||
      item.durationMs !== null ||
      (item.tracks as unknown[]).length !== 0 ||
      task !== null ||
      agent !== null ||
      JSON.stringify(sources) !== JSON.stringify([approvalArtifactId]) ||
      receiptContentId !== (item.content as { contentId: string }).contentId
    ) {
      fail(context, path, "publish-review revocations must be private host-produced receipts over one verified approval artifact");
    }
  } else if (kind === "caption_production_output") {
    exact(
      origin,
      ["kind", "jobId", "receiptId", "receiptContentId", "approvalReviewId", "approvalArtifactId", "sourceArtifactId", "studyId", "studyArtifactId", "readinessId", "readinessArtifactId"],
      context,
      `${path}.origin`,
    );
    string(origin.jobId, context, `${path}.origin.jobId`);
    string(origin.receiptId, context, `${path}.origin.receiptId`);
    contentId(origin.receiptContentId, context, `${path}.origin.receiptContentId`);
    string(origin.approvalReviewId, context, `${path}.origin.approvalReviewId`);
    const approvalArtifactId = string(origin.approvalArtifactId, context, `${path}.origin.approvalArtifactId`);
    const sourceArtifactId = string(origin.sourceArtifactId, context, `${path}.origin.sourceArtifactId`);
    string(origin.studyId, context, `${path}.origin.studyId`);
    const studyArtifactId = string(origin.studyArtifactId, context, `${path}.origin.studyArtifactId`);
    string(origin.readinessId, context, `${path}.origin.readinessId`);
    const readinessArtifactId = string(origin.readinessArtifactId, context, `${path}.origin.readinessArtifactId`);
    if (
      mediaClass !== "non_media" ||
      item.publication !== "private" ||
      item.durationMs !== null ||
      (item.tracks as unknown[]).length !== 0 ||
      task !== null ||
      agent !== null ||
      JSON.stringify(sources) !== JSON.stringify([sourceArtifactId, studyArtifactId, readinessArtifactId, approvalArtifactId])
    ) {
      fail(context, path, "caption output must be a private host-produced artifact over exact source and approval lineage");
    }
  } else if (kind === "caption_production_receipt") {
    exact(
      origin,
      ["kind", "jobId", "receiptId", "receiptContentId", "approvalReviewId", "approvalArtifactId", "captionArtifactId", "captionContentId", "studyId", "studyArtifactId", "readinessId", "readinessArtifactId"],
      context,
      `${path}.origin`,
    );
    string(origin.jobId, context, `${path}.origin.jobId`);
    string(origin.receiptId, context, `${path}.origin.receiptId`);
    const receiptContentId = contentId(origin.receiptContentId, context, `${path}.origin.receiptContentId`);
    string(origin.approvalReviewId, context, `${path}.origin.approvalReviewId`);
    const approvalArtifactId = string(origin.approvalArtifactId, context, `${path}.origin.approvalArtifactId`);
    const captionArtifactId = string(origin.captionArtifactId, context, `${path}.origin.captionArtifactId`);
    contentId(origin.captionContentId, context, `${path}.origin.captionContentId`);
    string(origin.studyId, context, `${path}.origin.studyId`);
    const studyArtifactId = string(origin.studyArtifactId, context, `${path}.origin.studyArtifactId`);
    string(origin.readinessId, context, `${path}.origin.readinessId`);
    const readinessArtifactId = string(origin.readinessArtifactId, context, `${path}.origin.readinessArtifactId`);
    if (
      mediaClass !== "non_media" ||
      item.publication !== "private" ||
      item.durationMs !== null ||
      (item.tracks as unknown[]).length !== 0 ||
      task !== null ||
      agent !== null ||
      JSON.stringify(sources) !== JSON.stringify([captionArtifactId, studyArtifactId, readinessArtifactId, approvalArtifactId]) ||
      receiptContentId !== (item.content as { contentId: string }).contentId
    ) {
      fail(context, path, "caption receipts must be private content-addressed lineage over caption output and approval");
    }
  } else if (kind === "caption_quality_control") {
    exact(
      origin,
      ["kind", "qcId", "jobId", "captionArtifactId", "captionContentId", "studyId", "readinessId", "approvalReviewId", "receiptId", "receiptContentId", "outcome"],
      context,
      `${path}.origin`,
    );
    string(origin.qcId, context, `${path}.origin.qcId`);
    string(origin.jobId, context, `${path}.origin.jobId`);
    const captionArtifactId = string(origin.captionArtifactId, context, `${path}.origin.captionArtifactId`);
    contentId(origin.captionContentId, context, `${path}.origin.captionContentId`);
    string(origin.studyId, context, `${path}.origin.studyId`);
    string(origin.readinessId, context, `${path}.origin.readinessId`);
    string(origin.approvalReviewId, context, `${path}.origin.approvalReviewId`);
    string(origin.receiptId, context, `${path}.origin.receiptId`);
    const receiptContentId = contentId(origin.receiptContentId, context, `${path}.origin.receiptContentId`);
    oneOf(origin.outcome, new Set(["accepted", "withheld"]), context, `${path}.origin.outcome`);
    if (
      mediaClass !== "non_media" ||
      item.publication !== "private" ||
      item.durationMs !== null ||
      (item.tracks as unknown[]).length !== 0 ||
      task !== null ||
      agent !== null ||
      sources.length !== 4 ||
      sources[0] !== captionArtifactId ||
      receiptContentId !== (item.content as { contentId: string }).contentId
    ) {
      fail(context, path, "caption QC must be a private independent receipt over one caption candidate and its study/approval lineage");
    }
  } else {
    return false;
  }
  return true;
}
