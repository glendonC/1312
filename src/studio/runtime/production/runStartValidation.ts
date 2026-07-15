import {
  assertProductionAnalysisRequest,
  assertProductionSourceSession,
} from "./assertions.ts";
import { canonicalSha256 } from "./artifactStore.ts";
import { freezeForecastArtifact, validateForecastArtifact } from "./forecast/planner.ts";
import type {
  ProductionAnalysisRequest,
  ProductionSourceSession,
  RuntimeStartRecord,
} from "./model.ts";

function fail(context: string, path: string, message: string): never {
  throw new Error(`${context}: ${path} ${message}`);
}

function object(value: unknown, context: string, path: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail(context, path, "must be an object");
  }
  return value as Record<string, unknown>;
}

function exact(item: Record<string, unknown>, keys: readonly string[], context: string, path: string): void {
  const allowed = new Set(keys);
  for (const key of Object.keys(item)) {
    if (!allowed.has(key)) fail(context, `${path}.${key}`, "is not allowed");
  }
  for (const key of keys) {
    if (!(key in item)) fail(context, `${path}.${key}`, "is required");
  }
}

function text(value: unknown, context: string, path: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    fail(context, path, "must be a non-empty string");
  }
  return value;
}

function literal(value: unknown, expected: string, context: string, path: string): void {
  if (value !== expected) fail(context, path, `must equal ${expected}`);
}

function isoTimestamp(value: unknown, context: string, path: string): string {
  const timestamp = text(value, context, path);
  const parsed = new Date(timestamp);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== timestamp) {
    fail(context, path, "must be an exact ISO timestamp");
  }
  return timestamp;
}

function canonical(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") return Number.isFinite(value) ? JSON.stringify(value) : "non-finite";
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (typeof value === "object") {
    const item = value as Record<string, unknown>;
    return `{${Object.keys(item).sort().map((key) => `${JSON.stringify(key)}:${canonical(item[key])}`).join(",")}}`;
  }
  return `unsupported:${typeof value}`;
}

function same(left: unknown, right: unknown): boolean {
  return canonical(left) === canonical(right);
}

/** Node-only validator for the immutable receipt beside a production journal. */
export function assertRuntimeStartRecord(
  value: unknown,
  context = "Runtime start",
): asserts value is RuntimeStartRecord {
  const item = object(value, context, "start");
  exact(
    item,
    [
      "schema",
      "producer",
      "commandId",
      "runtimeId",
      "journalId",
      "sourceSession",
      "sourceArtifactId",
      "analysisRequest",
      "workPlan",
      "forecast",
      "frozenForecast",
      "startedAt",
    ],
    context,
    "start",
  );
  literal(item.schema, "studio.runtime-start.v1", context, "start.schema");
  const producer = object(item.producer, context, "start.producer");
  exact(producer, ["id", "version"], context, "start.producer");
  literal(producer.id, "studio.local-runtime-start", context, "start.producer.id");
  literal(producer.version, "1", context, "start.producer.version");
  text(item.commandId, context, "start.commandId");
  const runtimeId = text(item.runtimeId, context, "start.runtimeId");
  text(item.journalId, context, "start.journalId");
  assertProductionSourceSession(item.sourceSession, context);
  text(item.sourceArtifactId, context, "start.sourceArtifactId");
  assertProductionAnalysisRequest(item.analysisRequest, context);
  const startedAt = isoTimestamp(item.startedAt, context, "start.startedAt");
  const session = item.sourceSession as ProductionSourceSession;
  const request = item.analysisRequest as ProductionAnalysisRequest;
  const sessionBody = {
    adapterId: session.adapterId,
    sourceReceipt: session.sourceReceipt,
    source: session.source,
    mediaProbe: session.mediaProbe,
    preflight: session.preflight,
    detectedLanguageEvidenceContentIds: session.detectedLanguageEvidenceContentIds,
  };
  if (
    session.sessionId !== `source-session:${canonicalSha256({
      adapterId: session.adapterId,
      receiptId: session.sourceReceipt.receiptId,
      sourceContentId: session.source.contentId,
    })}` ||
    session.revisionId !== `source-revision:${canonicalSha256(sessionBody)}`
  ) {
    fail(context, "start.sourceSession", "does not match its deterministic source and revision identities");
  }
  if (
    request.sourceSessionId !== session.sessionId ||
    request.sourceRevisionId !== session.revisionId ||
    request.sourceContentId !== session.source.contentId
  ) {
    fail(context, "start.analysisRequest", "does not bind the exact source-session revision");
  }
  if (!same(request.language.detectedLanguageEvidenceContentIds, session.detectedLanguageEvidenceContentIds)) {
    fail(context, "start.analysisRequest.language", "changed the source session's detector evidence references");
  }
  const requestBody = {
    sourceSessionId: request.sourceSessionId,
    sourceRevisionId: request.sourceRevisionId,
    sourceContentId: request.sourceContentId,
    range: request.range,
    language: request.language,
    outputDepth: request.outputDepth,
    options: request.options,
  };
  if (request.requestId !== `analysis-request:${canonicalSha256(requestBody)}`) {
    fail(context, "start.analysisRequest.requestId", "does not match the accepted request content");
  }

  const forecast = validateForecastArtifact(item.forecast);
  if (!same(item.workPlan, forecast.inputs.workPlan)) {
    fail(context, "start.workPlan", "does not match the frozen forecast work plan");
  }
  if (
    forecast.inputs.artifact.artifactId !== item.sourceArtifactId ||
    forecast.inputs.artifact.contentId !== session.source.contentId ||
    forecast.inputs.artifact.measuredDurationMs !== session.source.durationMs ||
    forecast.inputs.artifact.durationMeasurement.receiptContentId !== session.mediaProbe.contentId ||
    !same(forecast.inputs.selectedRange, {
      ...request.range,
      durationMs: request.range.endMs - request.range.startMs,
    })
  ) {
    fail(context, "start.forecast", "does not bind the analysis request to the measured source revision");
  }
  const frozen = object(item.frozenForecast, context, "start.frozenForecast");
  const acceptance = object(frozen.acceptance, context, "start.frozenForecast.acceptance");
  const rebuilt = freezeForecastArtifact(forecast, {
    runId: runtimeId,
    acceptedBy: text(acceptance.acceptedBy, context, "start.frozenForecast.acceptance.acceptedBy"),
    runStartAt: startedAt,
  });
  if (!same(item.frozenForecast, rebuilt)) {
    fail(context, "start.frozenForecast", "does not match the accepted forecast and run start");
  }
  const expectedCommandId = `runtime-start:${canonicalSha256({
    sourceRevisionId: session.revisionId,
    analysisRequestId: request.requestId,
    workPlan: item.workPlan,
  })}`;
  if (item.commandId !== expectedCommandId) {
    fail(context, "start.commandId", "does not match the accepted source, request, and forecast identities");
  }
}
