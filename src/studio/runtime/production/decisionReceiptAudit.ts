import { createHash } from "node:crypto";

import { reopenEvidenceAssessmentAudits } from "./assessmentAudit.ts";
import {
  canonicalJsonContentId,
  canonicalSha256,
  ContentAddressedArtifactStore,
} from "./artifactStore.ts";
import { deriveEvidenceDecision } from "./evidenceDecisionPolicy.ts";
import type {
  AuditedEvidenceAssessmentIdentity,
  EvidenceDecisionOutcome,
  EvidenceDecisionReasonCode,
  EvidenceDecisionReceipt,
  RuntimeProjection,
} from "./model.ts";
import type { RuntimeEvent } from "./protocol.ts";
import { validateEvidenceDecisionReceipt } from "./validation/decision.ts";

const MAX_STORED_DECISION_RECEIPT_BYTES = 128 * 1024;

export interface EvidenceDecisionReceiptVerification {
  operationId: string;
  artifactId: string;
  receiptId: string;
  receiptContentId: string;
  taskId: string;
  agentId: string;
  integrity: "stored_decision_and_audited_inputs_verified";
  producer: "deterministic_audit_state_gate_v1";
  inputs: AuditedEvidenceAssessmentIdentity[];
  outcome: EvidenceDecisionOutcome;
  reasonCodes: EvidenceDecisionReasonCode[];
  auditedAssessmentCount: number;
  auditedClaimCount: number;
}

function expectedStorageKey(contentId: string): string {
  const digest = contentId.replace(/^sha256:/, "");
  return `objects/sha256/${digest.slice(0, 2)}/${digest}`;
}

function sameCanonical(left: unknown, right: unknown): boolean {
  return canonicalSha256(left) === canonicalSha256(right);
}

function decisionReceiptId(receipt: EvidenceDecisionReceipt): string {
  const body = structuredClone(receipt) as unknown as Record<string, unknown>;
  delete body.schema;
  delete body.receiptId;
  return `evidence-decision:${canonicalSha256(body)}`;
}

async function storedReceipt(
  artifacts: ContentAddressedArtifactStore,
  contentId: string,
): Promise<{ receipt: EvidenceDecisionReceipt; bytes: number }> {
  const bytes = await artifacts.receiptBytes(contentId);
  if (bytes.byteLength <= 0 || bytes.byteLength > MAX_STORED_DECISION_RECEIPT_BYTES) {
    throw new Error("Stored evidence-decision receipt exceeds its byte bound");
  }
  const measured = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  if (measured !== contentId) throw new Error("Stored evidence-decision receipt changed content identity");
  let value: unknown;
  try {
    value = JSON.parse(bytes.toString("utf8")) as unknown;
  } catch {
    throw new Error("Stored evidence-decision receipt is invalid JSON");
  }
  if (canonicalJsonContentId(value) !== contentId) {
    throw new Error("Stored evidence-decision receipt is not canonical JSON");
  }
  validateEvidenceDecisionReceipt(value, "Evidence decision receipt verification", "receipt");
  return { receipt: value, bytes: bytes.byteLength };
}

/** Reopens decision receipts and re-runs every assessment audit and deterministic outcome derivation. */
export async function reopenEvidenceDecisionReceipts(
  state: RuntimeProjection,
  events: readonly RuntimeEvent[],
  artifacts: ContentAddressedArtifactStore,
): Promise<EvidenceDecisionReceiptVerification[]> {
  const audits = await reopenEvidenceAssessmentAudits(state, events, artifacts);
  const verified: EvidenceDecisionReceiptVerification[] = [];
  const completed = Object.values(state.evidenceDecisions)
    .filter((decision) => decision.status === "completed")
    .sort((left, right) => left.id.localeCompare(right.id));

  for (const operation of completed) {
    if (!operation.artifactId || !operation.receiptId || !operation.receiptContentId || !operation.outcome) {
      throw new Error(`Completed evidence decision ${operation.id} has an incomplete projection`);
    }
    const artifact = state.artifacts[operation.artifactId];
    const started = events.find((event) =>
      event.type === "analysis.evidence.decision_started" && event.data.request.operationId === operation.id);
    const completion = events.find((event) =>
      event.type === "analysis.evidence.decision_completed" && event.data.operationId === operation.id);
    if (
      !artifact || artifact.origin.kind !== "evidence_decision" ||
      !started || started.type !== "analysis.evidence.decision_started" ||
      !completion || completion.type !== "analysis.evidence.decision_completed"
    ) throw new Error(`Completed evidence decision ${operation.id} has no closed journal/artifact lineage`);

    const expectedArtifactId = `artifact:${canonicalSha256({
      runId: state.runId,
      operationId: operation.id,
      kind: "evidence-decision-receipt",
      contentId: operation.receiptContentId,
    })}`;
    if (
      artifact.id !== expectedArtifactId ||
      artifact.runId !== state.runId ||
      artifact.kind !== "evidence-decision-receipt" ||
      artifact.mediaClass !== "non_media" ||
      artifact.publication !== "private" ||
      artifact.content.contentId !== operation.receiptContentId ||
      artifact.storageKey !== expectedStorageKey(operation.receiptContentId) ||
      artifact.producerTaskId !== operation.taskId ||
      artifact.producerAgentId !== operation.agentId ||
      artifact.origin.operationId !== operation.id ||
      artifact.origin.receiptId !== operation.receiptId ||
      artifact.origin.receiptContentId !== operation.receiptContentId ||
      completion.data.outputArtifactId !== artifact.id ||
      completion.data.receiptContentId !== operation.receiptContentId
    ) throw new Error(`Evidence decision artifact ${artifact.id} does not close against the journal`);

    const stored = await storedReceipt(artifacts, operation.receiptContentId);
    const receipt = stored.receipt;
    const task = state.tasks[operation.taskId];
    const grant = task?.grants.find((candidate) =>
      candidate.id === operation.grantId && candidate.capability === "analysis.evidence.decide");
    const scope = grant?.decisionScope;
    if (
      !scope ||
      artifact.content.bytes !== stored.bytes ||
      receipt.receiptId !== decisionReceiptId(receipt) ||
      receipt.receiptId !== operation.receiptId ||
      receipt.operationId !== operation.id ||
      receipt.authorization.grantId !== operation.grantId ||
      receipt.authorization.taskId !== operation.taskId ||
      receipt.authorization.agentId !== operation.agentId ||
      receipt.authorization.maxDecisions !== scope.maxDecisions ||
      receipt.authorization.maxAuditedAssessments !== operation.maxAuditedAssessments ||
      receipt.decision.outcome !== operation.outcome ||
      !sameCanonical(receipt.decision.reasonCodes, operation.reasonCodes) ||
      !sameCanonical(completion.data.receipt, receipt)
    ) throw new Error(`Stored evidence decision ${receipt.receiptId} changed its authorization or completion`);

    if (
      !sameCanonical(started.data.request.auditedAssessments, receipt.inputs) ||
      !sameCanonical(artifact.origin.assessmentOperationIds, receipt.inputs.map((input) => input.operationId)) ||
      !sameCanonical(artifact.origin.assessmentArtifactIds, receipt.inputs.map((input) => input.artifactId)) ||
      !sameCanonical(artifact.origin.assessmentReceiptIds, receipt.inputs.map((input) => input.receiptId)) ||
      !sameCanonical(artifact.origin.assessmentReceiptContentIds, receipt.inputs.map((input) => input.receiptContentId)) ||
      !sameCanonical(artifact.sourceArtifactIds, receipt.inputs.map((input) => input.artifactId))
    ) throw new Error(`Stored evidence decision ${receipt.receiptId} changed its audited assessment identities`);

    const inputAudits = receipt.inputs.map((identity) => {
      const audit = audits.find((candidate) =>
        candidate.operationId === identity.operationId &&
        candidate.artifactId === identity.artifactId &&
        candidate.receiptId === identity.receiptId &&
        candidate.receiptContentId === identity.receiptContentId);
      if (!audit || audit.taskId !== operation.taskId || audit.agentId !== operation.agentId) {
        throw new Error(`Stored evidence decision ${receipt.receiptId} has an input that no longer passes audit`);
      }
      return audit;
    });
    const derived = deriveEvidenceDecision(inputAudits);
    if (
      receipt.decision.outcome !== derived.outcome ||
      !sameCanonical(receipt.decision.reasonCodes, derived.reasonCodes) ||
      receipt.result.auditedAssessmentCount !== inputAudits.length ||
      receipt.result.auditedClaimCount !== derived.auditedClaimCount
    ) throw new Error(`Stored evidence decision ${receipt.receiptId} no longer matches deterministic audit-state policy`);

    verified.push({
      operationId: operation.id,
      artifactId: artifact.id,
      receiptId: receipt.receiptId,
      receiptContentId: operation.receiptContentId,
      taskId: operation.taskId,
      agentId: operation.agentId,
      integrity: "stored_decision_and_audited_inputs_verified",
      producer: "deterministic_audit_state_gate_v1",
      inputs: structuredClone(receipt.inputs),
      outcome: receipt.decision.outcome,
      reasonCodes: [...receipt.decision.reasonCodes],
      auditedAssessmentCount: receipt.result.auditedAssessmentCount,
      auditedClaimCount: receipt.result.auditedClaimCount,
    });
  }
  return verified;
}
