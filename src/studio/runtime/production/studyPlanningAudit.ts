import {
  canonicalSha256,
  ContentAddressedArtifactStore,
} from "./artifactStore.ts";
import type {
  RuntimeProjection,
  StudyPlanningDecisionReceipt,
} from "./model.ts";
import { deriveStudyPlanningInput } from "./studyPlanningHost.ts";
import { readCanonicalStoredJson } from "./studyReportAudit.ts";
import { validateStudyPlanningDecisionReceipt } from "./validation/studies.ts";

function same(left: unknown, right: unknown): boolean {
  return canonicalSha256(left) === canonicalSha256(right);
}

function receiptId(receipt: StudyPlanningDecisionReceipt): string {
  const body = structuredClone(receipt) as unknown as Record<string, unknown>;
  delete body.schema;
  delete body.receiptId;
  return `study-planning-receipt:${canonicalSha256(body)}`;
}

export interface VerifiedStudyPlanningDecision {
  receipt: StudyPlanningDecisionReceipt;
  artifact: RuntimeProjection["artifacts"][string];
}

/** Reopens the planning receipt, its admitted reads, and every recursively audited child report. */
export async function reopenStudyPlanningDecision(
  state: RuntimeProjection,
  artifacts: ContentAddressedArtifactStore,
  decisionId: string,
): Promise<VerifiedStudyPlanningDecision> {
  const record = state.studyPlanningDecisions[decisionId];
  const artifact = record ? state.artifacts[record.artifactId] : null;
  if (!record || !artifact || artifact.origin.kind !== "study_planning_decision") {
    throw new Error(`Study planning decision ${decisionId} is absent`);
  }
  const value = await readCanonicalStoredJson(artifacts, artifact.content.contentId, 512 * 1024, "Stored study planning decision");
  const receipt = validateStudyPlanningDecisionReceipt(value);
  const derived = await deriveStudyPlanningInput(
    state,
    artifacts,
    record.executionId,
    receipt.input.reports.map((report) => report.reportId),
    true,
  );
  if (
    receipt.receiptId !== receiptId(receipt) || receipt.receiptId !== record.receiptId ||
    receipt.decisionId !== record.id || artifact.content.contentId !== record.receiptContentId ||
    artifact.origin.receiptContentId !== record.receiptContentId ||
    artifact.origin.receiptId !== record.receiptId || artifact.origin.inputId !== record.inputId ||
    artifact.origin.executionId !== record.executionId ||
    !same(receipt.input, derived) || !same(receipt.input, record.input) || receipt.input.inputId !== record.inputId ||
    receipt.modelExecutor.executionId !== record.executionId || receipt.modelExecutor.taskId !== record.rootTaskId ||
    receipt.modelExecutor.agentId !== record.rootAgentId || receipt.decision.outcome !== record.outcome ||
    receipt.decision.reason !== record.reason ||
    !same(receipt.decision.citedGapIds, record.citedGapIds) ||
    !same(receipt.decision.citedConflictIds, record.citedConflictIds)
  ) throw new Error(`Study planning decision ${decisionId} changed its admitted inputs, exact identities, model executor, or outcome`);
  await artifacts.resolveVerified(artifact);
  return { receipt: structuredClone(receipt), artifact: structuredClone(artifact) };
}
