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
import type {
  ExecutorSpanReceipt,
  LaunchPermit,
  TaskRecord,
  WorkerOutputEnvelope,
} from "../model.ts";
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
          data: { executionId, taskId: task.id, agentId: task.assignedAgentId, startedAt },
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

    let mediaResult: ChildMediaToolResult;
    const evidenceResults: ChildEvidenceToolResult[] = [];
    let assessmentResult: ChildEvidenceAssessmentToolResult | null = null;
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
        const claims = evidenceResults.map((result) => {
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
            readReceiptIds: evidenceResults.map((result) => result.receiptId),
          })}`,
        });
        assessmentResult = await assessmentBridge.call({
          readReceipts: evidenceResults.map((result) => ({
            receiptId: result.receiptId,
            receiptContentId: result.receiptContentId,
          })),
          claims,
        });
      }
    } catch (error) {
      const reason = "The deterministic child bridge did not complete every required receipted media/evidence/assessment operation.";
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
          "No new detector or media-content finding was produced.",
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
        "no model, detector rerun, caption, translation, or raw-media interpretation ran.",
    });
    return { report };
  }
}

/** Deterministic executor: one real seek plus every available, explicitly granted evidence read. */
export class DeterministicRuntimeExecutor {
  readonly mode: DeterministicExecutionMode;
  readonly control: DeterministicExecutionControl;
  readonly now: () => Date;
  launchInvocations = 0;

  constructor(options: DeterministicExecutorOptions = {}) {
    this.mode = options.mode ?? "completed";
    this.control = options.control ?? new DeterministicExecutionControl();
    this.now = options.now ?? (() => new Date());
  }

  factory(): BoundedWorkerLauncherFactory {
    return (context) => new DeterministicWorkerLauncher(context, this);
  }
}
