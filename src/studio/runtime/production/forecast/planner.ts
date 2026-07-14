import { createHash } from "node:crypto";

import {
  FORECAST_ESTIMATOR,
  FORECAST_SCHEMA,
  type ForecastArtifact,
  type ForecastArtifactInput,
  type ForecastContentIdentity,
  type ForecastFreezeRequest,
  type ForecastRangeInput,
  type ForecastRequest,
  type ForecastWorkPlan,
  type ForecastWorkPlanOperation,
  type FrozenForecastArtifact,
} from "./model.ts";

function fail(path: string, message: string): never {
  throw new Error(`forecast: ${path} ${message}`);
}

function object(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail(path, "must be an object");
  }
  return value as Record<string, unknown>;
}

function exact(item: Record<string, unknown>, keys: readonly string[], path: string): void {
  const allowed = new Set(keys);
  for (const key of Object.keys(item)) {
    if (!allowed.has(key)) fail(`${path}.${key}`, "is not allowed");
  }
  for (const key of keys) {
    if (!(key in item)) fail(`${path}.${key}`, "is required");
  }
}

function text(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    fail(path, "must be a non-empty string");
  }
  return value;
}

function literal<T extends string>(value: unknown, expected: T, path: string): T {
  if (value !== expected) fail(path, `must equal ${expected}`);
  return expected;
}

function integer(value: unknown, path: string, minimum = 0): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) {
    fail(path, `must be a safe integer at least ${minimum}`);
  }
  return value as number;
}

function contentId(value: unknown, path: string): string {
  const id = text(value, path);
  if (!/^sha256:[a-f0-9]{64}$/.test(id)) fail(path, "must be a SHA-256 content id");
  return id;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("forecast: canonical content contains a non-finite number");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    const item = value as Record<string, unknown>;
    return `{${Object.keys(item)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(item[key])}`)
      .join(",")}}`;
  }
  throw new Error(`forecast: canonical content contains unsupported ${typeof value}`);
}

function identify(value: unknown): ForecastContentIdentity {
  const canonical = `${canonicalJson(value)}\n`;
  const digest = createHash("sha256").update(canonical).digest("hex");
  return {
    algorithm: "sha256",
    digest,
    contentId: `sha256:${digest}`,
    bytes: new TextEncoder().encode(canonical).byteLength,
  };
}

function range(value: unknown, path: string): ForecastRangeInput {
  const item = object(value, path);
  exact(item, ["startMs", "endMs"], path);
  const startMs = integer(item.startMs, `${path}.startMs`);
  const endMs = integer(item.endMs, `${path}.endMs`, 1);
  if (endMs <= startMs) fail(path, "must be a non-empty half-open range");
  return { startMs, endMs };
}

function artifact(value: unknown): ForecastArtifactInput {
  const item = object(value, "request.artifact");
  exact(
    item,
    ["artifactId", "contentId", "measuredDurationMs", "durationMeasurement"],
    "request.artifact",
  );
  const measurement = object(item.durationMeasurement, "request.artifact.durationMeasurement");
  exact(
    measurement,
    ["schema", "producer", "receiptContentId"],
    "request.artifact.durationMeasurement",
  );
  return {
    artifactId: text(item.artifactId, "request.artifact.artifactId"),
    contentId: contentId(item.contentId, "request.artifact.contentId"),
    measuredDurationMs: integer(item.measuredDurationMs, "request.artifact.measuredDurationMs", 1),
    durationMeasurement: {
      schema: literal(
        measurement.schema,
        "studio.media-probe.v1",
        "request.artifact.durationMeasurement.schema",
      ),
      producer: literal(
        measurement.producer,
        "scripts/probe-media.mjs",
        "request.artifact.durationMeasurement.producer",
      ),
      receiptContentId: contentId(
        measurement.receiptContentId,
        "request.artifact.durationMeasurement.receiptContentId",
      ),
    },
  };
}

function operation(value: unknown, index: number, selectedRange: ForecastRangeInput): ForecastWorkPlanOperation {
  const path = `request.workPlan.operations[${index}]`;
  const item = object(value, path);
  exact(item, ["operationId", "kind", "range"], path);
  const requestedRange = range(item.range, `${path}.range`);
  if (requestedRange.startMs < selectedRange.startMs || requestedRange.endMs > selectedRange.endMs) {
    fail(`${path}.range`, "must stay inside the selected measured range");
  }
  return {
    operationId: text(item.operationId, `${path}.operationId`),
    kind: text(item.kind, `${path}.kind`),
    range: requestedRange,
  };
}

function workPlan(value: unknown, selectedRange: ForecastRangeInput): ForecastWorkPlan {
  const item = object(value, "request.workPlan");
  exact(item, ["schema", "planId", "operations"], "request.workPlan");
  if (!Array.isArray(item.operations) || item.operations.length === 0) {
    fail("request.workPlan.operations", "must contain at least one explicit operation");
  }
  const operations = item.operations.map((value, index) => operation(value, index, selectedRange));
  const operationIds = operations.map((item) => item.operationId);
  if (new Set(operationIds).size !== operationIds.length) {
    fail("request.workPlan.operations", "must use unique operation ids");
  }
  return {
    schema: literal(item.schema, "studio.forecast.work-plan.v1", "request.workPlan.schema"),
    planId: text(item.planId, "request.workPlan.planId"),
    operations,
  };
}

function request(value: unknown): ForecastRequest {
  const item = object(value, "request");
  exact(item, ["artifact", "range", "workPlan"], "request");
  const inputArtifact = artifact(item.artifact);
  const selectedRange = range(item.range, "request.range");
  if (selectedRange.endMs > inputArtifact.measuredDurationMs) {
    fail("request.range", "exceeds the measured artifact duration");
  }
  return {
    artifact: inputArtifact,
    range: selectedRange,
    workPlan: workPlan(item.workPlan, selectedRange),
  };
}

function checkedSum(values: readonly number[], path: string): number {
  let total = 0;
  for (const value of values) {
    total += value;
    if (!Number.isSafeInteger(total)) fail(path, "exceeds safe integer precision");
  }
  return total;
}

/**
 * Produces only the deterministic workload floor supported by measured duration, selected range,
 * and explicit operation scopes. It deliberately has no token, elapsed-time, pricing, or
 * calibration adapter.
 */
export function createForecastArtifact(value: ForecastRequest): ForecastArtifact {
  const input = request(value);
  const selectedMediaDurationMs = input.range.endMs - input.range.startMs;
  const operations = input.workPlan.operations.map((operation) => ({
    operationId: operation.operationId,
    kind: operation.kind,
    requestedMediaDurationMs: operation.range.endMs - operation.range.startMs,
  }));
  const requestedOperationMediaDurationMs = checkedSum(
    operations.map((operation) => operation.requestedMediaDurationMs),
    "request.workPlan.operations",
  );

  const unavailableCost = () => ({ amount: null, currency: null }) as const;
  const body = {
    schema: FORECAST_SCHEMA,
    estimator: FORECAST_ESTIMATOR,
    inputs: {
      artifact: input.artifact,
      selectedRange: {
        ...input.range,
        durationMs: selectedMediaDurationMs,
      },
      workPlan: input.workPlan,
    },
    scenarios: {
      baseline: {
        label: "baseline" as const,
        status: "floor_only" as const,
        workload: {
          selectedMediaDurationMs,
          operationCount: operations.length,
          requestedOperationMediaDurationMs,
          operations,
        },
        elapsedDurationMs: null,
        modelUsage: null,
        apiCost: unavailableCost(),
      },
      expected: {
        label: "expected" as const,
        status: "unavailable" as const,
        workload: null,
        elapsedDurationMs: null,
        modelUsage: null,
        apiCost: unavailableCost(),
      },
      conservative: {
        label: "conservative" as const,
        status: "unavailable" as const,
        workload: null,
        elapsedDurationMs: null,
        modelUsage: null,
        apiCost: unavailableCost(),
      },
    },
    assumptions: [
      {
        code: "measured_duration_envelope",
        statement:
          "The selected range is bounded by the duration declared by the referenced studio.media-probe.v1 receipt.",
      },
      {
        code: "explicit_operation_ranges_only",
        statement:
          "The floor sums each requested operation range once; retries, spawned work, and undeclared operations are excluded.",
      },
      {
        code: "workload_not_elapsed_time",
        statement:
          "Requested media milliseconds are workload volume, not wall time, active execution time, usage, or billing.",
      },
    ],
    uncertainty: [
      {
        code: "dynamic_work_unavailable",
        affects: ["scenarios.baseline.workload"],
        statement: "No producer establishes retries, child work, or reprocessing before the run.",
      },
      {
        code: "historical_calibration_unavailable",
        affects: ["scenarios.expected", "scenarios.conservative"],
        statement: "No compatible historical calibration producer exists.",
      },
      {
        code: "elapsed_time_unavailable",
        affects: [
          "scenarios.baseline.elapsedDurationMs",
          "scenarios.expected.elapsedDurationMs",
          "scenarios.conservative.elapsedDurationMs",
        ],
        statement: "Media duration and operation scopes do not establish concurrency or processing speed.",
      },
      {
        code: "model_usage_unavailable",
        affects: [
          "scenarios.baseline.modelUsage",
          "scenarios.expected.modelUsage",
          "scenarios.conservative.modelUsage",
        ],
        statement: "No compatible pre-run model-usage estimator or calibrated history exists.",
      },
      {
        code: "pricing_unavailable",
        affects: [
          "scenarios.baseline.apiCost",
          "scenarios.expected.apiCost",
          "scenarios.conservative.apiCost",
        ],
        statement: "No versioned price-book adapter or pricing snapshot exists.",
      },
    ],
    calibration: {
      status: "unavailable" as const,
      evidence: null,
      cohort: null,
    },
    pricing: {
      status: "unavailable" as const,
      priceBookAdapter: null,
      priceBookSnapshot: null,
      currency: null,
    },
  };
  const content = identify(body);
  return {
    schema: body.schema,
    forecastId: `forecast:${content.digest}`,
    content,
    estimator: body.estimator,
    inputs: body.inputs,
    scenarios: body.scenarios,
    assumptions: body.assumptions,
    uncertainty: body.uncertainty,
    calibration: body.calibration,
    pricing: body.pricing,
  };
}

export function validateForecastArtifact(value: unknown): ForecastArtifact {
  const item = object(value, "artifact");
  exact(
    item,
    [
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
    ],
    "artifact",
  );
  const inputs = object(item.inputs, "artifact.inputs");
  const selectedRange = object(inputs.selectedRange, "artifact.inputs.selectedRange");
  const rebuilt = createForecastArtifact({
    artifact: inputs.artifact as unknown as ForecastArtifactInput,
    range: {
      startMs: selectedRange.startMs as number,
      endMs: selectedRange.endMs as number,
    },
    workPlan: inputs.workPlan as unknown as ForecastWorkPlan,
  });
  if (canonicalJson(value) !== canonicalJson(rebuilt)) {
    fail("artifact", "does not match its deterministic estimator output and content identity");
  }
  return value as ForecastArtifact;
}

function freezeRequest(value: unknown): ForecastFreezeRequest {
  const item = object(value, "freeze");
  exact(item, ["runId", "acceptedBy", "runStartAt"], "freeze");
  const runStartAt = text(item.runStartAt, "freeze.runStartAt");
  const parsed = new Date(runStartAt);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== runStartAt) {
    fail("freeze.runStartAt", "must be an exact ISO timestamp");
  }
  return {
    runId: text(item.runId, "freeze.runId"),
    acceptedBy: text(item.acceptedBy, "freeze.acceptedBy"),
    runStartAt,
  };
}

/** Records acceptance by identity; it never embeds or rewrites later usage/actuals. */
export function freezeForecastArtifact(
  forecastValue: unknown,
  freezeValue: ForecastFreezeRequest,
): FrozenForecastArtifact {
  const forecast = validateForecastArtifact(forecastValue);
  const acceptance = freezeRequest(freezeValue);
  const body = {
    schema: "studio.forecast-freeze.v1" as const,
    producer: {
      id: "studio.forecast.freeze" as const,
      version: "1" as const,
    },
    forecast: {
      schema: forecast.schema,
      forecastId: forecast.forecastId,
      contentId: forecast.content.contentId,
    },
    acceptance,
    immutability: {
      forecast: "referenced_by_content_id" as const,
      actuals: "not_embedded" as const,
      evaluation: "separate_artifact" as const,
    },
  };
  const content = identify(body);
  return {
    schema: body.schema,
    freezeId: `forecast-freeze:${content.digest}`,
    content,
    producer: body.producer,
    forecast: body.forecast,
    acceptance: body.acceptance,
    immutability: body.immutability,
  };
}
