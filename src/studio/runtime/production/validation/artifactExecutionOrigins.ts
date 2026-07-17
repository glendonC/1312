import type { ArtifactOriginValidationInput } from "./artifactOrigin.ts";
import { contentId, exact, fail, oneOf, string, uniqueStrings } from "./primitives.ts";

export function validateExecutionArtifactOrigin(
  kind: string,
  input: ArtifactOriginValidationInput,
): boolean {
  const { item, origin, mediaClass, sources, task, agent, context, path } = input;
  if (kind === "ingest") {
    exact(origin, ["kind", "adapterId", "sourceReceiptRef"], context, `${path}.origin`);
    string(origin.adapterId, context, `${path}.origin.adapterId`);
    string(origin.sourceReceiptRef, context, `${path}.origin.sourceReceiptRef`);
    if (mediaClass !== "raw" || sources.length !== 0 || task !== null || agent !== null) {
      fail(
        context,
        path,
        "ingest artifacts must be raw and cannot claim a task producer or lineage",
      );
    }
  } else if (kind === "media_operation") {
    exact(
      origin,
      ["kind", "operationId", "receiptId", "receiptContentId"],
      context,
      `${path}.origin`,
    );
    string(origin.operationId, context, `${path}.origin.operationId`);
    string(origin.receiptId, context, `${path}.origin.receiptId`);
    string(origin.receiptContentId, context, `${path}.origin.receiptContentId`);
    if (mediaClass !== "derived" || sources.length === 0 || task === null || agent === null) {
      fail(
        context,
        path,
        "media operation artifacts require derived lineage and a task producer",
      );
    }
  } else if (kind === "media_observation") {
    exact(
      origin,
      ["kind", "operationId", "receiptId", "receiptContentId"],
      context,
      `${path}.origin`,
    );
    string(origin.operationId, context, `${path}.origin.operationId`);
    string(origin.receiptId, context, `${path}.origin.receiptId`);
    const receiptContentId = contentId(
      origin.receiptContentId,
      context,
      `${path}.origin.receiptContentId`,
    );
    if (
      mediaClass !== "non_media" ||
      item.durationMs !== null ||
      (item.tracks as unknown[]).length !== 0 ||
      sources.length === 0 ||
      task === null ||
      agent === null ||
      receiptContentId !== (item.content as { contentId: string }).contentId
    ) {
      fail(
        context,
        path,
        "media observation artifacts must be their content-addressed receipt with source lineage and a task producer",
      );
    }
  } else if (kind === "semantic_media_evidence") {
    exact(
      origin,
      ["kind", "operationId", "receiptId", "receiptContentId", "availabilityId"],
      context,
      `${path}.origin`,
    );
    string(origin.operationId, context, `${path}.origin.operationId`);
    string(origin.receiptId, context, `${path}.origin.receiptId`);
    contentId(origin.receiptContentId, context, `${path}.origin.receiptContentId`);
    string(origin.availabilityId, context, `${path}.origin.availabilityId`);
    if (
      item.kind !== "studio.semantic-media-evidence.v1" ||
      mediaClass !== "non_media" ||
      item.publication !== "private" ||
      item.durationMs !== null ||
      (item.tracks as unknown[]).length !== 0 ||
      sources.length !== 1 ||
      task === null ||
      agent === null ||
      (origin.receiptContentId as string) === (item.content as { contentId: string }).contentId
    ) {
      fail(context, path, "semantic evidence must be one private content-addressed envelope with separate receipt and exact task/source lineage");
    }
  } else if (kind === "worker_output") {
    exact(
      origin,
      ["kind", "executionId", "receiptId", "receiptContentId"],
      context,
      `${path}.origin`,
    );
    string(origin.executionId, context, `${path}.origin.executionId`);
    string(origin.receiptId, context, `${path}.origin.receiptId`);
    string(origin.receiptContentId, context, `${path}.origin.receiptContentId`);
    if (
      mediaClass !== "non_media" ||
      item.durationMs !== null ||
      (item.tracks as unknown[]).length !== 0
    ) {
      fail(context, path, "worker output artifacts must be non-media without duration or tracks");
    }
    if (sources.length !== 0 || task === null || agent === null) {
      fail(
        context,
        path,
        "worker output artifacts require a task producer and cannot claim media lineage",
      );
    }
  } else if (kind === "root_output_disposition") {
    exact(
      origin,
      [
        "kind",
        "dispositionId",
        "reportId",
        "inputArtifactId",
        "outcome",
        "receiptId",
        "receiptContentId",
      ],
      context,
      `${path}.origin`,
    );
    string(origin.dispositionId, context, `${path}.origin.dispositionId`);
    string(origin.reportId, context, `${path}.origin.reportId`);
    const inputArtifactId = string(origin.inputArtifactId, context, `${path}.origin.inputArtifactId`);
    oneOf(
      origin.outcome,
      new Set(["promoted_to_root", "rejected_by_root"]),
      context,
      `${path}.origin.outcome`,
    );
    string(origin.receiptId, context, `${path}.origin.receiptId`);
    const receiptContentId = contentId(
      origin.receiptContentId,
      context,
      `${path}.origin.receiptContentId`,
    );
    if (
      mediaClass !== "non_media" ||
      item.publication !== "private" ||
      item.durationMs !== null ||
      (item.tracks as unknown[]).length !== 0 ||
      sources.length !== 1 ||
      sources[0] !== inputArtifactId ||
      task === null ||
      agent === null ||
      receiptContentId !== (item.content as { contentId: string }).contentId
    ) {
      fail(
        context,
        path,
        "root output disposition artifacts must be private content-addressed receipts with one child output and one root producer",
      );
    }
  } else if (kind === "preflight_evidence") {
    const hasProducerReceipt = origin.evidenceKind === "acoustic_ranges";
    exact(
      origin,
      hasProducerReceipt ? [
        "kind", "evidenceKind", "receiptSchema", "producerId", "preflightId", "preflightContentId", "producerReceiptContentId",
      ] : [
        "kind",
        "evidenceKind",
        "receiptSchema",
        "producerId",
        "preflightId",
        "preflightContentId",
      ],
      context,
      `${path}.origin`,
    );
    const evidenceKind = oneOf(
      origin.evidenceKind,
      new Set(["speech_activity", "language_ranges", "acoustic_ranges"]),
      context,
      `${path}.origin.evidenceKind`,
    );
    const receiptSchema = oneOf(
      origin.receiptSchema,
      new Set(["studio.speech-activity.v1", "studio.language-ranges.v1", "studio.acoustic-observations.v1"]),
      context,
      `${path}.origin.receiptSchema`,
    );
    const producerId = oneOf(
      origin.producerId,
      new Set(["silero-vad", "whisper-language-id", "yamnet-acoustic-triage"]),
      context,
      `${path}.origin.producerId`,
    );
    string(origin.preflightId, context, `${path}.origin.preflightId`);
    contentId(origin.preflightContentId, context, `${path}.origin.preflightContentId`);
    if (hasProducerReceipt) contentId(origin.producerReceiptContentId, context, `${path}.origin.producerReceiptContentId`);
    if (
      mediaClass !== "non_media" ||
      item.durationMs !== null ||
      (item.tracks as unknown[]).length !== 0 ||
      sources.length !== 1 ||
      task !== null ||
      agent !== null ||
      (evidenceKind === "speech_activity" &&
        (receiptSchema !== "studio.speech-activity.v1" || producerId !== "silero-vad")) ||
      (evidenceKind === "language_ranges" &&
        (receiptSchema !== "studio.language-ranges.v1" || producerId !== "whisper-language-id")) ||
      (evidenceKind === "acoustic_ranges" &&
        (receiptSchema !== "studio.acoustic-observations.v1" || producerId !== "yamnet-acoustic-triage"))
    ) {
      fail(
        context,
        path,
        "preflight evidence must be one validated non-media receipt with source lineage and no task producer",
      );
    }
  } else if (kind === "evidence_assessment") {
    exact(
      origin,
      ["kind", "operationId", "receiptId", "receiptContentId", "readReceiptIds", "readReceiptContentIds"],
      context,
      `${path}.origin`,
    );
    string(origin.operationId, context, `${path}.origin.operationId`);
    string(origin.receiptId, context, `${path}.origin.receiptId`);
    const receiptContentId = contentId(origin.receiptContentId, context, `${path}.origin.receiptContentId`);
    const readReceiptIds = uniqueStrings(origin.readReceiptIds, context, `${path}.origin.readReceiptIds`);
    const readReceiptContentIds = uniqueStrings(origin.readReceiptContentIds, context, `${path}.origin.readReceiptContentIds`);
    readReceiptContentIds.forEach((id, index) => contentId(id, context, `${path}.origin.readReceiptContentIds[${index}]`));
    if (
      mediaClass !== "non_media" ||
      item.durationMs !== null ||
      (item.tracks as unknown[]).length !== 0 ||
      sources.length !== 0 ||
      task === null ||
      agent === null ||
      readReceiptIds.length === 0 ||
      readReceiptIds.length !== readReceiptContentIds.length ||
      receiptContentId !== (item.content as { contentId: string }).contentId
    ) {
      fail(context, path, "evidence assessment artifacts must be their content-addressed receipt with read-receipt lineage and a task producer");
    }
  } else if (kind === "evidence_decision") {
    exact(
      origin,
      [
        "kind",
        "operationId",
        "receiptId",
        "receiptContentId",
        "assessmentOperationIds",
        "assessmentArtifactIds",
        "assessmentReceiptIds",
        "assessmentReceiptContentIds",
      ],
      context,
      `${path}.origin`,
    );
    string(origin.operationId, context, `${path}.origin.operationId`);
    string(origin.receiptId, context, `${path}.origin.receiptId`);
    const receiptContentId = contentId(origin.receiptContentId, context, `${path}.origin.receiptContentId`);
    const assessmentOperationIds = uniqueStrings(origin.assessmentOperationIds, context, `${path}.origin.assessmentOperationIds`);
    const assessmentArtifactIds = uniqueStrings(origin.assessmentArtifactIds, context, `${path}.origin.assessmentArtifactIds`);
    const assessmentReceiptIds = uniqueStrings(origin.assessmentReceiptIds, context, `${path}.origin.assessmentReceiptIds`);
    const assessmentReceiptContentIds = uniqueStrings(
      origin.assessmentReceiptContentIds,
      context,
      `${path}.origin.assessmentReceiptContentIds`,
    );
    assessmentReceiptContentIds.forEach((id, index) =>
      contentId(id, context, `${path}.origin.assessmentReceiptContentIds[${index}]`));
    if (
      mediaClass !== "non_media" ||
      item.durationMs !== null ||
      (item.tracks as unknown[]).length !== 0 ||
      task === null ||
      agent === null ||
      assessmentOperationIds.length === 0 ||
      assessmentOperationIds.length !== assessmentArtifactIds.length ||
      assessmentOperationIds.length !== assessmentReceiptIds.length ||
      assessmentOperationIds.length !== assessmentReceiptContentIds.length ||
      JSON.stringify(sources) !== JSON.stringify(assessmentArtifactIds) ||
      receiptContentId !== (item.content as { contentId: string }).contentId
    ) {
      fail(context, path, "evidence decision artifacts must be their content-addressed receipt with audited assessment lineage and a task producer");
    }
  } else {
    return false;
  }
  return true;
}
