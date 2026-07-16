import type { RuntimeHostPlanResponse } from "../../runtime/production/runtimeHost/model.ts";
import {
  contentId,
  exact,
  fail,
  identity,
  integer,
  object,
  string,
} from "./responseGuards.ts";

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

export function planResponse(value: unknown): RuntimeHostPlanResponse {
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
