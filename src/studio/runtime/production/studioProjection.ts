import { assertRuntimeEvent } from "./assertions.ts";
import type {
  Capability,
  MediaScope,
  RequiredOutput,
  RuntimeProjection,
  SpawnRejection,
  TaskStatus,
  WorkerKind,
} from "./model.ts";
import type { RuntimeEvent } from "./protocol.ts";
import { applyRuntimeEvent, initialRuntimeProjection } from "./projection.ts";

export interface ProductionStudioTaskView {
  taskId: string;
  workloadKey: string;
  objective: string;
  kind: WorkerKind;
  label: string;
  parentTaskId: string | null;
  parentAgentId: string | null;
  depth: number;
  assignedAgentId: string;
  ownerAgentId: string | null;
  status: TaskStatus;
  mediaScope: MediaScope[];
  inputArtifactIds: string[];
  requiredOutputs: RequiredOutput[];
  dependencies: string[];
}

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

export interface ProductionStudioGrantView {
  grantId: string;
  taskId: string;
  agentId: string;
  capability: Capability;
  mediaScope: MediaScope[];
}

export interface ProductionStudioReportView {
  reportId: string;
  taskId: string;
  agentId: string;
  parentTaskId: string;
  parentAgentId: string;
  outputArtifactIds: string[];
  summary: string;
  status: "submitted" | "accepted" | "rejected";
  decisionReason: string | null;
}

export interface ProductionStudioSpawnView {
  requestId: string;
  requestedByTaskId: string;
  requestedByAgentId: string;
  workloadKey: string;
  objective: string;
  workerKind: WorkerKind;
  workerLabel: string;
  mediaScope: MediaScope[];
  inputArtifactIds: string[];
  requiredOutputs: RequiredOutput[];
  requiredCapabilities: Capability[];
  dependencies: string[];
  decision: "pending" | "accepted" | "rejected";
  rejection: SpawnRejection | null;
  taskId: string | null;
  agentId: string | null;
}

export type ProductionStudioOutputArtifactOrigin =
  | {
      kind: "media_operation" | "media_observation";
      operationId: string;
      receiptId: string;
      receiptContentId: string;
    }
  | {
      kind: "worker_output";
      executionId: string;
      receiptId: string;
      receiptContentId: string;
    };

export interface ProductionStudioOutputArtifactView {
  artifactId: string;
  kind: string;
  mediaClass: "derived" | "non_media";
  publication: "private" | "public";
  contentId: string;
  bytes: number;
  durationMs: number | null;
  producerTaskId: string;
  producerAgentId: string;
  sourceArtifactIds: string[];
  origin: ProductionStudioOutputArtifactOrigin;
  reportIds: string[];
}

export interface ProductionStudioProjection {
  schema: "studio.production-projection.v1";
  source: {
    kind: "production_runtime_journal";
    recordedDemo: false;
  };
  runId: string;
  lastSeq: number;
  tasks: ProductionStudioTaskView[];
  workers: ProductionStudioWorkerView[];
  grants: ProductionStudioGrantView[];
  reports: ProductionStudioReportView[];
  spawnRequests: ProductionStudioSpawnView[];
  outputArtifacts: ProductionStudioOutputArtifactView[];
  counts: {
    tasks: number;
    workers: number;
    grants: number;
    executions: number;
    reports: number;
    spawnRequests: number;
    outputArtifacts: number;
  };
}

export function adaptProductionRuntime(state: RuntimeProjection): ProductionStudioProjection {
  const tasks = Object.values(state.tasks)
    .map((task): ProductionStudioTaskView => ({
      taskId: task.id,
      workloadKey: task.workloadKey,
      objective: task.objective,
      kind: task.workerKind,
      label: task.workerLabel,
      parentTaskId: task.parentTaskId,
      parentAgentId: task.parentAgentId,
      depth: task.depth,
      assignedAgentId: task.assignedAgentId,
      ownerAgentId: task.ownerAgentId,
      status: task.status,
      mediaScope: structuredClone(task.mediaScope),
      inputArtifactIds: [...task.inputArtifactIds],
      requiredOutputs: structuredClone(task.requiredOutputs),
      dependencies: [...task.dependencies],
    }))
    .sort((left, right) => left.depth - right.depth || left.taskId.localeCompare(right.taskId));

  const grants = Object.values(state.tasks)
    .flatMap((task) => task.grants.map((grant): ProductionStudioGrantView => ({
      grantId: grant.id,
      taskId: grant.taskId,
      agentId: grant.agentId,
      capability: grant.capability,
      mediaScope: structuredClone(grant.mediaScope),
    })))
    .sort((left, right) => left.taskId.localeCompare(right.taskId) || left.grantId.localeCompare(right.grantId));
  if (new Set(grants.map((grant) => grant.grantId)).size !== grants.length) {
    throw new Error("Production Studio projection: grant identities must be unique across tasks");
  }

  const reports = Object.values(state.reports)
    .map((report): ProductionStudioReportView => ({
      reportId: report.id,
      taskId: report.taskId,
      agentId: report.agentId,
      parentTaskId: report.parentTaskId,
      parentAgentId: report.parentAgentId,
      outputArtifactIds: [...report.outputArtifactIds],
      summary: report.summary,
      status: report.status,
      decisionReason: report.decisionReason,
    }))
    .sort((left, right) => left.reportId.localeCompare(right.reportId));

  const spawnRequests = Object.values(state.spawnRequests)
    .map((request): ProductionStudioSpawnView => ({
      requestId: request.id,
      requestedByTaskId: request.requestedByTaskId,
      requestedByAgentId: request.requestedByAgentId,
      workloadKey: request.input.workloadKey,
      objective: request.input.objective,
      workerKind: request.input.workerKind,
      workerLabel: request.input.workerLabel,
      mediaScope: structuredClone(request.input.mediaScope),
      inputArtifactIds: [...request.input.inputArtifactIds],
      requiredOutputs: structuredClone(request.input.requiredOutputs),
      requiredCapabilities: [...request.input.requiredCapabilities].sort(),
      dependencies: [...request.input.dependencies],
      decision: request.accepted === null ? "pending" : request.accepted ? "accepted" : "rejected",
      rejection: request.rejection,
      taskId: request.taskId,
      agentId: request.agentId,
    }))
    .sort((left, right) => left.requestId.localeCompare(right.requestId));

  const outputArtifacts = Object.values(state.artifacts)
    .filter((artifact) => artifact.origin.kind !== "ingest")
    .map((artifact): ProductionStudioOutputArtifactView => {
      if (artifact.origin.kind === "ingest") {
        throw new Error(`Production Studio projection: output artifact ${artifact.id} has an ingest origin`);
      }
      if (artifact.producerTaskId === null || artifact.producerAgentId === null) {
        throw new Error(`Production Studio projection: output artifact ${artifact.id} has no task and worker producer`);
      }
      if (artifact.mediaClass === "raw") {
        throw new Error(`Production Studio projection: output artifact ${artifact.id} is incorrectly marked raw`);
      }
      const reportIds = reports
        .filter((report) => report.outputArtifactIds.includes(artifact.id))
        .map((report) => report.reportId);
      return {
        artifactId: artifact.id,
        kind: artifact.kind,
        mediaClass: artifact.mediaClass,
        publication: artifact.publication,
        contentId: artifact.content.contentId,
        bytes: artifact.content.bytes,
        durationMs: artifact.durationMs,
        producerTaskId: artifact.producerTaskId,
        producerAgentId: artifact.producerAgentId,
        sourceArtifactIds: [...artifact.sourceArtifactIds],
        origin: structuredClone(artifact.origin),
        reportIds,
      };
    })
    .sort((left, right) => left.artifactId.localeCompare(right.artifactId));

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
    tasks,
    workers,
    grants,
    reports,
    spawnRequests,
    outputArtifacts,
    counts: {
      tasks: tasks.length,
      workers: workers.length,
      grants: grants.length,
      executions: Object.keys(state.executions).length,
      reports: reports.length,
      spawnRequests: spawnRequests.length,
      outputArtifacts: outputArtifacts.length,
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
    return this.appendBatch([candidate]);
  }

  /** A rejected event leaves the adapter at the last completely accepted poll batch. */
  appendBatch(candidates: readonly unknown[]): ProductionStudioProjection {
    let next = this.state;
    for (const candidate of candidates) next = applyRuntimeEvent(next, candidate);
    const view = adaptProductionRuntime(next);
    this.state = next;
    return view;
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
  events.forEach((event, index) => assertRuntimeEvent(event, `Production Studio journal event ${index + 1}`));
  return adapter.appendBatch(events);
}
