import type {
  PreflightEvidenceArtifactDescriptor,
  RuntimeArtifact,
  SourceArtifactDescriptor,
  WorkerOutputEnvelope,
} from "../model.ts";
import {
  array,
  contentId,
  exact,
  fail,
  hash,
  integer,
  literal,
  nullableString,
  object,
  oneOf,
  string,
  uniqueStrings,
} from "./primitives.ts";
import { validateSemanticEvidenceCitationInput } from "./semanticEvidence.ts";
import { validateTracks } from "./scheduling.ts";

export function assertSourceArtifactDescriptor(
  value: unknown,
  context = "Source artifact descriptor",
): asserts value is SourceArtifactDescriptor {
  const item = object(value, context, "source");
  exact(
    item,
    [
      "schema",
      "adapterId",
      "sourceReceiptRef",
      "publication",
      "path",
      "content",
      "durationMs",
      "tracks",
    ],
    context,
    "source",
  );
  literal(item.schema, "studio.source-artifact.v1", context, "source.schema");
  string(item.adapterId, context, "source.adapterId");
  string(item.sourceReceiptRef, context, "source.sourceReceiptRef");
  oneOf(item.publication, new Set(["private", "public"]), context, "source.publication");
  string(item.path, context, "source.path");
  hash(item.content, context, "source.content");
  const duration = integer(item.durationMs, context, "source.durationMs", 1);
  validateTracks(item.tracks, context, "source.tracks");
  for (const candidate of item.tracks as Array<{ durationMs: number | null }>) {
    if (candidate.durationMs !== null && candidate.durationMs > duration + 1) {
      fail(context, "source.tracks", "contains a duration beyond the source duration");
    }
  }
}

export function assertPreflightEvidenceArtifactDescriptor(
  value: unknown,
  context = "Preflight evidence artifact descriptor",
): asserts value is PreflightEvidenceArtifactDescriptor {
  const item = object(value, context, "evidence");
  exact(
    item,
    [
      "schema",
      "evidenceKind",
      "receiptSchema",
      "producerId",
      "path",
      "content",
      "preflightId",
      "preflightContentId",
    ],
    context,
    "evidence",
  );
  literal(item.schema, "studio.preflight-evidence-artifact.v1", context, "evidence.schema");
  const evidenceKind = oneOf(
    item.evidenceKind,
    new Set(["speech_activity", "language_ranges"]),
    context,
    "evidence.evidenceKind",
  );
  const receiptSchema = oneOf(
    item.receiptSchema,
    new Set(["studio.speech-activity.v1", "studio.language-ranges.v1"]),
    context,
    "evidence.receiptSchema",
  );
  const producerId = oneOf(
    item.producerId,
    new Set(["silero-vad", "whisper-language-id"]),
    context,
    "evidence.producerId",
  );
  if (
    (evidenceKind === "speech_activity" &&
      (receiptSchema !== "studio.speech-activity.v1" || producerId !== "silero-vad")) ||
    (evidenceKind === "language_ranges" &&
      (receiptSchema !== "studio.language-ranges.v1" || producerId !== "whisper-language-id"))
  ) {
    fail(context, "evidence", "kind, receipt schema, and pinned producer must agree");
  }
  string(item.path, context, "evidence.path");
  hash(item.content, context, "evidence.content");
  string(item.preflightId, context, "evidence.preflightId");
  contentId(item.preflightContentId, context, "evidence.preflightContentId");
}

export function validateRuntimeArtifact(
  value: unknown,
  context: string,
  path: string,
): asserts value is RuntimeArtifact {
  const item = object(value, context, path);
  exact(
    item,
    [
      "schema",
      "id",
      "runId",
      "kind",
      "mediaClass",
      "publication",
      "content",
      "storageKey",
      "durationMs",
      "tracks",
      "sourceArtifactIds",
      "producerTaskId",
      "producerAgentId",
      "origin",
    ],
    context,
    path,
  );
  literal(item.schema, "studio.runtime.artifact.v1", context, `${path}.schema`);
  string(item.id, context, `${path}.id`);
  string(item.runId, context, `${path}.runId`);
  string(item.kind, context, `${path}.kind`);
  const mediaClass = oneOf<string>(
    item.mediaClass,
    new Set(["raw", "derived", "non_media"]),
    context,
    `${path}.mediaClass`,
  );
  oneOf(item.publication, new Set(["private", "public"]), context, `${path}.publication`);
  hash(item.content, context, `${path}.content`);
  const storageKey = string(item.storageKey, context, `${path}.storageKey`);
  if (storageKey.startsWith("/") || storageKey.split("/").includes("..")) {
    fail(context, `${path}.storageKey`, "must be a relative contained key");
  }
  if (item.durationMs !== null) integer(item.durationMs, context, `${path}.durationMs`, 1);
  validateTracks(item.tracks, context, `${path}.tracks`);
  const sources = uniqueStrings(item.sourceArtifactIds, context, `${path}.sourceArtifactIds`);
  const task = nullableString(item.producerTaskId, context, `${path}.producerTaskId`);
  const agent = nullableString(item.producerAgentId, context, `${path}.producerAgentId`);
  const origin = object(item.origin, context, `${path}.origin`);
  const kind = string(origin.kind, context, `${path}.origin.kind`);
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
    exact(
      origin,
      [
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
      new Set(["speech_activity", "language_ranges"]),
      context,
      `${path}.origin.evidenceKind`,
    );
    const receiptSchema = oneOf(
      origin.receiptSchema,
      new Set(["studio.speech-activity.v1", "studio.language-ranges.v1"]),
      context,
      `${path}.origin.receiptSchema`,
    );
    const producerId = oneOf(
      origin.producerId,
      new Set(["silero-vad", "whisper-language-id"]),
      context,
      `${path}.origin.producerId`,
    );
    string(origin.preflightId, context, `${path}.origin.preflightId`);
    contentId(origin.preflightContentId, context, `${path}.origin.preflightContentId`);
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
        (receiptSchema !== "studio.language-ranges.v1" || producerId !== "whisper-language-id"))
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
  } else if (kind === "publish_review_intake") {
    exact(
      origin,
      [
        "kind",
        "intakeId",
        "receiptId",
        "receiptContentId",
        "decisionOperationId",
        "decisionArtifactId",
        "decisionReceiptId",
        "decisionReceiptContentId",
      ],
      context,
      `${path}.origin`,
    );
    string(origin.intakeId, context, `${path}.origin.intakeId`);
    string(origin.receiptId, context, `${path}.origin.receiptId`);
    const receiptContentId = contentId(origin.receiptContentId, context, `${path}.origin.receiptContentId`);
    string(origin.decisionOperationId, context, `${path}.origin.decisionOperationId`);
    const decisionArtifactId = string(origin.decisionArtifactId, context, `${path}.origin.decisionArtifactId`);
    string(origin.decisionReceiptId, context, `${path}.origin.decisionReceiptId`);
    contentId(origin.decisionReceiptContentId, context, `${path}.origin.decisionReceiptContentId`);
    if (
      mediaClass !== "non_media" ||
      item.publication !== "private" ||
      item.durationMs !== null ||
      (item.tracks as unknown[]).length !== 0 ||
      task !== null ||
      agent !== null ||
      JSON.stringify(sources) !== JSON.stringify([decisionArtifactId]) ||
      receiptContentId !== (item.content as { contentId: string }).contentId
    ) {
      fail(
        context,
        path,
        "publish-review intake artifacts must be private host-produced receipt lineage over one verified decision artifact",
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
      ["kind", "jobId", "receiptId", "receiptContentId", "approvalReviewId", "approvalArtifactId", "sourceArtifactId", "acceptedChildArtifactId", "rootPromotionArtifactId"],
      context,
      `${path}.origin`,
    );
    string(origin.jobId, context, `${path}.origin.jobId`);
    string(origin.receiptId, context, `${path}.origin.receiptId`);
    contentId(origin.receiptContentId, context, `${path}.origin.receiptContentId`);
    string(origin.approvalReviewId, context, `${path}.origin.approvalReviewId`);
    const approvalArtifactId = string(origin.approvalArtifactId, context, `${path}.origin.approvalArtifactId`);
    const sourceArtifactId = string(origin.sourceArtifactId, context, `${path}.origin.sourceArtifactId`);
    const acceptedChildArtifactId = string(origin.acceptedChildArtifactId, context, `${path}.origin.acceptedChildArtifactId`);
    const rootPromotionArtifactId = string(origin.rootPromotionArtifactId, context, `${path}.origin.rootPromotionArtifactId`);
    if (
      mediaClass !== "non_media" ||
      item.publication !== "private" ||
      item.durationMs !== null ||
      (item.tracks as unknown[]).length !== 0 ||
      task !== null ||
      agent !== null ||
      JSON.stringify(sources) !== JSON.stringify([sourceArtifactId, acceptedChildArtifactId, rootPromotionArtifactId, approvalArtifactId])
    ) {
      fail(context, path, "caption output must be a private host-produced artifact over exact source and approval lineage");
    }
  } else if (kind === "caption_production_receipt") {
    exact(
      origin,
      ["kind", "jobId", "receiptId", "receiptContentId", "approvalReviewId", "approvalArtifactId", "captionArtifactId", "captionContentId", "rootPromotionArtifactId"],
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
    const rootPromotionArtifactId = string(origin.rootPromotionArtifactId, context, `${path}.origin.rootPromotionArtifactId`);
    if (
      mediaClass !== "non_media" ||
      item.publication !== "private" ||
      item.durationMs !== null ||
      (item.tracks as unknown[]).length !== 0 ||
      task !== null ||
      agent !== null ||
      JSON.stringify(sources) !== JSON.stringify([captionArtifactId, rootPromotionArtifactId, approvalArtifactId]) ||
      receiptContentId !== (item.content as { contentId: string }).contentId
    ) {
      fail(context, path, "caption receipts must be private content-addressed lineage over caption output and approval");
    }
  } else if (kind === "caption_quality_control") {
    exact(
      origin,
      ["kind", "qcId", "jobId", "captionArtifactId", "captionContentId", "receiptId", "receiptContentId", "outcome"],
      context,
      `${path}.origin`,
    );
    string(origin.qcId, context, `${path}.origin.qcId`);
    string(origin.jobId, context, `${path}.origin.jobId`);
    const captionArtifactId = string(origin.captionArtifactId, context, `${path}.origin.captionArtifactId`);
    contentId(origin.captionContentId, context, `${path}.origin.captionContentId`);
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
      sources.length !== 2 ||
      sources[0] !== captionArtifactId ||
      receiptContentId !== (item.content as { contentId: string }).contentId
    ) {
      fail(context, path, "caption QC must be a private independent receipt over one caption candidate and its root promotion");
    }
  } else {
    fail(context, `${path}.origin.kind`, `has unknown value ${kind}`);
  }
}

export function assertRuntimeArtifact(
  value: unknown,
  context = "Runtime artifact",
): asserts value is RuntimeArtifact {
  validateRuntimeArtifact(value, context, "artifact");
}

export function assertWorkerOutputEnvelope(
  value: unknown,
  context = "Worker output",
): asserts value is WorkerOutputEnvelope {
  const item = object(value, context, "envelope");
  exact(
    item,
    item.semanticEvidenceInputs === undefined
      ? ["schema", "executionId", "taskId", "agentId", "output"]
      : ["schema", "executionId", "taskId", "agentId", "semanticEvidenceInputs", "output"],
    context,
    "envelope",
  );
  literal(item.schema, "studio.worker-output.v1", context, "envelope.schema");
  string(item.executionId, context, "envelope.executionId");
  string(item.taskId, context, "envelope.taskId");
  string(item.agentId, context, "envelope.agentId");
  if (item.semanticEvidenceInputs !== undefined) {
    const inputs = array(item.semanticEvidenceInputs, context, "envelope.semanticEvidenceInputs");
    if (inputs.length === 0) {
      fail(context, "envelope.semanticEvidenceInputs", "must name at least one authenticated semantic operation");
    }
    inputs.forEach((input, index) =>
      validateSemanticEvidenceCitationInput(input, context, `envelope.semanticEvidenceInputs[${index}]`));
    const operationIds = inputs.map((input) => (input as { operationId: string }).operationId);
    if (new Set(operationIds).size !== operationIds.length) {
      fail(context, "envelope.semanticEvidenceInputs", "must not repeat operations");
    }
  }
  const output = object(item.output, context, "envelope.output");
  exact(output, ["name", "kind", "content"], context, "envelope.output");
  string(output.name, context, "envelope.output.name");
  string(output.kind, context, "envelope.output.kind");
  string(output.content, context, "envelope.output.content");
}
