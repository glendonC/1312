import type {
  PreflightEvidenceArtifactDescriptor,
  RuntimeArtifact,
  SourceArtifactDescriptor,
  WorkerOutputEnvelope,
} from "../model.ts";
import {
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
  exact(item, ["schema", "executionId", "taskId", "agentId", "output"], context, "envelope");
  literal(item.schema, "studio.worker-output.v1", context, "envelope.schema");
  string(item.executionId, context, "envelope.executionId");
  string(item.taskId, context, "envelope.taskId");
  string(item.agentId, context, "envelope.agentId");
  const output = object(item.output, context, "envelope.output");
  exact(output, ["name", "kind", "content"], context, "envelope.output");
  string(output.name, context, "envelope.output.name");
  string(output.kind, context, "envelope.output.kind");
  string(output.content, context, "envelope.output.content");
}
