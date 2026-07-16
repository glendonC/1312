import type { RuntimeProjection } from "../model.ts";
import type { RuntimeEvent } from "../protocol.ts";
import { invariant, sameGrants } from "./shared.ts";
import { deriveStudyReportCounts, validateCoveragePartition } from "../validation/studyReports.ts";

export function applyReportEvent(next: RuntimeProjection, event: RuntimeEvent): boolean {
  if (event.type === "report.submitted") {
    invariant(event.producer.kind === "handoff_host", event, "reports must come from the handoff host");
    const report = event.data.report;
    const task = next.tasks[report.taskId];
    invariant(task?.status === "working" && task.ownerAgentId === report.agentId, event, `report ${report.id} has no working owner`);
    invariant(task.grants.some((grant) => grant.capability === "report.submit"), event, `task ${task.id} cannot submit reports`);
    invariant(
      !Object.values(next.executions).some(
        (execution) => execution.taskId === task.id && execution.status === "active",
      ),
      event,
      `task ${task.id} cannot report while its executor is active`,
    );
    invariant(task.parentTaskId === report.parentTaskId && task.parentAgentId === report.parentAgentId, event, `report ${report.id} parentage changed`);
    invariant(!next.reports[report.id], event, `report ${report.id} is duplicated`);
    invariant(report.status === "submitted" && report.decisionReason === null, event, `report ${report.id} has a premature decision`);
    invariant(report.outputArtifactIds.length > 0, event, `report ${report.id} has no output artifacts`);
    invariant(
      report.outputArtifactIds.every((id) => {
        const artifact = next.artifacts[id];
        return artifact?.producerTaskId === task.id && artifact.producerAgentId === report.agentId;
      }),
      event,
      `report ${report.id} contains an artifact owned by another task`,
    );
    if (report.study) {
      validateCoveragePartition(report.study.coverage, task.mediaScope, `Runtime event ${event.eventId}: report ${report.id} coverage`);
      invariant(
        JSON.stringify(report.study.counts) === JSON.stringify(deriveStudyReportCounts({ coverage: report.study.coverage, claims: report.study.claims })),
        event,
        `report ${report.id} submitted non-derived coverage or citation counts`,
      );
      invariant(report.outputArtifactIds.length === 1 && report.outputArtifactIds[0] === report.study.output.artifactId, event, `report ${report.id} changed its typed output binding`);
      invariant(
        report.study.parentEdge.childTaskId === task.id && report.study.parentEdge.childAgentId === report.agentId &&
          report.study.parentEdge.parentTaskId === report.parentTaskId && report.study.parentEdge.parentAgentId === report.parentAgentId &&
          report.study.jobContextId === task.jobContext.contextId,
        event,
        `report ${report.id} changed its task context or parent edge`,
      );
      const artifact = next.artifacts[report.study.output.artifactId];
      invariant(
        artifact?.origin.kind === "study_report" && artifact.content.contentId === report.study.output.contentId &&
          artifact.content.bytes === report.study.output.bytes && artifact.origin.receiptId === report.study.executor.receiptId &&
          artifact.origin.receiptContentId === report.study.executor.receiptContentId,
        event,
        `report ${report.id} changed its study content or executor binding`,
      );
    }
    for (const output of task.requiredOutputs.filter((candidate) => candidate.required)) {
      invariant(
        report.outputArtifactIds.some((id) => next.artifacts[id]?.kind === output.artifactKind),
        event,
        `report ${report.id} does not satisfy ${output.name}`,
      );
    }
    next.reports[report.id] = report;
    task.status = "reported";
    next.agents[report.agentId].status = "reporting";
    return true;
  }

  if (event.type === "report.decided") {
    const report = next.reports[event.data.reportId];
    invariant(
      event.producer.kind === "handoff_host" || (event.producer.kind === "admission_host" && Boolean(report?.study)),
      event,
      "report decisions must come from the handoff host or atomic typed admission host",
    );
    invariant(report?.status === "submitted", event, `report ${event.data.reportId} is not pending`);
    const parent = next.tasks[report.parentTaskId];
    const child = next.tasks[report.taskId];
    invariant(parent?.ownerAgentId === event.data.decidedByAgentId && parent.id === event.data.decidedByTaskId, event, `report ${report.id} was decided outside its parent`);
    invariant(child?.status === "reported", event, `report ${report.id} child is not reported`);
    report.status = event.data.accepted ? "accepted" : "rejected";
    report.decisionReason = event.data.reason;
    child.status = event.data.accepted ? "completed" : "working";
    next.agents[report.agentId].status = event.data.accepted ? "retired" : "working";
    return true;
  }

  if (event.type === "root.output_disposition_recorded") {
    invariant(event.producer.kind === "handoff_host", event, "root output dispositions must come from the handoff host");
    const receipt = event.data.receipt;
    const artifact = next.artifacts[event.data.outputArtifactId];
    const report = next.reports[receipt.report.reportId];
    const input = next.artifacts[receipt.input.artifactId];
    const spawn = next.spawnRequests[receipt.delegation.spawnRequestId];
    const child = next.tasks[receipt.delegation.childTaskId];
    const expectedStatus = receipt.decision.outcome === "promoted_to_root" ? "accepted" : "rejected";
    invariant(!next.rootOutputDispositions[event.data.dispositionId], event, `root disposition ${event.data.dispositionId} is duplicated`);
    invariant(
      receipt.dispositionId === event.data.dispositionId,
      event,
      `root disposition ${event.data.dispositionId} changed identity`,
    );
    invariant(report?.status === expectedStatus, event, `root disposition ${receipt.dispositionId} has no matching report decision`);
    invariant(
      report.decisionReason === receipt.report.decisionReason &&
        report.taskId === receipt.delegation.childTaskId &&
        report.agentId === receipt.delegation.childAgentId &&
        report.parentTaskId === receipt.authority.rootTaskId &&
        report.parentAgentId === receipt.authority.rootAgentId &&
        report.outputArtifactIds.includes(receipt.input.artifactId),
      event,
      `root disposition ${receipt.dispositionId} changed report lineage`,
    );
    invariant(
      spawn?.accepted === true &&
        spawn.requestedByTaskId === receipt.authority.rootTaskId &&
        spawn.requestedByAgentId === receipt.authority.rootAgentId &&
        spawn.taskId === receipt.delegation.childTaskId &&
        spawn.agentId === receipt.delegation.childAgentId &&
        child?.workerKind === receipt.delegation.workerKind &&
        JSON.stringify(child.mediaScope) === JSON.stringify(receipt.delegation.mediaScope) &&
        sameGrants(child.grants, receipt.delegation.grants),
      event,
      `root disposition ${receipt.dispositionId} changed spawn, scope, or grant lineage`,
    );
    invariant(
      input?.origin.kind === "worker_output" &&
        input.id === receipt.input.artifactId &&
        input.content.contentId === receipt.input.contentId &&
        input.kind === receipt.input.kind &&
        input.producerTaskId === receipt.input.producerTaskId &&
        input.producerAgentId === receipt.input.producerAgentId &&
        input.origin.executionId === receipt.input.executionId &&
        input.origin.receiptId === receipt.input.executorReceiptId &&
        input.origin.receiptContentId === receipt.input.executorReceiptContentId,
      event,
      `root disposition ${receipt.dispositionId} changed child output identity`,
    );
    invariant(
      artifact?.origin.kind === "root_output_disposition" &&
        artifact.origin.dispositionId === receipt.dispositionId &&
        artifact.origin.reportId === receipt.report.reportId &&
        artifact.origin.inputArtifactId === receipt.input.artifactId &&
        artifact.origin.outcome === receipt.decision.outcome &&
        artifact.origin.receiptId === receipt.receiptId &&
        artifact.origin.receiptContentId === event.data.receiptContentId &&
        artifact.content.contentId === event.data.receiptContentId &&
        artifact.producerTaskId === receipt.authority.rootTaskId &&
        artifact.producerAgentId === receipt.authority.rootAgentId,
      event,
      `root disposition ${receipt.dispositionId} is not bound to its root-owned receipt artifact`,
    );
    next.rootOutputDispositions[receipt.dispositionId] = {
      id: receipt.dispositionId,
      reportId: receipt.report.reportId,
      spawnRequestId: receipt.delegation.spawnRequestId,
      rootTaskId: receipt.authority.rootTaskId,
      rootAgentId: receipt.authority.rootAgentId,
      childTaskId: receipt.delegation.childTaskId,
      childAgentId: receipt.delegation.childAgentId,
      inputArtifactId: receipt.input.artifactId,
      outputArtifactId: artifact.id,
      outcome: receipt.decision.outcome,
      receiptId: receipt.receiptId,
      receiptContentId: event.data.receiptContentId,
    };
    return true;
  }
  return false;
}
