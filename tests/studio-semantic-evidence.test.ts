import assert from "node:assert/strict";
import { appendFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

import { canonicalSha256, ContentAddressedArtifactStore } from "../src/studio/runtime/production/artifactStore.ts";
import type {
  CurrentRunRecognizerDescriptor,
  RuntimeArtifact,
  RuntimeLimits,
  SourceArtifactDescriptor,
  TaskRecord,
} from "../src/studio/runtime/production/model.ts";
import type {
  CurrentRunRecognizerInput,
  CurrentRunRecognizerResult,
  CurrentRunSpeechRecognizer,
} from "../src/studio/runtime/production/currentRunSpeechRecognizer.ts";
import {
  BoundedChildSemanticEvidenceBridge,
  callChildSemanticEvidenceBridge,
  openChildSemanticEvidenceBridge,
} from "../src/studio/runtime/production/executor/childSemanticEvidenceBridge.ts";
import { validateWorkerResult } from "../src/studio/runtime/production/executor/workerContract.ts";
import { MemoryEventJournal, RuntimeLedger } from "../src/studio/runtime/production/journal.ts";
import type { PendingRuntimeEvent } from "../src/studio/runtime/production/protocol.ts";
import { projectRuntimeEvents } from "../src/studio/runtime/production/projection.ts";
import { reopenSemanticEvidence, semanticEvidenceCitation } from "../src/studio/runtime/production/semanticEvidenceAudit.ts";
import { SpeechTranscribeCapabilityHost } from "../src/studio/runtime/production/semanticEvidenceHost.ts";
import { BoundedRuntimeScheduler, type RuntimeIdentityFactory } from "../src/studio/runtime/production/scheduler.ts";
import { projectProductionRuntimeJournal } from "../src/studio/runtime/production/studioProjection.ts";
import { adaptAuthenticatedProductionRuntime } from "../src/studio/runtime/production/authenticatedStudioProjection.ts";
import { runtimeTestJobContext } from "./runtime-test-job-context.ts";
import { loadRuntimeInspectorJournal } from "../src/studio/runtime/production/runtimeInspector/journalLoader.ts";

const FIXTURE = resolve("public/demo/runs/run-005");
const MCP_SERVER = resolve("src/studio/runtime/production/executor/semanticEvidenceMcpServer.ts");

class Identities implements RuntimeIdentityFactory {
  private nextValue = 0;
  next(kind: "request" | "task" | "agent" | "grant"): string {
    this.nextValue += 1;
    return `${kind}:semantic-${this.nextValue}`;
  }
  secret(): string {
    this.nextValue += 1;
    return `secret-${this.nextValue}`;
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
  maxDepth: 1,
  maxActiveWorkers: 4,
  runBudget: { wallMs: 120_000, toolCalls: 20 },
  grantableCapabilities: ["task.spawn.request", "report.submit", "speech.transcribe"],
};

function descriptor(overrides: Partial<CurrentRunRecognizerDescriptor> = {}): CurrentRunRecognizerDescriptor {
  const configurationBody = {
    id: "studio.test-current-run-recognizer.timed-segments.v1",
    language: "ko",
    timestampMode: "segment" as const,
    segmentation: "producer_defined" as const,
  };
  return {
    id: "studio.test-current-run-speech-recognizer",
    version: "1",
    model: "test-seam-current-run-model",
    runtime: { id: "node.test", version: process.version },
    configuration: {
      ...configurationBody,
      contentId: `sha256:${canonicalSha256(configurationBody)}`,
    },
    executionScope: "current_run",
    fixtureContentId: null,
    ...overrides,
  };
}

class Recognizer implements CurrentRunSpeechRecognizer {
  readonly inputs: CurrentRunRecognizerInput[] = [];
  private readonly run: (input: CurrentRunRecognizerInput, signal: AbortSignal) => Promise<CurrentRunRecognizerResult>;
  private readonly described: unknown;
  constructor(
    run: (input: CurrentRunRecognizerInput, signal: AbortSignal) => Promise<CurrentRunRecognizerResult>,
    described: unknown = descriptor(),
  ) {
    this.run = run;
    this.described = described;
  }
  async describe(): Promise<CurrentRunRecognizerDescriptor> {
    return this.described as CurrentRunRecognizerDescriptor;
  }
  async recognize(input: CurrentRunRecognizerInput, signal: AbortSignal): Promise<CurrentRunRecognizerResult> {
    this.inputs.push({ ...input, sourcePath: "[host-private-path]" });
    return this.run(input, signal);
  }
}

interface Harness {
  directory: string;
  artifactRoot: string;
  ledger: RuntimeLedger;
  artifacts: ContentAddressedArtifactStore;
  scheduler: BoundedRuntimeScheduler;
  source: RuntimeArtifact;
  rootTask: TaskRecord;
  children: Array<{ task: TaskRecord; scope: { artifactId: string; trackId: string; startMs: number; endMs: number } }>;
}

async function harness(ranges: Array<{ startMs: number; endMs: number }> = [{ startMs: 0, endMs: 1_000 }]): Promise<Harness> {
  const directory = await mkdtemp(join(tmpdir(), "studio-semantic-evidence-"));
  const artifactRoot = join(directory, "artifacts");
  const artifacts = new ContentAddressedArtifactStore(artifactRoot);
  const ledger = await RuntimeLedger.open("runtime:semantic-evidence-test", new MemoryEventJournal(), {
    now: () => new Date("2026-07-16T12:00:00.000Z"),
  });
  const source = await artifacts.registerSource(ledger.runId, await sourceDescriptor());
  await artifacts.record(ledger, source);
  const scheduler = new BoundedRuntimeScheduler(ledger, LIMITS, new Identities());
  const rootScope = [{ artifactId: source.id, trackId: "stream:0", startMs: 0, endMs: 2_000 }];
  const root = await scheduler.createRoot({
    workloadKey: "root:semantic-evidence",
    objective: "Delegate bounded current-run semantic evidence work.",
    workerKind: "orchestrator",
    workerLabel: "semantic-root",
    mediaScope: rootScope,
    inputArtifactIds: [source.id],
    requiredOutputs: [{ name: "root terminal", artifactKind: "root-terminal", required: true }],
    requiredCapabilities: ["task.spawn.request"],
    dependencies: [],
    budget: { wallMs: 20_000, toolCalls: 8 },
  }, runtimeTestJobContext({ source, range: { startMs: 0, endMs: 2_000 } }));
  await scheduler.claimTaskLaunch(root, "deterministic_test", "2026-07-16T12:00:00.000Z");
  await scheduler.registerAgent(root);
  await scheduler.transitionTask(root.taskId, root.agentId, "working");
  const rootTask = ledger.state().tasks[root.taskId];
  const children: Harness["children"] = [];
  for (const [index, range] of ranges.entries()) {
    const scope = { artifactId: source.id, trackId: "stream:0", ...range };
    const decision = await scheduler.requestSpawn(root.taskId, root.agentId, {
      workloadKey: `semantic-child:${index}`,
      objective: `Consume current-run timed hypotheses for branch ${index}.`,
      workerKind: "analysis",
      workerLabel: `semantic-child-${index}`,
      mediaScope: [scope],
      inputArtifactIds: [source.id],
      requiredOutputs: [{ name: "semantic note", artifactKind: "semantic-note", required: true }],
      requiredCapabilities: ["speech.transcribe", "report.submit"],
      dependencies: [],
      budget: { wallMs: 10_000, toolCalls: 2 },
    });
    assert.ok(decision.permit);
    const claim = await scheduler.claimTaskLaunch(decision.permit, "deterministic_test", "2026-07-16T12:00:00.000Z");
    await scheduler.registerAgent(decision.permit);
    await scheduler.transitionTask(decision.permit.taskId, decision.permit.agentId, "working");
    const task = ledger.state().tasks[decision.permit.taskId];
    await ledger.transact(
      { producer: { kind: "launcher", id: "semantic-test-executor" }, causationId: decision.requestId },
      () => ({
        pending: [{
          type: "executor.started",
          data: {
            executionId: `execution:semantic:${index}`,
            taskId: task.id,
            agentId: task.assignedAgentId,
            launchClaimId: claim.claim.id,
            startedAt: "2026-07-16T12:00:00.000Z",
          },
        }] satisfies PendingRuntimeEvent[],
        result: undefined,
      }),
    );
    children.push({ task: ledger.state().tasks[task.id], scope });
  }
  return { directory, artifactRoot, ledger, artifacts, scheduler, source, rootTask, children };
}

async function cleanup(runtime: Harness): Promise<void> {
  await rm(runtime.directory, { recursive: true, force: true });
}

function successfulRecognizer(): Recognizer {
  return new Recognizer(async (input) => ({
    availability: "available",
    reason: "current_run_hypotheses_returned",
    segments: [{
      startMs: input.range.startMs + 100,
      endMs: input.range.endMs - 100,
      state: "available",
      text: `  Hypothesis   ${input.range.startMs}  `,
    }],
  }));
}

test("two delegated workers consume disjoint current-run ranges through path-free bridge/MCP and cite exact observations", async () => {
  const runtime = await harness([{ startMs: 0, endMs: 1_000 }, { startMs: 1_000, endMs: 2_000 }]);
  const recognizer = successfulRecognizer();
  const host = new SpeechTranscribeCapabilityHost(runtime.ledger, runtime.artifacts, { recognizer });
  const firstBridge = new BoundedChildSemanticEvidenceBridge(runtime.children[0].task, host, {
    nextOperationId: () => "operation:semantic:first",
  });
  const opened = await openChildSemanticEvidenceBridge(firstBridge);
  const client = new Client({ name: "semantic-evidence-test", version: "1" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [MCP_SERVER],
    env: {
      STUDIO_CHILD_SEMANTIC_EVIDENCE_BRIDGE_URL: opened.endpoint,
      STUDIO_CHILD_SEMANTIC_EVIDENCE_BRIDGE_TOKEN: opened.token,
    },
    stderr: "pipe",
  });
  try {
    await client.connect(transport);
    assert.deepEqual((await client.listTools()).tools.map((tool) => tool.name), ["speech_transcribe"]);
    const firstCall = await client.callTool({ name: "speech_transcribe", arguments: runtime.children[0].scope });
    assert.equal(firstCall.isError, undefined);
    const firstText = (firstCall.content as Array<{ type: string; text?: string }>)[0]?.text ?? "{}";
    const first = JSON.parse(firstText) as Awaited<ReturnType<typeof callChildSemanticEvidenceBridge>>;
    const secondBridge = new BoundedChildSemanticEvidenceBridge(runtime.children[1].task, host, {
      nextOperationId: () => "operation:semantic:second",
    });
    const second = await secondBridge.call(runtime.children[1].scope);

    assert.equal(first.schema, "studio.child-semantic-evidence-tool-result.v1");
    assert.equal(first.observations[0].kind, "timed_transcript_hypothesis");
    assert.equal(first.observations[0].text, "Hypothesis 0");
    assert.equal(second.observations[0].text, "Hypothesis 1000");
    assert.deepEqual(recognizer.inputs.map((input) => input.range), [
      { startMs: 0, endMs: 1_000 },
      { startMs: 1_000, endMs: 2_000 },
    ]);
    assert.equal(JSON.stringify(first).includes(runtime.directory), false);
    assert.equal("path" in first.artifact, false);
    assert.equal("path" in first.receipt, false);
    assert.deepEqual(Object.keys(first).sort(), ["artifact", "availability", "capability", "observations", "operationId", "receipt", "schema"].sort());

    const verified = await reopenSemanticEvidence(runtime.ledger.state(), runtime.artifacts, first.operationId);
    const citation = semanticEvidenceCitation(verified);
    const worker = validateWorkerResult({
      summary: `Free text mentions ${citation.artifactId}, but the structured list below is the citation.`,
      semanticEvidenceInputs: [citation],
      outputs: [{ name: "semantic note", kind: "semantic-note", content: "One bounded recognizer hypothesis was available; no accuracy or understanding claim." }],
    }, runtime.children[0].task, [citation]);
    assert.deepEqual(worker.semanticEvidenceInputs, [citation]);
    const preparedOutput = await runtime.artifacts.prepareWorkerOutput(runtime.ledger.runId, {
      schema: "studio.worker-output.v1",
      executionId: "execution:semantic:0",
      taskId: runtime.children[0].task.id,
      agentId: runtime.children[0].task.assignedAgentId,
      semanticEvidenceInputs: worker.semanticEvidenceInputs,
      output: worker.outputs[0],
    });
    assert.deepEqual(preparedOutput.envelope.semanticEvidenceInputs, [citation]);
    assert.throws(
      () => validateWorkerResult({
        summary: `I mentioned ${citation.artifactId} in prose.`,
        outputs: [{ name: "semantic note", kind: "semantic-note", content: `Receipt ${citation.receiptId}` }],
      }, runtime.children[0].task, [citation]),
      /omitted its structured evidence input list/,
    );

    const projection = projectProductionRuntimeJournal(await runtime.ledger.events());
    assert.equal(projection.semanticEvidence?.length, 2);
    assert.equal(projection.semanticEvidence?.[0].observationCount, 1);
    assert.equal(projection.semanticEvidence?.[0].producer.executionScope, "current_run");
    assert.equal(projection.semanticEvidence?.[0].artifact?.artifactId, first.artifact.artifactId);
    assert.equal(JSON.stringify(projection.semanticEvidence).includes("Hypothesis"), false);
    assert.equal(runtime.ledger.state().artifacts[first.artifact.artifactId].publication, "private");
    const rawJournal = `${(await runtime.ledger.events()).map((event) => JSON.stringify(event)).join("\n")}\n`;
    const inspected = await loadRuntimeInspectorJournal(rawJournal);
    assert.equal(inspected.index.sources.receipts.filter((receipt) => receipt.kind === "semantic_media_evidence").length, 2);
    assert.equal(inspected.projection.semanticEvidence?.length, 2);
  } finally {
    await client.close().catch(() => undefined);
    await opened.close();
    await cleanup(runtime);
  }
});

test("empty, unavailable, and unknown current-run outcomes remain closed identities without semantic findings", async () => {
  const runtime = await harness([{ startMs: 0, endMs: 800 }, { startMs: 800, endMs: 1_600 }, { startMs: 1_600, endMs: 2_000 }]);
  const recognizer = new Recognizer(async (input) => input.range.startMs === 0
    ? { availability: "empty", reason: "recognizer_returned_no_segments", segments: [] }
    : input.range.startMs === 800
      ? { availability: "unavailable", reason: "recognizer_unavailable", segments: [] }
      : { availability: "unknown", reason: "recognizer_output_unknown", segments: [] });
  const host = new SpeechTranscribeCapabilityHost(runtime.ledger, runtime.artifacts, { recognizer });
  try {
    const results = await Promise.all(runtime.children.map(({ task, scope }, index) =>
      new BoundedChildSemanticEvidenceBridge(task, host, { nextOperationId: () => `operation:semantic:closed:${index}` }).call(scope)));
    assert.deepEqual(results.map((result) => result.availability.state), ["empty", "unavailable", "unknown"]);
    assert.ok(results.every((result) => result.observations.length === 0));
    const projection = projectProductionRuntimeJournal(await runtime.ledger.events());
    assert.deepEqual(projection.semanticEvidence?.map((entry) => entry.availability?.state), ["empty", "unavailable", "unknown"]);
    assert.ok(projection.semanticEvidence?.every((entry) => entry.observationCount === 0));
  } finally {
    await cleanup(runtime);
  }
});

test("model failure, timeout, and recognizer range escape fail closed without audited artifacts", async (t) => {
  const cases: Array<{ name: string; recognizer: Recognizer; timeoutMs?: number }> = [
    {
      name: "model failure",
      recognizer: new Recognizer(async () => { throw new Error("provider detail must not enter the journal"); }),
    },
    {
      name: "timeout",
      timeoutMs: 5,
      recognizer: new Recognizer((_input, signal) => new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      })),
    },
    {
      name: "range escape",
      recognizer: new Recognizer(async (input) => ({
        availability: "available",
        reason: "current_run_hypotheses_returned",
        segments: [{ startMs: input.range.startMs, endMs: input.range.endMs + 1, state: "available", text: "escape" }],
      })),
    },
  ];
  for (const entry of cases) await t.test(entry.name, async () => {
    const runtime = await harness();
    try {
      const host = new SpeechTranscribeCapabilityHost(runtime.ledger, runtime.artifacts, {
        recognizer: entry.recognizer,
        timeoutMs: entry.timeoutMs,
      });
      await assert.rejects(host.transcribe({
        operationId: `operation:semantic:${entry.name.replace(" ", "-")}`,
        taskId: runtime.children[0].task.id,
        agentId: runtime.children[0].task.assignedAgentId,
        ...runtime.children[0].scope,
      }));
      const operation = Object.values(runtime.ledger.state().semanticEvidence)[0];
      assert.equal(operation.status, "failed");
      assert.equal(operation.outputArtifactId, null);
      assert.equal(Object.values(runtime.ledger.state().artifacts).some((artifact) => artifact.origin.kind === "semantic_media_evidence"), false);
      const projection = projectProductionRuntimeJournal(await runtime.ledger.events());
      assert.equal(projection.semanticEvidence?.[0].artifact, null);
      assert.equal(projection.semanticEvidence?.[0].availability, null);
      assert.equal(JSON.stringify(operation.failure).includes("provider detail"), false);
    } finally {
      await cleanup(runtime);
    }
  });
});

test("authorization rejects range, source, track, task, grant, and duplicate operation drift", async () => {
  const runtime = await harness();
  const host = new SpeechTranscribeCapabilityHost(runtime.ledger, runtime.artifacts, { recognizer: successfulRecognizer() });
  const child = runtime.children[0];
  const request = {
    operationId: "operation:semantic:authorization",
    taskId: child.task.id,
    agentId: child.task.assignedAgentId,
    ...child.scope,
  };
  try {
    await assert.rejects(host.transcribe({ ...request, operationId: "operation:range", endMs: child.scope.endMs + 1 }), /outside.*grant/i);
    await assert.rejects(host.transcribe({ ...request, operationId: "operation:track", trackId: "stream:999" }), /registered audio track/);
    await assert.rejects(host.transcribe({ ...request, operationId: "operation:agent", agentId: "agent:wrong" }), /owned by the requesting agent/);
    await assert.rejects(host.transcribe({ ...request, operationId: "operation:task", taskId: runtime.rootTask.id, agentId: runtime.rootTask.assignedAgentId }), /authoritative capability grant/);
    await assert.rejects(host.transcribe({ ...request, operationId: "operation:source", artifactId: "artifact:wrong" }), /registered owned source/);
    await host.transcribe(request);
    await assert.rejects(host.transcribe(request), /already exists/);

    const tampered = structuredClone(await runtime.ledger.events());
    const started = tampered.find((event) => event.type === "semantic.evidence_started");
    assert.ok(started?.type === "semantic.evidence_started");
    started.data.grantId = runtime.rootTask.grants[0].id;
    assert.throws(() => projectRuntimeEvents(runtime.ledger.runId, tampered), /lacks its speech.transcribe grant/);
  } finally {
    await cleanup(runtime);
  }
});

test("source-byte drift, artifact/receipt tamper, and non-canonical storage fail authenticated reopening", async (t) => {
  await t.test("source bytes", async () => {
    const runtime = await harness();
    try {
      await appendFile(join(runtime.artifactRoot, runtime.source.storageKey), "drift");
      const host = new SpeechTranscribeCapabilityHost(runtime.ledger, runtime.artifacts, { recognizer: successfulRecognizer() });
      await assert.rejects(host.transcribe({
        operationId: "operation:semantic:source-drift",
        taskId: runtime.children[0].task.id,
        agentId: runtime.children[0].task.assignedAgentId,
        ...runtime.children[0].scope,
      }), /no longer matches its registered content identity/);
      assert.equal(runtime.ledger.state().semanticEvidence["operation:semantic:source-drift"].status, "failed");
    } finally {
      await cleanup(runtime);
    }
  });

  for (const target of ["artifact", "receipt"] as const) await t.test(`${target} bytes`, async () => {
    const runtime = await harness();
    try {
      const host = new SpeechTranscribeCapabilityHost(runtime.ledger, runtime.artifacts, { recognizer: successfulRecognizer() });
      const result = await host.transcribe({
        operationId: `operation:semantic:tamper-${target}`,
        taskId: runtime.children[0].task.id,
        agentId: runtime.children[0].task.assignedAgentId,
        ...runtime.children[0].scope,
      });
      const contentId = target === "artifact" ? result.artifact.content.contentId : result.receiptContentId;
      const digest = contentId.slice("sha256:".length);
      const path = join(runtime.artifactRoot, "objects", "sha256", digest.slice(0, 2), digest);
      const parsed = JSON.parse(await readFile(path, "utf8"));
      await writeFile(path, `${JSON.stringify(parsed, null, 2)}\n`);
      await assert.rejects(
        reopenSemanticEvidence(runtime.ledger.state(), runtime.artifacts, result.envelope.operationId),
        /content identity|canonical JSON/,
      );
      const authenticated = await adaptAuthenticatedProductionRuntime(runtime.ledger.state(), runtime.artifacts);
      assert.equal(authenticated.semanticEvidence?.[0].audit, "absent_or_invalid");
      assert.equal(authenticated.semanticEvidence?.[0].availability, null);
      assert.equal(authenticated.semanticEvidence?.[0].artifact, null);
    } finally {
      await cleanup(runtime);
    }
  });
});

test("excessive recognizer segments are bounded as an explicit truncated outcome", async () => {
  const runtime = await harness();
  const recognizer = new Recognizer(async (input) => ({
    availability: "available",
    reason: "current_run_hypotheses_returned",
    segments: Array.from({ length: 80 }, (_, index) => ({
      startMs: input.range.startMs + index,
      endMs: input.range.startMs + index + 1,
      state: "available" as const,
      text: `hypothesis-${index}`,
    })),
  }));
  try {
    const host = new SpeechTranscribeCapabilityHost(runtime.ledger, runtime.artifacts, { recognizer });
    const result = await host.transcribe({
      operationId: "operation:semantic:truncated",
      taskId: runtime.children[0].task.id,
      agentId: runtime.children[0].task.assignedAgentId,
      ...runtime.children[0].scope,
    });
    assert.equal(result.envelope.observations.length, 64);
    assert.deepEqual(result.envelope.availability, {
      ...result.envelope.availability,
      state: "available",
      reason: "segment_or_byte_ceiling",
      truncated: true,
    });
    assert.equal(result.receipt.limits.maxSegments, 64);
    assert.equal(result.receipt.claims.accuracy, "not_assessed");
    assert.equal(result.receipt.claims.understanding, "not_claimed");
  } finally {
    await cleanup(runtime);
  }
});

test("recorded fixture descriptors cannot be reused as current-run semantic evidence", async () => {
  const fixtureDescriptor = {
    ...descriptor(),
    executionScope: "test_demo_only",
    fixtureContentId: `sha256:${"f".repeat(64)}`,
  };
  const runtime = await harness();
  try {
    const recognizer = new Recognizer(async () => ({
      availability: "available",
      reason: "current_run_hypotheses_returned",
      segments: [{ startMs: 0, endMs: 1, state: "available", text: "fixture text" }],
    }), fixtureDescriptor);
    const host = new SpeechTranscribeCapabilityHost(runtime.ledger, runtime.artifacts, { recognizer });
    await assert.rejects(host.transcribe({
      operationId: "operation:semantic:fixture-refused",
      taskId: runtime.children[0].task.id,
      agentId: runtime.children[0].task.assignedAgentId,
      ...runtime.children[0].scope,
    }), /executionScope must equal current_run/);
    assert.equal(Object.keys(runtime.ledger.state().semanticEvidence).length, 0);
  } finally {
    await cleanup(runtime);
  }
});
