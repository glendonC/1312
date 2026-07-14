import assert from "node:assert/strict";
import test from "node:test";

import {
  createForecastArtifact,
  freezeForecastArtifact,
  validateForecastArtifact,
} from "../src/studio/runtime/production/forecast/planner.ts";
import type { ForecastRequest } from "../src/studio/runtime/production/forecast/model.ts";

const request: ForecastRequest = {
  artifact: {
    artifactId: "artifact:measured-source",
    contentId: `sha256:${"a".repeat(64)}`,
    measuredDurationMs: 20_000,
    durationMeasurement: {
      schema: "studio.media-probe.v1",
      producer: "scripts/probe-media.mjs",
      receiptContentId: `sha256:${"b".repeat(64)}`,
    },
  },
  range: { startMs: 1_000, endMs: 11_000 },
  workPlan: {
    schema: "studio.forecast.work-plan.v1",
    planId: "plan:explicit-operations",
    operations: [
      {
        operationId: "operation:transcribe",
        kind: "speech.transcribe",
        range: { startMs: 1_000, endMs: 11_000 },
      },
      {
        operationId: "operation:translate",
        kind: "translation.requested",
        range: { startMs: 2_000, endMs: 7_000 },
      },
      {
        operationId: "operation:quality",
        kind: "quality.review",
        range: { startMs: 6_000, endMs: 11_000 },
      },
    ],
  },
};

test("forecast floor sums measured explicit operation ranges deterministically", () => {
  const forecast = createForecastArtifact(request);
  const repeated = createForecastArtifact(structuredClone(request));

  assert.deepEqual(repeated, forecast);
  assert.equal(forecast.schema, "studio.forecast.v1");
  assert.equal(forecast.estimator.version, "1");
  assert.equal(forecast.scenarios.baseline.label, "baseline");
  assert.equal(forecast.scenarios.baseline.status, "floor_only");
  assert.deepEqual(forecast.scenarios.baseline.workload, {
    selectedMediaDurationMs: 10_000,
    operationCount: 3,
    requestedOperationMediaDurationMs: 20_000,
    operations: [
      { operationId: "operation:transcribe", kind: "speech.transcribe", requestedMediaDurationMs: 10_000 },
      { operationId: "operation:translate", kind: "translation.requested", requestedMediaDurationMs: 5_000 },
      { operationId: "operation:quality", kind: "quality.review", requestedMediaDurationMs: 5_000 },
    ],
  });
  assert.equal(forecast.scenarios.expected.label, "expected");
  assert.equal(forecast.scenarios.expected.status, "unavailable");
  assert.equal(forecast.scenarios.conservative.label, "conservative");
  assert.equal(forecast.scenarios.conservative.status, "unavailable");
  assert.equal(validateForecastArtifact(forecast), forecast);
});

test("forecast rejects missing or unbounded measured inputs", () => {
  const missingDuration = structuredClone(request) as unknown as Record<string, unknown>;
  delete (missingDuration.artifact as Record<string, unknown>).measuredDurationMs;
  assert.throws(
    () => createForecastArtifact(missingDuration as unknown as ForecastRequest),
    /request\.artifact\.measuredDurationMs is required/,
  );

  const missingReceipt = structuredClone(request) as unknown as Record<string, unknown>;
  (missingReceipt.artifact as Record<string, unknown>).durationMeasurement = null;
  assert.throws(
    () => createForecastArtifact(missingReceipt as unknown as ForecastRequest),
    /durationMeasurement must be an object/,
  );

  const beyondMeasurement = structuredClone(request);
  beyondMeasurement.range.endMs = 20_001;
  assert.throws(
    () => createForecastArtifact(beyondMeasurement),
    /range exceeds the measured artifact duration/,
  );

  const undeclaredWork = structuredClone(request);
  undeclaredWork.workPlan.operations = [];
  assert.throws(
    () => createForecastArtifact(undeclaredWork),
    /operations must contain at least one explicit operation/,
  );
});

test("forecast fabricates no token or cost values without producers", () => {
  const forecast = createForecastArtifact(request);

  for (const scenario of Object.values(forecast.scenarios)) {
    assert.equal(scenario.modelUsage, null);
    assert.equal(scenario.elapsedDurationMs, null);
    assert.deepEqual(scenario.apiCost, { amount: null, currency: null });
  }
  assert.deepEqual(forecast.calibration, {
    status: "unavailable",
    evidence: null,
    cohort: null,
  });
  assert.deepEqual(forecast.pricing, {
    status: "unavailable",
    priceBookAdapter: null,
    priceBookSnapshot: null,
    currency: null,
  });
});

test("run-start freeze references the accepted forecast without rewriting it or actuals", () => {
  const forecast = createForecastArtifact(request);
  const beforeFreeze = structuredClone(forecast);
  const frozen = freezeForecastArtifact(forecast, {
    runId: "run:forecast-test",
    acceptedBy: "operator:test",
    runStartAt: "2026-07-14T12:00:00.000Z",
  });

  assert.deepEqual(forecast, beforeFreeze);
  assert.deepEqual(frozen.forecast, {
    schema: forecast.schema,
    forecastId: forecast.forecastId,
    contentId: forecast.content.contentId,
  });
  assert.deepEqual(frozen.immutability, {
    forecast: "referenced_by_content_id",
    actuals: "not_embedded",
    evaluation: "separate_artifact",
  });

  const tampered = structuredClone(forecast);
  tampered.scenarios.baseline.workload.requestedOperationMediaDurationMs += 1;
  assert.throws(
    () => freezeForecastArtifact(tampered, frozen.acceptance),
    /does not match its deterministic estimator output and content identity/,
  );
});
