import { open } from "node:fs/promises";

import { ContentAddressedArtifactStore } from "../artifactStore.ts";
import { FileEventJournal, RuntimeLedger } from "../journal.ts";
import { FfmpegCapabilityHost } from "../mediaHost.ts";
import { BoundedEvidenceReadHost } from "../evidenceHost.ts";
import { BoundedEvidenceAssessmentHost } from "../evidenceAssessmentHost.ts";
import { BoundedEvidenceDecisionHost } from "../evidenceDecisionHost.ts";
import { SpeechTranscribeCapabilityHost } from "../semantic/semanticEvidenceHost.ts";
import {
  CodexExecWorkerLauncher,
  type CodexWorkerLauncherOptions,
} from "../launcher.ts";
import {
  CodexExecOrchestratorLauncher,
  type CodexOrchestratorLauncherOptions,
} from "../orchestratorLauncher.ts";
import type {
  LaunchPermit,
  ProductionAnalysisRequest,
  ReportRecord,
  RuntimeLimits,
} from "../model.ts";
import { BoundedReportHost } from "../study/reportHost.ts";
import { PublishReviewIntakeHost } from "../review/publishReviewIntakeHost.ts";
import { StudyReadinessHost } from "../study/studyReadinessHost.ts";
import { createRuntimeStart } from "../runStart/runtimeStart.ts";
import { writeRuntimeStartReceipt } from "../runStart/receiptWriter.ts";
import { BoundedRuntimeScheduler } from "../scheduler.ts";
import { createRootTaskJobContext } from "../jobContext.ts";
import type { LoadedOwnedSourceSession } from "../runStart/sourceSessionLoader.ts";
import type { InitializedRuntimeApplication } from "./model.ts";

export const PROOF_RUNTIME_LIMITS: RuntimeLimits = {
  maxDepth: 2,
  maxActiveWorkers: 4,
  runBudget: { wallMs: 240_000, toolCalls: 32 },
  grantableCapabilities: ["task.spawn.request", "task.reports.wait", "report.submit", "media.extract", "media.seek", "speech.transcribe", "evidence.read", "analysis.evidence.assess", "analysis.evidence.decide", "report.disposition", "artifact.read", "study.plan", "study.synthesize"],
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
  evidenceHost: BoundedEvidenceReadHost;
  assessmentHost: BoundedEvidenceAssessmentHost;
  decisionHost: BoundedEvidenceDecisionHost;
  semanticEvidenceHost: SpeechTranscribeCapabilityHost;
  plannedMediaOperationId: string;
}

export type BoundedWorkerLauncherFactory = (
  context: BoundedWorkerLauncherContext,
) => BoundedWorkerLauncher;

export interface BoundedOrchestratorLauncher {
  launch(permit: LaunchPermit): Promise<unknown>;
}

export interface BoundedOrchestratorLauncherContext extends BoundedWorkerLauncherContext {
  childLauncher: BoundedWorkerLauncher;
}

export type BoundedOrchestratorLauncherFactory = (
  context: BoundedOrchestratorLauncherContext,
) => BoundedOrchestratorLauncher;

export function codexWorkerLauncherFactory(
  options: CodexWorkerLauncherOptions = {},
): BoundedWorkerLauncherFactory {
  return ({ ledger, scheduler, artifacts, reports, mediaHost, evidenceHost, assessmentHost, decisionHost, semanticEvidenceHost, plannedMediaOperationId }) =>
    new CodexExecWorkerLauncher(ledger, scheduler, artifacts, reports, {
      ...options,
      mediaHost: options.mediaHost ?? mediaHost,
      evidenceHost: options.evidenceHost ?? evidenceHost,
      assessmentHost: options.assessmentHost ?? assessmentHost,
      decisionHost: options.decisionHost ?? decisionHost,
      semanticEvidenceHost: options.semanticEvidenceHost ?? semanticEvidenceHost,
      nextMediaOperationId: options.nextMediaOperationId ?? (() => plannedMediaOperationId),
    });
}

export function codexOrchestratorLauncherFactory(
  options: CodexOrchestratorLauncherOptions,
): BoundedOrchestratorLauncherFactory {
  return ({ ledger, scheduler, artifacts, childLauncher }) =>
    new CodexExecOrchestratorLauncher(ledger, scheduler, artifacts, childLauncher, options);
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
  const evidenceArtifacts = await Promise.all(
    input.loadedSource.evidenceDescriptors.map((descriptor) =>
      artifacts.registerPreflightEvidence(input.runtimeId, sourceArtifact.id, descriptor)),
  );
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
    evidenceArtifacts,
    sourceSession: structuredClone(input.loadedSource.session),
  };
}

function safeChildFailure(error: unknown): string {
  if (error instanceof RuntimeApplicationInterrupted) return error.message;
  return "The bounded child did not produce a terminal accepted report.";
}

/** Shared durable orchestration composition used by both CLI and runtime host. */
export async function runBoundedRuntimeApplication(
  initialized: InitializedRuntimeApplication,
  workerLauncherFactory: BoundedWorkerLauncherFactory,
  orchestratorLauncherFactory: BoundedOrchestratorLauncherFactory,
): Promise<void> {
  const journal = new FileEventJournal(initialized.journalPath);
  const ledger = await RuntimeLedger.open(initialized.runStart.runtimeId, journal);
  if ((await ledger.events()).length !== 0) {
    throw new Error("Bounded runtime application requires a new empty production journal");
  }
  const artifacts = new ContentAddressedArtifactStore(initialized.artifactStoreRoot);
  await artifacts.record(ledger, initialized.sourceArtifact);
  for (const evidenceArtifact of initialized.evidenceArtifacts) {
    await artifacts.record(ledger, evidenceArtifact);
  }
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
      `Delegate at least two bounded coverage-study tasks for ${initialized.runStart.analysisRequest.requestId}, choosing disjoint or overlapping authorized ranges yourself, then wait for every accepted child. ` +
      "Each accepted child contract must request speech.transcribe and report.submit, require exactly one studio.study-report.v1 output, partition its entire assigned scope with closed supported/withheld/unknown/failed states, and cite only current-run semantic observations for supported claims. After reading at least two model-dispositioned admissions, choose a closed plan, request causally named bounded follow-up when useful, and eventually emit one model-authored studio.owned-media-study.v1 with exact report/semantic citations and every gap/conflict preserved. Coverage and citation closure are structural facts, not correctness, understanding, agreement, truth arbitration, readiness, caption authority, quality, or publication.",
    workerKind: "orchestrator",
    workerLabel: "local-orchestrator",
    mediaScope,
    inputArtifactIds: [initialized.sourceArtifact.id, ...initialized.evidenceArtifacts.map((artifact) => artifact.id)],
    requiredOutputs: [{ name: "owned-media study", artifactKind: "studio.owned-media-study.v1", required: true }],
    requiredCapabilities: ["task.spawn.request", "task.reports.wait", "report.disposition", "artifact.read", "study.plan", "study.synthesize"],
    dependencies: [],
    // Nine calls close the minimum two-child study path; reserve bounded headroom for
    // planning/follow-up while leaving two 8-call child allocations inside the 32-call run cap.
    budget: { wallMs: 120_000, toolCalls: 16 },
  }, createRootTaskJobContext({
    sourceArtifact: initialized.sourceArtifact,
    evidenceArtifacts: initialized.evidenceArtifacts,
    analysisRequest: initialized.runStart.analysisRequest,
  }));
  const reports = new BoundedReportHost(ledger, undefined, artifacts);
  const mediaHost = new FfmpegCapabilityHost(ledger, artifacts);
  const evidenceHost = new BoundedEvidenceReadHost(ledger, artifacts);
  const assessmentHost = new BoundedEvidenceAssessmentHost(ledger, artifacts);
  const decisionHost = new BoundedEvidenceDecisionHost(ledger, artifacts);
  const semanticEvidenceHost = new SpeechTranscribeCapabilityHost(ledger, artifacts);
  const plannedOperation = initialized.runStart.workPlan.operations[0];
  if (
    initialized.runStart.workPlan.operations.length !== 1 ||
    plannedOperation.kind !== "media.seek" ||
    plannedOperation.range.startMs !== mediaScope[0].startMs ||
    plannedOperation.range.endMs !== mediaScope[0].endMs
  ) {
    throw new Error("Bounded runtime application requires one exact planned media.seek operation");
  }
  const launcherContext: BoundedWorkerLauncherContext = {
    ledger,
    scheduler,
    artifacts,
    reports,
    mediaHost,
    evidenceHost,
    assessmentHost,
    decisionHost,
    semanticEvidenceHost,
    plannedMediaOperationId: plannedOperation.operationId,
  };
  const childLauncher = workerLauncherFactory(launcherContext);
  const orchestratorLauncher = orchestratorLauncherFactory({ ...launcherContext, childLauncher });
  try {
    await orchestratorLauncher.launch(rootPermit);
    const studies = Object.values(ledger.state().ownedMediaStudies).filter((study) => study.rootTaskId === rootPermit.taskId);
    if (studies.length !== 1) throw new Error("The model root did not close exactly one owned-media study");
    const readiness = await new StudyReadinessHost(ledger, artifacts).audit(studies[0].id);
    await new PublishReviewIntakeHost(ledger, artifacts).create({
      readiness: {
        readinessId: readiness.readinessId,
        artifactId: readiness.artifactId,
        receiptId: readiness.receiptId,
        receiptContentId: readiness.receiptContentId,
      },
    });
    await scheduler.transitionTask(rootPermit.taskId, rootPermit.agentId, "completed");
  } catch (error) {
    if (error instanceof RuntimeApplicationInterrupted) throw error;
    const root = ledger.state().tasks[rootPermit.taskId];
    if (root?.status === "working" || root?.status === "waiting_for_children") {
      await scheduler.transitionTask(rootPermit.taskId, rootPermit.agentId, "failed", safeChildFailure(error));
    }
    throw error;
  }
}
