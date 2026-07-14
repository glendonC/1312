import { randomBytes, randomUUID } from "node:crypto";

import { assertRuntimeLimits, assertSpawnRequestInput } from "./assertions.ts";
import type {
  AgentRecord,
  CapabilityGrant,
  LaunchPermit,
  MediaScope,
  RuntimeLimits,
  RuntimeProjection,
  SpawnRejection,
  SpawnRequestInput,
  TaskRecord,
  TaskStatus,
} from "./model.ts";
import type { RuntimeLedger } from "./journal.ts";
import type { PendingRuntimeEvent } from "./protocol.ts";

export interface RuntimeIdentityFactory {
  next(kind: "request" | "task" | "agent" | "grant"): string;
  secret(): string;
}

export class RandomRuntimeIdentityFactory implements RuntimeIdentityFactory {
  next(kind: "request" | "task" | "agent" | "grant"): string {
    return `${kind}:${randomUUID()}`;
  }

  secret(): string {
    return randomBytes(32).toString("hex");
  }
}

function active(status: TaskStatus): boolean {
  return status === "scheduled" || status === "working" || status === "reported";
}

function scopeContains(parent: MediaScope, child: MediaScope): boolean {
  return (
    parent.artifactId === child.artifactId &&
    parent.trackId === child.trackId &&
    child.startMs >= parent.startMs &&
    child.endMs <= parent.endMs
  );
}

function allocated(state: RuntimeProjection): { wallMs: number; toolCalls: number } {
  return Object.values(state.tasks).reduce(
    (total, task) => ({
      wallMs: total.wallMs + task.budget.wallMs,
      toolCalls: total.toolCalls + task.budget.toolCalls,
    }),
    { wallMs: 0, toolCalls: 0 },
  );
}

export interface SpawnDecision {
  requestId: string;
  accepted: boolean;
  rejection: SpawnRejection | null;
  permit: LaunchPermit | null;
}

export class BoundedRuntimeScheduler {
  private readonly permits = new Map<string, LaunchPermit>();
  private readonly ledger: RuntimeLedger;
  private readonly limits: RuntimeLimits;
  private readonly identities: RuntimeIdentityFactory;

  constructor(
    ledger: RuntimeLedger,
    limits: RuntimeLimits,
    identities: RuntimeIdentityFactory = new RandomRuntimeIdentityFactory(),
  ) {
    this.ledger = ledger;
    this.limits = limits;
    this.identities = identities;
    assertRuntimeLimits(limits);
  }

  private grants(taskId: string, agentId: string, input: SpawnRequestInput): CapabilityGrant[] {
    return [...input.requiredCapabilities]
      .sort()
      .map((capability) => ({
        id: this.identities.next("grant"),
        capability,
        taskId,
        agentId,
        mediaScope: capability.startsWith("media.") ? structuredClone(input.mediaScope) : [],
      }));
  }

  private scopeValid(state: RuntimeProjection, input: SpawnRequestInput): boolean {
    if (!input.mediaScope.every((scope) => input.inputArtifactIds.includes(scope.artifactId))) return false;
    return input.mediaScope.every((scope) => {
      const artifact = state.artifacts[scope.artifactId];
      return (
        artifact &&
        artifact.tracks.some((track) => track.id === scope.trackId) &&
        scope.endMs <= (artifact.durationMs ?? 0)
      );
    });
  }

  private capabilityValid(input: SpawnRequestInput): boolean {
    return (
      input.requiredCapabilities.length > 0 &&
      input.requiredCapabilities.every((capability) => this.limits.grantableCapabilities.includes(capability)) &&
      (!input.requiredCapabilities.some((capability) => capability.startsWith("media.")) || input.mediaScope.length > 0)
    );
  }

  async createRoot(inputValue: unknown): Promise<LaunchPermit> {
    assertSpawnRequestInput(inputValue, "Root task");
    const input = inputValue;
    const result = await this.ledger.transact(
      { producer: { kind: "scheduler", id: "bounded-scheduler" }, causationId: "root-task" },
      ({ state }) => {
        if (Object.values(state.tasks).some((task) => task.parentTaskId === null)) {
          throw new Error("Runtime already has a root task");
        }
        if (input.requiredOutputs.length === 0 || !input.requiredOutputs.some((output) => output.required)) {
          throw new Error("Root task requires at least one required output");
        }
        if (!this.scopeValid(state, input)) throw new Error("Root task media scope is not backed by registered artifacts");
        if (!this.capabilityValid(input)) throw new Error("Root task requests an unavailable capability");
        if (input.dependencies.length !== 0) throw new Error("Root task cannot have dependencies");
        if (
          input.budget.wallMs > this.limits.runBudget.wallMs ||
          input.budget.toolCalls > this.limits.runBudget.toolCalls
        ) {
          throw new Error("Root task exceeds the run budget");
        }
        const taskId = this.identities.next("task");
        const agentId = this.identities.next("agent");
        const permit: LaunchPermit = {
          requestId: "root-task",
          taskId,
          agentId,
          registrationSecret: this.identities.secret(),
        };
        const task: TaskRecord = {
          id: taskId,
          runId: state.runId,
          workloadKey: input.workloadKey,
          objective: input.objective,
          workerKind: input.workerKind,
          workerLabel: input.workerLabel,
          parentTaskId: null,
          parentAgentId: null,
          depth: 0,
          assignedAgentId: agentId,
          ownerAgentId: null,
          mediaScope: structuredClone(input.mediaScope),
          inputArtifactIds: [...input.inputArtifactIds],
          requiredOutputs: structuredClone(input.requiredOutputs),
          dependencies: [],
          budget: { ...input.budget },
          grants: this.grants(taskId, agentId, input),
          status: "scheduled",
        };
        return {
          pending: [{ type: "task.created", data: { task } }] satisfies PendingRuntimeEvent[],
          result: permit,
        };
      },
    );
    this.permits.set(result.result.requestId, result.result);
    return result.result;
  }

  private violation(
    state: RuntimeProjection,
    requestedByTaskId: string,
    requestedByAgentId: string,
    input: SpawnRequestInput,
  ): SpawnRejection | null {
    const parent = state.tasks[requestedByTaskId];
    if (
      !parent ||
      parent.ownerAgentId !== requestedByAgentId ||
      !active(parent.status) ||
      !parent.grants.some((grant) => grant.capability === "task.spawn.request")
    ) {
      return "requester_not_authorized";
    }
    if (parent.depth + 1 > this.limits.maxDepth) return "max_depth";
    if (Object.values(state.tasks).filter((task) => active(task.status)).length >= this.limits.maxActiveWorkers) {
      return "max_active_workers";
    }
    if (Object.values(state.tasks).some((task) => active(task.status) && task.workloadKey === input.workloadKey)) {
      return "duplicate_owner";
    }
    if (input.requiredOutputs.length === 0 || !input.requiredOutputs.some((output) => output.required)) {
      return "missing_output_contract";
    }
    if (!input.dependencies.every((id) => state.tasks[id]?.status === "completed")) {
      return "dependency_unavailable";
    }
    if (
      !input.inputArtifactIds.every((id) => Boolean(state.artifacts[id])) ||
      !input.inputArtifactIds.every((id) => parent.inputArtifactIds.includes(id)) ||
      !this.scopeValid(state, input) ||
      !input.mediaScope.every((child) => parent.mediaScope.some((allowed) => scopeContains(allowed, child)))
    ) {
      return "scope_violation";
    }
    if (!this.capabilityValid(input)) return "capability_not_grantable";
    const total = allocated(state);
    if (
      total.wallMs + input.budget.wallMs > this.limits.runBudget.wallMs ||
      total.toolCalls + input.budget.toolCalls > this.limits.runBudget.toolCalls
    ) {
      return "run_budget";
    }
    return null;
  }

  async requestSpawn(
    requestedByTaskId: string,
    requestedByAgentId: string,
    inputValue: unknown,
  ): Promise<SpawnDecision> {
    assertSpawnRequestInput(inputValue);
    const input = structuredClone(inputValue);
    const requestId = this.identities.next("request");
    const transaction = await this.ledger.transact<SpawnDecision>(
      {
        producer: { kind: "scheduler", id: "bounded-scheduler" },
        causationId: requestId,
        correlationId: requestId,
      },
      ({ state }) => {
        const requestEvent = {
          type: "spawn.requested" as const,
          data: { requestId, requestedByTaskId, requestedByAgentId, input },
        };
        const rejection = this.violation(state, requestedByTaskId, requestedByAgentId, input);
        if (rejection) {
          return {
            pending: [
              requestEvent,
              {
                type: "spawn.decided",
                data: { requestId, accepted: false, rejection, taskId: null, agentId: null, grants: [] },
              },
            ] satisfies PendingRuntimeEvent[],
            result: { requestId, accepted: false, rejection, permit: null },
          };
        }

        const parent = state.tasks[requestedByTaskId];
        const taskId = this.identities.next("task");
        const agentId = this.identities.next("agent");
        const grants = this.grants(taskId, agentId, input);
        const permit: LaunchPermit = {
          requestId,
          taskId,
          agentId,
          registrationSecret: this.identities.secret(),
        };
        const task: TaskRecord = {
          id: taskId,
          runId: state.runId,
          workloadKey: input.workloadKey,
          objective: input.objective,
          workerKind: input.workerKind,
          workerLabel: input.workerLabel,
          parentTaskId: parent.id,
          parentAgentId: parent.ownerAgentId,
          depth: parent.depth + 1,
          assignedAgentId: agentId,
          ownerAgentId: null,
          mediaScope: structuredClone(input.mediaScope),
          inputArtifactIds: [...input.inputArtifactIds],
          requiredOutputs: structuredClone(input.requiredOutputs),
          dependencies: [...input.dependencies],
          budget: { ...input.budget },
          grants,
          status: "scheduled",
        };
        return {
          pending: [
            requestEvent,
            {
              type: "spawn.decided",
              data: { requestId, accepted: true, rejection: null, taskId, agentId, grants },
            },
            { type: "task.created", data: { task } },
          ] satisfies PendingRuntimeEvent[],
          result: { requestId, accepted: true, rejection: null, permit },
        };
      },
    );
    if (transaction.result.permit) this.permits.set(requestId, transaction.result.permit);
    return transaction.result;
  }

  /** Registration is explicit. A worker launcher must call this only after its executor exists. */
  async registerAgent(permitValue: LaunchPermit): Promise<AgentRecord> {
    const expected = this.permits.get(permitValue.requestId);
    if (
      !expected ||
      expected.taskId !== permitValue.taskId ||
      expected.agentId !== permitValue.agentId ||
      expected.registrationSecret !== permitValue.registrationSecret
    ) {
      throw new Error("Agent registration permit is missing or invalid");
    }
    const transaction = await this.ledger.transact(
      { producer: { kind: "registry", id: "dynamic-agent-registry" }, causationId: permitValue.requestId },
      ({ state }) => {
        const task = state.tasks[permitValue.taskId];
        if (!task || task.assignedAgentId !== permitValue.agentId || task.ownerAgentId !== null) {
          throw new Error("Agent registration task is not available");
        }
        const agent: AgentRecord = {
          id: permitValue.agentId,
          taskId: task.id,
          parentTaskId: task.parentTaskId,
          parentAgentId: task.parentAgentId,
          kind: task.workerKind,
          label: task.workerLabel,
          grants: structuredClone(task.grants),
          status: "registered",
        };
        return {
          pending: [{ type: "agent.registered", data: { agent } }] satisfies PendingRuntimeEvent[],
          result: agent,
        };
      },
    );
    this.permits.delete(permitValue.requestId);
    return transaction.result;
  }

  async transitionTask(taskId: string, agentId: string, status: TaskStatus, reason: string | null = null): Promise<void> {
    if ((status === "failed" || status === "withheld") && !reason?.trim()) {
      throw new Error(`${status} transitions require a reason`);
    }
    await this.ledger.transact(
      { producer: { kind: "scheduler", id: "bounded-scheduler" }, causationId: taskId },
      () => ({
        pending: [{ type: "task.transitioned", data: { taskId, agentId, status, reason } }] satisfies PendingRuntimeEvent[],
        result: undefined,
      }),
    );
  }
}
