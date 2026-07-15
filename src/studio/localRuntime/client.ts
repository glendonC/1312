import { assertRuntimeEvent } from "../runtime/production/validation/events.ts";
import type {
  RuntimeHostFailureReason,
  RuntimeHostPollResponse,
  RuntimeHostSourceSummary,
  RuntimeHostStartAcknowledgement,
  RuntimeHostStartRequest,
  RuntimeHostStatus,
} from "../runtime/production/runtimeHost/model.ts";
import { isRuntimeHostLifecycle } from "./model.ts";

type RuntimeHostFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const FAILURE_CODES = new Set<RuntimeHostFailureReason["code"]>([
  "initialization_failed",
  "executor_failed",
  "executor_interrupted",
  "host_stopped_before_start_receipt",
  "host_stopped_before_journal",
  "host_stopped_before_executor_launch",
  "executor_launch_unconfirmed",
  "nonterminal_journal_after_restart",
  "runtime_evidence_failed",
  "stored_content_inconsistent",
]);

export class RuntimeHostClientError extends Error {
  readonly code: string;
  readonly httpStatus: number | null;

  constructor(
    message: string,
    code: string,
    httpStatus: number | null = null,
  ) {
    super(message);
    this.name = "RuntimeHostClientError";
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

function fail(context: string, message: string): never {
  throw new RuntimeHostClientError(`${context}: ${message}`, "invalid_host_response");
}

function object(value: unknown, context: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail(context, "expected an object response.");
  }
  return value as Record<string, unknown>;
}

function exact(
  value: Record<string, unknown>,
  required: readonly string[],
  context: string,
): void {
  const expected = new Set(required);
  for (const key of Object.keys(value)) {
    if (!expected.has(key)) fail(context, `field ${key} is not allowed.`);
  }
  for (const key of required) {
    if (!(key in value)) fail(context, `field ${key} is required.`);
  }
}

function string(value: unknown, context: string): string {
  if (typeof value !== "string" || value.length === 0 || value.trim() !== value) {
    fail(context, "expected a non-empty trimmed string.");
  }
  return value;
}

function identity(value: unknown, context: string): string {
  const result = string(value, context);
  if (result.length > 160 || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(result)) {
    fail(context, "expected a stable identity without path characters.");
  }
  return result;
}

function contentId(value: unknown, context: string): string {
  const result = string(value, context);
  if (!/^sha256:[a-f0-9]{64}$/.test(result)) fail(context, "expected a SHA-256 content identity.");
  return result;
}

function integer(value: unknown, context: string, minimum = 0): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) {
    fail(context, `expected a safe integer of at least ${minimum}.`);
  }
  return value as number;
}

function boolean(value: unknown, context: string): boolean {
  if (typeof value !== "boolean") fail(context, "expected a boolean.");
  return value;
}

function timestamp(value: unknown, context: string): string {
  const result = string(value, context);
  const parsed = new Date(result);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== result) {
    fail(context, "expected an exact ISO timestamp.");
  }
  return result;
}

function reason(value: unknown, context: string): RuntimeHostFailureReason | null {
  if (value === null) return null;
  const item = object(value, context);
  exact(item, ["code", "message"], context);
  if (!FAILURE_CODES.has(item.code as RuntimeHostFailureReason["code"])) {
    fail(`${context}.code`, "has an unsupported closed reason.");
  }
  const message = string(item.message, `${context}.message`);
  if (message.length > 256) fail(`${context}.message`, "is too long.");
  return { code: item.code as RuntimeHostFailureReason["code"], message };
}

function lifecycle(value: unknown, context: string): RuntimeHostStatus["lifecycle"] {
  if (!isRuntimeHostLifecycle(value)) fail(context, "has an unsupported lifecycle.");
  return value;
}

function sourceSummary(value: unknown, index: number): RuntimeHostSourceSummary {
  const context = `Runtime host source ${index + 1}`;
  const item = object(value, context);
  exact(item, [
    "sourceSessionId",
    "sourceRevisionId",
    "sourceContentId",
    "durationMs",
    "preflightSchema",
    "detectedLanguageEvidenceAvailable",
  ], context);
  if (![
    "studio.preflight-bundle.v1",
    "studio.preflight-bundle.v2",
    "studio.preflight-bundle.v3",
  ].includes(item.preflightSchema as string)) {
    fail(`${context}.preflightSchema`, "is unsupported.");
  }
  return {
    sourceSessionId: identity(item.sourceSessionId, `${context}.sourceSessionId`),
    sourceRevisionId: identity(item.sourceRevisionId, `${context}.sourceRevisionId`),
    sourceContentId: contentId(item.sourceContentId, `${context}.sourceContentId`),
    durationMs: integer(item.durationMs, `${context}.durationMs`, 1),
    preflightSchema: item.preflightSchema as RuntimeHostSourceSummary["preflightSchema"],
    detectedLanguageEvidenceAvailable: boolean(
      item.detectedLanguageEvidenceAvailable,
      `${context}.detectedLanguageEvidenceAvailable`,
    ),
  };
}

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

function statusResponse(
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

function pollResponse(value: unknown, expectedRuntimeId: string): RuntimeHostPollResponse {
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

export function normalizeLocalRuntimeHostBaseUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new RuntimeHostClientError("Local runtime host URL must be a valid absolute URL.", "invalid_base_url");
  }
  const loopback = url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "[::1]";
  if (
    url.protocol !== "http:" ||
    !loopback ||
    url.username ||
    url.password ||
    (url.pathname !== "/" && url.pathname !== "") ||
    url.search ||
    url.hash
  ) {
    throw new RuntimeHostClientError(
      "Local runtime host URL must be an exact loopback HTTP origin with no path, query, or credentials.",
      "invalid_base_url",
    );
  }
  return url.origin;
}

export class LocalRuntimeHostClient {
  readonly baseUrl: string;
  private readonly token: string;
  private readonly fetcher: RuntimeHostFetch;

  constructor(options: { baseUrl: string; token: string; fetch?: RuntimeHostFetch }) {
    this.baseUrl = normalizeLocalRuntimeHostBaseUrl(options.baseUrl);
    if (!options.token || options.token.trim() !== options.token) {
      throw new RuntimeHostClientError("Paste the exact runtime-host token without surrounding spaces.", "invalid_token");
    }
    this.token = options.token;
    // Window.fetch is receiver-sensitive in browsers; keep the call as a global function rather
    // than storing it and later invoking it with this client as its receiver.
    this.fetcher = options.fetch ?? ((input, init) => fetch(input, init));
  }

  private async request(path: string, init: RequestInit = {}): Promise<unknown> {
    let response: Response;
    try {
      response = await this.fetcher(`${this.baseUrl}${path}`, {
        ...init,
        cache: "no-store",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${this.token}`,
          ...init.headers,
        },
      });
    } catch (error) {
      throw new RuntimeHostClientError(
        "Could not reach the local runtime host. Confirm it is running and the Studio origin is allowed.",
        "host_unreachable",
        null,
      );
    }
    let value: unknown;
    try {
      value = await response.json();
    } catch {
      throw new RuntimeHostClientError("The local runtime host returned invalid JSON.", "invalid_host_response", response.status);
    }
    if (!response.ok) {
      const envelope = object(value, "Runtime host error");
      const error = object(envelope.error, "Runtime host error detail");
      throw new RuntimeHostClientError(
        string(error.message, "Runtime host error message"),
        string(error.code, "Runtime host error code"),
        response.status,
      );
    }
    return value;
  }

  async listSourceSessions(): Promise<RuntimeHostSourceSummary[]> {
    const value = object(await this.request("/v1/source-sessions"), "Runtime host source list");
    exact(value, ["schema", "sourceSessions"], "Runtime host source list");
    if (value.schema !== "studio.local-source-session-list.v1") {
      fail("Runtime host source list", "schema is unsupported.");
    }
    if (!Array.isArray(value.sourceSessions)) fail("Runtime host source list", "sourceSessions must be an array.");
    return value.sourceSessions.map(sourceSummary);
  }

  async start(request: RuntimeHostStartRequest): Promise<RuntimeHostStartAcknowledgement> {
    const acknowledgement = statusResponse(
      await this.request("/v1/runtime-starts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
      }),
      "studio.local-runtime-start-ack.v1",
    ) as RuntimeHostStartAcknowledgement;
    if (
      acknowledgement.sourceSessionId !== request.sourceSessionId ||
      acknowledgement.sourceRevisionId !== request.sourceRevisionId
    ) {
      fail("Runtime host start acknowledgement", "source identities do not match the submitted request.");
    }
    return acknowledgement;
  }

  async status(runtimeId: string): Promise<RuntimeHostStatus> {
    return statusResponse(
      await this.request(`/v1/runtimes/${encodeURIComponent(runtimeId)}`),
      "studio.local-runtime-status.v1",
    ) as RuntimeHostStatus;
  }

  async poll(runtimeId: string, after: number, limit = 100): Promise<RuntimeHostPollResponse> {
    if (!Number.isSafeInteger(after) || after < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 200) {
      throw new RuntimeHostClientError("Local runtime poll cursor or limit is invalid.", "invalid_cursor");
    }
    const value = await this.request(
      `/v1/runtimes/${encodeURIComponent(runtimeId)}/events?after=${after}&limit=${limit}`,
    );
    const parsed = pollResponse(value, runtimeId);
    if (parsed.requestedCursor !== after) {
      fail("Runtime host event poll", "the host did not honor the requested cursor.");
    }
    return parsed;
  }
}
