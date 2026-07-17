import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import test from "node:test";

import { ContentAddressedArtifactStore, canonicalSha256, identifyFile } from "../src/studio/runtime/production/artifactStore.ts";
import { BoundedChildSeparationBridge } from "../src/studio/runtime/production/executor/childSeparationBridge.ts";
import type { CurrentRunRecognizerInput, CurrentRunRecognizerResult, CurrentRunSpeechRecognizer } from "../src/studio/runtime/production/semantic/currentRunSpeechRecognizer.ts";
import { FileEventJournal, RuntimeLedger } from "../src/studio/runtime/production/journal.ts";
import { CONDITIONAL_SEPARATION_LIMITS, type CurrentRunRecognizerDescriptor, type LaunchPermit, type SourceArtifactDescriptor, type SpeakerOverlapProducerLineage, type TaskRecord } from "../src/studio/runtime/production/model.ts";
import type { PendingRuntimeEvent } from "../src/studio/runtime/production/protocol.ts";
import { BoundedRuntimeScheduler, type RuntimeIdentityFactory } from "../src/studio/runtime/production/scheduler.ts";
import type { SourceSeparator } from "../src/studio/runtime/production/separation/separator.ts";
import { SourceSeparatorFailure } from "../src/studio/runtime/production/separation/separator.ts";
import type { SpeakerDiarizer, SpeakerDiarizerResult } from "../src/studio/runtime/production/speaker/diarizer.ts";
import { SherpaOnnxSpeakerDiarizer } from "../src/studio/runtime/production/speaker/sherpaOnnxDiarizer.ts";
import { auditConditionalSeparation } from "../src/studio/runtime/production/separationAudit.ts";
import { BoundedConditionalSeparationHost } from "../src/studio/runtime/production/separationHost.ts";
import { BoundedSpeakerOverlapHost } from "../src/studio/runtime/production/speakerHost.ts";
import { ConditionalSeparationRequestHost } from "../src/studio/runtime/production/study/conditionalSeparationRequestHost.ts";
import { validateWorkerResult } from "../src/studio/runtime/production/executor/workerContract.ts";
import { validateConditionalSeparationLimits, validateRawStemComparison } from "../src/studio/runtime/production/validation/separation.ts";
import { runtimeTestJobContext } from "./runtime-test-job-context.ts";

const SOURCE_FIXTURE = resolve("public/demo/runs/run-006/clip.mp4");
const SOURCE_DURATION_MS = 40_040;
let harnessIndex = 0;

class SequenceIdentities implements RuntimeIdentityFactory {
  private value = 0;
  next(kind: "request" | "task" | "agent" | "grant"): string { this.value += 1; return `${kind}:u7-${this.value}`; }
  secret(): string { this.value += 1; return `secret:u7-${this.value}`; }
}

let lineagePromise: Promise<SpeakerOverlapProducerLineage> | null = null;
async function speakerLineage(): Promise<SpeakerOverlapProducerLineage> {
  lineagePromise ??= new SherpaOnnxSpeakerDiarizer().currentLineage(performance.now() + 15_000);
  return structuredClone(await lineagePromise);
}

class OverlapDiarizer implements SpeakerDiarizer {
  async currentLineage(): Promise<SpeakerOverlapProducerLineage> { return speakerLineage(); }
  async diarize(): Promise<SpeakerDiarizerResult> {
    return { lineage: await speakerLineage(), segments: [
      { startMs: 0, endMs: 3_000, speakerCluster: 1 },
      { startMs: 2_500, endMs: 4_500, speakerCluster: 2 },
    ] };
  }
}

class ComparisonRecognizer implements CurrentRunSpeechRecognizer {
  readonly calls: CurrentRunRecognizerInput[] = [];
  async describe(): Promise<CurrentRunRecognizerDescriptor> {
    const configuration = { id: "fixture-u7-recognizer.timed-segments.v1", language: null, timestampMode: "segment" as const, segmentation: "producer_defined" as const };
    return {
      id: "fixture-u7-recognizer", version: "1", model: "fixture-contract-only", runtime: { id: "node-test", version: "1" },
      configuration: { ...configuration, contentId: `sha256:${canonicalSha256(configuration)}` }, executionScope: "current_run", fixtureContentId: null,
    };
  }
  async recognize(input: CurrentRunRecognizerInput): Promise<CurrentRunRecognizerResult> {
    this.calls.push(structuredClone(input));
    const text = this.calls.length === 3 ? "other words" : "raw words";
    return { availability: "available", reason: "current_run_hypotheses_returned", segments: [{ startMs: input.range.startMs, endMs: input.range.endMs, state: "available", text }] };
  }
}

async function sourceDescriptor(): Promise<SourceArtifactDescriptor> {
  return {
    schema: "studio.source-artifact.v1", adapterId: "owned-local-source-adapter.v1", sourceReceiptRef: "fixture:run-006:u7-source",
    publication: "private", path: SOURCE_FIXTURE, content: await identifyFile(SOURCE_FIXTURE), durationMs: SOURCE_DURATION_MS,
    tracks: [
      { id: "stream:0", index: 0, kind: "video", codec: "h264", durationMs: SOURCE_DURATION_MS },
      { id: "stream:1", index: 1, kind: "audio", codec: "aac", durationMs: 40_000 },
    ],
  };
}

interface Harness {
  runId: string;
  directory: string;
  journalPath: string;
  artifacts: ContentAddressedArtifactStore;
  ledger: RuntimeLedger;
  scheduler: BoundedRuntimeScheduler;
  source: Awaited<ReturnType<ContentAddressedArtifactStore["registerSource"]>>;
  root: TaskRecord;
  rootPermit: LaunchPermit;
  rootExecutionId: string;
  diarizer: OverlapDiarizer;
}

async function startTask(runtime: Harness, permit: LaunchPermit, executionId: string): Promise<TaskRecord> {
  const claim = await runtime.scheduler.claimTaskLaunch(permit, "deterministic_test", "2026-07-17T14:00:00.000Z");
  assert.equal(claim.won, true);
  await runtime.scheduler.registerAgent(permit);
  await runtime.scheduler.transitionTask(permit.taskId, permit.agentId, "working");
  const task = runtime.ledger.state().tasks[permit.taskId];
  await runtime.ledger.transact(
    { producer: { kind: "launcher", id: "u7-test-executor" }, causationId: permit.requestId },
    () => ({ pending: [{ type: "executor.started", data: { executionId, taskId: task.id, agentId: task.assignedAgentId, launchClaimId: claim.claim.id, startedAt: "2026-07-17T14:00:00.000Z" } }] satisfies PendingRuntimeEvent[], result: undefined }),
  );
  return runtime.ledger.state().tasks[permit.taskId];
}

async function harness(options: { separationGrant?: boolean } = {}): Promise<Harness> {
  harnessIndex += 1;
  const runId = `runtime:u7:${harnessIndex}`;
  const directory = await mkdtemp(join(tmpdir(), "studio-u7-test-"));
  const journalPath = join(directory, "events.ndjson");
  const artifacts = new ContentAddressedArtifactStore(join(directory, "artifacts"));
  const source = await artifacts.registerSource(runId, await sourceDescriptor());
  const ledger = await RuntimeLedger.open(runId, new FileEventJournal(journalPath), { now: () => new Date("2026-07-17T14:00:00.000Z") });
  await artifacts.record(ledger, source);
  const scheduler = new BoundedRuntimeScheduler(ledger, {
    maxDepth: 2, maxActiveWorkers: 6, runBudget: { wallMs: 500_000, toolCalls: 24 },
    grantableCapabilities: ["task.spawn.request", "report.submit", "media.speakers.analyze", "media.audio.separate", "study.separate"],
  }, new SequenceIdentities());
  const rootPermit = await scheduler.createRoot({
    workloadKey: `root:u7:${harnessIndex}`, objective: "Authorize only audited exact U6.1 overlap ranges for U7.", workerKind: "orchestrator", workerLabel: "u7-root",
    mediaScope: [{ artifactId: source.id, trackId: "stream:1", startMs: 10_000, endMs: 15_000 }], inputArtifactIds: [source.id],
    requiredOutputs: [{ name: "study", artifactKind: "studio.owned-media-study.v3", required: true }],
    requiredCapabilities: options.separationGrant === false ? ["task.spawn.request"] : ["task.spawn.request", "study.separate"],
    dependencies: [], budget: { wallMs: 120_000, toolCalls: 8 },
  }, runtimeTestJobContext({ source, range: { startMs: 10_000, endMs: 15_000 } }));
  const runtime = { runId, directory, journalPath, artifacts, ledger, scheduler, source, root: null as unknown as TaskRecord, rootPermit, rootExecutionId: `execution:u7-root:${harnessIndex}`, diarizer: new OverlapDiarizer() };
  runtime.root = await startTask(runtime, rootPermit, runtime.rootExecutionId);
  return runtime;
}

async function produceTrigger(runtime: Harness): Promise<void> {
  const child = await runtime.scheduler.requestSpawn(runtime.root.id, runtime.root.assignedAgentId, {
    workloadKey: `u6-trigger:${runtime.runId}`, objective: "Produce one exact anonymous overlap cell.", workerKind: "analysis", workerLabel: "u6-trigger",
    mediaScope: [{ artifactId: runtime.source.id, trackId: "stream:1", startMs: 10_000, endMs: 15_000 }], inputArtifactIds: [runtime.source.id],
    requiredOutputs: [{ name: "coverage", artifactKind: "coverage-note", required: true }], requiredCapabilities: ["media.speakers.analyze", "report.submit"],
    dependencies: [], budget: { wallMs: 60_000, toolCalls: 1 },
  });
  assert.ok(child.permit, child.rejection ?? "U6 child rejected");
  const task = await startTask(runtime, child.permit, `execution:u6:${runtime.runId}`);
  const grant = task.grants.find((candidate) => candidate.capability === "media.speakers.analyze");
  assert.ok(grant);
  await new BoundedSpeakerOverlapHost(runtime.ledger, runtime.artifacts, { diarizer: runtime.diarizer }).analyze({ operationId: `operation:u6:${runtime.runId}`, taskId: task.id, agentId: task.assignedAgentId, grantId: grant.id });
}

async function authorizeSeparation(runtime: Harness): Promise<{ task: TaskRecord; input: Awaited<ReturnType<ConditionalSeparationRequestHost["inspect"]>>; requestHost: ConditionalSeparationRequestHost }> {
  const requestHost = new ConditionalSeparationRequestHost(runtime.ledger, runtime.artifacts, runtime.scheduler, { speakerDiarizer: runtime.diarizer });
  const input = await requestHost.inspect(runtime.rootExecutionId);
  assert.equal(input.triggers.length, 1);
  const toolCallId = `tool-call:u7:${runtime.runId}:${Object.keys(runtime.ledger.state().orchestratorToolCalls).length}`;
  await runtime.ledger.transact(
    { producer: { kind: "launcher", id: "u7-test-orchestrator" }, causationId: runtime.rootExecutionId },
    () => ({ pending: [{ type: "orchestrator.tool_called", data: { callId: toolCallId, executionId: runtime.rootExecutionId, taskId: runtime.root.id, tool: "study_separation_request" } }] satisfies PendingRuntimeEvent[], result: undefined }),
  );
  const decision = await requestHost.request(runtime.rootExecutionId, toolCallId, { inputId: input.inputId, triggerId: input.triggers[0].triggerId });
  assert.ok(decision.permit, decision.rejection ?? "U7 child rejected");
  const task = await startTask(runtime, decision.permit, `execution:u7-child:${runtime.runId}`);
  return { task, input, requestHost };
}

test("U7 exact U6.1 trigger produces real private stems, raw/stem disagreement, cold audit, and no caption authority", async () => {
  const runtime = await harness();
  try {
    const emptyHost = new ConditionalSeparationRequestHost(runtime.ledger, runtime.artifacts, runtime.scheduler, { speakerDiarizer: runtime.diarizer });
    const empty = await emptyHost.inspect(runtime.rootExecutionId);
    assert.deepEqual(empty.triggers, []);
    await assert.rejects(emptyHost.request(runtime.rootExecutionId, "unused", { inputId: empty.inputId, triggerId: "forged" }), /exact audited trigger/);
    await produceTrigger(runtime);
    const { task, input, requestHost } = await authorizeSeparation(runtime);
    assert.deepEqual(input.triggers[0].source.range, { startMs: 12_500, endMs: 13_000 });
    const grant = task.grants.find((candidate) => candidate.capability === "media.audio.separate");
    assert.ok(grant?.separationScope);
    assert.deepEqual(grant.mediaScope[0], { artifactId: runtime.source.id, trackId: "stream:1", startMs: 12_500, endMs: 13_000 });
    const recognizer = new ComparisonRecognizer();
    const produced = await new BoundedConditionalSeparationHost(runtime.ledger, runtime.artifacts, { recognizer, speakerDiarizer: runtime.diarizer }).separate({ operationId: `operation:u7:${runtime.runId}`, taskId: task.id, agentId: task.assignedAgentId, grantId: grant.id });
    assert.equal(recognizer.calls.length, 3);
    assert.deepEqual(recognizer.calls.map((call) => call.range), [{ startMs: 12_500, endMs: 13_000 }, { startMs: 0, endMs: 500 }, { startMs: 0, endMs: 500 }]);
    assert.equal(produced.comparison.outcome, "disagreement");
    assert.equal(produced.comparison.deterministicGate.semanticPreference, null);
    assert.equal(produced.comparison.deterministicGate.semanticAuthority, "not_granted");
    assert.equal(produced.comparison.deterministicGate.captionAuthority, "not_granted");
    assert.throws(() => validateRawStemComparison({ ...structuredClone(produced.comparison), outcome: "agreement", reason: "normalized_text_agrees" }), /deterministic normalized-text comparison/);
    assert.ok(produced.stems.every((artifact) => artifact.mediaClass === "derived" && artifact.publication === "private" && artifact.sourceArtifactIds[0] === runtime.source.id));
    assert.equal(runtime.ledger.state().artifacts[runtime.source.id].mediaClass, "raw");
    const replay = await RuntimeLedger.open(runtime.runId, new FileEventJournal(runtime.journalPath));
    const audited = await auditConditionalSeparation(replay.state(), runtime.artifacts, produced.receipt.operationId, { speakerDiarizer: runtime.diarizer });
    assert.equal(audited.receipt.receiptId, produced.receipt.receiptId);
    assert.equal(audited.comparisonReceipt.nonClaims.captionAuthority, "not_granted");
    assert.throws(() => validateWorkerResult({ summary: "malicious stem promotion", separationEvidenceInputs: [produced.comparisonArtifact.id], outputs: [] }, task), /only summary and outputs/);
    const secondCall = `tool-call:u7-duplicate:${runtime.runId}`;
    await runtime.ledger.transact(
      { producer: { kind: "launcher", id: "u7-test-orchestrator" }, causationId: runtime.rootExecutionId },
      () => ({ pending: [{ type: "orchestrator.tool_called", data: { callId: secondCall, executionId: runtime.rootExecutionId, taskId: runtime.root.id, tool: "study_separation_request" } }] satisfies PendingRuntimeEvent[], result: undefined }),
    );
    const duplicate = await requestHost.request(runtime.rootExecutionId, secondCall, { inputId: input.inputId, triggerId: input.triggers[0].triggerId });
    assert.equal(duplicate.accepted, false);
    assert.equal(duplicate.rejection, "separation_duplicate_work");
    const rawPath = await runtime.artifacts.resolveVerified(runtime.source);
    const rawBytes = await readFile(rawPath);
    await chmod(rawPath, 0o600);
    await writeFile(rawPath, Buffer.from("tampered-private-raw"));
    await assert.rejects(auditConditionalSeparation(runtime.ledger.state(), runtime.artifacts, produced.receipt.operationId, { speakerDiarizer: runtime.diarizer }), /content|identity|artifact/i);
    await writeFile(rawPath, rawBytes);
    const receiptPath = await runtime.artifacts.resolveVerified(produced.receiptArtifact);
    const receiptBytes = await readFile(receiptPath);
    await chmod(receiptPath, 0o600);
    await writeFile(receiptPath, Buffer.from("tampered-separation-receipt"));
    await assert.rejects(auditConditionalSeparation(runtime.ledger.state(), runtime.artifacts, produced.receipt.operationId, { speakerDiarizer: runtime.diarizer }), /content|identity|artifact/i);
    await writeFile(receiptPath, receiptBytes);
    const stemPath = await runtime.artifacts.resolveVerified(produced.stems[0]);
    await chmod(stemPath, 0o600);
    await writeFile(stemPath, Buffer.from("tampered-private-stem"));
    await assert.rejects(auditConditionalSeparation(runtime.ledger.state(), runtime.artifacts, produced.receipt.operationId, { speakerDiarizer: runtime.diarizer }), /content|identity|artifact/i);
  } finally {
    await rm(runtime.directory, { recursive: true, force: true });
  }
});

test("U7 rejects ambient spawn, range fields, missing root grant, and unavailable model without stems", async () => {
  const runtime = await harness();
  try {
    const ambient = await runtime.scheduler.requestSpawn(runtime.root.id, runtime.root.assignedAgentId, {
      workloadKey: "ambient-separation", objective: "Forbidden ambient separation.", workerKind: "analysis", workerLabel: "ambient",
      mediaScope: [{ artifactId: runtime.source.id, trackId: "stream:1", startMs: 10_000, endMs: 15_000 }], inputArtifactIds: [runtime.source.id],
      requiredOutputs: [{ name: "note", artifactKind: "studio.study-report.v2", required: true }], requiredCapabilities: ["media.audio.separate", "report.submit"], dependencies: [], budget: { wallMs: 60_000, toolCalls: 1 },
    });
    assert.equal(ambient.accepted, false);
    assert.equal(ambient.rejection, "capability_not_grantable");
    await produceTrigger(runtime);
    const requestHost = new ConditionalSeparationRequestHost(runtime.ledger, runtime.artifacts, runtime.scheduler, { speakerDiarizer: runtime.diarizer });
    const input = await requestHost.inspect(runtime.rootExecutionId);
    await assert.rejects(requestHost.request(runtime.rootExecutionId, "unused", { inputId: input.inputId, triggerId: input.triggers[0].triggerId, range: { startMs: 10_000, endMs: 15_000 } }), /not allowed/);
    assert.throws(() => validateConditionalSeparationLimits({ ...CONDITIONAL_SEPARATION_LIMITS, maxRangeMs: CONDITIONAL_SEPARATION_LIMITS.maxRangeMs + 1 }, "U7 limit test", "limits"), /must equal registered U7 limit/);
    const { task } = await authorizeSeparation(runtime);
    const grant = task.grants.find((candidate) => candidate.capability === "media.audio.separate");
    assert.ok(grant);
    const unavailable: SourceSeparator = {
      async currentLineage() { throw new SourceSeparatorFailure("model_unavailable", "missing pinned model"); },
      async separate() { throw new SourceSeparatorFailure("model_unavailable", "missing pinned model"); },
    };
    await assert.rejects(new BoundedConditionalSeparationHost(runtime.ledger, runtime.artifacts, { separator: unavailable, recognizer: new ComparisonRecognizer(), speakerDiarizer: runtime.diarizer }).separate({ operationId: `operation:u7-unavailable:${runtime.runId}`, taskId: task.id, agentId: task.assignedAgentId, grantId: grant.id }), /missing pinned model/);
    const failed = runtime.ledger.state().conditionalSeparationOperations[`operation:u7-unavailable:${runtime.runId}`];
    assert.equal(failed.status, "failed");
    assert.equal(failed.failure, "model_unavailable");
    assert.deepEqual(failed.stemArtifactIds, []);
  } finally {
    await rm(runtime.directory, { recursive: true, force: true });
  }

  const noGrant = await harness({ separationGrant: false });
  try {
    const host = new ConditionalSeparationRequestHost(noGrant.ledger, noGrant.artifacts, noGrant.scheduler, { speakerDiarizer: noGrant.diarizer });
    await assert.rejects(host.inspect(noGrant.rootExecutionId), /study\.separate grant/);
  } finally {
    await rm(noGrant.directory, { recursive: true, force: true });
  }
});

test("child separation bridge accepts only the closed empty object", async () => {
  const runtime = await harness();
  try {
    await produceTrigger(runtime);
    const { task } = await authorizeSeparation(runtime);
    const bridge = new BoundedChildSeparationBridge(task, { async separate() { throw new Error("must not reach host"); } });
    await assert.rejects(bridge.call({ path: SOURCE_FIXTURE }), /accepts only \{\}/);
  } finally {
    await rm(runtime.directory, { recursive: true, force: true });
  }
});
