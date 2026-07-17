import {
  canonicalJsonContentId,
  canonicalSha256,
  ContentAddressedArtifactStore,
} from "../artifactStore.ts";
import type { FrameDecoder } from "../frames/decoder.ts";
import type { OcrRecognizer } from "../ocr/recognizer.ts";
import type {
  AdmittedStudyReportV2,
  EvidenceCitationEnvelope,
  ParentArtifactAdmissionReceiptV2,
  ParentArtifactReadReceiptV2,
  QualifiedMediaRange,
  RuntimeProjection,
  StudyReportArtifactV2,
  StudyReportV2Identity,
} from "../model.ts";
import { STUDY_REPORT_V2_LIMITS } from "../model.ts";
import { auditEvidenceCitation } from "../evidenceCitations/audit.ts";
import { deriveTaskDialogueScopePolicy } from "../study/dialogueScopeRuntime.ts";
import { validateDialogueScopePolicy } from "../../../acoustic/dialogueScopePolicy.ts";
import { deriveGeneralizedCoverageDecision } from "./generalizedCoveragePolicy.ts";
import {
  validateParentArtifactAdmissionReceiptV2,
  validateParentArtifactReadReceiptV2,
  validateStudyReportArtifactV2,
} from "../validation/studyReportsV2.ts";

function same(left: unknown, right: unknown): boolean {
  return canonicalSha256(left) === canonicalSha256(right);
}

function receiptId(prefix: string, value: { schema: string; receiptId: string }): string {
  const body = structuredClone(value) as unknown as Record<string, unknown>;
  delete body.schema;
  delete body.receiptId;
  return `${prefix}:${canonicalSha256(body)}`;
}

function exactRange(value: QualifiedMediaRange): QualifiedMediaRange {
  return { artifactId: value.artifactId, trackId: value.trackId, startMs: value.startMs, endMs: value.endMs };
}

async function storedJson(
  artifacts: ContentAddressedArtifactStore,
  contentId: string,
  maximumBytes: number,
  label: string,
): Promise<unknown> {
  const bytes = await artifacts.receiptBytes(contentId);
  if (bytes.byteLength <= 0 || bytes.byteLength > maximumBytes) throw new Error(`${label} exceeds its byte ceiling`);
  let value: unknown;
  try { value = JSON.parse(bytes.toString("utf8")) as unknown; }
  catch { throw new Error(`${label} is not valid JSON`); }
  if (canonicalJsonContentId(value) !== contentId) throw new Error(`${label} changed canonical content identity`);
  return value;
}

export interface GeneralizedAdmissionResult extends AdmittedStudyReportV2 {
  reportEnvelope: StudyReportArtifactV2;
  admissionReceipt: ParentArtifactAdmissionReceiptV2;
}

export interface GeneralizedEvidenceAdmissionOptions {
  frameDecoder?: FrameDecoder;
  ocrRecognizer?: OcrRecognizer;
  /** Host-owned replaceable seam; production composition uses cold U1 receipt derivation. */
  dialogueScopePolicyResolver?: typeof deriveTaskDialogueScopePolicy;
}

/**
 * Additive U3 admission/read host. It stores content-addressed v2 artifacts outside the closed v1
 * journal union, reuses the current runtime projection for authority, and audits every citation by
 * producer kind before creating admission authority.
 */
export class GeneralizedEvidenceAdmissionHost {
  private readonly state: RuntimeProjection;
  private readonly artifacts: ContentAddressedArtifactStore;
  private readonly frameDecoder: FrameDecoder | undefined;
  private readonly ocrRecognizer: OcrRecognizer | undefined;
  private readonly dialogueScopePolicyResolver: typeof deriveTaskDialogueScopePolicy;

  constructor(
    state: RuntimeProjection,
    artifacts: ContentAddressedArtifactStore,
    options: GeneralizedEvidenceAdmissionOptions = {},
  ) {
    this.state = state;
    this.artifacts = artifacts;
    this.frameDecoder = options.frameDecoder;
    this.ocrRecognizer = options.ocrRecognizer;
    this.dialogueScopePolicyResolver = options.dialogueScopePolicyResolver ?? deriveTaskDialogueScopePolicy;
  }

  private async auditReport(value: unknown): Promise<StudyReportArtifactV2> {
    const report = validateStudyReportArtifactV2(value);
    const task = this.state.tasks[report.task.taskId];
    const execution = this.state.executions[report.task.executionId];
    const source = this.state.artifacts[report.assignment.source.artifactId];
    if (
      report.runId !== this.state.runId || !task || !task.parentTaskId || !task.parentAgentId ||
      task.assignedAgentId !== report.task.agentId || task.jobContext.contextId !== report.task.jobContextId ||
      task.parentTaskId !== report.parent.taskId || task.parentAgentId !== report.parent.agentId ||
      !execution || execution.taskId !== task.id || execution.agentId !== report.task.agentId ||
      (execution.status !== "active" && execution.status !== "completed") ||
      !source || source.origin.kind !== "ingest" || source.content.contentId !== report.assignment.source.contentId ||
      !same(task.mediaScope, report.assignment.mediaScope)
    ) throw new Error("Study report v2 changed its current-run task, executor, parent, source, or assignment authority");
    await this.artifacts.resolveVerified(source);
    const audited: EvidenceCitationEnvelope[] = [];
    for (const citation of report.evidenceCitations) {
      const verified = await auditEvidenceCitation(this.state, this.artifacts, citation, {
        frameDecoder: this.frameDecoder,
        ocrRecognizer: this.ocrRecognizer,
      });
      if (verified.source.artifactId !== source.id || verified.source.contentId !== source.content.contentId) {
        throw new Error(`Evidence citation ${verified.citationId} belongs to another source`);
      }
      if (verified.evidenceKind === "current_run_speech") {
        const operation = this.state.semanticEvidence[verified.operationId!];
        if (!operation || operation.taskId !== task.id || operation.agentId !== task.assignedAgentId || operation.executionId !== execution.id) {
          throw new Error(`Current-run citation ${verified.citationId} is cross-task or cross-executor`);
        }
      } else if (verified.evidenceKind === "frame_sample") {
        const operation = this.state.frameSamples[verified.operationId!];
        if (!operation || operation.taskId !== task.id || operation.agentId !== task.assignedAgentId || operation.executionId !== execution.id) {
          throw new Error(`Frame citation ${verified.citationId} is cross-task or cross-executor`);
        }
      } else if (verified.evidenceKind === "ocr_span") {
        const operation = this.state.ocrOperations[verified.operationId!];
        if (!operation || operation.taskId !== task.id || operation.agentId !== task.assignedAgentId || operation.executionId !== execution.id) {
          throw new Error(`OCR citation ${verified.citationId} is cross-task or cross-executor`);
        }
      } else if (!task.jobContext.detectorEvidence.some((identity) => identity.artifactId === verified.evidence.artifactId && identity.contentId === verified.evidence.contentId)) {
        throw new Error(`Acoustic citation ${verified.citationId} is outside the task's immutable detector evidence`);
      }
      audited.push(verified);
    }
    if (!same(audited, report.evidenceCitations)) throw new Error("Study report v2 evidence citations changed during per-kind audit");
    const derivedPolicy = await this.dialogueScopePolicyResolver(this.state, this.artifacts, task.id);
    const policy = derivedPolicy ? validateDialogueScopePolicy(derivedPolicy) : null;
    if (policy && (
      policy.input.sourceArtifactId !== source.id ||
      policy.input.sourceContentId !== source.content.contentId ||
      policy.input.includeLyrics !== task.jobContext.analysisRequest.options.includeLyrics ||
      policy.input.requestedRange.startMs !== task.jobContext.analysisRequest.requestedRange.startMs ||
      policy.input.requestedRange.endMs !== task.jobContext.analysisRequest.requestedRange.endMs
    )) throw new Error("Dialogue-scope resolver changed task source, range, or lyrics policy authority");
    const citationsById = new Map(report.evidenceCitations.map((entry) => [entry.citationId, entry]));
    for (const covered of report.coverage) {
      const citations = covered.citationIds.map((id) => citationsById.get(id)!).filter(Boolean);
      const derived = deriveGeneralizedCoverageDecision({
        claimCount: covered.claimIds.length,
        citations,
        dialogueScopePolicy: policy,
        range: covered,
        declaredReasonCode: covered.reason?.code ?? null,
      });
      if (covered.state !== derived.state || !same(covered.rawStates, derived.rawStates) || (covered.reason?.code ?? null) !== derived.reasonCode) {
        throw new Error(`Study report v2 coverage ${covered.startMs}-${covered.endMs} upgraded or changed an audited evidence state`);
      }
    }
    return report;
  }

  async admit(value: unknown): Promise<GeneralizedAdmissionResult> {
    const report = await this.auditReport(value);
    const storedReport = await this.artifacts.storeJson(report);
    if (storedReport.content.bytes > STUDY_REPORT_V2_LIMITS.maxArtifactBytes) throw new Error("Study report v2 exceeds its byte ceiling");
    const reportIdentity: StudyReportV2Identity = {
      artifactId: `artifact:${canonicalSha256({ runId: this.state.runId, taskId: report.task.taskId, kind: report.schema, contentId: storedReport.content.contentId })}`,
      contentId: storedReport.content.contentId,
      bytes: storedReport.content.bytes,
      schema: "studio.study-report.v2",
    };
    const admissionId = `parent-admission:${canonicalSha256({ runId: this.state.runId, report: reportIdentity })}`;
    const receipt: ParentArtifactAdmissionReceiptV2 = {
      schema: "studio.parent-admission.receipt.v2",
      receiptId: "pending",
      admissionId,
      runId: this.state.runId,
      report: reportIdentity,
      task: structuredClone(report.task),
      parent: structuredClone(report.parent),
      auditedCitations: report.evidenceCitations.map((citation) => ({
        citationId: citation.citationId,
        evidenceKind: citation.evidenceKind,
        use: citation.use,
        upstreamState: citation.upstreamState,
      })),
      coverage: report.coverage.map((entry) => ({ range: exactRange(entry), state: entry.state, rawStates: [...entry.rawStates] })),
      producer: { id: "studio.generalized-evidence-admission", version: "2", policy: "audit_each_kind_and_preserve_exact_states" },
      nonClaims: { semanticQuality: "not_assessed", parentAgreement: "not_claimed", truthArbitration: "not_performed" },
    };
    receipt.receiptId = receiptId("parent-admission-receipt", receipt);
    validateParentArtifactAdmissionReceiptV2(receipt);
    const storedReceipt = await this.artifacts.storeJson(receipt);
    return {
      report: reportIdentity,
      admission: { admissionId, receiptId: receipt.receiptId, receiptContentId: storedReceipt.content.contentId },
      reportEnvelope: report,
      admissionReceipt: receipt,
    };
  }

  async reopen(admitted: AdmittedStudyReportV2): Promise<GeneralizedAdmissionResult> {
    const [reportValue, receiptValue] = await Promise.all([
      storedJson(this.artifacts, admitted.report.contentId, STUDY_REPORT_V2_LIMITS.maxArtifactBytes, "Stored study report v2"),
      storedJson(this.artifacts, admitted.admission.receiptContentId, 256 * 1024, "Stored parent admission v2"),
    ]);
    const report = await this.auditReport(reportValue);
    const receipt = validateParentArtifactAdmissionReceiptV2(receiptValue);
    const expectedArtifactId = `artifact:${canonicalSha256({ runId: this.state.runId, taskId: report.task.taskId, kind: report.schema, contentId: admitted.report.contentId })}`;
    if (
      canonicalJsonContentId(report) !== admitted.report.contentId || expectedArtifactId !== admitted.report.artifactId ||
      receipt.receiptId !== receiptId("parent-admission-receipt", receipt) || receipt.receiptId !== admitted.admission.receiptId ||
      receipt.admissionId !== admitted.admission.admissionId || receipt.runId !== this.state.runId ||
      !same(receipt.report, admitted.report) || !same(receipt.task, report.task) || !same(receipt.parent, report.parent) ||
      !same(receipt.auditedCitations, report.evidenceCitations.map((citation) => ({ citationId: citation.citationId, evidenceKind: citation.evidenceKind, use: citation.use, upstreamState: citation.upstreamState }))) ||
      !same(receipt.coverage, report.coverage.map((entry) => ({ range: exactRange(entry), state: entry.state, rawStates: [...entry.rawStates] })))
    ) throw new Error("Parent admission v2 changed report, citation, coverage, or receipt identity");
    return { report: structuredClone(admitted.report), admission: structuredClone(admitted.admission), reportEnvelope: report, admissionReceipt: receipt };
  }

  async read(admitted: AdmittedStudyReportV2, operationId: string): Promise<{
    report: StudyReportArtifactV2;
    receipt: ParentArtifactReadReceiptV2;
    receiptContentId: string;
  }> {
    const reopened = await this.reopen(admitted);
    const receipt: ParentArtifactReadReceiptV2 = {
      schema: "studio.parent-artifact-read.receipt.v2",
      receiptId: "pending",
      operationId,
      runId: this.state.runId,
      admission: structuredClone(admitted.admission),
      returned: structuredClone(admitted.report),
      producer: { id: "studio.generalized-evidence-read", version: "2", policy: "content_addressed_admitted_report_only" },
    };
    receipt.receiptId = receiptId("parent-artifact-read-receipt", receipt);
    validateParentArtifactReadReceiptV2(receipt);
    const stored = await this.artifacts.storeJson(receipt);
    return { report: reopened.reportEnvelope, receipt, receiptContentId: stored.content.contentId };
  }

  async reopenRead(receiptContentId: string): Promise<{
    report: StudyReportArtifactV2;
    receipt: ParentArtifactReadReceiptV2;
    receiptContentId: string;
  }> {
    const value = await storedJson(this.artifacts, receiptContentId, 256 * 1024, "Stored parent artifact read v2");
    const receipt = validateParentArtifactReadReceiptV2(value);
    const reopened = await this.reopen({ report: receipt.returned, admission: receipt.admission });
    if (
      receipt.receiptId !== receiptId("parent-artifact-read-receipt", receipt) ||
      receipt.runId !== this.state.runId
    ) throw new Error("Parent artifact read v2 changed receipt or runtime identity");
    return { report: reopened.reportEnvelope, receipt, receiptContentId };
  }
}
