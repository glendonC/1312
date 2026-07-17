import {
  canonicalSha256,
  ContentAddressedArtifactStore,
} from "../artifactStore.ts";
import type {
  ParentArtifactAdmissionReceipt,
  ParentArtifactDispositionReceipt,
  RuntimeProjection,
} from "../model.ts";
import { readCanonicalStoredJson, reopenStudyReport, type VerifiedStudyReport } from "../study/studyReportAudit.ts";
import {
  validateParentAdmissionReceipt,
  validateParentArtifactDispositionReceipt,
} from "../validation/studyReports.ts";

function receiptIdentity(prefix: string, receipt: { schema: string; receiptId: string }): string {
  const body = structuredClone(receipt) as unknown as Record<string, unknown>;
  delete body.schema;
  delete body.receiptId;
  return `${prefix}:${canonicalSha256(body)}`;
}

function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export interface VerifiedParentArtifactDisposition {
  disposition: ParentArtifactDispositionReceipt;
  admission: ParentArtifactAdmissionReceipt | null;
  study: VerifiedStudyReport;
}

/** Recursive close: disposition/admission -> report/study -> semantic evidence -> source/grant/executor. */
export async function reopenParentArtifactDisposition(
  state: RuntimeProjection,
  artifacts: ContentAddressedArtifactStore,
  dispositionId: string,
): Promise<VerifiedParentArtifactDisposition> {
  const record = state.parentArtifactDispositions[dispositionId];
  if (!record) throw new Error(`Parent artifact disposition ${dispositionId} is absent`);
  const report = state.reports[record.reportId];
  const dispositionArtifact = state.artifacts[record.receiptArtifactId];
  if (
    !report?.study || report.status !== record.outcome ||
    !dispositionArtifact || dispositionArtifact.origin.kind !== "parent_artifact_disposition" ||
    dispositionArtifact.origin.dispositionId !== record.id ||
    dispositionArtifact.content.contentId !== record.receiptContentId
  ) throw new Error(`Parent artifact disposition ${dispositionId} lost its journal or artifact lineage`);
  await artifacts.resolveVerified(dispositionArtifact);
  const value = await readCanonicalStoredJson(artifacts, record.receiptContentId, 256 * 1024, "Stored parent disposition receipt");
  const disposition = validateParentArtifactDispositionReceipt(value, "Parent disposition audit", "receipt");
  if (
    disposition.receiptId !== receiptIdentity("parent-disposition-receipt", disposition) ||
    disposition.receiptId !== record.receiptId || disposition.dispositionId !== record.id ||
    disposition.report.reportId !== report.id || disposition.report.status !== report.status ||
    disposition.report.decisionReason !== report.decisionReason ||
    disposition.output.artifactId !== record.inputArtifactId ||
    disposition.parent.taskId !== record.parentTaskId || disposition.parent.agentId !== record.parentAgentId ||
    disposition.child.taskId !== record.childTaskId || disposition.child.agentId !== record.childAgentId ||
    !same(disposition.executor, report.study.executor)
  ) throw new Error(`Parent artifact disposition ${dispositionId} changed its receipt or report binding`);
  const study = await reopenStudyReport(state, artifacts, record.inputArtifactId);
  if (!same(study.submission, report.study)) throw new Error(`Parent artifact disposition ${dispositionId} study submission changed`);

  let admission: ParentArtifactAdmissionReceipt | null = null;
  if (record.outcome === "accepted") {
    const admissionArtifact = record.admissionArtifactId ? state.artifacts[record.admissionArtifactId] : null;
    const grant = record.readGrantId ? state.parentArtifactReadGrants[record.readGrantId] : null;
    if (
      !record.admissionId || !record.admissionReceiptId || !record.admissionReceiptContentId ||
      !admissionArtifact || admissionArtifact.origin.kind !== "parent_admission" || !grant ||
      !disposition.admission
    ) throw new Error(`Accepted parent artifact disposition ${dispositionId} lost admission authority`);
    await artifacts.resolveVerified(admissionArtifact);
    const admissionValue = await readCanonicalStoredJson(artifacts, record.admissionReceiptContentId, 256 * 1024, "Stored parent admission receipt");
    admission = validateParentAdmissionReceipt(admissionValue, "Parent admission audit", "receipt");
    if (
      admission.receiptId !== receiptIdentity("parent-admission-receipt", admission) ||
      admission.receiptId !== record.admissionReceiptId || admission.admissionId !== record.admissionId ||
      admission.dispositionId !== record.id || admission.reportId !== report.id ||
      admissionArtifact.content.contentId !== record.admissionReceiptContentId ||
      !same(admission.grant, grant) || !same(disposition.admission.grant, grant) ||
      admission.admitted.length !== 1 || admission.admitted[0].artifactId !== study.artifact.id ||
      admission.admitted[0].contentId !== study.artifact.content.contentId ||
      grant.maxBytes !== study.artifact.content.bytes || grant.maxItems !== 1
    ) throw new Error(`Accepted parent artifact disposition ${dispositionId} changed its admission, grant, or exact content scope`);
  } else if (
    record.admissionId || record.admissionReceiptId || record.admissionReceiptContentId ||
    record.admissionArtifactId || record.readGrantId || disposition.admission
  ) {
    throw new Error(`Rejected parent artifact disposition ${dispositionId} created read authority`);
  }
  return { disposition: structuredClone(disposition), admission: admission ? structuredClone(admission) : null, study };
}
