import assert from "node:assert/strict";
import { appendFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import {
  assertRuntimeEvent,
  assertSourceArtifactDescriptor,
} from "../src/studio/runtime/production/assertions.ts";
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
import { CodexExecWorkerLauncher } from "../src/studio/runtime/production/launcher.ts";
import { buildRuntimeObservabilityIndex } from "../src/studio/runtime/production/observability/indexer.ts";
import { ImmutableObservabilityQueryStore } from "../src/studio/runtime/production/observability/query.ts";
import {
  assertRuntimeObservabilityIndex,
  validateRuntimeObservabilityIndex,
} from "../src/studio/runtime/production/observability/validation.ts";
import { BoundedReportHost } from "../src/studio/runtime/production/study/reportHost.ts";
import { RootOutputDispositionHost } from "../src/studio/runtime/production/rootOutputDispositionHost.ts";
import {
  applyRuntimeEvent,
  initialRuntimeProjection,
  projectRuntimeEvents,
} from "../src/studio/runtime/production/projection.ts";
import { projectProductionRuntimeJournal } from "../src/studio/runtime/production/studioProjection.ts";
import type {
  RuntimeLimits,
  SourceArtifactDescriptor,
  SpawnRequestInput,
} from "../src/studio/runtime/production/model.ts";
import {
  BoundedRuntimeScheduler,
  type RuntimeIdentityFactory,
} from "../src/studio/runtime/production/scheduler.ts";
import { runtimeTestJobContext } from "./runtime-test-job-context.ts";

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
  grantableCapabilities: ["task.spawn.request", "report.submit", "media.extract", "media.seek"],
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
  }, runtimeTestJobContext({
    source: sourceArtifact,
    range: { startMs: 0, endMs: sourceArtifact.durationMs! },
  }));
  await scheduler.claimTaskLaunch(rootPermit, "deterministic_test", "2026-07-14T03:00:00.000Z");
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

function seekChildInput(runtime: RuntimeHarness): SpawnRequestInput {
  return {
    workloadKey: "seek:source:1000-1800",
    objective: "Seek and decode only the authorized audio range, then return its receipted observation.",
    workerKind: "media",
    workerLabel: "bounded-seek-worker",
    mediaScope: [
      { artifactId: runtime.sourceArtifactId, trackId: "stream:0", startMs: 1_000, endMs: 1_800 },
    ],
    inputArtifactIds: [runtime.sourceArtifactId],
    requiredOutputs: [{ name: "audio activity observation", artifactKind: "media-audio-activity-observation", required: true }],
    requiredCapabilities: ["media.seek", "report.submit"],
    dependencies: [],
    budget: { wallMs: 20_000, toolCalls: 1 },
  };
}

function codexChildInput(runtime: RuntimeHarness): SpawnRequestInput {
  return {
    workloadKey: "worker:bounded-report",
    objective: "Return an honest acknowledgement of this bounded child contract without making media claims.",
    workerKind: "analysis",
    workerLabel: "bounded-local-worker",
    mediaScope: [],
    inputArtifactIds: [runtime.sourceArtifactId],
    requiredOutputs: [{ name: "execution report", artifactKind: "worker-execution-report", required: true }],
    requiredCapabilities: ["report.submit"],
    dependencies: [],
    budget: { wallMs: 10_000, toolCalls: 1 },
  };
}

async function fakeCodex(runtime: RuntimeHarness, mode = "valid"): Promise<{ executable: string; prefix: string[] }> {
  const path = join(runtime.directory, `fake-codex-${mode}.mjs`);
  await writeFile(
    path,
    `
import { readFile } from "node:fs/promises";

const mode = ${JSON.stringify(mode)};
const args = process.argv.slice(2);
if (args[0] === "--version") {
  process.stdout.write("codex-cli test-1.0.0\\n");
  process.exit(0);
}
const required = ["exec", "--json", "--ephemeral", "--ignore-user-config", "--ignore-rules", "--sandbox", "read-only", "--skip-git-repo-check", "-c", "shell_environment_policy.inherit=none", "--output-schema"];
for (const value of required) {
  if (!args.includes(value)) throw new Error("missing fixed launcher argument " + value);
}
if (args.at(-1) !== "-") throw new Error("worker prompt must arrive on stdin");
let prompt = "";
for await (const chunk of process.stdin) prompt += chunk;
const mediaTask = prompt.includes("scheduler-granted media tools: media_seek");
if ((!mediaTask && !prompt.includes("exposes no media bytes")) || !prompt.includes("bounded task contract")) {
  throw new Error("bounded prompt was not supplied");
}
let mediaResult = null;
if (mediaTask) {
  const configs = args.flatMap((value, index) => value === "-c" ? [args[index + 1]] : []);
  const requiredMediaConfig = [
    "mcp_servers.studio_media.command=",
    "mcp_servers.studio_media.args=",
    "mcp_servers.studio_media.required=true",
    "mcp_servers.studio_media.enabled_tools=[\\\"media_seek\\\"]",
    "mcp_servers.studio_media.env_vars=",
  ];
  for (const value of requiredMediaConfig) {
    if (!configs.some((config) => config.startsWith(value))) throw new Error("missing media bridge config " + value);
  }
  if (!process.env.STUDIO_CHILD_MEDIA_BRIDGE_URL || !process.env.STUDIO_CHILD_MEDIA_BRIDGE_TOKEN) {
    throw new Error("missing media bridge environment");
  }
  if (mode === "media-seek") {
    const contract = JSON.parse(prompt.split("\\n\\n").at(-1));
    const response = await fetch(process.env.STUDIO_CHILD_MEDIA_BRIDGE_URL + "/v1/call", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + process.env.STUDIO_CHILD_MEDIA_BRIDGE_TOKEN,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name: "media_seek", arguments: contract.mediaScope[0] }),
    });
    const body = await response.json();
    if (!response.ok || body.ok !== true) throw new Error("media bridge call failed");
    mediaResult = body.result;
  }
}
if (mode === "hang") await new Promise((resolve) => setTimeout(resolve, 60_000));
if (mode === "process-failed") {
  process.stderr.write("worker process crashed before completion\\n");
  process.exit(2);
}
const schemaPath = args[args.indexOf("--output-schema") + 1];
const schema = JSON.parse(await readFile(schemaPath, "utf8"));
const name = schema.properties.outputs.items.properties.name.enum[0];
const kind = schema.properties.outputs.items.properties.kind.enum[0];
const output = {
  summary: mediaResult
    ? "The isolated child completed one receipted seek without a media-content claim."
    : "The isolated child completed its bounded acknowledgement and made no media claim.",
  outputs: [{
    name,
    kind,
    content: mediaResult
      ? "Completed " + mediaResult.operationId + "; artifact " + mediaResult.outputArtifactId + "; receipt " + mediaResult.receiptId + "; receipt content " + mediaResult.receiptContentId + "."
      : "Bounded worker execution acknowledged; no media-content finding was made.",
  }],
};
if (mode === "open-output") output.unreceipted = true;
const events = [
  { type: "thread.started", thread_id: "thread:test" },
  { type: "turn.started" },
  { type: "item.completed", item: { id: "item:test", type: "agent_message", text: JSON.stringify(output) } },
  { type: "turn.completed", provider_request_id: "raw-provider-receipt-test", usage: {
    input_tokens: 120,
    cached_input_tokens: mode === "bad-usage" ? 121 : 20,
    output_tokens: 35,
    reasoning_output_tokens: 5,
  } },
];
process.stdout.write(events.map((event) => JSON.stringify(event)).join("\\n") + "\\n");
`,
    { encoding: "utf8", mode: 0o600, flag: "wx" },
  );
  return { executable: process.execPath, prefix: [path] };
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
    await assert.rejects(
      buildRuntimeObservabilityIndex(`${JSON.stringify(gapped)}\n`),
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

test("scheduler issues media.seek only when the capability is grantable", async () => {
  const runtime = await harness({
    ...BASE_LIMITS,
    grantableCapabilities: ["task.spawn.request", "report.submit", "media.extract"],
  });
  try {
    const decision = await runtime.scheduler.requestSpawn(
      runtime.rootTaskId,
      runtime.rootAgentId,
      seekChildInput(runtime),
    );
    assert.equal(decision.accepted, false);
    assert.equal(decision.rejection, "capability_not_grantable");
    assert.equal(decision.permit, null);

    const unsupported = {
      ...seekChildInput(runtime),
      requiredCapabilities: ["media.frame"],
    };
    await assert.rejects(
      runtime.scheduler.requestSpawn(runtime.rootTaskId, runtime.rootAgentId, unsupported),
      /has unknown value media.frame/,
    );
  } finally {
    await cleanup(runtime);
  }
});

test("scheduler rejects capabilities that do not belong to the requested child role", async () => {
  const runtime = await harness({
    ...BASE_LIMITS,
    grantableCapabilities: [
      ...BASE_LIMITS.grantableCapabilities,
      "analysis.evidence.assess",
    ],
  });
  try {
    const input = childInput(runtime);
    input.requiredCapabilities = ["analysis.evidence.assess", "report.submit"];
    const decision = await runtime.scheduler.requestSpawn(
      runtime.rootTaskId,
      runtime.rootAgentId,
      input,
    );
    assert.equal(decision.accepted, false);
    assert.equal(decision.rejection, "capability_not_grantable");
    assert.equal(decision.permit, null);
    const events = await runtime.ledger.events();
    const requested = events.find((event) =>
      event.type === "spawn.requested" && event.data.requestId === decision.requestId);
    const denied = events.find((event) =>
      event.type === "spawn.decided" && event.data.requestId === decision.requestId);
    assert.ok(requested?.type === "spawn.requested");
    assert.ok(denied?.type === "spawn.decided");
    assert.equal(denied.data.accepted, false);
    assert.deepEqual(denied.data.grants, []);
  } finally {
    await cleanup(runtime);
  }
});

test("Codex launcher registers a bounded child, receipts active time and measured usage, then reports up", async () => {
  const runtime = await harness(BASE_LIMITS, "file");
  try {
    const decision = await runtime.scheduler.requestSpawn(
      runtime.rootTaskId,
      runtime.rootAgentId,
      codexChildInput(runtime),
    );
    assert.equal(decision.accepted, true);
    const fake = await fakeCodex(runtime);
    const reports = new BoundedReportHost(runtime.ledger, () => "report:codex-worker");
    const times = [
      new Date("2026-07-14T12:00:00.000Z"),
      new Date("2026-07-14T12:00:00.045Z"),
    ];
    const monotonic = [1_000, 1_045];
    const launcher = new CodexExecWorkerLauncher(runtime.ledger, runtime.scheduler, runtime.store, reports, {
      executable: fake.executable,
      executableArgsPrefix: fake.prefix,
      now: () => times.shift() ?? new Date("2026-07-14T12:00:00.045Z"),
      monotonicNow: () => monotonic.shift() ?? 1_045,
      nextExecutionId: () => "execution:codex-worker",
      maximumWallMs: 5_000,
    });

    const result = await launcher.launch(decision.permit!);
    assert.equal(result.execution.outcome, "completed");
    assert.equal(result.execution.monotonicDurationMs, 45);
    assert.equal(result.execution.process.exitCode, 0);
    assert.equal(result.usage.measured.inputTokens, 120);
    assert.equal(result.usage.measured.cachedInputTokens, 20);
    assert.equal(result.usage.measured.outputTokens, 35);
    assert.equal(result.usage.measured.reasoningOutputTokens, 5);
    assert.equal(result.usage.model, null);
    assert.equal(result.usage.providerUnits, null);
    assert.deepEqual(result.usage.billing, { amount: null, currency: null });
    assert.equal(result.artifacts.length, 1);
    assert.equal(result.artifacts[0].kind, "worker-execution-report");
    assert.equal(result.artifacts[0].mediaClass, "non_media");
    assert.equal(result.artifacts[0].origin.kind, "worker_output");
    assert.equal(result.report.status, "submitted");

    const rawUsage = JSON.parse(
      (await runtime.store.receiptBytes(result.usage.rawReceipt.contentId)).toString("utf8"),
    ) as { provider_request_id: string };
    assert.equal(rawUsage.provider_request_id, "raw-provider-receipt-test");

    await reports.decide({
      reportId: result.report.id,
      decidedByTaskId: runtime.rootTaskId,
      decidedByAgentId: runtime.rootAgentId,
      accepted: true,
      reason: "The child returned its required structured output and made no unsupported media claim.",
    });
    const dispositions = new RootOutputDispositionHost(runtime.ledger, runtime.store);
    await assert.rejects(
      dispositions.record({
        reportId: result.report.id,
        rootTaskId: runtime.rootTaskId,
        rootAgentId: runtime.rootAgentId,
        outputArtifactId: runtime.sourceArtifactId,
        outcome: "promoted_to_root",
        reason: "This must fail because the source was not the reported child output.",
      }),
      /outside the decided report/,
    );
    const disposition = await dispositions.record({
      reportId: result.report.id,
      rootTaskId: runtime.rootTaskId,
      rootAgentId: runtime.rootAgentId,
      outputArtifactId: result.artifacts[0].id,
      outcome: "promoted_to_root",
      reason: "The root selected the exact accepted child output and retained its delegation lineage.",
    });
    const state = runtime.ledger.state();
    assert.equal(state.executions["execution:codex-worker"].status, "completed");
    assert.equal(state.tasks[decision.permit!.taskId].status, "completed");
    assert.equal(state.agents[decision.permit!.agentId].status, "retired");
    assert.equal(Object.keys(state.rootOutputDispositions).length, 1);
    assert.deepEqual(state.rootOutputDispositions[disposition.receipt.dispositionId], {
      id: disposition.receipt.dispositionId,
      reportId: result.report.id,
      spawnRequestId: decision.requestId,
      rootTaskId: runtime.rootTaskId,
      rootAgentId: runtime.rootAgentId,
      childTaskId: decision.permit!.taskId,
      childAgentId: decision.permit!.agentId,
      inputArtifactId: result.artifacts[0].id,
      outputArtifactId: disposition.outputArtifactId,
      outcome: "promoted_to_root",
      receiptId: disposition.receipt.receiptId,
      receiptContentId: disposition.receiptContentId,
    });
    assert.deepEqual(disposition.receipt.delegation.grants, state.tasks[decision.permit!.taskId].grants);
    assert.deepEqual(disposition.receipt.delegation.mediaScope, state.tasks[decision.permit!.taskId].mediaScope);
    assert.equal(disposition.receipt.input.contentId, result.artifacts[0].content.contentId);
    assert.deepEqual(
      JSON.parse((await runtime.store.receiptBytes(disposition.receiptContentId)).toString("utf8")),
      disposition.receipt,
    );

    const events = await runtime.ledger.events();
    assert.ok(events.some((event) => event.type === "executor.started" && event.producer.kind === "launcher"));
    assert.ok(events.some((event) => event.type === "model.usage_recorded" && event.producer.kind === "launcher"));
    assert.ok(events.some((event) => event.type === "executor.finished" && event.producer.kind === "launcher"));
    assert.ok(events.some((event) => event.type === "root.output_disposition_recorded" && event.producer.kind === "handoff_host"));
    assert.ok(events.every((event) => !("fixtureOnly" in event)));

    const rawJournal = await readFile(join(runtime.directory, "events.ndjson"), "utf8");
    const observability = await buildRuntimeObservabilityIndex(rawJournal);
    const rebuilt = await buildRuntimeObservabilityIndex(rawJournal);
    assert.deepEqual(rebuilt, observability);
    assert.equal((await validateRuntimeObservabilityIndex(observability)).indexId, observability.indexId);
    assert.equal(observability.sourceJournal.runId, "runtime-test");
    assert.equal(observability.sourceJournal.eventCount, events.length);
    assert.equal(observability.summary.counts.tasks, 2);
    assert.equal(observability.summary.counts.agents, 2);
    assert.equal(observability.summary.counts.executions, 1);
    assert.equal(observability.summary.counts.handoffs, 1);
    assert.equal(observability.summary.measured.activeDurationMs, 45);
    assert.equal(observability.summary.measured.inputTokens, 120);
    assert.equal(observability.summary.measured.outputTokens, 35);
    assert.equal(observability.summary.unavailable.queueDurationMs, null);
    assert.equal(observability.summary.unavailable.providerUnits, null);
    assert.deepEqual(observability.summary.unavailable.billing, { amount: null, currency: null });
    assert.ok(
      observability.sources.receipts.some(
        (source) =>
          source.kind === "model_usage" &&
          source.rawReceiptContentId === result.usage.rawReceipt.contentId,
      ),
    );
    assert.equal(JSON.stringify(observability).includes(codexChildInput(runtime).objective), false);

    const query = new ImmutableObservabilityQueryStore([observability]).query({
      agentIds: [decision.permit!.agentId],
      taskStatuses: ["completed"],
    });
    assert.equal(query.records.tasks.length, 1);
    assert.equal(query.records.executions.length, 1);
    assert.equal(query.records.handoffs.length, 1);
    assert.equal(query.aggregate.measured.inputTokens, 120);
    assert.ok(query.records.executions[0].sources.receiptIds.includes(result.usage.receiptId));

    const inventedAccuracy = structuredClone(observability) as unknown as {
      summary: { measured: Record<string, unknown> };
    };
    inventedAccuracy.summary.measured.accuracy = 1;
    assert.throws(
      () => assertRuntimeObservabilityIndex(inventedAccuracy),
      /summary does not equal the aggregation of indexed measured facts/,
    );
    const inventedRank = structuredClone(observability) as unknown as {
      records: { executions: Array<Record<string, unknown>> };
    };
    inventedRank.records.executions[0].rank = 1;
    assert.throws(() => assertRuntimeObservabilityIndex(inventedRank), /rank is not allowed/);
    const inventedProviderUnits = structuredClone(observability);
    (inventedProviderUnits.records.executions[0] as unknown as { providerUnits: number }).providerUnits = 0;
    assert.throws(
      () => assertRuntimeObservabilityIndex(inventedProviderUnits),
      /providerUnits must remain null without a producer/,
    );

    const usageEvent = events.find((event) => event.type === "model.usage_recorded");
    assert.ok(usageEvent);
    const inventedBilling = structuredClone(usageEvent) as unknown as {
      data: { receipt: { billing: { amount: number | null } } };
    };
    inventedBilling.data.receipt.billing.amount = 0;
    assert.throws(() => assertRuntimeEvent(inventedBilling), /must remain null without a billing producer/);
    const escapedRawReceipt = structuredClone(usageEvent) as unknown as {
      data: { receipt: { rawReceipt: { storageKey: string } } };
    };
    escapedRawReceipt.data.receipt.rawReceipt.storageKey = "../usage.json";
    assert.throws(() => assertRuntimeEvent(escapedRawReceipt), /must be a relative contained key/);

    const spanEvent = events.find((event) => event.type === "executor.finished");
    assert.ok(spanEvent);
    const inventedQueueSpan = structuredClone(spanEvent) as unknown as {
      data: { receipt: Record<string, unknown> };
    };
    inventedQueueSpan.data.receipt.queueDurationMs = 1;
    assert.throws(() => assertRuntimeEvent(inventedQueueSpan), /queueDurationMs is not allowed/);

    const studio = projectProductionRuntimeJournal(events);
    assert.equal(studio.source.kind, "production_runtime_journal");
    assert.equal(studio.source.recordedDemo, false);
    const child = studio.workers.find((worker) => worker.agentId === decision.permit!.agentId)!;
    assert.equal(child.label, "bounded-local-worker");
    assert.equal(child.objective, codexChildInput(runtime).objective);
    assert.deepEqual(child.capabilities, ["report.submit"]);
    assert.equal(child.execution?.activeDurationMs, 45);
    assert.equal(child.execution?.usage?.inputTokens, 120);
    assert.equal(child.execution?.usage?.billedAmount, null);
    assert.equal(child.report?.status, "accepted");

    const reopened = await RuntimeLedger.open("runtime-test", runtime.journal);
    assert.deepEqual(reopened.state(), state);
  } finally {
    await cleanup(runtime);
  }
});

test("root rejects a child report with a content-addressed disposition and refuses premature or contradictory promotion", async () => {
  const runtime = await harness();
  try {
    const decision = await runtime.scheduler.requestSpawn(
      runtime.rootTaskId,
      runtime.rootAgentId,
      codexChildInput(runtime),
    );
    assert.ok(decision.permit);
    const fake = await fakeCodex(runtime);
    const reports = new BoundedReportHost(runtime.ledger, () => "report:root-rejection");
    const launcher = new CodexExecWorkerLauncher(
      runtime.ledger,
      runtime.scheduler,
      runtime.store,
      reports,
      {
        executable: fake.executable,
        executableArgsPrefix: fake.prefix,
        nextExecutionId: () => "execution:root-rejection",
        maximumWallMs: 5_000,
      },
    );
    const launched = await launcher.launch(decision.permit);
    const dispositions = new RootOutputDispositionHost(runtime.ledger, runtime.store);
    const promotionRequest = {
      reportId: launched.report.id,
      rootTaskId: runtime.rootTaskId,
      rootAgentId: runtime.rootAgentId,
      outputArtifactId: launched.artifacts[0].id,
      outcome: "promoted_to_root" as const,
      reason: "Premature promotion must fail.",
    };
    await assert.rejects(
      dispositions.record(promotionRequest),
      /matching decided child report/,
    );
    await reports.decide({
      reportId: launched.report.id,
      decidedByTaskId: runtime.rootTaskId,
      decidedByAgentId: runtime.rootAgentId,
      accepted: false,
      reason: "The root rejected this bounded child output for the deterministic rejection path.",
    });
    await assert.rejects(
      dispositions.record(promotionRequest),
      /matching decided child report/,
    );
    const rejected = await dispositions.record({
      ...promotionRequest,
      outcome: "rejected_by_root",
      reason: "The exact reported output was rejected and was not promoted into root-owned work.",
    });
    assert.equal(rejected.receipt.decision.outcome, "rejected_by_root");
    assert.equal(rejected.receipt.input.artifactId, launched.artifacts[0].id);
    assert.equal(runtime.ledger.state().reports[launched.report.id].status, "rejected");
    assert.equal(runtime.ledger.state().tasks[decision.permit.taskId].status, "working");
    assert.equal(
      runtime.ledger.state().rootOutputDispositions[rejected.receipt.dispositionId].outcome,
      "rejected_by_root",
    );
    await assert.rejects(
      dispositions.record({
        ...promotionRequest,
        outcome: "rejected_by_root",
        reason: "A second disposition must fail.",
      }),
      /already exists/,
    );
  } finally {
    await cleanup(runtime);
  }
});

test("Codex launcher binds a scheduler-granted media.seek child to the real receipted bridge", async () => {
  const runtime = await harness(BASE_LIMITS, "file");
  try {
    const decision = await runtime.scheduler.requestSpawn(
      runtime.rootTaskId,
      runtime.rootAgentId,
      seekChildInput(runtime),
    );
    assert.ok(decision.permit);
    const fake = await fakeCodex(runtime, "media-seek");
    const launcher = new CodexExecWorkerLauncher(
      runtime.ledger,
      runtime.scheduler,
      runtime.store,
      new BoundedReportHost(runtime.ledger, () => "report:codex-media-seek"),
      {
        executable: fake.executable,
        executableArgsPrefix: fake.prefix,
        nextExecutionId: () => "execution:codex-media-seek",
        nextMediaOperationId: () => "operation:codex-child-media-seek",
        maximumWallMs: 5_000,
      },
    );

    const result = await launcher.launch(decision.permit);
    assert.equal(result.execution.outcome, "completed");
    assert.equal(result.report.status, "submitted");
    const state = runtime.ledger.state();
    assert.equal(state.operations["operation:codex-child-media-seek"].status, "completed");
    assert.equal(state.operations["operation:codex-child-media-seek"].capability, "media.seek");
    const operationArtifact = state.artifacts[state.operations["operation:codex-child-media-seek"].outputArtifactId!];
    assert.equal(operationArtifact.origin.kind, "media_observation");
    const workerBytes = await runtime.store.receiptBytes(result.artifacts[0].content.contentId);
    const workerEnvelope = JSON.parse(workerBytes.toString("utf8")) as { output: { content: string } };
    assert.match(workerEnvelope.output.content, /operation:codex-child-media-seek/);
    assert.match(workerEnvelope.output.content, /receipt:/);
    const studio = projectProductionRuntimeJournal(await runtime.ledger.events());
    assert.equal(studio.operations.length, 1);
    assert.equal(studio.operations[0].status, "completed");
  } finally {
    await cleanup(runtime);
  }
});

test("Codex media grant fails closed when the child returns without invoking its required tool", async () => {
  const runtime = await harness();
  try {
    const decision = await runtime.scheduler.requestSpawn(
      runtime.rootTaskId,
      runtime.rootAgentId,
      seekChildInput(runtime),
    );
    assert.ok(decision.permit);
    const fake = await fakeCodex(runtime, "media-skip");
    const launcher = new CodexExecWorkerLauncher(
      runtime.ledger,
      runtime.scheduler,
      runtime.store,
      new BoundedReportHost(runtime.ledger),
      {
        executable: fake.executable,
        executableArgsPrefix: fake.prefix,
        nextExecutionId: () => "execution:codex-media-skip",
      },
    );
    await assert.rejects(launcher.launch(decision.permit), /did not complete every granted media capability/);
    const state = runtime.ledger.state();
    assert.equal(state.tasks[decision.permit.taskId].status, "failed");
    assert.equal(state.executions["execution:codex-media-skip"].status, "failed");
    assert.equal(Object.values(state.executorFailureClassifications)[0].code, "required_tool_omitted");
    assert.equal(Object.values(state.executorFailureClassifications)[0].retryability, "replaceable");
    assert.equal(Object.keys(state.operations).length, 0);
  } finally {
    await cleanup(runtime);
  }
});

test("Codex launcher fails closed on unsupported capabilities and invalid child output", async (suite) => {
  await suite.test("unsupported child orchestration capability is rejected by the scheduler before launch", async () => {
    const runtime = await harness();
    try {
      const unsupported = codexChildInput(runtime);
      unsupported.workerKind = "orchestrator";
      unsupported.requiredCapabilities = ["task.spawn.request", "report.submit"];
      const decision = await runtime.scheduler.requestSpawn(
        runtime.rootTaskId,
        runtime.rootAgentId,
        unsupported,
      );
      assert.equal(decision.accepted, false);
      assert.equal(decision.rejection, "capability_not_grantable");
      assert.equal(decision.permit, null);
    } finally {
      await cleanup(runtime);
    }
  });

  await suite.test("open worker response is receipted as a failed execution without a report", async () => {
    const runtime = await harness();
    try {
      const decision = await runtime.scheduler.requestSpawn(
        runtime.rootTaskId,
        runtime.rootAgentId,
        codexChildInput(runtime),
      );
      const fake = await fakeCodex(runtime, "open-output");
      const launcher = new CodexExecWorkerLauncher(
        runtime.ledger,
        runtime.scheduler,
        runtime.store,
        new BoundedReportHost(runtime.ledger),
        {
          executable: fake.executable,
          executableArgsPrefix: fake.prefix,
          nextExecutionId: () => "execution:invalid-output",
        },
      );
      await assert.rejects(launcher.launch(decision.permit!), /must contain only summary and outputs/);
      const state = runtime.ledger.state();
      assert.equal(state.executions["execution:invalid-output"].status, "failed");
      assert.equal(state.executions["execution:invalid-output"].outputArtifactIds.length, 0);
      assert.equal(state.tasks[decision.permit!.taskId].status, "failed");
      assert.equal(Object.keys(state.reports).length, 0);
      assert.ok(state.executions["execution:invalid-output"].modelUsageReceiptId);
      assert.equal(Object.values(state.executorFailureClassifications)[0].code, "invalid_structured_output");
    } finally {
      await cleanup(runtime);
    }
  });

  await suite.test("invalid measured usage produces no usage or output artifact", async () => {
    const runtime = await harness();
    try {
      const decision = await runtime.scheduler.requestSpawn(
        runtime.rootTaskId,
        runtime.rootAgentId,
        codexChildInput(runtime),
      );
      const fake = await fakeCodex(runtime, "bad-usage");
      const launcher = new CodexExecWorkerLauncher(
        runtime.ledger,
        runtime.scheduler,
        runtime.store,
        new BoundedReportHost(runtime.ledger),
        {
          executable: fake.executable,
          executableArgsPrefix: fake.prefix,
          nextExecutionId: () => "execution:bad-usage",
        },
      );
      await assert.rejects(launcher.launch(decision.permit!), /cached input tokens exceed input tokens/);
      const state = runtime.ledger.state();
      assert.equal(state.executions["execution:bad-usage"].status, "failed");
      assert.equal(state.executions["execution:bad-usage"].modelUsageReceiptId, null);
      assert.equal(Object.keys(state.modelUsage).length, 0);
      assert.equal(Object.values(state.artifacts).filter((artifact) => artifact.origin.kind === "worker_output").length, 0);
    } finally {
      await cleanup(runtime);
    }
  });

  await suite.test("wall-time exhaustion terminates the child and records a timed-out span", async () => {
    const runtime = await harness();
    try {
      const decision = await runtime.scheduler.requestSpawn(
        runtime.rootTaskId,
        runtime.rootAgentId,
        codexChildInput(runtime),
      );
      const fake = await fakeCodex(runtime, "hang");
      const launcher = new CodexExecWorkerLauncher(
        runtime.ledger,
        runtime.scheduler,
        runtime.store,
        new BoundedReportHost(runtime.ledger),
        {
          executable: fake.executable,
          executableArgsPrefix: fake.prefix,
          nextExecutionId: () => "execution:timed-out",
          maximumWallMs: 30,
        },
      );
      await assert.rejects(launcher.launch(decision.permit!), /timed out/);
      const execution = runtime.ledger.state().executions["execution:timed-out"];
      assert.equal(execution.status, "timed_out");
      assert.equal(execution.modelUsageReceiptId, null);
      assert.equal(runtime.ledger.state().tasks[decision.permit!.taskId].status, "failed");
      assert.equal(Object.values(runtime.ledger.state().executorFailureClassifications)[0].code, "executor_timed_out");
    } finally {
      await cleanup(runtime);
    }
  });

  await suite.test("child process failure receives a retryable typed classification", async () => {
    const runtime = await harness();
    try {
      const decision = await runtime.scheduler.requestSpawn(
        runtime.rootTaskId,
        runtime.rootAgentId,
        codexChildInput(runtime),
      );
      const fake = await fakeCodex(runtime, "process-failed");
      const launcher = new CodexExecWorkerLauncher(
        runtime.ledger,
        runtime.scheduler,
        runtime.store,
        new BoundedReportHost(runtime.ledger),
        {
          executable: fake.executable,
          executableArgsPrefix: fake.prefix,
          nextExecutionId: () => "execution:process-failed",
        },
      );
      await assert.rejects(launcher.launch(decision.permit!), /exited 2/);
      const classification = Object.values(runtime.ledger.state().executorFailureClassifications)[0];
      assert.equal(classification.code, "process_failed");
      assert.equal(classification.retryability, "replaceable");
    } finally {
      await cleanup(runtime);
    }
  });

  await suite.test("bounded output overflow is terminal and cannot enter replacement policy", async () => {
    const runtime = await harness();
    try {
      const decision = await runtime.scheduler.requestSpawn(
        runtime.rootTaskId,
        runtime.rootAgentId,
        codexChildInput(runtime),
      );
      const fake = await fakeCodex(runtime);
      const launcher = new CodexExecWorkerLauncher(
        runtime.ledger,
        runtime.scheduler,
        runtime.store,
        new BoundedReportHost(runtime.ledger),
        {
          executable: fake.executable,
          executableArgsPrefix: fake.prefix,
          nextExecutionId: () => "execution:output-overflow",
          maxStdoutBytes: 64,
        },
      );
      await assert.rejects(launcher.launch(decision.permit!), /output bounds/);
      const classification = Object.values(runtime.ledger.state().executorFailureClassifications)[0];
      assert.equal(classification.code, "output_limit_exceeded");
      assert.equal(classification.retryability, "terminal");
    } finally {
      await cleanup(runtime);
    }
  });

  assert.throws(
    () => projectProductionRuntimeJournal([{ fixtureOnly: true, type: "spawn_requested" }]),
    /fixtureOnly is not allowed/,
  );
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
    await runtime.scheduler.claimTaskLaunch(permit, "deterministic_test", "2026-07-14T03:00:00.000Z");
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

test("capability host performs a real bounded audio-activity observation with a content-addressed receipt", async () => {
  const runtime = await harness(BASE_LIMITS, "file");
  try {
    const decision = await runtime.scheduler.requestSpawn(
      runtime.rootTaskId,
      runtime.rootAgentId,
      seekChildInput(runtime),
    );
    assert.equal(decision.accepted, true);
    const permit = decision.permit!;
    const task = runtime.ledger.state().tasks[permit.taskId];
    assert.deepEqual(
      task.grants.map((grant) => grant.capability).sort(),
      ["media.seek", "report.submit"],
    );
    await runtime.scheduler.claimTaskLaunch(permit, "deterministic_test", "2026-07-14T03:00:00.000Z");
    await runtime.scheduler.registerAgent(permit);
    await runtime.scheduler.transitionTask(permit.taskId, permit.agentId, "working");
    const host = new FfmpegCapabilityHost(runtime.ledger, runtime.store, { timeoutMs: 20_000 });

    const beforeRejectedCalls = (await runtime.ledger.events()).length;
    await assert.rejects(
      host.seek({
        operationId: "operation:seek-path-escape",
        taskId: permit.taskId,
        agentId: permit.agentId,
        artifactId: runtime.sourceArtifactId,
        trackId: "stream:0",
        startMs: 1_000,
        endMs: 1_800,
        sourcePath: "../caller-controlled.m4a",
      }),
      /sourcePath is not allowed/,
    );
    await assert.rejects(
      host.seek({
        operationId: "operation:malformed-seek",
        taskId: permit.taskId,
        agentId: permit.agentId,
        artifactId: runtime.sourceArtifactId,
        trackId: "stream:0",
        startMs: 1_000,
        endMs: 1_000,
      }),
      /must be a non-empty half-open range/,
    );
    await assert.rejects(
      host.seek({
        operationId: "operation:seek-outside-scope",
        taskId: permit.taskId,
        agentId: permit.agentId,
        artifactId: runtime.sourceArtifactId,
        trackId: "stream:0",
        startMs: 999,
        endMs: 1_800,
      }),
      /outside the task's authoritative capability grant/,
    );
    assert.equal((await runtime.ledger.events()).length, beforeRejectedCalls);

    const result = await host.seek({
      operationId: "operation:authorized-seek",
      taskId: permit.taskId,
      agentId: permit.agentId,
      artifactId: runtime.sourceArtifactId,
      trackId: "stream:0",
      startMs: 1_000,
      endMs: 1_800,
    });
    assert.equal(result.artifact.kind, "media-audio-activity-observation");
    assert.equal(result.artifact.mediaClass, "non_media");
    assert.equal(result.artifact.publication, "private");
    assert.deepEqual(result.artifact.sourceArtifactIds, [runtime.sourceArtifactId]);
    assert.equal(result.artifact.origin.kind, "media_observation");
    assert.equal(result.receipt.capability, "media.seek");
    assert.equal(result.receipt.schema, "studio.media-perception.receipt.v1");
    assert.equal(result.receipt.request.startMs, 1_000);
    assert.equal(result.receipt.request.endMs, 1_800);
    assert.equal(result.receipt.observation.status, "observed");
    assert.ok(result.receipt.observation.decodedDurationUs > 0);
    assert.ok(result.receipt.observation.decodedDurationUs <= 800_000);
    assert.equal(result.receipt.observation.kind, "audio_activity");
    assert.equal(result.receipt.observation.value, "signal");
    assert.deepEqual(result.receipt.observation.range, { startMs: 1_000, endMs: 1_800 });
    assert.equal(result.receipt.observation.measurements.silenceThresholdDb, -60);
    assert.ok(result.receipt.observation.measurements.peakVolumeDb! > -60);
    assert.match(result.receipt.producer.version, /^ffmpeg version /);

    assert.equal(result.artifact.origin.kind, "media_observation");
    const receiptBytes = await runtime.store.receiptBytes(
      result.artifact.origin.kind === "media_observation" ? result.artifact.origin.receiptContentId : "",
    );
    const storedReceipt = JSON.parse(receiptBytes.toString("utf8")) as {
      receiptId: string;
      input: { contentId: string };
    };
    assert.equal(storedReceipt.receiptId, result.receipt.receiptId);
    assert.equal(storedReceipt.input.contentId, result.receipt.input.contentId);
    const measuredReceipt = await identifyFile(join(runtime.storeRoot, result.artifact.storageKey));
    assert.equal(measuredReceipt.contentId, result.artifact.content.contentId);

    const state = runtime.ledger.state();
    assert.equal(state.operations["operation:authorized-seek"].capability, "media.seek");
    assert.equal(state.operations["operation:authorized-seek"].status, "completed");
    assert.equal(state.operations["operation:authorized-seek"].outputArtifactId, result.artifact.id);
    assert.deepEqual(state.operations["operation:authorized-seek"].observation, result.receipt.observation);

    const operationEvents = await runtime.ledger.events();
    const started = operationEvents.find(
      (event) => event.type === "media.operation_started" && event.data.request.operationId === "operation:authorized-seek",
    );
    const completedIndex = operationEvents.findIndex(
      (event) => event.type === "media.operation_completed" && event.data.operationId === "operation:authorized-seek",
    );
    assert.equal(started?.producer.kind, "media_host");
    assert.ok(completedIndex >= 0);
    assert.equal(operationEvents[completedIndex].producer.kind, "media_host");

    const wrongProducer = structuredClone(operationEvents);
    wrongProducer[completedIndex].producer.kind = "artifact_store";
    assert.throws(
      () => projectRuntimeEvents("runtime-test", wrongProducer),
      /media completion evidence must come from the media host/,
    );

    const changedInput = structuredClone(operationEvents);
    const changedInputCompletion = changedInput[completedIndex];
    assert.equal(changedInputCompletion.type, "media.operation_completed");
    if (changedInputCompletion.type === "media.operation_completed") {
      changedInputCompletion.data.receipt.input.contentId = `sha256:${"0".repeat(64)}`;
    }
    assert.throws(
      () => projectRuntimeEvents("runtime-test", changedInput),
      /receipt changed its input lineage/,
    );

    const changedObservation = structuredClone(operationEvents);
    const changedObservationCompletion = changedObservation[completedIndex];
    assert.equal(changedObservationCompletion.type, "media.operation_completed");
    if (
      changedObservationCompletion.type === "media.operation_completed" &&
      changedObservationCompletion.data.receipt.capability === "media.seek"
    ) {
      changedObservationCompletion.data.receipt.observation.value = "digital_silence";
    }
    assert.throws(
      () => projectRuntimeEvents("runtime-test", changedObservation),
      /does not match the receipted peak-volume threshold/,
    );

    const changedArtifact = structuredClone(operationEvents);
    const changedArtifactCompletion = changedArtifact[completedIndex];
    assert.equal(changedArtifactCompletion.type, "media.operation_completed");
    if (changedArtifactCompletion.type === "media.operation_completed") {
      changedArtifactCompletion.data.outputArtifactId = runtime.sourceArtifactId;
    }
    assert.throws(
      () => projectRuntimeEvents("runtime-test", changedArtifact),
      /observation artifact is not bound to its content-addressed receipt/,
    );

    const beforeDuplicate = (await runtime.ledger.events()).length;
    await assert.rejects(
      host.seek({
        operationId: "operation:authorized-seek",
        taskId: permit.taskId,
        agentId: permit.agentId,
        artifactId: runtime.sourceArtifactId,
        trackId: "stream:0",
        startMs: 1_000,
        endMs: 1_800,
      }),
      /already exists/,
    );
    await assert.rejects(
      host.seek({
        operationId: "operation:seek-over-budget",
        taskId: permit.taskId,
        agentId: permit.agentId,
        artifactId: runtime.sourceArtifactId,
        trackId: "stream:0",
        startMs: 1_000,
        endMs: 1_800,
      }),
      /tool-call budget/,
    );
    assert.equal((await runtime.ledger.events()).length, beforeDuplicate);

    const reports = new BoundedReportHost(runtime.ledger, () => "report:authorized-seek");
    const report = await reports.submit({
      taskId: permit.taskId,
      agentId: permit.agentId,
      outputArtifactIds: [result.artifact.id],
      summary: "The host observed audio activity only in the granted range and stored its receipt by content address.",
    });
    await reports.decide({
      reportId: report.id,
      decidedByTaskId: runtime.rootTaskId,
      decidedByAgentId: runtime.rootAgentId,
      accepted: true,
      reason: "The perception receipt, source lineage, and host-produced observation artifact are present.",
    });
    const finalState = runtime.ledger.state();
    assert.equal(finalState.reports[report.id].status, "accepted");
    assert.equal(finalState.tasks[permit.taskId].status, "completed");

    const observability = await buildRuntimeObservabilityIndex(
      await readFile(join(runtime.directory, "events.ndjson"), "utf8"),
    );
    const seekQuery = new ImmutableObservabilityQueryStore([observability]).query({
      operationCapabilities: ["media.seek"],
    });
    assert.equal(seekQuery.records.operations.length, 1);
    assert.equal(seekQuery.records.operations[0].operationId, "operation:authorized-seek");
    assert.equal(seekQuery.records.operations[0].requestedDurationMs, 800);
    assert.equal(seekQuery.aggregate.measured.mediaRequestedDurationMs, 800);
    assert.ok(seekQuery.records.operations[0].sources.receiptIds.includes(result.receipt.receiptId));
    assert.ok(seekQuery.records.operations[0].sources.artifactIds.includes(result.artifact.id));

    const reopened = await RuntimeLedger.open("runtime-test", runtime.journal, {
      now: () => new Date("2026-07-14T03:00:00.000Z"),
    });
    assert.deepEqual(reopened.state(), finalState);
  } finally {
    await cleanup(runtime);
  }
});

test("media.seek rejects an extract-only caller and source-byte drift", async (suite) => {
  await suite.test("extract grant cannot authorize seek", async () => {
    const runtime = await harness();
    try {
      const decision = await runtime.scheduler.requestSpawn(
        runtime.rootTaskId,
        runtime.rootAgentId,
        childInput(runtime),
      );
      const permit = decision.permit!;
      await runtime.scheduler.claimTaskLaunch(permit, "deterministic_test", "2026-07-14T03:00:00.000Z");
      await runtime.scheduler.registerAgent(permit);
      await runtime.scheduler.transitionTask(permit.taskId, permit.agentId, "working");
      const host = new FfmpegCapabilityHost(runtime.ledger, runtime.store);
      const before = (await runtime.ledger.events()).length;
      await assert.rejects(
        host.seek({
          operationId: "operation:unauthorized-seek",
          taskId: permit.taskId,
          agentId: permit.agentId,
          artifactId: runtime.sourceArtifactId,
          trackId: "stream:0",
          startMs: 1_000,
          endMs: 1_800,
        }),
        /outside the task's authoritative capability grant/,
      );
      assert.equal((await runtime.ledger.events()).length, before);
    } finally {
      await cleanup(runtime);
    }
  });

  await suite.test("registered source bytes are re-hashed before seek execution", async () => {
    const runtime = await harness();
    try {
      const decision = await runtime.scheduler.requestSpawn(
        runtime.rootTaskId,
        runtime.rootAgentId,
        seekChildInput(runtime),
      );
      const permit = decision.permit!;
      await runtime.scheduler.claimTaskLaunch(permit, "deterministic_test", "2026-07-14T03:00:00.000Z");
      await runtime.scheduler.registerAgent(permit);
      await runtime.scheduler.transitionTask(permit.taskId, permit.agentId, "working");
      const source = runtime.ledger.state().artifacts[runtime.sourceArtifactId];
      await appendFile(join(runtime.storeRoot, source.storageKey), "tampered");
      const artifactCount = Object.keys(runtime.ledger.state().artifacts).length;
      const host = new FfmpegCapabilityHost(runtime.ledger, runtime.store);
      await assert.rejects(
        host.seek({
          operationId: "operation:tampered-seek-source",
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
      assert.equal(state.operations["operation:tampered-seek-source"].status, "failed");
      assert.equal(
        state.operations["operation:tampered-seek-source"].failure,
        "ffmpeg bounded seek observation failed",
      );
      assert.equal(Object.keys(state.artifacts).length, artifactCount);
    } finally {
      await cleanup(runtime);
    }
  });

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
    await runtime.scheduler.claimTaskLaunch(permit, "deterministic_test", "2026-07-14T03:00:00.000Z");
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
    await runtime.scheduler.claimTaskLaunch(decision.permit!, "deterministic_test", "2026-07-14T03:00:00.000Z");
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
