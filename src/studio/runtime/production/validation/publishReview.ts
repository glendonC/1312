import type {
  PublishReviewIntakeReceipt,
  StudyReadinessReceiptIdentity,
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

const READINESS_REASON_ORDER = [
  "hidden_gap",
  "non_supported_root_coverage",
  "stored_content_integrity_failed",
  "unresolved_conflict",
  "unsupported_synthesized_claim",
] as const;

export function validateStudyReadinessReceiptIdentity(
  value: unknown,
  context: string,
  path: string,
): StudyReadinessReceiptIdentity {
  const item = object(value, context, path);
  exact(item, ["readinessId", "artifactId", "receiptId", "receiptContentId"], context, path);
  return {
    readinessId: string(item.readinessId, context, `${path}.readinessId`),
    artifactId: string(item.artifactId, context, `${path}.artifactId`),
    receiptId: string(item.receiptId, context, `${path}.receiptId`),
    receiptContentId: contentId(item.receiptContentId, context, `${path}.receiptContentId`),
  };
}

export function assertPublishReviewIntakeRequest(value: unknown): StudyReadinessReceiptIdentity {
  const context = "Publish-review intake request";
  const item = object(value, context, "request");
  exact(item, ["readiness"], context, "request");
  return validateStudyReadinessReceiptIdentity(item.readiness, context, "request.readiness");
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
  exact(input, ["readiness", "verification"], context, `${path}.input`);
  validateStudyReadinessReceiptIdentity(input.readiness, context, `${path}.input.readiness`);
  const verification = object(input.verification, context, `${path}.input.verification`);
  exact(verification, ["integrity", "producer"], context, `${path}.input.verification`);
  literal(
    verification.integrity,
    "stored_study_readiness_and_recursive_inputs_verified",
    context,
    `${path}.input.verification.integrity`,
  );
  oneOf(
    verification.producer,
    new Set(["deterministic_study_readiness_gate_v1", "deterministic_study_readiness_gate_v3"]),
    context,
    `${path}.input.verification.producer`,
  );

  const producer = object(item.producer, context, `${path}.producer`);
  exact(producer, ["id", "version", "policy"], context, `${path}.producer`);
  literal(producer.id, "studio.host-publish-review-intake", context, `${path}.producer.id`);
  literal(producer.version, "1", context, `${path}.producer.version`);
  literal(
    producer.policy,
    "queue_exact_verified_study_readiness_only",
    context,
    `${path}.producer.policy`,
  );

  const result = object(item.result, context, `${path}.result`);
  exact(result, ["outcome", "reasonCodes"], context, `${path}.result`);
  const outcome = oneOf(result.outcome, new Set(["queued", "rejected"]), context, `${path}.result.outcome`);
  const reasons = uniqueStrings(result.reasonCodes, context, `${path}.result.reasonCodes`);
  if (
    JSON.stringify(reasons) !== JSON.stringify(READINESS_REASON_ORDER.filter((reason) => reasons.includes(reason))) ||
    reasons.some((reason) => !READINESS_REASON_ORDER.includes(reason as (typeof READINESS_REASON_ORDER)[number])) ||
    (outcome === "queued" && reasons.length !== 0) ||
    (outcome === "rejected" && reasons.length === 0)
  ) {
    fail(context, `${path}.result.reasonCodes`, "must be canonical study-readiness reasons for the closed intake outcome");
  }
}
