import type { RuntimeProjection } from "../model.ts";
import type { RuntimeEvent } from "../protocol.ts";
import { invariant } from "./shared.ts";

function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function applyStudyReportEvent(next: RuntimeProjection, event: RuntimeEvent): boolean {
  if (event.type === "parent.generalized_admission_recorded") {
    invariant(event.producer.kind === "admission_host", event, "generalized parent admissions must come from the admission host");
    const receipt = event.data.receipt;
    const report = next.reports[event.data.reportId];
    const output = next.artifacts[event.data.outputArtifactId];
    const artifact = next.artifacts[event.data.admissionArtifactId];
    invariant(report?.study?.schema === "studio.study-report-submission.v2" && report.status === "accepted", event, `generalized admission ${receipt.admissionId} has no accepted v2 report`);
    invariant(!next.generalizedParentArtifactAdmissions[receipt.admissionId], event, `generalized admission ${receipt.admissionId} is duplicated`);
    invariant(
      output?.id === report.study.output.artifactId && output.kind === "studio.study-report.v2" &&
        receipt.report.artifactId === output.id && receipt.report.contentId === output.content.contentId && receipt.report.bytes === output.content.bytes &&
        receipt.task.taskId === report.taskId && receipt.task.agentId === report.agentId && receipt.task.jobContextId === report.study.jobContextId &&
        receipt.parent.taskId === report.parentTaskId && receipt.parent.agentId === report.parentAgentId &&
        artifact?.origin.kind === "generalized_parent_admission" && artifact.origin.admissionId === receipt.admissionId &&
        artifact.origin.reportId === report.id && artifact.origin.reportArtifactId === output.id &&
        artifact.origin.receiptId === receipt.receiptId && artifact.content.contentId === event.data.receiptContentId,
      event,
      `generalized admission ${receipt.admissionId} changed report, parent, executor, or stored receipt lineage`,
    );
    next.generalizedParentArtifactAdmissions[receipt.admissionId] = {
      contractVersion: 2,
      admissionId: receipt.admissionId,
      reportId: report.id,
      parentTaskId: report.parentTaskId,
      parentAgentId: report.parentAgentId,
      childTaskId: report.taskId,
      childAgentId: report.agentId,
      inputArtifactId: output.id,
      receiptId: receipt.receiptId,
      receiptContentId: event.data.receiptContentId,
      receiptArtifactId: artifact.id,
      report: structuredClone(receipt.report),
    };
    return true;
  }

  if (event.type === "parent.generalized_artifact_read_completed") {
    invariant(event.producer.kind === "artifact_read_host", event, "generalized parent reads must come from the artifact read host");
    const receipt = event.data.receipt;
    const admission = next.generalizedParentArtifactAdmissions[receipt.admission.admissionId];
    const artifact = next.artifacts[event.data.receiptArtifactId];
    invariant(admission?.contractVersion === 2, event, `generalized read ${receipt.operationId} has no v2 admission`);
    invariant(!next.generalizedParentArtifactReads[receipt.operationId], event, `generalized read ${receipt.operationId} is duplicated`);
    invariant(
      event.data.parentTaskId === admission.parentTaskId && event.data.parentAgentId === admission.parentAgentId &&
        receipt.runId === next.runId && receipt.admission.receiptId === admission.receiptId && receipt.admission.receiptContentId === admission.receiptContentId &&
        receipt.returned.artifactId === admission.inputArtifactId && receipt.returned.contentId === admission.report.contentId &&
        artifact?.origin.kind === "generalized_parent_artifact_read" && artifact.origin.operationId === receipt.operationId &&
        artifact.origin.admissionId === admission.admissionId && artifact.origin.reportArtifactId === admission.inputArtifactId &&
        artifact.origin.receiptId === receipt.receiptId && artifact.content.contentId === event.data.receiptContentId,
      event,
      `generalized read ${receipt.operationId} changed its admission, parent, report, or stored receipt lineage`,
    );
    next.generalizedParentArtifactReads[receipt.operationId] = {
      contractVersion: 2,
      id: receipt.operationId,
      parentTaskId: admission.parentTaskId,
      parentAgentId: admission.parentAgentId,
      admissionId: admission.admissionId,
      reportArtifactId: receipt.returned.artifactId,
      reportContentId: receipt.returned.contentId,
      status: "completed",
      receiptId: receipt.receiptId,
      receiptContentId: event.data.receiptContentId,
      receiptArtifactId: artifact.id,
    };
    return true;
  }

  if (event.type === "parent.artifact_disposition_recorded") {
    invariant(event.producer.kind === "admission_host", event, "parent dispositions must come from the admission host");
    const receipt = event.data.dispositionReceipt;
    const report = next.reports[receipt.report.reportId];
    const input = next.artifacts[receipt.output.artifactId];
    const dispositionArtifact = next.artifacts[event.data.dispositionArtifactId];
    const admission = event.data.admissionReceipt;
    const admissionArtifact = event.data.admissionArtifactId ? next.artifacts[event.data.admissionArtifactId] : null;
    invariant(!next.parentArtifactDispositions[receipt.dispositionId], event, `parent disposition ${receipt.dispositionId} is duplicated`);
    invariant(!Object.values(next.parentArtifactDispositions).some((record) => record.inputArtifactId === receipt.output.artifactId), event, `study artifact ${receipt.output.artifactId} already has a disposition`);
    invariant(
      report?.study && report.status === receipt.decision.outcome && report.decisionReason === receipt.report.decisionReason &&
        report.study.output.artifactId === receipt.output.artifactId && report.study.output.contentId === receipt.output.contentId &&
        report.study.output.bytes === receipt.output.bytes && same(report.study.outputSlot, receipt.output.outputSlot) &&
        report.parentTaskId === receipt.parent.taskId && report.parentAgentId === receipt.parent.agentId &&
        report.taskId === receipt.child.taskId && report.agentId === receipt.child.agentId &&
        report.study.jobContextId === receipt.child.jobContextId && same(report.study.executor, receipt.executor),
      event,
      `parent disposition ${receipt.dispositionId} changed its report, context, output, executor, or parent edge`,
    );
    invariant(
      input?.origin.kind === "study_report" && input.content.contentId === receipt.output.contentId &&
        dispositionArtifact?.origin.kind === "parent_artifact_disposition" &&
        dispositionArtifact.origin.dispositionId === receipt.dispositionId &&
        dispositionArtifact.origin.reportId === report.id && dispositionArtifact.origin.inputArtifactId === input.id &&
        dispositionArtifact.origin.outcome === receipt.decision.outcome &&
        dispositionArtifact.origin.receiptId === receipt.receiptId &&
        dispositionArtifact.origin.receiptContentId === event.data.dispositionReceiptContentId &&
        dispositionArtifact.content.contentId === event.data.dispositionReceiptContentId,
      event,
      `parent disposition ${receipt.dispositionId} lost its content-addressed artifact`,
    );
    if (receipt.decision.outcome === "accepted") {
      invariant(
        admission && receipt.admission && admissionArtifact?.origin.kind === "parent_admission" &&
          event.data.admissionReceiptContentId !== null &&
          admission.receiptId === receipt.admission.receiptId && admission.admissionId === receipt.admission.admissionId &&
          admission.dispositionId === receipt.dispositionId && admission.reportId === report.id &&
          admissionArtifact.id === receipt.admission.artifactId &&
          admissionArtifact.content.contentId === receipt.admission.receiptContentId &&
          admissionArtifact.origin.grantId === receipt.admission.grant.id &&
          same(admission.grant, receipt.admission.grant) &&
          admission.grant.parentTaskId === receipt.parent.taskId && admission.grant.parentAgentId === receipt.parent.agentId &&
          admission.grant.contentScope.length === 1 && admission.grant.contentScope[0].artifactId === input.id &&
          admission.grant.contentScope[0].contentId === input.content.contentId &&
          !next.parentArtifactReadGrants[admission.grant.id],
        event,
        `accepted parent disposition ${receipt.dispositionId} lost its admission or least-privilege read grant`,
      );
      next.parentArtifactReadGrants[admission.grant.id] = structuredClone(admission.grant);
    } else {
      invariant(!admission && !receipt.admission && !admissionArtifact && event.data.admissionReceiptContentId === null, event, `rejected parent disposition ${receipt.dispositionId} granted read authority`);
    }
    next.parentArtifactDispositions[receipt.dispositionId] = {
      id: receipt.dispositionId,
      reportId: report.id,
      parentTaskId: receipt.parent.taskId,
      parentAgentId: receipt.parent.agentId,
      childTaskId: receipt.child.taskId,
      childAgentId: receipt.child.agentId,
      inputArtifactId: input.id,
      outcome: receipt.decision.outcome,
      receiptId: receipt.receiptId,
      receiptContentId: event.data.dispositionReceiptContentId,
      receiptArtifactId: dispositionArtifact.id,
      admissionId: receipt.admission?.admissionId ?? null,
      admissionReceiptId: receipt.admission?.receiptId ?? null,
      admissionReceiptContentId: receipt.admission?.receiptContentId ?? null,
      admissionArtifactId: receipt.admission?.artifactId ?? null,
      readGrantId: receipt.admission?.grant.id ?? null,
    };
    return true;
  }

  if (event.type === "parent.artifact_read_started") {
    invariant(event.producer.kind === "artifact_read_host", event, "parent reads must come from the artifact read host");
    const request = event.data.request;
    const grant = next.parentArtifactReadGrants[request.grantId];
    const parent = next.tasks[request.parentTaskId];
    invariant(!next.parentArtifactReads[request.operationId], event, `parent read ${request.operationId} is duplicated`);
    invariant(
      grant && parent?.ownerAgentId === request.parentAgentId &&
        (parent.status === "working" || parent.status === "waiting_for_children") &&
        grant.parentTaskId === request.parentTaskId && grant.parentAgentId === request.parentAgentId &&
        request.contentIds.every((id) => grant.contentScope.some((scope) => scope.contentId === id)),
      event,
      `parent read ${request.operationId} lacks exact admitted content authority`,
    );
    const prior = Object.values(next.parentArtifactReads).filter((read) => read.grantId === grant.id && read.status === "completed");
    const usedBytes = prior.reduce((sum, read) => sum + (read.returnedBytes ?? 0), 0);
    const usedItems = prior.reduce((sum, read) => sum + (read.returnedItems ?? 0), 0);
    const requestedArtifacts = request.contentIds.map((contentId) => {
      const scope = grant.contentScope.find((candidate) => candidate.contentId === contentId)!;
      return next.artifacts[scope.artifactId];
    });
    const requestedBytes = requestedArtifacts.reduce((sum, artifact) => sum + (artifact?.content.bytes ?? 0), 0);
    invariant(
      requestedArtifacts.every(Boolean) && usedBytes + requestedBytes <= grant.maxBytes && usedItems + requestedArtifacts.length <= grant.maxItems,
      event,
      `parent read ${request.operationId} exceeds its hard byte or item ceiling`,
    );
    next.parentArtifactReads[request.operationId] = {
      id: request.operationId,
      parentTaskId: request.parentTaskId,
      parentAgentId: request.parentAgentId,
      grantId: grant.id,
      dispositionId: grant.dispositionId,
      requestedContentIds: [...request.contentIds],
      status: "started",
      returnedArtifactIds: [],
      returnedContentIds: [],
      returnedBytes: null,
      returnedItems: null,
      receiptId: null,
      failure: null,
    };
    return true;
  }

  if (event.type === "parent.artifact_read_completed") {
    invariant(event.producer.kind === "artifact_read_host", event, "parent read completion must come from the artifact read host");
    const read = next.parentArtifactReads[event.data.operationId];
    const receipt = event.data.receipt;
    const grant = read ? next.parentArtifactReadGrants[read.grantId] : null;
    invariant(read?.status === "started" && grant, event, `parent read ${event.data.operationId} is not active`);
    invariant(
      receipt.operationId === read.id && receipt.runId === next.runId &&
        receipt.authorization.grantId === grant.id && receipt.authorization.parentTaskId === read.parentTaskId &&
        receipt.authorization.parentAgentId === read.parentAgentId && receipt.authorization.dispositionId === grant.dispositionId &&
        same(receipt.requestedContentIds, read.requestedContentIds) &&
        receipt.returned.length === read.requestedContentIds.length &&
        receipt.returned.every((item) => grant.contentScope.some((scope) =>
          scope.artifactId === item.artifactId && scope.contentId === item.contentId &&
          next.artifacts[item.artifactId]?.content.bytes === item.bytes)) &&
        receipt.consumed.bytes === receipt.returned.reduce((sum, item) => sum + item.bytes, 0) &&
        receipt.consumed.items === receipt.returned.length &&
        receipt.ceilings.maxBytes === grant.maxBytes && receipt.ceilings.maxItems === grant.maxItems &&
        receipt.consumed.bytes <= grant.maxBytes && receipt.consumed.items <= grant.maxItems,
      event,
      `parent read ${read.id} changed its grant, content, counts, or ceilings`,
    );
    read.status = "completed";
    read.returnedArtifactIds = receipt.returned.map((item) => item.artifactId);
    read.returnedContentIds = receipt.returned.map((item) => item.contentId);
    read.returnedBytes = receipt.consumed.bytes;
    read.returnedItems = receipt.consumed.items;
    read.receiptId = receipt.receiptId;
    return true;
  }

  if (event.type === "parent.artifact_read_failed") {
    invariant(event.producer.kind === "artifact_read_host", event, "parent read failure must come from the artifact read host");
    const read = next.parentArtifactReads[event.data.operationId];
    invariant(read?.status === "started", event, `parent read ${event.data.operationId} is not active`);
    read.status = "failed";
    read.failure = event.data.reason;
    return true;
  }
  return false;
}
