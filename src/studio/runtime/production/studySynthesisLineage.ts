import type {
  OwnedMediaStudyChildDisposition,
  OwnedMediaStudyFollowUpHistory,
  RuntimeProjection,
} from "./model.ts";

export function deriveOwnedMediaStudyChildDispositions(
  state: RuntimeProjection,
  rootTaskId: string,
): OwnedMediaStudyChildDisposition[] {
  return Object.values(state.tasks)
    .filter((task) => task.parentTaskId === rootTaskId)
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((task) => {
      const report = Object.values(state.reports).find((candidate) => candidate.taskId === task.id) ?? null;
      const disposition = report
        ? Object.values(state.parentArtifactDispositions).find((candidate) => candidate.reportId === report.id) ?? null
        : null;
      if (disposition) {
        return {
          childTaskId: task.id,
          childAgentId: task.assignedAgentId,
          reportId: report!.id,
          artifactId: disposition.inputArtifactId,
          outcome: disposition.outcome,
          reason: report!.decisionReason!,
          dispositionId: disposition.id,
          admissionId: disposition.admissionId,
        };
      }
      if (task.status === "failed" || task.status === "withheld" || task.status === "interrupted") {
        return {
          childTaskId: task.id,
          childAgentId: task.assignedAgentId,
          reportId: report?.id ?? null,
          artifactId: report?.study?.output.artifactId ?? null,
          outcome: task.status,
          reason: task.terminalReason!,
          dispositionId: null,
          admissionId: null,
        };
      }
      throw new Error(`Child task ${task.id} has no accepted/rejected disposition or closed failure state`);
    });
}

export function deriveOwnedMediaStudyFollowUpHistory(state: RuntimeProjection): OwnedMediaStudyFollowUpHistory[] {
  return Object.values(state.studyFollowUps)
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((followUp) => {
      const task = followUp.taskId ? state.tasks[followUp.taskId] : null;
      const report = task ? Object.values(state.reports).find((candidate) => candidate.taskId === task.id) ?? null : null;
      return {
        followUpId: followUp.id,
        planningDecisionId: followUp.planningDecisionId,
        cause: structuredClone(followUp.cause),
        spawnRequestId: followUp.spawnRequestId,
        accepted: followUp.accepted,
        rejection: followUp.rejection,
        taskId: followUp.taskId,
        agentId: followUp.agentId,
        terminal: task
          ? {
              status: task.status as "reported" | "completed" | "failed" | "withheld" | "interrupted",
              reportId: report?.id ?? null,
              reason: task.terminalReason,
            }
          : null,
      };
    });
}
