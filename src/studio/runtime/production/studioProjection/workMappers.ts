import type { RuntimeProjection } from "../model.ts";
import type {
  ProductionStudioGrantView,
  ProductionStudioOperationView,
  ProductionStudioReportView,
  ProductionStudioRootOutputDispositionView,
  ProductionStudioTaskLaunchView,
  ProductionStudioReportsWaitView,
  ProductionStudioOrchestratorDecisionView,
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
      terminalReason: task.terminalReason,
      jobContext: {
        contextId: task.jobContext.contextId,
        sourceArtifactId: task.jobContext.source.artifactId,
        sourceContentId: task.jobContext.source.contentId,
        analysisRequestId: task.jobContext.analysisRequest.requestId,
        requestedRange: { ...task.jobContext.analysisRequest.requestedRange },
        taskRange: { ...task.jobContext.analysisRequest.taskRange },
        requestedSourceLanguagePolicy: structuredClone(task.jobContext.requestedSourceLanguagePolicy),
        targetLanguage: task.jobContext.targetLanguage,
        selectedLanguagePackId: task.jobContext.selectedLanguagePackId,
        outputDepth: task.jobContext.outputDepth,
        detectorEvidence: structuredClone(task.jobContext.detectorEvidence),
      },
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
      authoredByExecutionId: request.authoredByExecutionId,
      toolCallId: request.toolCallId,
    }))
    .sort((left, right) => left.requestId.localeCompare(right.requestId));
  return spawnRequests;
}

export function projectTaskLaunches(state: RuntimeProjection) {
  return Object.values(state.taskLaunches)
    .map((launch): ProductionStudioTaskLaunchView => {
      const execution = launch.executionId ? state.executions[launch.executionId] : null;
      return {
        launchClaimId: launch.id,
        requestId: launch.requestId,
        taskId: launch.taskId,
        agentId: launch.agentId,
        executorKind: launch.executorKind,
        claimedAt: launch.claimedAt,
        executionId: launch.executionId,
        executorState: execution?.status ?? "claimed",
      };
    })
    .sort((left, right) => left.taskId.localeCompare(right.taskId));
}

export function projectReportWaits(state: RuntimeProjection) {
  return Object.values(state.reportWaits)
    .map((wait): ProductionStudioReportsWaitView => ({
      waitId: wait.id,
      executionId: wait.executionId,
      parentTaskId: wait.parentTaskId,
      status: wait.status,
      result: wait.result,
      failure: wait.failure,
      children: structuredClone(wait.children),
    }))
    .sort((left, right) => left.waitId.localeCompare(right.waitId));
}

export function projectOrchestratorDecisions(state: RuntimeProjection) {
  return Object.values(state.orchestratorDecisions)
    .map((decision): ProductionStudioOrchestratorDecisionView => structuredClone(decision))
    .sort((left, right) => left.executionId.localeCompare(right.executionId));
}


export function projectRootOutputDispositions(state: RuntimeProjection) {
  const dispositions = Object.values(state.rootOutputDispositions)
    .map((disposition): ProductionStudioRootOutputDispositionView => {
      const report = state.reports[disposition.reportId];
      if (!report?.decisionReason) {
        throw new Error(
          `Production Studio projection: root disposition ${disposition.id} has no decided report reason`,
        );
      }
      return {
        dispositionId: disposition.id,
        reportId: disposition.reportId,
        spawnRequestId: disposition.spawnRequestId,
        rootTaskId: disposition.rootTaskId,
        rootAgentId: disposition.rootAgentId,
        childTaskId: disposition.childTaskId,
        childAgentId: disposition.childAgentId,
        inputArtifactId: disposition.inputArtifactId,
        outputArtifactId: disposition.outputArtifactId,
        outcome: disposition.outcome,
        reason: report.decisionReason,
        receiptId: disposition.receiptId,
        receiptContentId: disposition.receiptContentId,
      };
    })
    .sort((left, right) => left.dispositionId.localeCompare(right.dispositionId));
  return dispositions;
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
              launchClaimId: execution.launchClaimId,
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
