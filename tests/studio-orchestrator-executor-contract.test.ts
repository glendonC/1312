import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import { canonicalSha256 } from "../src/studio/runtime/production/artifactStore.ts";
import { FileEventJournal, RuntimeLedger } from "../src/studio/runtime/production/journal.ts";
import { createProductionAnalysisRequest } from "../src/studio/runtime/production/runStart/analysisRequest.ts";
import { loadOwnedSourceSession } from "../src/studio/runtime/production/runStart/sourceSessionLoader.ts";
import type { CurrentRunSpeechRecognizer } from "../src/studio/runtime/production/semantic/currentRunSpeechRecognizer.ts";
import {
  codexOrchestratorLauncherFactory,
  codexWorkerLauncherFactory,
  initializeRuntimeApplication,
  PROOF_RUNTIME_LIMITS,
  runBoundedRuntimeApplication,
} from "../src/studio/runtime/production/runtimeHost/runtimeApplication.ts";
import {
  GENERALIZED_INITIAL_COVERAGE_BUDGET,
  GENERALIZED_BASELINE_RUN_BUDGET,
  GENERALIZED_RECOVERY_CONTINGENCY_BUDGET,
  GENERALIZED_ROOT_BUDGET,
  GENERALIZED_RUN_BUDGET,
} from "../src/studio/runtime/production/executor/generalizedBudgetContract.ts";

function currentRunRecognizer(): CurrentRunSpeechRecognizer {
  return {
    async describe({ requestedSourceLanguage }) {
      const configuration = {
        id: "studio.runtime-factory-test-recognizer.timed-segments.v1",
        language: requestedSourceLanguage.mode === "declared" ? requestedSourceLanguage.languages[0] ?? null : null,
        timestampMode: "segment" as const,
        segmentation: "producer_defined" as const,
      };
      return {
        id: "studio.runtime-factory-test-recognizer",
        version: "1",
        model: "test-current-run-recognizer",
        runtime: { id: "node-test", version: process.version },
        configuration: { ...configuration, contentId: `sha256:${canonicalSha256(configuration)}` },
        executionScope: "current_run",
        fixtureContentId: null,
      };
    },
    async recognize(input) {
      return {
        availability: "available",
        reason: "current_run_hypotheses_returned",
        segments: [{
          startMs: input.range.startMs,
          endMs: input.range.endMs,
          state: "available",
          text: "현재 실행 인식기 배선 증명",
        }],
      };
    },
  };
}

async function fakeCodex(
  directory: string,
  mode: "normal" | "hang-root" | "repeat-generalized-read" | "wrong-generalized-budget" = "normal",
): Promise<{ executable: string; prefix: string[] }> {
  const script = join(directory, "fake-owned-swarm-codex.mjs");
  await writeFile(script, `
const args = process.argv.slice(2);
if (args[0] === "--version") {
  process.stdout.write("codex-cli owned-swarm-test-1.0.0\\n");
  process.exit(0);
}
let prompt = "";
for await (const chunk of process.stdin) prompt += chunk;
const isRoot = Boolean(process.env.STUDIO_ORCHESTRATOR_BRIDGE_URL);
const generalized = prompt.includes("studio.study-report.v2");
const restudied = prompt.includes("studio.owned-media-study.v3");
const testMode = ${JSON.stringify(mode)};
if (isRoot && testMode === "hang-root") await new Promise(() => setInterval(() => {}, 1_000));
if (isRoot) {
  const required = [
    "--strict-config",
    "web_search=\\\"disabled\\\"",
    "features.shell_tool=false",
    "features.unified_exec=false",
    "features.apps=false",
    "features.hooks=false",
    "features.goals=false",
    "features.memories=false",
    "features.multi_agent=false",
    "features.remote_plugin=false",
    "mcp_servers.studio_orchestrator.required=true",
  ];
  for (const expected of required) {
    if (!args.some((arg) => arg === expected || arg.includes(expected))) throw new Error("missing closed root config " + expected);
  }
  const modelIndex = args.indexOf("--model");
  if (args[modelIndex + 1] !== "owned-swarm-test-model") throw new Error("root model was not explicit");
  const expectedRootToolCount = restudied ? 8 : 6;
  if (!prompt.includes("exactly " + expectedRootToolCount + " closed, path-free tools") || !prompt.includes("study_synthesize") || !prompt.includes("jobContext") || (restudied && (!prompt.includes("study_restudy_request") || !prompt.includes("study_separation_request") || !prompt.includes("study_research_request")))) {
    throw new Error("closed root prompt contract is missing");
  }
  if ((generalized && !prompt.includes('budget exactly {"wallMs":240000,"toolCalls":2}')) || !prompt.includes("Never retry an equivalent rejected range")) {
    throw new Error("initial coverage child budget contract is missing");
  }
  const root = JSON.parse(prompt.split("\\n\\n").at(-1));
  const rawCall = async (name, argumentsValue) => {
    const response = await fetch(process.env.STUDIO_ORCHESTRATOR_BRIDGE_URL + "/v1/call", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + process.env.STUDIO_ORCHESTRATOR_BRIDGE_TOKEN,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name, arguments: argumentsValue }),
    });
    const body = await response.json();
    return { response, body };
  };
  const call = async (name, argumentsValue) => {
    const { response, body } = await rawCall(name, argumentsValue);
    if (!response.ok || body.ok !== true) throw new Error("orchestrator bridge rejected " + name + ": " + JSON.stringify(body));
    return body.result;
  };
  const child = (side, startMs, endMs) => ({
    workloadKey: "model-child:" + side,
    objective: "Return one typed coverage study for the " + side + " model-authored branch without making a correctness claim.",
    workerKind: "analysis",
    workerLabel: "model-" + side,
    mediaScope: [{ ...root.mediaScope[0], startMs, endMs }],
    inputArtifactIds: [root.jobContext.source.artifactId],
    requiredOutputs: [{ name: "coverage study", artifactKind: generalized ? "studio.study-report.v2" : "studio.study-report.v1", required: true }],
    requiredCapabilities: ["speech.transcribe", "report.submit"],
    dependencyWorkloadKeys: [],
    budget: { wallMs: generalized ? (testMode === "wrong-generalized-budget" ? 180000 : 240000) : 10000, toolCalls: 2 },
  });
  const midpoint = Math.floor((root.mediaScope[0].startMs + root.mediaScope[0].endMs) / 2);
  const left = await call("task_spawn_request", child("left", root.mediaScope[0].startMs, midpoint));
  const right = await call("task_spawn_request", child("right", midpoint, root.mediaScope[0].endMs));
  if (left.decision !== "accepted" || right.decision !== "accepted") throw new Error("fan-out was not accepted");
  const waited = await call("task_reports_wait", {});
  if (waited.result !== "all_terminal" || waited.children.length !== 2) throw new Error("wait did not return two terminal children");
  let planningInput = null;
  let synthesisInput = null;
  let firstReadRequest = null;
  for (const childResult of waited.children) {
    const disposition = await call("report_disposition", {
      reportId: childResult.reportId,
      outputArtifactId: childResult.artifactIds[0],
      outcome: "accepted",
      reason: "The fake model root accepts this structurally audited report for contract planning only.",
    });
    if (!disposition.admission) throw new Error("accepted report had no admission");
    const readRequest = {
      grantId: disposition.admission.grant.id,
      contentIds: disposition.admission.grant.contentScope.map((entry) => entry.contentId),
    };
    firstReadRequest = firstReadRequest || readRequest;
    const read = await call("artifact_read", readRequest);
    planningInput = read.planningInput || planningInput;
    synthesisInput = read.synthesisInput || synthesisInput;
  }
  if (generalized) {
    if (!synthesisInput) throw new Error("two admitted generalized reads did not expose synthesis input");
    if (Object.keys(synthesisInput).length !== 1 || typeof synthesisInput.inputId !== "string" || !synthesisInput.inputId.startsWith("study-synthesis-input:")) {
      throw new Error("generalized synthesis input was not one opaque host-derived id");
    }
    if (testMode === "repeat-generalized-read") {
      const duplicate = await rawCall("artifact_read", firstReadRequest);
      if (duplicate.response.ok || duplicate.body.ok === true || !duplicate.body.error.message.includes("one read authority") ||
          !duplicate.body.error.message.includes(synthesisInput.inputId) || !duplicate.body.error.message.includes("Call study_synthesize now")) {
        throw new Error("duplicate generalized admission read did not fail before mutation");
      }
    }
    const synthesis = await call("study_synthesize", synthesisInput);
    if (!synthesis.studyId || synthesis.executorReceipt.schema !== (restudied ? "studio.owned-media-study.executor-receipt.v3" : "studio.owned-media-study.executor-receipt.v2")) throw new Error("generalized study synthesis did not close");
  } else {
  if (!planningInput) throw new Error("two admitted reads did not expose planning input");
  const planning = await call("study_planning_decision", {
    inputId: planningInput.inputId,
    coverageIds: planningInput.coverage.map((entry) => entry.coverageId),
    gapIds: planningInput.gaps.map((entry) => entry.gapId),
    conflictIds: planningInput.conflicts.map((entry) => entry.conflictId),
    outcome: "synthesize_with_gaps",
    citedGapIds: planningInput.gaps.map((entry) => entry.gapId),
    citedConflictIds: planningInput.conflicts.map((entry) => entry.conflictId),
    reason: "The fake model root explicitly preserves every structural gap and conflict.",
  });
  const synthesis = await call("study_synthesize", {
    planningDecisionId: planning.receipt.decisionId,
    coverage: planningInput.coverage.map((entry) => ({
      coverageId: entry.coverageId,
      ...entry.range,
      state: entry.aggregate === "gap" ? "unknown" : "withheld",
      claimIds: [],
      reason: { code: entry.aggregate === "conflict" ? "unresolved_conflict" : "explicit_study_gap", detail: "The fake model preserves this range as non-supported." },
    })),
    claims: [],
    conflicts: planningInput.conflicts.map((entry) => ({ conflictId: entry.conflictId, coverageId: entry.coverageId, status: "unresolved", detail: "The fake model lists but does not arbitrate this conflict." })),
    limitations: [
      { code: "semantic_quality_not_assessed", coverageIds: planningInput.coverage.map((entry) => entry.coverageId), detail: "This contract fixture does not assess semantic quality." },
      ...planningInput.gaps.map((entry) => ({ code: "explicit_gap", coverageIds: [entry.coverageId], detail: "The exact planning gap remains non-supported." })),
      ...planningInput.conflicts.map((entry) => ({ code: "unresolved_conflict", coverageIds: [entry.coverageId], detail: "The exact planning conflict remains unresolved." })),
    ],
  });
  if (!synthesis.studyId || synthesis.executorReceipt.producer.authorship !== "active_root_executor_tool_call") throw new Error("study synthesis did not close");
  }
}
let childFinal = null;
if (!isRoot) {
  const worker = JSON.parse(prompt.split("\\n\\n").at(-1));
  const workerGeneralized = worker.requiredOutputs[0].artifactKind === "studio.study-report.v2";
  const scope = worker.grantedSemanticEvidence[0];
  const marker = "AUTHENTICATED PRECOMPLETED SPEECH RESULT: ";
  const precompletedLine = prompt.split("\\n\\n").find((entry) => entry.startsWith(marker));
  let evidence;
  if (precompletedLine) {
    if (args.some((arg) => arg.includes("mcp_servers.studio_semantic"))) throw new Error("precompleted speech remained exposed as an MCP tool");
    evidence = JSON.parse(precompletedLine.slice(marker.length));
  } else {
    const response = await fetch(process.env.STUDIO_CHILD_SEMANTIC_EVIDENCE_BRIDGE_URL + "/v1/call", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + process.env.STUDIO_CHILD_SEMANTIC_EVIDENCE_BRIDGE_TOKEN,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name: "speech_transcribe", arguments: scope }),
    });
    const body = await response.json();
    if (!response.ok || body.ok !== true) throw new Error("semantic evidence bridge rejected child call: " + JSON.stringify(body));
    evidence = body.result;
  }
  const input = {
    operationId: evidence.operationId,
    artifactId: evidence.artifact.artifactId,
    contentId: evidence.artifact.contentId,
    receiptId: evidence.receipt.receiptId,
    receiptContentId: evidence.receipt.contentId,
    observations: evidence.observations.map((observation) => ({
      observationId: observation.observationId,
      startMs: observation.range.startMs,
      endMs: observation.range.endMs,
    })),
  };
  const code = evidence.availability.state === "empty"
    ? "semantic_evidence_empty"
    : evidence.availability.state === "unavailable"
      ? "semantic_evidence_unavailable"
      : "insufficient_semantic_evidence";
  childFinal = {
    summary: "The child returned a closed coverage partition; correctness and semantic quality were not assessed.",
    ...(precompletedLine ? {} : { semanticEvidenceInputs: [input] }),
    outputs: [{
      name: "coverage study",
      kind: workerGeneralized ? "studio.study-report.v2" : "studio.study-report.v1",
      coverage: workerGeneralized
        ? [{ ...scope, claimIds: [], reason: null }]
        : [{ ...scope, state: "unknown", claimIds: [], reason: { code, detail: "The current-run semantic input did not establish supported coverage." } }],
      claims: [],
    }],
  };
}
const final = isRoot
  ? { outcome: "completed", reason: "The model-authored two-child fan-out reached a closed terminal wait." }
  : childFinal;
process.stdout.write(JSON.stringify({ type: "thread.started", thread_id: isRoot ? "thread:root" : "thread:child" }) + "\\n");
process.stdout.write(JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: JSON.stringify(final) } }) + "\\n");
process.stdout.write(JSON.stringify({
  type: "turn.completed",
  usage: { input_tokens: 50, cached_input_tokens: 0, output_tokens: 20, reasoning_output_tokens: 5 },
  proof: isRoot ? "root" : "child",
}) + "\\n");
`, { encoding: "utf8", mode: 0o700 });
  return { executable: process.execPath, prefix: [script] };
}

test("Codex root launcher exposes the closed planning/synthesis tools and receipts model-authored fan-out through study synthesis", async () => {
  const directory = await mkdtemp(join(tmpdir(), "studio-orchestrator-executor-"));
  try {
    const loadedSource = await loadOwnedSourceSession(resolve("public/demo/runs/run-005"));
    const analysisRequest = createProductionAnalysisRequest(loadedSource.session, {
      range: { startMs: 0, endMs: 2_000 },
      requestedSource: { mode: "declared", languages: ["ko"], reason: null },
      targetLanguage: "en",
      selectedLanguagePackId: "ko-v3",
      outputDepth: "evidence",
    });
    const runtimeRoot = join(directory, "runtime");
    await writeFile(join(directory, ".keep"), "", { flag: "wx" });
    const initialized = await initializeRuntimeApplication({
      runtimeRoot,
      journalPath: join(runtimeRoot, "events.ndjson"),
      artifactStoreRoot: join(runtimeRoot, "artifact-store"),
      runStartPath: join(runtimeRoot, "run-start.json"),
      runtimeId: "runtime:orchestrator-executor-contract",
      journalId: "journal:orchestrator-executor-contract",
      acceptedBy: "operator:test",
      startedAt: "2026-07-16T12:00:00.000Z",
      loadedSource,
      analysisRequest,
    });
    const fake = await fakeCodex(directory);
    const model = "owned-swarm-test-model";
    await runBoundedRuntimeApplication(
      initialized,
      codexWorkerLauncherFactory({
        executable: fake.executable,
        executableArgsPrefix: fake.prefix,
        model,
        maximumWallMs: 20_000,
        semanticRecognizer: currentRunRecognizer(),
        preexecuteRequiredSemanticEvidence: true,
      }),
      codexOrchestratorLauncherFactory({
        executable: fake.executable,
        executableArgsPrefix: fake.prefix,
        model,
        maximumWallMs: 20_000,
      }),
      "v1",
    );
    const ledger = await RuntimeLedger.open(
      initialized.runStart.runtimeId,
      new FileEventJournal(initialized.journalPath),
    );
    const state = ledger.state();
    const root = Object.values(state.tasks).find((task) => task.parentTaskId === null)!;
    const rootExecution = Object.values(state.executions).find((execution) => execution.taskId === root.id)!;
    assert.equal(rootExecution.receipt?.producer.id, "codex.exec");
    assert.equal(state.modelUsage[rootExecution.modelUsageReceiptId!].model, model);
    assert.deepEqual(
      Object.values(state.spawnRequests).map((request) => request.input.workloadKey).sort(),
      ["model-child:left", "model-child:right"],
    );
    assert.ok(Object.values(state.spawnRequests).every((request) =>
      request.authoredByExecutionId === rootExecution.id && request.toolCallId !== null));
    assert.equal(Object.values(state.reportWaits).filter((wait) => wait.executionId === rootExecution.id).length, 1);
    assert.equal(Object.values(state.tasks).filter((task) => task.parentTaskId === root.id).length, 2);
    assert.equal(Object.keys(state.taskLaunches).length, 3);
    assert.equal(Object.keys(state.reports).length, 2);
    assert.ok(Object.values(state.reports).every((report) => report.study?.output.schema === "studio.study-report.v1"));
    assert.equal(Object.keys(state.parentArtifactDispositions).length, 2);
    assert.equal(Object.keys(state.parentArtifactReadGrants).length, 2);
    assert.equal(Object.values(state.semanticEvidence).length, 2);
    assert.ok(Object.values(state.semanticEvidence).every((evidence) =>
      evidence.availability?.state === "available"));
    assert.equal(Object.keys(state.studyPlanningDecisions).length, 1);
    assert.equal(Object.keys(state.ownedMediaStudies).length, 1);
    assert.equal(Object.keys(state.studyReadiness).length, 1);
    assert.equal(Object.values(state.studyReadiness)[0].outcome, "withheld");
    assert.equal(Object.values(state.publishReviewIntakes)[0].outcome, "rejected");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("default Codex launcher closes the eight-tool research-aware report-to-readiness spine", async () => {
  const directory = await mkdtemp(join(tmpdir(), "studio-orchestrator-u3-default-"));
  try {
    const loadedSource = await loadOwnedSourceSession(resolve("public/demo/runs/run-005"));
    const analysisRequest = createProductionAnalysisRequest(loadedSource.session, {
      range: { startMs: 0, endMs: 2_000 },
      requestedSource: { mode: "declared", languages: ["ko"], reason: null },
      targetLanguage: "en",
      selectedLanguagePackId: "ko-v3",
      outputDepth: "evidence",
    });
    const runtimeRoot = join(directory, "runtime");
    const initialized = await initializeRuntimeApplication({
      runtimeRoot,
      journalPath: join(runtimeRoot, "events.ndjson"),
      artifactStoreRoot: join(runtimeRoot, "artifact-store"),
      runStartPath: join(runtimeRoot, "run-start.json"),
      runtimeId: "runtime:orchestrator-u3-default-contract",
      journalId: "journal:orchestrator-u3-default-contract",
      acceptedBy: "operator:test",
      startedAt: "2026-07-16T12:00:00.000Z",
      loadedSource,
      analysisRequest,
    });
    const fake = await fakeCodex(directory, "repeat-generalized-read");
    const model = "owned-swarm-test-model";
    await runBoundedRuntimeApplication(
      initialized,
      codexWorkerLauncherFactory({ executable: fake.executable, executableArgsPrefix: fake.prefix, model, maximumWallMs: 20_000 }),
      codexOrchestratorLauncherFactory({ executable: fake.executable, executableArgsPrefix: fake.prefix, model, maximumWallMs: 20_000 }),
    );
    const state = (await RuntimeLedger.open(initialized.runStart.runtimeId, new FileEventJournal(initialized.journalPath))).state();
    const root = Object.values(state.tasks).find((task) => task.parentTaskId === null)!;
    const children = Object.values(state.tasks).filter((task) => task.parentTaskId === root.id);
    assert.deepEqual(root.budget, GENERALIZED_ROOT_BUDGET);
    assert.ok(children.every((task) => task.budget.wallMs === GENERALIZED_INITIAL_COVERAGE_BUDGET.wallMs));
    assert.deepEqual(PROOF_RUNTIME_LIMITS.runBudget, GENERALIZED_RUN_BUDGET);
    assert.equal(GENERALIZED_BASELINE_RUN_BUDGET.wallMs, 1_220_000);
    assert.equal(GENERALIZED_RECOVERY_CONTINGENCY_BUDGET.wallMs, 480_000);
    assert.equal(GENERALIZED_RUN_BUDGET.wallMs, 1_700_000);
    assert.deepEqual(root.requiredOutputs, [{ name: "owned-media study", artifactKind: "studio.owned-media-study.v3", required: true }]);
    assert.equal(root.grants.some((grant) => grant.capability === "study.plan"), false);
    assert.equal(root.grants.some((grant) => grant.capability === "study.restudy"), true);
    assert.equal(root.grants.some((grant) => grant.capability === "study.separate"), true);
    assert.equal(Object.values(state.reports).filter((report) => report.study?.schema === "studio.study-report-submission.v2").length, 2);
    assert.equal(Object.keys(state.generalizedParentArtifactAdmissions).length, 2);
    assert.equal(Object.keys(state.generalizedParentArtifactReads).length, 2);
    assert.equal(Object.values(state.orchestratorToolCalls).filter((call) => call.tool === "artifact_read").length, 2);
    assert.equal(Object.values(state.orchestratorToolCalls).filter((call) => call.tool === "study_synthesize").length, 1);
    assert.ok(Object.values(state.researchRequestInputs).some((input) => input.triggers.length === 0));
    assert.equal(Object.keys(state.generalizedOwnedMediaStudies).length, 1);
    assert.equal(Object.keys(state.generalizedStudyReadiness).length, 1);
    assert.equal(Object.values(state.generalizedOwnedMediaStudies)[0].schema, "studio.owned-media-study.v3");
    assert.equal(Object.values(state.generalizedStudyReadiness)[0].schema, "studio.study-readiness.receipt.v4");
    assert.equal(Object.keys(state.parentArtifactDispositions).length, 0);
    assert.equal(Object.keys(state.ownedMediaStudies).length, 0);
    assert.equal(Object.keys(state.studyPlanningDecisions).length, 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("generalized Codex launcher rejects an initial coverage budget below the shared 240s contract", async () => {
  const directory = await mkdtemp(join(tmpdir(), "studio-orchestrator-budget-contract-"));
  try {
    const loadedSource = await loadOwnedSourceSession(resolve("public/demo/runs/run-005"));
    const analysisRequest = createProductionAnalysisRequest(loadedSource.session, {
      range: { startMs: 0, endMs: 2_000 },
      requestedSource: { mode: "declared", languages: ["ko"], reason: null },
      targetLanguage: "en",
      selectedLanguagePackId: "ko-v3",
      outputDepth: "evidence",
    });
    const runtimeRoot = join(directory, "runtime");
    const initialized = await initializeRuntimeApplication({
      runtimeRoot,
      journalPath: join(runtimeRoot, "events.ndjson"),
      artifactStoreRoot: join(runtimeRoot, "artifact-store"),
      runStartPath: join(runtimeRoot, "run-start.json"),
      runtimeId: "runtime:orchestrator-budget-contract",
      journalId: "journal:orchestrator-budget-contract",
      acceptedBy: "operator:test",
      startedAt: "2026-07-16T12:00:00.000Z",
      loadedSource,
      analysisRequest,
    });
    const fake = await fakeCodex(directory, "wrong-generalized-budget");
    const model = "owned-swarm-test-model";
    await assert.rejects(
      runBoundedRuntimeApplication(
        initialized,
        codexWorkerLauncherFactory({ executable: fake.executable, executableArgsPrefix: fake.prefix, model, maximumWallMs: 20_000 }),
        codexOrchestratorLauncherFactory({ executable: fake.executable, executableArgsPrefix: fake.prefix, model, maximumWallMs: 20_000 }),
      ),
      /changed the coverage-study child contract/,
    );
    const state = (await RuntimeLedger.open(initialized.runStart.runtimeId, new FileEventJournal(initialized.journalPath))).state();
    const root = Object.values(state.tasks).find((task) => task.parentTaskId === null)!;
    assert.equal(root.status, "failed");
    assert.ok(Object.values(state.spawnRequests).every((request) => request.input.budget.wallMs === 180_000));
    assert.equal(Object.keys(state.orchestratorDecisions).length, 0);
    assert.equal(Object.keys(state.generalizedStudyReadiness).length, 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("model-root timeout records a timed-out executor and creates no planning, study, or readiness authority", async () => {
  const directory = await mkdtemp(join(tmpdir(), "studio-orchestrator-timeout-"));
  try {
    const loadedSource = await loadOwnedSourceSession(resolve("public/demo/runs/run-005"));
    const analysisRequest = createProductionAnalysisRequest(loadedSource.session, {
      range: { startMs: 0, endMs: 1_000 },
      requestedSource: { mode: "declared", languages: ["ko"], reason: null },
      targetLanguage: "en",
      selectedLanguagePackId: "ko-v3",
      outputDepth: "evidence",
    });
    const runtimeRoot = join(directory, "runtime");
    const initialized = await initializeRuntimeApplication({
      runtimeRoot,
      journalPath: join(runtimeRoot, "events.ndjson"),
      artifactStoreRoot: join(runtimeRoot, "artifact-store"),
      runStartPath: join(runtimeRoot, "run-start.json"),
      runtimeId: "runtime:orchestrator-model-timeout-contract",
      journalId: "journal:orchestrator-model-timeout-contract",
      acceptedBy: "operator:test",
      startedAt: "2026-07-16T12:00:00.000Z",
      loadedSource,
      analysisRequest,
    });
    const fake = await fakeCodex(directory, "hang-root");
    await assert.rejects(runBoundedRuntimeApplication(
      initialized,
      codexWorkerLauncherFactory({ executable: fake.executable, executableArgsPrefix: fake.prefix, model: "owned-swarm-test-model", maximumWallMs: 100 }),
      codexOrchestratorLauncherFactory({ executable: fake.executable, executableArgsPrefix: fake.prefix, model: "owned-swarm-test-model", maximumWallMs: 100 }),
      "v1",
    ), /timed out/i);
    const state = (await RuntimeLedger.open(initialized.runStart.runtimeId, new FileEventJournal(initialized.journalPath))).state();
    const root = Object.values(state.tasks).find((task) => task.parentTaskId === null)!;
    const execution = Object.values(state.executions).find((candidate) => candidate.taskId === root.id)!;
    assert.equal(execution.status, "timed_out");
    assert.equal(root.status, "failed");
    assert.equal(Object.keys(state.studyPlanningDecisions).length, 0);
    assert.equal(Object.keys(state.ownedMediaStudies).length, 0);
    assert.equal(Object.keys(state.studyReadiness).length, 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
