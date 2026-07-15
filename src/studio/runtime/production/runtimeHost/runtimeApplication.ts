import { open } from "node:fs/promises";

import { ContentAddressedArtifactStore } from "../artifactStore.ts";
import { FileEventJournal, RuntimeLedger } from "../journal.ts";
import { FfmpegCapabilityHost } from "../mediaHost.ts";
import {
  CodexExecWorkerLauncher,
  type CodexWorkerLauncherOptions,
} from "../launcher.ts";
import type {
  LaunchPermit,
  ProductionAnalysisRequest,
  ReportRecord,
  RuntimeLimits,
  SpawnRequestInput,
} from "../model.ts";
import { BoundedReportHost } from "../reportHost.ts";
import { createRuntimeStart } from "../runStart/runtimeStart.ts";
import { writeRuntimeStartReceipt } from "../runStart/receiptWriter.ts";
import { BoundedRuntimeScheduler } from "../scheduler.ts";
import type { LoadedOwnedSourceSession } from "../runStart/sourceSessionLoader.ts";
import type { InitializedRuntimeApplication } from "./model.ts";

export const PROOF_RUNTIME_LIMITS: RuntimeLimits = {
  maxDepth: 1,
  maxActiveWorkers: 2,
  runBudget: { wallMs: 120_000, toolCalls: 4 },
  grantableCapabilities: ["task.spawn.request", "report.submit", "media.extract", "media.seek"],
};

export class RuntimeApplicationInterrupted extends Error {
  constructor(message = "The bounded runtime execution was interrupted without terminal evidence.") {
    super(message);
    this.name = "RuntimeApplicationInterrupted";
  }
}

export interface BoundedWorkerLauncher {
  launch(permit: LaunchPermit): Promise<{ report: ReportRecord }>;
}

export interface BoundedWorkerLauncherContext {
  ledger: RuntimeLedger;
  scheduler: BoundedRuntimeScheduler;
  artifacts: ContentAddressedArtifactStore;
  reports: BoundedReportHost;
  mediaHost: FfmpegCapabilityHost;
  plannedMediaOperationId: string;
}

export type BoundedWorkerLauncherFactory = (
  context: BoundedWorkerLauncherContext,
) => BoundedWorkerLauncher;

export function codexWorkerLauncherFactory(
  options: CodexWorkerLauncherOptions = {},
): BoundedWorkerLauncherFactory {
  return ({ ledger, scheduler, artifacts, reports, mediaHost, plannedMediaOperationId }) =>
    new CodexExecWorkerLauncher(ledger, scheduler, artifacts, reports, {
      ...options,
      mediaHost: options.mediaHost ?? mediaHost,
      nextMediaOperationId: options.nextMediaOperationId ?? (() => plannedMediaOperationId),
    });
}

export interface InitializeRuntimeApplicationInput {
  runtimeRoot: string;
  journalPath: string;
  artifactStoreRoot: string;
  runStartPath: string;
  runtimeId: string;
  journalId: string;
  acceptedBy: string;
  startedAt: string;
  loadedSource: LoadedOwnedSourceSession;
  analysisRequest: ProductionAnalysisRequest;
}

/**
 * Persist the immutable source copy and adjacent run-start receipt before creating the empty
 * production journal. All paths are trusted host-owned inputs.
 */
export async function initializeRuntimeApplication(
  input: InitializeRuntimeApplicationInput,
): Promise<InitializedRuntimeApplication> {
  const artifacts = new ContentAddressedArtifactStore(input.artifactStoreRoot);
  const sourceArtifact = await artifacts.registerSource(input.runtimeId, input.loadedSource.descriptor);
  const runStart = createRuntimeStart({
    runId: input.runtimeId,
    journalId: input.journalId,
    acceptedBy: input.acceptedBy,
    startedAt: input.startedAt,
    sourceSession: input.loadedSource.session,
    sourceArtifactId: sourceArtifact.id,
    analysisRequest: input.analysisRequest,
  });
  await writeRuntimeStartReceipt(input.runStartPath, runStart);
  const journal = await open(input.journalPath, "wx", 0o600);
  try {
    await journal.sync();
  } finally {
    await journal.close();
  }
  return {
    runtimeRoot: input.runtimeRoot,
    journalPath: input.journalPath,
    artifactStoreRoot: input.artifactStoreRoot,
    runStartPath: input.runStartPath,
    runStart,
    sourceArtifact,
    sourceSession: structuredClone(input.loadedSource.session),
  };
}

function childInput(
  runtimeId: string,
  request: ProductionAnalysisRequest,
  sourceArtifactId: string,
  mediaScope: SpawnRequestInput["mediaScope"],
): SpawnRequestInput {
  return {
    workloadKey: `bounded-media-seek:${runtimeId}`,
    objective:
      `Invoke media_seek exactly once for the granted source range for ${request.requestId}, ` +
      "retain the returned operation/artifact/receipt identities, and report them without making " +
      "media-content, transcription, translation, caption, or detector claims.",
    workerKind: "media",
    workerLabel: "bounded-media-child",
    mediaScope,
    inputArtifactIds: [sourceArtifactId],
    requiredOutputs: [
      { name: "execution report", artifactKind: "worker-execution-report", required: true },
    ],
    requiredCapabilities: ["media.seek", "report.submit"],
    dependencies: [],
    budget: { wallMs: 45_000, toolCalls: 1 },
  };
}

function safeChildFailure(error: unknown): string {
  if (error instanceof RuntimeApplicationInterrupted) return error.message;
  return "The bounded child did not produce a terminal accepted report.";
}

/** Shared application-level one-child composition used by both CLI and runtime host. */
export async function runBoundedRuntimeApplication(
  initialized: InitializedRuntimeApplication,
  launcherFactory: BoundedWorkerLauncherFactory,
): Promise<void> {
  const journal = new FileEventJournal(initialized.journalPath);
  const ledger = await RuntimeLedger.open(initialized.runStart.runtimeId, journal);
  if ((await ledger.events()).length !== 0) {
    throw new Error("Bounded runtime application requires a new empty production journal");
  }
  const artifacts = new ContentAddressedArtifactStore(initialized.artifactStoreRoot);
  await artifacts.record(ledger, initialized.sourceArtifact);
  const audioTrack = initialized.sourceArtifact.tracks.find((track) => track.kind === "audio");
  if (!audioTrack) throw new Error("Bounded runtime application requires one registered audio track");
  const mediaScope = [{
    artifactId: initialized.sourceArtifact.id,
    trackId: audioTrack.id,
    startMs: initialized.runStart.analysisRequest.range.startMs,
    endMs: initialized.runStart.analysisRequest.range.endMs,
  }];
  const scheduler = new BoundedRuntimeScheduler(ledger, PROOF_RUNTIME_LIMITS);
  const rootPermit = await scheduler.createRoot({
    workloadKey: `root:${initialized.runStart.runtimeId}`,
    objective:
      `Coordinate one bounded local worker launch for ${initialized.runStart.analysisRequest.requestId} ` +
      "with one receipted bounded seek and without making media-content claims.",
    workerKind: "orchestrator",
    workerLabel: "local-orchestrator",
    mediaScope,
    inputArtifactIds: [initialized.sourceArtifact.id],
    requiredOutputs: [{ name: "run report", artifactKind: "run-report", required: true }],
    requiredCapabilities: ["task.spawn.request"],
    dependencies: [],
    budget: { wallMs: 60_000, toolCalls: 2 },
  });
  await scheduler.registerAgent(rootPermit);
  await scheduler.transitionTask(rootPermit.taskId, rootPermit.agentId, "working");

  const decision = await scheduler.requestSpawn(
    rootPermit.taskId,
    rootPermit.agentId,
    childInput(
      initialized.runStart.runtimeId,
      initialized.runStart.analysisRequest,
      initialized.sourceArtifact.id,
      mediaScope,
    ),
  );
  if (!decision.permit) {
    await scheduler.transitionTask(
      rootPermit.taskId,
      rootPermit.agentId,
      "failed",
      "The bounded proof child was rejected by scheduler policy.",
    );
    throw new Error(`Bounded proof child was rejected: ${decision.rejection ?? "unknown"}`);
  }

  const reports = new BoundedReportHost(ledger);
  const mediaHost = new FfmpegCapabilityHost(ledger, artifacts);
  const plannedOperation = initialized.runStart.workPlan.operations[0];
  if (
    initialized.runStart.workPlan.operations.length !== 1 ||
    plannedOperation.kind !== "media.seek" ||
    plannedOperation.range.startMs !== mediaScope[0].startMs ||
    plannedOperation.range.endMs !== mediaScope[0].endMs
  ) {
    throw new Error("Bounded runtime application requires one exact planned media.seek operation");
  }
  const launcher = launcherFactory({
    ledger,
    scheduler,
    artifacts,
    reports,
    mediaHost,
    plannedMediaOperationId: plannedOperation.operationId,
  });
  try {
    const launched = await launcher.launch(decision.permit);
    await reports.decide({
      reportId: launched.report.id,
      decidedByTaskId: rootPermit.taskId,
      decidedByAgentId: rootPermit.agentId,
      accepted: true,
      reason: "The bounded child returned its structured artifact after one authorized receipted seek.",
    });
    await scheduler.transitionTask(
      rootPermit.taskId,
      rootPermit.agentId,
      "withheld",
      "The local launcher proof ended after one receipted seek observation and child report; it produced no captions or study result.",
    );
  } catch (error) {
    if (error instanceof RuntimeApplicationInterrupted) throw error;
    const root = ledger.state().tasks[rootPermit.taskId];
    if (root?.status === "working") {
      await scheduler.transitionTask(rootPermit.taskId, rootPermit.agentId, "failed", safeChildFailure(error));
    }
    throw error;
  }
}
