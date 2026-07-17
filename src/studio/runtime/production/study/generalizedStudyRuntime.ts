import { ContentAddressedArtifactStore } from "../artifactStore.ts";
import { GeneralizedEvidenceAdmissionHost, type GeneralizedAdmissionResult } from "../admission/generalizedEvidenceAdmissionHost.ts";
import type { RuntimeLedger } from "../journal.ts";
import type {
  AdmittedStudyReportV2,
  GeneralizedParentAdmissionRecord,
  OwnedMediaStudyRecordV2,
  StudyReadinessRecordV3,
  StudyReportArtifactV2,
} from "../model.ts";
import type { PendingRuntimeEvent } from "../protocol.ts";
import { validateStudyReportArtifactV2 } from "../validation/studyReportsV2.ts";
import {
  GeneralizedStudySynthesisHost,
  type GeneralizedStudySynthesisRequest,
  type GeneralizedStudySynthesisResult,
  type GeneralizedStudyV2Reference,
} from "./generalizedStudySynthesisHost.ts";
import {
  GeneralizedStudyReadinessHost,
  type GeneralizedReadinessV3Result,
  type GeneralizedReadinessV3Reference,
} from "./generalizedStudyReadinessHost.ts";

async function storedReport(
  artifacts: ContentAddressedArtifactStore,
  contentId: string,
): Promise<StudyReportArtifactV2> {
  const bytes = await artifacts.receiptBytes(contentId);
  let value: unknown;
  try { value = JSON.parse(bytes.toString("utf8")) as unknown; }
  catch { throw new Error("Stored generalized study report is not valid JSON"); }
  return validateStudyReportArtifactV2(value);
}

export function admittedReportsFromProjection(ledger: RuntimeLedger, parentTaskId: string): AdmittedStudyReportV2[] {
  return Object.values(ledger.state().generalizedParentArtifactAdmissions)
    .filter((entry): entry is GeneralizedParentAdmissionRecord =>
      entry.contractVersion === 2 && entry.parentTaskId === parentTaskId)
    .sort((left, right) => left.admissionId.localeCompare(right.admissionId))
    .map((entry) => ({
      report: structuredClone(entry.report),
      admission: {
        admissionId: entry.admissionId,
        receiptId: entry.receiptId,
        receiptContentId: entry.receiptContentId,
      },
    }));
}

export async function recordGeneralizedAdmission(input: {
  ledger: RuntimeLedger;
  artifacts: ContentAddressedArtifactStore;
  reportId: string;
  outputArtifactId: string;
}): Promise<GeneralizedAdmissionResult & { admissionArtifactId: string }> {
  const state = input.ledger.state();
  const report = state.reports[input.reportId];
  const artifact = state.artifacts[input.outputArtifactId];
  if (report?.study?.schema !== "studio.study-report-submission.v2" || report.status !== "accepted" ||
      artifact?.kind !== "studio.study-report.v2" || artifact.id !== report.study.output.artifactId) {
    throw new Error("Generalized admission requires one exact accepted v2 report artifact");
  }
  const host = new GeneralizedEvidenceAdmissionHost(state, input.artifacts);
  const admitted = await host.admit(await storedReport(input.artifacts, artifact.content.contentId));
  if (admitted.report.artifactId !== artifact.id || admitted.report.contentId !== artifact.content.contentId) {
    throw new Error("Generalized admission changed the launcher's recorded report identity");
  }
  const storedReceipt = await input.artifacts.storeJson(admitted.admissionReceipt);
  const admissionArtifact = input.artifacts.buildGeneralizedParentAdmissionArtifact({
    runId: input.ledger.runId,
    reportId: report.id,
    parentTaskId: report.parentTaskId,
    parentAgentId: report.parentAgentId,
    receipt: admitted.admissionReceipt,
    storedReceipt,
  });
  await input.artifacts.record(input.ledger, admissionArtifact, admitted.admission.admissionId);
  await input.ledger.transact(
    { producer: { kind: "admission_host", id: "generalized-evidence-admission-host" }, causationId: report.id },
    () => ({
      pending: [{ type: "parent.generalized_admission_recorded", data: {
        reportId: report.id,
        outputArtifactId: artifact.id,
        admissionArtifactId: admissionArtifact.id,
        receiptContentId: storedReceipt.content.contentId,
        receipt: admitted.admissionReceipt,
      } }] satisfies PendingRuntimeEvent[],
      result: undefined,
    }),
  );
  return { ...admitted, admissionArtifactId: admissionArtifact.id };
}

export async function recordGeneralizedRead(input: {
  ledger: RuntimeLedger;
  artifacts: ContentAddressedArtifactStore;
  admitted: AdmittedStudyReportV2;
  operationId: string;
  parentTaskId: string;
  parentAgentId: string;
}) {
  const host = new GeneralizedEvidenceAdmissionHost(input.ledger.state(), input.artifacts);
  const read = await host.read(input.admitted, input.operationId);
  const storedReceipt = await input.artifacts.storeJson(read.receipt);
  const receiptArtifact = input.artifacts.buildGeneralizedParentReadArtifact({
    runId: input.ledger.runId,
    parentTaskId: input.parentTaskId,
    parentAgentId: input.parentAgentId,
    receipt: read.receipt,
    storedReceipt,
  });
  await input.artifacts.record(input.ledger, receiptArtifact, input.operationId);
  await input.ledger.transact(
    { producer: { kind: "artifact_read_host", id: "generalized-parent-artifact-read-host" }, causationId: input.admitted.admission.admissionId },
    () => ({
      pending: [{ type: "parent.generalized_artifact_read_completed", data: {
        parentTaskId: input.parentTaskId,
        parentAgentId: input.parentAgentId,
        receiptArtifactId: receiptArtifact.id,
        receiptContentId: storedReceipt.content.contentId,
        receipt: read.receipt,
      } }] satisfies PendingRuntimeEvent[],
      result: undefined,
    }),
  );
  return { ...read, receiptArtifactId: receiptArtifact.id };
}

export async function inspectGeneralizedStudy(
  ledger: RuntimeLedger,
  artifacts: ContentAddressedArtifactStore,
  parentTaskId: string,
) {
  const admitted = admittedReportsFromProjection(ledger, parentTaskId);
  return {
    admitted,
    inspected: await new GeneralizedStudySynthesisHost(ledger.state(), artifacts).inspect(admitted),
  };
}

export async function recordGeneralizedStudy(input: {
  ledger: RuntimeLedger;
  artifacts: ContentAddressedArtifactStore;
  parentTaskId: string;
  request: GeneralizedStudySynthesisRequest;
}): Promise<GeneralizedStudySynthesisResult> {
  const admitted = admittedReportsFromProjection(input.ledger, input.parentTaskId);
  const result = await new GeneralizedStudySynthesisHost(input.ledger.state(), input.artifacts).synthesize(admitted, input.request);
  const [storedStudy, storedReceipt] = await Promise.all([
    input.artifacts.storeJson(result.envelope),
    input.artifacts.storeJson(result.executorReceipt),
  ]);
  const artifact = input.artifacts.buildOwnedMediaStudyArtifactV2({
    runId: input.ledger.runId,
    envelope: result.envelope,
    receipt: result.executorReceipt,
    receiptContentId: storedReceipt.content.contentId,
    storedStudy,
  });
  await input.artifacts.record(input.ledger, artifact, result.study.studyId);
  await input.ledger.transact(
    { producer: { kind: "study_synthesis_host", id: "generalized-study-synthesis-host" }, causationId: result.envelope.root.executionId },
    () => ({
      pending: [{ type: "study.generalized_synthesis_completed", data: {
        studyId: result.study.studyId,
        outputArtifactId: artifact.id,
        outputContentId: artifact.content.contentId,
        executorReceiptContentId: storedReceipt.content.contentId,
        executorReceipt: result.executorReceipt,
        projection: {
          reports: structuredClone(result.envelope.reports),
          coverage: structuredClone(result.envelope.coverage),
          claims: structuredClone(result.envelope.claims),
          evidenceCitations: structuredClone(result.envelope.evidenceCitations),
        },
      } }] satisfies PendingRuntimeEvent[],
      result: undefined,
    }),
  );
  return result;
}

export function generalizedStudyReference(record: OwnedMediaStudyRecordV2): GeneralizedStudyV2Reference {
  return {
    study: {
      studyId: record.id,
      artifactId: record.artifactId,
      contentId: record.contentId,
      bytes: record.bytes,
      schema: "studio.owned-media-study.v2",
    },
    executorReceiptId: record.executorReceiptId,
    executorReceiptContentId: record.executorReceiptContentId,
  };
}

export async function recordGeneralizedReadiness(input: {
  ledger: RuntimeLedger;
  artifacts: ContentAddressedArtifactStore;
  study: OwnedMediaStudyRecordV2;
}): Promise<GeneralizedReadinessV3Result & { artifactId: string }> {
  const reference = generalizedStudyReference(input.study);
  const result = await new GeneralizedStudyReadinessHost(input.ledger.state(), input.artifacts).audit(reference);
  const storedReceipt = await input.artifacts.storeJson(result.receipt);
  const artifact = input.artifacts.buildStudyReadinessArtifactV3({ runId: input.ledger.runId, receipt: result.receipt, storedReceipt });
  await input.artifacts.record(input.ledger, artifact, result.readinessId);
  await input.ledger.transact(
    { producer: { kind: "study_audit_host", id: "generalized-study-readiness-host" }, causationId: input.study.id },
    () => ({
      pending: [{ type: "study.generalized_readiness_audited", data: {
        studyId: input.study.id,
        outputArtifactId: artifact.id,
        receiptContentId: storedReceipt.content.contentId,
        receipt: result.receipt,
        study: structuredClone(reference),
      } }] satisfies PendingRuntimeEvent[],
      result: undefined,
    }),
  );
  return { ...result, artifactId: artifact.id };
}

export function generalizedReadinessReference(record: StudyReadinessRecordV3): GeneralizedReadinessV3Reference {
  return {
    readinessId: record.id,
    receiptId: record.receiptId,
    receiptContentId: record.receiptContentId,
    study: structuredClone(record.study),
  };
}

export async function reopenGeneralizedReadiness(
  ledger: RuntimeLedger,
  artifacts: ContentAddressedArtifactStore,
  readinessId: string,
): Promise<GeneralizedReadinessV3Result> {
  const record = ledger.state().generalizedStudyReadiness[readinessId];
  if (!record || record.schema !== "studio.study-readiness.receipt.v3") throw new Error("Generalized readiness v3 identity is not recorded in this runtime");
  return new GeneralizedStudyReadinessHost(ledger.state(), artifacts).reopen(generalizedReadinessReference(record));
}
