import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";

import { ContentAddressedArtifactStore } from "../src/studio/runtime/production/artifactStore.ts";
import { FileEventJournal, RuntimeLedger } from "../src/studio/runtime/production/journal.ts";
import { reopenStudyPlanningDecision } from "../src/studio/runtime/production/studyPlanningAudit.ts";
import { reopenStudyReadiness } from "../src/studio/runtime/production/studyReadinessAudit.ts";
import { reopenOwnedMediaStudy } from "../src/studio/runtime/production/studySynthesisAudit.ts";
import { createProductionAnalysisRequest } from "../src/studio/runtime/production/runStart/analysisRequest.ts";
import { loadOwnedSourceSession } from "../src/studio/runtime/production/runStart/sourceSessionLoader.ts";
import {
  codexOrchestratorLauncherFactory,
  codexWorkerLauncherFactory,
  initializeRuntimeApplication,
  runBoundedRuntimeApplication,
} from "../src/studio/runtime/production/runtimeHost/runtimeApplication.ts";

const ENABLED = process.env.STUDIO_RUN_REAL_CODEX_SWARM === "1";

test("guarded real Codex root closes fan-out, admitted reports, model planning, and model-authored study synthesis", {
  skip: !ENABLED,
  timeout: 300_000,
}, async (context) => {
  const model = process.env.STUDIO_OWNED_SWARM_MODEL?.trim();
  if (!model) throw new Error("STUDIO_OWNED_SWARM_MODEL is required when the real owned-swarm proof is enabled");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const proofRoot = resolve(process.env.STUDIO_OWNED_SWARM_PROOF_ROOT?.trim() || ".studio/owned-swarm-proofs");
  const runtimeRoot = join(proofRoot, `proof-${stamp}-${process.pid}`);
  await mkdir(proofRoot, { recursive: true });
  await mkdir(runtimeRoot, { recursive: false });
  const loadedSource = await loadOwnedSourceSession(resolve("public/demo/runs/run-005"));
  const analysisRequest = createProductionAnalysisRequest(loadedSource.session, {
    range: { startMs: 0, endMs: Math.min(2_000, loadedSource.session.source.durationMs) },
    requestedSource: { mode: "declared", languages: ["ko"], reason: null },
    targetLanguage: "en",
    selectedLanguagePackId: "ko-v3",
    outputDepth: "evidence",
  });
  const runtimeId = `runtime:owned-swarm-real-proof-${stamp}-${process.pid}`;
  const initialized = await initializeRuntimeApplication({
    runtimeRoot,
    journalPath: join(runtimeRoot, "events.ndjson"),
    artifactStoreRoot: join(runtimeRoot, "artifact-store"),
    runStartPath: join(runtimeRoot, "run-start.json"),
    runtimeId,
    journalId: `journal:${runtimeId}`,
    acceptedBy: "operator:guarded-real-codex-proof",
    startedAt: new Date().toISOString(),
    loadedSource,
    analysisRequest,
  });
  await runBoundedRuntimeApplication(
    initialized,
    codexWorkerLauncherFactory({ model, maximumWallMs: 90_000 }),
    codexOrchestratorLauncherFactory({ model, maximumWallMs: 120_000 }),
  );

  const ledger = await RuntimeLedger.open(runtimeId, new FileEventJournal(initialized.journalPath));
  const state = ledger.state();
  const root = Object.values(state.tasks).find((task) => task.parentTaskId === null);
  assert.ok(root);
  const rootExecution = Object.values(state.executions).find((execution) => execution.taskId === root.id);
  assert.ok(rootExecution?.receipt);
  assert.equal(rootExecution.receipt.producer.id, "codex.exec");
  assert.equal(rootExecution.receipt.outcome, "completed");
  assert.ok(rootExecution.modelUsageReceiptId);
  const usage = state.modelUsage[rootExecution.modelUsageReceiptId];
  assert.equal(usage.model, model);
  assert.ok(
    usage.measured.inputTokens + usage.measured.outputTokens + usage.measured.reasoningOutputTokens > 0,
    "real Codex proof must contain measured non-zero token usage",
  );
  const rootSpawns = Object.values(state.spawnRequests).filter((request) =>
    request.authoredByExecutionId === rootExecution.id && request.toolCallId !== null);
  assert.ok(rootSpawns.filter((request) => request.accepted).length >= 2, "real Codex root must author at least two accepted child contracts");
  assert.ok(Object.values(state.reportWaits).some((wait) =>
    wait.executionId === rootExecution.id && wait.status === "returned"));
  assert.equal(state.taskLaunches[root.id].executionId, rootExecution.id);
  assert.ok(Object.values(state.reports).filter((report) => report.study?.output.schema === "studio.study-report.v1").length >= 2);
  assert.ok(Object.values(state.parentArtifactDispositions).filter((disposition) => disposition.outcome === "accepted").length >= 2);
  assert.ok(Object.values(state.parentArtifactReads).filter((read) => read.status === "completed").length >= 2);
  const planning = Object.values(state.studyPlanningDecisions);
  assert.ok(planning.length >= 1);
  const synthesisDecision = planning.find((decision) => decision.outcome === "synthesize_with_gaps");
  assert.ok(synthesisDecision, "real Codex root must author an eventual synthesis decision");
  assert.ok(synthesisDecision.input.reports.length >= 2);
  const studies = Object.values(state.ownedMediaStudies);
  assert.equal(studies.length, 1);
  const study = studies[0];
  assert.equal(study.planningDecisionId, synthesisDecision.id);
  assert.ok(rootExecution.receipt.outputArtifactIds.includes(study.artifactId));
  const readiness = Object.values(state.studyReadiness);
  assert.equal(readiness.length, 1);
  assert.equal(Object.values(state.publishReviewIntakes)[0].readinessId, readiness[0].id);
  const artifacts = new ContentAddressedArtifactStore(initialized.artifactStoreRoot);
  await reopenStudyPlanningDecision(state, artifacts, synthesisDecision.id);
  const verifiedStudy = await reopenOwnedMediaStudy(state, artifacts, study.id);
  assert.equal(verifiedStudy.executorReceipt.producer.authorship, "active_root_executor_tool_call");
  assert.equal(verifiedStudy.envelope.root.executionId, rootExecution.id);
  assert.ok(verifiedStudy.envelope.reports.length >= 2);
  await reopenStudyReadiness(state, artifacts, readiness[0].id);
  const replayed = await RuntimeLedger.open(runtimeId, new FileEventJournal(initialized.journalPath));
  assert.deepEqual(replayed.state(), state);
  context.diagnostic(`durable real-Codex proof retained at ${runtimeRoot}`);
});
