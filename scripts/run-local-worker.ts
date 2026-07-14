import { mkdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { ContentAddressedArtifactStore } from "../src/studio/runtime/production/artifactStore.ts";
import { FileEventJournal, RuntimeLedger } from "../src/studio/runtime/production/journal.ts";
import { CodexExecWorkerLauncher } from "../src/studio/runtime/production/launcher.ts";
import type {
  RuntimeLimits,
  SourceArtifactDescriptor,
  SpawnRequestInput,
} from "../src/studio/runtime/production/model.ts";
import { BoundedReportHost } from "../src/studio/runtime/production/reportHost.ts";
import { BoundedRuntimeScheduler } from "../src/studio/runtime/production/scheduler.ts";

const REPOSITORY = resolve(import.meta.dirname, "..");
const SOURCE_FIXTURE = join(REPOSITORY, "public/demo/runs/run-005");

function argument(name: string): string | null {
  const index = process.argv.indexOf(name);
  if (index === -1) return null;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`);
  return value;
}

async function sourceDescriptor(): Promise<SourceArtifactDescriptor> {
  const source = JSON.parse(await readFile(join(SOURCE_FIXTURE, "source.json"), "utf8")) as {
    receipt_id: string;
    content: { hash: { digest: string }; id: string; bytes: number };
  };
  const probe = JSON.parse(await readFile(join(SOURCE_FIXTURE, "media-probe.json"), "utf8")) as {
    duration: number;
    tracks: Array<{ index: number; type: "audio"; codec: string; duration: number }>;
  };
  return {
    schema: "studio.source-artifact.v1",
    adapterId: "owned-local-source-adapter.v1",
    sourceReceiptRef: source.receipt_id,
    publication: "public",
    path: join(SOURCE_FIXTURE, "clip.m4a"),
    content: {
      algorithm: "sha256",
      digest: source.content.hash.digest,
      contentId: source.content.id,
      bytes: source.content.bytes,
    },
    durationMs: Math.round(probe.duration * 1_000),
    tracks: probe.tracks.map((track) => ({
      id: `stream:${track.index}`,
      index: track.index,
      kind: track.type,
      codec: track.codec,
      durationMs: Math.round(track.duration * 1_000),
    })),
  };
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
await mkdir(parent, { recursive: true, mode: 0o700 });
await mkdir(runRoot, { recursive: false });

const store = new ContentAddressedArtifactStore(join(runRoot, "artifact-store"));
const source = await store.registerSource(runId, await sourceDescriptor());
const journalPath = join(runRoot, "events.ndjson");
const ledger = await RuntimeLedger.open(runId, new FileEventJournal(journalPath));
await store.record(ledger, source);
const scheduler = new BoundedRuntimeScheduler(ledger, limits);
const rootPermit = await scheduler.createRoot({
  workloadKey: `root:${runId}`,
  objective: "Coordinate one bounded local worker launch without making media-content claims.",
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
    "Return an honest acknowledgement of this bounded child contract. Do not claim media inspection, translation, or detector work.",
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
      artifactStore: join(runRoot, "artifact-store"),
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
      note: "Local production journal only; not a recorded Studio demo run.",
    },
    null,
    2,
  )}\n`,
);
