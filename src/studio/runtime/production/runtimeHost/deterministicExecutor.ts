import { canonicalSha256 } from "../artifactStore.ts";
import { BoundedChildMediaBridge, type ChildMediaToolResult } from "../executor/childMediaBridge.ts";
import {
  BoundedChildEvidenceBridge,
  type ChildEvidenceToolResult,
} from "../executor/childEvidenceBridge.ts";
import {
  BoundedChildEvidenceAssessmentBridge,
  type ChildEvidenceAssessmentToolResult,
} from "../executor/childEvidenceAssessmentBridge.ts";
import {
  BoundedChildEvidenceDecisionBridge,
  type ChildEvidenceDecisionToolResult,
} from "../executor/childEvidenceDecisionBridge.ts";
import type {
  CurrentRunRecognizerDescriptor,
  ExecutorSpanReceipt,
  LaunchPermit,
  SpeakerOverlapEvidenceCitationInput,
  TaskRecord,
  WorkerOutputEnvelope,
} from "../model.ts";
import type {
  CurrentRunRecognizerInput,
  CurrentRunRecognizerResult,
  CurrentRunSpeechRecognizer,
} from "../semantic/currentRunSpeechRecognizer.ts";
import { BoundedChildSemanticEvidenceBridge } from "../executor/childSemanticEvidenceBridge.ts";
import { BoundedChildSpeakerBridge } from "../executor/childSpeakerBridge.ts";
import { SpeechTranscribeCapabilityHost } from "../semantic/semanticEvidenceHost.ts";
import { reopenSemanticEvidence, semanticEvidenceCitation } from "../semantic/semanticEvidenceAudit.ts";
import { buildStudyReportEnvelope, buildStudyReportEnvelopeV2, validateWorkerResult } from "../executor/workerContract.ts";
import { deriveTaskDialogueScopePolicy } from "../study/dialogueScopeRuntime.ts";
import type { SpeakerDiarizer } from "../speaker/diarizer.ts";
import { auditSpeakerOverlap, type VerifiedSpeakerOverlapAudit } from "../speakerAudit.ts";
import { BoundedSpeakerOverlapHost } from "../speakerHost.ts";
import type { PendingRuntimeEvent } from "../protocol.ts";
import {
  RuntimeApplicationInterrupted,
  type BoundedWorkerLauncher,
  type BoundedWorkerLauncherContext,
  type BoundedWorkerLauncherFactory,
} from "./runtimeApplication.ts";

interface Gate {
  promise: Promise<void>;
  release(): void;
}

class DeterministicCurrentRunRecognizer implements CurrentRunSpeechRecognizer {
  async describe(): Promise<CurrentRunRecognizerDescriptor> {
    const configuration = {
      id: "studio.deterministic-runtime-test-recognizer.v1",
      language: null,
      timestampMode: "segment" as const,
      segmentation: "producer_defined" as const,
    };
    return {
      id: "studio.deterministic-runtime-test-recognizer",
      version: "1",
      model: "deterministic-current-run-test-model",
      runtime: { id: "studio.deterministic-test-executor", version: "1" },
      configuration: { ...configuration, contentId: `sha256:${canonicalSha256(configuration)}` },
      executionScope: "current_run",
      fixtureContentId: null,
    };
  }
  async recognize(input: CurrentRunRecognizerInput): Promise<CurrentRunRecognizerResult> {
    return {
      availability: "available",
      reason: "current_run_hypotheses_returned",
      segments: [{
        startMs: input.range.startMs,
        endMs: input.range.endMs,
        state: "available",
        text: `Deterministic current-run test hypothesis for ${input.range.startMs}-${input.range.endMs}; correctness is not assessed.`,
      }],
    };
  }
}

function gate(paused: boolean): Gate {
  if (!paused) return { promise: Promise.resolve(), release: () => undefined };
  let release = (): void => undefined;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

export class DeterministicExecutionControl {
  private readonly beforeFirst: Gate;
  private readonly midRun: Gate;

  constructor(options: { pauseBeforeFirstEvent?: boolean; pauseMidRun?: boolean } = {}) {
    this.beforeFirst = gate(options.pauseBeforeFirstEvent ?? false);
    this.midRun = gate(options.pauseMidRun ?? false);
  }

  waitBeforeFirstEvent(): Promise<void> {
    return this.beforeFirst.promise;
  }

  waitMidRun(): Promise<void> {
    return this.midRun.promise;
  }

  releaseBeforeFirstEvent(): void {
    this.beforeFirst.release();
  }

  releaseMidRun(): void {
    this.midRun.release();
  }
}

export type DeterministicExecutionMode = "completed" | "failed" | "timed_out" | "interrupted";

export interface DeterministicExecutorOptions {
  mode?: DeterministicExecutionMode;
  control?: DeterministicExecutionControl;
  now?: () => Date;
  restudyPassResult?: "supported" | "withheld";
  speakerDiarizer?: SpeakerDiarizer;
}

class DeterministicWorkerLauncher implements BoundedWorkerLauncher {
  private readonly context: BoundedWorkerLauncherContext;
  private readonly owner: DeterministicRuntimeExecutor;

  constructor(context: BoundedWorkerLauncherContext, owner: DeterministicRuntimeExecutor) {
    this.context = context;
    this.owner = owner;
  }

  private span(
    task: TaskRecord,
    executionId: string,
    startedAt: string,
    input: {
      outcome: ExecutorSpanReceipt["outcome"];
      outputArtifactIds: string[];
      failure: string | null;
    },
  ): ExecutorSpanReceipt {
    const endedAt = this.owner.now().toISOString();
    const body = {
      executionId,
      taskId: task.id,
      agentId: task.assignedAgentId,
      phase: "active" as const,
      producer: {
        id: "studio.deterministic-test-executor" as const,
        version: "1" as const,
        sandbox: "read-only" as const,
        ephemeral: true as const,
      },
      startedAt,
      endedAt,
      monotonicDurationMs: 0,
      outcome: input.outcome,
      process: { exitCode: input.outcome === "completed" ? 0 : null, signal: null },
      outputArtifactIds: input.outputArtifactIds,
      modelUsageReceiptId: null,
      failure: input.failure,
    };
    return {
      schema: "studio.executor-span.receipt.v1",
      receiptId: `span:${canonicalSha256(body)}`,
      ...body,
    };
  }

  async launch(permit: LaunchPermit): Promise<{ report: Awaited<ReturnType<BoundedWorkerLauncherContext["reports"]["submit"]>> }> {
    this.owner.launchInvocations += 1;
    await this.owner.control.waitBeforeFirstEvent();
    const { ledger, scheduler, artifacts, reports } = this.context;
    const launchClaim = await scheduler.claimTaskLaunch(permit, "deterministic_test", this.owner.now().toISOString());
    if (!launchClaim.won) throw new Error("Task already has a durable launch claim and cannot start another executor");
    await scheduler.registerAgent(permit);
    await scheduler.transitionTask(permit.taskId, permit.agentId, "working");
    const task = ledger.state().tasks[permit.taskId];
    const executionId = `execution:deterministic:${canonicalSha256({ runId: ledger.runId, taskId: task.id })}`;
    const startedAt = this.owner.now().toISOString();
    await ledger.transact(
      { producer: { kind: "launcher", id: "deterministic-test-executor" }, causationId: permit.requestId },
      () => ({
        pending: [{
          type: "executor.started",
          data: {
            executionId,
            taskId: task.id,
            agentId: task.assignedAgentId,
            launchClaimId: launchClaim.claim.id,
            startedAt,
          },
        }] satisfies PendingRuntimeEvent[],
        result: undefined,
      }),
    );
    await this.owner.control.waitMidRun();

    if (this.owner.mode === "interrupted") {
      throw new RuntimeApplicationInterrupted("The deterministic test executor was interrupted after start evidence.");
    }
    if (this.owner.mode === "failed" || this.owner.mode === "timed_out") {
      const timedOut = this.owner.mode === "timed_out";
      const reason = timedOut
        ? "The deterministic test executor reached its simulated timeout."
        : "The deterministic test executor failed by request.";
      const span = this.span(task, executionId, startedAt, {
        outcome: timedOut ? "timed_out" : "failed",
        outputArtifactIds: [],
        failure: reason,
      });
      await artifacts.storeJson(span);
      await ledger.transact(
        { producer: { kind: "launcher", id: "deterministic-test-executor" }, causationId: executionId },
        () => ({
          pending: [{ type: "executor.finished", data: { receipt: span } }] satisfies PendingRuntimeEvent[],
          result: undefined,
        }),
      );
      await scheduler.transitionTask(task.id, task.assignedAgentId, "failed", reason);
      throw new Error(reason);
    }

    if (task.grants.some((grant) => grant.capability === "research.investigate")) {
      const reason = "The deterministic contract seam does not perform research; the granted child closes without ambient egress.";
      const span = this.span(task, executionId, startedAt, { outcome: "failed", outputArtifactIds: [], failure: reason });
      await artifacts.storeJson(span);
      await ledger.transact(
        { producer: { kind: "launcher", id: "deterministic-test-executor" }, causationId: executionId },
        () => ({ pending: [{ type: "executor.finished", data: { receipt: span } }] satisfies PendingRuntimeEvent[], result: undefined }),
      );
      await scheduler.transitionTask(task.id, task.assignedAgentId, "failed", reason);
      throw new Error(reason);
    }

    const studySlot = task.requiredOutputs.find((output) => output.required && (output.artifactKind === "studio.study-report.v1" || output.artifactKind === "studio.study-report.v2"));
    if (studySlot) {
      if (task.workerLabel.includes("study-fail")) {
        const reason = "The deterministic partial-child test seam failed this bounded study worker before producing a report.";
        const span = this.span(task, executionId, startedAt, { outcome: "failed", outputArtifactIds: [], failure: reason });
        await artifacts.storeJson(span);
        await ledger.transact(
          { producer: { kind: "launcher", id: "deterministic-test-executor" }, causationId: executionId },
          () => ({ pending: [{ type: "executor.finished", data: { receipt: span } }] satisfies PendingRuntimeEvent[], result: undefined }),
        );
        await scheduler.transitionTask(task.id, task.assignedAgentId, "failed", reason);
        throw new Error(reason);
      }
      const scope = task.mediaScope[0];
      if (!scope || task.mediaScope.length !== 1) throw new Error("Deterministic study worker requires one exact scope");
      const semanticHost = new SpeechTranscribeCapabilityHost(ledger, artifacts, { recognizer: new DeterministicCurrentRunRecognizer() });
      const semanticResult = await new BoundedChildSemanticEvidenceBridge(task, semanticHost, {
        nextOperationId: () => `operation:deterministic-semantic:${canonicalSha256({ runId: ledger.runId, taskId: task.id, scope })}`,
      }).call(scope);
      const verifiedSemantic = await reopenSemanticEvidence(ledger.state(), artifacts, semanticResult.operationId);
      const citation = semanticEvidenceCitation(verifiedSemantic);
      const speakerEvidenceInputs: SpeakerOverlapEvidenceCitationInput[] = [];
      const verifiedSpeakerEvidence: VerifiedSpeakerOverlapAudit[] = [];
      if (task.grants.some((grant) => grant.capability === "media.speakers.analyze")) {
        const speakerResult = await new BoundedChildSpeakerBridge(
          task,
          new BoundedSpeakerOverlapHost(ledger, artifacts, { diarizer: this.owner.speakerDiarizer }),
          { nextOperationId: () => `operation:deterministic-speaker:${canonicalSha256({ runId: ledger.runId, taskId: task.id, scope })}` },
        ).call({});
        const verifiedSpeaker = await auditSpeakerOverlap(ledger.state(), artifacts, speakerResult.operationId, {
          diarizer: this.owner.speakerDiarizer,
        });
        speakerEvidenceInputs.push({
          operationId: speakerResult.operationId,
          artifactId: speakerResult.observationsArtifactId,
          contentId: speakerResult.observationsContentId,
          receiptArtifactId: speakerResult.receiptArtifactId,
          receiptId: speakerResult.receipt.receiptId,
          receiptContentId: speakerResult.receiptContentId,
        });
        verifiedSpeakerEvidence.push(verifiedSpeaker);
      }
      const claimId = `claim:deterministic:${canonicalSha256({ taskId: task.id, scope, observationIds: citation.observations.map((entry) => entry.observationId) })}`;
      const preservesGap = task.workerLabel.includes("study-gap") ||
        task.workerLabel === "padded-current-run-speech-pass-2" ||
        (task.workerLabel === "attenuated-current-run-speech-pass-2" && this.owner.restudyPassResult === "withheld");
      const worker = validateWorkerResult({
        summary: "Deterministic test seam returned one typed current-run hypothesis report; correctness and quality were not assessed.",
        semanticEvidenceInputs: [citation],
        ...(speakerEvidenceInputs.length > 0 ? { speakerEvidenceInputs } : {}),
        outputs: [{
          name: studySlot.name,
          kind: studySlot.artifactKind,
          coverage: studySlot.artifactKind === "studio.study-report.v2"
            ? [{ ...scope, claimIds: preservesGap ? [] : [claimId], reason: preservesGap ? { code: "worker_withheld" as const, detail: "The deterministic compatibility seam preserves this exact range without a claim." } : null }]
            : [preservesGap
                ? { ...scope, state: "unknown" as const, claimIds: [], reason: { code: "unobserved_range" as const, detail: "The deterministic follow-up test seam preserves this exact range as an explicit gap." } }
                : { ...scope, state: "supported" as const, claimIds: [claimId], reason: null }],
          claims: preservesGap ? [] : [{
            claimId,
            ...scope,
            statement: `The current-run test recognizer returned an available timed hypothesis for ${scope.startMs}-${scope.endMs}${task.workerLabel.includes("study-conflict") ? ` from ${task.workerLabel}` : ""}.`,
            citations: [citation],
          }],
        }],
      }, task, [citation], [], speakerEvidenceInputs);
      const output = worker.outputs[0];
      if ((output.kind !== "studio.study-report.v1" && output.kind !== "studio.study-report.v2") || !("coverage" in output)) throw new Error("Deterministic study worker lost its typed output");
      const reportEnvelope = output.kind === "studio.study-report.v2"
        ? buildStudyReportEnvelopeV2({
            task,
            executionId,
            output,
            semanticEvidenceInputs: [citation],
            verifiedSemanticEvidence: [verifiedSemantic],
            ocrEvidenceInputs: [],
            verifiedOcrEvidence: [],
            speakerEvidenceInputs,
            verifiedSpeakerEvidence,
            dialogueScopePolicy: await deriveTaskDialogueScopePolicy(ledger.state(), artifacts, task.id),
          })
        : buildStudyReportEnvelope(task, output, [citation]);
      const prepared = await artifacts.prepareStudyReport(ledger.runId, reportEnvelope, output.name);
      const span = this.span(task, executionId, startedAt, { outcome: "completed", outputArtifactIds: [prepared.artifactId], failure: null });
      const storedSpan = await artifacts.storeJson(span);
      const artifact = artifacts.buildStudyReportArtifact({ runId: ledger.runId, receipt: span, receiptContentId: storedSpan.content.contentId, prepared });
      await artifacts.record(ledger, artifact, executionId);
      await ledger.transact(
        { producer: { kind: "launcher", id: "deterministic-test-executor" }, causationId: executionId },
        () => ({ pending: [{ type: "executor.finished", data: { receipt: span } }] satisfies PendingRuntimeEvent[], result: undefined }),
      );
      const report = await reports.submit({
        taskId: task.id,
        agentId: task.assignedAgentId,
        outputArtifactIds: [artifact.id],
        summary: "Deterministic test seam submitted one coverage-complete study report over a current-run recognizer hypothesis; this is not model or quality evidence.",
      });
      return { report };
    }

    let mediaResult: ChildMediaToolResult;
    const evidenceResults: ChildEvidenceToolResult[] = [];
    let assessmentResult: ChildEvidenceAssessmentToolResult | null = null;
    let decisionResult: ChildEvidenceDecisionToolResult | null = null;
    try {
      const scope = task.mediaScope[0];
      if (!scope) throw new Error("The deterministic media proof has no scheduler scope");
      const bridge = new BoundedChildMediaBridge(task, this.context.mediaHost, {
        nextOperationId: () => this.context.plannedMediaOperationId,
      });
      mediaResult = await bridge.call("media_seek", scope);
      const evidenceGrant = task.grants.find((grant) => grant.capability === "evidence.read");
      for (const evidenceScope of evidenceGrant?.evidenceScope ?? []) {
        const evidenceBridge = new BoundedChildEvidenceBridge(task, this.context.evidenceHost, {
          nextOperationId: () => `operation:evidence-read:${canonicalSha256({
            runId: ledger.runId,
            taskId: task.id,
            artifactId: evidenceScope.artifactId,
          })}`,
        });
        evidenceResults.push(await evidenceBridge.call({ artifactId: evidenceScope.artifactId }));
      }
      const assessmentGrant = task.grants.find((grant) => grant.capability === "analysis.evidence.assess");
      if (assessmentGrant) {
        const assessableEvidenceResults = evidenceResults.filter((result) => result.receipt.input.evidenceKind !== "acoustic_ranges");
        const claims = assessableEvidenceResults.map((result) => {
          const fact = result.receipt.facts[0];
          if (!fact) throw new Error("The deterministic assessment proof requires one returned fact per read receipt");
          const citation = [{
            receiptId: result.receiptId,
            receiptContentId: result.receiptContentId,
            factIndexes: [0],
          }];
          const range = { startMs: fact.startMs, endMs: fact.endMs };
          if (fact.kind === "language_range") {
            return {
              kind: "language_identity" as const,
              value: fact.decision.status === "classified" ? fact.decision.code : null,
              range,
              citations: citation,
            };
          }
          return {
            kind: "speech_activity" as const,
            value: fact.kind === "speech_window" ? "speech" as const : "non_speech" as const,
            range,
            citations: citation,
          };
        });
        const assessmentBridge = new BoundedChildEvidenceAssessmentBridge(task, this.context.assessmentHost, {
          nextOperationId: () => `operation:evidence-assess:${canonicalSha256({
            runId: ledger.runId,
            taskId: task.id,
            readReceiptIds: assessableEvidenceResults.map((result) => result.receiptId),
          })}`,
        });
        assessmentResult = await assessmentBridge.call({
          readReceipts: assessableEvidenceResults.map((result) => ({
            receiptId: result.receiptId,
            receiptContentId: result.receiptContentId,
          })),
          claims,
        });
        const decisionGrant = task.grants.find((grant) => grant.capability === "analysis.evidence.decide");
        if (!decisionGrant) throw new Error("The deterministic assessment proof has no paired decision grant");
        const decisionBridge = new BoundedChildEvidenceDecisionBridge(task, this.context.decisionHost, {
          nextOperationId: () => `operation:evidence-decide:${canonicalSha256({
            runId: ledger.runId,
            taskId: task.id,
            assessmentReceiptId: assessmentResult?.receiptId,
          })}`,
        });
        decisionResult = await decisionBridge.call({
          auditedAssessments: [{
            operationId: assessmentResult.operationId,
            artifactId: assessmentResult.outputArtifactId,
            receiptId: assessmentResult.receiptId,
            receiptContentId: assessmentResult.receiptContentId,
          }],
        });
      }
    } catch (error) {
      const reason = "The deterministic child bridge did not complete every required receipted media/evidence/assessment/decision operation.";
      const span = this.span(task, executionId, startedAt, {
        outcome: "failed",
        outputArtifactIds: [],
        failure: reason,
      });
      await artifacts.storeJson(span);
      await ledger.transact(
        { producer: { kind: "launcher", id: "deterministic-test-executor" }, causationId: executionId },
        () => ({
          pending: [{ type: "executor.finished", data: { receipt: span } }] satisfies PendingRuntimeEvent[],
          result: undefined,
        }),
      );
      await scheduler.transitionTask(task.id, task.assignedAgentId, "failed", reason);
      throw error;
    }

    const envelope: WorkerOutputEnvelope = {
      schema: "studio.worker-output.v1",
      executionId,
      taskId: task.id,
      agentId: task.assignedAgentId,
      output: {
        name: "execution report",
        kind: "worker-execution-report",
        content:
          `Deterministic child completed ${mediaResult.capability} as ${mediaResult.operationId}; ` +
          `output ${mediaResult.outputArtifactId}; receipt ${mediaResult.receiptId}; ` +
          `receipt content ${mediaResult.receiptContentId}. ` +
          (evidenceResults.length > 0
            ? `It read ${evidenceResults.length} pre-existing evidence artifacts under their receipted bounds: ${evidenceResults.map((result) =>
                `${result.inputArtifactId} (${result.receipt.result.returnedItems} facts, ${result.receiptId}, ${result.receiptContentId})`).join("; ")}. `
            : "No detector evidence was granted or read. ") +
          (assessmentResult
            ? `It produced bounded assessment ${assessmentResult.receiptId} as ${assessmentResult.outputArtifactId} with ${assessmentResult.receipt.result.claimCount} range-bound claims. `
            : "No evidence assessment was granted or produced. ") +
          (decisionResult
            ? `The deterministic audit-state gate emitted ${decisionResult.receipt.decision.outcome} as ${decisionResult.receiptId} with reasons ${decisionResult.receipt.decision.reasonCodes.join(", ")}. `
            : "No evidence decision was granted or produced. ") +
          "No new detector or media-content finding, caption, or publication was produced.",
      },
    };
    const prepared = await artifacts.prepareWorkerOutput(ledger.runId, envelope);
    const span = this.span(task, executionId, startedAt, {
      outcome: "completed",
      outputArtifactIds: [prepared.artifactId],
      failure: null,
    });
    const storedSpan = await artifacts.storeJson(span);
    const artifact = artifacts.buildWorkerOutputArtifact({
      runId: ledger.runId,
      receipt: span,
      receiptContentId: storedSpan.content.contentId,
      prepared,
    });
    await artifacts.record(ledger, artifact, executionId);
    await ledger.transact(
      { producer: { kind: "launcher", id: "deterministic-test-executor" }, causationId: executionId },
      () => ({
        pending: [{ type: "executor.finished", data: { receipt: span } }] satisfies PendingRuntimeEvent[],
        result: undefined,
      }),
    );
    const report = await reports.submit({
      taskId: task.id,
      agentId: task.assignedAgentId,
      outputArtifactIds: [artifact.id],
      summary:
        `Deterministic child completed one authorized ${mediaResult.capability} operation with ` +
        `receipt ${mediaResult.receiptId} and ${evidenceResults.length} authorized evidence reads; ` +
        `${assessmentResult ? "one bounded structured evidence assessment completed" : "no evidence assessment was granted"}; ` +
        `${decisionResult ? `one deterministic audited decision completed as ${decisionResult.receipt.decision.outcome}` : "no evidence decision was granted"}; ` +
        "no model, detector rerun, caption, translation, publication, or raw-media interpretation ran.",
    });
    return { report };
  }
}

/** Deterministic executor: one real seek plus every available, explicitly granted evidence read. */
export class DeterministicRuntimeExecutor {
  readonly mode: DeterministicExecutionMode;
  readonly control: DeterministicExecutionControl;
  readonly now: () => Date;
  readonly restudyPassResult: "supported" | "withheld";
  readonly speakerDiarizer: SpeakerDiarizer | undefined;
  launchInvocations = 0;

  constructor(options: DeterministicExecutorOptions = {}) {
    this.mode = options.mode ?? "completed";
    this.control = options.control ?? new DeterministicExecutionControl();
    this.now = options.now ?? (() => new Date());
    this.restudyPassResult = options.restudyPassResult ?? "supported";
    this.speakerDiarizer = options.speakerDiarizer;
  }

  factory(): BoundedWorkerLauncherFactory {
    return (context) => new DeterministicWorkerLauncher(context, this);
  }
}
