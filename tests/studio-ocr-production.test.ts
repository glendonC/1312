import assert from "node:assert/strict";
import { copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import test from "node:test";

import { ContentAddressedArtifactStore, identifyFile } from "../src/studio/runtime/production/artifactStore.ts";
import { GeneralizedEvidenceAdmissionHost } from "../src/studio/runtime/production/admission/generalizedEvidenceAdmissionHost.ts";
import {
  BoundedChildOcrBridge,
  callChildOcrBridge,
  openChildOcrBridge,
} from "../src/studio/runtime/production/executor/childOcrBridge.ts";
import { auditEvidenceCitation, ocrSpanCitation } from "../src/studio/runtime/production/evidenceCitations/audit.ts";
import { buildStudyReportEnvelopeV2 } from "../src/studio/runtime/production/executor/workerContract.ts";
import type { FrameDecodeResult, FrameDecoder } from "../src/studio/runtime/production/frames/decoder.ts";
import { FfmpegFrameDecoder } from "../src/studio/runtime/production/frames/ffmpegDecoder.ts";
import { BoundedFrameSamplingHost } from "../src/studio/runtime/production/frameHost.ts";
import { FileEventJournal, RuntimeLedger } from "../src/studio/runtime/production/journal.ts";
import { CodexExecWorkerLauncher } from "../src/studio/runtime/production/launcher.ts";
import type {
  FrameDecoderLineage,
  LaunchPermit,
  MediaScope,
  OcrProducerLineage,
  SourceArtifactDescriptor,
  TaskRecord,
} from "../src/studio/runtime/production/model.ts";
import { OCR_LIMITS } from "../src/studio/runtime/production/model.ts";
import { auditOcr } from "../src/studio/runtime/production/ocrAudit.ts";
import { BoundedOcrHost } from "../src/studio/runtime/production/ocrHost.ts";
import type { OcrRecognizer, OcrRecognizerCandidate } from "../src/studio/runtime/production/ocr/recognizer.ts";
import { TesseractJsOcrRecognizer } from "../src/studio/runtime/production/ocr/tesseractRecognizer.ts";
import { buildRuntimeObservabilityIndex } from "../src/studio/runtime/production/observability/indexer.ts";
import type { PendingRuntimeEvent } from "../src/studio/runtime/production/protocol.ts";
import { BoundedRuntimeScheduler, type RuntimeIdentityFactory } from "../src/studio/runtime/production/scheduler.ts";
import { BoundedReportHost } from "../src/studio/runtime/production/study/reportHost.ts";
import { validateEvidenceCitationEnvelope } from "../src/studio/runtime/production/validation/evidenceCitations.ts";
import { runtimeTestJobContext } from "./runtime-test-job-context.ts";

const SOURCE_FIXTURE = resolve("public/demo/runs/run-006/clip.mp4");
const OCR_FRAME_FIXTURE = resolve("tests/fixtures/ocr-hello.png");
const SOURCE_DURATION_MS = 40_040;
let harnessIndex = 0;

class SequenceIdentities implements RuntimeIdentityFactory {
  private value = 0;

  next(kind: "request" | "task" | "agent" | "grant"): string {
    this.value += 1;
    return `${kind}:ocr-${this.value}`;
  }

  secret(): string {
    this.value += 1;
    return `secret:ocr-${this.value}`;
  }
}

async function sourceDescriptor(): Promise<SourceArtifactDescriptor> {
  return {
    schema: "studio.source-artifact.v1",
    adapterId: "owned-local-source-adapter.v1",
    sourceReceiptRef: "fixture:run-006:ocr-source",
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

let decoderLineagePromise: Promise<FrameDecoderLineage> | null = null;

async function decoderLineage(): Promise<FrameDecoderLineage> {
  decoderLineagePromise ??= new FfmpegFrameDecoder().currentLineage(performance.now() + 10_000);
  return structuredClone(await decoderLineagePromise);
}

class TextFixtureFrameDecoder implements FrameDecoder {
  async currentLineage(): Promise<FrameDecoderLineage> {
    return decoderLineage();
  }

  async verifyLineage(): Promise<{ lineage: FrameDecoderLineage; decoderProcesses: number }> {
    return { lineage: await decoderLineage(), decoderProcesses: 2 };
  }

  async sample(input: Parameters<FrameDecoder["sample"]>[0]): Promise<FrameDecodeResult> {
    const frames = [];
    for (const [index, requestedTimestampMs] of input.requestedTimestampsMs.entries()) {
      const path = join(input.outputDirectory, `ocr-text-${index}.png`);
      await copyFile(OCR_FRAME_FIXTURE, path);
      frames.push({
        path,
        requestedTimestampMs,
        actualPresentationTimestamp: {
          pts: requestedTimestampMs,
          sourceStartPts: 0,
          timeBase: { numerator: 1, denominator: 1_000 },
          microseconds: requestedTimestampMs * 1_000,
        },
        width: 900,
        height: 300,
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

interface OcrHarness {
  runId: string;
  directory: string;
  storeRoot: string;
  journalPath: string;
  artifacts: ContentAddressedArtifactStore;
  ledger: RuntimeLedger;
  scheduler: BoundedRuntimeScheduler;
  source: Awaited<ReturnType<ContentAddressedArtifactStore["registerSource"]>>;
  rootTask: TaskRecord;
  childTask: TaskRecord;
  childPermit: LaunchPermit;
  scope: MediaScope;
  frameGrantId: string;
  ocrGrantId: string;
  decoder: TextFixtureFrameDecoder;
}

async function ocrHarness(options: { claimChild?: boolean } = {}): Promise<OcrHarness> {
  harnessIndex += 1;
  const runId = `runtime:ocr:${harnessIndex}`;
  const directory = await mkdtemp(join(tmpdir(), "studio-ocr-"));
  const storeRoot = join(directory, "artifacts");
  const journalPath = join(directory, "events.ndjson");
  const artifacts = new ContentAddressedArtifactStore(storeRoot);
  const source = await artifacts.registerSource(runId, await sourceDescriptor());
  const ledger = await RuntimeLedger.open(runId, new FileEventJournal(journalPath), {
    now: () => new Date("2026-07-17T12:00:00.000Z"),
  });
  await artifacts.record(ledger, source);
  const scheduler = new BoundedRuntimeScheduler(ledger, {
    maxDepth: 1,
    maxActiveWorkers: 4,
    runBudget: { wallMs: 300_000, toolCalls: 24 },
    grantableCapabilities: ["task.spawn.request", "report.submit", "media.frames.sample", "media.frames.ocr"],
  }, new SequenceIdentities());
  const scope = { artifactId: source.id, trackId: "stream:0", startMs: 10_000, endMs: 11_000 };
  const root = await scheduler.createRoot({
    workloadKey: `root:ocr:${harnessIndex}`,
    objective: "Authorize one exact frame sample and one bounded local OCR operation.",
    workerKind: "orchestrator",
    workerLabel: "ocr-root",
    mediaScope: [scope],
    inputArtifactIds: [source.id],
    requiredOutputs: [{ name: "run report", artifactKind: "run-report", required: true }],
    requiredCapabilities: ["task.spawn.request"],
    dependencies: [],
    budget: { wallMs: 120_000, toolCalls: 6 },
  }, runtimeTestJobContext({ source, range: { startMs: scope.startMs, endMs: scope.endMs } }));
  const rootClaim = await scheduler.claimTaskLaunch(root, "deterministic_test", "2026-07-17T12:00:00.000Z");
  assert.equal(rootClaim.won, true);
  await scheduler.registerAgent(root);
  await scheduler.transitionTask(root.taskId, root.agentId, "working");
  const child = await scheduler.requestSpawn(root.taskId, root.agentId, {
    workloadKey: `ocr:visual-gap:${harnessIndex}`,
    objective: "Read only relevant burned-in text from already sampled U2 frames as cite-only hypotheses.",
    workerKind: "media",
    workerLabel: "bounded-ocr",
    mediaScope: [scope],
    inputArtifactIds: [source.id],
    requiredOutputs: [{ name: "visual text note", artifactKind: "visual-text-note", required: true }],
    requiredCapabilities: ["media.frames.sample", "media.frames.ocr", "report.submit"],
    dependencies: [],
    budget: { wallMs: 90_000, toolCalls: 2 },
  });
  assert.ok(child.permit, `OCR child spawn was rejected: ${child.rejection ?? "unknown"}`);
  if (options.claimChild !== false) {
    const childClaim = await scheduler.claimTaskLaunch(child.permit, "deterministic_test", "2026-07-17T12:00:00.000Z");
    assert.equal(childClaim.won, true);
    await scheduler.registerAgent(child.permit);
    await scheduler.transitionTask(child.permit.taskId, child.permit.agentId, "working");
    const claimedTask = ledger.state().tasks[child.permit.taskId];
    await ledger.transact(
      { producer: { kind: "launcher", id: "ocr-test-executor" }, causationId: child.requestId },
      () => ({
        pending: [{
          type: "executor.started",
          data: {
            executionId: `execution:ocr:${harnessIndex}`,
            taskId: claimedTask.id,
            agentId: claimedTask.assignedAgentId,
            launchClaimId: childClaim.claim.id,
            startedAt: "2026-07-17T12:00:00.000Z",
          },
        }] satisfies PendingRuntimeEvent[],
        result: undefined,
      }),
    );
  }
  const childTask = ledger.state().tasks[child.permit.taskId];
  const frameGrant = childTask.grants.find((grant) => grant.capability === "media.frames.sample");
  const ocrGrant = childTask.grants.find((grant) => grant.capability === "media.frames.ocr");
  assert.ok(frameGrant?.frameScope && ocrGrant?.ocrScope);
  return {
    runId,
    directory,
    storeRoot,
    journalPath,
    artifacts,
    ledger,
    scheduler,
    source,
    rootTask: ledger.state().tasks[root.taskId],
    childTask,
    childPermit: child.permit,
    scope,
    frameGrantId: frameGrant.id,
    ocrGrantId: ocrGrant.id,
    decoder: new TextFixtureFrameDecoder(),
  };
}

async function cleanup(runtime: OcrHarness): Promise<void> {
  await rm(runtime.directory, { recursive: true, force: true });
}

async function sampleFrames(runtime: OcrHarness, operationId: string, timestampsMs: number[]) {
  return new BoundedFrameSamplingHost(runtime.ledger, runtime.artifacts, { decoder: runtime.decoder }).sample({
    operationId,
    taskId: runtime.childTask.id,
    agentId: runtime.childTask.assignedAgentId,
    grantId: runtime.frameGrantId,
    requestedTimestampsMs: timestampsMs,
  });
}

function ocrRequest(runtime: OcrHarness, operationId: string, frameSamplingOperationId: string) {
  return {
    operationId,
    taskId: runtime.childTask.id,
    agentId: runtime.childTask.assignedAgentId,
    grantId: runtime.ocrGrantId,
    frameSamplingOperationId,
  };
}

let producerLineagePromise: Promise<OcrProducerLineage> | null = null;

async function producerLineage(): Promise<OcrProducerLineage> {
  producerLineagePromise ??= new TesseractJsOcrRecognizer().currentLineage(performance.now() + 15_000);
  return structuredClone(await producerLineagePromise);
}

class FixtureOcrRecognizer implements OcrRecognizer {
  private readonly candidates: OcrRecognizerCandidate[];

  constructor(candidates: OcrRecognizerCandidate[]) {
    this.candidates = candidates;
  }

  async currentLineage(): Promise<OcrProducerLineage> {
    return producerLineage();
  }

  async recognize(frames: Parameters<OcrRecognizer["recognize"]>[0]) {
    return {
      lineage: await producerLineage(),
      frames: frames.map((frame) => ({ frameId: frame.identity.frameId, candidates: structuredClone(this.candidates) })),
    };
  }
}

test("pinned local OCR reads real U2 PNG bytes and cold-audits one cite-only U3 path", async () => {
  const runtime = await ocrHarness();
  const recognizer = new TesseractJsOcrRecognizer();
  try {
    const sampled = await sampleFrames(runtime, "operation:frames:ocr-real", [10_123]);
    const produced = await new BoundedOcrHost(runtime.ledger, runtime.artifacts, {
      recognizer,
      frameDecoder: runtime.decoder,
    }).recognize(ocrRequest(runtime, "operation:ocr:real", sampled.receipt.operationId));
    assert.equal(produced.observations.state, "available");
    assert.deepEqual(
      produced.observations.frames[0].observations.map((entry) => entry.normalizedText),
      ["HELLO", "1321"],
    );
    assert.ok(produced.observations.frames[0].observations.every((entry) => entry.confidence >= OCR_LIMITS.minConfidence));
    assert.equal(produced.observations.frames[0].frameId, sampled.frames[0].identity.frameId);
    assert.equal(produced.observations.frames[0].frameContentId, sampled.frames[0].artifact.content.contentId);
    assert.equal(produced.receipt.input.frames[0].contentId, sampled.frames[0].artifact.content.contentId);
    assert.equal(produced.receipt.producer.runtime.package.version, "7.0.0");
    assert.deepEqual(produced.receipt.producer.models.map((entry) => entry.language), ["kor", "eng"]);
    assert.deepEqual(produced.observations.nonClaims, {
      textTruth: "not_assessed",
      identity: "not_assessed",
      spellingTruth: "not_assessed",
      translation: "not_performed",
      culturalMeaning: "not_assessed",
      dialogueAuthority: "not_granted",
      personIdentification: "not_performed",
    });
    const observability = await buildRuntimeObservabilityIndex(await readFile(runtime.journalPath, "utf8"));
    assert.ok(observability.sources.receipts.some((entry) => entry.kind === "ocr" && entry.receiptId === produced.receipt.receiptId));

    const observationIds = produced.observations.frames.flatMap((frame) => frame.observations.map((entry) => entry.observationId));
    const verifiedOcr = {
      observations: produced.observations,
      observationsArtifact: produced.observationsArtifact,
      receipt: produced.receipt,
      receiptArtifact: produced.receiptArtifact,
    };
    const citation = ocrSpanCitation({
      verified: verifiedOcr,
      observationIds,
      target: {
        kind: "media_context",
        qualifiesMedia: { artifactId: runtime.source.id, trackId: runtime.scope.trackId, startMs: runtime.scope.startMs, endMs: runtime.scope.endMs },
      },
    });
    assert.equal(citation.evidenceKind, "ocr_span");
    assert.equal(citation.use, "cite_only");
    assert.ok(citation.observations.every((entry) => entry.locator.kind === "media_point"));
    await assert.doesNotReject(auditEvidenceCitation(runtime.ledger.state(), runtime.artifacts, citation, {
      frameDecoder: runtime.decoder,
      ocrRecognizer: recognizer,
    }));
    const forged = structuredClone(citation);
    forged.use = "claim_support";
    forged.target = { kind: "claim", claimId: "claim:forged-dialogue", range: { artifactId: runtime.source.id, trackId: runtime.scope.trackId, startMs: runtime.scope.startMs, endMs: runtime.scope.endMs } };
    assert.throws(() => validateEvidenceCitationEnvelope(forged), /claim support requires available current-run speech/);
    const ocrEvidenceInput = {
      operationId: produced.observations.operationId,
      artifactId: produced.observationsArtifact.id,
      contentId: produced.observationsArtifact.content.contentId,
      receiptArtifactId: produced.receiptArtifact.id,
      receiptId: produced.receipt.receiptId,
      receiptContentId: produced.receiptArtifact.content.contentId,
      observationIds,
    };
    const report = buildStudyReportEnvelopeV2({
      task: runtime.childTask,
      executionId: produced.receipt.authorization.executionId,
      output: {
        name: "visual text context",
        kind: "studio.study-report.v2",
        coverage: [{ ...runtime.scope, claimIds: [], reason: null }],
        claims: [],
      },
      semanticEvidenceInputs: [],
      verifiedSemanticEvidence: [],
      ocrEvidenceInputs: [ocrEvidenceInput],
      verifiedOcrEvidence: [verifiedOcr],
      dialogueScopePolicy: null,
    });
    assert.deepEqual(report.evidenceCitations.map((entry) => [entry.evidenceKind, entry.use]), [["ocr_span", "cite_only"]]);
    assert.deepEqual(report.coverage[0].citationIds, []);
    await assert.doesNotReject(new GeneralizedEvidenceAdmissionHost(runtime.ledger.state(), runtime.artifacts, {
      frameDecoder: runtime.decoder,
      ocrRecognizer: recognizer,
      dialogueScopePolicyResolver: async () => null,
    }).admit(report));

    const cold = await RuntimeLedger.open(runtime.runId, new FileEventJournal(runtime.journalPath));
    await assert.doesNotReject(auditOcr(cold.state(), runtime.artifacts, "operation:ocr:real", {
      frameDecoder: runtime.decoder,
      recognizer,
    }));
    const outputPath = join(runtime.storeRoot, produced.observationsArtifact.storageKey);
    const original = await readFile(outputPath);
    await writeFile(outputPath, Buffer.from("tampered OCR observations", "utf8"));
    await assert.rejects(
      auditOcr(cold.state(), runtime.artifacts, "operation:ocr:real", { frameDecoder: runtime.decoder, recognizer }),
      /no longer matches|failed content verification/,
    );
    await writeFile(outputPath, original);
  } finally {
    await cleanup(runtime);
  }
});

for (const scenario of [
  {
    name: "empty",
    candidates: [],
    state: "empty",
    reason: "no_text_detected",
    observationReasons: [],
  },
  {
    name: "low-confidence",
    candidates: [{ text: "GUESS", confidence: 69, boundingBox: { x0: 20, y0: 20, x1: 180, y1: 80 } }],
    state: "unknown",
    reason: "all_text_below_confidence",
    observationReasons: ["below_confidence_threshold"],
  },
  {
    name: "conflicting",
    candidates: [
      { text: "ONE", confidence: 95, boundingBox: { x0: 20, y0: 20, x1: 180, y1: 80 } },
      { text: "TWO", confidence: 95, boundingBox: { x0: 20, y0: 20, x1: 180, y1: 80 } },
    ],
    state: "unknown",
    reason: "conflicting_hypotheses_withheld",
    observationReasons: ["conflicting_hypotheses", "conflicting_hypotheses"],
  },
  {
    name: "truncated",
    candidates: Array.from({ length: OCR_LIMITS.maxBoxesPerFrame + 1 }, (_, index) => ({
      text: "TEXT",
      confidence: 95,
      boundingBox: { x0: index, y0: 20, x1: index + 1, y1: 80 },
    })),
    state: "truncated",
    reason: "output_limit_exceeded",
    observationReasons: [],
  },
] as const) {
  test(`${scenario.name} OCR stays withheld or truncated without leaking fluent text`, async () => {
    const runtime = await ocrHarness();
    const recognizer = new FixtureOcrRecognizer([...scenario.candidates]);
    try {
      const sampled = await sampleFrames(runtime, `operation:frames:${scenario.name}`, [10_123]);
      const produced = await new BoundedOcrHost(runtime.ledger, runtime.artifacts, {
        recognizer,
        frameDecoder: runtime.decoder,
      }).recognize(ocrRequest(runtime, `operation:ocr:${scenario.name}`, sampled.receipt.operationId));
      assert.equal(produced.observations.state, scenario.state);
      assert.equal(produced.observations.reason, scenario.reason);
      const hypotheses = produced.observations.frames.flatMap((frame) => frame.observations);
      assert.deepEqual(hypotheses.map((entry) => entry.reason), scenario.observationReasons);
      assert.ok(hypotheses.every((entry) => entry.normalizedText === null));
      const citation = ocrSpanCitation({
        verified: {
          observations: produced.observations,
          observationsArtifact: produced.observationsArtifact,
          receipt: produced.receipt,
          receiptArtifact: produced.receiptArtifact,
        },
        observationIds: hypotheses.map((entry) => entry.observationId),
        target: {
          kind: "media_context",
          qualifiesMedia: { artifactId: runtime.source.id, trackId: runtime.scope.trackId, startMs: runtime.scope.startMs, endMs: runtime.scope.endMs },
        },
      });
      assert.equal(citation.use, "cite_only");
      assert.equal(citation.observations.length, hypotheses.length);
      if (scenario.state === "empty") assert.equal(citation.upstreamState, "unknown");
      if (scenario.state === "truncated") assert.equal(citation.upstreamState, "truncated");
    } finally {
      await cleanup(runtime);
    }
  });
}

test("the child bridge injects authority and returns only receipted OCR over a completed frame operation", async () => {
  const runtime = await ocrHarness();
  const recognizer = new FixtureOcrRecognizer([
    { text: " HELLO  ", confidence: 96, boundingBox: { x0: 20, y0: 20, x1: 180, y1: 80 } },
  ]);
  try {
    const sampled = await sampleFrames(runtime, "operation:frames:bridge", [10_123]);
    const bridge = new BoundedChildOcrBridge(
      runtime.childTask,
      new BoundedOcrHost(runtime.ledger, runtime.artifacts, { recognizer, frameDecoder: runtime.decoder }),
      { nextOperationId: () => "operation:ocr:bridge" },
    );
    const opened = await openChildOcrBridge(bridge);
    try {
      assert.equal(opened.manifest.tool.capability, "media.frames.ocr");
      const result = await callChildOcrBridge(opened.endpoint, opened.token, {
        frameSamplingOperationId: sampled.receipt.operationId,
      });
      assert.equal(result.operationId, "operation:ocr:bridge");
      assert.equal(result.observations.frames[0].observations[0].normalizedText, "HELLO");
      assert.equal(result.receipt.request.frameSamplingOperationId, sampled.receipt.operationId);
      assert.equal(result.receipt.authorization.taskId, runtime.childTask.id);
      await assert.rejects(
        callChildOcrBridge(opened.endpoint, opened.token, { frameSamplingOperationId: sampled.receipt.operationId }),
        /rejected|call budget/,
      );
    } finally {
      await opened.close();
    }
    await assert.rejects(
      new BoundedChildOcrBridge(runtime.rootTask, new BoundedOcrHost(runtime.ledger, runtime.artifacts, { recognizer, frameDecoder: runtime.decoder })).call({ frameSamplingOperationId: sampled.receipt.operationId }),
      /no exact OCR grant/,
    );
  } finally {
    await cleanup(runtime);
  }
});

test("Codex launcher mounts frame plus OCR tools and requires authenticated OCR evidence echo", async () => {
  const runtime = await ocrHarness({ claimChild: false });
  const recognizer = new FixtureOcrRecognizer([
    { text: "TITLE", confidence: 97, boundingBox: { x0: 20, y0: 20, x1: 180, y1: 80 } },
  ]);
  const fake = join(runtime.directory, "fake-ocr-codex.mjs");
  const debugPath = join(runtime.directory, "fake-ocr-codex.debug");
  await writeFile(fake, `
import { appendFileSync } from "node:fs";
const debugPath = ${JSON.stringify(debugPath)};
const stage = (value) => appendFileSync(debugPath, value + "\\n");
const args = process.argv.slice(2);
if (args[0] === "--version") {
  process.stdout.write("codex-cli ocr-launcher-test-1.0.0\\n");
  process.exit(0);
}
let prompt = "";
for await (const chunk of process.stdin) prompt += chunk;
stage("prompt-flags:" + [
  prompt.includes("media_frames_sample") && prompt.includes("media_frames_ocr"),
  prompt.includes("OCR text is a visual hypothesis"),
  prompt.includes("cannot replace or overwrite speech evidence"),
].join(","));
if (!prompt.includes("media_frames_sample") || !prompt.includes("media_frames_ocr") ||
    !prompt.includes("OCR text is a visual hypothesis") ||
    !prompt.includes("cannot replace or overwrite speech evidence")) {
  throw new Error("OCR worker prompt lost its capability boundary");
}
stage("prompt");
for (const name of ["FRAME", "OCR"]) {
  if (!process.env["STUDIO_CHILD_" + name + "_BRIDGE_URL"] || !process.env["STUDIO_CHILD_" + name + "_BRIDGE_TOKEN"]) {
    throw new Error("missing task-private " + name.toLowerCase() + " bridge environment");
  }
}
stage("environment");
const call = async (name, url, token, argumentsValue) => {
  const response = await fetch(url + "/call", {
    method: "POST",
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body: JSON.stringify({ name, arguments: argumentsValue }),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(JSON.stringify(body));
  return body;
};
const frames = await call(
  "media_frames_sample",
  process.env.STUDIO_CHILD_FRAME_BRIDGE_URL,
  process.env.STUDIO_CHILD_FRAME_BRIDGE_TOKEN,
  { timestampsMs: [10123] },
);
stage("frames:" + frames.operationId);
const ocr = await call(
  "media_frames_ocr",
  process.env.STUDIO_CHILD_OCR_BRIDGE_URL,
  process.env.STUDIO_CHILD_OCR_BRIDGE_TOKEN,
  { frameSamplingOperationId: frames.operationId },
);
stage("ocr:" + ocr.operationId);
const observationIds = ocr.observations.frames.flatMap((frame) => frame.observations.map((entry) => entry.observationId));
const final = {
  summary: "One exact frame gap received bounded OCR; the result remains cite-only visual context.",
  ocrEvidenceInputs: [{
    operationId: ocr.operationId,
    artifactId: ocr.observationsArtifactId,
    contentId: ocr.observationsContentId,
    receiptArtifactId: ocr.receiptArtifactId,
    receiptId: ocr.receipt.receiptId,
    receiptContentId: ocr.receiptContentId,
    observationIds,
  }],
  outputs: [{ name: "visual text note", kind: "visual-text-note", content: "A receipted OCR hypothesis exists; it is not dialogue authority." }],
};
process.stdout.write([
  JSON.stringify({ type: "thread.started", thread_id: "thread:ocr-launcher" }),
  JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: JSON.stringify(final) } }),
  JSON.stringify({ type: "turn.completed", usage: { input_tokens: 10, cached_input_tokens: 0, output_tokens: 8, reasoning_output_tokens: 0 } }),
  "",
].join("\\n"));
`);
  try {
    const frameHost = new BoundedFrameSamplingHost(runtime.ledger, runtime.artifacts, { decoder: runtime.decoder });
    const ocrHost = new BoundedOcrHost(runtime.ledger, runtime.artifacts, { recognizer, frameDecoder: runtime.decoder });
    let result;
    try {
      result = await new CodexExecWorkerLauncher(
        runtime.ledger,
        runtime.scheduler,
        runtime.artifacts,
        new BoundedReportHost(runtime.ledger, () => "report:ocr-launcher", runtime.artifacts),
        {
          executable: process.execPath,
          executableArgsPrefix: [fake],
          frameHost,
          ocrHost,
          ocrRecognizer: recognizer,
          ocrFrameDecoder: runtime.decoder,
          nextExecutionId: () => "execution:ocr:launcher",
          nextFrameOperationId: () => "operation:frames:ocr-launcher",
          nextOcrOperationId: () => "operation:ocr:launcher",
          maximumWallMs: 60_000,
        },
      ).launch(runtime.childPermit);
    } catch (cause) {
      const debug = await readFile(debugPath, "utf8").catch(() => "no fake-worker stage was recorded");
      throw new Error(`OCR launcher fixture failed after: ${debug.trim()}`, { cause });
    }
    assert.equal(result.execution.outcome, "completed");
    assert.equal(result.report.status, "submitted");
    assert.equal(runtime.ledger.state().frameSamples["operation:frames:ocr-launcher"].status, "completed");
    assert.equal(runtime.ledger.state().ocrOperations["operation:ocr:launcher"].status, "completed");
    assert.deepEqual(result.artifacts.map((artifact) => artifact.kind), ["visual-text-note"]);
  } finally {
    await cleanup(runtime);
  }
});

test("missing frames, over-count frame input, and missing pinned models fail closed without receipts", async () => {
  const missing = await ocrHarness();
  try {
    const before = (await missing.ledger.events()).length;
    await assert.rejects(
      new BoundedOcrHost(missing.ledger, missing.artifacts, { frameDecoder: missing.decoder }).recognize(
        ocrRequest(missing, "operation:ocr:missing-frame", "operation:frames:absent"),
      ),
      /completed same-task U2 frame sample/,
    );
    assert.equal(missing.ledger.state().ocrOperations["operation:ocr:missing-frame"], undefined);
    assert.equal((await missing.ledger.events()).length, before);
  } finally {
    await cleanup(missing);
  }

  const overCount = await ocrHarness();
  try {
    const sampled = await sampleFrames(overCount, "operation:frames:too-many-for-ocr", [10_101, 10_202, 10_303, 10_404, 10_505]);
    await assert.rejects(
      new BoundedOcrHost(overCount.ledger, overCount.artifacts, { frameDecoder: overCount.decoder }).recognize(
        ocrRequest(overCount, "operation:ocr:too-many", sampled.receipt.operationId),
      ),
      /inside its frame limit/,
    );
    assert.equal(overCount.ledger.state().ocrOperations["operation:ocr:too-many"], undefined);
  } finally {
    await cleanup(overCount);
  }

  const missingModel = await ocrHarness();
  try {
    const sampled = await sampleFrames(missingModel, "operation:frames:missing-model", [10_123]);
    const unavailable = new TesseractJsOcrRecognizer({ modelDirectory: join(missingModel.directory, "models-do-not-exist") });
    await assert.rejects(
      new BoundedOcrHost(missingModel.ledger, missingModel.artifacts, {
        recognizer: unavailable,
        frameDecoder: missingModel.decoder,
      }).recognize(ocrRequest(missingModel, "operation:ocr:missing-model", sampled.receipt.operationId)),
      /Pinned OCR runtime or model files are unavailable/,
    );
    const operation = missingModel.ledger.state().ocrOperations["operation:ocr:missing-model"];
    assert.equal(operation.status, "failed");
    assert.equal(operation.failure, "model_unavailable");
    assert.equal(operation.outputArtifactId, null);
    assert.equal(operation.receiptArtifactId, null);
  } finally {
    await cleanup(missingModel);
  }
});
