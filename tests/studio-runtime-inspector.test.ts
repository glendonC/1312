import assert from "node:assert/strict";
import test from "node:test";

import {
  compactRuntimeIdentity,
  formatDuration,
  formatMeasuredInteger,
  runtimeSourceDomId,
} from "../src/studio/runtime/production/runtimeInspector/format.ts";
import { loadRuntimeInspectorJournal } from "../src/studio/runtime/production/runtimeInspector/journalLoader.ts";

function minimalProductionJournal(): string {
  const digest = "a".repeat(64);
  return `${JSON.stringify({
    schema: "studio.runtime.event.v1",
    runId: "runtime:inspector-test",
    seq: 1,
    eventId: "event:runtime:inspector-test:1",
    recordedAt: "2026-07-15T12:00:00.000Z",
    producer: { kind: "artifact_store", id: "artifact-store:test" },
    causationId: null,
    correlationId: null,
    type: "artifact.recorded",
    data: {
      artifact: {
        schema: "studio.runtime.artifact.v1",
        id: "artifact:source",
        runId: "runtime:inspector-test",
        kind: "source-media",
        mediaClass: "raw",
        publication: "private",
        content: {
          algorithm: "sha256",
          digest,
          contentId: `sha256:${digest}`,
          bytes: 1,
        },
        storageKey: `objects/sha256/aa/${digest}`,
        durationMs: null,
        tracks: [],
        sourceArtifactIds: [],
        producerTaskId: null,
        producerAgentId: null,
        origin: {
          kind: "ingest",
          adapterId: "owned-local-source-adapter.v1",
          sourceReceiptRef: "owned-local:test",
        },
      },
    },
  })}\n`;
}

test("runtime inspector loading builds matching index and UI projection", async () => {
  const loaded = await loadRuntimeInspectorJournal(minimalProductionJournal());

  assert.equal(loaded.index.sourceJournal.runId, "runtime:inspector-test");
  assert.equal(loaded.index.sourceJournal.eventCount, 1);
  assert.equal(loaded.projection.runId, "runtime:inspector-test");
  assert.equal(loaded.projection.lastSeq, 1);
  assert.deepEqual(loaded.projection.source, {
    kind: "production_runtime_journal",
    recordedDemo: false,
  });
});

test("runtime inspector loading preserves journal validation diagnostics", async () => {
  await assert.rejects(
    () => loadRuntimeInspectorJournal("not-json\n"),
    { message: "Production observability journal line 1 is not valid JSON" },
  );
});

test("runtime inspector formatting preserves unavailable values and source anchors", () => {
  assert.equal(formatDuration(null), "unavailable");
  assert.equal(formatDuration(1_250), "1.25 s active");
  assert.equal(formatMeasuredInteger(null), "unavailable");
  assert.equal(compactRuntimeIdentity("short-id"), "short-id");
  assert.equal(runtimeSourceDomId("receipt", "usage:sha256:test/value"), "runtime-source-receipt-usage-sha256-test-value");
});
