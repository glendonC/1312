import { assertRuntimeEvent } from "../runtime/production/validation/events.ts";
import { validateCaptionProductionArtifact } from "../runtime/production/validation/captionProduction.ts";
import { canonicalJsonLine, identifyUtf8 } from "../runtime/production/observability/hash.ts";
import type {
  OwnedMediaIngestRequest,
  OwnedMediaIngestStatus,
  RuntimeHostAssessmentAuditResponse,
  RuntimeHostCaptionProductionRequest,
  RuntimeHostCaptionProductionResultsResponse,
  RuntimeHostCaptionProductionResponse,
  RuntimeHostCaptionQualityControlResponse,
  RuntimeHostCaptionQualityControlRequest,
  RuntimeHostDecisionReceiptResponse,
  RuntimeHostFailureReason,
  RuntimeHostPlanResponse,
  RuntimeHostPollResponse,
  RuntimeHostPublishReviewDecisionRequest,
  RuntimeHostPublishReviewDecisionResponse,
  RuntimeHostPublishReviewIntakeResponse,
  RuntimeHostPublishReviewRevocationRequest,
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

function ingestStatus(value: unknown): OwnedMediaIngestStatus {
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

function unavailableCost(value: unknown, context: string): void {
  const item = object(value, context);
  exact(item, ["amount", "currency"], context);
  if (item.amount !== null || item.currency !== null) {
    fail(context, "amount and currency must remain unavailable.");
  }
}

function forecastArtifact(value: unknown): RuntimeHostPlanResponse["forecast"] {
  const context = "Runtime host plan forecast";
  const item = object(value, context);
  exact(item, [
    "schema",
    "forecastId",
    "content",
    "estimator",
    "inputs",
    "scenarios",
    "assumptions",
    "uncertainty",
    "calibration",
    "pricing",
  ], context);
  if (item.schema !== "studio.forecast.v1") fail(context, "schema is unsupported.");
  identity(item.forecastId, `${context}.forecastId`);

  const content = object(item.content, `${context}.content`);
  exact(content, ["algorithm", "digest", "contentId", "bytes"], `${context}.content`);
  if (content.algorithm !== "sha256" || typeof content.digest !== "string" || !/^[a-f0-9]{64}$/.test(content.digest)) {
    fail(`${context}.content`, "must use a lowercase SHA-256 digest.");
  }
  const parsedContentId = contentId(content.contentId, `${context}.content.contentId`);
  if (parsedContentId !== `sha256:${content.digest}`) fail(`${context}.content`, "digest and content id differ.");
  integer(content.bytes, `${context}.content.bytes`, 1);

  const estimator = object(item.estimator, `${context}.estimator`);
  exact(estimator, ["id", "version"], `${context}.estimator`);
  if (estimator.id !== "studio.forecast.deterministic-floor" || estimator.version !== "1") {
    fail(`${context}.estimator`, "is unsupported.");
  }

  const inputs = object(item.inputs, `${context}.inputs`);
  exact(inputs, ["artifact", "selectedRange", "workPlan"], `${context}.inputs`);
  const artifact = object(inputs.artifact, `${context}.inputs.artifact`);
  exact(
    artifact,
    ["artifactId", "contentId", "measuredDurationMs", "durationMeasurement"],
    `${context}.inputs.artifact`,
  );
  identity(artifact.artifactId, `${context}.inputs.artifact.artifactId`);
  contentId(artifact.contentId, `${context}.inputs.artifact.contentId`);
  const measuredDurationMs = integer(
    artifact.measuredDurationMs,
    `${context}.inputs.artifact.measuredDurationMs`,
    1,
  );
  const measurement = object(
    artifact.durationMeasurement,
    `${context}.inputs.artifact.durationMeasurement`,
  );
  exact(
    measurement,
    ["schema", "producer", "receiptContentId"],
    `${context}.inputs.artifact.durationMeasurement`,
  );
  if (measurement.schema !== "studio.media-probe.v1" || measurement.producer !== "scripts/probe-media.mjs") {
    fail(`${context}.inputs.artifact.durationMeasurement`, "producer is unsupported.");
  }
  contentId(measurement.receiptContentId, `${context}.inputs.artifact.durationMeasurement.receiptContentId`);

  const selected = object(inputs.selectedRange, `${context}.inputs.selectedRange`);
  exact(selected, ["startMs", "endMs", "durationMs"], `${context}.inputs.selectedRange`);
  const selectedStart = integer(selected.startMs, `${context}.inputs.selectedRange.startMs`);
  const selectedEnd = integer(selected.endMs, `${context}.inputs.selectedRange.endMs`, 1);
  const selectedDuration = integer(selected.durationMs, `${context}.inputs.selectedRange.durationMs`, 1);
  if (selectedEnd <= selectedStart || selectedEnd > measuredDurationMs || selectedEnd - selectedStart !== selectedDuration) {
    fail(`${context}.inputs.selectedRange`, "does not match the measured duration envelope.");
  }

  const workPlan = object(inputs.workPlan, `${context}.inputs.workPlan`);
  exact(workPlan, ["schema", "planId", "operations"], `${context}.inputs.workPlan`);
  if (workPlan.schema !== "studio.forecast.work-plan.v1") fail(`${context}.inputs.workPlan`, "schema is unsupported.");
  identity(workPlan.planId, `${context}.inputs.workPlan.planId`);
  if (!Array.isArray(workPlan.operations) || workPlan.operations.length === 0) {
    fail(`${context}.inputs.workPlan.operations`, "must contain explicit operations.");
  }
  const operationIds = new Set<string>();
  const operations = workPlan.operations.map((candidate, index) => {
    const operationContext = `${context}.inputs.workPlan.operations[${index}]`;
    const operation = object(candidate, operationContext);
    exact(operation, ["operationId", "kind", "range"], operationContext);
    const operationId = identity(operation.operationId, `${operationContext}.operationId`);
    if (operationIds.has(operationId)) fail(operationContext, "operation identity is duplicated.");
    operationIds.add(operationId);
    const kind = string(operation.kind, `${operationContext}.kind`);
    const range = object(operation.range, `${operationContext}.range`);
    exact(range, ["startMs", "endMs"], `${operationContext}.range`);
    const startMs = integer(range.startMs, `${operationContext}.range.startMs`);
    const endMs = integer(range.endMs, `${operationContext}.range.endMs`, 1);
    if (endMs <= startMs || startMs < selectedStart || endMs > selectedEnd) {
      fail(`${operationContext}.range`, "must be non-empty and inside the selected range.");
    }
    return { operationId, kind, durationMs: endMs - startMs };
  });

  const scenarios = object(item.scenarios, `${context}.scenarios`);
  exact(scenarios, ["baseline", "expected", "conservative"], `${context}.scenarios`);
  const baseline = object(scenarios.baseline, `${context}.scenarios.baseline`);
  exact(
    baseline,
    ["label", "status", "workload", "elapsedDurationMs", "modelUsage", "apiCost"],
    `${context}.scenarios.baseline`,
  );
  if (baseline.label !== "baseline" || baseline.status !== "floor_only") {
    fail(`${context}.scenarios.baseline`, "must be the deterministic floor-only scenario.");
  }
  if (baseline.elapsedDurationMs !== null || baseline.modelUsage !== null) {
    fail(`${context}.scenarios.baseline`, "elapsed duration and model usage must remain unavailable.");
  }
  unavailableCost(baseline.apiCost, `${context}.scenarios.baseline.apiCost`);
  const workload = object(baseline.workload, `${context}.scenarios.baseline.workload`);
  exact(
    workload,
    ["selectedMediaDurationMs", "operationCount", "requestedOperationMediaDurationMs", "operations"],
    `${context}.scenarios.baseline.workload`,
  );
  if (
    integer(workload.selectedMediaDurationMs, `${context}.scenarios.baseline.workload.selectedMediaDurationMs`, 1) !== selectedDuration ||
    integer(workload.operationCount, `${context}.scenarios.baseline.workload.operationCount`, 1) !== operations.length
  ) {
    fail(`${context}.scenarios.baseline.workload`, "does not match the explicit work plan.");
  }
  if (!Array.isArray(workload.operations) || workload.operations.length !== operations.length) {
    fail(`${context}.scenarios.baseline.workload.operations`, "does not match the explicit work plan.");
  }
  let requestedDuration = 0;
  workload.operations.forEach((candidate, index) => {
    const operationContext = `${context}.scenarios.baseline.workload.operations[${index}]`;
    const projected = object(candidate, operationContext);
    exact(projected, ["operationId", "kind", "requestedMediaDurationMs"], operationContext);
    const planned = operations[index];
    const duration = integer(projected.requestedMediaDurationMs, `${operationContext}.requestedMediaDurationMs`, 1);
    if (
      projected.operationId !== planned.operationId ||
      projected.kind !== planned.kind ||
      duration !== planned.durationMs
    ) {
      fail(operationContext, "does not match its explicit work-plan operation.");
    }
    requestedDuration += duration;
  });
  if (
    integer(
      workload.requestedOperationMediaDurationMs,
      `${context}.scenarios.baseline.workload.requestedOperationMediaDurationMs`,
      1,
    ) !== requestedDuration
  ) {
    fail(`${context}.scenarios.baseline.workload`, "requested duration total is inconsistent.");
  }

  for (const label of ["expected", "conservative"] as const) {
    const scenarioContext = `${context}.scenarios.${label}`;
    const scenario = object(scenarios[label], scenarioContext);
    exact(
      scenario,
      ["label", "status", "workload", "elapsedDurationMs", "modelUsage", "apiCost"],
      scenarioContext,
    );
    if (
      scenario.label !== label ||
      scenario.status !== "unavailable" ||
      scenario.workload !== null ||
      scenario.elapsedDurationMs !== null ||
      scenario.modelUsage !== null
    ) {
      fail(scenarioContext, "must remain unavailable.");
    }
    unavailableCost(scenario.apiCost, `${scenarioContext}.apiCost`);
  }

  if (!Array.isArray(item.assumptions) || item.assumptions.length === 0) {
    fail(`${context}.assumptions`, "must contain producer assumptions.");
  }
  item.assumptions.forEach((candidate, index) => {
    const entryContext = `${context}.assumptions[${index}]`;
    const entry = object(candidate, entryContext);
    exact(entry, ["code", "statement"], entryContext);
    identity(entry.code, `${entryContext}.code`);
    string(entry.statement, `${entryContext}.statement`);
  });
  if (!Array.isArray(item.uncertainty) || item.uncertainty.length === 0) {
    fail(`${context}.uncertainty`, "must contain unavailable-producer reasons.");
  }
  item.uncertainty.forEach((candidate, index) => {
    const entryContext = `${context}.uncertainty[${index}]`;
    const entry = object(candidate, entryContext);
    exact(entry, ["code", "affects", "statement"], entryContext);
    identity(entry.code, `${entryContext}.code`);
    if (!Array.isArray(entry.affects) || entry.affects.length === 0) fail(entryContext, "affects must be non-empty.");
    entry.affects.forEach((affected, affectedIndex) => string(affected, `${entryContext}.affects[${affectedIndex}]`));
    string(entry.statement, `${entryContext}.statement`);
  });

  const calibration = object(item.calibration, `${context}.calibration`);
  exact(calibration, ["status", "evidence", "cohort"], `${context}.calibration`);
  if (calibration.status !== "unavailable" || calibration.evidence !== null || calibration.cohort !== null) {
    fail(`${context}.calibration`, "must remain unavailable.");
  }
  const pricing = object(item.pricing, `${context}.pricing`);
  exact(
    pricing,
    ["status", "priceBookAdapter", "priceBookSnapshot", "currency"],
    `${context}.pricing`,
  );
  if (
    pricing.status !== "unavailable" ||
    pricing.priceBookAdapter !== null ||
    pricing.priceBookSnapshot !== null ||
    pricing.currency !== null
  ) {
    fail(`${context}.pricing`, "must remain unavailable.");
  }

  return item as unknown as RuntimeHostPlanResponse["forecast"];
}

function planResponse(value: unknown): RuntimeHostPlanResponse {
  const context = "Runtime host plan";
  const item = object(value, context);
  exact(item, [
    "schema",
    "commandId",
    "runtimeId",
    "sourceSessionId",
    "sourceRevisionId",
    "analysisRequestId",
    "forecast",
    "acceptance",
  ], context);
  if (item.schema !== "studio.local-runtime-plan.v1") fail(context, "schema is unsupported.");
  const acceptance = object(item.acceptance, `${context}.acceptance`);
  exact(acceptance, ["status", "frozenForecastId"], `${context}.acceptance`);
  if (acceptance.status !== "not_started" || acceptance.frozenForecastId !== null) {
    fail(`${context}.acceptance`, "must remain explicitly unfrozen before start.");
  }
  return {
    schema: "studio.local-runtime-plan.v1",
    commandId: identity(item.commandId, `${context}.commandId`),
    runtimeId: identity(item.runtimeId, `${context}.runtimeId`),
    sourceSessionId: identity(item.sourceSessionId, `${context}.sourceSessionId`),
    sourceRevisionId: identity(item.sourceRevisionId, `${context}.sourceRevisionId`),
    analysisRequestId: identity(item.analysisRequestId, `${context}.analysisRequestId`),
    forecast: forecastArtifact(item.forecast),
    acceptance: { status: "not_started", frozenForecastId: null },
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

function assessmentAuditResponse(
  value: unknown,
  expectedRuntimeId: string,
): RuntimeHostAssessmentAuditResponse {
  const context = "Runtime host assessment audit";
  const item = object(value, context);
  exact(item, ["schema", "commandId", "runtimeId", "journalHead", "audits"], context);
  if (item.schema !== "studio.local-runtime-assessment-audits.v1") fail(context, "schema is unsupported.");
  const runtimeId = identity(item.runtimeId, `${context}.runtimeId`);
  if (runtimeId !== expectedRuntimeId) fail(context, "runtime identity changed.");
  if (!Array.isArray(item.audits)) fail(`${context}.audits`, "must be an array.");
  const operationIds = new Set<string>();
  const audits = item.audits.map((candidate, auditIndex) => {
    const auditContext = `${context}.audits[${auditIndex}]`;
    const audit = object(candidate, auditContext);
    exact(audit, [
      "operationId",
      "artifactId",
      "receiptId",
      "receiptContentId",
      "taskId",
      "agentId",
      "integrity",
      "claims",
    ], auditContext);
    const operationId = identity(audit.operationId, `${auditContext}.operationId`);
    if (operationIds.has(operationId)) fail(`${auditContext}.operationId`, "is duplicated.");
    operationIds.add(operationId);
    if (audit.integrity !== "stored_receipt_and_citations_verified") {
      fail(`${auditContext}.integrity`, "does not carry the closed audit result.");
    }
    if (!Array.isArray(audit.claims) || audit.claims.length === 0) {
      fail(`${auditContext}.claims`, "must contain audited claims.");
    }
    const claims = audit.claims.map((claimValue, claimIndex) => {
      const claimContext = `${auditContext}.claims[${claimIndex}]`;
      const claim = object(claimValue, claimContext);
      exact(claim, ["claimIndex", "kind", "value", "range", "states", "citations"], claimContext);
      if (integer(claim.claimIndex, `${claimContext}.claimIndex`) !== claimIndex) {
        fail(`${claimContext}.claimIndex`, "must match claim order.");
      }
      if (claim.kind !== "speech_activity" && claim.kind !== "language_identity") {
        fail(`${claimContext}.kind`, "is unsupported.");
      }
      if (claim.kind === "speech_activity") {
        if (claim.value !== "speech" && claim.value !== "non_speech") {
          fail(`${claimContext}.value`, "is not a closed speech-activity value.");
        }
      } else if (claim.value !== null) {
        string(claim.value, `${claimContext}.value`);
      }
      const range = object(claim.range, `${claimContext}.range`);
      exact(range, ["startMs", "endMs"], `${claimContext}.range`);
      const startMs = integer(range.startMs, `${claimContext}.range.startMs`);
      const endMs = integer(range.endMs, `${claimContext}.range.endMs`, 1);
      if (endMs <= startMs) fail(`${claimContext}.range`, "must be a non-empty half-open range.");
      if (!Array.isArray(claim.states) || claim.states.length === 0) {
        fail(`${claimContext}.states`, "must preserve at least one state.");
      }
      const states = claim.states.map((state, stateIndex) => {
        if (!["supported", "unknown", "withheld", "truncated"].includes(state as string)) {
          fail(`${claimContext}.states[${stateIndex}]`, "is unsupported.");
        }
        return state as "supported" | "unknown" | "withheld" | "truncated";
      });
      if (new Set(states).size !== states.length || (states.includes("supported") && states.length !== 1)) {
        fail(`${claimContext}.states`, "must be unique and cannot combine supported with a gap state.");
      }
      if (!Array.isArray(claim.citations) || claim.citations.length === 0) {
        fail(`${claimContext}.citations`, "must contain closed read-receipt citations.");
      }
      const citationKeys = new Set<string>();
      const citations = claim.citations.map((citationValue, citationIndex) => {
        const citationContext = `${claimContext}.citations[${citationIndex}]`;
        const citation = object(citationValue, citationContext);
        exact(citation, [
          "readOperationId",
          "receiptId",
          "receiptContentId",
          "evidenceArtifactId",
          "factIndexes",
        ], citationContext);
        const receiptId = identity(citation.receiptId, `${citationContext}.receiptId`);
        const receiptContentId = contentId(citation.receiptContentId, `${citationContext}.receiptContentId`);
        const citationKey = `${receiptId}\u0000${receiptContentId}`;
        if (citationKeys.has(citationKey)) fail(citationContext, "duplicates a read-receipt citation.");
        citationKeys.add(citationKey);
        if (!Array.isArray(citation.factIndexes) || citation.factIndexes.length === 0) {
          fail(`${citationContext}.factIndexes`, "must contain returned-fact indexes.");
        }
        const factIndexes = citation.factIndexes.map((factIndex, index) =>
          integer(factIndex, `${citationContext}.factIndexes[${index}]`));
        if (new Set(factIndexes).size !== factIndexes.length) {
          fail(`${citationContext}.factIndexes`, "must not repeat an index.");
        }
        return {
          readOperationId: identity(citation.readOperationId, `${citationContext}.readOperationId`),
          receiptId,
          receiptContentId,
          evidenceArtifactId: identity(citation.evidenceArtifactId, `${citationContext}.evidenceArtifactId`),
          factIndexes,
        };
      });
      return {
        claimIndex,
        kind: claim.kind as "speech_activity" | "language_identity",
        value: claim.value as "speech" | "non_speech" | string | null,
        range: { startMs, endMs },
        states,
        citations,
      };
    });
    return {
      operationId,
      artifactId: identity(audit.artifactId, `${auditContext}.artifactId`),
      receiptId: identity(audit.receiptId, `${auditContext}.receiptId`),
      receiptContentId: contentId(audit.receiptContentId, `${auditContext}.receiptContentId`),
      taskId: identity(audit.taskId, `${auditContext}.taskId`),
      agentId: identity(audit.agentId, `${auditContext}.agentId`),
      integrity: "stored_receipt_and_citations_verified" as const,
      claims,
    };
  });
  return {
    schema: "studio.local-runtime-assessment-audits.v1",
    commandId: identity(item.commandId, `${context}.commandId`),
    runtimeId,
    journalHead: integer(item.journalHead, `${context}.journalHead`),
    audits,
  };
}

function decisionReceiptResponse(
  value: unknown,
  expectedRuntimeId: string,
): RuntimeHostDecisionReceiptResponse {
  const context = "Runtime host decision receipts";
  const item = object(value, context);
  exact(item, ["schema", "commandId", "runtimeId", "journalHead", "decisions"], context);
  if (item.schema !== "studio.local-runtime-decision-receipts.v1") fail(context, "schema is unsupported.");
  const runtimeId = identity(item.runtimeId, `${context}.runtimeId`);
  if (runtimeId !== expectedRuntimeId) fail(context, "runtime identity changed.");
  if (!Array.isArray(item.decisions)) fail(`${context}.decisions`, "must be an array.");
  const operationIds = new Set<string>();
  const decisions = item.decisions.map((candidate, decisionIndex) => {
    const decisionContext = `${context}.decisions[${decisionIndex}]`;
    const decision = object(candidate, decisionContext);
    exact(decision, [
      "operationId",
      "artifactId",
      "receiptId",
      "receiptContentId",
      "taskId",
      "agentId",
      "integrity",
      "producer",
      "inputs",
      "outcome",
      "reasonCodes",
      "auditedAssessmentCount",
      "auditedClaimCount",
    ], decisionContext);
    const operationId = identity(decision.operationId, `${decisionContext}.operationId`);
    if (operationIds.has(operationId)) fail(`${decisionContext}.operationId`, "is duplicated.");
    operationIds.add(operationId);
    if (decision.integrity !== "stored_decision_and_audited_inputs_verified") {
      fail(`${decisionContext}.integrity`, "does not carry the closed decision verification result.");
    }
    if (decision.producer !== "deterministic_audit_state_gate_v1") {
      fail(`${decisionContext}.producer`, "is unsupported.");
    }
    if (!Array.isArray(decision.inputs) || decision.inputs.length === 0 || decision.inputs.length > 4) {
      fail(`${decisionContext}.inputs`, "must contain bounded audited assessment identities.");
    }
    const inputOperations = new Set<string>();
    const inputs = decision.inputs.map((candidateInput, inputIndex) => {
      const inputContext = `${decisionContext}.inputs[${inputIndex}]`;
      const input = object(candidateInput, inputContext);
      exact(input, ["operationId", "artifactId", "receiptId", "receiptContentId"], inputContext);
      const inputOperationId = identity(input.operationId, `${inputContext}.operationId`);
      if (inputOperations.has(inputOperationId)) fail(`${inputContext}.operationId`, "is duplicated.");
      inputOperations.add(inputOperationId);
      return {
        operationId: inputOperationId,
        artifactId: identity(input.artifactId, `${inputContext}.artifactId`),
        receiptId: identity(input.receiptId, `${inputContext}.receiptId`),
        receiptContentId: contentId(input.receiptContentId, `${inputContext}.receiptContentId`),
      };
    });
    const outcome = decision.outcome;
    if (outcome !== "withheld" && outcome !== "proceed_to_publish_review") {
      fail(`${decisionContext}.outcome`, "is unsupported.");
    }
    if (!Array.isArray(decision.reasonCodes) || decision.reasonCodes.length === 0) {
      fail(`${decisionContext}.reasonCodes`, "must contain closed reason codes.");
    }
    const reasonOrder = [
      "audited_claim_withheld",
      "audited_claim_unknown",
      "audited_claim_truncated",
      "all_audited_claims_supported",
    ] as const;
    const reasonCodes = decision.reasonCodes.map((reason, reasonIndex) => {
      if (!reasonOrder.includes(reason as (typeof reasonOrder)[number])) {
        fail(`${decisionContext}.reasonCodes[${reasonIndex}]`, "is unsupported.");
      }
      return reason as (typeof reasonOrder)[number];
    });
    if (
      new Set(reasonCodes).size !== reasonCodes.length ||
      JSON.stringify(reasonCodes) !== JSON.stringify(reasonOrder.filter((reason) => reasonCodes.includes(reason))) ||
      (outcome === "proceed_to_publish_review" &&
        (reasonCodes.length !== 1 || reasonCodes[0] !== "all_audited_claims_supported")) ||
      (outcome === "withheld" && reasonCodes.includes("all_audited_claims_supported"))
    ) fail(`${decisionContext}.reasonCodes`, "do not agree with the outcome or canonical order.");
    const auditedAssessmentCount = integer(
      decision.auditedAssessmentCount,
      `${decisionContext}.auditedAssessmentCount`,
      1,
    );
    if (auditedAssessmentCount !== inputs.length) {
      fail(`${decisionContext}.auditedAssessmentCount`, "must equal the input count.");
    }
    return {
      operationId,
      artifactId: identity(decision.artifactId, `${decisionContext}.artifactId`),
      receiptId: identity(decision.receiptId, `${decisionContext}.receiptId`),
      receiptContentId: contentId(decision.receiptContentId, `${decisionContext}.receiptContentId`),
      taskId: identity(decision.taskId, `${decisionContext}.taskId`),
      agentId: identity(decision.agentId, `${decisionContext}.agentId`),
      integrity: "stored_decision_and_audited_inputs_verified" as const,
      producer: "deterministic_audit_state_gate_v1" as const,
      inputs,
      outcome: outcome as "withheld" | "proceed_to_publish_review",
      reasonCodes,
      auditedAssessmentCount,
      auditedClaimCount: integer(decision.auditedClaimCount, `${decisionContext}.auditedClaimCount`, 1),
    };
  });
  return {
    schema: "studio.local-runtime-decision-receipts.v1",
    commandId: identity(item.commandId, `${context}.commandId`),
    runtimeId,
    journalHead: integer(item.journalHead, `${context}.journalHead`),
    decisions,
  };
}

function publishReviewIntakeResponse(
  value: unknown,
  expectedRuntimeId: string,
): RuntimeHostPublishReviewIntakeResponse {
  const context = "Runtime host publish-review intakes";
  const item = object(value, context);
  exact(item, ["schema", "commandId", "runtimeId", "journalHead", "intakes"], context);
  if (item.schema !== "studio.local-runtime-publish-review-intakes.v1") fail(context, "schema is unsupported.");
  const runtimeId = identity(item.runtimeId, `${context}.runtimeId`);
  if (runtimeId !== expectedRuntimeId) fail(context, "runtime identity changed.");
  if (!Array.isArray(item.intakes)) fail(`${context}.intakes`, "must be an array.");
  const intakeIds = new Set<string>();
  const decisionOperationIds = new Set<string>();
  const intakes = item.intakes.map((candidate, intakeIndex) => {
    const intakeContext = `${context}.intakes[${intakeIndex}]`;
    const intake = object(candidate, intakeContext);
    exact(intake, [
      "intakeId",
      "artifactId",
      "receiptId",
      "receiptContentId",
      "integrity",
      "producer",
      "decision",
      "outcome",
      "reasonCodes",
    ], intakeContext);
    const intakeId = identity(intake.intakeId, `${intakeContext}.intakeId`);
    if (intakeIds.has(intakeId)) fail(`${intakeContext}.intakeId`, "is duplicated.");
    intakeIds.add(intakeId);
    if (intake.integrity !== "stored_intake_and_verified_decision_receipt") {
      fail(`${intakeContext}.integrity`, "does not carry the closed intake verification result.");
    }
    if (intake.producer !== "host_publish_review_intake_v1") {
      fail(`${intakeContext}.producer`, "is unsupported.");
    }
    const decision = object(intake.decision, `${intakeContext}.decision`);
    exact(decision, ["operationId", "artifactId", "receiptId", "receiptContentId"], `${intakeContext}.decision`);
    const decisionOperationId = identity(decision.operationId, `${intakeContext}.decision.operationId`);
    if (decisionOperationIds.has(decisionOperationId)) {
      fail(`${intakeContext}.decision.operationId`, "already has an intake.");
    }
    decisionOperationIds.add(decisionOperationId);
    const outcome = intake.outcome;
    if (outcome !== "queued" && outcome !== "rejected") fail(`${intakeContext}.outcome`, "is unsupported.");
    if (!Array.isArray(intake.reasonCodes) || intake.reasonCodes.length === 0) {
      fail(`${intakeContext}.reasonCodes`, "must contain closed decision reason codes.");
    }
    const reasonOrder = [
      "audited_claim_withheld",
      "audited_claim_unknown",
      "audited_claim_truncated",
      "all_audited_claims_supported",
    ] as const;
    const reasonCodes = intake.reasonCodes.map((reason, reasonIndex) => {
      if (!reasonOrder.includes(reason as (typeof reasonOrder)[number])) {
        fail(`${intakeContext}.reasonCodes[${reasonIndex}]`, "is unsupported.");
      }
      return reason as (typeof reasonOrder)[number];
    });
    if (
      new Set(reasonCodes).size !== reasonCodes.length ||
      JSON.stringify(reasonCodes) !== JSON.stringify(reasonOrder.filter((reason) => reasonCodes.includes(reason))) ||
      (outcome === "queued" && (reasonCodes.length !== 1 || reasonCodes[0] !== "all_audited_claims_supported")) ||
      (outcome === "rejected" && reasonCodes.includes("all_audited_claims_supported"))
    ) fail(`${intakeContext}.reasonCodes`, "do not agree with the closed intake outcome.");
    return {
      intakeId,
      artifactId: identity(intake.artifactId, `${intakeContext}.artifactId`),
      receiptId: identity(intake.receiptId, `${intakeContext}.receiptId`),
      receiptContentId: contentId(intake.receiptContentId, `${intakeContext}.receiptContentId`),
      integrity: "stored_intake_and_verified_decision_receipt" as const,
      producer: "host_publish_review_intake_v1" as const,
      decision: {
        operationId: decisionOperationId,
        artifactId: identity(decision.artifactId, `${intakeContext}.decision.artifactId`),
        receiptId: identity(decision.receiptId, `${intakeContext}.decision.receiptId`),
        receiptContentId: contentId(decision.receiptContentId, `${intakeContext}.decision.receiptContentId`),
      },
      outcome: outcome as "queued" | "rejected",
      reasonCodes,
    };
  });
  return {
    schema: "studio.local-runtime-publish-review-intakes.v1",
    commandId: identity(item.commandId, `${context}.commandId`),
    runtimeId,
    journalHead: integer(item.journalHead, `${context}.journalHead`),
    intakes,
  };
}

const REVIEW_DECISION_ATTESTATION =
  "I attest that I am the named reviewer and made this review decision." as const;
const REVIEW_REVOCATION_ATTESTATION =
  "I attest that I am the named reviewer and made this revocation decision." as const;
const REVIEW_REASON_ORDER = [
  "reviewer_attested_caption_production_may_proceed",
  "evidence_requires_additional_review",
  "source_scope_not_approved",
  "rights_or_policy_concern",
  "other_review_concern",
] as const;
const REVOCATION_REASON_ORDER = [
  "approval_entered_in_error",
  "new_review_required",
  "source_scope_changed",
  "rights_or_policy_concern",
] as const;

function reviewNote(value: unknown, context: string): string | null {
  if (value === null) return null;
  const note = string(value, context);
  if (note.length > 280 || note.trim() !== note || /[\r\n\u0000-\u001f\u007f]/.test(note)) {
    fail(context, "must be a trimmed single-line note of at most 280 characters.");
  }
  return note;
}

function publishReviewDecisionResponse(
  value: unknown,
  expectedRuntimeId: string,
): RuntimeHostPublishReviewDecisionResponse {
  const context = "Runtime host publish-review decisions";
  const item = object(value, context);
  exact(item, ["schema", "commandId", "runtimeId", "journalHead", "reviewer", "reviews"], context);
  if (item.schema !== "studio.local-runtime-publish-review-decisions.v1") fail(context, "schema is unsupported.");
  const runtimeId = identity(item.runtimeId, `${context}.runtimeId`);
  if (runtimeId !== expectedRuntimeId) fail(context, "runtime identity changed.");
  const reviewerValue = object(item.reviewer, `${context}.reviewer`);
  exact(reviewerValue, ["id", "label", "decisionAttestation", "revocationAttestation"], `${context}.reviewer`);
  if (reviewerValue.decisionAttestation !== REVIEW_DECISION_ATTESTATION) {
    fail(`${context}.reviewer.decisionAttestation`, "is unsupported.");
  }
  if (reviewerValue.revocationAttestation !== REVIEW_REVOCATION_ATTESTATION) {
    fail(`${context}.reviewer.revocationAttestation`, "is unsupported.");
  }
  const reviewer = {
    id: identity(reviewerValue.id, `${context}.reviewer.id`),
    label: string(reviewerValue.label, `${context}.reviewer.label`),
    decisionAttestation: REVIEW_DECISION_ATTESTATION,
    revocationAttestation: REVIEW_REVOCATION_ATTESTATION,
  };
  if (reviewer.label.length > 80 || reviewer.label.trim() !== reviewer.label || /[\r\n\u0000-\u001f\u007f]/.test(reviewer.label)) {
    fail(`${context}.reviewer.label`, "must be a bounded single-line host label.");
  }
  if (!Array.isArray(item.reviews)) fail(`${context}.reviews`, "must be an array.");
  const reviewIds = new Set<string>();
  const intakeIds = new Set<string>();
  const reviews = item.reviews.map((candidate, reviewIndex) => {
    const reviewContext = `${context}.reviews[${reviewIndex}]`;
    const review = object(candidate, reviewContext);
    exact(review, [
      "reviewId",
      "artifactId",
      "receiptId",
      "receiptContentId",
      "integrity",
      "producer",
      "intake",
      "reviewer",
      "outcome",
      "reasonCodes",
      "note",
      "state",
      "revocation",
    ], reviewContext);
    const reviewId = identity(review.reviewId, `${reviewContext}.reviewId`);
    if (reviewIds.has(reviewId)) fail(`${reviewContext}.reviewId`, "is duplicated.");
    reviewIds.add(reviewId);
    if (review.integrity !== "stored_review_and_verified_queued_intake") {
      fail(`${reviewContext}.integrity`, "does not carry closed review verification.");
    }
    if (review.producer !== "host_publish_review_v1") fail(`${reviewContext}.producer`, "is unsupported.");
    const intakeValue = object(review.intake, `${reviewContext}.intake`);
    exact(intakeValue, ["intakeId", "artifactId", "receiptId", "receiptContentId"], `${reviewContext}.intake`);
    const intakeId = identity(intakeValue.intakeId, `${reviewContext}.intake.intakeId`);
    if (intakeIds.has(intakeId)) fail(`${reviewContext}.intake.intakeId`, "already has a review.");
    intakeIds.add(intakeId);
    const reviewReviewer = object(review.reviewer, `${reviewContext}.reviewer`);
    exact(reviewReviewer, ["id", "label", "attestation"], `${reviewContext}.reviewer`);
    if (
      identity(reviewReviewer.id, `${reviewContext}.reviewer.id`) !== reviewer.id ||
      string(reviewReviewer.label, `${reviewContext}.reviewer.label`) !== reviewer.label ||
      reviewReviewer.attestation !== reviewer.decisionAttestation
    ) fail(`${reviewContext}.reviewer`, "does not match the host review authority and attestation.");
    const outcome = review.outcome;
    if (outcome !== "approve_for_caption_production" && outcome !== "reject_with_reasons") {
      fail(`${reviewContext}.outcome`, "is unsupported.");
    }
    if (!Array.isArray(review.reasonCodes) || review.reasonCodes.length === 0) {
      fail(`${reviewContext}.reasonCodes`, "must contain closed review reasons.");
    }
    const reasonCodes = review.reasonCodes.map((reason, reasonIndex) => {
      if (!REVIEW_REASON_ORDER.includes(reason as (typeof REVIEW_REASON_ORDER)[number])) {
        fail(`${reviewContext}.reasonCodes[${reasonIndex}]`, "is unsupported.");
      }
      return reason as (typeof REVIEW_REASON_ORDER)[number];
    });
    if (
      new Set(reasonCodes).size !== reasonCodes.length ||
      JSON.stringify(reasonCodes) !== JSON.stringify(REVIEW_REASON_ORDER.filter((reason) => reasonCodes.includes(reason))) ||
      (outcome === "approve_for_caption_production" &&
        (reasonCodes.length !== 1 || reasonCodes[0] !== "reviewer_attested_caption_production_may_proceed")) ||
      (outcome === "reject_with_reasons" && reasonCodes.includes("reviewer_attested_caption_production_may_proceed"))
    ) fail(`${reviewContext}.reasonCodes`, "do not agree with the closed review outcome.");

    let revocation = null;
    if (review.revocation !== null) {
      const revocationContext = `${reviewContext}.revocation`;
      const candidateRevocation = object(review.revocation, revocationContext);
      exact(candidateRevocation, [
        "revocationId",
        "artifactId",
        "receiptId",
        "receiptContentId",
        "integrity",
        "producer",
        "reviewer",
        "reasonCodes",
        "note",
      ], revocationContext);
      if (candidateRevocation.integrity !== "stored_revocation_and_verified_approval") {
        fail(`${revocationContext}.integrity`, "does not carry closed revocation verification.");
      }
      if (candidateRevocation.producer !== "host_publish_review_v1") {
        fail(`${revocationContext}.producer`, "is unsupported.");
      }
      const revocationReviewer = object(candidateRevocation.reviewer, `${revocationContext}.reviewer`);
      exact(revocationReviewer, ["id", "label", "attestation"], `${revocationContext}.reviewer`);
      if (
        identity(revocationReviewer.id, `${revocationContext}.reviewer.id`) !== reviewer.id ||
        string(revocationReviewer.label, `${revocationContext}.reviewer.label`) !== reviewer.label ||
        revocationReviewer.attestation !== reviewer.revocationAttestation
      ) fail(`${revocationContext}.reviewer`, "does not match the host review authority and attestation.");
      if (!Array.isArray(candidateRevocation.reasonCodes) || candidateRevocation.reasonCodes.length === 0) {
        fail(`${revocationContext}.reasonCodes`, "must contain closed revocation reasons.");
      }
      const revocationReasons = candidateRevocation.reasonCodes.map((reason, reasonIndex) => {
        if (!REVOCATION_REASON_ORDER.includes(reason as (typeof REVOCATION_REASON_ORDER)[number])) {
          fail(`${revocationContext}.reasonCodes[${reasonIndex}]`, "is unsupported.");
        }
        return reason as (typeof REVOCATION_REASON_ORDER)[number];
      });
      if (
        new Set(revocationReasons).size !== revocationReasons.length ||
        JSON.stringify(revocationReasons) !== JSON.stringify(
          REVOCATION_REASON_ORDER.filter((reason) => revocationReasons.includes(reason)),
        )
      ) fail(`${revocationContext}.reasonCodes`, "are not canonical.");
      revocation = {
        revocationId: identity(candidateRevocation.revocationId, `${revocationContext}.revocationId`),
        artifactId: identity(candidateRevocation.artifactId, `${revocationContext}.artifactId`),
        receiptId: identity(candidateRevocation.receiptId, `${revocationContext}.receiptId`),
        receiptContentId: contentId(candidateRevocation.receiptContentId, `${revocationContext}.receiptContentId`),
        integrity: "stored_revocation_and_verified_approval" as const,
        producer: "host_publish_review_v1" as const,
        reviewer: {
          id: reviewer.id,
          label: reviewer.label,
          attestation: reviewer.revocationAttestation,
        },
        reasonCodes: revocationReasons,
        note: reviewNote(candidateRevocation.note, `${revocationContext}.note`),
      };
    }
    const expectedState = outcome === "reject_with_reasons"
      ? "rejected"
      : revocation
        ? "approval_revoked"
        : "approved_for_caption_production";
    if (review.state !== expectedState || (revocation !== null && outcome !== "approve_for_caption_production")) {
      fail(`${reviewContext}.state`, "does not match the decision and immutable revocation state.");
    }
    return {
      reviewId,
      artifactId: identity(review.artifactId, `${reviewContext}.artifactId`),
      receiptId: identity(review.receiptId, `${reviewContext}.receiptId`),
      receiptContentId: contentId(review.receiptContentId, `${reviewContext}.receiptContentId`),
      integrity: "stored_review_and_verified_queued_intake" as const,
      producer: "host_publish_review_v1" as const,
      intake: {
        intakeId,
        artifactId: identity(intakeValue.artifactId, `${reviewContext}.intake.artifactId`),
        receiptId: identity(intakeValue.receiptId, `${reviewContext}.intake.receiptId`),
        receiptContentId: contentId(intakeValue.receiptContentId, `${reviewContext}.intake.receiptContentId`),
      },
      reviewer: {
        id: reviewer.id,
        label: reviewer.label,
        attestation: reviewer.decisionAttestation,
      },
      outcome: outcome as "approve_for_caption_production" | "reject_with_reasons",
      reasonCodes,
      note: reviewNote(review.note, `${reviewContext}.note`),
      state: expectedState as "rejected" | "approval_revoked" | "approved_for_caption_production",
      revocation,
    };
  });
  return {
    schema: "studio.local-runtime-publish-review-decisions.v1",
    commandId: identity(item.commandId, `${context}.commandId`),
    runtimeId,
    journalHead: integer(item.journalHead, `${context}.journalHead`),
    reviewer,
    reviews,
  };
}

function captionProductionResponse(
  value: unknown,
  expectedRuntimeId: string,
): RuntimeHostCaptionProductionResponse {
  const context = "Runtime host caption productions";
  const item = object(value, context);
  exact(item, ["schema", "commandId", "runtimeId", "journalHead", "captions"], context);
  if (item.schema !== "studio.local-runtime-caption-productions.v1") fail(context, "schema is unsupported.");
  const runtimeId = identity(item.runtimeId, `${context}.runtimeId`);
  if (runtimeId !== expectedRuntimeId) fail(context, "runtime identity changed.");
  if (!Array.isArray(item.captions)) fail(`${context}.captions`, "must be an array.");
  const jobIds = new Set<string>();
  const approvals = new Set<string>();
  const captions = item.captions.map((candidate, index) => {
    const captionContext = `${context}.captions[${index}]`;
    const caption = object(candidate, captionContext);
    exact(caption, [
      "jobId",
      "approval",
      "authorityState",
      "integrity",
      "captionArtifactId",
      "captionContentId",
      "receiptArtifactId",
      "receiptId",
      "receiptContentId",
      "executor",
      "result",
    ], captionContext);
    const jobId = identity(caption.jobId, `${captionContext}.jobId`);
    if (jobIds.has(jobId)) fail(`${captionContext}.jobId`, "is duplicated.");
    jobIds.add(jobId);
    const approval = object(caption.approval, `${captionContext}.approval`);
    exact(approval, ["reviewId", "artifactId", "receiptId", "receiptContentId"], `${captionContext}.approval`);
    const approvalValue = {
      reviewId: identity(approval.reviewId, `${captionContext}.approval.reviewId`),
      artifactId: identity(approval.artifactId, `${captionContext}.approval.artifactId`),
      receiptId: identity(approval.receiptId, `${captionContext}.approval.receiptId`),
      receiptContentId: contentId(approval.receiptContentId, `${captionContext}.approval.receiptContentId`),
    };
    if (approvals.has(approvalValue.reviewId)) fail(`${captionContext}.approval.reviewId`, "already has captions.");
    approvals.add(approvalValue.reviewId);
    if (caption.authorityState !== "unrevoked" && caption.authorityState !== "revoked_after_completion") {
      fail(`${captionContext}.authorityState`, "is unsupported.");
    }
    if (caption.integrity !== "stored_caption_and_receipt_with_verified_approval") {
      fail(`${captionContext}.integrity`, "does not carry closed caption verification.");
    }
    const executor = object(caption.executor, `${captionContext}.executor`);
    exact(executor, ["id", "version", "classification", "executionScope", "cognitionClaim", "recognizer", "translator", "sourceCaptionContentId"], `${captionContext}.executor`);
    if (executor.version !== "1") fail(`${captionContext}.executor.version`, "is unsupported.");
    if (
      (executor.classification === "recorded_real_pipeline_fixture" && executor.id !== "studio.recorded-caption-fixture-adapter") ||
      (executor.classification === "real_recognizer_translator" && executor.id !== "studio.openai-caption-producer") ||
      (executor.classification !== "recorded_real_pipeline_fixture" && executor.classification !== "real_recognizer_translator") ||
      (executor.classification === "recorded_real_pipeline_fixture" && executor.executionScope !== "test_demo_only") ||
      (executor.classification === "real_recognizer_translator" && executor.executionScope !== "current_run") ||
      executor.cognitionClaim !== "none"
    ) fail(`${captionContext}.executor`, "identity and classification do not agree.");
    const recognizer = executor.recognizer === null ? null : string(executor.recognizer, `${captionContext}.executor.recognizer`);
    const translator = executor.translator === null ? null : string(executor.translator, `${captionContext}.executor.translator`);
    const sourceCaptionContentId = executor.sourceCaptionContentId === null
      ? null
      : contentId(executor.sourceCaptionContentId, `${captionContext}.executor.sourceCaptionContentId`);
    if (
      recognizer === null || translator === null ||
      (executor.classification === "real_recognizer_translator" && sourceCaptionContentId !== null)
    ) {
      fail(`${captionContext}.executor`, "real execution evidence is inconsistent.");
    }
    const result = object(caption.result, `${captionContext}.result`);
    exact(result, ["status", "lineCount", "sourceAvailableCount", "targetAvailableCount", "withheldCount", "unavailableCount"], `${captionContext}.result`);
    if (!["completed", "partial", "withheld", "unavailable"].includes(result.status as string)) {
      fail(`${captionContext}.result.status`, "is unsupported.");
    }
    const lineCount = integer(result.lineCount, `${captionContext}.result.lineCount`);
    const sourceAvailableCount = integer(result.sourceAvailableCount, `${captionContext}.result.sourceAvailableCount`);
    const targetAvailableCount = integer(result.targetAvailableCount, `${captionContext}.result.targetAvailableCount`);
    const withheldCount = integer(result.withheldCount, `${captionContext}.result.withheldCount`);
    const unavailableCount = integer(result.unavailableCount, `${captionContext}.result.unavailableCount`);
    if (
      lineCount > 64 || sourceAvailableCount > lineCount || targetAvailableCount > lineCount ||
      withheldCount > lineCount || unavailableCount > lineCount ||
      targetAvailableCount + withheldCount > lineCount
    ) fail(`${captionContext}.result`, "counts exceed the closed line ceiling.");
    return {
      jobId,
      approval: approvalValue,
      authorityState: caption.authorityState as "unrevoked" | "revoked_after_completion",
      integrity: "stored_caption_and_receipt_with_verified_approval" as const,
      captionArtifactId: identity(caption.captionArtifactId, `${captionContext}.captionArtifactId`),
      captionContentId: contentId(caption.captionContentId, `${captionContext}.captionContentId`),
      receiptArtifactId: identity(caption.receiptArtifactId, `${captionContext}.receiptArtifactId`),
      receiptId: identity(caption.receiptId, `${captionContext}.receiptId`),
      receiptContentId: contentId(caption.receiptContentId, `${captionContext}.receiptContentId`),
      executor: {
        id: executor.id as "studio.recorded-caption-fixture-adapter" | "studio.openai-caption-producer",
        version: "1" as const,
        classification: executor.classification as "recorded_real_pipeline_fixture" | "real_recognizer_translator",
        executionScope: executor.executionScope as "test_demo_only" | "current_run",
        cognitionClaim: "none" as const,
        recognizer,
        translator,
        sourceCaptionContentId,
      },
      result: {
        status: result.status as "completed" | "partial" | "withheld" | "unavailable",
        lineCount,
        sourceAvailableCount,
        targetAvailableCount,
        withheldCount,
        unavailableCount,
      },
    };
  });
  return {
    schema: "studio.local-runtime-caption-productions.v1",
    commandId: identity(item.commandId, `${context}.commandId`),
    runtimeId,
    journalHead: integer(item.journalHead, `${context}.journalHead`),
    captions,
  };
}

async function captionProductionResultsResponse(
  value: unknown,
  expectedRuntimeId: string,
): Promise<RuntimeHostCaptionProductionResultsResponse> {
  const context = "Runtime host caption production results";
  const item = object(value, context);
  exact(item, ["schema", "commandId", "runtimeId", "journalHead", "results"], context);
  if (item.schema !== "studio.local-runtime-caption-production-results.v1") {
    fail(context, "schema is unsupported.");
  }
  const runtimeId = identity(item.runtimeId, `${context}.runtimeId`);
  if (runtimeId !== expectedRuntimeId) fail(context, "runtime identity changed.");
  if (!Array.isArray(item.results)) fail(`${context}.results`, "must be an array.");
  const entries = item.results.map((candidate, index) => {
    const resultContext = `${context}.results[${index}]`;
    const result = object(candidate, resultContext);
    exact(result, ["verification", "artifact"], resultContext);
    return result;
  });
  const verifications = captionProductionResponse({
    schema: "studio.local-runtime-caption-productions.v1",
    commandId: item.commandId,
    runtimeId,
    journalHead: item.journalHead,
    captions: entries.map((entry) => entry.verification),
  }, runtimeId).captions;
  const results = await Promise.all(entries.map(async (entry, index) => {
    const resultContext = `${context}.results[${index}]`;
    const verification = verifications[index];
    const artifact = validateCaptionProductionArtifact(
      entry.artifact,
      context,
      `results[${index}].artifact`,
    );
    if (
      artifact.runId !== runtimeId ||
      artifact.jobId !== verification.jobId ||
      JSON.stringify(artifact.executor) !== JSON.stringify(verification.executor) ||
      JSON.stringify(artifact.result) !== JSON.stringify(verification.result)
    ) {
      fail(resultContext, "verified identities, executor, or result counts do not match the artifact.");
    }
    const measuredContent = await identifyUtf8(canonicalJsonLine(artifact));
    if (measuredContent.contentId !== verification.captionContentId) {
      fail(resultContext, "artifact bytes do not match the verified caption content identity.");
    }
    return { verification, artifact };
  }));
  return {
    schema: "studio.local-runtime-caption-production-results.v1",
    commandId: identity(item.commandId, `${context}.commandId`),
    runtimeId,
    journalHead: integer(item.journalHead, `${context}.journalHead`),
    results,
  };
}

function captionQualityControlResponse(
  value: unknown,
  expectedRuntimeId: string,
): RuntimeHostCaptionQualityControlResponse {
  const context = "Runtime host caption quality controls";
  const item = object(value, context);
  exact(item, ["schema", "commandId", "runtimeId", "journalHead", "qualityControls"], context);
  if (item.schema !== "studio.local-runtime-caption-quality-controls.v1") fail(context, "schema is unsupported.");
  const runtimeId = identity(item.runtimeId, `${context}.runtimeId`);
  if (runtimeId !== expectedRuntimeId) fail(context, "runtime identity changed.");
  if (!Array.isArray(item.qualityControls)) fail(`${context}.qualityControls`, "must be an array.");
  const qcIds = new Set<string>();
  const qualityControls = item.qualityControls.map((candidate, index) => {
    const qcContext = `${context}.qualityControls[${index}]`;
    const qc = object(candidate, qcContext);
    exact(qc, [
      "qcId", "jobId", "captionArtifactId", "captionContentId", "outputArtifactId",
      "receiptId", "receiptContentId", "integrity", "policy", "outcome", "reasonCodes",
      "acceptedLineIds", "withheldLineIds",
    ], qcContext);
    const qcId = identity(qc.qcId, `${qcContext}.qcId`);
    if (qcIds.has(qcId)) fail(`${qcContext}.qcId`, "is duplicated.");
    qcIds.add(qcId);
    if (qc.integrity !== "stored_independent_qc_with_verified_current_run_candidate") {
      fail(`${qcContext}.integrity`, "does not carry closed independent QC verification.");
    }
    if (qc.policy !== "structural_current_run_gate_without_semantic_quality_score") {
      fail(`${qcContext}.policy`, "claims an unsupported quality policy.");
    }
    if (qc.outcome !== "accepted" && qc.outcome !== "withheld") {
      fail(`${qcContext}.outcome`, "is unsupported.");
    }
    if (!Array.isArray(qc.reasonCodes) || qc.reasonCodes.length !== 1) {
      fail(`${qcContext}.reasonCodes`, "must contain one closed reason.");
    }
    const reasons = new Set([
      "current_run_candidate_structurally_complete",
      "recorded_fixture_test_demo_only",
      "candidate_has_unavailable_or_withheld_lines",
      "candidate_has_no_lines",
    ]);
    const reasonCode = string(qc.reasonCodes[0], `${qcContext}.reasonCodes[0]`);
    if (!reasons.has(reasonCode)) fail(`${qcContext}.reasonCodes[0]`, "is unsupported.");
    const lineIds = (value: unknown, path: string): string[] => {
      if (!Array.isArray(value)) fail(path, "must be an array.");
      const ids = value.map((entry, lineIndex) => identity(entry, `${path}[${lineIndex}]`));
      if (new Set(ids).size !== ids.length) fail(path, "contains duplicate line identities.");
      return ids;
    };
    const acceptedLineIds = lineIds(qc.acceptedLineIds, `${qcContext}.acceptedLineIds`);
    const withheldLineIds = lineIds(qc.withheldLineIds, `${qcContext}.withheldLineIds`);
    if (acceptedLineIds.some((id) => withheldLineIds.includes(id))) {
      fail(qcContext, "a line cannot be both accepted and withheld.");
    }
    if (
      (qc.outcome === "accepted" && (reasonCode !== "current_run_candidate_structurally_complete" || acceptedLineIds.length === 0 || withheldLineIds.length > 0)) ||
      (qc.outcome === "withheld" && reasonCode === "current_run_candidate_structurally_complete")
    ) fail(qcContext, "outcome, reason, and line decisions do not agree.");
    return {
      qcId,
      jobId: identity(qc.jobId, `${qcContext}.jobId`),
      captionArtifactId: identity(qc.captionArtifactId, `${qcContext}.captionArtifactId`),
      captionContentId: contentId(qc.captionContentId, `${qcContext}.captionContentId`),
      outputArtifactId: identity(qc.outputArtifactId, `${qcContext}.outputArtifactId`),
      receiptId: identity(qc.receiptId, `${qcContext}.receiptId`),
      receiptContentId: contentId(qc.receiptContentId, `${qcContext}.receiptContentId`),
      integrity: "stored_independent_qc_with_verified_current_run_candidate" as const,
      policy: "structural_current_run_gate_without_semantic_quality_score" as const,
      outcome: qc.outcome as "accepted" | "withheld",
      reasonCodes: [reasonCode as "current_run_candidate_structurally_complete" | "recorded_fixture_test_demo_only" | "candidate_has_unavailable_or_withheld_lines" | "candidate_has_no_lines"],
      acceptedLineIds,
      withheldLineIds,
    };
  });
  return {
    schema: "studio.local-runtime-caption-quality-controls.v1",
    commandId: identity(item.commandId, `${context}.commandId`),
    runtimeId,
    journalHead: integer(item.journalHead, `${context}.journalHead`),
    qualityControls,
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

  async createOwnedMediaIngest(request: OwnedMediaIngestRequest): Promise<OwnedMediaIngestStatus> {
    return ingestStatus(await this.request("/v1/owned-media-ingests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    }));
  }

  async uploadOwnedMedia(ingestId: string, bytes: Blob): Promise<OwnedMediaIngestStatus> {
    const stableId = identity(ingestId, "Owned media ingest id");
    return ingestStatus(await this.request(
      `/v1/owned-media-ingests/${encodeURIComponent(stableId)}/media`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/octet-stream" },
        body: bytes,
      },
    ));
  }

  async ownedMediaIngestStatus(ingestId: string): Promise<OwnedMediaIngestStatus> {
    const stableId = identity(ingestId, "Owned media ingest id");
    return ingestStatus(await this.request(`/v1/owned-media-ingests/${encodeURIComponent(stableId)}`));
  }

  async plan(request: RuntimeHostStartRequest): Promise<RuntimeHostPlanResponse> {
    const plan = planResponse(await this.request("/v1/runtime-plans", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    }));
    if (
      plan.sourceSessionId !== request.sourceSessionId ||
      plan.sourceRevisionId !== request.sourceRevisionId ||
      plan.forecast.inputs.selectedRange.startMs !== request.range.startMs ||
      plan.forecast.inputs.selectedRange.endMs !== request.range.endMs
    ) {
      fail("Runtime host plan", "source or selected-range identities do not match the submitted request.");
    }
    return plan;
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

  async assessmentAudits(runtimeId: string): Promise<RuntimeHostAssessmentAuditResponse> {
    return assessmentAuditResponse(
      await this.request(`/v1/runtimes/${encodeURIComponent(runtimeId)}/assessment-audits`),
      runtimeId,
    );
  }

  async decisionReceipts(runtimeId: string): Promise<RuntimeHostDecisionReceiptResponse> {
    return decisionReceiptResponse(
      await this.request(`/v1/runtimes/${encodeURIComponent(runtimeId)}/decision-receipts`),
      runtimeId,
    );
  }

  async publishReviewIntakes(runtimeId: string): Promise<RuntimeHostPublishReviewIntakeResponse> {
    return publishReviewIntakeResponse(
      await this.request(`/v1/runtimes/${encodeURIComponent(runtimeId)}/publish-review-intakes`),
      runtimeId,
    );
  }

  async publishReviewDecisions(runtimeId: string): Promise<RuntimeHostPublishReviewDecisionResponse> {
    return publishReviewDecisionResponse(
      await this.request(`/v1/runtimes/${encodeURIComponent(runtimeId)}/publish-review-decisions`),
      runtimeId,
    );
  }

  async createPublishReviewDecision(
    runtimeId: string,
    request: RuntimeHostPublishReviewDecisionRequest,
  ): Promise<RuntimeHostPublishReviewDecisionResponse> {
    return publishReviewDecisionResponse(
      await this.request(`/v1/runtimes/${encodeURIComponent(runtimeId)}/publish-review-decisions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
      }),
      runtimeId,
    );
  }

  async createPublishReviewRevocation(
    runtimeId: string,
    request: RuntimeHostPublishReviewRevocationRequest,
  ): Promise<RuntimeHostPublishReviewDecisionResponse> {
    return publishReviewDecisionResponse(
      await this.request(`/v1/runtimes/${encodeURIComponent(runtimeId)}/publish-review-revocations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
      }),
      runtimeId,
    );
  }

  async captionProductions(runtimeId: string): Promise<RuntimeHostCaptionProductionResponse> {
    return captionProductionResponse(
      await this.request(`/v1/runtimes/${encodeURIComponent(runtimeId)}/caption-productions`),
      runtimeId,
    );
  }

  async captionProductionResults(
    runtimeId: string,
  ): Promise<RuntimeHostCaptionProductionResultsResponse> {
    return captionProductionResultsResponse(
      await this.request(`/v1/runtimes/${encodeURIComponent(runtimeId)}/caption-production-results`),
      runtimeId,
    );
  }

  async captionQualityControls(
    runtimeId: string,
  ): Promise<RuntimeHostCaptionQualityControlResponse> {
    return captionQualityControlResponse(
      await this.request(`/v1/runtimes/${encodeURIComponent(runtimeId)}/caption-quality-controls`),
      runtimeId,
    );
  }

  async createCaptionQualityControl(
    runtimeId: string,
    request: RuntimeHostCaptionQualityControlRequest,
  ): Promise<RuntimeHostCaptionQualityControlResponse> {
    return captionQualityControlResponse(
      await this.request(`/v1/runtimes/${encodeURIComponent(runtimeId)}/caption-quality-controls`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
      }),
      runtimeId,
    );
  }

  async createCaptionProduction(
    runtimeId: string,
    request: RuntimeHostCaptionProductionRequest,
  ): Promise<RuntimeHostCaptionProductionResponse> {
    return captionProductionResponse(
      await this.request(`/v1/runtimes/${encodeURIComponent(runtimeId)}/caption-productions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
      }),
      runtimeId,
    );
  }
}
