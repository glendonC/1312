import type { RestudiedResearchBasis, RuntimeProjection } from "../model.ts";
import { restudiedResearchBasisId } from "../validation/research.ts";

/**
 * Synchronous projection check shared by candidate recording, replay, and scheduler admission.
 * It closes only current admission/read/pass identities; the deeper stored-byte audit remains in
 * RestudiedStudySynthesisHost and is never duplicated inside the scheduler or reducer.
 */
export function currentRestudiedResearchBasis(
  state: RuntimeProjection,
  root: { taskId: string; agentId: string; executionId: string },
): RestudiedResearchBasis {
  const task = state.tasks[root.taskId];
  const execution = state.executions[root.executionId];
  if (
    !task || task.parentTaskId !== null || task.assignedAgentId !== root.agentId ||
    !execution || execution.taskId !== task.id || execution.agentId !== root.agentId
  ) throw new Error("Restudied research basis lost its exact root executor");

  const admissions = Object.values(state.generalizedParentArtifactAdmissions)
    .filter((entry) => entry.contractVersion === 2 && entry.parentTaskId === root.taskId && entry.parentAgentId === root.agentId)
    .sort((left, right) => left.admissionId.localeCompare(right.admissionId));
  if (admissions.length < 2) throw new Error("Restudied research basis requires at least two admitted reports");

  const reports = admissions.map((admission) => {
    const reads = Object.values(state.generalizedParentArtifactReads).filter((entry) =>
      entry.contractVersion === 2 && entry.parentTaskId === root.taskId && entry.parentAgentId === root.agentId &&
      entry.admissionId === admission.admissionId && entry.reportArtifactId === admission.report.artifactId &&
      entry.reportContentId === admission.report.contentId && entry.status === "completed");
    if (reads.length !== 1) throw new Error(`Restudied research basis requires one exact read for admission ${admission.admissionId}`);
    return {
      admissionId: admission.admissionId,
      admissionReceiptContentId: admission.receiptContentId,
      reportArtifactId: admission.report.artifactId,
      reportContentId: admission.report.contentId,
      readOperationId: reads[0].id,
      readReceiptContentId: reads[0].receiptContentId,
    };
  });

  const passes = Object.values(state.rangePasses)
    .filter((entry) => entry.accepted && entry.request.root.taskId === root.taskId && entry.request.root.agentId === root.agentId)
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((pass) => {
      if (!pass.terminal || !pass.terminalReceiptContentId) {
        throw new Error(`Restudied research basis pass ${pass.id} is not terminal`);
      }
      return {
        passId: pass.id,
        requestReceiptContentId: pass.requestReceiptContentId,
        terminalReceiptContentId: pass.terminalReceiptContentId,
      };
    });

  const body: Omit<RestudiedResearchBasis, "basisId"> = {
    root: structuredClone(root),
    reports,
    passes,
  };
  return { basisId: restudiedResearchBasisId(body), ...body };
}
