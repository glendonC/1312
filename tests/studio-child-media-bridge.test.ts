import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

import { ContentAddressedArtifactStore } from "../src/studio/runtime/production/artifactStore.ts";
import {
  BoundedChildMediaBridge,
  callChildMediaBridge,
  fetchChildMediaManifest,
  openChildMediaBridge,
} from "../src/studio/runtime/production/executor/childMediaBridge.ts";
import { MemoryEventJournal, RuntimeLedger } from "../src/studio/runtime/production/journal.ts";
import { FfmpegCapabilityHost } from "../src/studio/runtime/production/mediaHost.ts";
import type {
  Capability,
  SourceArtifactDescriptor,
  SpawnRequestInput,
} from "../src/studio/runtime/production/model.ts";
import { BoundedRuntimeScheduler, type RuntimeIdentityFactory } from "../src/studio/runtime/production/scheduler.ts";
import { runtimeTestJobContext } from "./runtime-test-job-context.ts";
import { projectProductionRuntimeJournal } from "../src/studio/runtime/production/studioProjection.ts";

const FIXTURE = resolve("public/demo/runs/run-005");
const MCP_SERVER = resolve("src/studio/runtime/production/executor/mediaMcpServer.ts");

class SequenceIdentities implements RuntimeIdentityFactory {
  private value = 0;

  next(kind: "request" | "task" | "agent" | "grant"): string {
    this.value += 1;
    return `${kind}:bridge-${this.value}`;
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
    publication: "public",
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

async function bridgeHarness(
  capability: Extract<Capability, "media.extract" | "media.seek">,
  mediaHostOptions: NonNullable<ConstructorParameters<typeof FfmpegCapabilityHost>[2]> = {},
) {
  const directory = await mkdtemp(join(tmpdir(), "studio-child-media-bridge-"));
  const artifacts = new ContentAddressedArtifactStore(join(directory, "artifacts"));
  const source = await artifacts.registerSource("runtime:child-media-bridge", await sourceDescriptor());
  const ledger = await RuntimeLedger.open("runtime:child-media-bridge", new MemoryEventJournal(), {
    now: () => new Date("2026-07-15T12:00:00.000Z"),
  });
  await artifacts.record(ledger, source);
  const scheduler = new BoundedRuntimeScheduler(ledger, {
    maxDepth: 1,
    maxActiveWorkers: 2,
    runBudget: { wallMs: 30_000, toolCalls: 3 },
    grantableCapabilities: ["task.spawn.request", "report.submit", "media.extract", "media.seek"],
  }, new SequenceIdentities());
  const scope = { artifactId: source.id, trackId: "stream:0", startMs: 1_000, endMs: 1_800 };
  const root = await scheduler.createRoot({
    workloadKey: "root:child-media-bridge",
    objective: "Authorize one bounded child media bridge test.",
    workerKind: "orchestrator",
    workerLabel: "bridge-root",
    mediaScope: [scope],
    inputArtifactIds: [source.id],
    requiredOutputs: [{ name: "run report", artifactKind: "run-report", required: true }],
    requiredCapabilities: ["task.spawn.request"],
    dependencies: [],
    budget: { wallMs: 10_000, toolCalls: 1 },
  }, runtimeTestJobContext({ source, range: { startMs: 1_000, endMs: 1_800 } }));
  await scheduler.claimTaskLaunch(root, "deterministic_test", "2026-07-15T12:00:00.000Z");
  await scheduler.registerAgent(root);
  await scheduler.transitionTask(root.taskId, root.agentId, "working");
  const input: SpawnRequestInput = {
    workloadKey: `${capability}:child-media-bridge`,
    objective: `Perform one authorized ${capability} call through the child bridge.`,
    workerKind: "media",
    workerLabel: "bridge-child",
    mediaScope: [scope],
    inputArtifactIds: [source.id],
    requiredOutputs: [{ name: "bridge report", artifactKind: "worker-execution-report", required: true }],
    requiredCapabilities: [capability, "report.submit"],
    dependencies: [],
    budget: { wallMs: 20_000, toolCalls: 1 },
  };
  const decision = await scheduler.requestSpawn(root.taskId, root.agentId, input);
  assert.ok(decision.permit);
  await scheduler.claimTaskLaunch(decision.permit, "deterministic_test", "2026-07-15T12:00:00.000Z");
  await scheduler.registerAgent(decision.permit);
  await scheduler.transitionTask(decision.permit.taskId, decision.permit.agentId, "working");
  const task = ledger.state().tasks[decision.permit.taskId];
  let operation = 0;
  const adapter = new BoundedChildMediaBridge(
    task,
    new FfmpegCapabilityHost(ledger, artifacts, { timeoutMs: 20_000, ...mediaHostOptions }),
    { nextOperationId: () => `operation:child-media-bridge:${capability}:${++operation}` },
  );
  const opened = await openChildMediaBridge(adapter);
  return { directory, ledger, source, task, scope, adapter, opened };
}

test("stdio MCP child seek crosses grant, budget, media host, journal, artifact, and production projection", async () => {
  const runtime = await bridgeHarness("media.seek");
  const client = new Client({ name: "studio-child-media-bridge-test", version: "1" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [MCP_SERVER],
    env: {
      STUDIO_CHILD_MEDIA_BRIDGE_URL: runtime.opened.endpoint,
      STUDIO_CHILD_MEDIA_BRIDGE_TOKEN: runtime.opened.token,
    },
    stderr: "pipe",
  });
  try {
    await assert.rejects(
      fetchChildMediaManifest(runtime.opened.endpoint, "wrong-token"),
      /credential is invalid/,
    );
    await client.connect(transport);
    const tools = await client.listTools();
    assert.deepEqual(tools.tools.map((tool) => tool.name), ["media_seek"]);
    assert.deepEqual(runtime.opened.manifest.tools[0].mediaScope, [runtime.scope]);

    const called = await client.callTool({ name: "media_seek", arguments: runtime.scope });
    assert.equal(called.isError, undefined);
    const contents = called.content;
    if (!Array.isArray(contents)) assert.fail("MCP tool result content must be an array");
    const content = contents[0] as { type: string; text?: string };
    assert.equal(content.type, "text");
    const result = JSON.parse(content.type === "text" ? content.text ?? "{}" : "{}") as {
      schema: string;
      capability: string;
      operationId: string;
      outputArtifactId: string;
      receiptId: string;
      receiptContentId: string;
      receipt: {
        schema: string;
        observation: {
          kind: string;
          value: string;
          range: { startMs: number; endMs: number };
        };
      };
    };
    assert.equal(result.schema, "studio.child-media-tool-result.v1");
    assert.equal(result.capability, "media.seek");
    assert.equal(result.operationId, "operation:child-media-bridge:media.seek:1");
    assert.match(result.receiptId, /^receipt:/);
    assert.match(result.receiptContentId, /^sha256:/);
    assert.equal(result.receipt.schema, "studio.media-perception.receipt.v1");
    assert.equal(result.receipt.observation.kind, "audio_activity");
    assert.equal(result.receipt.observation.value, "signal");
    assert.deepEqual(result.receipt.observation.range, {
      startMs: runtime.scope.startMs,
      endMs: runtime.scope.endMs,
    });

    const state = runtime.ledger.state();
    assert.equal(state.operations[result.operationId].status, "completed");
    assert.equal(state.operations[result.operationId].outputArtifactId, result.outputArtifactId);
    assert.equal(state.artifacts[result.outputArtifactId].origin.kind, "media_observation");
    const events = await runtime.ledger.events();
    assert.ok(events.some((event) => event.type === "media.operation_started"));
    assert.ok(events.some((event) => event.type === "media.operation_completed"));
    const product = projectProductionRuntimeJournal(events);
    assert.equal(product.operations.length, 1);
    assert.equal(product.operations[0].capability, "media.seek");
    assert.equal(product.operations[0].receiptId, result.receiptId);
    assert.equal(product.operations[0].observation?.value, "signal");
    assert.ok(product.outputArtifacts.some((artifact) => artifact.artifactId === result.outputArtifactId));

    const beforeRejected = events.length;
    await assert.rejects(
      callChildMediaBridge(runtime.opened.endpoint, runtime.opened.token, "media_extract", runtime.scope),
      /no media.extract grant/,
    );
    await assert.rejects(
      callChildMediaBridge(runtime.opened.endpoint, runtime.opened.token, "media_seek", runtime.scope),
      /rejected or failed/,
    );
    assert.equal((await runtime.ledger.events()).length, beforeRejected);
  } finally {
    await client.close().catch(() => undefined);
    await runtime.opened.close();
    await rm(runtime.directory, { recursive: true, force: true });
  }
});

test("child extract bridge rejects open arguments and returns only a real receipted artifact identity", async () => {
  const runtime = await bridgeHarness("media.extract");
  try {
    const before = (await runtime.ledger.events()).length;
    await assert.rejects(
      runtime.adapter.call("media_extract", { ...runtime.scope, outputPath: "/tmp/caller.wav" }),
      /requires only artifactId, trackId/,
    );
    assert.equal((await runtime.ledger.events()).length, before);

    const result = await callChildMediaBridge(
      runtime.opened.endpoint,
      runtime.opened.token,
      "media_extract",
      runtime.scope,
    );
    assert.equal(result.capability, "media.extract");
    assert.equal(result.receipt.capability, "media.extract");
    assert.equal(result.receipt.output.artifactId, result.outputArtifactId);
    const artifact = runtime.ledger.state().artifacts[result.outputArtifactId];
    assert.equal(artifact.origin.kind, "media_operation");
    assert.deepEqual(artifact.sourceArtifactIds, [runtime.source.id]);
    assert.equal("path" in result, false);
    assert.equal(JSON.stringify(result).includes(runtime.directory), false);
  } finally {
    await runtime.opened.close();
    await rm(runtime.directory, { recursive: true, force: true });
  }
});

test("authorized child bridge failure journals and projects the existing host's failed operation", async () => {
  const runtime = await bridgeHarness("media.seek", { ffmpeg: "/missing/studio-test-ffmpeg" });
  try {
    await assert.rejects(
      callChildMediaBridge(runtime.opened.endpoint, runtime.opened.token, "media_seek", runtime.scope),
      /rejected or failed/,
    );
    const events = await runtime.ledger.events();
    assert.ok(events.some((event) => event.type === "media.operation_started"));
    assert.ok(events.some((event) => event.type === "media.operation_failed"));
    assert.equal(events.some((event) => event.type === "media.operation_completed"), false);
    const product = projectProductionRuntimeJournal(events);
    assert.equal(product.operations.length, 1);
    assert.equal(product.operations[0].capability, "media.seek");
    assert.equal(product.operations[0].status, "failed");
    assert.equal(product.operations[0].receiptId, null);
    assert.equal(product.outputArtifacts.length, 0);
  } finally {
    await runtime.opened.close();
    await rm(runtime.directory, { recursive: true, force: true });
  }
});
