import { randomUUID } from "node:crypto";

import type { RuntimeLedger } from "../journal.ts";
import type {
  LaunchPermit,
  OrchestratorSpawnContract,
  TaskRecord,
  TerminalChildIdentity,
} from "../model.ts";
import type { PendingRuntimeEvent } from "../protocol.ts";
import { BoundedRuntimeScheduler, type SpawnDecision } from "../scheduler.ts";
import { assertOrchestratorSpawnContract } from "../validation/scheduling.ts";

export const ORCHESTRATOR_SPAWN_TOOL = "task_spawn_request" as const;
export const ORCHESTRATOR_WAIT_TOOL = "task_reports_wait" as const;

export interface OrchestratorToolManifest {
  schema: "studio.orchestrator-tools.v1";
  tools: [
    { name: typeof ORCHESTRATOR_SPAWN_TOOL; capability: "task.spawn.request" },
    { name: typeof ORCHESTRATOR_WAIT_TOOL; capability: "task.reports.wait" },
  ];
}

export interface SpawnToolResult {
  schema: "studio.orchestrator-spawn-result.v1";
  requestId: string;
  decision: "accepted" | "rejected";
  rejection: SpawnDecision["rejection"];
}

export interface ReportsWaitToolResult {
  schema: "studio.orchestrator-reports-wait-result.v1";
  result: "all_terminal" | "closed_failure";
  failure: "no_children" | "child_interrupted" | "child_failed" | null;
  children: TerminalChildIdentity[];
}

interface ChildLauncher {
  launch(permit: LaunchPermit): Promise<unknown>;
}

type ErrorCode = "invalid_request" | "capability_not_granted" | "operation_rejected" | "bridge_unavailable";

export class OrchestratorBridgeError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = "OrchestratorBridgeError";
    this.code = code;
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function exact(item: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(item).length === keys.length && keys.every((key) => key in item);
}

function terminalIdentity(ledger: RuntimeLedger, taskId: string): TerminalChildIdentity {
  const state = ledger.state();
  const task = state.tasks[taskId];
  if (!task || !new Set(["reported", "completed", "failed", "withheld", "interrupted"]).has(task.status)) {
    throw new OrchestratorBridgeError("operation_rejected", "A child did not reach a closed report or failure state.");
  }
  const report = Object.values(state.reports).find((candidate) => candidate.taskId === task.id) ?? null;
  const failed = task.status === "failed" || task.status === "withheld" || task.status === "interrupted";
  if (failed && !task.terminalReason) {
    throw new OrchestratorBridgeError("operation_rejected", "A terminal child failure has no closed reason.");
  }
  return {
    taskId: task.id,
    status: task.status as TerminalChildIdentity["status"],
    reportId: report?.id ?? null,
    artifactIds: report ? [...report.outputArtifactIds] : [],
    failure: failed
      ? { state: task.status as "failed" | "withheld" | "interrupted", reason: task.terminalReason! }
      : null,
  };
}

/** Model bridge: injects all authority and starts accepted children without awaiting them. */
export class BoundedOrchestratorBridge {
  private readonly task: TaskRecord;
  private readonly executionId: string;
  private readonly ledger: RuntimeLedger;
  private readonly scheduler: BoundedRuntimeScheduler;
  private readonly childLauncher: ChildLauncher;
  private readonly launches = new Map<string, Promise<void>>();
  private readonly nextCallId: (tool: typeof ORCHESTRATOR_SPAWN_TOOL | typeof ORCHESTRATOR_WAIT_TOOL) => string;

  constructor(input: {
    task: TaskRecord;
    executionId: string;
    ledger: RuntimeLedger;
    scheduler: BoundedRuntimeScheduler;
    childLauncher: ChildLauncher;
    nextCallId?: (tool: typeof ORCHESTRATOR_SPAWN_TOOL | typeof ORCHESTRATOR_WAIT_TOOL) => string;
  }) {
    this.task = structuredClone(input.task);
    this.executionId = input.executionId;
    this.ledger = input.ledger;
    this.scheduler = input.scheduler;
    this.childLauncher = input.childLauncher;
    this.nextCallId = input.nextCallId ?? ((tool) => `tool-call:${tool}:${randomUUID()}`);
  }

  manifest(): OrchestratorToolManifest {
    const capabilities = new Set(this.task.grants.map((grant) => grant.capability));
    if (
      this.task.workerKind !== "orchestrator" ||
      capabilities.size !== 2 ||
      !capabilities.has("task.spawn.request") ||
      !capabilities.has("task.reports.wait")
    ) {
      throw new OrchestratorBridgeError(
        "capability_not_granted",
        "The root orchestrator requires exactly task.spawn.request and task.reports.wait.",
      );
    }
    return {
      schema: "studio.orchestrator-tools.v1",
      tools: [
        { name: ORCHESTRATOR_SPAWN_TOOL, capability: "task.spawn.request" },
        { name: ORCHESTRATOR_WAIT_TOOL, capability: "task.reports.wait" },
      ],
    };
  }

  private async recordCall(
    callId: string,
    tool: typeof ORCHESTRATOR_SPAWN_TOOL | typeof ORCHESTRATOR_WAIT_TOOL,
  ): Promise<void> {
    await this.ledger.transact(
      { producer: { kind: "launcher", id: "model-orchestrator-bridge" }, causationId: this.executionId },
      ({ state }) => {
        const task = state.tasks[this.task.id];
        const execution = state.executions[this.executionId];
        const calls = Object.values(state.orchestratorToolCalls).filter((call) => call.taskId === this.task.id).length;
        if (
          task?.ownerAgentId !== this.task.assignedAgentId ||
          execution?.status !== "active" ||
          execution.taskId !== task.id ||
          calls >= task.budget.toolCalls
        ) throw new OrchestratorBridgeError("capability_not_granted", "The orchestrator tool-call grant or budget is unavailable.");
        return {
          pending: [{
            type: "orchestrator.tool_called",
            data: { callId, executionId: this.executionId, taskId: task.id, tool },
          }] satisfies PendingRuntimeEvent[],
          result: undefined,
        };
      },
    );
  }

  async spawn(value: unknown): Promise<SpawnToolResult> {
    this.manifest();
    try {
      assertOrchestratorSpawnContract(value);
    } catch {
      throw new OrchestratorBridgeError(
        "invalid_request",
        "task_spawn_request accepts only the closed child contract; task, agent, grant, and dependency task ids are unavailable.",
      );
    }
    const contract: OrchestratorSpawnContract = structuredClone(value);
    const callId = this.nextCallId(ORCHESTRATOR_SPAWN_TOOL);
    await this.recordCall(callId, ORCHESTRATOR_SPAWN_TOOL);
    let decision: SpawnDecision;
    try {
      decision = await this.scheduler.requestModelSpawn(
        this.task.id,
        this.task.assignedAgentId,
        this.executionId,
        callId,
        contract,
      );
    } catch {
      throw new OrchestratorBridgeError("operation_rejected", "The scheduler rejected the model-authored spawn operation.");
    }
    if (decision.permit) {
      const permit = decision.permit;
      const launch = this.childLauncher.launch(permit).then(() => undefined).catch(async (error: unknown) => {
        if (error instanceof Error && error.name === "RuntimeApplicationInterrupted") throw error;
        const child = this.ledger.state().tasks[permit.taskId];
        if (child && (child.status === "scheduled" || child.status === "working")) {
          if (child.ownerAgentId === permit.agentId) {
            await this.scheduler.transitionTask(
              child.id,
              permit.agentId,
              "failed",
              "The accepted child executor failed before making a terminal report available.",
            ).catch(() => undefined);
          }
        }
      });
      this.launches.set(permit.taskId, launch);
    }
    return {
      schema: "studio.orchestrator-spawn-result.v1",
      requestId: decision.requestId,
      decision: decision.accepted ? "accepted" : "rejected",
      rejection: decision.rejection,
    };
  }

  async wait(value: unknown): Promise<ReportsWaitToolResult> {
    this.manifest();
    const item = record(value);
    if (!item || !exact(item, [])) {
      throw new OrchestratorBridgeError("invalid_request", "task_reports_wait accepts only an empty object.");
    }
    const waitId = this.nextCallId(ORCHESTRATOR_WAIT_TOOL);
    await this.recordCall(waitId, ORCHESTRATOR_WAIT_TOOL);
    await this.scheduler.transitionTask(this.task.id, this.task.assignedAgentId, "waiting_for_children");
    await this.ledger.transact(
      { producer: { kind: "launcher", id: "model-orchestrator-bridge" }, causationId: waitId },
      () => ({
        pending: [{
          type: "reports.wait_started",
          data: { waitId, executionId: this.executionId, parentTaskId: this.task.id },
        }] satisfies PendingRuntimeEvent[],
        result: undefined,
      }),
    );
    const settled = await Promise.allSettled(this.launches.values());
    const interrupted = settled.find((result): result is PromiseRejectedResult =>
      result.status === "rejected" && result.reason instanceof Error && result.reason.name === "RuntimeApplicationInterrupted");
    if (interrupted) throw interrupted.reason;
    const state = this.ledger.state();
    const taskIds = Object.values(state.spawnRequests)
      .filter((request) => request.authoredByExecutionId === this.executionId && request.accepted === true && request.taskId)
      .map((request) => request.taskId!)
      .sort();
    const children = taskIds.map((taskId) => terminalIdentity(this.ledger, taskId));
    const failure = children.length === 0
      ? "no_children" as const
      : children.some((child) => child.status === "interrupted")
        ? "child_interrupted" as const
        : children.some((child) => child.status === "failed" || child.status === "withheld")
          ? "child_failed" as const
          : null;
    const result = failure === null ? "all_terminal" as const : "closed_failure" as const;
    await this.ledger.transact(
      { producer: { kind: "launcher", id: "model-orchestrator-bridge" }, causationId: waitId },
      () => ({
        pending: [{ type: "reports.wait_returned", data: { waitId, result, failure, children } }] satisfies PendingRuntimeEvent[],
        result: undefined,
      }),
    );
    await this.scheduler.transitionTask(this.task.id, this.task.assignedAgentId, "working");
    return { schema: "studio.orchestrator-reports-wait-result.v1", result, failure, children };
  }
}
