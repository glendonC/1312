import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import test from "node:test";
import { deflateSync } from "node:zlib";

import { ContentAddressedArtifactStore, identifyFile } from "../src/studio/runtime/production/artifactStore.ts";
import {
  BoundedChildVisualTransitionBridge,
  callChildVisualTransitionBridge,
  openChildVisualTransitionBridge,
} from "../src/studio/runtime/production/executor/childVisualTransitionBridge.ts";
import { auditEvidenceCitation, visualTransitionCitation } from "../src/studio/runtime/production/evidenceCitations/audit.ts";
import { buildStudyReportEnvelopeV2 } from "../src/studio/runtime/production/executor/workerContract.ts";
import type { FrameDecodeResult, FrameDecoder } from "../src/studio/runtime/production/frames/decoder.ts";
import { FfmpegFrameDecoder } from "../src/studio/runtime/production/frames/ffmpegDecoder.ts";
import { BoundedFrameSamplingHost } from "../src/studio/runtime/production/frameHost.ts";
import { FileEventJournal, RuntimeLedger } from "../src/studio/runtime/production/journal.ts";
import type {
  FrameDecoderLineage,
  LaunchPermit,
  MediaScope,
  OcrProducerLineage,
  SourceArtifactDescriptor,
  TaskRecord,
} from "../src/studio/runtime/production/model.ts";
import { VISUAL_TRANSITION_LIMITS } from "../src/studio/runtime/production/model/visualTransitions.ts";
import type { OcrRecognizer, OcrRecognizerCandidate } from "../src/studio/runtime/production/ocr/recognizer.ts";
import { TesseractJsOcrRecognizer } from "../src/studio/runtime/production/ocr/tesseractRecognizer.ts";
import { BoundedOcrHost } from "../src/studio/runtime/production/ocrHost.ts";
import { buildRuntimeObservabilityIndex } from "../src/studio/runtime/production/observability/indexer.ts";
import type { PendingRuntimeEvent } from "../src/studio/runtime/production/protocol.ts";
import { BoundedRuntimeScheduler, type RuntimeIdentityFactory } from "../src/studio/runtime/production/scheduler.ts";
import { validateEvidenceCitationEnvelope } from "../src/studio/runtime/production/validation/evidenceCitations.ts";
import { validateVisualTransitionObservations } from "../src/studio/runtime/production/validation/visualTransitions.ts";
import { DeterministicRgbGridVisualTransitionAnalyzer } from "../src/studio/runtime/production/visualTransitions/analyzer.ts";
import { auditVisualTransition } from "../src/studio/runtime/production/visualTransitions/visualTransitionAudit.ts";
import { BoundedVisualTransitionHost } from "../src/studio/runtime/production/visualTransitions/visualTransitionHost.ts";
import { runtimeTestJobContext } from "./runtime-test-job-context.ts";

const SOURCE_FIXTURE = resolve("public/demo/runs/run-006/clip.mp4");
const SOURCE_DURATION_MS = 40_040;
let harnessIndex = 0;

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

function solidRgbPng(width: number, height: number, value: number): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  const raw = Buffer.alloc(height * (1 + width * 3));
  for (let row = 0; row < height; row += 1) {
    const offset = row * (1 + width * 3);
    raw[offset] = 0;
    raw.fill(value, offset + 1, offset + 1 + width * 3);
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

let decoderLineagePromise: Promise<FrameDecoderLineage> | null = null;
let ocrLineagePromise: Promise<OcrProducerLineage> | null = null;

async function decoderLineage(): Promise<FrameDecoderLineage> {
  decoderLineagePromise ??= new FfmpegFrameDecoder().currentLineage(performance.now() + 10_000);
  return structuredClone(await decoderLineagePromise);
}

async function ocrLineage(): Promise<OcrProducerLineage> {
  ocrLineagePromise ??= new TesseractJsOcrRecognizer().currentLineage(performance.now() + 15_000);
  return structuredClone(await ocrLineagePromise);
}

class VisualFixtureFrameDecoder implements FrameDecoder {
  async currentLineage(): Promise<FrameDecoderLineage> {
    return decoderLineage();
  }

  async verifyLineage(): Promise<{ lineage: FrameDecoderLineage; decoderProcesses: number }> {
    return { lineage: await decoderLineage(), decoderProcesses: 2 };
  }

  async sample(input: Parameters<FrameDecoder["sample"]>[0]): Promise<FrameDecodeResult> {
    const values = [0, 255, 250, 16];
    const frames = [];
    for (const [index, requestedTimestampMs] of input.requestedTimestampsMs.entries()) {
      const path = join(input.outputDirectory, `visual-${index}.png`);
      await writeFile(path, solidRgbPng(32, 32, values[index]));
      frames.push({
        path,
        requestedTimestampMs,
        actualPresentationTimestamp: {
          pts: requestedTimestampMs,
          sourceStartPts: 0,
          timeBase: { numerator: 1, denominator: 1_000 },
          microseconds: requestedTimestampMs * 1_000,
        },
        width: 32,
        height: 32,
      });
    }
    return {
      lineage: await decoderLineage(),
      videoTrack: {
        id: input.registeredTrack.id,
        index: input.registeredTrack.index,
        codec: input.registeredTrack.codec,
        width: 1_280,
        height: 720,
        durationMs: SOURCE_DURATION_MS,
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

class VisualFixtureOcrRecognizer implements OcrRecognizer {
  async currentLineage(): Promise<OcrProducerLineage> {
    return ocrLineage();
  }

  async recognize(frames: Parameters<OcrRecognizer["recognize"]>[0]) {
    const texts = ["ONE", "TWO", "TWO", "FOUR"];
    return {
      lineage: await ocrLineage(),
      frames: frames.map((frame, index) => ({
        frameId: frame.identity.frameId,
        candidates: [{
          text: texts[index],
          confidence: 95,
          boundingBox: { x0: 0, y0: 0, x1: 12, y1: 12 },
        }] satisfies OcrRecognizerCandidate[],
      })),
    };
  }
}

class SequenceIdentities implements RuntimeIdentityFactory {
  private value = 0;

  next(kind: "request" | "task" | "agent" | "grant"): string {
    this.value += 1;
    return `${kind}:visual-${this.value}`;
  }

  secret(): string {
    this.value += 1;
    return `secret:visual-${this.value}`;
  }
}

async function sourceDescriptor(): Promise<SourceArtifactDescriptor> {
  return {
    schema: "studio.source-artifact.v1",
    adapterId: "owned-local-source-adapter.v1",
    sourceReceiptRef: "fixture:run-006:visual-source",
    publication: "private",
    path: SOURCE_FIXTURE,
    content: await identifyFile(SOURCE_FIXTURE),
    durationMs: SOURCE_DURATION_MS,
    tracks: [
      { id: "stream:0", index: 0, kind: "video", codec: "h264", durationMs: SOURCE_DURATION_MS },
      { id: "stream:1", index: 1, kind: "audio", codec: "aac", durationMs: 40_000 },
    ],
  };
}

interface VisualHarness {
  directory: string;
  journalPath: string;
  artifacts: ContentAddressedArtifactStore;
  ledger: RuntimeLedger;
  scheduler: BoundedRuntimeScheduler;
  source: Awaited<ReturnType<ContentAddressedArtifactStore["registerSource"]>>;
  childTask: TaskRecord;
  childPermit: LaunchPermit;
  scope: MediaScope;
  frameGrantId: string;
  ocrGrantId: string;
  visualGrantId: string;
  decoder: VisualFixtureFrameDecoder;
  recognizer: VisualFixtureOcrRecognizer;
}

async function visualHarness(): Promise<VisualHarness> {
  harnessIndex += 1;
  const runId = `runtime:visual-transition:${harnessIndex}`;
  const directory = await mkdtemp(join(tmpdir(), "studio-visual-transition-"));
  const artifacts = new ContentAddressedArtifactStore(join(directory, "artifacts"));
  const source = await artifacts.registerSource(runId, await sourceDescriptor());
  const journalPath = join(directory, "events.ndjson");
  const ledger = await RuntimeLedger.open(runId, new FileEventJournal(journalPath), {
    now: () => new Date("2026-07-18T12:00:00.000Z"),
  });
  await artifacts.record(ledger, source);
  const scheduler = new BoundedRuntimeScheduler(ledger, {
    maxDepth: 1,
    maxActiveWorkers: 4,
    runBudget: { wallMs: 300_000, toolCalls: 24 },
    grantableCapabilities: [
      "task.spawn.request",
      "report.submit",
      "media.frames.sample",
      "media.frames.ocr",
      "media.visual-transitions.analyze",
    ],
  }, new SequenceIdentities());
  const scope = { artifactId: source.id, trackId: "stream:0", startMs: 10_000, endMs: 11_000 };
  const root = await scheduler.createRoot({
    workloadKey: `root:visual:${harnessIndex}`,
    objective: "Authorize one exact U2, U5, and visual-change candidate chain.",
    workerKind: "orchestrator",
    workerLabel: "visual-root",
    mediaScope: [scope],
    inputArtifactIds: [source.id],
    requiredOutputs: [{ name: "run report", artifactKind: "run-report", required: true }],
    requiredCapabilities: ["task.spawn.request"],
    dependencies: [],
    budget: { wallMs: 120_000, toolCalls: 6 },
  }, runtimeTestJobContext({ source, range: { startMs: scope.startMs, endMs: scope.endMs } }));
  const rootClaim = await scheduler.claimTaskLaunch(root, "deterministic_test", "2026-07-18T12:00:00.000Z");
  assert.equal(rootClaim.won, true);
  await scheduler.registerAgent(root);
  await scheduler.transitionTask(root.taskId, root.agentId, "working");
  const child = await scheduler.requestSpawn(root.taskId, root.agentId, {
    workloadKey: `visual:candidates:${harnessIndex}`,
    objective: "Measure cite-only adjacent visual-change candidates from exact U2/U5 lineage.",
    workerKind: "media",
    workerLabel: "bounded-visual-transition",
    mediaScope: [scope],
    inputArtifactIds: [source.id],
    requiredOutputs: [{ name: "visual context", artifactKind: "studio.study-report.v2", required: true }],
    requiredCapabilities: ["media.frames.sample", "media.frames.ocr", "media.visual-transitions.analyze", "report.submit"],
    dependencies: [],
    budget: { wallMs: 90_000, toolCalls: 3 },
  });
  assert.ok(child.permit, `Visual-transition child spawn was rejected: ${child.rejection ?? "unknown"}`);
  const childClaim = await scheduler.claimTaskLaunch(child.permit, "deterministic_test", "2026-07-18T12:00:00.000Z");
  assert.equal(childClaim.won, true);
  await scheduler.registerAgent(child.permit);
  await scheduler.transitionTask(child.permit.taskId, child.permit.agentId, "working");
  const childTask = ledger.state().tasks[child.permit.taskId];
  await ledger.transact(
    { producer: { kind: "launcher", id: "visual-test-executor" }, causationId: child.requestId },
    () => ({
      pending: [{
        type: "executor.started",
        data: {
          executionId: `execution:visual:${harnessIndex}`,
          taskId: childTask.id,
          agentId: childTask.assignedAgentId,
          launchClaimId: childClaim.claim.id,
          startedAt: "2026-07-18T12:00:00.000Z",
        },
      }] satisfies PendingRuntimeEvent[],
      result: undefined,
    }),
  );
  const frameGrant = childTask.grants.find((grant) => grant.capability === "media.frames.sample");
  const ocrGrant = childTask.grants.find((grant) => grant.capability === "media.frames.ocr");
  const visualGrant = childTask.grants.find((grant) => grant.capability === "media.visual-transitions.analyze");
  assert.ok(frameGrant?.frameScope && ocrGrant?.ocrScope && visualGrant?.visualTransitionScope);
  return {
    directory,
    journalPath,
    artifacts,
    ledger,
    scheduler,
    source,
    childTask,
    childPermit: child.permit,
    scope,
    frameGrantId: frameGrant.id,
    ocrGrantId: ocrGrant.id,
    visualGrantId: visualGrant.id,
    decoder: new VisualFixtureFrameDecoder(),
    recognizer: new VisualFixtureOcrRecognizer(),
  };
}

async function cleanup(runtime: VisualHarness): Promise<void> {
  await rm(runtime.directory, { recursive: true, force: true });
}

async function prepareU2U5(runtime: VisualHarness, prefix: string, timestampsMs: number[]) {
  const frames = await new BoundedFrameSamplingHost(runtime.ledger, runtime.artifacts, { decoder: runtime.decoder }).sample({
    operationId: `operation:frames:${prefix}`,
    taskId: runtime.childTask.id,
    agentId: runtime.childTask.assignedAgentId,
    grantId: runtime.frameGrantId,
    requestedTimestampsMs: timestampsMs,
  });
  const ocr = await new BoundedOcrHost(runtime.ledger, runtime.artifacts, {
    recognizer: runtime.recognizer,
    frameDecoder: runtime.decoder,
  }).recognize({
    operationId: `operation:ocr:${prefix}`,
    taskId: runtime.childTask.id,
    agentId: runtime.childTask.assignedAgentId,
    grantId: runtime.ocrGrantId,
    frameSamplingOperationId: frames.receipt.operationId,
  });
  return { frames, ocr };
}

test("fixed RGB-grid scoring closes threshold classification and OCR secondary lineage", () => {
  const analyzer = new DeterministicRgbGridVisualTransitionAnalyzer();
  const frames = [0, 255, 250].map((value, index) => ({
    identity: {
      frameId: `frame:${index}`,
      artifactId: `artifact:${index}`,
      contentId: `sha256:${String(index).padStart(64, "0")}`,
      bytes: solidRgbPng(32, 32, value).length,
      width: 32,
      height: 32,
      actualTimestampUs: (10_100 + index * 100) * 1_000,
      ocrState: "available" as const,
      availableOcrHypothesisCount: 1,
      availableOcrHypothesisSetFingerprint: `ocr-hypothesis-set:${index === 2 ? "1" : String(index).padStart(64, "0")}`,
    },
    bytes: solidRgbPng(32, 32, value),
  }));
  frames[1].identity.availableOcrHypothesisSetFingerprint = `ocr-hypothesis-set:${"1".padStart(64, "0")}`;
  frames[2].identity.availableOcrHypothesisSetFingerprint = frames[1].identity.availableOcrHypothesisSetFingerprint;
  const result = analyzer.analyze({ operationId: "operation:visual:unit", grantedRange: { startMs: 10_000, endMs: 11_000 }, frames }, performance.now() + 1_000);
  assert.deepEqual(result.intervals.map((interval) => interval.pixelDifferencePpm), [1_000_000, 19_608]);
  assert.deepEqual(result.intervals.map((interval) => interval.classification), ["visual_change_candidate", "below_visual_change_threshold"]);
  assert.deepEqual(result.intervals.map((interval) => interval.ocrHypotheses.comparison), ["changed", "unchanged"]);
  assert.equal(result.sampledRgbValues, 3 * 32 * 32 * 3);
});

test("task-private visual-transition bridge produces cold-audited cite-only intervals", async () => {
  const runtime = await visualHarness();
  try {
    const upstream = await prepareU2U5(runtime, "bridge", [10_100, 10_200, 10_300]);
    const host = new BoundedVisualTransitionHost(runtime.ledger, runtime.artifacts, {
      frameDecoder: runtime.decoder,
      recognizer: runtime.recognizer,
    });
    const bridge = new BoundedChildVisualTransitionBridge(runtime.childTask, host, {
      nextOperationId: () => "operation:visual:bridge",
    });
    await assert.rejects(bridge.call({
      frameSamplingOperationId: upstream.frames.receipt.operationId,
      ocrOperationId: upstream.ocr.receipt.operationId,
      sourcePath: "/forbidden",
    }), /accepts only exact completed/);
    const opened = await openChildVisualTransitionBridge(bridge);
    let result;
    try {
      result = await callChildVisualTransitionBridge(opened.endpoint, opened.token, {
        frameSamplingOperationId: upstream.frames.receipt.operationId,
        ocrOperationId: upstream.ocr.receipt.operationId,
      });
    } finally {
      await opened.close();
    }
    assert.deepEqual(result.observations.intervals.map((interval) => interval.classification), ["visual_change_candidate", "below_visual_change_threshold"]);
    assert.deepEqual(result.observations.intervals.map((interval) => interval.ocrHypotheses.comparison), ["changed", "unchanged"]);
    assert.equal(result.observations.nonClaims.sceneBoundary, "not_assessed");
    assert.equal(result.observations.nonClaims.shotBoundary, "not_assessed");
    assert.equal(result.observations.nonClaims.captionAuthority, "not_granted");
    const observability = await buildRuntimeObservabilityIndex(await readFile(runtime.journalPath, "utf8"));
    assert.ok(observability.sources.receipts.some((entry) => entry.kind === "visual_transition" && entry.receiptId === result.receipt.receiptId));
    const verified = await auditVisualTransition(runtime.ledger.state(), runtime.artifacts, result.operationId, {
      frameDecoder: runtime.decoder,
      recognizer: runtime.recognizer,
    });
    const citation = visualTransitionCitation({
      verified,
      intervalIds: verified.observations.intervals.map((interval) => interval.intervalId),
      target: { kind: "media_context", qualifiesMedia: { ...runtime.scope } },
    });
    assert.equal(citation.evidenceKind, "visual_transition");
    assert.equal(citation.use, "cite_only");
    assert.ok(citation.observations.every((observation) => observation.locator.kind === "temporal_range" && observation.state === "available"));
    await assert.doesNotReject(auditEvidenceCitation(runtime.ledger.state(), runtime.artifacts, citation, {
      frameDecoder: runtime.decoder,
      ocrRecognizer: runtime.recognizer,
    }));
    const forged = structuredClone(citation);
    forged.use = "claim_support";
    forged.target = { kind: "claim", claimId: "claim:scene-cut", range: { ...runtime.scope } };
    assert.throws(() => validateEvidenceCitationEnvelope(forged), /claim support requires available current-run speech/);
    const citationInput = {
      operationId: verified.observations.operationId,
      observationsArtifactId: verified.observationsArtifact.id,
      observationsContentId: verified.observationsArtifact.content.contentId,
      receiptArtifactId: verified.receiptArtifact.id,
      receiptId: verified.receipt.receiptId,
      receiptContentId: verified.receiptArtifact.content.contentId,
      intervalIds: verified.observations.intervals.map((interval) => interval.intervalId),
    };
    const report = buildStudyReportEnvelopeV2({
      task: runtime.childTask,
      executionId: verified.receipt.authorization.executionId,
      output: {
        name: "visual context",
        kind: "studio.study-report.v2",
        coverage: [{ ...runtime.scope, claimIds: [], reason: null }],
        claims: [],
      },
      semanticEvidenceInputs: [],
      verifiedSemanticEvidence: [],
      ocrEvidenceInputs: [{
        operationId: upstream.ocr.observations.operationId,
        artifactId: upstream.ocr.observationsArtifact.id,
        contentId: upstream.ocr.observationsArtifact.content.contentId,
        receiptArtifactId: upstream.ocr.receiptArtifact.id,
        receiptId: upstream.ocr.receipt.receiptId,
        receiptContentId: upstream.ocr.receiptArtifact.content.contentId,
        observationIds: upstream.ocr.observations.frames.flatMap((frame) => frame.observations.map((observation) => observation.observationId)),
      }],
      verifiedOcrEvidence: [{
        observations: upstream.ocr.observations,
        observationsArtifact: upstream.ocr.observationsArtifact,
        receipt: upstream.ocr.receipt,
        receiptArtifact: upstream.ocr.receiptArtifact,
      }],
      visualTransitionEvidenceInputs: [citationInput],
      verifiedVisualTransitionEvidence: [verified],
      dialogueScopePolicy: null,
    });
    assert.deepEqual(report.evidenceCitations.map((entry) => [entry.evidenceKind, entry.use]), [
      ["ocr_span", "cite_only"],
      ["visual_transition", "cite_only"],
    ]);
    assert.deepEqual(report.coverage[0].citationIds, []);
    await assert.rejects(host.analyze({
      operationId: "operation:visual:duplicate",
      taskId: runtime.childTask.id,
      agentId: runtime.childTask.assignedAgentId,
      grantId: runtime.visualGrantId,
      frameSamplingOperationId: upstream.frames.receipt.operationId,
      ocrOperationId: upstream.ocr.receipt.operationId,
    }), /task tool-call budget|grant call budget|duplicate canonical work/);
    assert.equal(runtime.ledger.state().visualTransitionOperations["operation:visual:duplicate"], undefined);
  } finally {
    await cleanup(runtime);
  }
});

test("concurrent identical visual-transition calls atomically admit only one operation", async () => {
  const runtime = await visualHarness();
  try {
    const upstream = await prepareU2U5(runtime, "concurrent", [10_100, 10_200]);
    const host = new BoundedVisualTransitionHost(runtime.ledger, runtime.artifacts, {
      frameDecoder: runtime.decoder,
      recognizer: runtime.recognizer,
    });
    const request = (operationId: string) => ({
      operationId,
      taskId: runtime.childTask.id,
      agentId: runtime.childTask.assignedAgentId,
      grantId: runtime.visualGrantId,
      frameSamplingOperationId: upstream.frames.receipt.operationId,
      ocrOperationId: upstream.ocr.receipt.operationId,
    });
    const settled = await Promise.allSettled([
      host.analyze(request("operation:visual:concurrent:a")),
      host.analyze(request("operation:visual:concurrent:b")),
    ]);
    assert.equal(settled.filter((entry) => entry.status === "fulfilled").length, 1);
    assert.equal(settled.filter((entry) => entry.status === "rejected").length, 1);
    assert.equal(Object.values(runtime.ledger.state().visualTransitionOperations).filter((operation) => operation.status === "completed").length, 1);
  } finally {
    await cleanup(runtime);
  }
});

test("visual-transition host rejects insufficient U2 frame input before durable work", async () => {
  const runtime = await visualHarness();
  try {
    const upstream = await prepareU2U5(runtime, "single", [10_100]);
    const host = new BoundedVisualTransitionHost(runtime.ledger, runtime.artifacts, {
      frameDecoder: runtime.decoder,
      recognizer: runtime.recognizer,
    });
    await assert.rejects(host.analyze({
      operationId: "operation:visual:single",
      taskId: runtime.childTask.id,
      agentId: runtime.childTask.assignedAgentId,
      grantId: runtime.visualGrantId,
      frameSamplingOperationId: upstream.frames.receipt.operationId,
      ocrOperationId: upstream.ocr.receipt.operationId,
    }), /exact completed same-task U2 and U5 operations/);
    assert.equal(runtime.ledger.state().visualTransitionOperations["operation:visual:single"], undefined);
  } finally {
    await cleanup(runtime);
  }
});

test("visual-transition validation rejects threshold and interval identity tampering", async () => {
  const runtime = await visualHarness();
  try {
    const upstream = await prepareU2U5(runtime, "tamper", [10_100, 10_200]);
    const produced = await new BoundedVisualTransitionHost(runtime.ledger, runtime.artifacts, {
      frameDecoder: runtime.decoder,
      recognizer: runtime.recognizer,
    }).analyze({
      operationId: "operation:visual:tamper",
      taskId: runtime.childTask.id,
      agentId: runtime.childTask.assignedAgentId,
      grantId: runtime.visualGrantId,
      frameSamplingOperationId: upstream.frames.receipt.operationId,
      ocrOperationId: upstream.ocr.receipt.operationId,
    });
    const classification = structuredClone(produced.observations);
    classification.intervals[0].classification = "below_visual_change_threshold";
    assert.throws(() => validateVisualTransitionObservations(classification), /registered pixel threshold/);
    const identity = structuredClone(produced.observations);
    identity.intervals[0].intervalId = "visual-transition-interval:forged";
    assert.throws(() => validateVisualTransitionObservations(identity), /does not close the measured interval/);
    assert.equal(VISUAL_TRANSITION_LIMITS.candidateThresholdPpm, 250_000);
  } finally {
    await cleanup(runtime);
  }
});
