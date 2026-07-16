import {
  canonicalJsonContentId,
  canonicalSha256,
  ContentAddressedArtifactStore,
} from "./artifactStore.ts";
import type { RuntimeLedger } from "./journal.ts";
import type {
  ParentArtifactAdmissionReceipt,
  ParentArtifactDispositionReceipt,
  ParentArtifactDispositionRequest,
  ParentArtifactReadGrant,
  RuntimeArtifact,
  RuntimeProjection,
} from "./model.ts";
import type { PendingRuntimeEvent } from "./protocol.ts";
import { reopenStudyReport } from "./studyReportAudit.ts";
import {
  assertParentArtifactDispositionRequest,
  validateParentAdmissionReceipt,
  validateParentArtifactDispositionReceipt,
} from "./validation/studyReports.ts";

const MAX_PARENT_READ_BYTES = 256 * 1024;
const MAX_PARENT_READ_ITEMS = 1;

function authorize(state: RuntimeProjection, requestValue: unknown) {
  assertParentArtifactDispositionRequest(requestValue);
  const request: ParentArtifactDispositionRequest = structuredClone(requestValue);
  const report = state.reports[request.reportId];
  const parent = state.tasks[request.parentTaskId];
  if (!report?.study) throw new Error("Parent artifact disposition requires one typed study report");
  if (Object.values(state.parentArtifactDispositions).some((record) =>
    record.reportId === report.id || record.inputArtifactId === request.outputArtifactId)) {
    throw new Error("Parent artifact disposition already exists for this report or study artifact");
  }
  if (report.status !== "submitted" || report.decisionReason !== null) {
    throw new Error("Parent artifact disposition requires one pending typed study report");
  }
  const study = report.study;
  if (
    !parent || parent.id !== report.parentTaskId || parent.ownerAgentId !== report.parentAgentId ||
    parent.id !== request.parentTaskId || parent.ownerAgentId !== request.parentAgentId ||
    (parent.status !== "working" && parent.status !== "waiting_for_children")
  ) throw new Error("Only the exact active parent task owner may disposition a study artifact");
  if (report.study.output.artifactId !== request.outputArtifactId || report.outputArtifactIds.length !== 1) {
    throw new Error("Parent artifact disposition selected an output outside the typed report slot");
  }
  const artifact = state.artifacts[request.outputArtifactId];
  if (!artifact || artifact.origin.kind !== "study_report") throw new Error("Parent artifact disposition requires a typed study report artifact");
  return { request, report, study, parent, artifact };
}

export interface ParentArtifactAdmissionHostResult {
  dispositionReceipt: ParentArtifactDispositionReceipt;
  dispositionReceiptContentId: string;
  dispositionArtifactId: string;
  admissionReceipt: ParentArtifactAdmissionReceipt | null;
  admissionReceiptContentId: string | null;
  admissionArtifactId: string | null;
  grant: ParentArtifactReadGrant | null;
}

/** Per-artifact parent disposition; acceptance alone creates bounded content read authority. */
export class ParentArtifactAdmissionHost {
  private readonly ledger: RuntimeLedger;
  private readonly artifacts: ContentAddressedArtifactStore;
  constructor(
    ledger: RuntimeLedger,
    artifacts: ContentAddressedArtifactStore,
  ) {
    this.ledger = ledger;
    this.artifacts = artifacts;
  }

  async record(requestValue: unknown): Promise<ParentArtifactAdmissionHostResult> {
    const authorized = authorize(this.ledger.state(), requestValue);
    await reopenStudyReport(this.ledger.state(), this.artifacts, authorized.artifact.id);
    const dispositionId = `parent-disposition:${canonicalSha256({
      runId: this.ledger.runId,
      reportId: authorized.report.id,
      artifactId: authorized.artifact.id,
      contentId: authorized.artifact.content.contentId,
      outcome: authorized.request.outcome,
    })}`;

    let admissionReceipt: ParentArtifactAdmissionReceipt | null = null;
    let admissionReceiptContentId: string | null = null;
    let admissionArtifactId: string | null = null;
    let admissionArtifact: RuntimeArtifact | null = null;
    let grant: ParentArtifactReadGrant | null = null;
    if (authorized.request.outcome === "accepted") {
      const admissionId = `parent-admission:${canonicalSha256({
        runId: this.ledger.runId,
        dispositionId,
        artifactId: authorized.artifact.id,
        contentId: authorized.artifact.content.contentId,
      })}`;
      grant = {
        schema: "studio.parent-artifact-read-grant.v1",
        id: `grant:artifact-read:${canonicalSha256({
          runId: this.ledger.runId,
          dispositionId,
          parentTaskId: authorized.parent.id,
          contentIds: [authorized.artifact.content.contentId],
          maxBytes: Math.min(MAX_PARENT_READ_BYTES, authorized.artifact.content.bytes),
          maxItems: MAX_PARENT_READ_ITEMS,
        })}`,
        capability: "artifact.read",
        runId: this.ledger.runId,
        reportId: authorized.report.id,
        dispositionId,
        parentTaskId: authorized.parent.id,
        parentAgentId: authorized.parent.ownerAgentId!,
        contentScope: [{
          artifactId: authorized.artifact.id,
          contentId: authorized.artifact.content.contentId,
          schema: "studio.study-report.v1",
        }],
        maxBytes: Math.min(MAX_PARENT_READ_BYTES, authorized.artifact.content.bytes),
        maxItems: MAX_PARENT_READ_ITEMS,
      };
      const admissionBody = {
        admissionId,
        dispositionId,
        runId: this.ledger.runId,
        reportId: authorized.report.id,
        parent: { taskId: authorized.parent.id, agentId: authorized.parent.ownerAgentId! },
        child: {
          taskId: authorized.report.taskId,
          agentId: authorized.report.agentId,
          jobContextId: authorized.study.jobContextId,
        },
        admitted: [{
          artifactId: authorized.artifact.id,
          contentId: authorized.artifact.content.contentId,
          schema: "studio.study-report.v1" as const,
        }],
        grant,
        nonClaims: { semanticQuality: "not_assessed" as const, parentAgreement: "not_claimed" as const },
      };
      admissionReceipt = {
        schema: "studio.parent-admission.receipt.v1",
        receiptId: `parent-admission-receipt:${canonicalSha256(admissionBody)}`,
        ...admissionBody,
      };
      validateParentAdmissionReceipt(admissionReceipt, "Parent admission", "receipt");
      const stored = await this.artifacts.storeJson(admissionReceipt);
      if (stored.content.contentId !== canonicalJsonContentId(admissionReceipt)) throw new Error("Stored parent admission changed canonical identity");
      const artifact = this.artifacts.buildParentAdmissionArtifact({ runId: this.ledger.runId, receipt: admissionReceipt, storedReceipt: stored });
      await this.artifacts.resolveVerified(artifact);
      admissionArtifact = artifact;
      admissionReceiptContentId = stored.content.contentId;
      admissionArtifactId = artifact.id;
    }

    const dispositionBody = {
      dispositionId,
      runId: this.ledger.runId,
      report: {
        reportId: authorized.report.id,
        status: authorized.request.outcome,
        decisionReason: authorized.request.reason,
      },
      parent: { taskId: authorized.parent.id, agentId: authorized.parent.ownerAgentId! },
      child: {
        taskId: authorized.report.taskId,
        agentId: authorized.report.agentId,
        jobContextId: authorized.study.jobContextId,
      },
      output: {
        artifactId: authorized.artifact.id,
        contentId: authorized.artifact.content.contentId,
        bytes: authorized.artifact.content.bytes,
        schema: "studio.study-report.v1" as const,
        outputSlot: structuredClone(authorized.study.outputSlot),
      },
      executor: structuredClone(authorized.study.executor),
      decision: { outcome: authorized.request.outcome, reason: authorized.request.reason },
      admission: admissionReceipt && grant && admissionReceiptContentId && admissionArtifactId
        ? {
            admissionId: admissionReceipt.admissionId,
            receiptId: admissionReceipt.receiptId,
            receiptContentId: admissionReceiptContentId,
            artifactId: admissionArtifactId,
            grant,
          }
        : null,
    };
    const dispositionReceipt: ParentArtifactDispositionReceipt = {
      schema: "studio.parent-artifact-disposition.receipt.v1",
      receiptId: `parent-disposition-receipt:${canonicalSha256(dispositionBody)}`,
      ...dispositionBody,
    };
    validateParentArtifactDispositionReceipt(dispositionReceipt, "Parent disposition", "receipt");
    const storedDisposition = await this.artifacts.storeJson(dispositionReceipt);
    if (storedDisposition.content.contentId !== canonicalJsonContentId(dispositionReceipt)) throw new Error("Stored parent disposition changed canonical identity");
    const dispositionArtifact = this.artifacts.buildParentArtifactDispositionArtifact({
      runId: this.ledger.runId,
      receipt: dispositionReceipt,
      storedReceipt: storedDisposition,
    });
    await this.artifacts.resolveVerified(dispositionArtifact);
    await this.ledger.transact(
      { producer: { kind: "admission_host", id: "parent-artifact-admission-host" }, causationId: dispositionId },
      ({ state }) => {
        authorize(state, authorized.request);
        return {
          pending: [
            {
              type: "report.decided",
              data: {
                reportId: authorized.report.id,
                decidedByTaskId: authorized.parent.id,
                decidedByAgentId: authorized.parent.ownerAgentId!,
                accepted: authorized.request.outcome === "accepted",
                reason: authorized.request.reason,
              },
            },
            ...(admissionArtifact ? [{
              type: "artifact.recorded" as const,
              data: { artifact: admissionArtifact },
            }] : []),
            {
              type: "artifact.recorded",
              data: { artifact: dispositionArtifact },
            },
            {
              type: "parent.artifact_disposition_recorded",
              data: {
                dispositionArtifactId: dispositionArtifact.id,
                dispositionReceiptContentId: storedDisposition.content.contentId,
                dispositionReceipt,
                admissionArtifactId,
                admissionReceiptContentId,
                admissionReceipt,
              },
            },
          ] satisfies PendingRuntimeEvent[],
          result: undefined,
        };
      },
    );
    return {
      dispositionReceipt,
      dispositionReceiptContentId: storedDisposition.content.contentId,
      dispositionArtifactId: dispositionArtifact.id,
      admissionReceipt,
      admissionReceiptContentId,
      admissionArtifactId,
      grant,
    };
  }
}
