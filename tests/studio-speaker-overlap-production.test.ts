import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import test from "node:test";

import { deriveGeneralizedCoverageDecision } from "../src/studio/runtime/production/admission/generalizedCoveragePolicy.ts";
import { GeneralizedEvidenceAdmissionHost } from "../src/studio/runtime/production/admission/generalizedEvidenceAdmissionHost.ts";
import { ContentAddressedArtifactStore, identifyFile } from "../src/studio/runtime/production/artifactStore.ts";
import {
  BoundedChildSpeakerBridge,
  callChildSpeakerBridge,
  openChildSpeakerBridge,
} from "../src/studio/runtime/production/executor/childSpeakerBridge.ts";
import { auditEvidenceCitation, speakerTurnCitation } from "../src/studio/runtime/production/evidenceCitations/audit.ts";
import { buildStudyReportEnvelopeV2 } from "../src/studio/runtime/production/executor/workerContract.ts";
import { FileEventJournal, RuntimeLedger } from "../src/studio/runtime/production/journal.ts";
import type {
  LaunchPermit,
  MediaScope,
  SourceArtifactDescriptor,
  SpeakerOverlapProducerLineage,
  TaskRecord,
} from "../src/studio/runtime/production/model.ts";
import { SPEAKER_OVERLAP_LIMITS } from "../src/studio/runtime/production/model.ts";
import { buildRuntimeObservabilityIndex } from "../src/studio/runtime/production/observability/indexer.ts";
import type { PendingRuntimeEvent } from "../src/studio/runtime/production/protocol.ts";
import { BoundedRuntimeScheduler, type RuntimeIdentityFactory } from "../src/studio/runtime/production/scheduler.ts";
import type { SpeakerDiarizer, SpeakerDiarizerResult } from "../src/studio/runtime/production/speaker/diarizer.ts";
import { SpeakerDiarizerFailure } from "../src/studio/runtime/production/speaker/diarizer.ts";
import { SherpaOnnxSpeakerDiarizer } from "../src/studio/runtime/production/speaker/sherpaOnnxDiarizer.ts";
import { auditSpeakerOverlap } from "../src/studio/runtime/production/speakerAudit.ts";
import { BoundedSpeakerOverlapHost } from "../src/studio/runtime/production/speakerHost.ts";
import { defersSpeakerOverlapRestudy } from "../src/studio/runtime/production/study/rangePassHost.ts";
import { evidenceCitationId, validateEvidenceCitationEnvelope } from "../src/studio/runtime/production/validation/evidenceCitations.ts";
import { runtimeTestJobContext } from "./runtime-test-job-context.ts";

const SOURCE_FIXTURE = resolve("public/demo/runs/run-006/clip.mp4");
const SOURCE_DURATION_MS = 40_040;
let harnessIndex = 0;

class SequenceIdentities implements RuntimeIdentityFactory {
  private value = 0;
  next(kind: "request" | "task" | "agent" | "grant"): string {
    this.value += 1;
    return `${kind}:speakers-${this.value}`;
  }
  secret(): string {
    this.value += 1;
    return `secret:speakers-${this.value}`;
  }
}

async function sourceDescriptor(): Promise<SourceArtifactDescriptor> {
  return {
    schema: "studio.source-artifact.v1",
    adapterId: "owned-local-source-adapter.v1",
    sourceReceiptRef: "fixture:run-006:speaker-source",
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

interface SpeakerHarness {
  runId: string;
  directory: string;
  journalPath: string;
  artifacts: ContentAddressedArtifactStore;
  ledger: RuntimeLedger;
  source: Awaited<ReturnType<ContentAddressedArtifactStore["registerSource"]>>;
  childTask: TaskRecord;
  childPermit: LaunchPermit;
  scope: MediaScope;
  grantId: string;
}

async function speakerHarness(options: { claimChild?: boolean; scope?: { startMs: number; endMs: number } } = {}): Promise<SpeakerHarness> {
  harnessIndex += 1;
  const runId = `runtime:speakers:${harnessIndex}`;
  const directory = await mkdtemp(join(tmpdir(), "studio-speakers-test-"));
  const journalPath = join(directory, "events.ndjson");
  const artifacts = new ContentAddressedArtifactStore(join(directory, "artifacts"));
  const source = await artifacts.registerSource(runId, await sourceDescriptor());
  const ledger = await RuntimeLedger.open(runId, new FileEventJournal(journalPath), { now: () => new Date("2026-07-17T14:00:00.000Z") });
  await artifacts.record(ledger, source);
  const scheduler = new BoundedRuntimeScheduler(ledger, {
    maxDepth: 1,
    maxActiveWorkers: 4,
    runBudget: { wallMs: 300_000, toolCalls: 16 },
    grantableCapabilities: ["task.spawn.request", "report.submit", "media.speakers.analyze"],
  }, new SequenceIdentities());
  const selected = options.scope ?? { startMs: 10_000, endMs: 15_000 };
  const scope = { artifactId: source.id, trackId: "stream:1", ...selected };
  const root = await scheduler.createRoot({
    workloadKey: `root:speakers:${harnessIndex}`,
    objective: "Authorize one bounded anonymous speaker/overlap evidence operation.",
    workerKind: "orchestrator",
    workerLabel: "speaker-root",
    mediaScope: [scope],
    inputArtifactIds: [source.id],
    requiredOutputs: [{ name: "run report", artifactKind: "run-report", required: true }],
    requiredCapabilities: ["task.spawn.request"],
    dependencies: [],
    budget: { wallMs: 120_000, toolCalls: 4 },
  }, runtimeTestJobContext({ source, range: selected }));
  const rootClaim = await scheduler.claimTaskLaunch(root, "deterministic_test", "2026-07-17T14:00:00.000Z");
  assert.equal(rootClaim.won, true);
  await scheduler.registerAgent(root);
  await scheduler.transitionTask(root.taskId, root.agentId, "working");
  const child = await scheduler.requestSpawn(root.taskId, root.agentId, {
    workloadKey: `speaker:slice:${harnessIndex}`,
    objective: "Produce anonymous run-local turn and overlap evidence without authorizing dialogue text.",
    workerKind: "analysis",
    workerLabel: "bounded-anonymous-speakers",
    mediaScope: [scope],
    inputArtifactIds: [source.id],
    requiredOutputs: [{ name: "coverage note", artifactKind: "coverage-note", required: true }],
    requiredCapabilities: ["media.speakers.analyze", "report.submit"],
    dependencies: [],
    budget: { wallMs: 90_000, toolCalls: 1 },
  });
  assert.ok(child.permit, `Speaker child spawn was rejected: ${child.rejection ?? "unknown"}`);
  if (options.claimChild !== false) {
    const claim = await scheduler.claimTaskLaunch(child.permit, "deterministic_test", "2026-07-17T14:00:00.000Z");
    assert.equal(claim.won, true);
    await scheduler.registerAgent(child.permit);
    await scheduler.transitionTask(child.permit.taskId, child.permit.agentId, "working");
    const childTask = ledger.state().tasks[child.permit.taskId];
    await ledger.transact(
      { producer: { kind: "launcher", id: "speaker-test-executor" }, causationId: child.requestId },
      () => ({
        pending: [{
          type: "executor.started",
          data: {
            executionId: `execution:speakers:${harnessIndex}`,
            taskId: childTask.id,
            agentId: childTask.assignedAgentId,
            launchClaimId: claim.claim.id,
            startedAt: "2026-07-17T14:00:00.000Z",
          },
        }] satisfies PendingRuntimeEvent[],
        result: undefined,
      }),
    );
  }
  const childTask = ledger.state().tasks[child.permit.taskId];
  const grant = childTask.grants.find((candidate) => candidate.capability === "media.speakers.analyze");
  assert.ok(grant?.speakerScope);
  return { runId, directory, journalPath, artifacts, ledger, source, childTask, childPermit: child.permit, scope, grantId: grant.id };
}

let lineagePromise: Promise<SpeakerOverlapProducerLineage> | null = null;
async function pinnedLineage(): Promise<SpeakerOverlapProducerLineage> {
  lineagePromise ??= new SherpaOnnxSpeakerDiarizer().currentLineage(performance.now() + 15_000);
  return structuredClone(await lineagePromise);
}

class FixtureSpeakerDiarizer implements SpeakerDiarizer {
  private readonly result: Omit<SpeakerDiarizerResult, "lineage">;
  calls = 0;

  constructor(segments: SpeakerDiarizerResult["segments"] = [
    { startMs: 0, endMs: 3_000, speakerCluster: 8 },
    { startMs: 2_500, endMs: 4_500, speakerCluster: 21 },
    { startMs: 4_500, endMs: 4_700, speakerCluster: 8 },
  ]) {
    this.result = { segments };
  }

  async currentLineage(): Promise<SpeakerOverlapProducerLineage> {
    return pinnedLineage();
  }

  async diarize(): Promise<SpeakerDiarizerResult> {
    this.calls += 1;
    return { lineage: await pinnedLineage(), segments: structuredClone(this.result.segments) };
  }
}

function request(runtime: SpeakerHarness, operationId: string) {
  return {
    operationId,
    taskId: runtime.childTask.id,
    agentId: runtime.childTask.assignedAgentId,
    grantId: runtime.grantId,
  };
}

test("pinned sherpa native producer emits anonymous hypotheses over real owned audio", async () => {
  const runtime = await speakerHarness();
  try {
    const produced = await new BoundedSpeakerOverlapHost(runtime.ledger, runtime.artifacts).analyze(
      request(runtime, "operation:speakers:pinned-real"),
    );
    assert.ok(produced.observations.turns.length > 0);
    assert.equal(produced.observations.accounting[0].startMs, runtime.scope.startMs);
    assert.equal(produced.observations.accounting.at(-1)?.endMs, runtime.scope.endMs);
    assert.equal(produced.receipt.producer.runtime.execution.engine, "native_node_addon");
    assert.equal(produced.receipt.producer.runtime.package.name, "sherpa-onnx-node");
    assert.ok(produced.observations.turns.every((turn) => /^anon_cluster_[1-9][0-9]*$/.test(turn.speakerLabel)));
  } finally {
    await rm(runtime.directory, { recursive: true, force: true });
  }
});

test("U6 producer closes real owned audio bytes, immutable receipts, cold audit, and U3 conflict states", async () => {
  const runtime = await speakerHarness();
  const diarizer = new FixtureSpeakerDiarizer();
  try {
    const produced = await new BoundedSpeakerOverlapHost(runtime.ledger, runtime.artifacts, { diarizer }).analyze(request(runtime, "operation:speakers:complete"));
    assert.equal(diarizer.calls, 1);
    assert.deepEqual(produced.observations.accounting.map((cell) => [cell.startMs, cell.endMs, cell.state, cell.kind]), [
      [10_000, 12_500, "available", "anonymous_turn"],
      [12_500, 13_000, "conflicting", "overlap"],
      [13_000, 14_500, "available", "anonymous_turn"],
      [14_500, 14_700, "unknown", "rapid_turn"],
      [14_700, 15_000, "unknown", "no_hypothesis"],
    ]);
    assert.deepEqual([...new Set(produced.observations.turns.map((turn) => turn.speakerLabel))], ["anon_cluster_1", "anon_cluster_2"]);
    assert.deepEqual(produced.observations.labelScope, {
      kind: "run_artifact_operation_local",
      runId: runtime.runId,
      sourceArtifactId: runtime.source.id,
      operationId: "operation:speakers:complete",
    });
    assert.equal(produced.observations.nonClaims.personIdentity, "not_assessed");
    assert.equal(produced.observations.nonClaims.crossRunIdentity, "not_available");
    assert.equal(produced.observations.nonClaims.dialogueAuthority, "not_granted");
    assert.equal(produced.receipt.input.normalizedAudio.sampleRateHz, 16_000);
    assert.equal(produced.receipt.input.normalizedAudio.sampleCount, 80_000);
    assert.equal(produced.receipt.producer.runtime.execution.network, "disabled");
    assert.equal(produced.receipt.producer.models.segmentation.content.contentId, "sha256:220ad67ca923bef2fa91f2390c786097bf305bceb5e261d4af67b38e938e1079");
    assert.equal(produced.receipt.producer.models.embedding.content.contentId, "sha256:1a331345f04805badbb495c775a6ddffcdd1a732567d5ec8b3d5749e3c7a5e4b");

    const replay = await RuntimeLedger.open(runtime.runId, new FileEventJournal(runtime.journalPath));
    const verified = await auditSpeakerOverlap(replay.state(), runtime.artifacts, produced.observations.operationId, { diarizer });
    assert.equal(verified.receipt.receiptId, produced.receipt.receiptId);
    assert.equal(diarizer.calls, 1, "cold audit must rehash lineage without rerunning inference");
    const index = await buildRuntimeObservabilityIndex(await readFile(runtime.journalPath, "utf8"));
    assert.ok(index.sources.receipts.some((entry) => entry.kind === "speaker_overlap" && entry.receiptId === produced.receipt.receiptId));

    const fullCitation = speakerTurnCitation({
      verified,
      target: { kind: "coverage", range: { artifactId: runtime.source.id, trackId: runtime.scope.trackId, startMs: 10_000, endMs: 15_000 } },
    });
    assert.equal(fullCitation.use, "coverage_qualification");
    assert.equal(fullCitation.observations.length, produced.observations.accounting.length);
    assert.equal(deriveGeneralizedCoverageDecision({ claimCount: 0, citations: [fullCitation], dialogueScopePolicy: null, range: fullCitation.target.kind === "coverage" ? fullCitation.target.range : runtime.scope, declaredReasonCode: null }).state, "conflicting");
    const rapidCitation = speakerTurnCitation({
      verified,
      target: { kind: "coverage", range: { artifactId: runtime.source.id, trackId: runtime.scope.trackId, startMs: 14_500, endMs: 14_700 } },
    });
    assert.equal(deriveGeneralizedCoverageDecision({ claimCount: 0, citations: [rapidCitation], dialogueScopePolicy: null, range: rapidCitation.target.kind === "coverage" ? rapidCitation.target.range : runtime.scope, declaredReasonCode: null }).state, "unknown");
    await auditEvidenceCitation(replay.state(), runtime.artifacts, fullCitation, { speakerDiarizer: diarizer });

    const speakerEvidenceInput = {
      operationId: produced.observations.operationId,
      artifactId: produced.observationsArtifact.id,
      contentId: produced.observationsArtifact.content.contentId,
      receiptArtifactId: produced.receiptArtifact.id,
      receiptId: produced.receipt.receiptId,
      receiptContentId: produced.receiptArtifact.content.contentId,
    };
    const report = buildStudyReportEnvelopeV2({
      task: runtime.childTask,
      executionId: replay.state().speakerOverlapOperations[produced.observations.operationId].executionId,
      output: {
        name: "coverage note",
        kind: "studio.study-report.v2",
        coverage: produced.observations.accounting.map((cell) => ({
          artifactId: runtime.source.id,
          trackId: runtime.scope.trackId,
          startMs: cell.startMs,
          endMs: cell.endMs,
          claimIds: [],
          reason: null,
        })),
        claims: [],
      },
      semanticEvidenceInputs: [],
      verifiedSemanticEvidence: [],
      ocrEvidenceInputs: [],
      verifiedOcrEvidence: [],
      speakerEvidenceInputs: [speakerEvidenceInput],
      verifiedSpeakerEvidence: [verified],
      dialogueScopePolicy: null,
    });
    assert.deepEqual(report.coverage.map((cell) => cell.state), ["unknown", "conflicting", "unknown", "unknown", "unknown"]);
    assert.ok(report.evidenceCitations.every((citation) => citation.evidenceKind === "speaker_turn" && citation.use === "coverage_qualification"));
    const admitted = await new GeneralizedEvidenceAdmissionHost(replay.state(), runtime.artifacts, { speakerDiarizer: diarizer }).admit(report);
    assert.deepEqual(admitted.reportEnvelope.coverage.map((cell) => cell.state), report.coverage.map((cell) => cell.state));

    const cherryPicked = structuredClone(fullCitation);
    cherryPicked.observations.splice(1, 1);
    const { schema: _schema, citationId: _citationId, ...body } = cherryPicked;
    cherryPicked.citationId = evidenceCitationId(body);
    validateEvidenceCitationEnvelope(cherryPicked);
    await assert.rejects(
      auditEvidenceCitation(replay.state(), runtime.artifacts, cherryPicked, { speakerDiarizer: diarizer }),
      /changed its audited producer projection/,
    );
    const forgedSupport = structuredClone(fullCitation) as unknown as Record<string, unknown>;
    forgedSupport.use = "claim_support";
    forgedSupport.target = { kind: "claim", claimId: "claim:forged", range: fullCitation.target.kind === "coverage" ? fullCitation.target.range : runtime.scope };
    delete forgedSupport.citationId;
    forgedSupport.citationId = evidenceCitationId(forgedSupport as never);
    assert.throws(() => validateEvidenceCitationEnvelope(forgedSupport), /claim support requires available current-run speech/);
  } finally {
    await rm(runtime.directory, { recursive: true, force: true });
  }
});

test("U6 child bridge accepts only {}, injects the scheduler scope, and authenticates its response", async () => {
  const runtime = await speakerHarness();
  const diarizer = new FixtureSpeakerDiarizer([]);
  const bridge = new BoundedChildSpeakerBridge(
    runtime.childTask,
    new BoundedSpeakerOverlapHost(runtime.ledger, runtime.artifacts, { diarizer }),
    { nextOperationId: () => "operation:speakers:bridge" },
  );
  try {
    await assert.rejects(bridge.call({ path: SOURCE_FIXTURE }), /closed empty object/);
    const opened = await openChildSpeakerBridge(bridge);
    try {
      const result = await callChildSpeakerBridge(opened.endpoint, opened.token, {});
      assert.equal(result.observations.source.artifactId, runtime.source.id);
      assert.equal(result.observations.source.audioTrackId, "stream:1");
      assert.deepEqual(result.observations.source.grantedRange, { startMs: 10_000, endMs: 15_000 });
      assert.equal(result.observations.state, "empty");
      assert.deepEqual(result.observations.accounting.map((cell) => cell.kind), ["no_hypothesis"]);
    } finally {
      await opened.close();
    }
  } finally {
    await rm(runtime.directory, { recursive: true, force: true });
  }
});

test("U6 fails closed for no grant, missing audio/model, oversized normalized bytes, and tampered cold content", async () => {
  const noGrant = await speakerHarness();
  try {
    const task = structuredClone(noGrant.childTask);
    task.grants = task.grants.filter((grant) => grant.capability !== "media.speakers.analyze");
    await assert.rejects(
      new BoundedChildSpeakerBridge(task, new BoundedSpeakerOverlapHost(noGrant.ledger, noGrant.artifacts, { diarizer: new FixtureSpeakerDiarizer() })).call({}),
      /no exact speaker\/overlap grant/,
    );
  } finally { await rm(noGrant.directory, { recursive: true, force: true }); }

  const missingAudio = await speakerHarness();
  try {
    const sourcePath = await missingAudio.artifacts.resolveVerified(missingAudio.source);
    await rm(sourcePath);
    await assert.rejects(
      new BoundedSpeakerOverlapHost(missingAudio.ledger, missingAudio.artifacts, { diarizer: new FixtureSpeakerDiarizer() }).analyze(request(missingAudio, "operation:speakers:source-missing")),
      /source failed content verification/,
    );
    assert.equal(missingAudio.ledger.state().speakerOverlapOperations["operation:speakers:source-missing"].failure, "source_unavailable");
  } finally { await rm(missingAudio.directory, { recursive: true, force: true }); }

  const missingModel = await speakerHarness();
  const unavailable: SpeakerDiarizer = {
    async currentLineage() { throw new SpeakerDiarizerFailure("model_unavailable", "missing pinned model"); },
    async diarize() { throw new SpeakerDiarizerFailure("model_unavailable", "missing pinned model"); },
  };
  try {
    await assert.rejects(
      new BoundedSpeakerOverlapHost(missingModel.ledger, missingModel.artifacts, { diarizer: unavailable }).analyze(request(missingModel, "operation:speakers:model-missing")),
      /missing pinned model/,
    );
    assert.equal(missingModel.ledger.state().speakerOverlapOperations["operation:speakers:model-missing"].failure, "model_unavailable");
  } finally { await rm(missingModel.directory, { recursive: true, force: true }); }

  const oversized = await speakerHarness();
  try {
    const fakeFfmpeg = join(oversized.directory, "oversized-ffmpeg.sh");
    await writeFile(fakeFfmpeg, `#!/bin/sh\nfor target do :; done\ndd if=/dev/zero of="$target" bs=${SPEAKER_OVERLAP_LIMITS.maxNormalizedAudioBytes + 2} count=1 2>/dev/null\n`, { mode: 0o700 });
    await chmod(fakeFfmpeg, 0o700);
    const neverCalled = new FixtureSpeakerDiarizer();
    await assert.rejects(
      new BoundedSpeakerOverlapHost(oversized.ledger, oversized.artifacts, { diarizer: neverCalled, ffmpeg: fakeFfmpeg }).analyze(request(oversized, "operation:speakers:oversized")),
      /exceeds its byte envelope/,
    );
    assert.equal(neverCalled.calls, 0);
    assert.equal(oversized.ledger.state().speakerOverlapOperations["operation:speakers:oversized"].failure, "input_oversized");
  } finally { await rm(oversized.directory, { recursive: true, force: true }); }

  const tampered = await speakerHarness();
  const diarizer = new FixtureSpeakerDiarizer([]);
  try {
    const produced = await new BoundedSpeakerOverlapHost(tampered.ledger, tampered.artifacts, { diarizer }).analyze(request(tampered, "operation:speakers:tamper"));
    const path = await tampered.artifacts.resolveVerified(produced.observationsArtifact);
    await writeFile(path, "{}\n");
    await assert.rejects(auditSpeakerOverlap(tampered.ledger.state(), tampered.artifacts, produced.observations.operationId, { diarizer }), /content|bytes|verification|canonical/i);
  } finally { await rm(tampered.directory, { recursive: true, force: true }); }
});

test("U4 v1 defers speaker-only overlap instead of inventing recognizer disagreement", () => {
  const citation = [{ evidenceKind: "speaker_turn", observations: [{ state: "conflicting", rawState: "speaker:overlap:overlap_hypothesis_requires_speech_restudy" }] }];
  assert.equal(defersSpeakerOverlapRestudy(citation, ["observation:1:conflicting:speaker:overlap:overlap_hypothesis_requires_speech_restudy"]), true);
  assert.equal(defersSpeakerOverlapRestudy(citation, [
    "observation:1:conflicting:speaker:overlap:overlap_hypothesis_requires_speech_restudy",
    "observation:2:conflicting:speech:recognizer_disagreement",
  ]), false);
});
