import type { ArtifactOriginValidationInput } from "./artifactOrigin.ts";
import { contentId, exact, fail, oneOf, string } from "./primitives.ts";

export function validateStudyArtifactOrigin(
  kind: string,
  input: ArtifactOriginValidationInput,
): boolean {
  const { item, origin, mediaClass, sources, task, agent, context, path } = input;
  if (kind === "study_report") {
    exact(origin, ["kind", "executionId", "receiptId", "receiptContentId", "jobContextId", "outputSlotName"], context, `${path}.origin`);
    string(origin.executionId, context, `${path}.origin.executionId`);
    string(origin.receiptId, context, `${path}.origin.receiptId`);
    contentId(origin.receiptContentId, context, `${path}.origin.receiptContentId`);
    string(origin.jobContextId, context, `${path}.origin.jobContextId`);
    string(origin.outputSlotName, context, `${path}.origin.outputSlotName`);
    if (
      item.kind !== "studio.study-report.v1" || mediaClass !== "non_media" ||
      item.publication !== "private" || item.durationMs !== null ||
      (item.tracks as unknown[]).length !== 0 || sources.length === 0 ||
      task === null || agent === null
    ) fail(context, path, "study reports must be private typed non-media artifacts with task and source lineage");
  } else if (kind === "parent_artifact_disposition") {
    exact(origin, ["kind", "dispositionId", "reportId", "inputArtifactId", "outcome", "receiptId", "receiptContentId"], context, `${path}.origin`);
    string(origin.dispositionId, context, `${path}.origin.dispositionId`);
    string(origin.reportId, context, `${path}.origin.reportId`);
    const inputArtifactId = string(origin.inputArtifactId, context, `${path}.origin.inputArtifactId`);
    oneOf(origin.outcome, new Set(["accepted", "rejected"]), context, `${path}.origin.outcome`);
    string(origin.receiptId, context, `${path}.origin.receiptId`);
    const receiptContentId = contentId(origin.receiptContentId, context, `${path}.origin.receiptContentId`);
    if (
      mediaClass !== "non_media" || item.publication !== "private" || item.durationMs !== null ||
      (item.tracks as unknown[]).length !== 0 || sources.length !== 1 || sources[0] !== inputArtifactId ||
      task === null || agent === null || receiptContentId !== (item.content as { contentId: string }).contentId
    ) fail(context, path, "parent dispositions must be private content-addressed receipts over one study artifact");
  } else if (kind === "parent_admission") {
    exact(origin, ["kind", "admissionId", "dispositionId", "reportId", "inputArtifactId", "grantId", "receiptId", "receiptContentId"], context, `${path}.origin`);
    string(origin.admissionId, context, `${path}.origin.admissionId`);
    string(origin.dispositionId, context, `${path}.origin.dispositionId`);
    string(origin.reportId, context, `${path}.origin.reportId`);
    const inputArtifactId = string(origin.inputArtifactId, context, `${path}.origin.inputArtifactId`);
    string(origin.grantId, context, `${path}.origin.grantId`);
    string(origin.receiptId, context, `${path}.origin.receiptId`);
    const receiptContentId = contentId(origin.receiptContentId, context, `${path}.origin.receiptContentId`);
    if (
      mediaClass !== "non_media" || item.publication !== "private" || item.durationMs !== null ||
      (item.tracks as unknown[]).length !== 0 || sources.length !== 1 || sources[0] !== inputArtifactId ||
      task === null || agent === null || receiptContentId !== (item.content as { contentId: string }).contentId
    ) fail(context, path, "parent admissions must be private content-addressed receipts over one accepted study artifact");
  } else if (kind === "study_planning_decision") {
    exact(origin, ["kind", "decisionId", "inputId", "executionId", "receiptId", "receiptContentId"], context, `${path}.origin`);
    string(origin.decisionId, context, `${path}.origin.decisionId`);
    string(origin.inputId, context, `${path}.origin.inputId`);
    string(origin.executionId, context, `${path}.origin.executionId`);
    string(origin.receiptId, context, `${path}.origin.receiptId`);
    const receiptContentId = contentId(origin.receiptContentId, context, `${path}.origin.receiptContentId`);
    if (
      item.kind !== "studio.study-planning-decision.receipt.v1" || mediaClass !== "non_media" ||
      item.publication !== "private" || item.durationMs !== null || (item.tracks as unknown[]).length !== 0 ||
      sources.length < 2 || task === null || agent === null ||
      receiptContentId !== (item.content as { contentId: string }).contentId
    ) fail(context, path, "study planning decisions must be private root-produced receipts over at least two admitted reports");
  } else if (kind === "owned_media_study") {
    exact(origin, ["kind", "studyId", "planningDecisionId", "executionId", "executorReceiptId", "executorReceiptContentId"], context, `${path}.origin`);
    string(origin.studyId, context, `${path}.origin.studyId`);
    string(origin.planningDecisionId, context, `${path}.origin.planningDecisionId`);
    string(origin.executionId, context, `${path}.origin.executionId`);
    string(origin.executorReceiptId, context, `${path}.origin.executorReceiptId`);
    contentId(origin.executorReceiptContentId, context, `${path}.origin.executorReceiptContentId`);
    if (
      item.kind !== "studio.owned-media-study.v1" || mediaClass !== "non_media" || item.publication !== "private" ||
      item.durationMs !== null || (item.tracks as unknown[]).length !== 0 || sources.length === 0 ||
      task === null || agent === null
    ) fail(context, path, "owned-media studies must be private root-produced typed artifacts with source lineage");
  } else if (kind === "study_readiness") {
    exact(origin, ["kind", "readinessId", "studyId", "studyArtifactId", "receiptId", "receiptContentId", "outcome"], context, `${path}.origin`);
    string(origin.readinessId, context, `${path}.origin.readinessId`);
    string(origin.studyId, context, `${path}.origin.studyId`);
    const studyArtifactId = string(origin.studyArtifactId, context, `${path}.origin.studyArtifactId`);
    string(origin.receiptId, context, `${path}.origin.receiptId`);
    const receiptContentId = contentId(origin.receiptContentId, context, `${path}.origin.receiptContentId`);
    oneOf(origin.outcome, new Set(["proceed_to_caption_review", "withheld"]), context, `${path}.origin.outcome`);
    if (
      (item.kind !== "studio.study-readiness.receipt.v1" && item.kind !== "studio.study-readiness.receipt.v2") || mediaClass !== "non_media" || item.publication !== "private" ||
      item.durationMs !== null || (item.tracks as unknown[]).length !== 0 || task !== null || agent !== null ||
      JSON.stringify(sources) !== JSON.stringify([studyArtifactId]) ||
      receiptContentId !== (item.content as { contentId: string }).contentId
    ) fail(context, path, "study readiness must be a private deterministic receipt over one exact owned-media study");
  } else {
    return false;
  }
  return true;
}
