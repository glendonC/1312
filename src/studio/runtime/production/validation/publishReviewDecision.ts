import type {
  PublishReviewDecisionReceipt,
  PublishReviewDecisionReceiptIdentity,
  PublishReviewDecisionRequest,
  PublishReviewIntakeReceiptIdentity,
  PublishReviewOperator,
  PublishReviewRevocationReceipt,
  PublishReviewRevocationRequest,
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

export const PUBLISH_REVIEW_DECISION_ATTESTATION =
  "I attest that I am the named reviewer and made this review decision." as const;
export const PUBLISH_REVIEW_REVOCATION_ATTESTATION =
  "I attest that I am the named reviewer and made this revocation decision." as const;

export const PUBLISH_REVIEW_DECISION_REASON_ORDER = [
  "reviewer_attested_caption_production_may_proceed",
  "evidence_requires_additional_review",
  "source_scope_not_approved",
  "rights_or_policy_concern",
  "other_review_concern",
] as const;

export const PUBLISH_REVIEW_REVOCATION_REASON_ORDER = [
  "approval_entered_in_error",
  "new_review_required",
  "source_scope_changed",
  "rights_or_policy_concern",
] as const;

function stableIdentity(value: unknown, context: string, path: string): string {
  const identity = string(value, context, path);
  if (
    identity.length > 160 ||
    identity.trim() !== identity ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(identity)
  ) fail(context, path, "must be a stable path-free identity");
  return identity;
}

function boundedLabel(value: unknown, context: string, path: string): string {
  const label = string(value, context, path);
  if (label.length > 80 || label.trim() !== label || /[\r\n\u0000-\u001f\u007f]/.test(label)) {
    fail(context, path, "must be a trimmed single-line label of at most 80 characters");
  }
  return label;
}

function boundedNote(value: unknown, context: string, path: string): string | null {
  if (value === null) return null;
  const note = string(value, context, path);
  if (note.length > 280 || note.trim() !== note || /[\r\n\u0000-\u001f\u007f]/.test(note)) {
    fail(context, path, "must be null or a trimmed single-line note of at most 280 characters");
  }
  return note;
}

export function validatePublishReviewOperator(
  value: unknown,
  context = "Publish-review operator",
  path = "reviewer",
): PublishReviewOperator {
  const item = object(value, context, path);
  exact(item, ["id", "label"], context, path);
  return {
    id: stableIdentity(item.id, context, `${path}.id`),
    label: boundedLabel(item.label, context, `${path}.label`),
  };
}

export function validatePublishReviewIntakeReceiptIdentity(
  value: unknown,
  context: string,
  path: string,
): PublishReviewIntakeReceiptIdentity {
  const item = object(value, context, path);
  exact(item, ["intakeId", "artifactId", "receiptId", "receiptContentId"], context, path);
  return {
    intakeId: stableIdentity(item.intakeId, context, `${path}.intakeId`),
    artifactId: stableIdentity(item.artifactId, context, `${path}.artifactId`),
    receiptId: stableIdentity(item.receiptId, context, `${path}.receiptId`),
    receiptContentId: contentId(item.receiptContentId, context, `${path}.receiptContentId`),
  };
}

export function validatePublishReviewDecisionReceiptIdentity(
  value: unknown,
  context: string,
  path: string,
): PublishReviewDecisionReceiptIdentity {
  const item = object(value, context, path);
  exact(item, ["reviewId", "artifactId", "receiptId", "receiptContentId"], context, path);
  return {
    reviewId: stableIdentity(item.reviewId, context, `${path}.reviewId`),
    artifactId: stableIdentity(item.artifactId, context, `${path}.artifactId`),
    receiptId: stableIdentity(item.receiptId, context, `${path}.receiptId`),
    receiptContentId: contentId(item.receiptContentId, context, `${path}.receiptContentId`),
  };
}

function validateDecision(
  value: unknown,
  context: string,
  path: string,
): PublishReviewDecisionRequest["decision"] {
  const item = object(value, context, path);
  exact(item, ["outcome", "reasonCodes", "note"], context, path);
  const outcome = oneOf<PublishReviewDecisionRequest["decision"]["outcome"]>(
    item.outcome,
    new Set(["approve_for_caption_production", "reject_with_reasons"]),
    context,
    `${path}.outcome`,
  );
  const reasons = uniqueStrings(item.reasonCodes, context, `${path}.reasonCodes`);
  if (
    reasons.length === 0 ||
    reasons.some((reason) => !PUBLISH_REVIEW_DECISION_REASON_ORDER.includes(
      reason as (typeof PUBLISH_REVIEW_DECISION_REASON_ORDER)[number],
    )) ||
    JSON.stringify(reasons) !== JSON.stringify(
      PUBLISH_REVIEW_DECISION_REASON_ORDER.filter((reason) => reasons.includes(reason)),
    ) ||
    (outcome === "approve_for_caption_production" &&
      (reasons.length !== 1 || reasons[0] !== "reviewer_attested_caption_production_may_proceed")) ||
    (outcome === "reject_with_reasons" &&
      reasons.includes("reviewer_attested_caption_production_may_proceed"))
  ) fail(context, `${path}.reasonCodes`, "must be canonical closed reasons for the review outcome");
  return {
    outcome,
    reasonCodes: reasons as PublishReviewDecisionRequest["decision"]["reasonCodes"],
    note: boundedNote(item.note, context, `${path}.note`),
  };
}

function validateRevocation(
  value: unknown,
  context: string,
  path: string,
): PublishReviewRevocationRequest["revocation"] {
  const item = object(value, context, path);
  exact(item, ["reasonCodes", "note"], context, path);
  const reasons = uniqueStrings(item.reasonCodes, context, `${path}.reasonCodes`);
  if (
    reasons.length === 0 ||
    reasons.some((reason) => !PUBLISH_REVIEW_REVOCATION_REASON_ORDER.includes(
      reason as (typeof PUBLISH_REVIEW_REVOCATION_REASON_ORDER)[number],
    )) ||
    JSON.stringify(reasons) !== JSON.stringify(
      PUBLISH_REVIEW_REVOCATION_REASON_ORDER.filter((reason) => reasons.includes(reason)),
    )
  ) fail(context, `${path}.reasonCodes`, "must be canonical closed revocation reasons");
  return {
    reasonCodes: reasons as PublishReviewRevocationRequest["revocation"]["reasonCodes"],
    note: boundedNote(item.note, context, `${path}.note`),
  };
}

export function assertPublishReviewDecisionRequest(value: unknown): PublishReviewDecisionRequest {
  const context = "Publish-review decision request";
  const item = object(value, context, "request");
  exact(item, ["intake", "reviewer", "decision"], context, "request");
  const reviewer = object(item.reviewer, context, "request.reviewer");
  exact(reviewer, ["id", "attestation"], context, "request.reviewer");
  return {
    intake: validatePublishReviewIntakeReceiptIdentity(item.intake, context, "request.intake"),
    reviewer: {
      id: stableIdentity(reviewer.id, context, "request.reviewer.id"),
      attestation: literal(
        reviewer.attestation,
        PUBLISH_REVIEW_DECISION_ATTESTATION,
        context,
        "request.reviewer.attestation",
      ),
    },
    decision: validateDecision(item.decision, context, "request.decision"),
  };
}

export function assertPublishReviewRevocationRequest(value: unknown): PublishReviewRevocationRequest {
  const context = "Publish-review revocation request";
  const item = object(value, context, "request");
  exact(item, ["approval", "reviewer", "revocation"], context, "request");
  const reviewer = object(item.reviewer, context, "request.reviewer");
  exact(reviewer, ["id", "attestation"], context, "request.reviewer");
  return {
    approval: validatePublishReviewDecisionReceiptIdentity(item.approval, context, "request.approval"),
    reviewer: {
      id: stableIdentity(reviewer.id, context, "request.reviewer.id"),
      attestation: literal(
        reviewer.attestation,
        PUBLISH_REVIEW_REVOCATION_ATTESTATION,
        context,
        "request.reviewer.attestation",
      ),
    },
    revocation: validateRevocation(item.revocation, context, "request.revocation"),
  };
}

function validateReceiptedReviewer(
  value: unknown,
  context: string,
  path: string,
  statement: typeof PUBLISH_REVIEW_DECISION_ATTESTATION | typeof PUBLISH_REVIEW_REVOCATION_ATTESTATION,
): void {
  const reviewer = object(value, context, path);
  exact(reviewer, ["id", "label", "attestation"], context, path);
  stableIdentity(reviewer.id, context, `${path}.id`);
  boundedLabel(reviewer.label, context, `${path}.label`);
  const attestation = object(reviewer.attestation, context, `${path}.attestation`);
  exact(attestation, ["kind", "statement"], context, `${path}.attestation`);
  literal(attestation.kind, "local_operator_attestation_v1", context, `${path}.attestation.kind`);
  literal(attestation.statement, statement, context, `${path}.attestation.statement`);
}

export function validatePublishReviewDecisionReceipt(
  value: unknown,
  context = "Publish-review decision receipt",
  path = "receipt",
): asserts value is PublishReviewDecisionReceipt {
  const item = object(value, context, path);
  exact(item, ["schema", "receiptId", "reviewId", "input", "reviewer", "producer", "decision"], context, path);
  literal(item.schema, "studio.publish-review-decision.receipt.v1", context, `${path}.schema`);
  stableIdentity(item.receiptId, context, `${path}.receiptId`);
  stableIdentity(item.reviewId, context, `${path}.reviewId`);
  const input = object(item.input, context, `${path}.input`);
  exact(input, ["intake", "verification"], context, `${path}.input`);
  validatePublishReviewIntakeReceiptIdentity(input.intake, context, `${path}.input.intake`);
  const verification = object(input.verification, context, `${path}.input.verification`);
  exact(verification, ["integrity", "producer", "outcome"], context, `${path}.input.verification`);
  literal(verification.integrity, "stored_intake_and_verified_study_readiness", context, `${path}.input.verification.integrity`);
  literal(verification.producer, "host_publish_review_intake_v1", context, `${path}.input.verification.producer`);
  literal(verification.outcome, "queued", context, `${path}.input.verification.outcome`);
  validateReceiptedReviewer(item.reviewer, context, `${path}.reviewer`, PUBLISH_REVIEW_DECISION_ATTESTATION);
  const producer = object(item.producer, context, `${path}.producer`);
  exact(producer, ["id", "version", "policy"], context, `${path}.producer`);
  literal(producer.id, "studio.host-publish-review", context, `${path}.producer.id`);
  literal(producer.version, "1", context, `${path}.producer.version`);
  literal(producer.policy, "attested_review_of_verified_queued_intake", context, `${path}.producer.policy`);
  validateDecision(item.decision, context, `${path}.decision`);
}

export function validatePublishReviewRevocationReceipt(
  value: unknown,
  context = "Publish-review revocation receipt",
  path = "receipt",
): asserts value is PublishReviewRevocationReceipt {
  const item = object(value, context, path);
  exact(item, ["schema", "receiptId", "revocationId", "input", "reviewer", "producer", "revocation", "result"], context, path);
  literal(item.schema, "studio.publish-review-revocation.receipt.v1", context, `${path}.schema`);
  stableIdentity(item.receiptId, context, `${path}.receiptId`);
  stableIdentity(item.revocationId, context, `${path}.revocationId`);
  const input = object(item.input, context, `${path}.input`);
  exact(input, ["approval", "verification"], context, `${path}.input`);
  validatePublishReviewDecisionReceiptIdentity(input.approval, context, `${path}.input.approval`);
  const verification = object(input.verification, context, `${path}.input.verification`);
  exact(verification, ["integrity", "producer", "outcome"], context, `${path}.input.verification`);
  literal(verification.integrity, "stored_review_and_verified_queued_intake", context, `${path}.input.verification.integrity`);
  literal(verification.producer, "host_publish_review_v1", context, `${path}.input.verification.producer`);
  literal(verification.outcome, "approve_for_caption_production", context, `${path}.input.verification.outcome`);
  validateReceiptedReviewer(item.reviewer, context, `${path}.reviewer`, PUBLISH_REVIEW_REVOCATION_ATTESTATION);
  const producer = object(item.producer, context, `${path}.producer`);
  exact(producer, ["id", "version", "policy"], context, `${path}.producer`);
  literal(producer.id, "studio.host-publish-review", context, `${path}.producer.id`);
  literal(producer.version, "1", context, `${path}.producer.version`);
  literal(producer.policy, "immutable_revocation_of_verified_approval", context, `${path}.producer.policy`);
  validateRevocation(item.revocation, context, `${path}.revocation`);
  const result = object(item.result, context, `${path}.result`);
  exact(result, ["state"], context, `${path}.result`);
  literal(result.state, "approval_revoked", context, `${path}.result.state`);
}
