import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import { ACOUSTIC_CONFIGURATION, ACOUSTIC_LIMITS, type AcousticClass, type AcousticObservations, type AcousticTriageReceipt } from "../src/studio/acoustic/contracts.ts";
import { ContentAddressedArtifactStore, canonicalSha256, identifyFile } from "../src/studio/runtime/production/artifactStore.ts";
import type { ContentIdentity } from "../src/studio/runtime/production/model/source.ts";
import { FileEventJournal, RuntimeLedger } from "../src/studio/runtime/production/journal.ts";
import { type CurrentRunRecognizerInput, type CurrentRunRecognizerResult, type CurrentRunSpeechRecognizer } from "../src/studio/runtime/production/semantic/currentRunSpeechRecognizer.ts";
import { type CurrentRunRecognizerDescriptor, type LaunchPermit, type RuntimeArtifact, type SourceArtifactDescriptor, type TaskRecord } from "../src/studio/runtime/production/model.ts";
import type { PendingRuntimeEvent } from "../src/studio/runtime/production/protocol.ts";
import { BoundedRuntimeScheduler, type RuntimeIdentityFactory } from "../src/studio/runtime/production/scheduler.ts";
import { type SourceSeparator, SourceSeparatorFailure } from "../src/studio/runtime/production/separation/separator.ts";
import { auditConditionalSeparation } from "../src/studio/runtime/production/separationAudit.ts";
import { BoundedConditionalSeparationHost } from "../src/studio/runtime/production/separationHost.ts";
import { ConditionalSeparationRequestHost } from "../src/studio/runtime/production/study/conditionalSeparationRequestHost.ts";
import { validateRawStemComparison } from "../src/studio/runtime/production/validation/separation.ts";
import { runtimeTestJobContext } from "./runtime-test-job-context.ts";

const SOURCE_FIXTURE = resolve("public/demo/runs/run-006/clip.mp4");
const SOURCE_DURATION_MS = 40_040;
let harnessIndex = 0;

class SequenceIdentities implements RuntimeIdentityFactory {
  private value = 0;
  next(kind: "request" | "task" | "agent" | "grant"): string { this.value += 1; return `${kind}:u1sep-${this.value}`; }
  secret(): string { this.value += 1; return `secret:u1sep-${this.value}`; }
}

class ComparisonRecognizer implements CurrentRunSpeechRecognizer {
  readonly calls: CurrentRunRecognizerInput[] = [];
  async describe(): Promise<CurrentRunRecognizerDescriptor> {
    const configuration = { id: "fixture-u1sep-recognizer.timed-segments.v1", language: null, timestampMode: "segment" as const, segmentation: "producer_defined" as const };
    return {
      id: "fixture-u1sep-recognizer", version: "1", model: "fixture-contract-only", runtime: { id: "node-test", version: "1" },
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
    schema: "studio.source-artifact.v1", adapterId: "owned-local-source-adapter.v1", sourceReceiptRef: "fixture:run-006:u1sep-source",
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
  source: RuntimeArtifact;
  root: TaskRecord;
  rootPermit: LaunchPermit;
  rootExecutionId: string;
}

async function startTask(runtime: Harness, permit: LaunchPermit, executionId: string): Promise<TaskRecord> {
  const claim = await runtime.scheduler.claimTaskLaunch(permit, "deterministic_test", "2026-07-17T14:00:00.000Z");
  assert.equal(claim.won, true);
  await runtime.scheduler.registerAgent(permit);
  await runtime.scheduler.transitionTask(permit.taskId, permit.agentId, "working");
  const task = runtime.ledger.state().tasks[permit.taskId];
  await runtime.ledger.transact(
    { producer: { kind: "launcher", id: "u1sep-test-executor" }, causationId: permit.requestId },
    () => ({ pending: [{ type: "executor.started", data: { executionId, taskId: task.id, agentId: task.assignedAgentId, launchClaimId: claim.claim.id, startedAt: "2026-07-17T14:00:00.000Z" } }] satisfies PendingRuntimeEvent[], result: undefined }),
  );
  return runtime.ledger.state().tasks[permit.taskId];
}

async function harness(options: { separationGrant?: boolean } = {}): Promise<Harness> {
  harnessIndex += 1;
  const runId = `runtime:u1sep:${harnessIndex}`;
  const directory = await mkdtemp(join(tmpdir(), "studio-u1sep-test-"));
  const journalPath = join(directory, "events.ndjson");
  const artifacts = new ContentAddressedArtifactStore(join(directory, "artifacts"));
  const source = await artifacts.registerSource(runId, await sourceDescriptor());
  const ledger = await RuntimeLedger.open(runId, new FileEventJournal(journalPath), { now: () => new Date("2026-07-17T14:00:00.000Z") });
  await artifacts.record(ledger, source);
  const scheduler = new BoundedRuntimeScheduler(ledger, {
    maxDepth: 2, maxActiveWorkers: 6, runBudget: { wallMs: 500_000, toolCalls: 24 },
    grantableCapabilities: ["task.spawn.request", "report.submit", "media.audio.separate", "study.separate"],
  }, new SequenceIdentities());
  const rootPermit = await scheduler.createRoot({
    workloadKey: `root:u1sep:${harnessIndex}`, objective: "Authorize only cold-audited exact U1 mixed acoustic ranges for U7.", workerKind: "orchestrator", workerLabel: "u1sep-root",
    mediaScope: [{ artifactId: source.id, trackId: "stream:1", startMs: 0, endMs: 15_000 }], inputArtifactIds: [source.id],
    requiredOutputs: [{ name: "study", artifactKind: "studio.owned-media-study.v3", required: true }],
    requiredCapabilities: options.separationGrant === false ? ["task.spawn.request"] : ["task.spawn.request", "study.separate"],
    dependencies: [], budget: { wallMs: 120_000, toolCalls: 8 },
  }, runtimeTestJobContext({ source, range: { startMs: 0, endMs: 15_000 } }));
  const runtime: Harness = { runId, directory, journalPath, artifacts, ledger, scheduler, source, root: null as unknown as TaskRecord, rootPermit, rootExecutionId: `execution:u1sep-root:${harnessIndex}` };
  runtime.root = await startTask(runtime, rootPermit, runtime.rootExecutionId);
  return runtime;
}

function toSha256Content(identity: ContentIdentity): { id: string; hash: { algorithm: "sha256"; digest: string }; bytes: number } {
  return { id: identity.contentId, hash: { algorithm: "sha256", digest: identity.digest }, bytes: identity.bytes };
}

function syntheticContent(seed: string, bytes: number): { id: string; hash: { algorithm: "sha256"; digest: string }; bytes: number } {
  const digest = createHash("sha256").update(seed).digest("hex");
  return { id: `sha256:${digest}`, hash: { algorithm: "sha256", digest }, bytes };
}

interface CellSpec {
  classification: AcousticClass;
  confidence: { speechCandidate: number; music: number; noise: number; winningScore: number; margin: number };
  certainty: "strong" | "weak";
  reason: AcousticObservation["reason"];
}

type AcousticObservation = AcousticObservations["observations"][number];

// One representable strong speech+music mixture cell (the only U7.1-eligible acoustic state).
const MIXED_CELL: CellSpec = {
  classification: "mixed",
  confidence: { speechCandidate: 0.5, music: 0.45, noise: 0.1, winningScore: 0.5, margin: 0.05 },
  certainty: "strong",
  reason: "supported_speech_and_music",
};

// A dominant single-family cell; not two co-present sources, so not eligible.
const MUSIC_CELL: CellSpec = {
  classification: "music",
  confidence: { speechCandidate: 0.1, music: 0.8, noise: 0.05, winningScore: 0.8, margin: 0.7 },
  certainty: "strong",
  reason: "strong_single_family",
};

function buildObservations(source: RuntimeArtifact, cell: CellSpec, normalizationContent: ReturnType<typeof syntheticContent>): AcousticObservations {
  const range = { startMs: 0, endMs: 960, startSample: 0, endSample: 15_360 };
  return {
    schema: "studio.acoustic-observations.v1",
    source: { contentId: source.content.contentId, bytes: source.content.bytes, trackIndex: 1 },
    normalization: { content: normalizationContent as unknown as AcousticObservations["normalization"]["content"], sampleRateHz: 16000, channels: 1, sampleFormat: "s16le", sampleCount: 15_360 },
    requestedRange: range,
    returnedRange: range,
    status: "complete",
    observations: [{ index: 0, startSample: 0, endSample: 15_360, startMs: 0, endMs: 960, classification: cell.classification, confidence: cell.confidence, certainty: cell.certainty, reason: cell.reason }],
  };
}

function buildReceipt(source: RuntimeArtifact, observations: AcousticObservations, obsContent: ContentIdentity, normalizationContent: ReturnType<typeof syntheticContent>): AcousticTriageReceipt {
  const modelPaths = ["vendor/yamnet/v0.58.0/yamnet.onnx", "vendor/yamnet/v0.58.0/yamnet.data", "vendor/yamnet/v0.58.0/LICENSE", "vendor/yamnet/v0.58.0/yamnet_class_map.csv", "vendor/yamnet/v0.58.0/ONTOLOGY_LICENSE"];
  const body = {
    run: "runtime:u1sep-acoustic",
    input: {
      media: { path: "clip.mp4", content: toSha256Content(source.content), trackIndex: 1 },
      normalizedAudio: { path: "speech-input.pcm" as const, content: normalizationContent, sampleCount: 15_360 },
      speechActivity: { path: "speech-activity.json" as const, content: syntheticContent("speech-activity", 256) },
      requestedRange: observations.requestedRange,
    },
    producer: {
      id: "yamnet-acoustic-triage" as const, version: "1.0.0" as const, implementation: "scripts/detect-acoustics.mjs" as const,
      model: { id: "qualcomm/YamNet" as const, revision: "v0.58.0" as const, upstream: "w-hc/torch_audioset@e8852c5" as const, license: "MIT" as const, files: modelPaths.map((path, index) => ({ path, content: syntheticContent(`model:${path}:${index}`, 1_024) })) },
      runtime: {
        id: "onnxruntime-node" as const, version: "1.27.0" as const, executionProvider: "cpu" as const, executionMode: "sequential" as const, intraOpThreads: 1, interOpThreads: 1,
        binary: { path: "node_modules/onnxruntime-node/bin/napi-v3/darwin/arm64/onnxruntime_binding.node", content: syntheticContent("runtime-binary", 4_096) },
        platform: { os: "darwin", arch: "arm64", node: "v22.0.0" },
      },
    },
    normalization: {
      contract: "sealed_speech_pcm_v1" as const, sampleRateHz: 16000 as const, channels: 1 as const, sampleFormat: "s16le" as const, amplitudeScale: "int16_div_32768" as const,
      featureExtraction: "yamnet_vggish_log_mel_v1" as const, windowSamples: 400 as const, hopSamples: 160 as const, fftSamples: 512 as const, melBands: 64 as const, melMinHz: 125 as const, melMaxHz: 7500 as const,
      logOffset: 0.001 as const, patchSamples: 15360 as const, patchFrames: 96 as const, finalPatch: "right_zero_pad_and_mark_weak_below_min_samples" as const,
    },
    configuration: structuredClone(ACOUSTIC_CONFIGURATION),
    limits: structuredClone(ACOUSTIC_LIMITS),
    execution: { startedAt: "2026-07-17T13:59:59.000Z", completedAt: "2026-07-17T14:00:00.000Z", wallMs: 1_000, toolCalls: 1 as const, decodedSamples: 15_360 },
    output: { path: "acoustic-observations.json" as const, content: toSha256Content(obsContent), status: "complete" as const, itemCount: 1, requestedRange: observations.requestedRange, returnedRange: observations.returnedRange },
    determinism: { equalityScope: "exact_receipted_model_runtime_platform_configuration_and_input" as const, crossPlatformNumericalEquality: "not_claimed" as const },
    nonClaims: { semanticUnderstanding: "not_assessed" as const, speechDetectionCompleteness: "not_claimed" as const, lyricsUnderstanding: "not_assessed" as const, calibration: "not_established" as const },
  };
  const receiptId = `acoustic-triage:${canonicalSha256(body)}`;
  return { schema: "studio.acoustic-triage.receipt.v1", receiptId, ...body } as unknown as AcousticTriageReceipt;
}

/** Registers a synthetic but production-valid acoustic preflight bundle (observations + receipt). */
async function registerAcousticEvidence(runtime: Harness, cell: CellSpec): Promise<{ artifact: RuntimeArtifact; observationsPath: string; directory: string }> {
  const directory = await mkdtemp(join(tmpdir(), "studio-u1sep-acoustic-"));
  const normalizationContent = syntheticContent(`normalized-pcm:${runtime.runId}`, 30_720);
  const observations = buildObservations(runtime.source, cell, normalizationContent);
  const observationsPath = join(directory, "acoustic-observations.json");
  await writeFile(observationsPath, JSON.stringify(observations));
  const obsContent = await identifyFile(observationsPath);
  const receipt = buildReceipt(runtime.source, observations, obsContent, normalizationContent);
  const receiptPath = join(directory, "acoustic-triage.receipt.json");
  await writeFile(receiptPath, JSON.stringify(receipt));
  const receiptContent = await identifyFile(receiptPath);
  const descriptor = {
    schema: "studio.preflight-evidence-artifact.v2" as const,
    evidenceKind: "acoustic_ranges" as const,
    receiptSchema: "studio.acoustic-observations.v1" as const,
    producerId: "yamnet-acoustic-triage" as const,
    path: observationsPath,
    content: obsContent,
    producerReceiptPath: receiptPath,
    producerReceiptContent: receiptContent,
    preflightId: `preflight:u1sep:${runtime.runId}`,
    preflightContentId: obsContent.contentId,
  };
  const artifact = await runtime.artifacts.registerPreflightEvidence(runtime.runId, runtime.source.id, descriptor);
  await runtime.artifacts.record(runtime.ledger, artifact);
  return { artifact, observationsPath, directory };
}

async function authorizeSeparation(runtime: Harness): Promise<{ task: TaskRecord; input: Awaited<ReturnType<ConditionalSeparationRequestHost["inspect"]>>; requestHost: ConditionalSeparationRequestHost }> {
  const requestHost = new ConditionalSeparationRequestHost(runtime.ledger, runtime.artifacts, runtime.scheduler);
  const input = await requestHost.inspect(runtime.rootExecutionId);
  assert.equal(input.triggers.length, 1);
  const toolCallId = `tool-call:u1sep:${runtime.runId}:${Object.keys(runtime.ledger.state().orchestratorToolCalls).length}`;
  await runtime.ledger.transact(
    { producer: { kind: "launcher", id: "u1sep-test-orchestrator" }, causationId: runtime.rootExecutionId },
    () => ({ pending: [{ type: "orchestrator.tool_called", data: { callId: toolCallId, executionId: runtime.rootExecutionId, taskId: runtime.root.id, tool: "study_separation_request" } }] satisfies PendingRuntimeEvent[], result: undefined }),
  );
  const decision = await requestHost.request(runtime.rootExecutionId, toolCallId, { inputId: input.inputId, triggerId: input.triggers[0].triggerId });
  assert.ok(decision.permit, decision.rejection ?? "U1 separation child rejected");
  const task = await startTask(runtime, decision.permit, `execution:u1sep-child:${runtime.runId}`);
  return { task, input, requestHost };
}

test("U7.1 exact U1 mixed acoustic cell produces real private stems, raw/stem disagreement, cold audit, null semantic preference", async () => {
  const runtime = await harness();
  const acoustic = await registerAcousticEvidence(runtime, MIXED_CELL);
  try {
    const { task, input, requestHost } = await authorizeSeparation(runtime);
    assert.equal(input.triggers[0].trigger.kind, "u1_acoustic_mixed");
    assert.deepEqual(input.triggers[0].source.range, { startMs: 0, endMs: 960 });
    const grant = task.grants.find((candidate) => candidate.capability === "media.audio.separate");
    assert.ok(grant?.separationScope);
    assert.deepEqual(grant.mediaScope[0], { artifactId: runtime.source.id, trackId: "stream:1", startMs: 0, endMs: 960 });
    const recognizer = new ComparisonRecognizer();
    const produced = await new BoundedConditionalSeparationHost(runtime.ledger, runtime.artifacts, { recognizer }).separate({ operationId: `operation:u1sep:${runtime.runId}`, taskId: task.id, agentId: task.assignedAgentId, grantId: grant.id });
    assert.equal(recognizer.calls.length, 3);
    assert.deepEqual(recognizer.calls.map((call) => call.range), [{ startMs: 0, endMs: 960 }, { startMs: 0, endMs: 960 }, { startMs: 0, endMs: 960 }]);
    assert.equal(produced.comparison.outcome, "disagreement");
    assert.equal(produced.comparison.deterministicGate.semanticPreference, null);
    assert.equal(produced.comparison.deterministicGate.semanticAuthority, "not_granted");
    assert.equal(produced.comparison.deterministicGate.captionAuthority, "not_granted");
    assert.equal(produced.receipt.nonClaims.semanticPreference, "not_granted");
    assert.equal(produced.receipt.nonClaims.captionAuthority, "not_granted");
    assert.equal(produced.receipt.trigger.kind, "u1_acoustic_mixed");
    assert.throws(() => validateRawStemComparison({ ...structuredClone(produced.comparison), outcome: "agreement", reason: "normalized_text_agrees" }), /deterministic normalized-text comparison/);
    assert.ok(produced.stems.every((artifact) => artifact.mediaClass === "derived" && artifact.publication === "private" && artifact.sourceArtifactIds[0] === runtime.source.id));
    assert.equal(runtime.ledger.state().artifacts[runtime.source.id].mediaClass, "raw");
    const replay = await RuntimeLedger.open(runtime.runId, new FileEventJournal(runtime.journalPath));
    const audited = await auditConditionalSeparation(replay.state(), runtime.artifacts, produced.receipt.operationId);
    assert.equal(audited.receipt.receiptId, produced.receipt.receiptId);
    assert.equal(audited.comparisonReceipt.nonClaims.captionAuthority, "not_granted");

    // Duplicate identical U1 trigger fails closed.
    const secondCall = `tool-call:u1sep-duplicate:${runtime.runId}`;
    await runtime.ledger.transact(
      { producer: { kind: "launcher", id: "u1sep-test-orchestrator" }, causationId: runtime.rootExecutionId },
      () => ({ pending: [{ type: "orchestrator.tool_called", data: { callId: secondCall, executionId: runtime.rootExecutionId, taskId: runtime.root.id, tool: "study_separation_request" } }] satisfies PendingRuntimeEvent[], result: undefined }),
    );
    const duplicate = await requestHost.request(runtime.rootExecutionId, secondCall, { inputId: input.inputId, triggerId: input.triggers[0].triggerId });
    assert.equal(duplicate.accepted, false);
    assert.equal(duplicate.rejection, "separation_duplicate_work");

    // Tampering the raw source, the separation receipt, a stem, or the acoustic trigger bytes all fail cold audit.
    const rawPath = await runtime.artifacts.resolveVerified(runtime.source);
    const rawBytes = await readFile(rawPath);
    await chmod(rawPath, 0o600);
    await writeFile(rawPath, Buffer.from("tampered-private-raw"));
    await assert.rejects(auditConditionalSeparation(runtime.ledger.state(), runtime.artifacts, produced.receipt.operationId), /content|identity|artifact/i);
    await writeFile(rawPath, rawBytes);
    const acousticStoredPath = await runtime.artifacts.resolveVerified(acoustic.artifact);
    const acousticBytes = await readFile(acousticStoredPath);
    await chmod(acousticStoredPath, 0o600);
    await writeFile(acousticStoredPath, Buffer.from("tampered-acoustic-observations"));
    await assert.rejects(auditConditionalSeparation(runtime.ledger.state(), runtime.artifacts, produced.receipt.operationId), /content|identity|artifact|acoustic/i);
    await writeFile(acousticStoredPath, acousticBytes);
    const stemPath = await runtime.artifacts.resolveVerified(produced.stems[0]);
    await chmod(stemPath, 0o600);
    await writeFile(stemPath, Buffer.from("tampered-private-stem"));
    await assert.rejects(auditConditionalSeparation(runtime.ledger.state(), runtime.artifacts, produced.receipt.operationId), /content|identity|artifact/i);
  } finally {
    await rm(runtime.directory, { recursive: true, force: true });
    await rm(acoustic.directory, { recursive: true, force: true });
  }
});

test("U7.1 rejects ineligible acoustic classes, ambient spawn, forged range fields, and missing root grant", async () => {
  const runtime = await harness();
  const music = await registerAcousticEvidence(runtime, MUSIC_CELL);
  try {
    // A dominant single-family (music) cell is not two co-present sources: no U1 trigger is surfaced.
    const musicHost = new ConditionalSeparationRequestHost(runtime.ledger, runtime.artifacts, runtime.scheduler);
    const musicInput = await musicHost.inspect(runtime.rootExecutionId);
    assert.deepEqual(musicInput.triggers, []);
    await assert.rejects(musicHost.request(runtime.rootExecutionId, "unused", { inputId: musicInput.inputId, triggerId: "forged" }), /exact audited trigger/);

    // Ordinary spawn cannot acquire the capability.
    const ambient = await runtime.scheduler.requestSpawn(runtime.root.id, runtime.root.assignedAgentId, {
      workloadKey: "ambient-u1-separation", objective: "Forbidden ambient separation.", workerKind: "analysis", workerLabel: "ambient",
      mediaScope: [{ artifactId: runtime.source.id, trackId: "stream:1", startMs: 0, endMs: 960 }], inputArtifactIds: [runtime.source.id],
      requiredOutputs: [{ name: "note", artifactKind: "studio.study-report.v2", required: true }], requiredCapabilities: ["media.audio.separate", "report.submit"], dependencies: [], budget: { wallMs: 60_000, toolCalls: 1 },
    });
    assert.equal(ambient.accepted, false);
    assert.equal(ambient.rejection, "capability_not_grantable");
  } finally {
    await rm(runtime.directory, { recursive: true, force: true });
    await rm(music.directory, { recursive: true, force: true });
  }

  // An eligible mixed cell still refuses a caller-supplied range field on the closed request contract.
  const mutation = await harness();
  const eligible = await registerAcousticEvidence(mutation, MIXED_CELL);
  try {
    const host = new ConditionalSeparationRequestHost(mutation.ledger, mutation.artifacts, mutation.scheduler);
    const input = await host.inspect(mutation.rootExecutionId);
    assert.equal(input.triggers.length, 1);
    await assert.rejects(host.request(mutation.rootExecutionId, "unused", { inputId: input.inputId, triggerId: input.triggers[0].triggerId, range: { startMs: 0, endMs: 5_000 } }), /not allowed/);
  } finally {
    await rm(mutation.directory, { recursive: true, force: true });
    await rm(eligible.directory, { recursive: true, force: true });
  }

  // No root study.separate grant means the tool never inspects, even with an eligible cell present.
  const noGrant = await harness({ separationGrant: false });
  const withoutGrant = await registerAcousticEvidence(noGrant, MIXED_CELL);
  try {
    const host = new ConditionalSeparationRequestHost(noGrant.ledger, noGrant.artifacts, noGrant.scheduler);
    await assert.rejects(host.inspect(noGrant.rootExecutionId), /study\.separate grant/);
  } finally {
    await rm(noGrant.directory, { recursive: true, force: true });
    await rm(withoutGrant.directory, { recursive: true, force: true });
  }
});

test("U7.1 fails closed when the pinned separator is unavailable, leaving no stems", async () => {
  const runtime = await harness();
  const acoustic = await registerAcousticEvidence(runtime, MIXED_CELL);
  try {
    const { task } = await authorizeSeparation(runtime);
    const grant = task.grants.find((candidate) => candidate.capability === "media.audio.separate");
    assert.ok(grant);
    const unavailable: SourceSeparator = {
      async currentLineage() { throw new SourceSeparatorFailure("model_unavailable", "missing pinned model"); },
      async separate() { throw new SourceSeparatorFailure("model_unavailable", "missing pinned model"); },
    };
    await assert.rejects(new BoundedConditionalSeparationHost(runtime.ledger, runtime.artifacts, { separator: unavailable, recognizer: new ComparisonRecognizer() }).separate({ operationId: `operation:u1sep-unavailable:${runtime.runId}`, taskId: task.id, agentId: task.assignedAgentId, grantId: grant.id }), /missing pinned model/);
    const failed = runtime.ledger.state().conditionalSeparationOperations[`operation:u1sep-unavailable:${runtime.runId}`];
    assert.equal(failed.status, "failed");
    assert.equal(failed.failure, "model_unavailable");
    assert.deepEqual(failed.stemArtifactIds, []);
  } finally {
    await rm(runtime.directory, { recursive: true, force: true });
    await rm(acoustic.directory, { recursive: true, force: true });
  }
});
