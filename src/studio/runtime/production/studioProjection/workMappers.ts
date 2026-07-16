import type { RuntimeProjection } from "../model.ts";
import type {
  ProductionStudioGrantView,
  ProductionStudioOperationView,
  ProductionStudioReportView,
  ProductionStudioSpawnView,
  ProductionStudioTaskView,
  ProductionStudioWorkerView,
} from "./model.ts";

export function projectTasks(state: RuntimeProjection) {
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
  return tasks;
}


export function projectGrants(state: RuntimeProjection) {
  const grants = Object.values(state.tasks)
    .flatMap((task) => task.grants.map((grant): ProductionStudioGrantView => ({
      grantId: grant.id,
      taskId: grant.taskId,
      agentId: grant.agentId,
      capability: grant.capability,
      mediaScope: structuredClone(grant.mediaScope),
      evidenceScope: structuredClone(grant.evidenceScope),
      assessmentScope: structuredClone(grant.assessmentScope),
      decisionScope: structuredClone(grant.decisionScope),
    })))
    .sort((left, right) => left.taskId.localeCompare(right.taskId) || left.grantId.localeCompare(right.grantId));
  if (new Set(grants.map((grant) => grant.grantId)).size !== grants.length) {
    throw new Error("Production Studio projection: grant identities must be unique across tasks");
  }
  return grants;
}


export function projectReports(state: RuntimeProjection) {
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
  return reports;
}


export function projectSpawnRequests(state: RuntimeProjection) {
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
  return spawnRequests;
}


export function projectOperations(state: RuntimeProjection) {
  const operations = Object.values(state.operations)
    .map((operation): ProductionStudioOperationView => ({
      operationId: operation.id,
      capability: operation.capability,
      status: operation.status,
      taskId: operation.taskId,
      agentId: operation.agentId,
      grantId: operation.grantId,
      inputArtifactId: operation.artifactId,
      trackId: operation.trackId,
      startMs: operation.startMs,
      endMs: operation.endMs,
      requestedDurationMs: operation.endMs - operation.startMs,
      outputArtifactId: operation.outputArtifactId,
      receiptId: operation.receiptId,
      observation: structuredClone(operation.observation),
      failure: operation.failure,
    }))
    .sort((left, right) => left.operationId.localeCompare(right.operationId));
  return operations;
}


export function projectWorkers(state: RuntimeProjection) {
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
  return workers;
}
