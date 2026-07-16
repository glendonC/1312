import type { RuntimeProjection } from "../model.ts";
import { deriveStudyReportCounts } from "../validation/studyReports.ts";
import type {
  ProductionStudioStudyReportStateView,
  ProductionStudioStudyReportView,
} from "./model.ts";

export function projectStudyReportStates(state: RuntimeProjection): ProductionStudioStudyReportStateView[] {
  return Object.values(state.tasks).flatMap((task) => task.requiredOutputs
    .filter((slot) => slot.artifactKind === "studio.study-report.v1")
    .map((slot): ProductionStudioStudyReportStateView => {
      const report = Object.values(state.reports).find((candidate) =>
        candidate.taskId === task.id && candidate.study?.outputSlot.name === slot.name);
      const terminal = task.status === "failed" || task.status === "withheld" || task.status === "interrupted"
        ? task.status
        : "absent";
      return {
        taskId: task.id,
        agentId: task.assignedAgentId,
        parentTaskId: task.parentTaskId,
        parentAgentId: task.parentAgentId,
        outputSlot: { name: slot.name, artifactKind: "studio.study-report.v1" },
        state: report?.status ?? terminal,
        reportId: report?.id ?? null,
        artifactId: report?.study?.output.artifactId ?? null,
        reason: report?.decisionReason ?? (terminal === "absent" ? null : task.terminalReason),
      };
    }))
    .sort((left, right) => left.taskId.localeCompare(right.taskId) || left.outputSlot.name.localeCompare(right.outputSlot.name));
}

export function projectStudyReports(state: RuntimeProjection): ProductionStudioStudyReportView[] {
  return Object.values(state.reports)
    .filter((report) => report.study !== null && report.study !== undefined)
    .map((report): ProductionStudioStudyReportView => {
      const study = report.study!;
      const disposition = Object.values(state.parentArtifactDispositions)
        .find((candidate) => candidate.reportId === report.id && candidate.inputArtifactId === study.output.artifactId);
      const grant = disposition?.readGrantId ? state.parentArtifactReadGrants[disposition.readGrantId] : null;
      const reads = grant
        ? Object.values(state.parentArtifactReads)
            .filter((read) => read.grantId === grant.id)
            .map((read) => ({
              operationId: read.id,
              status: read.status,
              returnedBytes: read.returnedBytes,
              returnedItems: read.returnedItems,
              receiptId: read.receiptId,
              failure: read.failure,
            }))
            .sort((left, right) => left.operationId.localeCompare(right.operationId))
        : [];
      return {
        reportId: report.id,
        artifactId: study.output.artifactId,
        contentId: study.output.contentId,
        jobContextId: study.jobContextId,
        outputSlot: structuredClone(study.outputSlot),
        coverage: structuredClone(study.coverage),
        counts: deriveStudyReportCounts({ coverage: study.coverage, claims: study.claims }),
        claims: structuredClone(study.claims),
        sourceArtifacts: structuredClone(study.sourceArtifacts),
        reportStatus: report.status,
        disposition: disposition
          ? { state: disposition.outcome, dispositionId: disposition.id, receiptId: disposition.receiptId, receiptContentId: disposition.receiptContentId }
          : { state: "absent", dispositionId: null, receiptId: null, receiptContentId: null },
        admission: disposition?.outcome === "accepted" && grant
          ? { state: "admitted", admissionId: disposition.admissionId, receiptId: disposition.admissionReceiptId, receiptContentId: disposition.admissionReceiptContentId, grant: structuredClone(grant) }
          : { state: "absent", admissionId: null, receiptId: null, receiptContentId: null, grant: null },
        reads,
        audit: "not_checked",
      };
    })
    .sort((left, right) => left.reportId.localeCompare(right.reportId));
}
