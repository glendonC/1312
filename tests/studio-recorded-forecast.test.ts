import assert from "node:assert/strict";
import test from "node:test";

import { createForecastArtifact } from "../src/studio/runtime/production/forecast/planner.ts";
import type { ForecastRequest } from "../src/studio/runtime/production/forecast/model.ts";
import {
  projectRecordedForecast,
  readForecastArtifact,
} from "../src/studio/preflight/recordedForecast.ts";

/** A real deterministic artifact from the producer, not a hand-authored shape. */
function sampleArtifact() {
  const request: ForecastRequest = {
    artifact: {
      artifactId: "artifact:test-source",
      contentId: `sha256:${"a".repeat(64)}`,
      measuredDurationMs: 40_000,
      durationMeasurement: {
        schema: "studio.media-probe.v1",
        producer: "scripts/probe-media.mjs",
        receiptContentId: `sha256:${"b".repeat(64)}`,
      },
    },
    range: { startMs: 0, endMs: 40_000 },
    workPlan: {
      schema: "studio.forecast.work-plan.v1",
      planId: "plan:test",
      operations: [
        { operationId: "op-1", kind: "transcribe", range: { startMs: 0, endMs: 40_000 } },
        { operationId: "op-2", kind: "translate", range: { startMs: 0, endMs: 40_000 } },
        { operationId: "op-3", kind: "score", range: { startMs: 0, endMs: 20_000 } },
      ],
    },
  };
  return createForecastArtifact(request);
}

/** Mimic a file that went out to disk and came back through fetch/JSON. */
function fetched(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}

test("readForecastArtifact accepts a real floor_only artifact and projects its floor", () => {
  const read = readForecastArtifact(fetched(sampleArtifact()));
  assert.ok(read, "a producer-emitted artifact should be accepted");
  const view = projectRecordedForecast(read);
  assert.equal(view.kind, "floor");
  if (view.kind !== "floor") return;
  assert.equal(view.operationCount, 3);
  assert.equal(view.requestedOperationMediaDurationMs, 100_000); // 40k + 40k + 20k
  assert.equal(view.selectedMediaDurationMs, 40_000);
});

test("projectRecordedForecast falls closed to unavailable without an artifact", () => {
  assert.deepEqual(projectRecordedForecast(null), { kind: "unavailable" });
  assert.deepEqual(projectRecordedForecast(undefined), { kind: "unavailable" });
});

test("readForecastArtifact fails closed on off-contract input", () => {
  assert.equal(readForecastArtifact(null), null);
  assert.equal(readForecastArtifact("nope"), null);
  assert.equal(readForecastArtifact({}), null);

  const wrongSchema = fetched(sampleArtifact()) as Record<string, unknown>;
  wrongSchema.schema = "studio.forecast.v0";
  assert.equal(readForecastArtifact(wrongSchema), null);

  const notFloor = fetched(sampleArtifact()) as any;
  notFloor.scenarios.baseline.status = "unavailable";
  assert.equal(readForecastArtifact(notFloor), null);

  const noWorkload = fetched(sampleArtifact()) as any;
  noWorkload.scenarios.baseline.workload = null;
  assert.equal(readForecastArtifact(noWorkload), null);

  const zeroOps = fetched(sampleArtifact()) as any;
  zeroOps.scenarios.baseline.workload.operationCount = 0;
  assert.equal(readForecastArtifact(zeroOps), null);

  const fractionalMedia = fetched(sampleArtifact()) as any;
  fractionalMedia.scenarios.baseline.workload.requestedOperationMediaDurationMs = 1.5;
  assert.equal(readForecastArtifact(fractionalMedia), null);
});
