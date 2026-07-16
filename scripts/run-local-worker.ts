import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";

import { identifyFile } from "../src/studio/runtime/production/artifactStore.ts";
import { FileEventJournal, RuntimeLedger } from "../src/studio/runtime/production/journal.ts";
import type {
  RequestedSourceLanguage,
} from "../src/studio/runtime/production/model.ts";
import {
  createProductionAnalysisRequest,
  loadOwnedSourceSession,
} from "../src/studio/runtime/production/runStart.ts";
import {
  codexOrchestratorLauncherFactory,
  codexWorkerLauncherFactory,
  initializeRuntimeApplication,
  runBoundedRuntimeApplication,
} from "../src/studio/runtime/production/runtimeHost/runtimeApplication.ts";

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

const runId = `runtime-local-${new Date().toISOString().replace(/[:.]/g, "-")}-${process.pid}`;
const parent = resolve(argument("--output-root") ?? join(REPOSITORY, ".studio/runtime-workers"));
const runRoot = join(parent, runId);
const loadedSource = await loadOwnedSourceSession(resolve(requiredArgument("--source-directory")));
const rangeStartMs = integerArgument("--range-start-ms", 0);
const rangeEndMs = integerArgument("--range-end-ms", loadedSource.session.source.durationMs);
const outputDepth = argument("--output-depth") ?? "evidence";
const model = requiredArgument("--model");
const maximumWallMs = integerArgument("--maximum-wall-ms", 60_000);
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

const journalPath = join(runRoot, "events.ndjson");
const startedAt = new Date().toISOString();
const runStartPath = join(runRoot, "run-start.json");
const initialized = await initializeRuntimeApplication({
  runtimeRoot: runRoot,
  journalPath,
  artifactStoreRoot: join(runRoot, "artifact-store"),
  runStartPath,
  runtimeId: runId,
  journalId: `journal:${runId}`,
  acceptedBy: argument("--accepted-by") ?? "operator:local-cli",
  startedAt,
  loadedSource,
  analysisRequest,
});
await runBoundedRuntimeApplication(initialized, codexWorkerLauncherFactory({
  model,
  maximumWallMs: Math.min(maximumWallMs, 45_000),
}), codexOrchestratorLauncherFactory({
  model,
  maximumWallMs,
}));
const runStart = initialized.runStart;
const runStartContent = await identifyFile(runStartPath);
const ledger = await RuntimeLedger.open(runId, new FileEventJournal(journalPath));
const state = ledger.state();
const root = Object.values(state.tasks).find((task) => task.parentTaskId === null);
const child = Object.values(state.tasks).find((task) => task.parentTaskId !== null);
const execution = Object.values(state.executions)[0];
const report = Object.values(state.reports)[0];
const usage = execution?.modelUsageReceiptId ? state.modelUsage[execution.modelUsageReceiptId] : null;
if (!root || !child || !execution || !report || !usage) {
  throw new Error("Shared bounded runtime application did not produce its expected Codex proof records");
}
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
      artifactStore: initialized.artifactStoreRoot,
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
        taskId: child.id,
        agentId: child.assignedAgentId,
        status: child.status,
        reportId: report.id,
      },
      rootStatus: root.status,
      execution: {
        id: execution.id,
        outcome: execution.status,
        activeDurationMs: execution.receipt?.monotonicDurationMs ?? null,
      },
      measuredUsage: usage.measured,
      model: usage.model,
      billing: usage.billing,
      note:
        "Local production run-start receipt and production journal only; the child did not inspect media or produce captions, and nothing was added to a recorded Studio demo run.",
    },
    null,
    2,
  )}\n`,
);
