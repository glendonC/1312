import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";

import { ContentAddressedArtifactStore } from "../src/studio/runtime/production/artifactStore.ts";
import { FileEventJournal, RuntimeLedger } from "../src/studio/runtime/production/journal.ts";
import { CodexExecWorkerLauncher } from "../src/studio/runtime/production/launcher.ts";
import type {
  RequestedSourceLanguage,
  RuntimeLimits,
  SpawnRequestInput,
} from "../src/studio/runtime/production/model.ts";
import { BoundedReportHost } from "../src/studio/runtime/production/reportHost.ts";
import {
  createProductionAnalysisRequest,
  createRuntimeStart,
  loadOwnedSourceSession,
  writeRuntimeStartReceipt,
} from "../src/studio/runtime/production/runStart.ts";
import { BoundedRuntimeScheduler } from "../src/studio/runtime/production/scheduler.ts";

const REPOSITORY = resolve(import.meta.dirname, "..");

function argument(name: string): string | null {
  const index = process.argv.indexOf(name);
  if (index === -1) return null;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`);
  return value;
}

function requiredArgument(name: string): string {
  const value = argument(name);
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function integerArgument(name: string, fallback: number): number {
  const value = argument(name);
  if (value === null) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`${name} must be a non-negative integer`);
  return parsed;
}

function requestedSourceLanguage(): RequestedSourceLanguage {
  const mode = requiredArgument("--source-language-mode");
  if (mode === "declared") {
    return { mode, languages: [requiredArgument("--source-language")], reason: null };
  }
  if (mode === "mixed") {
    const languages = requiredArgument("--source-languages").split(",").map((value) => value.trim()).filter(Boolean);
    if (languages.length < 2) throw new Error("--source-languages must name at least two comma-separated languages");
    return { mode, languages: languages as [string, string, ...string[]], reason: null };
  }
  if (mode === "automatic" || mode === "unknown") return { mode, languages: [], reason: null };
  if (mode === "withheld") {
    return { mode, languages: [], reason: requiredArgument("--source-language-reason") };
  }
  throw new Error("--source-language-mode must be declared, automatic, mixed, unknown, or withheld");
}

const limits: RuntimeLimits = {
  maxDepth: 1,
  maxActiveWorkers: 2,
  runBudget: { wallMs: 120_000, toolCalls: 4 },
  grantableCapabilities: ["task.spawn.request", "report.submit"],
};

const runId = `runtime-local-${new Date().toISOString().replace(/[:.]/g, "-")}-${process.pid}`;
const parent = resolve(argument("--output-root") ?? join(REPOSITORY, ".studio/runtime-workers"));
const runRoot = join(parent, runId);
const loadedSource = await loadOwnedSourceSession(resolve(requiredArgument("--source-directory")));
const rangeStartMs = integerArgument("--range-start-ms", 0);
const rangeEndMs = integerArgument("--range-end-ms", loadedSource.session.source.durationMs);
const outputDepth = argument("--output-depth") ?? "evidence";
if (outputDepth !== "captions" && outputDepth !== "evidence") {
  throw new Error("--output-depth must be captions or evidence");
}
const analysisRequest = createProductionAnalysisRequest(loadedSource.session, {
  range: { startMs: rangeStartMs, endMs: rangeEndMs },
  requestedSource: requestedSourceLanguage(),
  targetLanguage: requiredArgument("--target-language"),
  selectedLanguagePackId: argument("--language-pack"),
  outputDepth,
});
await mkdir(parent, { recursive: true, mode: 0o700 });
await mkdir(runRoot, { recursive: false });

const store = new ContentAddressedArtifactStore(join(runRoot, "artifact-store"));
const source = await store.registerSource(runId, loadedSource.descriptor);
const journalPath = join(runRoot, "events.ndjson");
const startedAt = new Date().toISOString();
const runStart = createRuntimeStart({
  runId,
  journalId: `journal:${runId}`,
  acceptedBy: argument("--accepted-by") ?? "operator:local-cli",
  startedAt,
  sourceSession: loadedSource.session,
  sourceArtifactId: source.id,
  analysisRequest,
});
const runStartPath = join(runRoot, "run-start.json");
const runStartContent = await writeRuntimeStartReceipt(runStartPath, runStart);
const ledger = await RuntimeLedger.open(runId, new FileEventJournal(journalPath));
await store.record(ledger, source);
const scheduler = new BoundedRuntimeScheduler(ledger, limits);
const rootPermit = await scheduler.createRoot({
  workloadKey: `root:${runId}`,
  objective: `Coordinate one bounded local worker launch for ${analysisRequest.requestId} without making media-content claims.`,
  workerKind: "orchestrator",
  workerLabel: "local-orchestrator",
  mediaScope: [],
  inputArtifactIds: [source.id],
  requiredOutputs: [{ name: "run report", artifactKind: "run-report", required: true }],
  requiredCapabilities: ["task.spawn.request"],
  dependencies: [],
  budget: { wallMs: 60_000, toolCalls: 2 },
});
await scheduler.registerAgent(rootPermit);
await scheduler.transitionTask(rootPermit.taskId, rootPermit.agentId, "working");

const child: SpawnRequestInput = {
  workloadKey: `bounded-acknowledgement:${runId}`,
  objective:
    `Return an honest acknowledgement of ${analysisRequest.requestId}. Do not claim media inspection, transcription, translation, captions, or detector work.`,
  workerKind: "analysis",
  workerLabel: "codex-bounded-child",
  mediaScope: [],
  inputArtifactIds: [source.id],
  requiredOutputs: [{ name: "execution report", artifactKind: "worker-execution-report", required: true }],
  requiredCapabilities: ["report.submit"],
  dependencies: [],
  budget: { wallMs: 45_000, toolCalls: 1 },
};
const decision = await scheduler.requestSpawn(rootPermit.taskId, rootPermit.agentId, child);
if (!decision.permit) throw new Error(`Local worker spawn was rejected: ${decision.rejection ?? "unknown"}`);

const reports = new BoundedReportHost(ledger);
const launcher = new CodexExecWorkerLauncher(ledger, scheduler, store, reports, {
  model: argument("--model"),
  maximumWallMs: 45_000,
});
const launched = await launcher.launch(decision.permit);
await reports.decide({
  reportId: launched.report.id,
  decidedByTaskId: rootPermit.taskId,
  decidedByAgentId: rootPermit.agentId,
  accepted: true,
  reason: "The bounded child returned its required structured artifact and execution receipts.",
});
await scheduler.transitionTask(
  rootPermit.taskId,
  rootPermit.agentId,
  "withheld",
  "The local launcher smoke ended after the child proof; it produced no run-level media result.",
);

const state = ledger.state();
process.stdout.write(
  `${JSON.stringify(
    {
      runId,
      journal: journalPath,
      runStartReceipt: {
        path: runStartPath,
        contentId: runStartContent.contentId,
        commandId: runStart.commandId,
      },
      artifactStore: join(runRoot, "artifact-store"),
      sourceSession: {
        id: loadedSource.session.sessionId,
        revisionId: loadedSource.session.revisionId,
        contentId: loadedSource.session.source.contentId,
      },
      analysisRequest: {
        id: analysisRequest.requestId,
        range: analysisRequest.range,
        languagePair: analysisRequest.language.languagePair,
        selectedLanguagePackId: analysisRequest.language.selectedLanguagePackId,
        detectedLanguageEvidenceContentIds: analysisRequest.language.detectedLanguageEvidenceContentIds,
        outputDepth: analysisRequest.outputDepth,
      },
      forecast: {
        id: runStart.forecast.forecastId,
        contentId: runStart.forecast.content.contentId,
        status: runStart.forecast.scenarios.baseline.status,
        requestedOperationMediaDurationMs:
          runStart.forecast.scenarios.baseline.workload.requestedOperationMediaDurationMs,
        elapsedDurationMs: null,
        apiCost: { amount: null, currency: null },
        frozenForecastId: runStart.frozenForecast.freezeId,
      },
      child: {
        taskId: decision.permit.taskId,
        agentId: decision.permit.agentId,
        status: state.tasks[decision.permit.taskId].status,
        reportId: launched.report.id,
      },
      rootStatus: state.tasks[rootPermit.taskId].status,
      execution: {
        id: launched.execution.executionId,
        outcome: launched.execution.outcome,
        activeDurationMs: launched.execution.monotonicDurationMs,
      },
      measuredUsage: launched.usage.measured,
      model: launched.usage.model,
      billing: launched.usage.billing,
      note:
        "Local production run-start receipt and production journal only; the child did not inspect media or produce captions, and nothing was added to a recorded Studio demo run.",
    },
    null,
    2,
  )}\n`,
);
