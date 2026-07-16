import type {
  RuntimeHostPublishReviewDecisionResponse,
  RuntimeHostPublishReviewIntakeResponse,
} from "../../runtime/production/runtimeHost/model.ts";
import {
  contentId,
  exact,
  fail,
  identity,
  integer,
  object,
  string,
} from "./responseGuards.ts";

export function publishReviewIntakeResponse(
  value: unknown,
  expectedRuntimeId: string,
): RuntimeHostPublishReviewIntakeResponse {
  const context = "Runtime host publish-review intakes";
  const item = object(value, context);
  exact(item, ["schema", "commandId", "runtimeId", "journalHead", "intakes"], context);
  if (item.schema !== "studio.local-runtime-publish-review-intakes.v1") fail(context, "schema is unsupported.");
  const runtimeId = identity(item.runtimeId, `${context}.runtimeId`);
  if (runtimeId !== expectedRuntimeId) fail(context, "runtime identity changed.");
  if (!Array.isArray(item.intakes)) fail(`${context}.intakes`, "must be an array.");
  const intakeIds = new Set<string>();
  const decisionOperationIds = new Set<string>();
  const intakes = item.intakes.map((candidate, intakeIndex) => {
    const intakeContext = `${context}.intakes[${intakeIndex}]`;
    const intake = object(candidate, intakeContext);
    exact(intake, [
      "intakeId",
      "artifactId",
      "receiptId",
      "receiptContentId",
      "integrity",
      "producer",
      "decision",
      "outcome",
      "reasonCodes",
    ], intakeContext);
    const intakeId = identity(intake.intakeId, `${intakeContext}.intakeId`);
    if (intakeIds.has(intakeId)) fail(`${intakeContext}.intakeId`, "is duplicated.");
    intakeIds.add(intakeId);
    if (intake.integrity !== "stored_intake_and_verified_decision_receipt") {
      fail(`${intakeContext}.integrity`, "does not carry the closed intake verification result.");
    }
    if (intake.producer !== "host_publish_review_intake_v1") {
      fail(`${intakeContext}.producer`, "is unsupported.");
    }
    const decision = object(intake.decision, `${intakeContext}.decision`);
    exact(decision, ["operationId", "artifactId", "receiptId", "receiptContentId"], `${intakeContext}.decision`);
    const decisionOperationId = identity(decision.operationId, `${intakeContext}.decision.operationId`);
    if (decisionOperationIds.has(decisionOperationId)) {
      fail(`${intakeContext}.decision.operationId`, "already has an intake.");
    }
    decisionOperationIds.add(decisionOperationId);
    const outcome = intake.outcome;
    if (outcome !== "queued" && outcome !== "rejected") fail(`${intakeContext}.outcome`, "is unsupported.");
    if (!Array.isArray(intake.reasonCodes) || intake.reasonCodes.length === 0) {
      fail(`${intakeContext}.reasonCodes`, "must contain closed decision reason codes.");
    }
    const reasonOrder = [
      "audited_claim_withheld",
      "audited_claim_unknown",
      "audited_claim_truncated",
      "all_audited_claims_supported",
    ] as const;
    const reasonCodes = intake.reasonCodes.map((reason, reasonIndex) => {
      if (!reasonOrder.includes(reason as (typeof reasonOrder)[number])) {
        fail(`${intakeContext}.reasonCodes[${reasonIndex}]`, "is unsupported.");
      }
      return reason as (typeof reasonOrder)[number];
    });
    if (
      new Set(reasonCodes).size !== reasonCodes.length ||
      JSON.stringify(reasonCodes) !== JSON.stringify(reasonOrder.filter((reason) => reasonCodes.includes(reason))) ||
      (outcome === "queued" && (reasonCodes.length !== 1 || reasonCodes[0] !== "all_audited_claims_supported")) ||
      (outcome === "rejected" && reasonCodes.includes("all_audited_claims_supported"))
    ) fail(`${intakeContext}.reasonCodes`, "do not agree with the closed intake outcome.");
    return {
      intakeId,
      artifactId: identity(intake.artifactId, `${intakeContext}.artifactId`),
      receiptId: identity(intake.receiptId, `${intakeContext}.receiptId`),
      receiptContentId: contentId(intake.receiptContentId, `${intakeContext}.receiptContentId`),
      integrity: "stored_intake_and_verified_decision_receipt" as const,
      producer: "host_publish_review_intake_v1" as const,
      decision: {
        operationId: decisionOperationId,
        artifactId: identity(decision.artifactId, `${intakeContext}.decision.artifactId`),
        receiptId: identity(decision.receiptId, `${intakeContext}.decision.receiptId`),
        receiptContentId: contentId(decision.receiptContentId, `${intakeContext}.decision.receiptContentId`),
      },
      outcome: outcome as "queued" | "rejected",
      reasonCodes,
    };
  });
  return {
    schema: "studio.local-runtime-publish-review-intakes.v1",
    commandId: identity(item.commandId, `${context}.commandId`),
    runtimeId,
    journalHead: integer(item.journalHead, `${context}.journalHead`),
    intakes,
  };
}

const REVIEW_DECISION_ATTESTATION =
  "I attest that I am the named reviewer and made this review decision." as const;
const REVIEW_REVOCATION_ATTESTATION =
  "I attest that I am the named reviewer and made this revocation decision." as const;
const REVIEW_REASON_ORDER = [
  "reviewer_attested_caption_production_may_proceed",
  "evidence_requires_additional_review",
  "source_scope_not_approved",
  "rights_or_policy_concern",
  "other_review_concern",
] as const;
const REVOCATION_REASON_ORDER = [
  "approval_entered_in_error",
  "new_review_required",
  "source_scope_changed",
  "rights_or_policy_concern",
] as const;

function reviewNote(value: unknown, context: string): string | null {
  if (value === null) return null;
  const note = string(value, context);
  if (note.length > 280 || note.trim() !== note || /[\r\n\u0000-\u001f\u007f]/.test(note)) {
    fail(context, "must be a trimmed single-line note of at most 280 characters.");
  }
  return note;
}

export function publishReviewDecisionResponse(
  value: unknown,
  expectedRuntimeId: string,
): RuntimeHostPublishReviewDecisionResponse {
  const context = "Runtime host publish-review decisions";
  const item = object(value, context);
  exact(item, ["schema", "commandId", "runtimeId", "journalHead", "reviewer", "reviews"], context);
  if (item.schema !== "studio.local-runtime-publish-review-decisions.v1") fail(context, "schema is unsupported.");
  const runtimeId = identity(item.runtimeId, `${context}.runtimeId`);
  if (runtimeId !== expectedRuntimeId) fail(context, "runtime identity changed.");
  const reviewerValue = object(item.reviewer, `${context}.reviewer`);
  exact(reviewerValue, ["id", "label", "decisionAttestation", "revocationAttestation"], `${context}.reviewer`);
  if (reviewerValue.decisionAttestation !== REVIEW_DECISION_ATTESTATION) {
    fail(`${context}.reviewer.decisionAttestation`, "is unsupported.");
  }
  if (reviewerValue.revocationAttestation !== REVIEW_REVOCATION_ATTESTATION) {
    fail(`${context}.reviewer.revocationAttestation`, "is unsupported.");
  }
  const reviewer = {
    id: identity(reviewerValue.id, `${context}.reviewer.id`),
    label: string(reviewerValue.label, `${context}.reviewer.label`),
    decisionAttestation: REVIEW_DECISION_ATTESTATION,
    revocationAttestation: REVIEW_REVOCATION_ATTESTATION,
  };
  if (reviewer.label.length > 80 || reviewer.label.trim() !== reviewer.label || /[\r\n\u0000-\u001f\u007f]/.test(reviewer.label)) {
    fail(`${context}.reviewer.label`, "must be a bounded single-line host label.");
  }
  if (!Array.isArray(item.reviews)) fail(`${context}.reviews`, "must be an array.");
  const reviewIds = new Set<string>();
  const intakeIds = new Set<string>();
  const reviews = item.reviews.map((candidate, reviewIndex) => {
    const reviewContext = `${context}.reviews[${reviewIndex}]`;
    const review = object(candidate, reviewContext);
    exact(review, [
      "reviewId",
      "artifactId",
      "receiptId",
      "receiptContentId",
      "integrity",
      "producer",
      "intake",
      "reviewer",
      "outcome",
      "reasonCodes",
      "note",
      "state",
      "revocation",
    ], reviewContext);
    const reviewId = identity(review.reviewId, `${reviewContext}.reviewId`);
    if (reviewIds.has(reviewId)) fail(`${reviewContext}.reviewId`, "is duplicated.");
    reviewIds.add(reviewId);
    if (review.integrity !== "stored_review_and_verified_queued_intake") {
      fail(`${reviewContext}.integrity`, "does not carry closed review verification.");
    }
    if (review.producer !== "host_publish_review_v1") fail(`${reviewContext}.producer`, "is unsupported.");
    const intakeValue = object(review.intake, `${reviewContext}.intake`);
    exact(intakeValue, ["intakeId", "artifactId", "receiptId", "receiptContentId"], `${reviewContext}.intake`);
    const intakeId = identity(intakeValue.intakeId, `${reviewContext}.intake.intakeId`);
    if (intakeIds.has(intakeId)) fail(`${reviewContext}.intake.intakeId`, "already has a review.");
    intakeIds.add(intakeId);
    const reviewReviewer = object(review.reviewer, `${reviewContext}.reviewer`);
    exact(reviewReviewer, ["id", "label", "attestation"], `${reviewContext}.reviewer`);
    if (
      identity(reviewReviewer.id, `${reviewContext}.reviewer.id`) !== reviewer.id ||
      string(reviewReviewer.label, `${reviewContext}.reviewer.label`) !== reviewer.label ||
      reviewReviewer.attestation !== reviewer.decisionAttestation
    ) fail(`${reviewContext}.reviewer`, "does not match the host review authority and attestation.");
    const outcome = review.outcome;
    if (outcome !== "approve_for_caption_production" && outcome !== "reject_with_reasons") {
      fail(`${reviewContext}.outcome`, "is unsupported.");
    }
    if (!Array.isArray(review.reasonCodes) || review.reasonCodes.length === 0) {
      fail(`${reviewContext}.reasonCodes`, "must contain closed review reasons.");
    }
    const reasonCodes = review.reasonCodes.map((reason, reasonIndex) => {
      if (!REVIEW_REASON_ORDER.includes(reason as (typeof REVIEW_REASON_ORDER)[number])) {
        fail(`${reviewContext}.reasonCodes[${reasonIndex}]`, "is unsupported.");
      }
      return reason as (typeof REVIEW_REASON_ORDER)[number];
    });
    if (
      new Set(reasonCodes).size !== reasonCodes.length ||
      JSON.stringify(reasonCodes) !== JSON.stringify(REVIEW_REASON_ORDER.filter((reason) => reasonCodes.includes(reason))) ||
      (outcome === "approve_for_caption_production" &&
        (reasonCodes.length !== 1 || reasonCodes[0] !== "reviewer_attested_caption_production_may_proceed")) ||
      (outcome === "reject_with_reasons" && reasonCodes.includes("reviewer_attested_caption_production_may_proceed"))
    ) fail(`${reviewContext}.reasonCodes`, "do not agree with the closed review outcome.");

    let revocation = null;
    if (review.revocation !== null) {
      const revocationContext = `${reviewContext}.revocation`;
      const candidateRevocation = object(review.revocation, revocationContext);
      exact(candidateRevocation, [
        "revocationId",
        "artifactId",
        "receiptId",
        "receiptContentId",
        "integrity",
        "producer",
        "reviewer",
        "reasonCodes",
        "note",
      ], revocationContext);
      if (candidateRevocation.integrity !== "stored_revocation_and_verified_approval") {
        fail(`${revocationContext}.integrity`, "does not carry closed revocation verification.");
      }
      if (candidateRevocation.producer !== "host_publish_review_v1") {
        fail(`${revocationContext}.producer`, "is unsupported.");
      }
      const revocationReviewer = object(candidateRevocation.reviewer, `${revocationContext}.reviewer`);
      exact(revocationReviewer, ["id", "label", "attestation"], `${revocationContext}.reviewer`);
      if (
        identity(revocationReviewer.id, `${revocationContext}.reviewer.id`) !== reviewer.id ||
        string(revocationReviewer.label, `${revocationContext}.reviewer.label`) !== reviewer.label ||
        revocationReviewer.attestation !== reviewer.revocationAttestation
      ) fail(`${revocationContext}.reviewer`, "does not match the host review authority and attestation.");
      if (!Array.isArray(candidateRevocation.reasonCodes) || candidateRevocation.reasonCodes.length === 0) {
        fail(`${revocationContext}.reasonCodes`, "must contain closed revocation reasons.");
      }
      const revocationReasons = candidateRevocation.reasonCodes.map((reason, reasonIndex) => {
        if (!REVOCATION_REASON_ORDER.includes(reason as (typeof REVOCATION_REASON_ORDER)[number])) {
          fail(`${revocationContext}.reasonCodes[${reasonIndex}]`, "is unsupported.");
        }
        return reason as (typeof REVOCATION_REASON_ORDER)[number];
      });
      if (
        new Set(revocationReasons).size !== revocationReasons.length ||
        JSON.stringify(revocationReasons) !== JSON.stringify(
          REVOCATION_REASON_ORDER.filter((reason) => revocationReasons.includes(reason)),
        )
      ) fail(`${revocationContext}.reasonCodes`, "are not canonical.");
      revocation = {
        revocationId: identity(candidateRevocation.revocationId, `${revocationContext}.revocationId`),
        artifactId: identity(candidateRevocation.artifactId, `${revocationContext}.artifactId`),
        receiptId: identity(candidateRevocation.receiptId, `${revocationContext}.receiptId`),
        receiptContentId: contentId(candidateRevocation.receiptContentId, `${revocationContext}.receiptContentId`),
        integrity: "stored_revocation_and_verified_approval" as const,
        producer: "host_publish_review_v1" as const,
        reviewer: {
          id: reviewer.id,
          label: reviewer.label,
          attestation: reviewer.revocationAttestation,
        },
        reasonCodes: revocationReasons,
        note: reviewNote(candidateRevocation.note, `${revocationContext}.note`),
      };
    }
    const expectedState = outcome === "reject_with_reasons"
      ? "rejected"
      : revocation
        ? "approval_revoked"
        : "approved_for_caption_production";
    if (review.state !== expectedState || (revocation !== null && outcome !== "approve_for_caption_production")) {
      fail(`${reviewContext}.state`, "does not match the decision and immutable revocation state.");
    }
    return {
      reviewId,
      artifactId: identity(review.artifactId, `${reviewContext}.artifactId`),
      receiptId: identity(review.receiptId, `${reviewContext}.receiptId`),
      receiptContentId: contentId(review.receiptContentId, `${reviewContext}.receiptContentId`),
      integrity: "stored_review_and_verified_queued_intake" as const,
      producer: "host_publish_review_v1" as const,
      intake: {
        intakeId,
        artifactId: identity(intakeValue.artifactId, `${reviewContext}.intake.artifactId`),
        receiptId: identity(intakeValue.receiptId, `${reviewContext}.intake.receiptId`),
        receiptContentId: contentId(intakeValue.receiptContentId, `${reviewContext}.intake.receiptContentId`),
      },
      reviewer: {
        id: reviewer.id,
        label: reviewer.label,
        attestation: reviewer.decisionAttestation,
      },
      outcome: outcome as "approve_for_caption_production" | "reject_with_reasons",
      reasonCodes,
      note: reviewNote(review.note, `${reviewContext}.note`),
      state: expectedState as "rejected" | "approval_revoked" | "approved_for_caption_production",
      revocation,
    };
  });
  return {
    schema: "studio.local-runtime-publish-review-decisions.v1",
    commandId: identity(item.commandId, `${context}.commandId`),
    runtimeId,
    journalHead: integer(item.journalHead, `${context}.journalHead`),
    reviewer,
    reviews,
  };
}
