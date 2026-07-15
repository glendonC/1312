import type {
  EvidenceDecisionReceiptIdentity,
  PublishReviewIntakeReceipt,
} from "../model.ts";
import {
  contentId,
  exact,
  fail,
  literal,
  object,
  oneOf,
  string,
  uniqueStrings,
} from "./primitives.ts";

const DECISION_REASON_ORDER = [
  "audited_claim_withheld",
  "audited_claim_unknown",
  "audited_claim_truncated",
  "all_audited_claims_supported",
] as const;

export function validateEvidenceDecisionReceiptIdentity(
  value: unknown,
  context: string,
  path: string,
): EvidenceDecisionReceiptIdentity {
  const item = object(value, context, path);
  exact(item, ["operationId", "artifactId", "receiptId", "receiptContentId"], context, path);
  return {
    operationId: string(item.operationId, context, `${path}.operationId`),
    artifactId: string(item.artifactId, context, `${path}.artifactId`),
    receiptId: string(item.receiptId, context, `${path}.receiptId`),
    receiptContentId: contentId(item.receiptContentId, context, `${path}.receiptContentId`),
  };
}

export function assertPublishReviewIntakeRequest(value: unknown): EvidenceDecisionReceiptIdentity {
  const context = "Publish-review intake request";
  const item = object(value, context, "request");
  exact(item, ["decision"], context, "request");
  return validateEvidenceDecisionReceiptIdentity(item.decision, context, "request.decision");
}

export function validatePublishReviewIntakeReceipt(
  value: unknown,
  context = "Publish-review intake receipt",
  path = "receipt",
): asserts value is PublishReviewIntakeReceipt {
  const item = object(value, context, path);
  exact(item, ["schema", "receiptId", "intakeId", "input", "producer", "result"], context, path);
  literal(item.schema, "studio.publish-review-intake.receipt.v1", context, `${path}.schema`);
  string(item.receiptId, context, `${path}.receiptId`);
  string(item.intakeId, context, `${path}.intakeId`);

  const input = object(item.input, context, `${path}.input`);
  exact(input, ["decision", "verification"], context, `${path}.input`);
  validateEvidenceDecisionReceiptIdentity(input.decision, context, `${path}.input.decision`);
  const verification = object(input.verification, context, `${path}.input.verification`);
  exact(verification, ["integrity", "producer"], context, `${path}.input.verification`);
  literal(
    verification.integrity,
    "stored_decision_and_audited_inputs_verified",
    context,
    `${path}.input.verification.integrity`,
  );
  literal(
    verification.producer,
    "deterministic_audit_state_gate_v1",
    context,
    `${path}.input.verification.producer`,
  );

  const producer = object(item.producer, context, `${path}.producer`);
  exact(producer, ["id", "version", "policy"], context, `${path}.producer`);
  literal(producer.id, "studio.host-publish-review-intake", context, `${path}.producer.id`);
  literal(producer.version, "1", context, `${path}.producer.version`);
  literal(
    producer.policy,
    "queue_verified_proceed_reject_verified_withheld",
    context,
    `${path}.producer.policy`,
  );

  const result = object(item.result, context, `${path}.result`);
  exact(result, ["outcome", "reasonCodes"], context, `${path}.result`);
  const outcome = oneOf(result.outcome, new Set(["queued", "rejected"]), context, `${path}.result.outcome`);
  const reasons = uniqueStrings(result.reasonCodes, context, `${path}.result.reasonCodes`);
  if (
    reasons.length === 0 ||
    JSON.stringify(reasons) !== JSON.stringify(DECISION_REASON_ORDER.filter((reason) => reasons.includes(reason))) ||
    reasons.some((reason) => !DECISION_REASON_ORDER.includes(reason as (typeof DECISION_REASON_ORDER)[number])) ||
    (outcome === "queued" && (reasons.length !== 1 || reasons[0] !== "all_audited_claims_supported")) ||
    (outcome === "rejected" && reasons.includes("all_audited_claims_supported"))
  ) {
    fail(context, `${path}.result.reasonCodes`, "must be canonical decision reasons for the closed intake outcome");
  }
}
