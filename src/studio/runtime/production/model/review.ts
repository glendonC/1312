import type {
  StudyReadinessReasonCode,
  StudyReadinessReceiptIdentity,
} from "./studies.ts";

export type PublishReviewIntakeOutcome = "queued" | "rejected";

export interface PublishReviewIntakeReceipt {
  schema: "studio.publish-review-intake.receipt.v1";
  receiptId: string;
  intakeId: string;
  input: {
    readiness: StudyReadinessReceiptIdentity;
    verification: {
      integrity: "stored_study_readiness_and_recursive_inputs_verified";
      producer: "deterministic_study_readiness_gate_v1" | "deterministic_study_readiness_gate_v3";
    };
  };
  producer: {
    id: "studio.host-publish-review-intake";
    version: "1";
    policy: "queue_exact_verified_study_readiness_only";
  };
  result: {
    outcome: PublishReviewIntakeOutcome;
    reasonCodes: StudyReadinessReasonCode[];
  };
}

export interface PublishReviewIntakeReceiptIdentity {
  intakeId: string;
  artifactId: string;
  receiptId: string;
  receiptContentId: string;
}

export interface PublishReviewOperator {
  id: string;
  label: string;
}

export type PublishReviewDecisionOutcome =
  | "approve_for_caption_production"
  | "reject_with_reasons";

export type PublishReviewDecisionReasonCode =
  | "reviewer_attested_caption_production_may_proceed"
  | "evidence_requires_additional_review"
  | "source_scope_not_approved"
  | "rights_or_policy_concern"
  | "other_review_concern";

export type PublishReviewRevocationReasonCode =
  | "approval_entered_in_error"
  | "new_review_required"
  | "source_scope_changed"
  | "rights_or_policy_concern";

export type PublishReviewDecisionAttestation =
  "I attest that I am the named reviewer and made this review decision.";

export type PublishReviewRevocationAttestation =
  "I attest that I am the named reviewer and made this revocation decision.";

/** The browser may name only the host-configured reviewer id; the host supplies its label. */
export interface PublishReviewDecisionRequest {
  intake: PublishReviewIntakeReceiptIdentity;
  reviewer: {
    id: string;
    attestation: PublishReviewDecisionAttestation;
  };
  decision: {
    outcome: PublishReviewDecisionOutcome;
    reasonCodes: PublishReviewDecisionReasonCode[];
    note: string | null;
  };
}

export interface PublishReviewDecisionReceipt {
  schema: "studio.publish-review-decision.receipt.v1";
  receiptId: string;
  reviewId: string;
  input: {
    intake: PublishReviewIntakeReceiptIdentity;
    verification: {
      integrity: "stored_intake_and_verified_study_readiness";
      producer: "host_publish_review_intake_v1";
      outcome: "queued";
    };
  };
  reviewer: PublishReviewOperator & {
    attestation: {
      kind: "local_operator_attestation_v1";
      statement: PublishReviewDecisionAttestation;
    };
  };
  producer: {
    id: "studio.host-publish-review";
    version: "1";
    policy: "attested_review_of_verified_queued_intake";
  };
  decision: {
    outcome: PublishReviewDecisionOutcome;
    reasonCodes: PublishReviewDecisionReasonCode[];
    note: string | null;
  };
}

export interface PublishReviewDecisionReceiptIdentity {
  reviewId: string;
  artifactId: string;
  receiptId: string;
  receiptContentId: string;
}

export interface PublishReviewRevocationRequest {
  approval: PublishReviewDecisionReceiptIdentity;
  reviewer: {
    id: string;
    attestation: PublishReviewRevocationAttestation;
  };
  revocation: {
    reasonCodes: PublishReviewRevocationReasonCode[];
    note: string | null;
  };
}

export interface PublishReviewRevocationReceipt {
  schema: "studio.publish-review-revocation.receipt.v1";
  receiptId: string;
  revocationId: string;
  input: {
    approval: PublishReviewDecisionReceiptIdentity;
    verification: {
      integrity: "stored_review_and_verified_queued_intake";
      producer: "host_publish_review_v1";
      outcome: "approve_for_caption_production";
    };
  };
  reviewer: PublishReviewOperator & {
    attestation: {
      kind: "local_operator_attestation_v1";
      statement: PublishReviewRevocationAttestation;
    };
  };
  producer: {
    id: "studio.host-publish-review";
    version: "1";
    policy: "immutable_revocation_of_verified_approval";
  };
  revocation: {
    reasonCodes: PublishReviewRevocationReasonCode[];
    note: string | null;
  };
  result: {
    state: "approval_revoked";
  };
}


export interface PublishReviewIntakeRecord {
  id: string;
  readinessId: string;
  readinessArtifactId: string;
  readinessReceiptId: string;
  readinessReceiptContentId: string;
  status: "started" | "completed" | "failed";
  artifactId: string | null;
  receiptId: string | null;
  receiptContentId: string | null;
  outcome: PublishReviewIntakeOutcome | null;
  reasonCodes: StudyReadinessReasonCode[];
  failure: string | null;
}

export interface PublishReviewDecisionRecord {
  id: string;
  intakeId: string;
  intakeArtifactId: string;
  intakeReceiptId: string;
  intakeReceiptContentId: string;
  reviewerId: string;
  reviewerLabel: string;
  status: "started" | "completed" | "failed";
  artifactId: string | null;
  receiptId: string | null;
  receiptContentId: string | null;
  outcome: PublishReviewDecisionOutcome | null;
  reasonCodes: PublishReviewDecisionReasonCode[];
  note: string | null;
  failure: string | null;
}

export interface PublishReviewRevocationRecord {
  id: string;
  reviewId: string;
  approvalArtifactId: string;
  approvalReceiptId: string;
  approvalReceiptContentId: string;
  reviewerId: string;
  reviewerLabel: string;
  status: "started" | "completed" | "failed";
  artifactId: string | null;
  receiptId: string | null;
  receiptContentId: string | null;
  reasonCodes: PublishReviewRevocationReasonCode[];
  note: string | null;
  failure: string | null;
}
