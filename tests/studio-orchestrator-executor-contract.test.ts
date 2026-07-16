import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import { FileEventJournal, RuntimeLedger } from "../src/studio/runtime/production/journal.ts";
import { createProductionAnalysisRequest } from "../src/studio/runtime/production/runStart/analysisRequest.ts";
import { loadOwnedSourceSession } from "../src/studio/runtime/production/runStart/sourceSessionLoader.ts";
import {
  codexOrchestratorLauncherFactory,
  codexWorkerLauncherFactory,
  initializeRuntimeApplication,
  runBoundedRuntimeApplication,
} from "../src/studio/runtime/production/runtimeHost/runtimeApplication.ts";

async function fakeCodex(directory: string): Promise<{ executable: string; prefix: string[] }> {
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
  if (!prompt.includes("exactly two closed, path-free tools") || !prompt.includes("jobContext")) {
    throw new Error("closed root prompt contract is missing");
  }
  const root = JSON.parse(prompt.split("\\n\\n").at(-1));
  const call = async (name, argumentsValue) => {
    const response = await fetch(process.env.STUDIO_ORCHESTRATOR_BRIDGE_URL + "/v1/call", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + process.env.STUDIO_ORCHESTRATOR_BRIDGE_TOKEN,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name, arguments: argumentsValue }),
    });
    const body = await response.json();
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
    requiredOutputs: [{ name: "coverage study", artifactKind: "studio.study-report.v1", required: true }],
    requiredCapabilities: ["speech.transcribe", "report.submit"],
    dependencyWorkloadKeys: [],
    budget: { wallMs: 10000, toolCalls: 2 },
  });
  const midpoint = Math.floor((root.mediaScope[0].startMs + root.mediaScope[0].endMs) / 2);
  const left = await call("task_spawn_request", child("left", root.mediaScope[0].startMs, midpoint));
  const right = await call("task_spawn_request", child("right", midpoint, root.mediaScope[0].endMs));
  if (left.decision !== "accepted" || right.decision !== "accepted") throw new Error("fan-out was not accepted");
  const waited = await call("task_reports_wait", {});
  if (waited.result !== "all_terminal" || waited.children.length !== 2) throw new Error("wait did not return two terminal children");
}
let childFinal = null;
if (!isRoot) {
  const worker = JSON.parse(prompt.split("\\n\\n").at(-1));
  const scope = worker.grantedSemanticEvidence[0];
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
  const evidence = body.result;
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
    semanticEvidenceInputs: [input],
    outputs: [{
      name: "coverage study",
      kind: "studio.study-report.v1",
      coverage: [{ ...scope, state: "unknown", claimIds: [], reason: { code, detail: "The current-run semantic input did not establish supported coverage." } }],
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

test("Codex root launcher exposes only two closed tools and receipts model-authored fan-out with explicit model usage", async () => {
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
      }),
      codexOrchestratorLauncherFactory({
        executable: fake.executable,
        executableArgsPrefix: fake.prefix,
        model,
        maximumWallMs: 20_000,
      }),
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
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
