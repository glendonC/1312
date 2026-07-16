import { assertRuntimeEvent } from "../../runtime/production/validation/events.ts";
import type {
  RuntimeHostPollResponse,
  RuntimeHostStartAcknowledgement,
  RuntimeHostStatus,
} from "../../runtime/production/runtimeHost/model.ts";
import {
  boolean,
  contentId,
  exact,
  fail,
  identity,
  integer,
  lifecycle,
  object,
  reason,
  timestamp,
} from "./responseGuards.ts";

function validateReceiptBindings(
  value: unknown,
  status: {
    commandId: string;
    runtimeId: string;
    journalId: string;
    sourceSessionId: string;
    sourceRevisionId: string;
    analysisRequestId: string;
    forecast: NonNullable<RuntimeHostStatus["forecast"]>;
  },
): RuntimeHostStatus["runStartReceipt"] {
  const receipt = object(value, "Runtime host start receipt");
  exact(receipt, ["contentId", "record"], "Runtime host start receipt");
  const record = object(receipt.record, "Runtime host start receipt record");
  if (record.schema !== "studio.runtime-start.v1") fail("Runtime host start receipt", "schema is unsupported.");
  const session = object(record.sourceSession, "Runtime host receipt source session");
  const request = object(record.analysisRequest, "Runtime host receipt analysis request");
  const forecast = object(record.forecast, "Runtime host receipt forecast");
  const forecastContent = object(forecast.content, "Runtime host receipt forecast content");
  const frozen = object(record.frozenForecast, "Runtime host frozen forecast");
  const bindings = {
    commandId: identity(record.commandId, "Runtime host receipt commandId"),
    runtimeId: identity(record.runtimeId, "Runtime host receipt runtimeId"),
    journalId: identity(record.journalId, "Runtime host receipt journalId"),
    sourceSessionId: identity(session.sessionId, "Runtime host receipt source session id"),
    sourceRevisionId: identity(session.revisionId, "Runtime host receipt source revision id"),
    analysisRequestId: identity(request.requestId, "Runtime host receipt analysis request id"),
    forecastId: identity(forecast.forecastId, "Runtime host receipt forecast id"),
    forecastContentId: contentId(forecastContent.contentId, "Runtime host receipt forecast content id"),
    frozenForecastId: identity(frozen.freezeId, "Runtime host receipt frozen forecast id"),
  };
  if (
    bindings.commandId !== status.commandId ||
    bindings.runtimeId !== status.runtimeId ||
    bindings.journalId !== status.journalId ||
    bindings.sourceSessionId !== status.sourceSessionId ||
    bindings.sourceRevisionId !== status.sourceRevisionId ||
    bindings.analysisRequestId !== status.analysisRequestId ||
    bindings.forecastId !== status.forecast.forecastId ||
    bindings.forecastContentId !== status.forecast.contentId ||
    bindings.frozenForecastId !== status.forecast.frozenForecastId
  ) {
    fail("Runtime host start receipt", "identities do not match the acknowledgement envelope.");
  }
  return {
    contentId: contentId(receipt.contentId, "Runtime host start receipt contentId"),
    record: record as unknown as NonNullable<RuntimeHostStatus["runStartReceipt"]>["record"],
  };
}

export function statusResponse(
  value: unknown,
  expectedSchema: RuntimeHostStatus["schema"] | RuntimeHostStartAcknowledgement["schema"],
): RuntimeHostStatus | RuntimeHostStartAcknowledgement {
  const context = expectedSchema === "studio.local-runtime-status.v1"
    ? "Runtime host status"
    : "Runtime host start acknowledgement";
  const item = object(value, context);
  exact(item, [
    "schema",
    "commandId",
    "runtimeId",
    "journalId",
    "lifecycle",
    "acceptedAt",
    "lastTransitionAt",
    "reason",
    "sourceSessionId",
    "sourceRevisionId",
    "analysisRequestId",
    "forecast",
    "runStartReceipt",
    "journalHead",
    "terminal",
  ], context);
  if (item.schema !== expectedSchema) fail(context, "schema is unsupported.");
  const parsedLifecycle = lifecycle(item.lifecycle, `${context}.lifecycle`);
  const parsedReason = reason(item.reason, `${context}.reason`);
  const isClosedFailure = parsedLifecycle === "failed" || parsedLifecycle === "interrupted";
  if (isClosedFailure !== (parsedReason !== null)) {
    fail(context, "failed and interrupted states require exactly one closed reason.");
  }
  const terminal = boolean(item.terminal, `${context}.terminal`);
  if (terminal !== ["terminal", "failed", "interrupted"].includes(parsedLifecycle)) {
    fail(context, "terminal flag does not match lifecycle.");
  }

  const base = {
    schema: expectedSchema,
    commandId: identity(item.commandId, `${context}.commandId`),
    runtimeId: identity(item.runtimeId, `${context}.runtimeId`),
    journalId: identity(item.journalId, `${context}.journalId`),
    lifecycle: parsedLifecycle,
    acceptedAt: timestamp(item.acceptedAt, `${context}.acceptedAt`),
    lastTransitionAt: timestamp(item.lastTransitionAt, `${context}.lastTransitionAt`),
    reason: parsedReason,
    sourceSessionId: identity(item.sourceSessionId, `${context}.sourceSessionId`),
    sourceRevisionId: identity(item.sourceRevisionId, `${context}.sourceRevisionId`),
    analysisRequestId: identity(item.analysisRequestId, `${context}.analysisRequestId`),
    journalHead: integer(item.journalHead, `${context}.journalHead`),
    terminal,
  };
  const forecast = item.forecast === null
    ? null
    : (() => {
        const candidate = object(item.forecast, `${context}.forecast`);
        exact(candidate, ["forecastId", "contentId", "frozenForecastId", "baselineStatus"], `${context}.forecast`);
        if (candidate.baselineStatus !== "floor_only") fail(`${context}.forecast`, "baseline status is unsupported.");
        return {
          forecastId: identity(candidate.forecastId, `${context}.forecast.forecastId`),
          contentId: contentId(candidate.contentId, `${context}.forecast.contentId`),
          frozenForecastId: identity(candidate.frozenForecastId, `${context}.forecast.frozenForecastId`),
          baselineStatus: "floor_only" as const,
        };
      })();
  if ((forecast === null) !== (item.runStartReceipt === null)) {
    fail(context, "forecast and run-start receipt must become available together.");
  }
  const runStartReceipt = forecast
    ? validateReceiptBindings(item.runStartReceipt, { ...base, forecast })
    : null;
  return { ...base, schema: expectedSchema, forecast, runStartReceipt } as
    | RuntimeHostStatus
    | RuntimeHostStartAcknowledgement;
}

export function pollResponse(value: unknown, expectedRuntimeId: string): RuntimeHostPollResponse {
  const context = "Runtime host event poll";
  const item = object(value, context);
  exact(item, [
    "schema",
    "commandId",
    "runtimeId",
    "lifecycle",
    "requestedCursor",
    "nextCursor",
    "journalHead",
    "events",
    "reachedHead",
    "terminal",
    "reason",
  ], context);
  if (item.schema !== "studio.local-runtime-events.v1") fail(context, "schema is unsupported.");
  const runtimeId = identity(item.runtimeId, `${context}.runtimeId`);
  if (runtimeId !== expectedRuntimeId) fail(context, "runtime identity changed.");
  const requestedCursor = integer(item.requestedCursor, `${context}.requestedCursor`);
  const nextCursor = integer(item.nextCursor, `${context}.nextCursor`);
  const journalHead = integer(item.journalHead, `${context}.journalHead`);
  if (!Array.isArray(item.events)) fail(context, "events must be an array.");
  const events = item.events.map((event, index) => {
    try {
      assertRuntimeEvent(event, `Runtime host browser event ${index + 1}`);
    } catch (error) {
      fail(context, error instanceof Error ? error.message : "an event failed validation.");
    }
    if (event.runId !== runtimeId) fail(context, "an event belongs to another runtime.");
    return event;
  });
  let previous = requestedCursor;
  for (const event of events) {
    if (event.seq !== previous + 1) fail(context, "event sequences are gapped or duplicated after the cursor.");
    previous = event.seq;
  }
  if (nextCursor !== (events.at(-1)?.seq ?? requestedCursor)) {
    fail(context, "next cursor does not match the last consumed event.");
  }
  if (nextCursor > journalHead) fail(context, "next cursor is past the journal head.");
  if (events.length === 0 && requestedCursor < journalHead) {
    fail(context, "an empty batch cannot stop before the validated journal head.");
  }
  const reachedHead = boolean(item.reachedHead, `${context}.reachedHead`);
  if (reachedHead !== (nextCursor === journalHead)) fail(context, "head state does not match the cursors.");
  const parsedLifecycle = lifecycle(item.lifecycle, `${context}.lifecycle`);
  const parsedReason = reason(item.reason, `${context}.reason`);
  const isClosedFailure = parsedLifecycle === "failed" || parsedLifecycle === "interrupted";
  if (isClosedFailure !== (parsedReason !== null)) fail(context, "closed failure reason does not match lifecycle.");
  const terminal = boolean(item.terminal, `${context}.terminal`);
  if (terminal !== ["terminal", "failed", "interrupted"].includes(parsedLifecycle)) {
    fail(context, "terminal flag does not match lifecycle.");
  }
  return {
    schema: "studio.local-runtime-events.v1",
    commandId: identity(item.commandId, `${context}.commandId`),
    runtimeId,
    lifecycle: parsedLifecycle,
    requestedCursor,
    nextCursor,
    journalHead,
    events,
    reachedHead,
    terminal,
    reason: parsedReason,
  };
}
