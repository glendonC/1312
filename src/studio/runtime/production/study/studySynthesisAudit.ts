import {
  canonicalJsonContentId,
  canonicalSha256,
  ContentAddressedArtifactStore,
} from "../artifactStore.ts";
import type {
  OwnedMediaStudyArtifact,
  OwnedMediaStudyExecutorReceipt,
  RuntimeProjection,
  StudyCoverageRange,
} from "../model.ts";
import { reopenParentArtifactDisposition } from "../admission/parentArtifactAdmissionAudit.ts";
import { reopenStudyPlanningDecision } from "./studyPlanningAudit.ts";
import {
  deriveOwnedMediaStudyChildDispositions,
  deriveOwnedMediaStudyFollowUpHistory,
} from "./studySynthesisLineage.ts";
import { readCanonicalStoredJson } from "./studyReportAudit.ts";
import { validateCoveragePartition } from "../validation/studyReports.ts";
import {
  validateOwnedMediaStudyArtifact,
  validateOwnedMediaStudyExecutorReceipt,
} from "../validation/studies.ts";

function same(left: unknown, right: unknown): boolean {
  return canonicalSha256(left) === canonicalSha256(right);
}

function executorReceiptId(receipt: OwnedMediaStudyExecutorReceipt): string {
  const body = structuredClone(receipt) as unknown as Record<string, unknown>;
  delete body.schema;
  delete body.receiptId;
  return `owned-media-study-executor-receipt:${canonicalSha256(body)}`;
}

export interface VerifiedOwnedMediaStudy {
  record: RuntimeProjection["ownedMediaStudies"][string];
  artifact: RuntimeProjection["artifacts"][string];
  envelope: OwnedMediaStudyArtifact;
  executorReceipt: OwnedMediaStudyExecutorReceipt;
  reopened: {
    sourceArtifactIds: string[];
    semanticEvidenceArtifactIds: string[];
    reportArtifactIds: string[];
    admissionIds: string[];
    planningDecisionIds: string[];
    executorIds: string[];
  };
}

/** Recursively reopens study, planning, admissions, reports, semantic observations, source, and executors. */
export async function reopenOwnedMediaStudy(
  state: RuntimeProjection,
  artifacts: ContentAddressedArtifactStore,
  studyId: string,
): Promise<VerifiedOwnedMediaStudy> {
  const record = state.ownedMediaStudies[studyId];
  const artifact = record ? state.artifacts[record.artifactId] : null;
  if (!record || !artifact || artifact.origin.kind !== "owned_media_study") throw new Error(`Owned-media study ${studyId} is absent`);
  const [studyValue, executorValue] = await Promise.all([
    readCanonicalStoredJson(artifacts, artifact.content.contentId, 512 * 1024, "Stored owned-media study"),
    readCanonicalStoredJson(artifacts, record.executorReceiptContentId, 256 * 1024, "Stored owned-media study executor receipt"),
  ]);
  const envelope = validateOwnedMediaStudyArtifact(studyValue);
  validateOwnedMediaStudyExecutorReceipt(executorValue);
  const executorReceipt = executorValue;
  const planning = await reopenStudyPlanningDecision(state, artifacts, record.planningDecisionId);
  const root = state.tasks[record.rootTaskId];
  const execution = state.executions[record.executionId];
  const expectedStudyId = `owned-media-study:${canonicalSha256({
    runId: state.runId,
    planningDecisionId: envelope.planning.decisionId,
    executionId: envelope.root.executionId,
    contentId: artifact.content.contentId,
  })}`;
  const expectedArtifactId = `artifact:${canonicalSha256({ runId: state.runId, studyId: expectedStudyId, kind: "studio.owned-media-study.v1", contentId: artifact.content.contentId })}`;
  if (
    studyId !== expectedStudyId || artifact.id !== expectedArtifactId || canonicalJsonContentId(envelope) !== artifact.content.contentId ||
    envelope.runId !== state.runId || !root || root.parentTaskId !== null || !same(envelope.root.jobContext, root.jobContext) ||
    envelope.root.taskId !== root.id || envelope.root.agentId !== root.assignedAgentId || envelope.root.executionId !== execution?.id ||
    execution.status !== "completed" || execution.taskId !== root.id || execution.agentId !== root.assignedAgentId ||
    execution.receipt?.outcome !== "completed" || !execution.receipt.outputArtifactIds.includes(artifact.id) ||
    executorReceipt.receiptId !== executorReceiptId(executorReceipt) || executorReceipt.receiptId !== record.executorReceiptId ||
    executorReceipt.output.artifactId !== artifact.id || executorReceipt.output.contentId !== artifact.content.contentId ||
    executorReceipt.output.bytes !== artifact.content.bytes || executorReceipt.execution.executionId !== execution.id ||
    executorReceipt.planning.decisionId !== planning.receipt.decisionId ||
    envelope.planning.decisionId !== planning.receipt.decisionId || envelope.planning.receiptId !== planning.receipt.receiptId ||
    envelope.planning.receiptContentId !== planning.artifact.content.contentId || envelope.planning.inputId !== planning.receipt.input.inputId ||
    !same(envelope.reports, planning.receipt.input.reports) ||
    !same(envelope.childDispositions, deriveOwnedMediaStudyChildDispositions(state, root.id)) ||
    !same(envelope.followUpHistory, deriveOwnedMediaStudyFollowUpHistory(state)) || !same(record.coverage, envelope.coverage) ||
    !same(record.conflicts, envelope.conflicts)
  ) throw new Error(`Owned-media study ${studyId} changed its content, root executor, planning decision, or report inputs`);
  validateCoveragePartition(envelope.coverage as StudyCoverageRange[], root.mediaScope, "Owned-media study audit coverage");
  const planningCoverage = new Map(planning.receipt.input.coverage.map((entry) => [entry.coverageId, entry]));
  if (!same(envelope.coverage.map((entry) => entry.coverageId), planning.receipt.input.coverage.map((entry) => entry.coverageId))) {
    throw new Error(`Owned-media study ${studyId} hid or duplicated root coverage`);
  }
  for (const range of envelope.coverage) {
    const planned = planningCoverage.get(range.coverageId);
    if (!planned || !same(planned.range, { artifactId: range.artifactId, trackId: range.trackId, startMs: range.startMs, endMs: range.endMs }) ||
        ((planned.aggregate === "gap" || planned.aggregate === "conflict") && range.state === "supported")) {
      throw new Error(`Owned-media study ${studyId} promoted an uncovered, unresolved, or changed range`);
    }
  }
  if (!same(envelope.conflicts.map((entry) => entry.conflictId), planning.receipt.input.conflicts.map((entry) => entry.conflictId))) {
    throw new Error(`Owned-media study ${studyId} hid an exact conflict identity`);
  }

  const reportArtifactIds: string[] = [];
  const admissionIds: string[] = [];
  const executorIds = new Set<string>([execution.id]);
  const semanticEvidenceArtifactIds = new Set<string>();
  for (const reportInput of envelope.reports) {
    const reopened = await reopenParentArtifactDisposition(state, artifacts, reportInput.dispositionId);
    if (!reopened.admission || reopened.study.artifact.id !== reportInput.artifactId ||
        reopened.study.artifact.content.contentId !== reportInput.contentId || reopened.admission.admissionId !== reportInput.admissionId) {
      throw new Error(`Owned-media study ${studyId} changed an admitted child report`);
    }
    reportArtifactIds.push(reopened.study.artifact.id);
    admissionIds.push(reopened.admission.admissionId);
    executorIds.add(reopened.study.executorReceipt.executionId);
    for (const input of reopened.study.envelope.semanticEvidenceInputs) semanticEvidenceArtifactIds.add(input.artifactId);
  }
  for (const claim of envelope.claims) {
    const supportedSemanticCitations = new Set<string>();
    for (const citation of claim.childReportCitations) {
      const input = envelope.reports.find((report) => report.reportId === citation.reportId);
      const disposition = input ? await reopenParentArtifactDisposition(state, artifacts, input.dispositionId) : null;
      const childClaim = disposition?.study.envelope.claims.find((candidate) => candidate.claimId === citation.claimId);
      if (!input || !disposition?.admission || citation.artifactId !== input.artifactId || citation.contentId !== input.contentId ||
          citation.admissionId !== input.admissionId || !childClaim || childClaim.artifactId !== claim.artifactId ||
          childClaim.trackId !== claim.trackId || childClaim.startMs !== claim.startMs || childClaim.endMs !== claim.endMs) {
        throw new Error(`Owned-media study claim ${claim.claimId} lost exact report or semantic observation support`);
      }
      for (const semanticCitation of childClaim.citations) supportedSemanticCitations.add(canonicalSha256(semanticCitation));
      if (childClaim.citations.some((semanticCitation) => !claim.semanticCitations.some((candidate) => same(candidate, semanticCitation)))) {
        throw new Error(`Owned-media study claim ${claim.claimId} omitted semantic support from a cited child claim`);
      }
    }
    if (claim.semanticCitations.some((citation) => !supportedSemanticCitations.has(canonicalSha256(citation)))) {
      throw new Error(`Owned-media study claim ${claim.claimId} introduced semantic support absent from its cited child claims`);
    }
  }
  const sourceArtifactIds: string[] = [];
  for (const source of envelope.sourceArtifacts) {
    const sourceArtifact = state.artifacts[source.artifactId];
    if (!sourceArtifact || sourceArtifact.content.contentId !== source.contentId) throw new Error(`Owned-media study ${studyId} lost a source identity`);
    await artifacts.resolveVerified(sourceArtifact);
    sourceArtifactIds.push(source.artifactId);
  }
  if (!same([...sourceArtifactIds].sort(), [...artifact.sourceArtifactIds].sort())) {
    throw new Error(`Owned-media study ${studyId} changed its runtime source lineage`);
  }
  return {
    record: structuredClone(record),
    artifact: structuredClone(artifact),
    envelope: structuredClone(envelope),
    executorReceipt: structuredClone(executorReceipt),
    reopened: {
      sourceArtifactIds: [...sourceArtifactIds].sort(),
      semanticEvidenceArtifactIds: [...semanticEvidenceArtifactIds].sort(),
      reportArtifactIds: reportArtifactIds.sort(),
      admissionIds: admissionIds.sort(),
      planningDecisionIds: [planning.receipt.decisionId],
      executorIds: [...executorIds].sort(),
    },
  };
}
