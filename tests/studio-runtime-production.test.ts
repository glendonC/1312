import assert from "node:assert/strict";
import { appendFile, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import { assertRuntimeEvent, assertSourceArtifactDescriptor } from "../src/studio/runtime/production/assertions.ts";
import {
  ContentAddressedArtifactStore,
  identifyFile,
} from "../src/studio/runtime/production/artifactStore.ts";
import {
  FileEventJournal,
  MemoryEventJournal,
  RuntimeLedger,
  type EventJournal,
} from "../src/studio/runtime/production/journal.ts";
import { FfmpegCapabilityHost } from "../src/studio/runtime/production/mediaHost.ts";
import { BoundedReportHost } from "../src/studio/runtime/production/reportHost.ts";
import { applyRuntimeEvent, initialRuntimeProjection } from "../src/studio/runtime/production/projection.ts";
import type {
  RuntimeLimits,
  SourceArtifactDescriptor,
  SpawnRequestInput,
} from "../src/studio/runtime/production/model.ts";
import {
  BoundedRuntimeScheduler,
  type RuntimeIdentityFactory,
} from "../src/studio/runtime/production/scheduler.ts";

const FIXTURE = resolve("public/demo/runs/run-005");

class SequenceIdentities implements RuntimeIdentityFactory {
  private nextId = 0;

  next(kind: "request" | "task" | "agent" | "grant"): string {
    this.nextId += 1;
    return `${kind}:test-${this.nextId}`;
  }

  secret(): string {
    this.nextId += 1;
    return `registration-secret-${this.nextId}`;
  }
}

const BASE_LIMITS: RuntimeLimits = {
  maxDepth: 2,
  maxActiveWorkers: 4,
  runBudget: { wallMs: 180_000, toolCalls: 30 },
  grantableCapabilities: ["task.spawn.request", "report.submit", "media.extract"],
};

async function sourceDescriptor(): Promise<SourceArtifactDescriptor> {
  const source = JSON.parse(await readFile(join(FIXTURE, "source.json"), "utf8")) as {
    receipt_id: string;
    content: { hash: { digest: string }; id: string; bytes: number };
  };
  const probe = JSON.parse(await readFile(join(FIXTURE, "media-probe.json"), "utf8")) as {
    duration: number;
    tracks: Array<{ index: number; type: "audio"; codec: string; duration: number }>;
  };
  return {
    schema: "studio.source-artifact.v1",
    adapterId: "owned-local-source-adapter.v1",
    sourceReceiptRef: source.receipt_id,
    publication: "public",
    path: join(FIXTURE, "clip.m4a"),
    content: {
      algorithm: "sha256",
      digest: source.content.hash.digest,
      contentId: source.content.id,
      bytes: source.content.bytes,
    },
    durationMs: Math.round(probe.duration * 1000),
    tracks: probe.tracks.map((track) => ({
      id: `stream:${track.index}`,
      index: track.index,
      kind: track.type,
      codec: track.codec,
      durationMs: Math.round(track.duration * 1000),
    })),
  };
}

interface RuntimeHarness {
  directory: string;
  storeRoot: string;
  store: ContentAddressedArtifactStore;
  journal: EventJournal;
  ledger: RuntimeLedger;
  scheduler: BoundedRuntimeScheduler;
  sourceArtifactId: string;
  rootTaskId: string;
  rootAgentId: string;
}

async function harness(
  limits: RuntimeLimits = BASE_LIMITS,
  journalKind: "memory" | "file" = "memory",
): Promise<RuntimeHarness> {
  const directory = await mkdtemp(join(tmpdir(), "studio-runtime-test-"));
  const storeRoot = join(directory, "artifact-store");
  const store = new ContentAddressedArtifactStore(storeRoot);
  const sourceArtifact = await store.registerSource("runtime-test", await sourceDescriptor());
  const journal: EventJournal =
    journalKind === "file" ? new FileEventJournal(join(directory, "events.ndjson")) : new MemoryEventJournal();
  const ledger = await RuntimeLedger.open("runtime-test", journal, {
    now: () => new Date("2026-07-14T03:00:00.000Z"),
  });
  await store.record(ledger, sourceArtifact);
  const scheduler = new BoundedRuntimeScheduler(ledger, limits, new SequenceIdentities());
  const rootPermit = await scheduler.createRoot({
    workloadKey: "root:runtime-test",
    objective: "Coordinate the bounded runtime test without inferring media content.",
    workerKind: "orchestrator",
    workerLabel: "orchestrator",
    mediaScope: [
      { artifactId: sourceArtifact.id, trackId: "stream:0", startMs: 0, endMs: sourceArtifact.durationMs },
    ],
    inputArtifactIds: [sourceArtifact.id],
    requiredOutputs: [{ name: "run report", artifactKind: "run-report", required: true }],
    requiredCapabilities: ["task.spawn.request"],
    dependencies: [],
    budget: { wallMs: 60_000, toolCalls: 8 },
  });
  await scheduler.registerAgent(rootPermit);
  await scheduler.transitionTask(rootPermit.taskId, rootPermit.agentId, "working");
  return {
    directory,
    storeRoot,
    store,
    journal,
    ledger,
    scheduler,
    sourceArtifactId: sourceArtifact.id,
    rootTaskId: rootPermit.taskId,
    rootAgentId: rootPermit.agentId,
  };
}

function childInput(runtime: RuntimeHarness): SpawnRequestInput {
  return {
    workloadKey: "extract:source:1000-1800",
    objective: "Extract the authorized audio range and return its receipted artifact.",
    workerKind: "media",
    workerLabel: "media-range-worker",
    mediaScope: [
      { artifactId: runtime.sourceArtifactId, trackId: "stream:0", startMs: 1_000, endMs: 1_800 },
    ],
    inputArtifactIds: [runtime.sourceArtifactId],
    requiredOutputs: [{ name: "audio range", artifactKind: "media-range-audio", required: true }],
    requiredCapabilities: ["media.extract", "report.submit"],
    dependencies: [],
    budget: { wallMs: 20_000, toolCalls: 1 },
  };
}

async function cleanup(runtime: RuntimeHarness): Promise<void> {
  await rm(runtime.directory, { recursive: true, force: true });
}

test("production protocol rejects fixture-only and provider-specific source fields", async () => {
  assert.throws(
    () =>
      assertRuntimeEvent({
        fixtureOnly: true,
        seq: 1,
        type: "spawn_requested",
      }),
    /fixtureOnly is not allowed/,
  );
  const descriptor = await sourceDescriptor();
  assert.throws(
    () => assertSourceArtifactDescriptor({ ...descriptor, channel: "must stay behind the adapter" }),
    /channel is not allowed/,
  );
});

test("production projection rejects a gapped journal before projecting evidence", async () => {
  const runtime = await harness();
  try {
    const first = (await runtime.ledger.events())[0];
    const gapped = { ...first, seq: 2, eventId: "event:runtime-test:2" };
    assert.throws(
      () => applyRuntimeEvent(initialRuntimeProjection("runtime-test"), gapped),
      /sequence expected 1, received 2/,
    );
  } finally {
    await cleanup(runtime);
  }
});

test("scheduler derives one owner atomically for duplicate concurrent requests", async () => {
  const runtime = await harness();
  try {
    const input = childInput(runtime);
    const decisions = await Promise.all([
      runtime.scheduler.requestSpawn(runtime.rootTaskId, runtime.rootAgentId, input),
      runtime.scheduler.requestSpawn(runtime.rootTaskId, runtime.rootAgentId, input),
    ]);
    assert.equal(decisions.filter((decision) => decision.accepted).length, 1);
    assert.deepEqual(
      decisions.filter((decision) => !decision.accepted).map((decision) => decision.rejection),
      ["duplicate_owner"],
    );
    const accepted = decisions.find((decision) => decision.accepted)!;
    const task = runtime.ledger.state().tasks[accepted.permit!.taskId];
    const parent = runtime.ledger.state().tasks[runtime.rootTaskId];
    assert.equal(task.depth, parent.depth + 1);
    assert.equal(task.parentTaskId, parent.id);
    assert.equal(task.parentAgentId, parent.ownerAgentId);
    assert.equal(task.ownerAgentId, null);
    assert.deepEqual(
      task.grants.map((grant) => grant.capability).sort(),
      ["media.extract", "report.submit"],
    );
  } finally {
    await cleanup(runtime);
  }
});

test("scheduler fails closed on each bounded spawn policy", async (suite) => {
  const cases: Array<{
    name: string;
    limits?: RuntimeLimits;
    mutate?: (input: SpawnRequestInput) => void;
    expected: string;
  }> = [
    {
      name: "maximum depth",
      limits: { ...BASE_LIMITS, maxDepth: 0 },
      expected: "max_depth",
    },
    {
      name: "maximum active workers",
      limits: { ...BASE_LIMITS, maxActiveWorkers: 1 },
      expected: "max_active_workers",
    },
    {
      name: "required output",
      mutate: (input) => {
        input.requiredOutputs = [];
      },
      expected: "missing_output_contract",
    },
    {
      name: "completed dependency",
      mutate: (input) => {
        input.dependencies = ["task:missing"];
      },
      expected: "dependency_unavailable",
    },
    {
      name: "contained scope",
      mutate: (input) => {
        input.mediaScope[0].endMs = 48_000;
      },
      expected: "scope_violation",
    },
    {
      name: "run allocation budget",
      mutate: (input) => {
        input.budget = { wallMs: 130_000, toolCalls: 23 };
      },
      expected: "run_budget",
    },
    {
      name: "grantable capability",
      limits: {
        ...BASE_LIMITS,
        grantableCapabilities: ["task.spawn.request", "report.submit"],
      },
      expected: "capability_not_grantable",
    },
  ];

  for (const scenario of cases) {
    await suite.test(scenario.name, async () => {
      const runtime = await harness(scenario.limits);
      try {
        const input = childInput(runtime);
        scenario.mutate?.(input);
        const decision = await runtime.scheduler.requestSpawn(runtime.rootTaskId, runtime.rootAgentId, input);
        assert.equal(decision.accepted, false);
        assert.equal(decision.rejection, scenario.expected);
        assert.equal(decision.permit, null);
      } finally {
        await cleanup(runtime);
      }
    });
  }
});

test("capability host performs a real authorized ffmpeg extraction with receipted lineage", async () => {
  const runtime = await harness(BASE_LIMITS, "file");
  try {
    const decision = await runtime.scheduler.requestSpawn(
      runtime.rootTaskId,
      runtime.rootAgentId,
      childInput(runtime),
    );
    assert.equal(decision.accepted, true);
    const permit = decision.permit!;
    await runtime.scheduler.registerAgent(permit);
    await runtime.scheduler.transitionTask(permit.taskId, permit.agentId, "working");
    const host = new FfmpegCapabilityHost(runtime.ledger, runtime.store, { timeoutMs: 20_000 });

    const beforeUnauthorized = (await runtime.ledger.events()).length;
    await assert.rejects(
      host.extract({
        operationId: "operation:caller-path",
        taskId: permit.taskId,
        agentId: permit.agentId,
        artifactId: runtime.sourceArtifactId,
        trackId: "stream:0",
        startMs: 1_000,
        endMs: 1_800,
        outputPath: "/tmp/caller-controlled.wav",
      }),
      /outputPath is not allowed/,
    );
    await assert.rejects(
      host.extract({
        operationId: "operation:outside-scope",
        taskId: permit.taskId,
        agentId: permit.agentId,
        artifactId: runtime.sourceArtifactId,
        trackId: "stream:0",
        startMs: 900,
        endMs: 1_800,
      }),
      /outside the task's authoritative capability grant/,
    );
    assert.equal((await runtime.ledger.events()).length, beforeUnauthorized);

    const result = await host.extract({
      operationId: "operation:authorized-extract",
      taskId: permit.taskId,
      agentId: permit.agentId,
      artifactId: runtime.sourceArtifactId,
      trackId: "stream:0",
      startMs: 1_000,
      endMs: 1_800,
    });
    assert.equal(result.artifact.mediaClass, "derived");
    assert.equal(result.artifact.publication, "public");
    assert.deepEqual(result.artifact.sourceArtifactIds, [runtime.sourceArtifactId]);
    assert.equal(result.artifact.origin.kind, "media_operation");
    assert.equal(result.receipt.request.endMs, 1_800);
    assert.equal(result.receipt.output.artifactId, result.artifact.id);
    assert.match(result.receipt.producer.version, /^ffmpeg version /);
    assert.ok(Math.abs(result.receipt.output.durationMs - 800) <= 80);

    const storedPath = join(runtime.storeRoot, result.artifact.storageKey);
    const measured = await identifyFile(storedPath);
    assert.equal(measured.contentId, result.artifact.content.contentId);
    assert.equal(measured.bytes, result.artifact.content.bytes);
    const receiptBytes = await runtime.store.receiptBytes(
      result.artifact.origin.kind === "media_operation" ? result.artifact.origin.receiptContentId : "",
    );
    const storedReceipt = JSON.parse(receiptBytes.toString("utf8")) as { receiptId: string };
    assert.equal(storedReceipt.receiptId, result.receipt.receiptId);

    assert.equal(runtime.ledger.state().operations["operation:authorized-extract"].status, "completed");
    assert.equal(runtime.ledger.state().operations["operation:authorized-extract"].outputArtifactId, result.artifact.id);
    const beforeBudgetRejection = (await runtime.ledger.events()).length;
    await assert.rejects(
      host.extract({
        operationId: "operation:over-tool-budget",
        taskId: permit.taskId,
        agentId: permit.agentId,
        artifactId: runtime.sourceArtifactId,
        trackId: "stream:0",
        startMs: 1_000,
        endMs: 1_800,
      }),
      /tool-call budget/,
    );
    assert.equal((await runtime.ledger.events()).length, beforeBudgetRejection);
    const reports = new BoundedReportHost(runtime.ledger, () => "report:authorized-extract");
    const beforeForeignOutput = (await runtime.ledger.events()).length;
    await assert.rejects(
      reports.submit({
        taskId: permit.taskId,
        agentId: permit.agentId,
        outputArtifactIds: [runtime.sourceArtifactId],
        summary: "This raw source belongs to ingest, not the child.",
      }),
      /must be produced by the submitting task/,
    );
    assert.equal((await runtime.ledger.events()).length, beforeForeignOutput);
    const report = await reports.submit({
      taskId: permit.taskId,
      agentId: permit.agentId,
      outputArtifactIds: [result.artifact.id],
      summary: "The authorized range was extracted and its content-addressed receipt was recorded.",
    });
    await assert.rejects(
      reports.decide({
        reportId: report.id,
        decidedByTaskId: permit.taskId,
        decidedByAgentId: permit.agentId,
        accepted: true,
        reason: "A child cannot accept its own report.",
      }),
      /Only the working parent task owner/,
    );
    await reports.decide({
      reportId: report.id,
      decidedByTaskId: runtime.rootTaskId,
      decidedByAgentId: runtime.rootAgentId,
      accepted: true,
      reason: "The required artifact, lineage, and operation receipt are present.",
    });
    const state = runtime.ledger.state();
    assert.equal(state.reports[report.id].status, "accepted");
    assert.equal(state.tasks[permit.taskId].status, "completed");
    assert.equal(state.agents[permit.agentId].status, "retired");
    const events = await runtime.ledger.events();
    assert.equal(
      events.find(
        (event) =>
          event.type === "artifact.recorded" && event.data.artifact.id === result.artifact.id,
      )?.producer.kind,
      "artifact_store",
    );
    assert.equal(events.find((event) => event.type === "report.submitted")?.producer.kind, "handoff_host");
    const reopened = await RuntimeLedger.open("runtime-test", runtime.journal, {
      now: () => new Date("2026-07-14T03:00:00.000Z"),
    });
    assert.deepEqual(reopened.state(), state);
  } finally {
    await cleanup(runtime);
  }
});

test("capability host rehashes source bytes and records tool failure without an artifact", async () => {
  const runtime = await harness();
  try {
    const decision = await runtime.scheduler.requestSpawn(
      runtime.rootTaskId,
      runtime.rootAgentId,
      childInput(runtime),
    );
    const permit = decision.permit!;
    await runtime.scheduler.registerAgent(permit);
    await runtime.scheduler.transitionTask(permit.taskId, permit.agentId, "working");
    const source = runtime.ledger.state().artifacts[runtime.sourceArtifactId];
    await appendFile(join(runtime.storeRoot, source.storageKey), "tampered");
    const host = new FfmpegCapabilityHost(runtime.ledger, runtime.store);
    const artifactCount = Object.keys(runtime.ledger.state().artifacts).length;
    await assert.rejects(
      host.extract({
        operationId: "operation:tampered-source",
        taskId: permit.taskId,
        agentId: permit.agentId,
        artifactId: runtime.sourceArtifactId,
        trackId: "stream:0",
        startMs: 1_000,
        endMs: 1_800,
      }),
      /no longer matches its registered content identity/,
    );
    const state = runtime.ledger.state();
    assert.equal(state.operations["operation:tampered-source"].status, "failed");
    assert.equal(state.operations["operation:tampered-source"].failure, "ffmpeg range extraction failed");
    assert.equal(Object.keys(state.artifacts).length, artifactCount);
  } finally {
    await cleanup(runtime);
  }
});

test("invalid registration permit and non-working media caller fail closed", async () => {
  const runtime = await harness();
  try {
    const decision = await runtime.scheduler.requestSpawn(
      runtime.rootTaskId,
      runtime.rootAgentId,
      childInput(runtime),
    );
    await assert.rejects(
      runtime.scheduler.registerAgent({ ...decision.permit!, registrationSecret: "wrong" }),
      /permit is missing or invalid/,
    );
    const permit = decision.permit!;
    await runtime.scheduler.registerAgent(permit);
    const host = new FfmpegCapabilityHost(runtime.ledger, runtime.store);
    await assert.rejects(
      host.extract({
        operationId: "operation:not-working",
        taskId: permit.taskId,
        agentId: permit.agentId,
        artifactId: runtime.sourceArtifactId,
        trackId: "stream:0",
        startMs: 1_000,
        endMs: 1_800,
      }),
      /requires a working task/,
    );
  } finally {
    await cleanup(runtime);
  }
});
