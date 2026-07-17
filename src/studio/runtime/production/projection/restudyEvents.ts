import type { RuntimeProjection } from "../model.ts";
import type { RuntimeEvent } from "../protocol.ts";
import { invariant } from "./shared.ts";
import { taskCapabilityCallCount } from "../capabilityUsage.ts";
import { canonicalJsonContentId } from "../artifactStore.ts";

export function applyRestudyEvent(next: RuntimeProjection, event: RuntimeEvent): boolean {
  if (event.type === "study.restudy_pass_requested") {
    invariant(event.producer.kind === "scheduler", event, "range-pass requests must be recorded atomically by the scheduler");
    const receipt = event.data.receipt;
    const root = next.tasks[receipt.root.taskId];
    const execution = next.executions[receipt.root.executionId];
    invariant(
      root?.parentTaskId === null && root.ownerAgentId === receipt.root.agentId &&
        root.grants.some((grant) => grant.capability === "study.restudy") &&
        execution?.status === "active" && execution.taskId === root.id && execution.agentId === root.ownerAgentId,
      event,
      `range pass ${receipt.passId} has no active default-root authority`,
    );
    invariant(!next.rangePasses[receipt.passId], event, `range pass ${receipt.passId} is duplicated`);
    invariant(canonicalJsonContentId(receipt) === event.data.receiptContentId, event, `range pass ${receipt.passId} changed request receipt content identity`);
    next.rangePasses[receipt.passId] = {
      id: receipt.passId,
      requestReceiptId: receipt.receiptId,
      requestReceiptContentId: event.data.receiptContentId,
      request: structuredClone(receipt),
      spawnRequestId: "pending",
      accepted: false,
      rejection: null,
      taskId: null,
      agentId: null,
      terminalReceiptId: null,
      terminalReceiptContentId: null,
      terminal: null,
    };
    return true;
  }
  if (event.type === "study.restudy_pass_decided") {
    invariant(event.producer.kind === "scheduler", event, "range-pass decisions must come from the scheduler");
    const pass = next.rangePasses[event.data.passId];
    const spawn = next.spawnRequests[event.data.spawnRequestId];
    invariant(pass && pass.spawnRequestId === "pending", event, `range pass ${event.data.passId} has no pending request`);
    invariant(
      spawn?.requestedByTaskId === pass.request.root.taskId && spawn.requestedByAgentId === pass.request.root.agentId &&
        spawn.authoredByExecutionId === pass.request.root.executionId && spawn.accepted === event.data.accepted &&
        spawn.rejection === event.data.rejection && spawn.taskId === event.data.taskId && spawn.agentId === event.data.agentId,
      event,
      `range pass ${event.data.passId} changed its scheduler decision`,
    );
    pass.spawnRequestId = event.data.spawnRequestId;
    pass.accepted = event.data.accepted;
    pass.rejection = event.data.rejection;
    pass.taskId = event.data.taskId;
    pass.agentId = event.data.agentId;
    return true;
  }
  if (event.type === "study.restudy_pass_terminal_recorded") {
    invariant(event.producer.kind === "study_restudy_host", event, "range-pass terminal evidence must come from the re-study host");
    const receipt = event.data.receipt;
    const pass = next.rangePasses[receipt.passId];
    invariant(pass?.accepted && pass.taskId === receipt.scheduler.taskId && pass.agentId === receipt.scheduler.agentId && pass.spawnRequestId === receipt.scheduler.spawnRequestId, event, `range pass ${receipt.passId} changed scheduler lineage`);
    invariant(!pass.terminal, event, `range pass ${receipt.passId} already has terminal evidence`);
    invariant(canonicalJsonContentId(receipt) === event.data.receiptContentId, event, `range pass ${receipt.passId} changed terminal receipt content identity`);
    const task = next.tasks[receipt.scheduler.taskId];
    const execution = Object.values(next.executions).find((entry) => entry.taskId === task?.id && entry.agentId === receipt.scheduler.agentId);
    const report = receipt.evidence.reportId ? next.reports[receipt.evidence.reportId] : null;
    const admission = receipt.evidence.admissionId ? next.generalizedParentArtifactAdmissions[receipt.evidence.admissionId] : null;
    const read = receipt.evidence.readOperationId ? next.generalizedParentArtifactReads[receipt.evidence.readOperationId] : null;
    invariant(
      receipt.requestReceiptId === pass.requestReceiptId && receipt.requestReceiptContentId === pass.requestReceiptContentId &&
        task && new Set(["completed", "failed", "withheld", "interrupted"]).has(task.status) &&
        execution?.receipt !== null && receipt.measuredSpend.executorActiveMs === execution?.receipt?.monotonicDurationMs &&
        receipt.measuredSpend.capabilityCalls === taskCapabilityCallCount(next, task.id),
      event,
      `range pass ${receipt.passId} changed its request, terminal task, executor, or measured spend`,
    );
    if (receipt.measuredSpend.modelUsage.state === "available") {
      const usage = next.modelUsage[receipt.measuredSpend.modelUsage.receiptId];
      invariant(execution?.modelUsageReceiptId === usage?.receiptId && JSON.stringify(usage.measured) === JSON.stringify(receipt.measuredSpend.modelUsage.measured), event, `range pass ${receipt.passId} changed model usage`);
    } else {
      invariant(execution?.modelUsageReceiptId === null, event, `range pass ${receipt.passId} hid available model usage`);
    }
    if (report || admission || read) {
      invariant(
        report?.taskId === task.id && report.study?.schema === "studio.study-report-submission.v2" &&
          report.study.output.artifactId === receipt.evidence.reportArtifactId && report.study.output.contentId === receipt.evidence.reportContentId &&
          admission?.reportId === report.id && admission.parentTaskId === pass.request.root.taskId &&
          admission.report.artifactId === receipt.evidence.reportArtifactId &&
          admission.report.contentId === receipt.evidence.reportContentId && read?.admissionId === admission.admissionId &&
          read.parentTaskId === pass.request.root.taskId,
        event,
        `range pass ${receipt.passId} changed report, admission, or read lineage`,
      );
    }
    if (receipt.outcome === "supported_new_citations") {
      const citationById = new Map(report?.study?.schema === "studio.study-report-submission.v2"
        ? report.study.evidenceCitations.map((citation) => [citation.citationId, citation])
        : []);
      const operationIds = new Set(Object.values(next.semanticEvidence).filter((operation) => operation.taskId === task.id).map((operation) => operation.id));
      invariant(
        receipt.evidence.newCitationIds.length > 0 && receipt.evidence.newCitationIds.length === receipt.evidence.citationIds.length &&
          receipt.evidence.newCitationIds.every((id) => !pass.request.priorEvidence.citationIds.includes(id) &&
            citationById.get(id)?.evidenceKind === "current_run_speech" && citationById.get(id)?.use === "claim_support" &&
            citationById.get(id)?.operationId !== null && operationIds.has(citationById.get(id)!.operationId!)),
        event,
        `range pass ${receipt.passId} manufactured support without pass-new speech citations`,
      );
    }
    pass.terminalReceiptId = receipt.receiptId;
    pass.terminalReceiptContentId = event.data.receiptContentId;
    pass.terminal = structuredClone(receipt);
    return true;
  }
  return false;
}
