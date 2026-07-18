import type {
  OwnedMediaIngestStatus,
  RuntimeHostSourceSummary,
} from "../../runtime/production/runtimeHost/model.ts";
import {
  boolean,
  contentId,
  exact,
  fail,
  identity,
  integer,
  object,
  string,
  timestamp,
} from "./responseGuards.ts";

export function sourceSummary(value: unknown, index: number): RuntimeHostSourceSummary {
  const context = `Runtime host source ${index + 1}`;
  const item = object(value, context);
  exact(item, [
    "sourceSessionId",
    "sourceRevisionId",
    "sourceContentId",
    "sourceKind",
    "label",
    "rightsScope",
    "durationMs",
    "trackCount",
    "preflightSchema",
    "detectedLanguageEvidenceAvailable",
  ], context);
  if (item.rightsScope !== "local_processing" && item.rightsScope !== "redistribution") {
    fail(`${context}.rightsScope`, "is unsupported.");
  }
  if (item.sourceKind !== "owned_local" && item.sourceKind !== "youtube_local") {
    fail(`${context}.sourceKind`, "is unsupported.");
  }
  if (![
    "studio.preflight-bundle.v1",
    "studio.preflight-bundle.v2",
    "studio.preflight-bundle.v3",
    "studio.preflight-bundle.v4",
  ].includes(item.preflightSchema as string)) {
    fail(`${context}.preflightSchema`, "is unsupported.");
  }
  return {
    sourceSessionId: identity(item.sourceSessionId, `${context}.sourceSessionId`),
    sourceRevisionId: identity(item.sourceRevisionId, `${context}.sourceRevisionId`),
    sourceContentId: contentId(item.sourceContentId, `${context}.sourceContentId`),
    sourceKind: item.sourceKind as RuntimeHostSourceSummary["sourceKind"],
    label: string(item.label, `${context}.label`),
    rightsScope: item.rightsScope as RuntimeHostSourceSummary["rightsScope"],
    durationMs: integer(item.durationMs, `${context}.durationMs`, 1),
    trackCount: integer(item.trackCount, `${context}.trackCount`, 1),
    preflightSchema: item.preflightSchema as RuntimeHostSourceSummary["preflightSchema"],
    detectedLanguageEvidenceAvailable: boolean(
      item.detectedLanguageEvidenceAvailable,
      `${context}.detectedLanguageEvidenceAvailable`,
    ),
  };
}

const INGEST_FAILURE_CODES = new Set([
  "upload_failed",
  "probe_failed",
  "seal_failed",
  "registration_failed",
]);

export function ingestStatus(value: unknown): OwnedMediaIngestStatus {
  const context = "Owned media ingest";
  const item = object(value, context);
  exact(item, ["schema", "ingestId", "status", "updatedAt", "source", "failure"], context);
  if (item.schema !== "studio.owned-media-ingest.v1") fail(context, "schema is unsupported.");
  if (!["queued", "probing", "sealing", "registered", "failed"].includes(item.status as string)) {
    fail(`${context}.status`, "is unsupported.");
  }
  const status = item.status as OwnedMediaIngestStatus["status"];
  const source = item.source === null ? null : sourceSummary(item.source, 0);
  let failure: OwnedMediaIngestStatus["failure"] = null;
  if (item.failure !== null) {
    const detail = object(item.failure, `${context}.failure`);
    exact(detail, ["code", "message"], `${context}.failure`);
    if (!INGEST_FAILURE_CODES.has(detail.code as string)) fail(`${context}.failure.code`, "is unsupported.");
    const message = string(detail.message, `${context}.failure.message`);
    if (message.length > 256) fail(`${context}.failure.message`, "is too long.");
    failure = {
      code: detail.code as NonNullable<OwnedMediaIngestStatus["failure"]>["code"],
      message,
    };
  }
  if ((status === "registered") !== (source !== null) || (status === "failed") !== (failure !== null)) {
    fail(context, "source or failure detail does not match the terminal state.");
  }
  return {
    schema: "studio.owned-media-ingest.v1",
    ingestId: identity(item.ingestId, `${context}.ingestId`),
    status,
    updatedAt: timestamp(item.updatedAt, `${context}.updatedAt`),
    source,
    failure,
  };
}
