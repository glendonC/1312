import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import { canonicalSha256, ContentAddressedArtifactStore } from "../src/studio/runtime/production/artifactStore.ts";
import { canonicalSha256 as browserCanonicalSha256 } from "../src/studio/runtime/production/canonicalIdentity.ts";
import {
  BoundedOrchestratorBridge,
  type ReportsWaitToolResult,
} from "../src/studio/runtime/production/executor/orchestratorBridge.ts";
import { MemoryEventJournal, RuntimeLedger } from "../src/studio/runtime/production/journal.ts";
import { interruptAmbiguousRuntime } from "../src/studio/runtime/production/recovery.ts";
import { projectRuntimeEvents } from "../src/studio/runtime/production/projection.ts";
import type {
  ExecutorSpanReceipt,
  LaunchPermit,
  RuntimeLimits,
  SourceArtifactDescriptor,
  TaskRecord,
  WorkerOutputEnvelope,
} from "../src/studio/runtime/production/model.ts";
import type { PendingRuntimeEvent, RuntimeEvent } from "../src/studio/runtime/production/protocol.ts";
import { BoundedReportHost } from "../src/studio/runtime/production/reportHost.ts";
import { BoundedRuntimeScheduler, type RuntimeIdentityFactory } from "../src/studio/runtime/production/scheduler.ts";
import { adaptProductionRuntime } from "../src/studio/runtime/production/studioProjection.ts";
import { runtimeTestJobContext } from "./runtime-test-job-context.ts";

const FIXTURE = resolve("public/demo/runs/run-005");

test("browser-safe job-context hashing matches the Node content identity producer", () => {
  const value = { z: ["한국어", 2], a: { nested: true, unavailable: null } };
  assert.equal(browserCanonicalSha256(value), canonicalSha256(value));
});

class Identities implements RuntimeIdentityFactory {
  private value = 0;
  next(kind: "request" | "task" | "agent" | "grant"): string {
    this.value += 1;
    return `${kind}:swarm-${this.value}`;
  }
  secret(): string {
    this.value += 1;
    return `secret-${this.value}`;
  }
}

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
    publication: "private",
    path: join(FIXTURE, "clip.m4a"),
    content: {
      algorithm: "sha256",
      digest: source.content.hash.digest,
      contentId: source.content.id,
      bytes: source.content.bytes,
    },
    durationMs: Math.round(probe.duration * 1_000),
    tracks: probe.tracks.map((track) => ({
      id: `stream:${track.index}`,
      index: track.index,
      kind: track.type,
      codec: track.codec,
      durationMs: Math.round(track.duration * 1_000),
    })),
  };
}

const LIMITS: RuntimeLimits = {
  maxDepth: 2,
  maxActiveWorkers: 3,
  runBudget: { wallMs: 120_000, toolCalls: 20 },
  grantableCapabilities: ["task.spawn.request", "task.reports.wait", "report.submit", "media.seek"],
};

class ContractChildLauncher {
  readonly launched: string[] = [];
  maximumConcurrent = 0;
  private active = 0;
  private releaseConcurrent: (() => void) | null = null;
  private readonly concurrentGate: Promise<void>;
  private readonly ledger: RuntimeLedger;
  private readonly scheduler: BoundedRuntimeScheduler;
  private readonly artifacts: ContentAddressedArtifactStore;
  private readonly reports: BoundedReportHost;
  private readonly failWorkloads: Set<string>;

  constructor(
    ledger: RuntimeLedger,
    scheduler: BoundedRuntimeScheduler,
    artifacts: ContentAddressedArtifactStore,
    reports: BoundedReportHost,
    failWorkloads = new Set<string>(),
    expectedConcurrent = 1,
  ) {
    this.ledger = ledger;
    this.scheduler = scheduler;
    this.artifacts = artifacts;
    this.reports = reports;
    this.failWorkloads = failWorkloads;
    this.concurrentGate = new Promise((resolve) => {
      this.releaseConcurrent = resolve;
      if (expectedConcurrent <= 1) resolve();
    });
    this.expectedConcurrent = expectedConcurrent;
  }

  private readonly expectedConcurrent: number;

  async launch(permit: LaunchPermit): Promise<void> {
    const claim = await this.scheduler.claimTaskLaunch(permit, "deterministic_test", "2026-07-16T12:00:00.000Z");
    assert.equal(claim.won, true);
    await this.scheduler.registerAgent(permit);
    await this.scheduler.transitionTask(permit.taskId, permit.agentId, "working");
    const task = this.ledger.state().tasks[permit.taskId];
    this.launched.push(task.workloadKey);
    const executionId = `execution:test-child:${task.id}`;
    await this.ledger.transact(
      { producer: { kind: "launcher", id: "contract-child-launcher" }, causationId: permit.requestId },
      () => ({
        pending: [{ type: "executor.started", data: {
          executionId,
          taskId: task.id,
          agentId: task.assignedAgentId,
          launchClaimId: claim.claim.id,
          startedAt: "2026-07-16T12:00:00.000Z",
        } }] satisfies PendingRuntimeEvent[],
        result: undefined,
      }),
    );
    this.active += 1;
    this.maximumConcurrent = Math.max(this.maximumConcurrent, this.active);
    if (this.active >= this.expectedConcurrent) this.releaseConcurrent?.();
    await this.concurrentGate;

    if (this.failWorkloads.has(task.workloadKey)) {
      const receipt = this.span(task, executionId, "failed", [], "The contract child failed deliberately.");
      await this.artifacts.storeJson(receipt);
      await this.ledger.transact(
        { producer: { kind: "launcher", id: "contract-child-launcher" }, causationId: executionId },
        () => ({ pending: [{ type: "executor.finished", data: { receipt } }] satisfies PendingRuntimeEvent[], result: undefined }),
      );
      this.active -= 1;
      await this.scheduler.transitionTask(task.id, task.assignedAgentId, "failed", receipt.failure!);
      throw new Error(receipt.failure!);
    }

    const envelope: WorkerOutputEnvelope = {
      schema: "studio.worker-output.v1",
      executionId,
      taskId: task.id,
      agentId: task.assignedAgentId,
      output: {
        name: task.requiredOutputs[0].name,
        kind: task.requiredOutputs[0].artifactKind,
        content: `Contract child ${task.workloadKey} returned only a structural execution acknowledgement.`,
      },
    };
    const prepared = await this.artifacts.prepareWorkerOutput(this.ledger.runId, envelope);
    const receipt = this.span(task, executionId, "completed", [prepared.artifactId], null);
    const stored = await this.artifacts.storeJson(receipt);
    const artifact = this.artifacts.buildWorkerOutputArtifact({
      runId: this.ledger.runId,
      receipt,
      receiptContentId: stored.content.contentId,
      prepared,
    });
    await this.artifacts.record(this.ledger, artifact, executionId);
    await this.ledger.transact(
      { producer: { kind: "launcher", id: "contract-child-launcher" }, causationId: executionId },
      () => ({ pending: [{ type: "executor.finished", data: { receipt } }] satisfies PendingRuntimeEvent[], result: undefined }),
    );
    this.active -= 1;
    await this.reports.submit({
      taskId: task.id,
      agentId: task.assignedAgentId,
      outputArtifactIds: [artifact.id],
      summary: `Terminal structural report for ${task.workloadKey}.`,
    });
  }

  private span(
    task: TaskRecord,
    executionId: string,
    outcome: "completed" | "failed",
    outputArtifactIds: string[],
    failure: string | null,
  ): ExecutorSpanReceipt {
    const body = {
      executionId,
      taskId: task.id,
      agentId: task.assignedAgentId,
      phase: "active" as const,
      producer: {
        id: "studio.deterministic-test-executor" as const,
        version: "1" as const,
        sandbox: "read-only" as const,
        ephemeral: true as const,
      },
      startedAt: "2026-07-16T12:00:00.000Z",
      endedAt: "2026-07-16T12:00:01.000Z",
      monotonicDurationMs: 1_000,
      outcome,
      process: { exitCode: outcome === "completed" ? 0 : null, signal: null },
      outputArtifactIds,
      modelUsageReceiptId: null,
      failure,
    };
    return { schema: "studio.executor-span.receipt.v1", receiptId: `span:${canonicalSha256(body)}`, ...body };
  }
}

interface Harness {
  directory: string;
  journal: MemoryEventJournal;
  ledger: RuntimeLedger;
  artifacts: ContentAddressedArtifactStore;
  scheduler: BoundedRuntimeScheduler;
  reports: BoundedReportHost;
  root: LaunchPermit;
  rootTask: TaskRecord;
  rootExecutionId: string;
}

async function harness(limits = LIMITS): Promise<Harness> {
  const directory = await mkdtemp(join(tmpdir(), "studio-owned-swarm-"));
  const journal = new MemoryEventJournal();
  const ledger = await RuntimeLedger.open("runtime:owned-swarm-test", journal, {
    now: () => new Date("2026-07-16T12:00:00.000Z"),
  });
  const artifacts = new ContentAddressedArtifactStore(join(directory, "artifacts"));
  const source = await artifacts.registerSource(ledger.runId, await sourceDescriptor());
  await artifacts.record(ledger, source);
  const scheduler = new BoundedRuntimeScheduler(ledger, limits, new Identities());
  const scope = [{ artifactId: source.id, trackId: "stream:0", startMs: 0, endMs: 2_000 }];
  const root = await scheduler.createRoot({
    workloadKey: "root:owned-swarm-test",
    objective: "Model-executed root chooses bounded execution-report delegation only.",
    workerKind: "orchestrator",
    workerLabel: "owned-swarm-root",
    mediaScope: scope,
    inputArtifactIds: [source.id],
    requiredOutputs: [{ name: "kernel terminal", artifactKind: "kernel-terminal", required: true }],
    requiredCapabilities: ["task.spawn.request", "task.reports.wait"],
    dependencies: [],
    budget: { wallMs: 30_000, toolCalls: 8 },
  }, runtimeTestJobContext({ source, range: { startMs: 0, endMs: 2_000 } }));
  const claim = await scheduler.claimTaskLaunch(root, "deterministic_test", "2026-07-16T12:00:00.000Z");
  await scheduler.registerAgent(root);
  await scheduler.transitionTask(root.taskId, root.agentId, "working");
  const rootExecutionId = "execution:test-root";
  await ledger.transact(
    { producer: { kind: "launcher", id: "contract-root-launcher" }, causationId: root.requestId },
    () => ({
      pending: [{ type: "executor.started", data: {
        executionId: rootExecutionId,
        taskId: root.taskId,
        agentId: root.agentId,
        launchClaimId: claim.claim.id,
        startedAt: "2026-07-16T12:00:00.000Z",
      } }] satisfies PendingRuntimeEvent[],
      result: undefined,
    }),
  );
  return {
    directory,
    journal,
    ledger,
    artifacts,
    scheduler,
    reports: new BoundedReportHost(ledger),
    root,
    rootTask: ledger.state().tasks[root.taskId],
    rootExecutionId,
  };
}

function contract(runtime: Harness, workloadKey: string, overrides: Record<string, unknown> = {}) {
  return {
    workloadKey,
    objective: `Return one structural execution report for ${workloadKey}.`,
    workerKind: "analysis",
    workerLabel: workloadKey,
    mediaScope: [],
    inputArtifactIds: [runtime.rootTask.jobContext.source.artifactId],
    requiredOutputs: [{ name: "execution report", artifactKind: "worker-execution-report", required: true }],
    requiredCapabilities: ["report.submit"],
    dependencyWorkloadKeys: [],
    budget: { wallMs: 10_000, toolCalls: 1 },
    ...overrides,
  };
}

async function cleanup(runtime: Harness): Promise<void> {
  await rm(runtime.directory, { recursive: true, force: true });
}

test("model boundary accepts concurrent fan-out, attenuates immutable context, and repeat wait returns only terminal identities", async () => {
  const runtime = await harness();
  try {
    const launcher = new ContractChildLauncher(runtime.ledger, runtime.scheduler, runtime.artifacts, runtime.reports, new Set(), 2);
    const bridge = new BoundedOrchestratorBridge({
      task: runtime.rootTask,
      executionId: runtime.rootExecutionId,
      ledger: runtime.ledger,
      scheduler: runtime.scheduler,
      childLauncher: launcher,
    });
    await assert.rejects(
      bridge.spawn({ ...contract(runtime, "child:forged-fields"), taskId: "task:model-forged" }),
      /task, agent, grant, and dependency task ids are unavailable/,
    );
    const first = await bridge.spawn(contract(runtime, "child:left", {
      mediaScope: [{ ...runtime.rootTask.mediaScope[0], endMs: 1_000 }],
    }));
    const second = await bridge.spawn(contract(runtime, "child:right", {
      mediaScope: [{ ...runtime.rootTask.mediaScope[0], startMs: 1_000 }],
    }));
    assert.equal(first.decision, "accepted");
    assert.equal(second.decision, "accepted");
    const waited = await bridge.wait({}) as ReportsWaitToolResult;
    const repeated = await bridge.wait({}) as ReportsWaitToolResult;
    assert.equal(waited.result, "all_terminal");
    assert.deepEqual(repeated.children, waited.children);
    assert.equal(launcher.maximumConcurrent, 2);
    const state = runtime.ledger.state();
    const children = Object.values(state.tasks).filter((task) => task.parentTaskId === runtime.root.taskId);
    assert.equal(children.length, 2);
    assert.equal(Object.keys(state.taskLaunches).length, 3);
    assert.ok(children.every((child) => child.jobContext.source.contentId === runtime.rootTask.jobContext.source.contentId));
    assert.deepEqual(children.map((child) => child.jobContext.analysisRequest.taskRange), [
      { startMs: 0, endMs: 1_000 },
      { startMs: 1_000, endMs: 2_000 },
    ]);
    const projection = adaptProductionRuntime(state);
    assert.equal(projection.taskLaunches.length, 3);
    assert.equal(projection.reportWaits.length, 2);
    assert.ok(projection.spawnRequests.every((spawn) => spawn.authoredByExecutionId === runtime.rootExecutionId));
    assert.ok(projection.tasks.every((task) => task.jobContext.contextId.startsWith("job-context:")));
    const tampered = structuredClone(await runtime.ledger.events());
    const childCreated = tampered.find((event) =>
      event.type === "task.created" && event.data.task.parentTaskId !== null);
    assert.ok(childCreated?.type === "task.created");
    childCreated.data.task.jobContext.targetLanguage = "fr";
    assert.throws(
      () => projectRuntimeEvents(runtime.ledger.runId, tampered),
      /contextId does not match the immutable context body/,
    );
  } finally {
    await cleanup(runtime);
  }
});

test("closed boundary records rejection, deliberate no-request, forged requester, and partial child failure without inventing reports", async () => {
  const runtime = await harness();
  try {
    const launcher = new ContractChildLauncher(
      runtime.ledger,
      runtime.scheduler,
      runtime.artifacts,
      runtime.reports,
      new Set(["child:fail"]),
      2,
    );
    const bridge = new BoundedOrchestratorBridge({
      task: runtime.rootTask,
      executionId: runtime.rootExecutionId,
      ledger: runtime.ledger,
      scheduler: runtime.scheduler,
      childLauncher: launcher,
    });
    const rejected = await bridge.spawn(contract(runtime, "child:scope-rejected", {
      mediaScope: [{ ...runtime.rootTask.mediaScope[0], endMs: 2_001 }],
    }));
    assert.equal(rejected.decision, "rejected");
    assert.equal(rejected.rejection, "scope_violation");
    await bridge.spawn(contract(runtime, "child:ok"));
    await bridge.spawn(contract(runtime, "child:fail"));
    const waited = await bridge.wait({}) as ReportsWaitToolResult;
    assert.equal(waited.result, "closed_failure");
    assert.equal(waited.failure, "child_failed");
    assert.equal(waited.children.filter((child) => child.reportId !== null).length, 1);
    assert.equal(waited.children.find((child) => child.status === "failed")?.reportId, null);
    const { dependencyWorkloadKeys: _dependencyWorkloadKeys, ...forgedContract } = contract(runtime, "child:forged");
    const forged = await runtime.scheduler.requestSpawn("task:forged", "agent:forged", {
      ...forgedContract,
      dependencies: [],
    });
    assert.equal(forged.rejection, "requester_not_authorized");

    const noRequestRuntime = await harness();
    try {
      await noRequestRuntime.ledger.transact(
        { producer: { kind: "launcher", id: "contract-root-launcher" }, causationId: noRequestRuntime.rootExecutionId },
        () => ({
          pending: [{ type: "orchestrator.decision_recorded", data: {
            decision: {
              executionId: noRequestRuntime.rootExecutionId,
              taskId: noRequestRuntime.root.taskId,
              outcome: "no_request",
              reason: "The model deliberately found no bounded child work necessary.",
            },
          } }] satisfies PendingRuntimeEvent[],
          result: undefined,
        }),
      );
      assert.equal(Object.keys(noRequestRuntime.ledger.state().spawnRequests).length, 0);
      assert.equal(Object.values(noRequestRuntime.ledger.state().orchestratorDecisions)[0].outcome, "no_request");
    } finally {
      await cleanup(noRequestRuntime);
    }
  } finally {
    await cleanup(runtime);
  }
});

test("scheduler model contracts fail closed on duplicate, dependency, capability, budget, concurrency, and depth", async () => {
  const runtime = await harness();
  try {
    const launcher = new ContractChildLauncher(runtime.ledger, runtime.scheduler, runtime.artifacts, runtime.reports);
    const bridge = new BoundedOrchestratorBridge({
      task: runtime.rootTask,
      executionId: runtime.rootExecutionId,
      ledger: runtime.ledger,
      scheduler: runtime.scheduler,
      childLauncher: launcher,
    });
    assert.equal((await bridge.spawn(contract(runtime, "child:one"))).decision, "accepted");
    assert.equal((await bridge.spawn(contract(runtime, "child:one"))).rejection, "duplicate_owner");
    assert.equal((await bridge.spawn(contract(runtime, "child:dependency", { dependencyWorkloadKeys: ["missing"] }))).rejection, "dependency_unavailable");
    assert.equal((await bridge.spawn(contract(runtime, "child:capability", { requiredCapabilities: ["evidence.read", "report.submit"] }))).rejection, "capability_not_grantable");
    assert.equal((await bridge.spawn(contract(runtime, "child:budget", { budget: { wallMs: 120_000, toolCalls: 20 } }))).rejection, "run_budget");
    assert.equal((await bridge.spawn(contract(runtime, "child:two"))).decision, "accepted");
    assert.equal((await bridge.spawn(contract(runtime, "child:three"))).rejection, "max_active_workers");
    await bridge.wait({});
  } finally {
    await cleanup(runtime);
  }

  const depthRuntime = await harness({ ...LIMITS, maxDepth: 0 });
  try {
    const launcher = new ContractChildLauncher(depthRuntime.ledger, depthRuntime.scheduler, depthRuntime.artifacts, depthRuntime.reports);
    const bridge = new BoundedOrchestratorBridge({
      task: depthRuntime.rootTask,
      executionId: depthRuntime.rootExecutionId,
      ledger: depthRuntime.ledger,
      scheduler: depthRuntime.scheduler,
      childLauncher: launcher,
    });
    assert.equal((await bridge.spawn(contract(depthRuntime, "child:depth"))).rejection, "max_depth");
  } finally {
    await cleanup(depthRuntime);
  }
});

async function replayPrefix(runId: string, events: RuntimeEvent[]): Promise<ReturnType<RuntimeLedger["state"]>> {
  const journal = new MemoryEventJournal();
  await journal.appendBatch(events);
  const ledger = await RuntimeLedger.open(runId, journal, { now: () => new Date("2026-07-16T12:05:00.000Z") });
  await interruptAmbiguousRuntime(ledger);
  return ledger.state();
}

test("cold replay at request, decision, task, claim, executor-start, and report boundaries interrupts ambiguity without duplication", async () => {
  const runtime = await harness();
  try {
    const launcher = new ContractChildLauncher(runtime.ledger, runtime.scheduler, runtime.artifacts, runtime.reports);
    const bridge = new BoundedOrchestratorBridge({
      task: runtime.rootTask,
      executionId: runtime.rootExecutionId,
      ledger: runtime.ledger,
      scheduler: runtime.scheduler,
      childLauncher: launcher,
    });
    await bridge.spawn(contract(runtime, "child:restart"));
    await bridge.wait({});
    const events = await runtime.ledger.events();
    const requestIndex = events.findIndex((event) => event.type === "spawn.requested");
    const decisionIndex = events.findIndex((event) => event.type === "spawn.decided");
    const childTaskIndex = events.findIndex((event) => event.type === "task.created" && event.data.task.parentTaskId !== null);
    const childClaimIndex = events.findIndex((event) => event.type === "task.launch_claimed" && event.data.claim.requestId !== "root-task");
    const childStartIndex = events.findIndex((event) => event.type === "executor.started" && event.data.taskId !== runtime.root.taskId);
    const reportIndex = events.findIndex((event) => event.type === "report.submitted");
    for (const index of [
      requestIndex - 1,
      requestIndex,
      decisionIndex,
      childTaskIndex,
      childClaimIndex,
      childStartIndex,
      reportIndex - 1,
      reportIndex,
    ]) {
      assert.ok(index >= 0);
      const state = await replayPrefix(runtime.ledger.runId, events.slice(0, index + 1));
      assert.ok(Object.values(state.tasks).every((task) =>
        task.status === "reported" || task.status === "completed" || task.status === "failed" ||
        task.status === "withheld" || task.status === "interrupted"));
      assert.ok(Object.values(state.executions).every((execution) => execution.status !== "active"));
      assert.ok(Object.values(state.spawnRequests).length <= 1);
      assert.ok(Object.values(state.reports).length <= 1);
      assert.ok(Object.values(state.taskLaunches).filter((claim) => claim.taskId !== runtime.root.taskId).length <= 1);
    }
    const finalReplay = await replayPrefix(runtime.ledger.runId, events);
    assert.equal(Object.keys(finalReplay.reports).length, 1);
    assert.equal(Object.keys(finalReplay.taskLaunches).length, 2);
  } finally {
    await cleanup(runtime);
  }
});
