import assert from "node:assert/strict";
import { appendFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import { ContentAddressedArtifactStore } from "../src/studio/runtime/production/artifactStore.ts";
import { reopenPublishReviewIntakes } from "../src/studio/runtime/production/publishReviewIntakeAudit.ts";
import { projectRuntimeEvents } from "../src/studio/runtime/production/projection.ts";
import { reopenStudyPlanningDecision } from "../src/studio/runtime/production/studyPlanningAudit.ts";
import { reopenStudyReadiness } from "../src/studio/runtime/production/studyReadinessAudit.ts";
import { reopenOwnedMediaStudy } from "../src/studio/runtime/production/studySynthesisAudit.ts";
import { projectProductionRuntimeJournal } from "../src/studio/runtime/production/studioProjection.ts";
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
