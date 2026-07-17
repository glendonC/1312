import assert from "node:assert/strict";
import { appendFile, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import { ContentAddressedArtifactStore } from "../src/studio/runtime/production/artifactStore.ts";
import { reopenPublishReviewIntakes } from "../src/studio/runtime/production/review/publishReviewIntakeAudit.ts";
import { projectRuntimeEvents } from "../src/studio/runtime/production/projection.ts";
import { buildRuntimeObservabilityIndex } from "../src/studio/runtime/production/observability/indexer.ts";
import { reopenStudyPlanningDecision } from "../src/studio/runtime/production/study/studyPlanningAudit.ts";
import { reopenStudyReadiness } from "../src/studio/runtime/production/study/studyReadinessAudit.ts";
import { reopenOwnedMediaStudy } from "../src/studio/runtime/production/study/studySynthesisAudit.ts";
import { RestudiedCaptionCausalityHost } from "../src/studio/runtime/production/captions/restudiedCaptionCausality.ts";
import { RestudiedStudyReadinessHost } from "../src/studio/runtime/production/study/restudiedStudyReadinessHost.ts";
import { restudiedReadinessReference } from "../src/studio/runtime/production/study/restudiedStudyRuntime.ts";
import { validateRangePassRequestReceipt, validateStudyRestudyRequest } from "../src/studio/runtime/production/validation/studiesV3.ts";
import { projectProductionRuntimeJournal } from "../src/studio/runtime/production/studioProjection.ts";
import type { SpeakerDiarizer, SpeakerDiarizerResult } from "../src/studio/runtime/production/speaker/diarizer.ts";
import { SherpaOnnxSpeakerDiarizer } from "../src/studio/runtime/production/speaker/sherpaOnnxDiarizer.ts";
import {
  DeterministicRuntimeExecutor,
  DurableRuntimeCommandStore,
  RuntimeSourceRegistry,
  RuntimeStartService,
  deterministicOrchestratorLauncherFactory,
  readValidatedRuntimeJournal,
} from "../src/studio/runtime/production/runtimeHost/index.ts";
import type { DeterministicOrchestratorMode } from "../src/studio/runtime/production/runtimeHost/deterministicOrchestrator.ts";

const FIXTURE = resolve("public/demo/runs/run-005");

interface RunHarness {
  directory: string;
  store: DurableRuntimeCommandStore;
  service: RuntimeStartService;
  runtimeId: string;
  lifecycle: "terminal" | "failed" | "interrupted" | "running" | "accepted" | "initializing";
}

let runtimeCount = 0;

class DeterministicOverlapDiarizer implements SpeakerDiarizer {
  private lineage: Promise<SpeakerDiarizerResult["lineage"]> | null = null;

  currentLineage(deadlineAtMs: number): Promise<SpeakerDiarizerResult["lineage"]> {
    this.lineage ??= new SherpaOnnxSpeakerDiarizer().currentLineage(deadlineAtMs);
    return this.lineage.then((lineage) => structuredClone(lineage));
  }

  async diarize(_input: Parameters<SpeakerDiarizer["diarize"]>[0], deadlineAtMs: number): Promise<SpeakerDiarizerResult> {
    return {
      lineage: await this.currentLineage(deadlineAtMs),
      segments: [
        { startMs: 0, endMs: 500, speakerCluster: 1 },
        { startMs: 150, endMs: 350, speakerCluster: 2 },
      ],
    };
  }
}

async function run(mode: DeterministicOrchestratorMode = "spawn_one"): Promise<RunHarness> {
  runtimeCount += 1;
  const directory = await mkdtemp(join(tmpdir(), "studio-owned-media-study-"));
  const store = await DurableRuntimeCommandStore.open(join(directory, "host"));
  const sources = await RuntimeSourceRegistry.open({ sourceDirectories: [FIXTURE] });
  const source = sources.list()[0];
  const runtimeId = `runtime:00000000-0000-4000-8000-${runtimeCount.toString().padStart(12, "0")}`;
  const service = await RuntimeStartService.open({
    store,
    sources,
    launcherFactory: new DeterministicRuntimeExecutor().factory(),
    orchestratorLauncherFactory: deterministicOrchestratorLauncherFactory({ mode }),
    studyContractVersion: "v1",
    runtimeIdForCommand: () => runtimeId,
    recoverOnOpen: false,
  });
  const acknowledgement = await service.start({
    sourceSessionId: source.sourceSessionId,
    sourceRevisionId: source.sourceRevisionId,
    range: { startMs: 0, endMs: 1_000 },
    requestedSourceLanguage: { mode: "declared", languages: ["ko"], reason: null },
    targetLanguage: "en",
    selectedLanguagePackId: "ko-v3",
    outputDepth: "evidence",
  });
  const deadline = Date.now() + 10_000;
  let status = await service.statusByRuntime(acknowledgement.runtimeId);
  while (!new Set(["terminal", "failed", "interrupted"]).has(status.lifecycle) && Date.now() < deadline) {
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 10));
    status = await service.statusByRuntime(acknowledgement.runtimeId);
  }
  if (!new Set(["terminal", "failed", "interrupted"]).has(status.lifecycle)) assert.fail(`runtime ${mode} did not terminate`);
  return { directory, store, service, runtimeId: acknowledgement.runtimeId, lifecycle: status.lifecycle };
}

async function runDefaultU4(mode: DeterministicOrchestratorMode = "spawn_one"): Promise<RunHarness> {
  runtimeCount += 1;
  const directory = await mkdtemp(join(tmpdir(), "studio-owned-media-study-u3-default-"));
  const store = await DurableRuntimeCommandStore.open(join(directory, "host"));
  const sources = await RuntimeSourceRegistry.open({ sourceDirectories: [FIXTURE] });
  const source = sources.list()[0];
  const runtimeId = `runtime:10000000-0000-4000-8000-${runtimeCount.toString().padStart(12, "0")}`;
  const service = await RuntimeStartService.open({
    store,
    sources,
    launcherFactory: new DeterministicRuntimeExecutor({
      restudyPassResult: mode === "restudy_exhausted" ? "withheld" : "supported",
      ...(mode === "restudy_speaker_overlap" ? { speakerDiarizer: new DeterministicOverlapDiarizer() } : {}),
    }).factory(),
    orchestratorLauncherFactory: deterministicOrchestratorLauncherFactory({ mode }),
    runtimeIdForCommand: () => runtimeId,
    recoverOnOpen: false,
  });
  const acknowledgement = await service.start({
    sourceSessionId: source.sourceSessionId,
    sourceRevisionId: source.sourceRevisionId,
    range: { startMs: 0, endMs: 1_000 },
    requestedSourceLanguage: { mode: "declared", languages: ["ko"], reason: null },
    targetLanguage: "en",
    selectedLanguagePackId: "ko-v3",
    outputDepth: "evidence",
  });
  const deadline = Date.now() + 10_000;
  let status = await service.statusByRuntime(acknowledgement.runtimeId);
  while (!new Set(["terminal", "failed", "interrupted"]).has(status.lifecycle) && Date.now() < deadline) {
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 10));
    status = await service.statusByRuntime(acknowledgement.runtimeId);
  }
  return { directory, store, service, runtimeId: acknowledgement.runtimeId, lifecycle: status.lifecycle };
}

async function journal(runtime: RunHarness) {
  return readValidatedRuntimeJournal(runtime.store.paths(runtime.runtimeId).journalPath, runtime.runtimeId);
}

function objectPath(runtime: RunHarness, contentId: string): string {
  const digest = contentId.slice("sha256:".length);
  return join(runtime.store.paths(runtime.runtimeId).artifactStoreRoot, "objects", "sha256", digest.slice(0, 2), digest);
}

async function cleanup(runtime: RunHarness): Promise<void> {
  await rm(runtime.directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
}

test("default owned path exposes U4 while preserving v2 report/admission and closing v3/v4 study causality", async () => {
  const runtime = await runDefaultU4();
  try {
    assert.equal(runtime.lifecycle, "terminal");
    const loaded = await journal(runtime);
    const state = loaded.state;
    assert.equal(Object.keys(state.parentArtifactDispositions).length, 0);
    assert.equal(Object.keys(state.parentArtifactReadGrants).length, 0);
    assert.equal(Object.keys(state.studyPlanningDecisions).length, 0);
    assert.equal(Object.keys(state.ownedMediaStudies).length, 0);
    const root = Object.values(state.tasks).find((task) => task.parentTaskId === null)!;
    assert.deepEqual(root.requiredOutputs, [{ name: "owned-media study", artifactKind: "studio.owned-media-study.v3", required: true }]);
    assert.equal(root.grants.some((grant) => grant.capability === "study.restudy"), true);
    assert.equal(Object.keys(state.rangePasses).length, 0);
    assert.equal(Object.keys(state.speakerOverlapOperations).length, 0);
    assert.equal(Object.values(state.reports).filter((report) => report.study?.schema === "studio.study-report-submission.v2").length, 2);
    assert.equal(Object.keys(state.generalizedParentArtifactAdmissions).length, 2);
    assert.equal(Object.keys(state.generalizedParentArtifactReads).length, 2);
    const study = Object.values(state.generalizedOwnedMediaStudies)[0];
    const readiness = Object.values(state.generalizedStudyReadiness)[0];
    assert.equal(study.schema, "studio.owned-media-study.v3");
    assert.equal(readiness.schema, "studio.study-readiness.receipt.v4");
    assert.equal(readiness.outcome, "proceed_to_caption_review");
    assert.equal(Object.values(state.publishReviewIntakes)[0].outcome, "queued");
    assert.ok(study.evidenceCitations.every((citation) =>
      citation.evidenceKind === "current_run_speech" && citation.use === "claim_support"));

    const artifacts = new ContentAddressedArtifactStore(runtime.store.paths(runtime.runtimeId).artifactStoreRoot);
    const reference = restudiedReadinessReference(readiness);
    await new RestudiedStudyReadinessHost(state, artifacts).reopen(reference);
    const coverage = study.coverage[0];
    const causality = await new RestudiedCaptionCausalityHost(state, artifacts).close({
      readiness: reference,
      range: { artifactId: coverage.artifactId, trackId: coverage.trackId, startMs: coverage.startMs, endMs: coverage.endMs },
      sourceText: "현재 실행 음성 가설",
      targetText: "Current-run speech hypothesis",
    });
    assert.equal(causality.schema, "studio.caption-line-causality.v4");
    assert.equal(causality.source.state, "available");
    assert.equal(causality.target.state, "available");
    assert.ok(causality.lineage.citationIds.length > 0);
  } finally {
    await cleanup(runtime);
  }
});

test("default U4 schedules one attenuated speech pass and upgrades only its exact subrange through pass-new citations", async () => {
  const runtime = await runDefaultU4("restudy_support");
  try {
    assert.equal(runtime.lifecycle, "terminal");
    const loaded = await journal(runtime);
    const state = loaded.state;
    const pass = Object.values(state.rangePasses)[0];
    assert.equal(Object.keys(state.rangePasses).length, 1);
    assert.equal(pass.accepted, true);
    assert.equal(pass.request.passNumber, 2);
    assert.equal(pass.request.delta.kind, "attenuated_subrange");
    assert.ok(pass.request.delta.executionRange.startMs > pass.request.weakRange.startMs);
    assert.ok(pass.request.delta.executionRange.endMs < pass.request.weakRange.endMs);
    assert.ok(pass.request.priorEvidence.reportArtifactIds.length > 0);
    assert.ok(pass.request.priorEvidence.speechOperationIds.length > 0);
    assert.deepEqual(pass.request.reservedSpend, { wallMs: 20_000, toolCalls: 1 });
    assert.deepEqual(pass.request.limits, {
      maxAcceptedPassesPerRange: 1,
      maxAcceptedPassesPerProducer: 4,
      maxWallMsPerPass: 20_000,
      maxToolCallsPerPass: 1,
      maxPriorReports: 32,
      maxPriorCitations: 512,
    });
    assert.throws(() => validateStudyRestudyRequest({
      inputId: pass.request.inputId,
      coverageId: pass.request.coverageId,
      causeId: pass.request.cause.causeId,
    }), /delta/);
    assert.equal(pass.terminal?.outcome, "supported_new_citations");
    assert.equal(pass.terminal?.exhausted, false);
    assert.ok((pass.terminal?.evidence.newCitationIds.length ?? 0) > 0);
    assert.ok(pass.terminal?.evidence.newCitationIds.every((id) => !pass.request.priorEvidence.citationIds.includes(id)));
    assert.ok((pass.terminal?.measuredSpend.capabilityCalls ?? 0) <= pass.request.reservedSpend.toolCalls);

    const duplicateSpawns = Object.values(state.spawnRequests).filter((entry) =>
      entry.input.workloadKey === `restudy:${pass.request.workFingerprint}`);
    assert.equal(duplicateSpawns.length, 2);
    assert.equal(duplicateSpawns.filter((entry) => entry.accepted).length, 1);
    assert.equal(duplicateSpawns.find((entry) => !entry.accepted)?.rejection, "restudy_duplicate_work");
    assert.equal(Object.values(state.orchestratorToolCalls).filter((entry) => entry.tool === "study_restudy_request").length, 5);

    const study = Object.values(state.generalizedOwnedMediaStudies)[0];
    assert.equal(study.schema, "studio.owned-media-study.v3");
    assert.deepEqual(study.passes.map((entry) => entry.id), [pass.id]);
    assert.equal(study.reports.length, 3);
    const supportedPassCell = study.coverage.find((entry) =>
      entry.passIds.includes(pass.id) && entry.state === "supported" &&
      entry.startMs === pass.request.delta.executionRange.startMs && entry.endMs === pass.request.delta.executionRange.endMs);
    assert.ok(supportedPassCell);
    assert.ok(supportedPassCell.preservedStates.includes(pass.request.priorState));
    const passClaim = study.claims.find((entry) => supportedPassCell.claimIds.includes(entry.claimId));
    assert.deepEqual(passClaim?.citationIds, pass.terminal?.evidence.newCitationIds);
    assert.ok(study.coverage.some((entry) => entry.passIds.includes(pass.id) && entry.state !== "supported"));
    assert.ok(study.coverage.some((entry) => !entry.passIds.includes(pass.id) && entry.state === "supported"));

    const readiness = Object.values(state.generalizedStudyReadiness)[0];
    assert.equal(readiness.schema, "studio.study-readiness.receipt.v4");
    assert.equal(readiness.outcome, "proceed_to_caption_review");
    assert.ok(readiness.terminalWeakCoverageIds.length > 0);
    const replayed = projectRuntimeEvents(runtime.runtimeId, loaded.events);
    assert.deepEqual(replayed, state);
    const observability = await buildRuntimeObservabilityIndex(await readFile(runtime.store.paths(runtime.runtimeId).journalPath, "utf8"));
    assert.equal(observability.sources.receipts.filter((entry) => entry.kind === "study_range_pass").length, 2);
    assert.ok(observability.sources.receipts.some((entry) => entry.receiptId === study.executorReceiptId));
    assert.ok(observability.sources.receipts.some((entry) => entry.receiptId === readiness.receiptId));
  } finally {
    await cleanup(runtime);
  }
});

test("default U4 exhausts only the affected weak range while unrelated supported coverage continues", async () => {
  const runtime = await runDefaultU4("restudy_exhausted");
  try {
    assert.equal(runtime.lifecycle, "terminal");
    const { state } = await journal(runtime);
    const pass = Object.values(state.rangePasses)[0];
    assert.equal(pass.terminal?.outcome, "withheld_exhausted");
    assert.equal(pass.terminal?.exhausted, true);
    assert.deepEqual(pass.terminal?.evidence.newCitationIds, []);
    const study = Object.values(state.generalizedOwnedMediaStudies)[0];
    if (study.schema !== "studio.owned-media-study.v3") assert.fail("default U4 did not record study v3");
    assert.ok(study.coverage.some((entry) => entry.passIds.includes(pass.id) && entry.state === "withheld"));
    assert.ok(study.coverage.some((entry) => !entry.passIds.includes(pass.id) && entry.state === "supported"));
    const readiness = Object.values(state.generalizedStudyReadiness)[0];
    if (readiness.schema !== "studio.study-readiness.receipt.v4") assert.fail("default U4 did not record readiness v4");
    assert.equal(readiness.outcome, "proceed_to_caption_review");
    assert.ok(readiness.terminalWeakCoverageIds.some((id) => study.coverage.find((entry) => entry.coverageId === id)?.passIds.includes(pass.id)));
    assert.equal(Object.values(state.tasks).find((task) => task.parentTaskId === null)?.status, "completed");
  } finally {
    await cleanup(runtime);
  }
});

test("default U4 retains conflicting prior evidence and pass disagreement without upgrading support", async () => {
  const runtime = await runDefaultU4("restudy_disagreement");
  try {
    assert.equal(runtime.lifecycle, "terminal");
    const { state } = await journal(runtime);
    const pass = Object.values(state.rangePasses)[0];
    assert.equal(pass.request.priorState, "conflicting");
    assert.equal(pass.request.cause.kind, "recognizer_disagreement");
    assert.equal(pass.terminal?.outcome, "withheld_exhausted");
    assert.ok((pass.terminal?.evidence.disagreementCitationIds.length ?? 0) > 0);
    const study = Object.values(state.generalizedOwnedMediaStudies)[0];
    if (study.schema !== "studio.owned-media-study.v3") assert.fail("default U4 did not record study v3");
    assert.deepEqual(study.passes.map((entry) => entry.id), [pass.id]);
    const passCoverage = study.coverage.filter((entry) => entry.passIds.includes(pass.id));
    assert.ok(passCoverage.length > 0);
    assert.ok(passCoverage.every((entry) => entry.state !== "supported"));
    assert.ok(passCoverage.every((entry) => entry.preservedStates.includes("conflicting")));
    assert.ok(pass.terminal?.evidence.disagreementCitationIds.every((id) => study.evidenceCitations.some((citation) => citation.citationId === id)));
    const readiness = Object.values(state.generalizedStudyReadiness)[0];
    assert.equal(readiness.outcome, "withheld");
    assert.ok(readiness.reasonCodes.includes("unresolved_conflict"));
  } finally {
    await cleanup(runtime);
  }
});

test("default U6.1 maps one authenticated overlap cell to one exact attenuated speech pass without caption authority", async () => {
  const runtime = await runDefaultU4("restudy_speaker_overlap");
  try {
    const loaded = await journal(runtime);
    const state = loaded.state;
    assert.equal(runtime.lifecycle, "terminal");
    const passes = Object.values(state.rangePasses);
    assert.equal(passes.length, 1);
    const pass = passes[0];
    assert.equal(pass.accepted, true);
    assert.equal(pass.request.cause.kind, "speaker_overlap");
    assert.notEqual(pass.request.cause.kind, "recognizer_disagreement");
    assert.equal(pass.request.priorState, "conflicting");
    assert.deepEqual(pass.request.weakRange, { ...pass.request.weakRange, startMs: 0, endMs: 500 });
    assert.deepEqual(pass.request.cause.range, { ...pass.request.cause.range, startMs: 150, endMs: 350 });
    assert.deepEqual(pass.request.delta, { kind: "attenuated_subrange", executionRange: pass.request.cause.range });
    assert.ok(pass.request.priorEvidence.speechExecutionRanges.some((range) =>
      range.artifactId === pass.request.cause.range.artifactId && range.trackId === pass.request.cause.range.trackId &&
      range.startMs < pass.request.cause.range.startMs && range.endMs > pass.request.cause.range.endMs));
    assert.ok(pass.request.cause.rawStates.every((raw) =>
      raw.endsWith(":conflicting:speaker:overlap:overlap_hypothesis_requires_speech_restudy")));
    assert.equal(pass.request.passNumber, 2);
    assert.equal(pass.request.producer.kind, "current_run_speech");
    assert.deepEqual(pass.request.reservedSpend, { wallMs: 20_000, toolCalls: 1 });
    const narrowed = structuredClone(pass.request);
    narrowed.delta.executionRange.endMs -= 1;
    assert.throws(() => validateRangePassRequestReceipt(narrowed), /exact host-derived speaker overlap range/);
    assert.equal(pass.terminal?.outcome, "unavailable_exhausted");
    assert.equal(pass.terminal?.exhausted, true);

    const study = Object.values(state.generalizedOwnedMediaStudies)[0];
    if (study.schema !== "studio.owned-media-study.v3") assert.fail("U6.1 did not record study v3");
    const speakerCitations = study.evidenceCitations.filter((citation) => citation.evidenceKind === "speaker_turn");
    assert.ok(speakerCitations.length > 0);
    assert.ok(speakerCitations.every((citation) => citation.use === "coverage_qualification"));
    const citationById = new Map(study.evidenceCitations.map((citation) => [citation.citationId, citation]));
    assert.ok(pass.request.cause.citationIds.every((id) => citationById.get(id)?.evidenceKind === "speaker_turn"));
    assert.deepEqual(
      pass.request.cause.observationIds,
      [...new Set(pass.request.cause.citationIds.flatMap((id) =>
        citationById.get(id)?.observations.filter((observation) =>
          observation.rawState === "speaker:overlap:overlap_hypothesis_requires_speech_restudy" &&
          observation.state === "conflicting").map((observation) => observation.observationId) ?? []))].sort(),
    );
    assert.ok(study.claims.every((claim) => claim.citationIds.every((id) => {
      const citation = citationById.get(id);
      return citation?.evidenceKind === "current_run_speech" && citation.use === "claim_support";
    })));
    const readiness = Object.values(state.generalizedStudyReadiness)[0];
    if (readiness.schema !== "studio.study-readiness.receipt.v4") assert.fail("U6.1 did not record readiness v4");
    assert.equal(readiness.outcome, "withheld");
    assert.ok(readiness.reasonCodes.includes("unresolved_conflict"));
    const artifacts = new ContentAddressedArtifactStore(runtime.store.paths(runtime.runtimeId).artifactStoreRoot);
    const causality = await new RestudiedCaptionCausalityHost(state, artifacts).close({
      readiness: restudiedReadinessReference(readiness),
      range: structuredClone(pass.request.cause.range),
      sourceText: "겹친 음성 가설",
      targetText: "Overlapping speech hypothesis",
    });
    assert.deepEqual(causality.source, { language: "ko", state: "withheld", text: null, reasonCode: "study_readiness_withheld" });
    assert.deepEqual(causality.target, { language: "en", state: "withheld", text: null, reasonCode: "study_readiness_withheld" });
    assert.deepEqual(causality.lineage.citationIds, []);
    assert.equal(Object.values(state.spawnRequests).filter((entry) =>
      entry.input.workloadKey === `restudy:${pass.request.workFingerprint}` && entry.accepted).length, 1);
    assert.deepEqual(projectRuntimeEvents(runtime.runtimeId, loaded.events), state);
  } finally {
    await cleanup(runtime);
  }
});

test("default U4 cold replay rejects changed range-pass request or terminal receipt bytes", async (suite) => {
  for (const target of ["request", "terminal"] as const) await suite.test(target, async () => {
    const runtime = await runDefaultU4("restudy_support");
    try {
      const { state } = await journal(runtime);
      const pass = Object.values(state.rangePasses)[0];
      const readiness = Object.values(state.generalizedStudyReadiness)[0];
      if (readiness.schema !== "studio.study-readiness.receipt.v4") assert.fail("default U4 did not record readiness v4");
      const contentId = target === "request" ? pass.requestReceiptContentId : pass.terminalReceiptContentId;
      assert.ok(contentId);
      await appendFile(objectPath(runtime, contentId), "tamper");
      const artifacts = new ContentAddressedArtifactStore(runtime.store.paths(runtime.runtimeId).artifactStoreRoot);
      await assert.rejects(
        new RestudiedStudyReadinessHost(state, artifacts).reopen(restudiedReadinessReference(readiness)),
        /changed|integrity|identity|canonical|bytes/i,
      );
    } finally {
      await cleanup(runtime);
    }
  });
});

test("model-tool planning, owned study, deterministic readiness, projection, and cold replay close one terminal root", async () => {
  const runtime = await run();
  try {
    assert.equal(runtime.lifecycle, "terminal");
    const loaded = await journal(runtime);
    const state = loaded.state;
    const artifacts = new ContentAddressedArtifactStore(runtime.store.paths(runtime.runtimeId).artifactStoreRoot);
    const root = Object.values(state.tasks).find((task) => task.parentTaskId === null)!;
    const planning = Object.values(state.studyPlanningDecisions);
    const studies = Object.values(state.ownedMediaStudies);
    const readiness = Object.values(state.studyReadiness);
    assert.equal(root.status, "completed");
    assert.equal(Object.keys(state.parentArtifactReadGrants).length, 2);
    assert.equal(Object.values(state.parentArtifactReads).filter((read) => read.status === "completed").length, 2);
    assert.equal(planning.length, 1);
    assert.equal(planning[0].input.reports.length, 2);
    assert.equal(planning[0].outcome, "synthesize_with_gaps");
    assert.equal(studies.length, 1);
    assert.equal(readiness.length, 1);
    assert.equal(readiness[0].outcome, "proceed_to_caption_review");
    assert.deepEqual(readiness[0].reasonCodes, []);
    const intake = Object.values(state.publishReviewIntakes)[0];
    assert.equal(intake.outcome, "queued");
    assert.equal(intake.readinessId, readiness[0].id);

    await reopenStudyPlanningDecision(state, artifacts, planning[0].id);
    const verifiedStudy = await reopenOwnedMediaStudy(state, artifacts, studies[0].id);
    assert.equal(verifiedStudy.executorReceipt.producer.authorship, "active_root_executor_tool_call");
    assert.equal(verifiedStudy.envelope.nonClaims.publication, "not_authorized");
    await reopenStudyReadiness(state, artifacts, readiness[0].id);
    await reopenPublishReviewIntakes(state, loaded.events, artifacts);

    const replayed = projectRuntimeEvents(runtime.runtimeId, loaded.events);
    assert.deepEqual(replayed, state);
    const projection = projectProductionRuntimeJournal(loaded.events);
    assert.equal(projection.studyPlanningDecisions[0].decisionId, planning[0].id);
    assert.equal(projection.ownedMediaStudies[0].studyId, studies[0].id);
    assert.deepEqual(projection.ownedMediaStudies[0].coverage, studies[0].coverage);
    assert.deepEqual(projection.ownedMediaStudies[0].conflicts, studies[0].conflicts);
    assert.equal(projection.studyReadiness[0].readinessId, readiness[0].id);
    assert.equal(projection.studyReadiness[0].outcome, "proceed_to_caption_review");
  } finally {
    await cleanup(runtime);
  }
});

test("a useful follow-up names an exact gap, re-enters spawn/report/admission/read, and appears verbatim in the study", async () => {
  const runtime = await run("follow_up");
  try {
    assert.equal(runtime.lifecycle, "terminal");
    const { state } = await journal(runtime);
    const decisions = Object.values(state.studyPlanningDecisions).sort((left, right) => left.id.localeCompare(right.id));
    const request = decisions.find((decision) => decision.outcome === "request_follow_up")!;
    const synthesis = decisions.find((decision) => decision.outcome === "synthesize_with_gaps")!;
    const followUp = Object.values(state.studyFollowUps)[0];
    assert.ok(request);
    assert.ok(synthesis);
    assert.equal(request.gapIds.length, 1);
    assert.deepEqual(request.citedGapIds, request.gapIds);
    assert.equal(followUp.planningDecisionId, request.id);
    assert.deepEqual(followUp.cause, { kind: "gap", id: request.gapIds[0] });
    assert.equal(followUp.accepted, true);
    assert.ok(followUp.taskId && followUp.agentId);
    assert.equal(synthesis.input.reports.length, 3);
    assert.equal(synthesis.gapIds.length, 0);
    const study = Object.values(state.ownedMediaStudies)[0];
    const artifacts = new ContentAddressedArtifactStore(runtime.store.paths(runtime.runtimeId).artifactStoreRoot);
    const verified = await reopenOwnedMediaStudy(state, artifacts, study.id);
    assert.deepEqual(verified.envelope.followUpHistory.map((entry) => ({
      followUpId: entry.followUpId,
      planningDecisionId: entry.planningDecisionId,
      cause: entry.cause,
      accepted: entry.accepted,
      status: entry.terminal?.status,
    })), [{
      followUpId: followUp.id,
      planningDecisionId: request.id,
      cause: followUp.cause,
      accepted: true,
      status: "completed",
    }]);
    assert.equal(Object.values(state.studyReadiness)[0].outcome, "proceed_to_caption_review");
  } finally {
    await cleanup(runtime);
  }
});

test("explicit gaps, conflicts, partial failure, rejected inputs, and duplicate synthesis retain closed structural facts", async (t) => {
  await t.test("no follow-up with explicit gaps", async () => {
    const runtime = await run("synthesize_gaps");
    try {
      const { state } = await journal(runtime);
      const decision = Object.values(state.studyPlanningDecisions)[0];
      assert.equal(decision.outcome, "synthesize_with_gaps");
      assert.ok(decision.gapIds.length > 0);
      assert.deepEqual(decision.citedGapIds, decision.gapIds);
      assert.equal(Object.keys(state.studyFollowUps).length, 0);
      assert.equal(Object.values(state.studyReadiness)[0].outcome, "withheld");
      assert.deepEqual(Object.values(state.studyReadiness)[0].reasonCodes, ["non_supported_root_coverage"]);
      assert.equal(Object.values(state.publishReviewIntakes)[0].outcome, "rejected");
    } finally {
      await cleanup(runtime);
    }
  });

  await t.test("conflicting children", async () => {
    const runtime = await run("conflict");
    try {
      const { state } = await journal(runtime);
      const decision = Object.values(state.studyPlanningDecisions)[0];
      const study = Object.values(state.ownedMediaStudies)[0];
      assert.equal(decision.conflictIds.length, 1);
      assert.deepEqual(decision.citedConflictIds, decision.conflictIds);
      assert.deepEqual(study.conflictIds, decision.conflictIds);
      assert.equal(study.conflicts[0].status, "unresolved");
      assert.equal(Object.values(state.studyReadiness)[0].outcome, "withheld");
      assert.deepEqual(Object.values(state.studyReadiness)[0].reasonCodes, ["non_supported_root_coverage", "unresolved_conflict"]);
    } finally {
      await cleanup(runtime);
    }
  });

  await t.test("partial child failure", async () => {
    const runtime = await run("partial_failure");
    try {
      const loaded = await journal(runtime);
      assert.equal(runtime.lifecycle, "terminal", JSON.stringify({
        tasks: Object.values(loaded.state.tasks).map((task) => ({ label: task.workerLabel, status: task.status, reason: task.terminalReason })),
        tail: loaded.events.slice(-8).map((event) => event.type),
      }));
      const { state } = loaded;
      const study = Object.values(state.ownedMediaStudies)[0];
      const artifacts = new ContentAddressedArtifactStore(runtime.store.paths(runtime.runtimeId).artifactStoreRoot);
      const verified = await reopenOwnedMediaStudy(state, artifacts, study.id);
      assert.equal(verified.envelope.childDispositions.filter((entry) => entry.outcome === "failed").length, 1);
      assert.ok(verified.envelope.limitations.some((entry) => entry.code === "partial_child_failure"));
      assert.equal(Object.values(state.studyReadiness)[0].outcome, "proceed_to_caption_review");
    } finally {
      await cleanup(runtime);
    }
  });

  await t.test("rejected input", async () => {
    const runtime = await run("rejected_input");
    try {
      const { state } = await journal(runtime);
      const study = Object.values(state.ownedMediaStudies)[0];
      const artifacts = new ContentAddressedArtifactStore(runtime.store.paths(runtime.runtimeId).artifactStoreRoot);
      const verified = await reopenOwnedMediaStudy(state, artifacts, study.id);
      assert.equal(verified.envelope.childDispositions.filter((entry) => entry.outcome === "rejected").length, 1);
      assert.ok(verified.envelope.limitations.some((entry) => entry.code === "rejected_child_input"));
      assert.equal(Object.keys(state.parentArtifactReadGrants).length, 2);
    } finally {
      await cleanup(runtime);
    }
  });

  await t.test("duplicate synthesis", async () => {
    const runtime = await run("duplicate_synthesis");
    try {
      assert.equal(runtime.lifecycle, "terminal");
      const loaded = await journal(runtime);
      assert.equal(Object.keys(loaded.state.ownedMediaStudies).length, 1);
      assert.equal(loaded.events.filter((event) => event.type === "study.synthesis_completed").length, 1);
    } finally {
      await cleanup(runtime);
    }
  });
});

test("unsupported synthesized citations and hidden coverage fail before any study or readiness authority exists", async (t) => {
  for (const mode of ["unsupported_claim", "hidden_gap"] as const) await t.test(mode, async () => {
    const runtime = await run(mode);
    try {
      assert.equal(runtime.lifecycle, "failed");
      const { state } = await journal(runtime);
      assert.equal(Object.keys(state.ownedMediaStudies).length, 0);
      assert.equal(Object.keys(state.studyReadiness).length, 0);
      assert.equal(Object.keys(state.publishReviewIntakes).length, 0);
    } finally {
      await cleanup(runtime);
    }
  });
});

test("study content and readiness receipt tamper fail recursive audit and publish-review reopening", async (t) => {
  for (const target of ["study-content", "readiness-receipt"] as const) await t.test(target, async () => {
    const runtime = await run();
    try {
      const loaded = await journal(runtime);
      const state = loaded.state;
      const study = Object.values(state.ownedMediaStudies)[0];
      const readiness = Object.values(state.studyReadiness)[0];
      const contentId = target === "study-content" ? study.contentId : readiness.receiptContentId;
      await appendFile(objectPath(runtime, contentId), "tamper");
      const artifacts = new ContentAddressedArtifactStore(runtime.store.paths(runtime.runtimeId).artifactStoreRoot);
      if (target === "study-content") {
        await assert.rejects(reopenOwnedMediaStudy(state, artifacts, study.id), /content identity|registered content|canonical|changed/);
      } else {
        await assert.rejects(reopenStudyReadiness(state, artifacts, readiness.id), /content identity|registered content|canonical|changed/);
      }
      await assert.rejects(reopenPublishReviewIntakes(state, loaded.events, artifacts));
    } finally {
      await cleanup(runtime);
    }
  });
});
