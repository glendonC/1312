import type {
  AuditedEvidenceAssessmentIdentity,
  EvidenceDecisionReceipt,
  EvidenceDecisionReasonCode,
  EvidenceDecisionRequest,
} from "../model.ts";
import { array, contentId, exact, fail, integer, literal, object, oneOf, string } from "./primitives.ts";
import {
  MAX_EVIDENCE_DECISIONS,
  MAX_EVIDENCE_DECISION_AUDITED_ASSESSMENTS,
} from "./scheduling.ts";

const OUTCOMES = new Set(["withheld", "proceed_to_publish_review"]);
const REASON_CODES = new Set<EvidenceDecisionReasonCode>([
  "all_audited_claims_supported",
  "audited_claim_withheld",
  "audited_claim_unknown",
  "audited_claim_truncated",
]);
const REASON_ORDER: EvidenceDecisionReasonCode[] = [
  "audited_claim_withheld",
  "audited_claim_unknown",
  "audited_claim_truncated",
  "all_audited_claims_supported",
];

function identity(value: unknown, context: string, path: string): string {
  const result = string(value, context, path);
  if (result.length > 200 || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(result)) {
    fail(context, path, "must be a stable path-free identity");
  }
  return result;
}

function auditedIdentity(value: unknown, context: string, path: string): AuditedEvidenceAssessmentIdentity {
  const item = object(value, context, path);
  exact(item, ["operationId", "artifactId", "receiptId", "receiptContentId"], context, path);
  return {
    operationId: identity(item.operationId, context, `${path}.operationId`),
    artifactId: identity(item.artifactId, context, `${path}.artifactId`),
    receiptId: identity(item.receiptId, context, `${path}.receiptId`),
    receiptContentId: contentId(item.receiptContentId, context, `${path}.receiptContentId`),
  };
}

function auditedIdentities(value: unknown, context: string, path: string): AuditedEvidenceAssessmentIdentity[] {
  const items = array(value, context, path);
  if (items.length === 0 || items.length > MAX_EVIDENCE_DECISION_AUDITED_ASSESSMENTS) {
    fail(context, path, `must contain 1-${MAX_EVIDENCE_DECISION_AUDITED_ASSESSMENTS} audited assessment identities`);
  }
  const result = items.map((item, index) => auditedIdentity(item, context, `${path}[${index}]`));
  if (new Set(result.map((item) => item.operationId)).size !== result.length) {
    fail(context, path, "must not repeat an assessment operation");
  }
  return result;
}

export function assertEvidenceDecisionRequest(
  value: unknown,
  context = "Evidence decision request",
): asserts value is EvidenceDecisionRequest {
  const item = object(value, context, "request");
  exact(item, ["operationId", "taskId", "agentId", "auditedAssessments"], context, "request");
  identity(item.operationId, context, "request.operationId");
  identity(item.taskId, context, "request.taskId");
  identity(item.agentId, context, "request.agentId");
  auditedIdentities(item.auditedAssessments, context, "request.auditedAssessments");
}

export function validateEvidenceDecisionReceipt(
  value: unknown,
  context = "Evidence decision receipt",
  path = "receipt",
): asserts value is EvidenceDecisionReceipt {
  const item = object(value, context, path);
  exact(
    item,
    ["schema", "receiptId", "operationId", "capability", "authorization", "inputs", "producer", "decision", "result"],
    context,
    path,
  );
  literal(item.schema, "studio.evidence-decision.receipt.v1", context, `${path}.schema`);
  identity(item.receiptId, context, `${path}.receiptId`);
  identity(item.operationId, context, `${path}.operationId`);
  literal(item.capability, "analysis.evidence.decide", context, `${path}.capability`);

  const authorization = object(item.authorization, context, `${path}.authorization`);
  exact(authorization, ["grantId", "taskId", "agentId", "maxDecisions", "maxAuditedAssessments"], context, `${path}.authorization`);
  identity(authorization.grantId, context, `${path}.authorization.grantId`);
  identity(authorization.taskId, context, `${path}.authorization.taskId`);
  identity(authorization.agentId, context, `${path}.authorization.agentId`);
  const maxDecisions = integer(authorization.maxDecisions, context, `${path}.authorization.maxDecisions`, 1);
  const maxAuditedAssessments = integer(authorization.maxAuditedAssessments, context, `${path}.authorization.maxAuditedAssessments`, 1);
  if (maxDecisions > MAX_EVIDENCE_DECISIONS || maxAuditedAssessments > MAX_EVIDENCE_DECISION_AUDITED_ASSESSMENTS) {
    fail(context, `${path}.authorization`, "exceeds hard evidence-decision bounds");
  }

  const inputs = auditedIdentities(item.inputs, context, `${path}.inputs`);
  if (inputs.length > maxAuditedAssessments) fail(context, `${path}.inputs`, "exceeds the authorized audited-assessment count");

  const producer = object(item.producer, context, `${path}.producer`);
  exact(producer, ["id", "version", "policy"], context, `${path}.producer`);
  literal(producer.id, "studio.deterministic-audited-assessment-decision", context, `${path}.producer.id`);
  literal(producer.version, "1", context, `${path}.producer.version`);
  literal(producer.policy, "withhold_on_preserved_gap_state", context, `${path}.producer.policy`);

  const decision = object(item.decision, context, `${path}.decision`);
  exact(decision, ["outcome", "reasonCodes"], context, `${path}.decision`);
  const outcome = oneOf(decision.outcome, OUTCOMES, context, `${path}.decision.outcome`);
  const reasons = array(decision.reasonCodes, context, `${path}.decision.reasonCodes`).map((reason, index) =>
    oneOf<EvidenceDecisionReasonCode>(reason, REASON_CODES, context, `${path}.decision.reasonCodes[${index}]`));
  if (reasons.length === 0 || new Set(reasons).size !== reasons.length) {
    fail(context, `${path}.decision.reasonCodes`, "must contain unique closed reason codes");
  }
  if (JSON.stringify(reasons) !== JSON.stringify(REASON_ORDER.filter((reason) => reasons.includes(reason)))) {
    fail(context, `${path}.decision.reasonCodes`, "must use canonical reason-code order");
  }
  if (
    (outcome === "proceed_to_publish_review" && (reasons.length !== 1 || reasons[0] !== "all_audited_claims_supported")) ||
    (outcome === "withheld" && reasons.includes("all_audited_claims_supported"))
  ) fail(context, `${path}.decision`, "outcome and reason codes disagree");

  const result = object(item.result, context, `${path}.result`);
  exact(result, ["auditedAssessmentCount", "auditedClaimCount"], context, `${path}.result`);
  const auditedAssessmentCount = integer(result.auditedAssessmentCount, context, `${path}.result.auditedAssessmentCount`, 1);
  integer(result.auditedClaimCount, context, `${path}.result.auditedClaimCount`, 1);
  if (auditedAssessmentCount !== inputs.length) {
    fail(context, `${path}.result.auditedAssessmentCount`, "must equal the input identity count");
  }
}
