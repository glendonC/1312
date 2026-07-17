import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import test from "node:test";
import { deflateSync } from "node:zlib";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

import { ContentAddressedArtifactStore, identifyFile } from "../src/studio/runtime/production/artifactStore.ts";
import {
  BoundedChildFrameBridge,
  callChildFrameBridge,
  openChildFrameBridge,
} from "../src/studio/runtime/production/executor/childFrameBridge.ts";
import { auditFrameSampling } from "../src/studio/runtime/production/frameAudit.ts";
import { BoundedFrameSamplingHost } from "../src/studio/runtime/production/frameHost.ts";
import type { FrameDecoder, FrameDecodeResult } from "../src/studio/runtime/production/frames/decoder.ts";
import { FfmpegFrameDecoder } from "../src/studio/runtime/production/frames/ffmpegDecoder.ts";
import { inspectRgbPng } from "../src/studio/runtime/production/frames/png.ts";
import { FileEventJournal, RuntimeLedger } from "../src/studio/runtime/production/journal.ts";
import { CodexExecWorkerLauncher } from "../src/studio/runtime/production/launcher.ts";
import { FRAME_SAMPLING_LIMITS } from "../src/studio/runtime/production/model.ts";
import type {
  FrameDecoderLineage,
  FrameSamplingReceipt,
  LaunchPermit,
  MediaScope,
  SourceArtifactDescriptor,
  SpawnRequestInput,
  TaskRecord,
} from "../src/studio/runtime/production/model.ts";
import type { PendingRuntimeEvent } from "../src/studio/runtime/production/protocol.ts";
import { BoundedRuntimeScheduler, type RuntimeIdentityFactory } from "../src/studio/runtime/production/scheduler.ts";
import { buildRuntimeObservabilityIndex } from "../src/studio/runtime/production/observability/indexer.ts";
import { projectProductionRuntimeJournal } from "../src/studio/runtime/production/studioProjection.ts";
import { BoundedReportHost } from "../src/studio/runtime/production/study/reportHost.ts";
import { runtimeTestJobContext } from "./runtime-test-job-context.ts";

const FIXTURE = resolve("public/demo/runs/run-006/clip.mp4");
const MCP_SERVER = resolve("src/studio/runtime/production/executor/frameMcpServer.ts");
const RUN_DURATION_MS = 40_040;
let harnessIndex = 0;

class SequenceIdentities implements RuntimeIdentityFactory {
  private value = 0;

  next(kind: "request" | "task" | "agent" | "grant"): string {
    this.value += 1;
    return `${kind}:frames-${this.value}`;
  }

  secret(): string {
    this.value += 1;
    return `secret:frames-${this.value}`;
  }
}

async function sourceDescriptor(): Promise<SourceArtifactDescriptor> {
  const content = await identifyFile(FIXTURE);
  return {
    schema: "studio.source-artifact.v1",
    adapterId: "owned-local-source-adapter.v1",
    sourceReceiptRef: "fixture:run-006:clip.mp4",
    publication: "private",
    path: FIXTURE,
    content,
    durationMs: RUN_DURATION_MS,
    tracks: [
      { id: "stream:0", index: 0, kind: "video", codec: "h264", durationMs: RUN_DURATION_MS },
      { id: "stream:1", index: 1, kind: "audio", codec: "aac", durationMs: 40_000 },
    ],
  };
}

interface FrameHarness {
  runId: string;
  directory: string;
  storeRoot: string;
  journalPath: string;
  artifacts: ContentAddressedArtifactStore;
  ledger: RuntimeLedger;
  scheduler: BoundedRuntimeScheduler;
  source: ReturnType<ContentAddressedArtifactStore["registerSource"]> extends Promise<infer Artifact> ? Artifact : never;
  foreignSource: ReturnType<ContentAddressedArtifactStore["registerSource"]> extends Promise<infer Artifact> ? Artifact : never;
  rootTask: TaskRecord;
  rootExecutionId: string;
  childTask: TaskRecord;
  childPermit: LaunchPermit;
  scope: MediaScope;
  grantId: string;
}

async function frameHarness(options: { childWallMs?: number; claimChild?: boolean } = {}): Promise<FrameHarness> {
  harnessIndex += 1;
  const runId = `runtime:frames:${harnessIndex}`;
  const directory = await mkdtemp(join(tmpdir(), "studio-frame-sampling-"));
  const storeRoot = join(directory, "artifacts");
  const journalPath = join(directory, "events.ndjson");
  const artifacts = new ContentAddressedArtifactStore(storeRoot);
  const source = await artifacts.registerSource(runId, await sourceDescriptor());
  const foreignDescriptor = await sourceDescriptor();
  foreignDescriptor.sourceReceiptRef = "fixture:run-006:foreign-source";
  const foreignSource = await artifacts.registerSource(runId, foreignDescriptor);
  const ledger = await RuntimeLedger.open(runId, new FileEventJournal(journalPath), {
    now: () => new Date("2026-07-17T12:00:00.000Z"),
  });
  await artifacts.record(ledger, source);
  await artifacts.record(ledger, foreignSource);
  const scheduler = new BoundedRuntimeScheduler(ledger, {
    maxDepth: 1,
    maxActiveWorkers: 4,
    runBudget: { wallMs: 90_000, toolCalls: 12 },
    grantableCapabilities: ["task.spawn.request", "report.submit", "media.frames.sample"],
  }, new SequenceIdentities());
  const scope = { artifactId: source.id, trackId: "stream:0", startMs: 10_000, endMs: 11_000 };
  const rootVideoScope = { ...scope, endMs: RUN_DURATION_MS };
  const root = await scheduler.createRoot({
    workloadKey: "root:frames",
    objective: "Authorize bounded runtime frame sampling without visual claims.",
    workerKind: "orchestrator",
    workerLabel: "frame-root",
    mediaScope: [
      rootVideoScope,
      { ...scope, trackId: "stream:1" },
      { ...rootVideoScope, artifactId: foreignSource.id },
    ],
    inputArtifactIds: [source.id, foreignSource.id],
    requiredOutputs: [{ name: "run report", artifactKind: "run-report", required: true }],
    requiredCapabilities: ["task.spawn.request"],
    dependencies: [],
    budget: { wallMs: 60_000, toolCalls: 4 },
  }, runtimeTestJobContext({ source, range: { startMs: rootVideoScope.startMs, endMs: rootVideoScope.endMs } }));
  const rootClaim = await scheduler.claimTaskLaunch(root, "deterministic_test", "2026-07-17T12:00:00.000Z");
  assert.equal(rootClaim.won, true);
  await scheduler.registerAgent(root);
  await scheduler.transitionTask(root.taskId, root.agentId, "working");
  const rootExecutionId = `execution:frames:root:${harnessIndex}`;
  await ledger.transact(
    { producer: { kind: "launcher", id: "frame-test-root-executor" }, causationId: root.requestId },
    () => ({
      pending: [{
        type: "executor.started",
        data: {
          executionId: rootExecutionId,
          taskId: root.taskId,
          agentId: root.agentId,
          launchClaimId: rootClaim.claim.id,
          startedAt: "2026-07-17T12:00:00.000Z",
        },
      }] satisfies PendingRuntimeEvent[],
      result: undefined,
    }),
  );
  const input: SpawnRequestInput = {
    workloadKey: "frames:10000-11000",
    objective: "Sample only explicit timestamps from one granted video track and return bytes with a receipt.",
    workerKind: "media",
    workerLabel: "frame-worker",
    mediaScope: [scope],
    inputArtifactIds: [source.id],
    requiredOutputs: [{ name: "frame sampling note", artifactKind: "frame-sampling-note", required: true }],
    requiredCapabilities: ["media.frames.sample", "report.submit"],
    dependencies: [],
    budget: { wallMs: options.childWallMs ?? 20_000, toolCalls: 1 },
  };
  const decision = await scheduler.requestSpawn(root.taskId, root.agentId, input);
  assert.ok(decision.permit);
  if (options.claimChild !== false) {
    const childClaim = await scheduler.claimTaskLaunch(decision.permit, "deterministic_test", "2026-07-17T12:00:00.000Z");
    assert.equal(childClaim.won, true);
    await scheduler.registerAgent(decision.permit);
    await scheduler.transitionTask(decision.permit.taskId, decision.permit.agentId, "working");
    const childTask = ledger.state().tasks[decision.permit.taskId];
    await ledger.transact(
      { producer: { kind: "launcher", id: "frame-test-executor" }, causationId: decision.requestId },
      () => ({
        pending: [{
          type: "executor.started",
          data: {
            executionId: `execution:frames:${harnessIndex}`,
            taskId: childTask.id,
            agentId: childTask.assignedAgentId,
            launchClaimId: childClaim.claim.id,
            startedAt: "2026-07-17T12:00:00.000Z",
          },
        }] satisfies PendingRuntimeEvent[],
        result: undefined,
      }),
    );
  }
  const workingChild = ledger.state().tasks[decision.permit.taskId];
  const grant = workingChild.grants.find((candidate) => candidate.capability === "media.frames.sample");
  assert.ok(grant?.frameScope);
  return {
    runId,
    directory,
    storeRoot,
    journalPath,
    artifacts,
    ledger,
    scheduler,
    source,
    foreignSource,
    rootTask: ledger.state().tasks[root.taskId],
    rootExecutionId,
    childTask: workingChild,
    childPermit: decision.permit,
    scope,
    grantId: grant.id,
  };
}

async function cleanup(runtime: FrameHarness): Promise<void> {
  await rm(runtime.directory, { recursive: true, force: true });
}

function request(runtime: FrameHarness, operationId: string, timestamps: number[]) {
  return {
    operationId,
    taskId: runtime.childTask.id,
    agentId: runtime.childTask.assignedAgentId,
    grantId: runtime.grantId,
    requestedTimestampsMs: timestamps,
  };
}

test("task-private MCP returns authorized PNG image blocks plus deterministic sampling receipts", async () => {
  const runtime = await frameHarness();
  const host = new BoundedFrameSamplingHost(runtime.ledger, runtime.artifacts);
  const bridge = new BoundedChildFrameBridge(runtime.childTask, host, {
    nextOperationId: () => "operation:frames:mcp",
  });
  const opened = await openChildFrameBridge(bridge);
  const client = new Client({ name: "studio-frame-sampling-test", version: "1" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [MCP_SERVER],
    env: {
      STUDIO_CHILD_FRAME_BRIDGE_URL: opened.endpoint,
      STUDIO_CHILD_FRAME_BRIDGE_TOKEN: opened.token,
    },
    stderr: "pipe",
  });
  try {
    await client.connect(transport);
    const tools = await client.listTools();
    assert.deepEqual(tools.tools.map((tool) => tool.name), ["media_frames_sample"]);
    assert.deepEqual(opened.manifest.tool.grantedRange, { startMs: 10_000, endMs: 11_000 });
    const called = await client.callTool({
      name: "media_frames_sample",
      arguments: { timestampsMs: [10_123, 10_600] },
    });
    assert.equal(called.isError, undefined);
    const contents = called.content;
    if (!Array.isArray(contents)) assert.fail("Frame MCP result content must be an array");
    assert.equal(contents.length, 3);
    const text = contents[0] as { type: string; text?: string };
    assert.equal(text.type, "text");
    const metadata = JSON.parse(text.type === "text" ? text.text ?? "{}" : "{}") as {
      operationId: string;
      receiptId: string;
      receiptContentId: string;
      frames: Array<{ frameId: string; contentId: string; bytes: number; dataBase64?: string }>;
      receipt: FrameSamplingReceipt;
    };
    assert.equal(metadata.operationId, "operation:frames:mcp");
    assert.match(metadata.receiptId, /^frame-sampling:/);
    assert.match(metadata.receiptContentId, /^sha256:/);
    assert.equal(metadata.frames.length, 2);
    assert.equal(metadata.frames.some((frame) => "dataBase64" in frame), false);
    assert.deepEqual(metadata.receipt.nonClaims, {
      visualUnderstanding: "not_assessed",
      sceneUnderstanding: "not_assessed",
      rightFrameSelection: "not_assessed",
      ocr: "not_performed",
    });
    for (const [index, rawContent] of contents.slice(1).entries()) {
      const content = rawContent as { type: string; data?: string; mimeType?: string };
      assert.equal(content.type, "image");
      if (content.type !== "image" || typeof content.data !== "string") {
        assert.fail("Frame MCP content must be an image block");
      }
      const bytes = Buffer.from(content.data, "base64");
      assert.equal(bytes.length, metadata.frames[index].bytes);
      assert.equal(`sha256:${createHash("sha256").update(bytes).digest("hex")}`, metadata.frames[index].contentId);
      assert.deepEqual(inspectRgbPng(bytes), { width: 1024, height: 576 });
    }
    assert.deepEqual(
      metadata.receipt.output.frames.map((frame) => frame.requestedTimestampMs),
      [10_123, 10_600],
    );
    assert.ok(metadata.receipt.output.frames.every((frame) =>
      frame.actualPresentationTimestamp.microseconds >= frame.requestedTimestampMs * 1_000));
    assert.deepEqual(metadata.receipt.source.videoTrack.displayMatrix, {
      present: false,
      rotationDegrees: null,
    });
    assert.equal(metadata.receipt.source.videoTrack.sourceSampleAspectRatio, "1:1");
    assert.deepEqual(metadata.receipt.decoder.transformation, {
      displayMatrix: "apply_if_present",
      sampleAspectRatio: "reset_to_1_1",
      scale: "fit_without_upscale",
      maxWidthPx: 1_024,
      maxHeightPx: 1_024,
      pixelFormat: "rgb24",
      encoding: "png",
      mimeType: "image/png",
    });
    assert.equal(metadata.receipt.execution.decoderProcesses, 7);
    assert.equal(metadata.receipt.execution.wallAccounting, "full_grant_charged_before_atomic_completion");
    for (const frame of metadata.receipt.output.frames) {
      const timestamp = frame.actualPresentationTimestamp;
      assert.equal(timestamp.sourceStartPts, metadata.receipt.source.videoTrack.startPts);
      assert.equal(
        timestamp.microseconds,
        Math.round(((timestamp.pts - timestamp.sourceStartPts) * timestamp.timeBase.numerator * 1_000_000) /
          timestamp.timeBase.denominator),
      );
    }

    const state = runtime.ledger.state();
    assert.equal(state.frameSamples[metadata.operationId].status, "completed");
    assert.equal(state.frameSamples[metadata.operationId].frameArtifactIds.length, 2);
    const events = await runtime.ledger.events();
    const started = events.findIndex((event) => event.type === "media.frames_sampling_started");
    const completed = events.findIndex((event) => event.type === "media.frames_sampling_completed");
    assert.ok(started >= 0 && completed === started + 5);
    assert.ok(events.slice(started + 1, completed).every((event) => event.type === "artifact.recorded"));
    const product = projectProductionRuntimeJournal(events);
    assert.equal(product.outputArtifacts.some((artifact) =>
      state.frameSamples[metadata.operationId].frameArtifactIds.includes(artifact.artifactId)), false);
    const index = await buildRuntimeObservabilityIndex(await readFile(runtime.journalPath, "utf8"));
    assert.ok(index.sources.receipts.some((receipt) =>
      receipt.receiptId === metadata.receiptId && receipt.kind === "frame_sampling"));

    const beforeRejected = events.length;
    await assert.rejects(
      callChildFrameBridge(opened.endpoint, opened.token, { timestampsMs: [10_700] }),
      /rejected|grant call budget/,
    );
    assert.equal((await runtime.ledger.events()).length, beforeRejected);
  } finally {
    await client.close().catch(() => undefined);
    await opened.close();
    await cleanup(runtime);
  }
});

test("Codex launcher mounts the frame-only tool, supplies its honest prompt, and requires a completed sampling op", async () => {
  const runtime = await frameHarness({ claimChild: false });
  const fake = join(runtime.directory, "fake-frame-codex.mjs");
  const debugPath = join(runtime.directory, "fake-frame-codex.debug");
  await writeFile(fake, `
import { appendFileSync } from "node:fs";
const debugPath = ${JSON.stringify(debugPath)};
const stage = (value) => appendFileSync(debugPath, value + "\\n");
const args = process.argv.slice(2);
if (args[0] === "--version") {
  process.stdout.write("codex-cli frame-launcher-test-1.0.0\\n");
  process.exit(0);
}
let prompt = "";
for await (const chunk of process.stdin) prompt += chunk;
if (!prompt.includes("scheduler-granted media tools: media_frames_sample") ||
    !prompt.includes("actual image/png content") ||
    prompt.includes("exposes no media bytes and no media tools")) {
  throw new Error("frame-only worker prompt is contradictory");
}
stage("prompt");
const configs = args.flatMap((value, index) => value === "-c" ? [args[index + 1]] : []);
for (const required of [
  "mcp_servers.studio_frames.command=",
  "mcp_servers.studio_frames.args=",
  "mcp_servers.studio_frames.required=true",
  "mcp_servers.studio_frames.enabled_tools=[\\\"media_frames_sample\\\"]",
  "mcp_servers.studio_frames.env_vars=",
]) {
  if (!configs.some((config) => config.startsWith(required))) throw new Error("missing frame MCP config " + required);
}
stage("config");
if (!process.env.STUDIO_CHILD_FRAME_BRIDGE_URL || !process.env.STUDIO_CHILD_FRAME_BRIDGE_TOKEN) {
  throw new Error("missing task-private frame bridge environment");
}
stage("environment");
const response = await fetch(process.env.STUDIO_CHILD_FRAME_BRIDGE_URL + "/call", {
  method: "POST",
  headers: {
    Authorization: "Bearer " + process.env.STUDIO_CHILD_FRAME_BRIDGE_TOKEN,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ name: "media_frames_sample", arguments: { timestampsMs: [10123] } }),
});
stage("response:" + response.status);
const body = await response.json();
stage("body:" + JSON.stringify(body.error || { frames: body.frames?.length }));
if (!response.ok || !body.frames?.[0]?.dataBase64) {
  throw new Error("frame bridge did not return authorized image bytes");
}
const final = {
  summary: "The host completed one bounded frame-sampling operation; no visual meaning was assessed.",
  outputs: [{
    name: "frame sampling note",
    kind: "frame-sampling-note",
    content: "Host operation " + body.operationId + " returned receipt " + body.receiptId + ".",
  }],
};
process.stdout.write([
  JSON.stringify({ type: "thread.started", thread_id: "thread:frame-launcher" }),
  JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: JSON.stringify(final) } }),
  JSON.stringify({ type: "turn.completed", usage: { input_tokens: 10, cached_input_tokens: 0, output_tokens: 8, reasoning_output_tokens: 0 } }),
  "",
].join("\\n"));
`);
  try {
    const reports = new BoundedReportHost(runtime.ledger, () => "report:frame-launcher", runtime.artifacts);
    let result;
    try {
      result = await new CodexExecWorkerLauncher(
        runtime.ledger,
        runtime.scheduler,
        runtime.artifacts,
        reports,
        {
          executable: process.execPath,
          executableArgsPrefix: [fake],
          nextExecutionId: () => "execution:frame-launcher",
          nextFrameOperationId: () => "operation:frames:launcher",
          maximumWallMs: 20_000,
        },
      ).launch(runtime.childPermit);
    } catch (cause) {
      const debug = await readFile(debugPath, "utf8").catch(() => "no fake-worker stage was recorded");
      throw new Error(`Frame launcher fixture failed after: ${debug.trim()}`, { cause });
    }
    assert.equal(result.execution.outcome, "completed");
    assert.equal(result.report.status, "submitted");
    assert.deepEqual(result.artifacts.map((artifact) => artifact.kind), ["frame-sampling-note"]);
    assert.equal(runtime.ledger.state().frameSamples["operation:frames:launcher"].status, "completed");
    assert.equal(runtime.ledger.state().artifacts[result.artifacts[0].id].origin.kind, "worker_output");
  } finally {
    await cleanup(runtime);
  }
});

test("model-authored scheduler contract can request the bounded frame capability without visual admission", async () => {
  const runtime = await frameHarness();
  try {
    const toolCallId = "tool-call:root-frame-request";
    await runtime.ledger.transact(
      { producer: { kind: "launcher", id: "model-orchestrator-bridge" }, causationId: runtime.rootExecutionId },
      () => ({
        pending: [{
          type: "orchestrator.tool_called",
          data: {
            callId: toolCallId,
            executionId: runtime.rootExecutionId,
            taskId: runtime.rootTask.id,
            tool: "task_spawn_request",
          },
        }] satisfies PendingRuntimeEvent[],
        result: undefined,
      }),
    );
    const decision = await runtime.scheduler.requestModelSpawn(
      runtime.rootTask.id,
      runtime.rootTask.assignedAgentId,
      runtime.rootExecutionId,
      toolCallId,
      {
        workloadKey: "frames:model-authored-sampling-only",
        objective: "Sample one bounded video scope and return only a non-semantic operation note.",
        workerKind: "media",
        workerLabel: "frame-sampling-only",
        mediaScope: [runtime.scope],
        inputArtifactIds: [runtime.source.id],
        requiredOutputs: [{ name: "frame sampling note", artifactKind: "frame-sampling-note", required: true }],
        requiredCapabilities: ["media.frames.sample", "report.submit"],
        dependencyWorkloadKeys: [],
        budget: { wallMs: 5_000, toolCalls: 1 },
      },
    );
    assert.equal(decision.accepted, true);
    const task = runtime.ledger.state().tasks[decision.permit!.taskId];
    const grant = task.grants.find((candidate) => candidate.capability === "media.frames.sample");
    assert.deepEqual(grant?.mediaScope, [runtime.scope]);
    assert.deepEqual(grant?.frameScope?.limits, FRAME_SAMPLING_LIMITS);
    assert.equal(task.requiredOutputs[0].artifactKind, "frame-sampling-note");
    await assert.rejects(
      runtime.scheduler.requestModelSpawn(
        runtime.rootTask.id,
        runtime.rootTask.assignedAgentId,
        runtime.rootExecutionId,
        "tool-call:unused-because-contract-is-invalid",
        {
          workloadKey: "frames:forged-host-receipt",
          objective: "This must not let worker prose impersonate the host frame receipt.",
          workerKind: "media",
          workerLabel: "forged-frame-receipt",
          mediaScope: [runtime.scope],
          inputArtifactIds: [runtime.source.id],
          requiredOutputs: [{
            name: "forged host receipt",
            artifactKind: "studio.frame-sampling.receipt.v1",
            required: true,
          }],
          requiredCapabilities: ["media.frames.sample", "report.submit"],
          dependencyWorkloadKeys: [],
          budget: { wallMs: 5_000, toolCalls: 1 },
        },
      ),
      /host-only frame artifact kind/,
    );
  } finally {
    await cleanup(runtime);
  }
});

test("cold replay reopens source, receipt, manifest, every frame, and decoder lineage and detects tamper", async () => {
  const runtime = await frameHarness();
  const decoder = new FfmpegFrameDecoder();
  try {
    const produced = await new BoundedFrameSamplingHost(runtime.ledger, runtime.artifacts, { decoder }).sample(
      request(runtime, "operation:frames:cold", [10_123, 10_600]),
    );
    const cold = await RuntimeLedger.open(runtime.runId, new FileEventJournal(runtime.journalPath));
    const reopened = await auditFrameSampling(cold.state(), runtime.artifacts, decoder, "operation:frames:cold");
    assert.deepEqual(
      reopened.frames.map((frame) => frame.identity.content.contentId),
      produced.frames.map((frame) => frame.identity.content.contentId),
    );

    const artifactIds = [
      runtime.source.id,
      reopened.manifestArtifact.id,
      reopened.receiptArtifact.id,
      ...reopened.frames.map((frame) => frame.artifact.id),
    ];
    for (const artifactId of artifactIds) {
      const artifact = cold.state().artifacts[artifactId];
      const path = join(runtime.storeRoot, artifact.storageKey);
      const original = await readFile(path);
      await writeFile(path, Buffer.from("tampered-frame-audit-object", "utf8"));
      await assert.rejects(
        auditFrameSampling(cold.state(), runtime.artifacts, decoder, "operation:frames:cold"),
        /no longer matches|failed content verification/,
      );
      await writeFile(path, original);
    }

    const drifted: FrameDecoder = {
      sample: async () => { throw new Error("not used by cold audit"); },
      verifyLineage: async () => { throw new Error("not used by cold audit"); },
      currentLineage: async (): Promise<FrameDecoderLineage> => ({
        ...reopened.receipt.decoder,
        ffmpeg: {
          ...reopened.receipt.decoder.ffmpeg,
          version: `${reopened.receipt.decoder.ffmpeg.version} drifted`,
        },
      }),
    };
    await assert.rejects(
      auditFrameSampling(cold.state(), runtime.artifacts, drifted, "operation:frames:cold"),
      /decoder lineage drifted/,
    );
  } finally {
    await cleanup(runtime);
  }
});

test("absent video, out-of-range, duplicate, and ungranted calls fail before decoding", async () => {
  const runtime = await frameHarness();
  const host = new BoundedFrameSamplingHost(runtime.ledger, runtime.artifacts);
  const bridge = new BoundedChildFrameBridge(runtime.childTask, host);
  try {
    const before = (await runtime.ledger.events()).length;
    await assert.rejects(bridge.call({ timestampsMs: [9_999] }), /escape the task-private granted range/);
    await assert.rejects(bridge.call({ timestampsMs: [10_100, 10_100] }), /unique, increasing/);
    await assert.rejects(
      bridge.call({ timestampsMs: [10_001, 10_002, 10_003, 10_004, 10_005, 10_006, 10_007, 10_008, 10_009] }),
      /1-8 unique/,
    );
    await assert.rejects(
      new BoundedChildFrameBridge(runtime.rootTask, host).call({ timestampsMs: [10_100] }),
      /no exact frame-sampling grant/,
    );
    assert.equal((await runtime.ledger.events()).length, before);

    const noVideo = await runtime.scheduler.requestSpawn(runtime.rootTask.id, runtime.rootTask.assignedAgentId, {
      workloadKey: "frames:no-video-track",
      objective: "This must be rejected because the selected registered track is audio.",
      workerKind: "media",
      workerLabel: "no-video",
      mediaScope: [{ ...runtime.scope, trackId: "stream:1" }],
      inputArtifactIds: [runtime.source.id],
      requiredOutputs: [{ name: "none", artifactKind: "none", required: true }],
      requiredCapabilities: ["media.frames.sample", "report.submit"],
      dependencies: [],
      budget: { wallMs: 20_000, toolCalls: 1 },
    });
    assert.equal(noVideo.permit, null);

    const tooLong = await runtime.scheduler.requestSpawn(runtime.rootTask.id, runtime.rootTask.assignedAgentId, {
      workloadKey: "frames:duration-over-limit",
      objective: "This must be rejected because the frame scope exceeds thirty seconds.",
      workerKind: "media",
      workerLabel: "too-long",
      mediaScope: [{ ...runtime.scope, endMs: 40_001 }],
      inputArtifactIds: [runtime.source.id],
      requiredOutputs: [{ name: "none", artifactKind: "none", required: true }],
      requiredCapabilities: ["media.frames.sample", "report.submit"],
      dependencies: [],
      budget: { wallMs: 20_000, toolCalls: 1 },
    });
    assert.equal(tooLong.rejection, "capability_not_grantable");

    const foreignSource = await runtime.scheduler.requestSpawn(runtime.rootTask.id, runtime.rootTask.assignedAgentId, {
      workloadKey: "frames:foreign-source",
      objective: "This must be rejected because the frame source differs from the task context source.",
      workerKind: "media",
      workerLabel: "foreign-source",
      mediaScope: [{ ...runtime.scope, artifactId: runtime.foreignSource.id }],
      inputArtifactIds: [runtime.foreignSource.id],
      requiredOutputs: [{ name: "none", artifactKind: "none", required: true }],
      requiredCapabilities: ["media.frames.sample", "report.submit"],
      dependencies: [],
      budget: { wallMs: 20_000, toolCalls: 1 },
    });
    assert.equal(foreignSource.rejection, "scope_violation");
  } finally {
    await cleanup(runtime);
  }
});

test("source drift fails after authorization with a typed receipt-free operation", async () => {
  const runtime = await frameHarness();
  try {
    const sourcePath = join(runtime.storeRoot, runtime.source.storageKey);
    await writeFile(sourcePath, Buffer.from("changed-after-frame-grant", "utf8"));
    await assert.rejects(
      new BoundedFrameSamplingHost(runtime.ledger, runtime.artifacts).sample(
        request(runtime, "operation:frames:source-drift", [10_100]),
      ),
      /no longer matches its registered content identity/,
    );
    const operation = runtime.ledger.state().frameSamples["operation:frames:source-drift"];
    assert.equal(operation.status, "failed");
    assert.equal(operation.failure, "source_drift");
    assert.equal(operation.receiptArtifactId, null);
    assert.deepEqual(operation.frameArtifactIds, []);
  } finally {
    await cleanup(runtime);
  }
});

const CRC_TABLE = Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit += 1) crc = (crc & 1) !== 0 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  return crc >>> 0;
});

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const name = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, checksum]);
}

function rgbPng(width: number, height: number, noisy: boolean): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  const raw = Buffer.alloc(height * (1 + width * 3));
  let state = 0x12345678;
  for (let row = 0; row < height; row += 1) {
    const offset = row * (1 + width * 3);
    raw[offset] = 0;
    for (let byte = 1; byte < 1 + width * 3; byte += 1) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      raw[offset + byte] = noisy ? state >>> 24 : (row + byte) & 0xff;
    }
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(raw, { level: noisy ? 0 : 6 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

class FixtureFrameDecoder implements FrameDecoder {
  private readonly lineage: FrameDecoderLineage;
  private readonly mode:
    | "oversized"
    | "duplicate"
    | "identical"
    | "output_dimension"
    | "input_dimension"
    | "aggregate"
    | "timeout"
    | "lineage_drift";

  constructor(
    lineage: FrameDecoderLineage,
    mode: FixtureFrameDecoder["mode"],
  ) {
    this.lineage = lineage;
    this.mode = mode;
  }

  async currentLineage(): Promise<FrameDecoderLineage> {
    return structuredClone(this.lineage);
  }

  async verifyLineage(): Promise<{ lineage: FrameDecoderLineage; decoderProcesses: number }> {
    const lineage = structuredClone(this.lineage);
    if (this.mode === "lineage_drift") lineage.ffmpeg.version = `${lineage.ffmpeg.version}:changed`;
    return { lineage, decoderProcesses: 2 };
  }

  async sample(input: Parameters<FrameDecoder["sample"]>[0]): Promise<FrameDecodeResult> {
    if (this.mode === "timeout") await new Promise((resolveDelay) => setTimeout(resolveDelay, 25));
    const frames = [];
    for (const [index, requestedTimestampMs] of input.requestedTimestampsMs.entries()) {
      const path = join(input.outputDirectory, `fixture-${index}.png`);
      const bytes = this.mode === "oversized"
        ? rgbPng(1_024, 1_024, true)
        : this.mode === "output_dimension"
          ? rgbPng(1_025, 2, false)
          : this.mode === "aggregate"
            ? rgbPng(800, 800, true)
            : rgbPng(2, 2, false);
      await writeFile(path, bytes);
      frames.push({
        path,
        requestedTimestampMs,
        actualPresentationTimestamp: {
          pts: this.mode === "duplicate" ? input.requestedTimestampsMs[0] : requestedTimestampMs,
          sourceStartPts: 0,
          timeBase: { numerator: 1, denominator: 1_000 },
          microseconds: (this.mode === "duplicate" ? input.requestedTimestampsMs[0] : requestedTimestampMs) * 1_000,
        },
        width: this.mode === "oversized" ? 1_024 : this.mode === "output_dimension" ? 1_025 : this.mode === "aggregate" ? 800 : 2,
        height: this.mode === "oversized" ? 1_024 : this.mode === "output_dimension" ? 2 : this.mode === "aggregate" ? 800 : 2,
      });
    }
    return {
      lineage: structuredClone(this.lineage),
      videoTrack: {
        id: input.registeredTrack.id,
        index: input.registeredTrack.index,
        codec: input.registeredTrack.codec,
        width: this.mode === "input_dimension" ? 8_193 : 1_280,
        height: 720,
        durationMs: RUN_DURATION_MS,
        startPts: 0,
        timeBase: { numerator: 1, denominator: 1_000 },
        sourceSampleAspectRatio: "1:1",
        displayMatrix: { present: false, rotationDegrees: null },
      },
      frames,
      decoderProcesses: frames.length + 3,
    };
  }
}

test("pixel-identical frames remain distinct by request and actual PTS identities", async () => {
  const runtime = await frameHarness();
  try {
    const lineage = await new FfmpegFrameDecoder().currentLineage(performance.now() + 5_000);
    const result = await new BoundedFrameSamplingHost(runtime.ledger, runtime.artifacts, {
      decoder: new FixtureFrameDecoder(lineage, "identical"),
    }).sample(request(runtime, "operation:frames:identical", [10_100, 10_200]));
    assert.equal(new Set(result.frames.map((frame) => frame.identity.content.contentId)).size, 1);
    assert.equal(new Set(result.frames.map((frame) => frame.identity.frameId)).size, 2);
    assert.equal(new Set(result.frames.map((frame) => frame.identity.artifactId)).size, 2);
  } finally {
    await cleanup(runtime);
  }
});

for (const mode of ["oversized", "duplicate"] as const) {
  test(`${mode} decoder output fails closed with a typed durable failure and no frame artifacts`, async () => {
    const runtime = await frameHarness();
    try {
      const lineage = await new FfmpegFrameDecoder().currentLineage(performance.now() + 5_000);
      const host = new BoundedFrameSamplingHost(runtime.ledger, runtime.artifacts, {
        decoder: new FixtureFrameDecoder(lineage, mode),
      });
      const timestamps = mode === "duplicate" ? [10_100, 10_200] : [10_100];
      await assert.rejects(
        host.sample(request(runtime, `operation:frames:${mode}`, timestamps)),
        mode === "oversized" ? /per-frame byte limit/ : /ordered frame request/,
      );
      const state = runtime.ledger.state();
      assert.equal(state.frameSamples[`operation:frames:${mode}`].status, "failed");
      assert.equal(
        state.frameSamples[`operation:frames:${mode}`].failure,
        mode === "oversized" ? "decoded_frame_oversized" : "duplicate_actual_frame",
      );
      assert.deepEqual(state.frameSamples[`operation:frames:${mode}`].frameArtifactIds, []);
      assert.equal(Object.values(state.artifacts).some((artifact) =>
        artifact.origin.kind === "sampled_frame" && artifact.origin.operationId === `operation:frames:${mode}`), false);
    } finally {
      await cleanup(runtime);
    }
  });
}

for (const scenario of [
  {
    mode: "output_dimension" as const,
    timestamps: [10_100],
    message: /output dimension limits/,
    failure: "decoded_frame_oversized",
  },
  {
    mode: "input_dimension" as const,
    timestamps: [10_100],
    message: /input dimension limits/,
    failure: "decoder_failed",
  },
  {
    mode: "aggregate" as const,
    timestamps: [10_100, 10_200, 10_300, 10_400, 10_500],
    message: /aggregate byte limit/,
    failure: "decoded_frame_oversized",
  },
  {
    mode: "lineage_drift" as const,
    timestamps: [10_100],
    message: /lineage changed/,
    failure: "decoder_failed",
  },
] as const) {
  test(`${scenario.mode} decoder output fails closed before durable publication`, async () => {
    const runtime = await frameHarness();
    try {
      const lineage = await new FfmpegFrameDecoder().currentLineage(performance.now() + 5_000);
      const operationId = `operation:frames:${scenario.mode}`;
      await assert.rejects(
        new BoundedFrameSamplingHost(runtime.ledger, runtime.artifacts, {
          decoder: new FixtureFrameDecoder(lineage, scenario.mode),
        }).sample(request(runtime, operationId, [...scenario.timestamps])),
        scenario.message,
      );
      const state = runtime.ledger.state();
      assert.equal(state.frameSamples[operationId].status, "failed");
      assert.equal(state.frameSamples[operationId].failure, scenario.failure);
      assert.deepEqual(state.frameSamples[operationId].frameArtifactIds, []);
    } finally {
      await cleanup(runtime);
    }
  });
}

test("wall timeout and temporary allocation failure close the started operation without artifacts", async () => {
  const timed = await frameHarness({ childWallMs: 5 });
  try {
    const lineage = await new FfmpegFrameDecoder().currentLineage(performance.now() + 5_000);
    await assert.rejects(
      new BoundedFrameSamplingHost(timed.ledger, timed.artifacts, {
        decoder: new FixtureFrameDecoder(lineage, "timeout"),
      }).sample(request(timed, "operation:frames:timeout", [10_100])),
      /wall-time grant/,
    );
    assert.deepEqual(timed.ledger.state().frameSamples["operation:frames:timeout"], {
      ...timed.ledger.state().frameSamples["operation:frames:timeout"],
      status: "failed",
      failure: "decoder_timeout",
      manifestArtifactId: null,
      receiptArtifactId: null,
      frameArtifactIds: [],
    });
  } finally {
    await cleanup(timed);
  }

  const allocation = await frameHarness();
  try {
    await assert.rejects(
      new BoundedFrameSamplingHost(allocation.ledger, allocation.artifacts, {
        temporaryRoot: join(allocation.directory, "missing-parent", "nested"),
      }).sample(request(allocation, "operation:frames:temp-allocation", [10_100])),
      /ENOENT/,
    );
    const operation = allocation.ledger.state().frameSamples["operation:frames:temp-allocation"];
    assert.equal(operation.status, "failed");
    assert.equal(operation.failure, "decoder_failed");
    assert.deepEqual(operation.frameArtifactIds, []);
  } finally {
    await cleanup(allocation);
  }
});
