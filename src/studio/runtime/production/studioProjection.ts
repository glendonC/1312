import { assertRuntimeEvent } from "./assertions.ts";
import type { MediaScope, RuntimeProjection, WorkerKind } from "./model.ts";
import type { RuntimeEvent } from "./protocol.ts";
import { applyRuntimeEvent, initialRuntimeProjection } from "./projection.ts";

export interface ProductionStudioWorkerView {
  agentId: string;
  taskId: string;
  label: string;
  kind: WorkerKind;
  status: "registered" | "working" | "reporting" | "retired";
  taskStatus: "scheduled" | "working" | "reported" | "completed" | "failed" | "withheld";
  objective: string;
  parentAgentId: string | null;
  parentTaskId: string | null;
  depth: number;
  capabilities: string[];
  mediaScope: MediaScope[];
  execution: null | {
    id: string;
    status: "active" | "completed" | "failed" | "timed_out";
    activeDurationMs: number | null;
    usage: null | {
      model: string | null;
      inputTokens: number;
      cachedInputTokens: number;
      outputTokens: number;
      reasoningOutputTokens: number;
      billedAmount: null;
    };
  };
  report: null | {
    id: string;
    status: "submitted" | "accepted" | "rejected";
    summary: string;
  };
}

export interface ProductionStudioProjection {
  schema: "studio.production-projection.v1";
  source: {
    kind: "production_runtime_journal";
    recordedDemo: false;
  };
  runId: string;
  lastSeq: number;
  workers: ProductionStudioWorkerView[];
  counts: {
    tasks: number;
    workers: number;
    executions: number;
    reports: number;
  };
}

export function adaptProductionRuntime(state: RuntimeProjection): ProductionStudioProjection {
  const workers = Object.values(state.agents)
    .map((agent): ProductionStudioWorkerView => {
      const task = state.tasks[agent.taskId];
      if (!task) throw new Error(`Production Studio projection: agent ${agent.id} has no task`);
      const execution = Object.values(state.executions)
        .filter((candidate) => candidate.agentId === agent.id && candidate.taskId === task.id)
        .sort((left, right) => left.startedAt.localeCompare(right.startedAt))
        .at(-1);
      const usage = execution?.modelUsageReceiptId
        ? state.modelUsage[execution.modelUsageReceiptId]
        : null;
      const report = Object.values(state.reports)
        .filter((candidate) => candidate.agentId === agent.id && candidate.taskId === task.id)
        .at(-1);
      return {
        agentId: agent.id,
        taskId: task.id,
        label: agent.label,
        kind: agent.kind,
        status: agent.status,
        taskStatus: task.status,
        objective: task.objective,
        parentAgentId: agent.parentAgentId,
        parentTaskId: agent.parentTaskId,
        depth: task.depth,
        capabilities: task.grants.map((grant) => grant.capability).sort(),
        mediaScope: structuredClone(task.mediaScope),
        execution: execution
          ? {
              id: execution.id,
              status: execution.status,
              activeDurationMs: execution.receipt?.monotonicDurationMs ?? null,
              usage: usage
                ? {
                    model: usage.model,
                    inputTokens: usage.measured.inputTokens,
                    cachedInputTokens: usage.measured.cachedInputTokens,
                    outputTokens: usage.measured.outputTokens,
                    reasoningOutputTokens: usage.measured.reasoningOutputTokens,
                    billedAmount: null,
                  }
                : null,
            }
          : null,
        report: report ? { id: report.id, status: report.status, summary: report.summary } : null,
      };
    })
    .sort((left, right) => left.depth - right.depth || left.agentId.localeCompare(right.agentId));

  return {
    schema: "studio.production-projection.v1",
    source: { kind: "production_runtime_journal", recordedDemo: false },
    runId: state.runId,
    lastSeq: state.lastSeq,
    workers,
    counts: {
      tasks: Object.keys(state.tasks).length,
      workers: workers.length,
      executions: Object.keys(state.executions).length,
      reports: Object.keys(state.reports).length,
    },
  };
}

/**
 * Separate production adapter. It consumes only `studio.runtime.event.v1` and never creates
 * legacy traces, RunBundles, or recorded-run identities.
 */
export class ProductionStudioAdapter {
  private state: RuntimeProjection;

  constructor(runId: string) {
    this.state = initialRuntimeProjection(runId);
  }

  append(candidate: unknown): ProductionStudioProjection {
    this.state = applyRuntimeEvent(this.state, candidate);
    return this.view();
  }

  view(): ProductionStudioProjection {
    return adaptProductionRuntime(this.state);
  }
}

export function projectProductionRuntimeJournal(events: readonly unknown[]): ProductionStudioProjection {
  if (events.length === 0) throw new Error("Production Studio journal is empty");
  assertRuntimeEvent(events[0], "Production Studio journal event 1");
  const first = events[0] as RuntimeEvent;
  const adapter = new ProductionStudioAdapter(first.runId);
  events.forEach((event, index) => {
    assertRuntimeEvent(event, `Production Studio journal event ${index + 1}`);
    adapter.append(event);
  });
  return adapter.view();
}
