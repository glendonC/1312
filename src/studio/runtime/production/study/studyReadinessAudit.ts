import {
  canonicalSha256,
  ContentAddressedArtifactStore,
} from "../artifactStore.ts";
import type {
  RuntimeProjection,
  StudyReadinessReceipt,
  StudyReadinessReceiptIdentity,
} from "../model.ts";
import { readCanonicalStoredJson } from "./studyReportAudit.ts";
import { reopenOwnedMediaStudy } from "./studySynthesisAudit.ts";
import { validateStudyReadinessReceipt } from "../validation/studies.ts";

function same(left: unknown, right: unknown): boolean {
  return canonicalSha256(left) === canonicalSha256(right);
}

function receiptId(receipt: StudyReadinessReceipt): string {
  const body = structuredClone(receipt) as unknown as Record<string, unknown>;
  delete body.schema;
  delete body.receiptId;
  return `study-readiness-receipt:${canonicalSha256(body)}`;
}

export interface VerifiedStudyReadiness extends StudyReadinessReceiptIdentity {
  receipt: StudyReadinessReceipt;
}

export async function reopenStudyReadiness(
  state: RuntimeProjection,
  artifacts: ContentAddressedArtifactStore,
  readinessId: string,
): Promise<VerifiedStudyReadiness> {
  const record = state.studyReadiness[readinessId];
  const artifact = record ? state.artifacts[record.artifactId] : null;
  if (!record || !artifact || artifact.origin.kind !== "study_readiness") throw new Error(`Study readiness ${readinessId} is absent`);
  const value = await readCanonicalStoredJson(artifacts, artifact.content.contentId, 256 * 1024, "Stored study readiness receipt");
  validateStudyReadinessReceipt(value);
  const receipt = value;
  let study: Awaited<ReturnType<typeof reopenOwnedMediaStudy>> | null = null;
  let studyFailure: unknown = null;
  try {
    study = await reopenOwnedMediaStudy(state, artifacts, record.studyId);
  } catch (error) {
    studyFailure = error;
  }
  if (receipt.result.reasonCodes.includes("stored_content_integrity_failed")) {
    if (!studyFailure) throw new Error(`Study readiness ${readinessId} claims an integrity failure that no longer exists`);
  } else {
    if (!study) throw new Error(`Study readiness ${readinessId} lost a recursively verified study input`, { cause: studyFailure });
    const coverageIds = study.envelope.coverage.map((entry) => entry.coverageId);
    const expectedReasons = [
      ...(study.envelope.coverage.some((entry) => entry.state !== "supported") ? ["non_supported_root_coverage" as const] : []),
      ...(study.envelope.conflicts.length > 0 ? ["unresolved_conflict" as const] : []),
      ...(coverageIds.length !== state.studyPlanningDecisions[study.record.planningDecisionId]?.coverageIds.length ||
        state.studyPlanningDecisions[study.record.planningDecisionId]?.coverageIds.some((id) => !coverageIds.includes(id)) ? ["hidden_gap" as const] : []),
    ].sort();
    if (
      !same(receipt.reopened, study.reopened) || !same(receipt.result.coverageIds, coverageIds) ||
      !same(receipt.result.conflictIds, study.envelope.conflicts.map((entry) => entry.conflictId)) ||
      !same(receipt.result.reasonCodes, expectedReasons) ||
      receipt.result.outcome !== (expectedReasons.length === 0 ? "proceed_to_caption_review" : "withheld")
    ) throw new Error(`Study readiness ${readinessId} no longer satisfies its deterministic structural gate`);
  }
  if (
    receipt.receiptId !== receiptId(receipt) || receipt.receiptId !== record.receiptId ||
    receipt.readinessId !== record.id || receipt.input.studyId !== record.studyId ||
    receipt.input.artifactId !== record.studyArtifactId || receipt.input.contentId !== record.studyContentId ||
    receipt.result.outcome !== record.outcome || !same(receipt.result.reasonCodes, record.reasonCodes) ||
    artifact.content.contentId !== record.receiptContentId || artifact.origin.receiptId !== record.receiptId ||
    artifact.origin.receiptContentId !== record.receiptContentId || artifact.origin.outcome !== record.outcome
  ) throw new Error(`Study readiness ${readinessId} changed its exact study, outcome, reasons, or receipt identity`);
  await artifacts.resolveVerified(artifact);
  return {
    readinessId,
    artifactId: artifact.id,
    receiptId: receipt.receiptId,
    receiptContentId: artifact.content.contentId,
    receipt: structuredClone(receipt),
  };
}
