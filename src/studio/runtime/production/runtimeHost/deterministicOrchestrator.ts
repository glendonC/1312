import { canonicalSha256 } from "../artifactStore.ts";
import {
  BoundedOrchestratorBridge,
  type ReportsWaitToolResult,
} from "../executor/orchestratorBridge.ts";
import type { ExecutorSpanReceipt, TaskRecord } from "../model.ts";
import type { PendingRuntimeEvent } from "../protocol.ts";
import type {
  BoundedOrchestratorLauncher,
  BoundedOrchestratorLauncherContext,
  BoundedOrchestratorLauncherFactory,
} from "./runtimeApplication.ts";

export type DeterministicOrchestratorMode = "spawn_one" | "no_request";

export interface DeterministicOrchestratorOptions {
  mode?: DeterministicOrchestratorMode;
  now?: () => Date;
}

class DeterministicOrchestratorLauncher implements BoundedOrchestratorLauncher {
  private readonly context: BoundedOrchestratorLauncherContext;
  private readonly mode: DeterministicOrchestratorMode;
  private readonly now: () => Date;

  constructor(context: BoundedOrchestratorLauncherContext, options: DeterministicOrchestratorOptions) {
    this.context = context;
    this.mode = options.mode ?? "spawn_one";
    this.now = options.now ?? (() => new Date());
  }

  private span(task: TaskRecord, executionId: string, startedAt: string): ExecutorSpanReceipt {
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
      endedAt: this.now().toISOString(),
      monotonicDurationMs: 0,
      outcome: "completed" as const,
      process: { exitCode: 0, signal: null },
      outputArtifactIds: [],
      modelUsageReceiptId: null,
      failure: null,
    };
    return { schema: "studio.executor-span.receipt.v1", receiptId: `span:${canonicalSha256(body)}`, ...body };
  }

  async launch(permit: Parameters<BoundedOrchestratorLauncher["launch"]>[0]): Promise<void> {
    const { ledger, scheduler, artifacts, childLauncher } = this.context;
    const launchClaim = await scheduler.claimTaskLaunch(permit, "deterministic_test", this.now().toISOString());
    if (!launchClaim.won) throw new Error("Root already has a durable launch claim");
    await scheduler.registerAgent(permit);
    await scheduler.transitionTask(permit.taskId, permit.agentId, "working");
    const task = ledger.state().tasks[permit.taskId];
    const executionId = `execution:deterministic-root:${canonicalSha256({ runId: ledger.runId, taskId: task.id })}`;
    const startedAt = this.now().toISOString();
    await ledger.transact(
      { producer: { kind: "launcher", id: "deterministic-test-orchestrator" }, causationId: permit.requestId },
      () => ({
        pending: [{ type: "executor.started", data: {
          executionId,
          taskId: task.id,
          agentId: task.assignedAgentId,
          launchClaimId: launchClaim.claim.id,
          startedAt,
        } }] satisfies PendingRuntimeEvent[],
        result: undefined,
      }),
    );
    const bridge = new BoundedOrchestratorBridge({
      task,
      executionId,
      ledger,
      scheduler,
      childLauncher,
      nextCallId: (tool) => `tool-call:deterministic:${tool}:${canonicalSha256({ executionId, tool })}`,
    });
    let outcome: "completed" | "no_request" | "withheld" = "no_request";
    let reason = "The deterministic test seam deliberately issued no child request.";
    if (this.mode === "spawn_one") {
      const evidenceIds = task.jobContext.detectorEvidence.map((evidence) => evidence.artifactId);
      await bridge.spawn({
        workloadKey: `deterministic-child:${ledger.runId}`,
        objective:
          "Exercise only the existing bounded v1 media/evidence receipt path and submit one structural execution report without semantic media, transcription, translation, synthesis, caption, or quality claims.",
        workerKind: "analysis",
        workerLabel: "deterministic-bounded-child",
        mediaScope: task.mediaScope,
        inputArtifactIds: [task.jobContext.source.artifactId, ...evidenceIds],
        requiredOutputs: [{ name: "execution report", artifactKind: "worker-execution-report", required: true }],
        requiredCapabilities: [
          "media.seek",
          ...(evidenceIds.length > 0 ? ["evidence.read" as const, "analysis.evidence.assess" as const, "analysis.evidence.decide" as const] : []),
          "report.submit",
        ],
        dependencyWorkloadKeys: [],
        budget: { wallMs: 45_000, toolCalls: 1 + evidenceIds.length + (evidenceIds.length > 0 ? 2 : 0) },
      });
      const waited = await bridge.wait({}) as ReportsWaitToolResult;
      outcome = waited.result === "all_terminal" ? "completed" : "withheld";
      reason = waited.result === "all_terminal"
        ? "The deterministic test seam completed its single host-authored child contract and wait."
        : `The deterministic test seam retained the closed wait failure ${waited.failure}.`;
    }
    await ledger.transact(
      { producer: { kind: "launcher", id: "deterministic-test-orchestrator" }, causationId: executionId },
      () => ({
        pending: [{ type: "orchestrator.decision_recorded", data: {
          decision: { executionId, taskId: task.id, outcome, reason },
        } }] satisfies PendingRuntimeEvent[],
        result: undefined,
      }),
    );
    const span = this.span(task, executionId, startedAt);
    await artifacts.storeJson(span);
    await ledger.transact(
      { producer: { kind: "launcher", id: "deterministic-test-orchestrator" }, causationId: executionId },
      () => ({ pending: [{ type: "executor.finished", data: { receipt: span } }] satisfies PendingRuntimeEvent[], result: undefined }),
    );
  }
}

/** Explicit fake seam for contract/restart tests; it is never model-directed planning evidence. */
export function deterministicOrchestratorLauncherFactory(
  options: DeterministicOrchestratorOptions = {},
): BoundedOrchestratorLauncherFactory {
  return (context) => new DeterministicOrchestratorLauncher(context, options);
}
