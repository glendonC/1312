import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";

import { ContentAddressedArtifactStore } from "./artifactStore.ts";
import type { RuntimeLedger } from "./journal.ts";
import type {
  ExecutorSpanReceipt,
  LaunchPermit,
  ModelUsageReceipt,
  ReportRecord,
  RuntimeArtifact,
  WorkerOutputEnvelope,
} from "./model.ts";
import type { PendingRuntimeEvent } from "./protocol.ts";
import { BoundedReportHost } from "./study/reportHost.ts";
import { BoundedRuntimeScheduler } from "./scheduler.ts";
import { FfmpegCapabilityHost } from "./mediaHost.ts";
import { BoundedFrameSamplingHost } from "./frameHost.ts";
import { BoundedEvidenceReadHost } from "./evidenceHost.ts";
import { BoundedEvidenceAssessmentHost } from "./evidenceAssessmentHost.ts";
import { BoundedEvidenceDecisionHost } from "./evidenceDecisionHost.ts";
import { SpeechTranscribeCapabilityHost } from "./semantic/semanticEvidenceHost.ts";
import { reopenSemanticEvidence, semanticEvidenceCitation } from "./semantic/semanticEvidenceAudit.ts";
import type { CurrentRunSpeechRecognizer } from "./semantic/currentRunSpeechRecognizer.ts";
import type { ChildEvidenceReadHost } from "./executor/childEvidenceBridge.ts";
import type { ChildEvidenceAssessmentHost } from "./executor/childEvidenceAssessmentBridge.ts";
import type { ChildEvidenceDecisionHost } from "./executor/childEvidenceDecisionBridge.ts";
import type { ChildMediaCapabilityHost } from "./executor/childMediaBridge.ts";
import type { ChildFrameSamplingHost } from "./executor/childFrameBridge.ts";
import type { ChildSemanticEvidenceHost } from "./executor/childSemanticEvidenceBridge.ts";
import { parseCodexEvents } from "./executor/codexEvents.ts";
import { closedCodexExecArgs } from "./executor/codexInvocation.ts";
import { LauncherFailure } from "./executor/launcherFailure.ts";
import {
  buildStudyReportEnvelope,
  validateWorkerResult,
  workerOutputSchema,
  workerPrompt,
} from "./executor/workerContract.ts";
import {
  runBoundedProcess as runProcess,
  type ProcessResult,
} from "./executor/processRunner.ts";
import {
  closeLauncherChildCapabilityBridges,
  configureLauncherChildCapabilityMcp,
  launcherChildCapabilityContext,
  launcherChildCapabilityEnvironment,
  openLauncherChildCapabilityBridges,
} from "./launcher/childCapabilityBridges.ts";
import {
  closedProcessExitReason,
  codexExecutorSpanReceipt,
  recordCodexModelUsage,
} from "./launcher/receipts.ts";

export interface CodexWorkerLaunchResult {
  execution: ExecutorSpanReceipt;
  usage: ModelUsageReceipt;
  artifacts: RuntimeArtifact[];
  report: ReportRecord;
}

export interface CodexWorkerLauncherOptions {
  executable?: string;
  /** Trusted host-only prefix used by exact launcher tests; worker input never reaches argv. */
  executableArgsPrefix?: string[];
  model?: string | null;
  temporaryRoot?: string;
  maxStdoutBytes?: number;
  maxStderrBytes?: number;
  maximumWallMs?: number;
  now?: () => Date;
  monotonicNow?: () => number;
  nextExecutionId?: () => string;
  nextMediaOperationId?: (capability: "media.extract" | "media.seek") => string;
  nextEvidenceOperationId?: () => string;
  nextAssessmentOperationId?: () => string;
  nextDecisionOperationId?: () => string;
  nextSemanticEvidenceOperationId?: () => string;
  nextFrameOperationId?: () => string;
  mediaHost?: ChildMediaCapabilityHost;
  frameHost?: ChildFrameSamplingHost;
  evidenceHost?: ChildEvidenceReadHost;
  assessmentHost?: ChildEvidenceAssessmentHost;
  decisionHost?: ChildEvidenceDecisionHost;
  semanticEvidenceHost?: ChildSemanticEvidenceHost;
  semanticRecognizer?: CurrentRunSpeechRecognizer;
  mediaMcpServerPath?: string;
  frameMcpServerPath?: string;
  evidenceMcpServerPath?: string;
  assessmentMcpServerPath?: string;
  decisionMcpServerPath?: string;
  semanticEvidenceMcpServerPath?: string;
}

export class CodexExecWorkerLauncher {
  private readonly ledger: RuntimeLedger;
  private readonly scheduler: BoundedRuntimeScheduler;
  private readonly artifacts: ContentAddressedArtifactStore;
  private readonly reports: BoundedReportHost;
  private readonly options: Required<
    Pick<
      CodexWorkerLauncherOptions,
      "executable" | "maxStdoutBytes" | "maxStderrBytes" | "maximumWallMs" | "now" | "monotonicNow" | "nextExecutionId"
    >
  > &
    Pick<
      CodexWorkerLauncherOptions,
      "executableArgsPrefix" | "model" | "temporaryRoot" | "nextMediaOperationId" | "nextEvidenceOperationId" | "nextAssessmentOperationId" | "nextDecisionOperationId" | "nextSemanticEvidenceOperationId" | "nextFrameOperationId" | "mediaMcpServerPath" | "frameMcpServerPath" | "evidenceMcpServerPath" | "assessmentMcpServerPath" | "decisionMcpServerPath" | "semanticEvidenceMcpServerPath"
    >;
  private versionPromise: Promise<string> | null = null;
  private readonly mediaHost: ChildMediaCapabilityHost;
  private readonly frameHost: ChildFrameSamplingHost;
  private readonly evidenceHost: ChildEvidenceReadHost;
  private readonly assessmentHost: ChildEvidenceAssessmentHost;
  private readonly decisionHost: ChildEvidenceDecisionHost;
  private readonly semanticEvidenceHost: ChildSemanticEvidenceHost;

  constructor(
    ledger: RuntimeLedger,
    scheduler: BoundedRuntimeScheduler,
    artifacts: ContentAddressedArtifactStore,
    reports: BoundedReportHost,
    options: CodexWorkerLauncherOptions = {},
  ) {
    this.ledger = ledger;
    this.scheduler = scheduler;
    this.artifacts = artifacts;
    this.reports = reports;
    this.mediaHost = options.mediaHost ?? new FfmpegCapabilityHost(ledger, artifacts);
    this.frameHost = options.frameHost ?? new BoundedFrameSamplingHost(ledger, artifacts);
    this.evidenceHost = options.evidenceHost ?? new BoundedEvidenceReadHost(ledger, artifacts);
    this.assessmentHost = options.assessmentHost ?? new BoundedEvidenceAssessmentHost(ledger, artifacts);
    this.decisionHost = options.decisionHost ?? new BoundedEvidenceDecisionHost(ledger, artifacts);
    this.semanticEvidenceHost = options.semanticEvidenceHost ?? new SpeechTranscribeCapabilityHost(ledger, artifacts, {
      recognizer: options.semanticRecognizer,
    });
    this.options = {
      executable: options.executable ?? "codex",
      executableArgsPrefix: options.executableArgsPrefix,
      model: options.model ?? null,
      temporaryRoot: options.temporaryRoot,
      maxStdoutBytes: options.maxStdoutBytes ?? 2 * 1024 * 1024,
      maxStderrBytes: options.maxStderrBytes ?? 256 * 1024,
      maximumWallMs: options.maximumWallMs ?? 120_000,
      now: options.now ?? (() => new Date()),
      monotonicNow: options.monotonicNow ?? (() => performance.now()),
      nextExecutionId: options.nextExecutionId ?? (() => `execution:${randomUUID()}`),
      nextMediaOperationId: options.nextMediaOperationId,
      nextEvidenceOperationId: options.nextEvidenceOperationId,
      nextAssessmentOperationId: options.nextAssessmentOperationId,
      nextDecisionOperationId: options.nextDecisionOperationId,
      nextSemanticEvidenceOperationId: options.nextSemanticEvidenceOperationId,
      nextFrameOperationId: options.nextFrameOperationId,
      mediaMcpServerPath: options.mediaMcpServerPath,
      frameMcpServerPath: options.frameMcpServerPath,
      evidenceMcpServerPath: options.evidenceMcpServerPath,
      assessmentMcpServerPath: options.assessmentMcpServerPath,
      decisionMcpServerPath: options.decisionMcpServerPath,
      semanticEvidenceMcpServerPath: options.semanticEvidenceMcpServerPath,
    };
  }

  private commandArgs(args: string[]): string[] {
    return [...(this.options.executableArgsPrefix ?? []), ...args];
  }

  private async version(): Promise<string> {
    if (!this.versionPromise) {
      this.versionPromise = mkdtemp(join(this.options.temporaryRoot ?? tmpdir(), "studio-codex-version-")).then(
        async (directory) => {
          try {
            const result = await runProcess({
              executable: this.options.executable,
              args: this.commandArgs(["--version"]),
              cwd: directory,
              stdin: "",
              timeoutMs: 5_000,
              maxStdoutBytes: 32 * 1024,
              maxStderrBytes: 32 * 1024,
            });
            const version = result.stdout.trim();
            if (result.exitCode !== 0 || result.timedOut || result.outputOverflow || !version) {
              throw new Error("Codex executable did not return a bounded version");
            }
            return version;
          } finally {
            await rm(directory, { recursive: true, force: true });
          }
        },
      );
    }
    return this.versionPromise;
  }

  async launch(permit: LaunchPermit): Promise<CodexWorkerLaunchResult> {
    const scheduled = this.ledger.state().tasks[permit.taskId];
    if (
      !scheduled ||
      scheduled.assignedAgentId !== permit.agentId ||
      scheduled.status !== "scheduled" ||
      scheduled.ownerAgentId !== null
    ) {
      throw new Error("Launch permit does not reference one unowned scheduled task");
    }
    if (
      !scheduled.grants.some((grant) => grant.capability === "report.submit") ||
      scheduled.grants.some((grant) => !["report.submit", "media.extract", "media.seek", "media.frames.sample", "speech.transcribe", "evidence.read", "analysis.evidence.assess", "analysis.evidence.decide"].includes(grant.capability))
    ) {
      throw new Error("Codex executor supports only report.submit plus scheduler-granted media, frame, speech.transcribe, evidence-read, assessment, and decision capabilities");
    }

    const claimedAt = this.options.now().toISOString();
    const launchClaim = await this.scheduler.claimTaskLaunch(permit, "codex", claimedAt);
    if (!launchClaim.won) throw new Error("Task already has a durable launch claim and cannot start another executor");
    const version = await this.version();
    await this.scheduler.registerAgent(permit);
    await this.scheduler.transitionTask(permit.taskId, permit.agentId, "working");
    const task = this.ledger.state().tasks[permit.taskId];
    const executionId = this.options.nextExecutionId();
    const directory = await mkdtemp(join(this.options.temporaryRoot ?? tmpdir(), "studio-codex-worker-"));
    const schemaPath = join(directory, "worker-output.schema.json");
    await writeFile(schemaPath, `${JSON.stringify(workerOutputSchema(task))}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
    const startedAt = this.options.now().toISOString();
    const monotonicStart = this.options.monotonicNow();
    await this.ledger.transact(
      { producer: { kind: "launcher", id: "codex-exec-worker-launcher" }, causationId: permit.requestId },
      () => ({
        pending: [
          { type: "executor.started", data: {
            executionId,
            taskId: task.id,
            agentId: task.assignedAgentId,
            launchClaimId: launchClaim.claim.id,
            startedAt,
          } },
        ] satisfies PendingRuntimeEvent[],
        result: undefined,
      }),
    );

    let processResult: ProcessResult | null = null;
    let usage: ModelUsageReceipt | null = null;
    let executorFinished = false;
    const childCapabilities = launcherChildCapabilityContext(task);
    try {
      await openLauncherChildCapabilityBridges(
        task,
        {
          media: this.mediaHost,
          frame: this.frameHost,
          evidence: this.evidenceHost,
          assessment: this.assessmentHost,
          decision: this.decisionHost,
          semanticEvidence: this.semanticEvidenceHost,
        },
        this.options,
        childCapabilities,
      );
      const {
        mediaCapabilities,
        evidenceGrant,
        semanticEvidenceGrant,
        frameGrant,
        assessmentGrant,
        decisionGrant,
      } = childCapabilities;
      const args = closedCodexExecArgs();
      configureLauncherChildCapabilityMcp(args, task, this.options, childCapabilities);
      args.push("--output-schema", schemaPath);
      if (this.options.model) args.push("--model", this.options.model);
      args.push("-");
      processResult = await runProcess({
        executable: this.options.executable,
        args: this.commandArgs(args),
        cwd: directory,
        stdin: workerPrompt(task),
        env: launcherChildCapabilityEnvironment(childCapabilities),
        timeoutMs: Math.min(task.budget.wallMs, this.options.maximumWallMs),
        maxStdoutBytes: this.options.maxStdoutBytes,
        maxStderrBytes: this.options.maxStderrBytes,
      });
      if (processResult.timedOut) {
        throw new LauncherFailure("Codex worker timed out", "Codex executor exceeded its active wall-time limit.");
      }
      if (processResult.outputOverflow) {
        throw new LauncherFailure("Codex worker exceeded output bounds", "Codex executor exceeded its output limit.");
      }
      if (processResult.exitCode !== 0) {
        throw new LauncherFailure(
          `Codex worker exited ${processResult.exitCode ?? processResult.signal ?? "without status"}`,
          closedProcessExitReason(processResult),
        );
      }
      const parsed = parseCodexEvents(processResult.stdout);
      usage = await recordCodexModelUsage({
        artifacts: this.artifacts,
        ledger: this.ledger,
        executionId,
        task,
        version,
        model: this.options.model ?? null,
        usageEvent: parsed.usageEvent,
        rawUsageEvent: parsed.rawUsageEvent,
      });
      if (mediaCapabilities.some((capability) =>
        !Object.values(this.ledger.state().operations).some((operation) =>
          operation.taskId === task.id && operation.capability === capability && operation.status === "completed"))) {
        throw new LauncherFailure(
          "Codex child did not complete every granted media capability",
          "Codex child did not complete its required receipted media operation.",
        );
      }
      if (frameGrant && !Object.values(this.ledger.state().frameSamples).some((operation) =>
        operation.taskId === task.id && operation.grantId === frameGrant.id && operation.status === "completed")) {
        throw new LauncherFailure(
          "Codex child did not complete its granted frame-sampling operation",
          "Codex child did not complete its required receipted frame sampling.",
        );
      }
      if (evidenceGrant?.evidenceScope.some((scope) =>
        !Object.values(this.ledger.state().evidenceReads).some((operation) =>
          operation.taskId === task.id &&
          operation.artifactId === scope.artifactId &&
          operation.status === "completed"))) {
        throw new LauncherFailure(
          "Codex child did not read every granted evidence artifact",
          "Codex child did not complete its required receipted evidence read.",
        );
      }
      const completedSemantic = Object.values(this.ledger.state().semanticEvidence)
        .filter((operation) => operation.taskId === task.id && operation.status === "completed")
        .sort((left, right) => left.id.localeCompare(right.id));
      if (semanticEvidenceGrant && completedSemantic.length === 0) {
        throw new LauncherFailure(
          "Codex child did not complete its granted speech.transcribe operation",
          "Codex child did not complete its required current-run semantic evidence operation.",
        );
      }
      const semanticEvidenceInputs: ReturnType<typeof semanticEvidenceCitation>[] = [];
      for (const operation of completedSemantic) {
        const verified = await reopenSemanticEvidence(this.ledger.state(), this.artifacts, operation.id);
        semanticEvidenceInputs.push(semanticEvidenceCitation(verified));
      }
      if (assessmentGrant && !Object.values(this.ledger.state().evidenceAssessments).some((operation) =>
        operation.taskId === task.id && operation.grantId === assessmentGrant.id && operation.status === "completed")) {
        throw new LauncherFailure(
          "Codex child did not complete its granted evidence assessment",
          "Codex child did not complete its required receipted evidence assessment.",
        );
      }
      if (decisionGrant && !Object.values(this.ledger.state().evidenceDecisions).some((operation) =>
        operation.taskId === task.id && operation.grantId === decisionGrant.id && operation.status === "completed")) {
        throw new LauncherFailure(
          "Codex child did not complete its granted evidence decision",
          "Codex child did not complete its required audited evidence decision.",
        );
      }
      let workerValue: unknown;
      try {
        workerValue = JSON.parse(parsed.finalMessage);
      } catch (error) {
        throw new LauncherFailure(
          `Codex final response is not JSON: ${error instanceof Error ? error.message : "invalid JSON"}`,
          "Codex worker response failed its output contract.",
        );
      }
      const worker = validateWorkerResult(workerValue, task, semanticEvidenceInputs);
      const prepared = await Promise.all(
        worker.outputs.map(async (output) => {
          if (output.kind === "studio.study-report.v1" && "coverage" in output) {
            return {
              kind: "study" as const,
              prepared: await this.artifacts.prepareStudyReport(
                this.ledger.runId,
                buildStudyReportEnvelope(task, output, worker.semanticEvidenceInputs),
              ),
            };
          }
          if (!("content" in output)) throw new Error("Non-study worker output lost its content field");
          const envelope: WorkerOutputEnvelope = {
            schema: "studio.worker-output.v1",
            executionId,
            taskId: task.id,
            agentId: task.assignedAgentId,
            ...(semanticEvidenceGrant ? { semanticEvidenceInputs: worker.semanticEvidenceInputs } : {}),
            output,
          };
          return { kind: "worker" as const, prepared: await this.artifacts.prepareWorkerOutput(this.ledger.runId, envelope) };
        }),
      );
      const endedAt = this.options.now().toISOString();
      const durationMs = Math.max(0, Math.round(this.options.monotonicNow() - monotonicStart));
      const span = codexExecutorSpanReceipt({
        executionId,
        task,
        version,
        startedAt,
        endedAt,
        durationMs,
        outcome: "completed",
        process: processResult,
        outputArtifactIds: prepared.map((output) => output.prepared.artifactId),
        usageReceiptId: usage.receiptId,
        failure: null,
      });
      const storedSpan = await this.artifacts.storeJson(span);
      const outputArtifacts = prepared.map((output) => output.kind === "study"
        ? this.artifacts.buildStudyReportArtifact({
            runId: this.ledger.runId,
            receipt: span,
            receiptContentId: storedSpan.content.contentId,
            prepared: output.prepared,
          })
        : this.artifacts.buildWorkerOutputArtifact({
            runId: this.ledger.runId,
            receipt: span,
            receiptContentId: storedSpan.content.contentId,
            prepared: output.prepared,
          }));
      for (const artifact of outputArtifacts) await this.artifacts.record(this.ledger, artifact, executionId);
      await this.ledger.transact(
        { producer: { kind: "launcher", id: "codex-exec-worker-launcher" }, causationId: executionId },
        () => ({
          pending: [{ type: "executor.finished", data: { receipt: span } }] satisfies PendingRuntimeEvent[],
          result: undefined,
        }),
      );
      executorFinished = true;
      let report: ReportRecord;
      try {
        report = await this.reports.submit({
          taskId: task.id,
          agentId: task.assignedAgentId,
          outputArtifactIds: outputArtifacts.map((artifact) => artifact.id),
          summary: worker.summary,
        });
      } catch (error) {
        await this.scheduler.transitionTask(
          task.id,
          task.assignedAgentId,
          "failed",
          "The executor completed but its structured report-up was rejected by the handoff host.",
        );
        throw error;
      }
      return { execution: span, usage, artifacts: outputArtifacts, report };
    } catch (error) {
      if (!executorFinished && this.ledger.state().executions[executionId]?.status === "active") {
        const endedAt = this.options.now().toISOString();
        const durationMs = Math.max(0, Math.round(this.options.monotonicNow() - monotonicStart));
        const failure = error instanceof LauncherFailure ? error.safeReason : "Codex executor could not be started.";
        const span = codexExecutorSpanReceipt({
          executionId,
          task,
          version,
          startedAt,
          endedAt,
          durationMs,
          outcome: processResult?.timedOut ? "timed_out" : "failed",
          process: processResult ?? { exitCode: null, signal: null },
          outputArtifactIds: [],
          usageReceiptId: usage?.receiptId ?? null,
          failure,
        });
        await this.artifacts.storeJson(span);
        await this.ledger.transact(
          { producer: { kind: "launcher", id: "codex-exec-worker-launcher" }, causationId: executionId },
          () => ({
            pending: [{ type: "executor.finished", data: { receipt: span } }] satisfies PendingRuntimeEvent[],
            result: undefined,
          }),
        );
        await this.scheduler.transitionTask(task.id, task.assignedAgentId, "failed", failure);
      }
      throw error;
    } finally {
      await closeLauncherChildCapabilityBridges(childCapabilities);
      await rm(directory, { recursive: true, force: true });
    }
  }
}
