import assert from "node:assert/strict";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";

import type { DialogueScopePolicy, DialogueScopeReason, DialogueScopeState } from "../src/studio/acoustic/dialogueScopePolicy.ts";
import { validateDialogueScopePolicy } from "../src/studio/acoustic/dialogueScopePolicy.ts";
import { canonicalSha256, ContentAddressedArtifactStore, identifyFile } from "../src/studio/runtime/production/artifactStore.ts";
import { deriveGeneralizedCoverageDecision } from "../src/studio/runtime/production/admission/generalizedCoveragePolicy.ts";
import { GeneralizedEvidenceAdmissionHost } from "../src/studio/runtime/production/admission/generalizedEvidenceAdmissionHost.ts";
import { GeneralizedCaptionCausalityHost } from "../src/studio/runtime/production/captions/generalizedCaptionCausality.ts";
import {
  acousticRangeCitation,
  auditEvidenceCitation,
  currentRunSpeechCitation,
  frameSampleCitation,
  reopenAcousticCitationSource,
} from "../src/studio/runtime/production/evidenceCitations/audit.ts";
import { BoundedFrameSamplingHost } from "../src/studio/runtime/production/frameHost.ts";
import { buildStudyReportEnvelopeV2 } from "../src/studio/runtime/production/executor/workerContract.ts";
import { FfmpegFrameDecoder } from "../src/studio/runtime/production/frames/ffmpegDecoder.ts";
import { MemoryEventJournal, RuntimeLedger } from "../src/studio/runtime/production/journal.ts";
import type {
  CurrentRunRecognizerDescriptor,
  EvidenceCitationEnvelope,
  MediaScope,
  RuntimeArtifact,
  RuntimeLimits,
  SourceArtifactDescriptor,
  StudyReportArtifactV2,
  TaskRecord,
} from "../src/studio/runtime/production/model.ts";
import { STUDY_REPORT_V2_LIMITS } from "../src/studio/runtime/production/model.ts";
import type { PendingRuntimeEvent } from "../src/studio/runtime/production/protocol.ts";
import { loadOwnedSourceSession } from "../src/studio/runtime/production/runStart/sourceSessionLoader.ts";
import { BoundedRuntimeScheduler, type RuntimeIdentityFactory } from "../src/studio/runtime/production/scheduler.ts";
import type {
  CurrentRunRecognizerInput,
  CurrentRunRecognizerResult,
  CurrentRunSpeechRecognizer,
} from "../src/studio/runtime/production/semantic/currentRunSpeechRecognizer.ts";
import { reopenSemanticEvidence, semanticEvidenceCitation } from "../src/studio/runtime/production/semantic/semanticEvidenceAudit.ts";
import { SpeechTranscribeCapabilityHost } from "../src/studio/runtime/production/semantic/semanticEvidenceHost.ts";
import { GeneralizedStudyReadinessHost } from "../src/studio/runtime/production/study/generalizedStudyReadinessHost.ts";
import { GeneralizedStudySynthesisHost } from "../src/studio/runtime/production/study/generalizedStudySynthesisHost.ts";
import { evidenceCitationId, validateEvidenceCitationEnvelope } from "../src/studio/runtime/production/validation/evidenceCitations.ts";
import { runtimeTestJobContext } from "./runtime-test-job-context.ts";

const run = promisify(execFile);
const AUDIO_FIXTURE = resolve("public/demo/runs/run-005");
const VIDEO_FIXTURE = resolve("public/demo/runs/run-006/clip.mp4");
const DETECTOR = resolve("scripts/detect-acoustics.mjs");
const SEALER = resolve("scripts/seal-acoustic-preflight.mjs");

class Identities implements RuntimeIdentityFactory {
  private value = 0;
  next(kind: "request" | "task" | "agent" | "grant"): string { this.value += 1; return `${kind}:u3-${this.value}`; }
  secret(): string { this.value += 1; return `secret:u3-${this.value}`; }
}

function recognizerDescriptor(): CurrentRunRecognizerDescriptor {
  const configuration = { id: "studio.u3-test-recognizer.v1", language: "ko", timestampMode: "segment" as const, segmentation: "producer_defined" as const };
  return { id: "studio.u3-test-recognizer", version: "1", model: "deterministic-u3-test", runtime: { id: "node.test", version: process.version }, configuration: { ...configuration, contentId: `sha256:${canonicalSha256(configuration)}` }, executionScope: "current_run", fixtureContentId: null };
}

class Recognizer implements CurrentRunSpeechRecognizer {
  async describe(): Promise<CurrentRunRecognizerDescriptor> { return recognizerDescriptor(); }
  async recognize(input: CurrentRunRecognizerInput): Promise<CurrentRunRecognizerResult> {
    return { availability: "available", reason: "current_run_hypotheses_returned", segments: [{ startMs: input.range.startMs, endMs: input.range.endMs, state: "available", text: "Current-run speech hypothesis." }] };
  }
}

const AUDIO_LIMITS: RuntimeLimits = {
  maxDepth: 1,
  maxActiveWorkers: 3,
  runBudget: { wallMs: 90_000, toolCalls: 12 },
  grantableCapabilities: ["task.spawn.request", "report.submit", "speech.transcribe"],
};

interface AudioHarness {
  directory: string;
  ledger: RuntimeLedger;
  artifacts: ContentAddressedArtifactStore;
  source: RuntimeArtifact;
  root: TaskRecord;
  child: TaskRecord;
  scope: MediaScope;
  childExecutionId: string;
}

async function startExecution(ledger: RuntimeLedger, task: TaskRecord, executionId: string): Promise<void> {
  const launch = ledger.state().taskLaunches[task.id];
  assert.ok(launch);
  await ledger.transact(
    { producer: { kind: "launcher", id: "u3-test-executor" }, causationId: task.id },
    () => ({ pending: [{ type: "executor.started", data: { executionId, taskId: task.id, agentId: task.assignedAgentId, launchClaimId: launch.id, startedAt: "2026-07-17T14:00:00.000Z" } }] satisfies PendingRuntimeEvent[], result: undefined }),
  );
}

async function audioHarness(): Promise<AudioHarness> {
  const directory = await mkdtemp(join(tmpdir(), "studio-u3-audio-"));
  const artifacts = new ContentAddressedArtifactStore(join(directory, "artifacts"));
  const ledger = await RuntimeLedger.open("runtime:u3-audio", new MemoryEventJournal(), { now: () => new Date("2026-07-17T14:00:00.000Z") });
  const loaded = await loadOwnedSourceSession(AUDIO_FIXTURE);
  const source = await artifacts.registerSource(ledger.runId, loaded.descriptor);
  await artifacts.record(ledger, source);
  const evidence = await Promise.all(loaded.evidenceDescriptors.map((descriptor) => artifacts.registerPreflightEvidence(ledger.runId, source.id, descriptor)));
  for (const artifact of evidence) await artifacts.record(ledger, artifact);
  const scheduler = new BoundedRuntimeScheduler(ledger, AUDIO_LIMITS, new Identities());
  const scope = { artifactId: source.id, trackId: "stream:0", startMs: 0, endMs: 1_000 };
  const rootPermit = await scheduler.createRoot({ workloadKey: "root:u3", objective: "Synthesize only audited generalized evidence.", workerKind: "orchestrator", workerLabel: "u3-root", mediaScope: [scope], inputArtifactIds: [source.id, ...evidence.map((entry) => entry.id)], requiredOutputs: [{ name: "study v2", artifactKind: "studio.owned-media-study.v2", required: true }], requiredCapabilities: ["task.spawn.request"], dependencies: [], budget: { wallMs: 40_000, toolCalls: 4 } }, runtimeTestJobContext({ source, evidence, range: { startMs: 0, endMs: 1_000 } }));
  await scheduler.claimTaskLaunch(rootPermit, "deterministic_test", "2026-07-17T14:00:00.000Z"); await scheduler.registerAgent(rootPermit); await scheduler.transitionTask(rootPermit.taskId, rootPermit.agentId, "working");
  const root = ledger.state().tasks[rootPermit.taskId]; await startExecution(ledger, root, "execution:u3-root");
  const decision = await scheduler.requestSpawn(root.id, root.assignedAgentId, { workloadKey: "u3:child", objective: "Return v2 coverage with exact citations.", workerKind: "analysis", workerLabel: "u3-worker", mediaScope: [scope], inputArtifactIds: [source.id, ...evidence.map((entry) => entry.id)], requiredOutputs: [{ name: "study report v2", artifactKind: "studio.study-report.v2", required: true }], requiredCapabilities: ["speech.transcribe", "report.submit"], dependencies: [], budget: { wallMs: 20_000, toolCalls: 2 } });
  assert.ok(decision.permit); await scheduler.claimTaskLaunch(decision.permit, "deterministic_test", "2026-07-17T14:00:00.000Z"); await scheduler.registerAgent(decision.permit); await scheduler.transitionTask(decision.permit.taskId, decision.permit.agentId, "working");
  const child = ledger.state().tasks[decision.permit.taskId]; const childExecutionId = "execution:u3-child"; await startExecution(ledger, child, childExecutionId);
  return { directory, ledger, artifacts, source, root, child, scope, childExecutionId };
}

function sources(source: RuntimeArtifact, citations: EvidenceCitationEnvelope[]) {
  const found = new Map([[source.id, source.content.contentId]]);
  for (const citation of citations) { found.set(citation.evidence.artifactId, citation.evidence.contentId); if (citation.receipt.artifactId) found.set(citation.receipt.artifactId, citation.receipt.contentId); }
  return [...found.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([artifactId, contentId]) => ({ artifactId, contentId }));
}

function reportBase(runtime: AudioHarness, citations: EvidenceCitationEnvelope[]): Omit<StudyReportArtifactV2, "coverage" | "claims"> {
  return {
    schema: "studio.study-report.v2", runId: runtime.ledger.runId,
    task: { taskId: runtime.child.id, agentId: runtime.child.assignedAgentId, executionId: runtime.childExecutionId, jobContextId: runtime.child.jobContext.contextId },
    parent: { taskId: runtime.root.id, agentId: runtime.root.assignedAgentId },
    assignment: { source: { artifactId: runtime.source.id, contentId: runtime.source.content.contentId }, mediaScope: [runtime.scope] },
    evidenceCitations: citations, sourceArtifacts: sources(runtime.source, citations), limits: STUDY_REPORT_V2_LIMITS,
    nonClaims: { correctness: "not_assessed", completeness: "partition_only", semanticQuality: "not_assessed", modalityReliabilityEquivalence: "not_claimed", independentCorroboration: "not_assessed" },
  };
}

function oneCellDialoguePolicy(
  range: MediaScope,
  state: DialogueScopeState,
  reason: DialogueScopeReason,
  sourceContentId = `sha256:${"a".repeat(64)}`,
): DialogueScopePolicy {
  const samples = (range.endMs - range.startMs) * 16;
  return validateDialogueScopePolicy({
    schema: "studio.dialogue-scope-policy.v1",
    input: {
      sourceArtifactId: range.artifactId,
      sourceContentId,
      trackId: range.trackId,
      includeLyrics: false,
      requestedRange: {
        startMs: range.startMs,
        endMs: range.endMs,
        startSample: range.startMs * 16,
        endSample: range.endMs * 16,
      },
      speechEvidence: null,
      acousticEvidence: null,
    },
    producer: {
      id: "studio.deterministic-dialogue-scope-policy",
      version: "1",
      policy: "strong_vad_acoustic_agreement_only",
    },
    ranges: [{
      index: 0,
      startSample: range.startMs * 16,
      endSample: range.endMs * 16,
      startMs: range.startMs,
      endMs: range.endMs,
      state,
      reason,
      vad: "missing",
      acoustic: "missing",
    }],
    accounting: {
      requestedSamples: samples,
      requestedDialogueScopeCandidateSamples: state === "requested_dialogue_scope_candidate" ? samples : 0,
      notInRequestedDialogueScopeSamples: state === "not_in_requested_dialogue_scope" ? samples : 0,
      unknownSamples: state === "unknown" ? samples : 0,
      unavailableSamples: state === "unavailable" ? samples : 0,
      withheldSamples: state === "withheld" ? samples : 0,
      semanticCoverageDenominatorSamples: state === "not_in_requested_dialogue_scope" ? 0 : samples,
    },
    nonClaims: {
      semanticUnderstanding: "not_assessed",
      absenceOfSpeech: "not_proven",
      acousticAccuracy: "not_established",
    },
  });
}

test("v2 speech report closes admission/read/synthesis/readiness/caption causality without source-list theater", async () => {
  const runtime = await audioHarness();
  try {
    const semantic = await new SpeechTranscribeCapabilityHost(runtime.ledger, runtime.artifacts, { recognizer: new Recognizer() }).transcribe({ operationId: "operation:u3-speech", taskId: runtime.child.id, agentId: runtime.child.assignedAgentId, ...runtime.scope });
    const verified = await reopenSemanticEvidence(runtime.ledger.state(), runtime.artifacts, semantic.envelope.operationId);
    const claimId = "claim:u3:spoken";
    const citation = currentRunSpeechCitation({ verified, target: { kind: "claim", claimId, range: runtime.scope }, observationIds: verified.envelope.observations.map((entry) => entry.observationId) });
    const unavailableCitation = structuredClone(citation);
    unavailableCitation.observations[0].state = "unavailable";
    unavailableCitation.observations[0].rawState = "unavailable";
    const unavailableWithWorkerAbstention = deriveGeneralizedCoverageDecision({
      claimCount: 0,
      citations: [unavailableCitation],
      dialogueScopePolicy: null,
      range: runtime.scope,
      declaredReasonCode: "worker_withheld",
    });
    assert.equal(unavailableWithWorkerAbstention.state, "unavailable");
    assert.equal(unavailableWithWorkerAbstention.reasonCode, "evidence_unavailable");
    assert.equal(unavailableWithWorkerAbstention.rawStates.includes("worker_withheld"), false);
    assert.deepEqual(
      deriveGeneralizedCoverageDecision({
        claimCount: 0,
        citations: [unavailableCitation],
        dialogueScopePolicy: null,
        range: runtime.scope,
        declaredReasonCode: unavailableWithWorkerAbstention.reasonCode,
      }),
      unavailableWithWorkerAbstention,
    );
    const report: StudyReportArtifactV2 = { ...reportBase(runtime, [citation]), coverage: [{ ...runtime.scope, state: "supported", claimIds: [claimId], citationIds: [], rawStates: [], reason: null }], claims: [{ claimId, ...runtime.scope, statement: "The current-run recognizer emitted a timed speech hypothesis.", citationIds: [citation.citationId] }] };
    const admissionHost = new GeneralizedEvidenceAdmissionHost(runtime.ledger.state(), runtime.artifacts);
    const admitted = await admissionHost.admit(report);
    const read = await admissionHost.read(admitted, "operation:u3-parent-read");
    assert.equal(read.report.schema, "studio.study-report.v2");
    assert.deepEqual(read.report.claims[0].citationIds, [citation.citationId]);
    const reopenedRead = await admissionHost.reopenRead(read.receiptContentId);
    assert.equal(reopenedRead.receipt.receiptId, read.receipt.receiptId);
    const forgedAdmission = structuredClone(admitted);
    forgedAdmission.report.artifactId = "artifact:forged-report-identity";
    await assert.rejects(admissionHost.reopen(forgedAdmission), /changed report, citation, coverage, or receipt identity/);
    const synthesisHost = new GeneralizedStudySynthesisHost(runtime.ledger.state(), runtime.artifacts);
    const inspected = await synthesisHost.inspect([admitted]);
    const study = await synthesisHost.synthesize([admitted], { coverage: inspected.coverage, claims: inspected.claims });
    assert.equal(study.envelope.schema, "studio.owned-media-study.v2");
    assert.deepEqual(study.envelope.coverage[0].preservedStates, ["supported"]);
    assert.equal(study.envelope.evidenceCitations.some((entry) => entry.evidenceKind === "frame_sample"), false);
    const readinessHost = new GeneralizedStudyReadinessHost(runtime.ledger.state(), runtime.artifacts);
    const readiness = await readinessHost.audit(study);
    assert.equal(readiness.receipt.result.outcome, "proceed_to_caption_review");
    assert.deepEqual(readiness.receipt.nonClaims, { semanticCorrectness: "not_assessed", translationQuality: "not_assessed", truthArbitration: "not_performed" });
    const caption = await new GeneralizedCaptionCausalityHost(runtime.ledger.state(), runtime.artifacts).close({ readiness, range: runtime.scope, sourceText: "가설", targetText: "Hypothesis", });
    assert.equal(caption.source.state, "available");
    assert.deepEqual(caption.lineage.citationIds, study.envelope.claims[0].citationIds);
    assert.ok(caption.lineage.citationIds.every((id) => study.envelope.evidenceCitations.find((entry) => entry.citationId === id)?.evidenceKind === "current_run_speech"));

    const sourceTheater = structuredClone(report);
    sourceTheater.sourceArtifacts.push({ artifactId: "artifact:generic-source", contentId: `sha256:${"f".repeat(64)}` });
    await assert.rejects(admissionHost.admit(sourceTheater), /exact lineage only|generic support sources/);
  } finally { await rm(runtime.directory, { recursive: true, force: true }); }
});

test("worker abstention dominated by unavailable speech remains cold-admissible", async () => {
  const runtime = await audioHarness();
  try {
    const recognizer: CurrentRunSpeechRecognizer = {
      async describe() { return recognizerDescriptor(); },
      async recognize() { return { availability: "unavailable", reason: "recognizer_unavailable", segments: [] }; },
    };
    const semantic = await new SpeechTranscribeCapabilityHost(runtime.ledger, runtime.artifacts, { recognizer }).transcribe({
      operationId: "operation:u3-unavailable-speech",
      taskId: runtime.child.id,
      agentId: runtime.child.assignedAgentId,
      ...runtime.scope,
    });
    const verified = await reopenSemanticEvidence(runtime.ledger.state(), runtime.artifacts, semantic.envelope.operationId);
    const semanticInput = semanticEvidenceCitation(verified);
    const report = buildStudyReportEnvelopeV2({
      task: runtime.child,
      executionId: runtime.childExecutionId,
      output: {
        name: "study report v2",
        kind: "studio.study-report.v2",
        coverage: [{ ...runtime.scope, claimIds: [], reason: { code: "worker_withheld", detail: "The worker made no semantic claim." } }],
        claims: [],
      },
      semanticEvidenceInputs: [semanticInput],
      verifiedSemanticEvidence: [verified],
      ocrEvidenceInputs: [],
      verifiedOcrEvidence: [],
      dialogueScopePolicy: null,
    });
    assert.equal(report.coverage[0].state, "unavailable");
    assert.equal(report.coverage[0].reason?.code, "evidence_unavailable");
    assert.equal(report.coverage[0].rawStates.includes("worker_withheld"), false);
    const admitted = await new GeneralizedEvidenceAdmissionHost(runtime.ledger.state(), runtime.artifacts).admit(report);
    assert.equal(admitted.reportEnvelope.coverage[0].state, "unavailable");
  } finally {
    await rm(runtime.directory, { recursive: true, force: true });
  }
});

test("unknown, withheld, and failed survive admission through caption causality without prose upgrade", async () => {
  const runtime = await audioHarness();
  try {
    const cases = [
      { state: "unknown" as const, raw: "unobserved_range", reason: "evidence_unknown" as const },
      { state: "withheld" as const, raw: "worker_withheld", reason: "worker_withheld" as const },
      { state: "failed" as const, raw: "operation_failed", reason: "operation_failed" as const },
    ];
    for (const entry of cases) {
      const report: StudyReportArtifactV2 = {
        ...reportBase(runtime, []),
        coverage: [{
          ...runtime.scope,
          state: entry.state,
          claimIds: [],
          citationIds: [],
          rawStates: [entry.raw],
          reason: { code: entry.reason, detail: "No text may upgrade this deterministic abstention state." },
        }],
        claims: [],
      };
      const admitted = await new GeneralizedEvidenceAdmissionHost(runtime.ledger.state(), runtime.artifacts).admit(report);
      const synthesisHost = new GeneralizedStudySynthesisHost(runtime.ledger.state(), runtime.artifacts);
      const inspected = await synthesisHost.inspect([admitted]);
      const study = await synthesisHost.synthesize([admitted], { coverage: inspected.coverage, claims: inspected.claims });
      assert.equal(study.envelope.coverage[0].state, entry.state);
      assert.deepEqual(study.envelope.coverage[0].preservedStates, [entry.state]);
      const readiness = await new GeneralizedStudyReadinessHost(runtime.ledger.state(), runtime.artifacts).audit(study);
      assert.equal(readiness.receipt.result.outcome, "withheld");
      assert.ok(readiness.receipt.result.states.includes(entry.state));
      const caption = await new GeneralizedCaptionCausalityHost(runtime.ledger.state(), runtime.artifacts).close({ readiness, range: runtime.scope, sourceText: "invented", targetText: "invented" });
      assert.equal(caption.source.text, null);
      assert.equal(caption.target.text, null);
      assert.ok(caption.lineage.preservedStates.includes(entry.state));
    }
  } finally { await rm(runtime.directory, { recursive: true, force: true }); }
});

test("dialogue-scope weak, conflict, truncation, and exclusion states deterministically dominate claims", () => {
  const range = { artifactId: "artifact:media", trackId: "stream:0", startMs: 0, endMs: 1_000 };
  const cases: Array<{
    policyState: DialogueScopeState;
    policyReason: DialogueScopeReason;
    expected: "unavailable" | "truncated" | "conflicting" | "not_in_scope";
    reasonCode: "evidence_unavailable" | "evidence_truncated" | "evidence_conflicting" | "not_in_requested_scope";
  }> = [
    { policyState: "unavailable", policyReason: "missing_or_failed_evidence", expected: "unavailable", reasonCode: "evidence_unavailable" },
    { policyState: "withheld", policyReason: "truncated_evidence", expected: "truncated", reasonCode: "evidence_truncated" },
    { policyState: "unknown", policyReason: "vad_acoustic_disagreement", expected: "conflicting", reasonCode: "evidence_conflicting" },
    { policyState: "not_in_requested_dialogue_scope", policyReason: "vad_non_speech_acoustic_noise", expected: "not_in_scope", reasonCode: "not_in_requested_scope" },
  ];
  for (const entry of cases) {
    const decision = deriveGeneralizedCoverageDecision({
      claimCount: 1,
      citations: [],
      dialogueScopePolicy: oneCellDialoguePolicy(range, entry.policyState, entry.policyReason),
      range,
      declaredReasonCode: entry.reasonCode,
    });
    assert.equal(decision.state, entry.expected);
    assert.equal(decision.reasonCode, entry.reasonCode);
    assert.deepEqual(decision.rawStates, [`dialogue-scope:0:${entry.expected}:${entry.policyReason}`]);
  }
});

test("receipt-derived unavailable, truncated, conflicting, and not-in-scope survive the full causal chain", async () => {
  const runtime = await audioHarness();
  try {
    const cases = [
      { policyState: "unavailable" as const, policyReason: "missing_or_failed_evidence" as const, state: "unavailable" as const, reasonCode: "evidence_unavailable" as const },
      { policyState: "withheld" as const, policyReason: "truncated_evidence" as const, state: "truncated" as const, reasonCode: "evidence_truncated" as const },
      { policyState: "unknown" as const, policyReason: "vad_acoustic_disagreement" as const, state: "conflicting" as const, reasonCode: "evidence_conflicting" as const },
      { policyState: "not_in_requested_dialogue_scope" as const, policyReason: "vad_non_speech_acoustic_noise" as const, state: "not_in_scope" as const, reasonCode: "not_in_requested_scope" as const },
    ];
    for (const entry of cases) {
      const policy = oneCellDialoguePolicy(
        runtime.scope,
        entry.policyState,
        entry.policyReason,
        runtime.source.content.contentId,
      );
      const options = { dialogueScopePolicyResolver: async () => policy };
      const rawState = `dialogue-scope:0:${entry.state}:${entry.policyReason}`;
      const report: StudyReportArtifactV2 = {
        ...reportBase(runtime, []),
        coverage: [{
          ...runtime.scope,
          state: entry.state,
          claimIds: [],
          citationIds: [],
          rawStates: [rawState],
          reason: { code: entry.reasonCode, detail: "Preserved from the host-owned dialogue-scope policy." },
        }],
        claims: [],
      };
      const admitted = await new GeneralizedEvidenceAdmissionHost(runtime.ledger.state(), runtime.artifacts, options).admit(report);
      const synthesisHost = new GeneralizedStudySynthesisHost(runtime.ledger.state(), runtime.artifacts, options);
      const inspected = await synthesisHost.inspect([admitted]);
      const study = await synthesisHost.synthesize([admitted], { coverage: inspected.coverage, claims: inspected.claims });
      assert.equal(study.envelope.coverage[0].state, entry.state);
      assert.deepEqual(study.envelope.coverage[0].preservedStates, [entry.state]);
      const readiness = await new GeneralizedStudyReadinessHost(runtime.ledger.state(), runtime.artifacts, options).audit(study);
      assert.ok(readiness.receipt.result.states.includes(entry.state));
      assert.equal(readiness.receipt.result.outcome, entry.state === "not_in_scope" ? "proceed_to_caption_review" : "withheld");
      const caption = await new GeneralizedCaptionCausalityHost(runtime.ledger.state(), runtime.artifacts, options).close({
        readiness,
        range: runtime.scope,
        sourceText: "must not survive",
        targetText: "must not survive",
      });
      assert.equal(caption.source.text, null);
      assert.equal(caption.target.text, null);
      assert.deepEqual(caption.lineage.preservedStates, [entry.state]);
    }
  } finally { await rm(runtime.directory, { recursive: true, force: true }); }
});

test("U1 acoustic adapter derives durable cell ids and cold-rejects citation tamper", async () => {
  const directory = await mkdtemp(join(tmpdir(), "studio-u3-acoustic-"));
  try {
    await cp(AUDIO_FIXTURE, directory, { recursive: true });
    await run(process.execPath, [DETECTOR, "--directory", directory, "--start-ms", "0", "--end-ms", "1920"], { timeout: 20_000 });
    await run(process.execPath, [SEALER, "--run", "run-005", "--directory", directory], { timeout: 20_000 });
    const loaded = await loadOwnedSourceSession(directory); const artifacts = new ContentAddressedArtifactStore(join(directory, ".u3-artifacts"));
    const ledger = await RuntimeLedger.open("runtime:u3-acoustic", new MemoryEventJournal());
    const source = await artifacts.registerSource(ledger.runId, loaded.descriptor); await artifacts.record(ledger, source);
    const registered = await Promise.all(loaded.evidenceDescriptors.map((descriptor) => artifacts.registerPreflightEvidence(ledger.runId, source.id, descriptor))); for (const artifact of registered) await artifacts.record(ledger, artifact);
    const acoustic = registered.find((artifact) => artifact.origin.kind === "preflight_evidence" && artifact.origin.evidenceKind === "acoustic_ranges"); assert.ok(acoustic);
    const verified = await reopenAcousticCitationSource(ledger.state(), artifacts, acoustic.id);
    const target = { kind: "coverage" as const, range: { artifactId: source.id, trackId: verified.source.trackId, startMs: 0, endMs: 1_920 } };
    const citation = acousticRangeCitation({ verified, target, observationIndexes: verified.observations.observations.map((entry) => entry.index) });
    const reopened = await auditEvidenceCitation(ledger.state(), artifacts, citation);
    assert.equal(reopened.evidenceKind, "acoustic_range");
    assert.ok(reopened.observations.every((entry) => entry.observationId.startsWith("acoustic-observation:")));
    assert.equal(reopened.use, "coverage_qualification");
    const tampered = structuredClone(citation); tampered.observations[0].rawState = "speech:strong:invented";
    const { schema: _schema, citationId: _citationId, ...body } = tampered; tampered.citationId = evidenceCitationId(body);
    await assert.rejects(auditEvidenceCitation(ledger.state(), artifacts, tampered), /changed its audited producer projection/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

async function videoSourceDescriptor(): Promise<SourceArtifactDescriptor> {
  return { schema: "studio.source-artifact.v1", adapterId: "owned-local-source-adapter.v1", sourceReceiptRef: "fixture:run-006:u3", publication: "private", path: VIDEO_FIXTURE, content: await identifyFile(VIDEO_FIXTURE), durationMs: 40_040, tracks: [{ id: "stream:0", index: 0, kind: "video", codec: "h264", durationMs: 40_040 }, { id: "stream:1", index: 1, kind: "audio", codec: "aac", durationMs: 40_000 }] };
}

test("U2 frame adapter is cold-audited cite-only identity and cannot become claim support", async () => {
  const directory = await mkdtemp(join(tmpdir(), "studio-u3-frame-"));
  try {
    const artifacts = new ContentAddressedArtifactStore(join(directory, "artifacts")); const ledger = await RuntimeLedger.open("runtime:u3-frame", new MemoryEventJournal());
    const source = await artifacts.registerSource(ledger.runId, await videoSourceDescriptor()); await artifacts.record(ledger, source);
    const scheduler = new BoundedRuntimeScheduler(ledger, { maxDepth: 1, maxActiveWorkers: 2, runBudget: { wallMs: 60_000, toolCalls: 6 }, grantableCapabilities: ["task.spawn.request", "report.submit", "media.frames.sample"] }, new Identities());
    const scope = { artifactId: source.id, trackId: "stream:0", startMs: 10_000, endMs: 11_000 };
    const rootPermit = await scheduler.createRoot({ workloadKey: "root:u3-frame", objective: "Sample a bounded frame.", workerKind: "orchestrator", workerLabel: "frame-root", mediaScope: [scope], inputArtifactIds: [source.id], requiredOutputs: [{ name: "root", artifactKind: "root", required: true }], requiredCapabilities: ["task.spawn.request"], dependencies: [], budget: { wallMs: 30_000, toolCalls: 3 } }, runtimeTestJobContext({ source, range: { startMs: scope.startMs, endMs: scope.endMs } }));
    await scheduler.claimTaskLaunch(rootPermit, "deterministic_test", "2026-07-17T14:00:00.000Z"); await scheduler.registerAgent(rootPermit); await scheduler.transitionTask(rootPermit.taskId, rootPermit.agentId, "working");
    const decision = await scheduler.requestSpawn(rootPermit.taskId, rootPermit.agentId, { workloadKey: "u3-frame", objective: "Sample one frame; make no visual claim.", workerKind: "media", workerLabel: "frame-child", mediaScope: [scope], inputArtifactIds: [source.id], requiredOutputs: [{ name: "note", artifactKind: "note", required: true }], requiredCapabilities: ["media.frames.sample", "report.submit"], dependencies: [], budget: { wallMs: 20_000, toolCalls: 1 } }); assert.ok(decision.permit);
    await scheduler.claimTaskLaunch(decision.permit, "deterministic_test", "2026-07-17T14:00:00.000Z"); await scheduler.registerAgent(decision.permit); await scheduler.transitionTask(decision.permit.taskId, decision.permit.agentId, "working"); const child = ledger.state().tasks[decision.permit.taskId]; await startExecution(ledger, child, "execution:u3-frame-child");
    const grant = child.grants.find((entry) => entry.capability === "media.frames.sample"); assert.ok(grant);
    const verified = await new BoundedFrameSamplingHost(ledger, artifacts).sample({ operationId: "operation:u3-frame", taskId: child.id, agentId: child.assignedAgentId, grantId: grant.id, requestedTimestampsMs: [10_123] });
    const citation = frameSampleCitation({ verified, frameIndex: 0, target: { kind: "media_context", qualifiesMedia: scope } });
    const reopened = await auditEvidenceCitation(ledger.state(), artifacts, citation, { frameDecoder: new FfmpegFrameDecoder() });
    assert.equal(reopened.use, "cite_only"); assert.equal(reopened.observations[0].locator.kind, "media_point");
    const upgraded: any = structuredClone(citation); upgraded.use = "claim_support"; upgraded.target = { kind: "claim", claimId: "claim:fake-visual", range: scope };
    const { schema: _schema, citationId: _citationId, ...body } = upgraded; upgraded.citationId = evidenceCitationId(body);
    assert.throws(() => validateEvidenceCitationEnvelope(upgraded), /claim support requires available current-run speech|frame samples.*cite-only/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("document span citations without a reopenable research receipt fail closed", async () => {
  const body: Omit<EvidenceCitationEnvelope, "schema" | "citationId"> = {
    evidenceKind: "external_document_span", use: "cite_only", target: { kind: "media_context", qualifiesMedia: { artifactId: "artifact:media", trackId: "stream:0", startMs: 0, endMs: 1_000 } }, operationId: "operation:document:1",
    evidence: { artifactId: "artifact:document", contentId: `sha256:${"1".repeat(64)}` }, receipt: { receiptId: "receipt:document", contentId: `sha256:${"2".repeat(64)}`, artifactId: "artifact:document-receipt" }, source: { artifactId: "artifact:media", contentId: `sha256:${"3".repeat(64)}`, trackId: "stream:0" }, upstreamState: "available", upstreamReason: "future_document_receipt",
    observations: [{ observationId: "document-observation:1", state: "available", rawState: "span_available", locator: { kind: "document_span", document: { entityId: "document:1", artifactId: "artifact:document", start: 10, end: 20, unit: "unicode_code_point" }, qualifiesMedia: { artifactId: "artifact:media", trackId: "stream:0", startMs: 0, endMs: 1_000 } } }],
    nonClaims: { semanticCorrectness: "not_assessed", truthArbitration: "not_performed" },
  };
  const unbacked: any = { schema: "studio.evidence-citation.v1", citationId: evidenceCitationId(body), ...body };
  const citation = validateEvidenceCitationEnvelope(unbacked);
  const withoutReceipt: any = structuredClone(unbacked); withoutReceipt.operationId = null; withoutReceipt.receipt.artifactId = null;
  const { schema: _schema, citationId: _citationId, ...withoutReceiptBody } = withoutReceipt; withoutReceipt.citationId = evidenceCitationId(withoutReceiptBody);
  assert.throws(() => validateEvidenceCitationEnvelope(withoutReceipt), /cite-only over explicit receipted document spans/);
  const ledger = await RuntimeLedger.open("runtime:u3-future", new MemoryEventJournal()); const directory = await mkdtemp(join(tmpdir(), "studio-u3-future-"));
  try { await assert.rejects(auditEvidenceCitation(ledger.state(), new ContentAddressedArtifactStore(directory), citation), /ENOENT|Research snapshot receipt|bounded JSON contract/); }
  finally { await rm(directory, { recursive: true, force: true }); }
});
