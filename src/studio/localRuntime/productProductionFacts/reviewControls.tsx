import { useState } from "react";

import type { PublishReviewIntakeVerification } from "../../runtime/production/publishReviewIntakeAudit";
import type { PublishReviewDecisionVerification } from "../../runtime/production/publishReviewDecisionAudit";
import type {
  RuntimeHostPublishReviewDecisionRequest,
  RuntimeHostPublishReviewOperator,
  RuntimeHostPublishReviewRevocationRequest,
} from "../../runtime/production/runtimeHost/model";

const REVIEW_REJECTION_REASONS = [
  "evidence_requires_additional_review",
  "source_scope_not_approved",
  "rights_or_policy_concern",
  "other_review_concern",
] as const;

const REVIEW_REVOCATION_REASONS = [
  "approval_entered_in_error",
  "new_review_required",
  "source_scope_changed",
  "rights_or_policy_concern",
] as const;

export function PublishReviewDecisionControl({
  intake,
  reviewer,
  busy,
  onDecision,
}: {
  intake: PublishReviewIntakeVerification;
  reviewer: RuntimeHostPublishReviewOperator;
  busy: boolean;
  onDecision: (request: RuntimeHostPublishReviewDecisionRequest) => Promise<void>;
}) {
  const [reason, setReason] = useState<(typeof REVIEW_REJECTION_REASONS)[number] | "">("");
  const [note, setNote] = useState("");
  const [attested, setAttested] = useState(false);
  const identity = {
    intakeId: intake.intakeId,
    artifactId: intake.artifactId,
    receiptId: intake.receiptId,
    receiptContentId: intake.receiptContentId,
  };
  const normalizedNote = note.trim() || null;

  return (
    <article
      data-production-review-control-intake-id={intake.intakeId}
      data-review-status="unreviewed"
    >
      <header><h5>Verified queued intake</h5><span>unreviewed</span></header>
      <dl>
        <div><dt>Intake</dt><dd>{intake.intakeId}</dd></div>
        <div><dt>Attested review operator</dt><dd>{reviewer.label} · {reviewer.id}</dd></div>
      </dl>
      <label>
        <span>Rejection reason code</span>
        <select
          value={reason}
          disabled={busy}
          data-production-review-rejection-reason
          onChange={(event) => setReason(event.currentTarget.value as typeof reason)}
        >
          <option value="">Select a required reason</option>
          {REVIEW_REJECTION_REASONS.map((code) => <option key={code} value={code}>{code}</option>)}
        </select>
      </label>
      <label>
        <span>Optional review note</span>
        <input
          type="text"
          value={note}
          maxLength={280}
          disabled={busy}
          data-production-review-note
          onChange={(event) => setNote(event.currentTarget.value)}
        />
      </label>
      <label>
        <input
          type="checkbox"
          checked={attested}
          disabled={busy}
          data-production-review-attestation
          onChange={(event) => setAttested(event.currentTarget.checked)}
        />
        <span>{reviewer.decisionAttestation}</span>
      </label>
      <div>
        <button
          type="button"
          disabled={busy || !attested}
          data-production-review-action="approve_for_caption_production"
          onClick={() => void onDecision({
            intake: identity,
            reviewer: { id: reviewer.id, attestation: reviewer.decisionAttestation },
            decision: {
              outcome: "approve_for_caption_production",
              reasonCodes: ["reviewer_attested_caption_production_may_proceed"],
              note: normalizedNote,
            },
          })}
        >
          Approve for caption production
        </button>
        <button
          type="button"
          disabled={busy || !attested || reason === ""}
          data-production-review-action="reject_with_reasons"
          onClick={() => {
            if (reason === "") return;
            void onDecision({
              intake: identity,
              reviewer: { id: reviewer.id, attestation: reviewer.decisionAttestation },
              decision: { outcome: "reject_with_reasons", reasonCodes: [reason], note: normalizedNote },
            });
          }}
        >
          Reject with reasons
        </button>
      </div>
      <p>
        Approval permits only the separate bounded caption producer to consume this receipt after
        another host verification. Approval itself creates no
        captions, upload, publication, media-truth, or English-correctness claim.
      </p>
    </article>
  );
}

export function PublishReviewRevocationControl({
  review,
  reviewer,
  busy,
  onRevoke,
}: {
  review: PublishReviewDecisionVerification;
  reviewer: RuntimeHostPublishReviewOperator;
  busy: boolean;
  onRevoke: (request: RuntimeHostPublishReviewRevocationRequest) => Promise<void>;
}) {
  const [reason, setReason] = useState<(typeof REVIEW_REVOCATION_REASONS)[number] | "">("");
  const [note, setNote] = useState("");
  const [attested, setAttested] = useState(false);
  return (
    <div data-production-review-revocation-control={review.reviewId}>
      <label>
        <span>Revocation reason code</span>
        <select
          value={reason}
          disabled={busy}
          data-production-review-revocation-reason
          onChange={(event) => setReason(event.currentTarget.value as typeof reason)}
        >
          <option value="">Select a required reason</option>
          {REVIEW_REVOCATION_REASONS.map((code) => <option key={code} value={code}>{code}</option>)}
        </select>
      </label>
      <label>
        <span>Optional revocation note</span>
        <input
          type="text"
          value={note}
          maxLength={280}
          disabled={busy}
          data-production-review-revocation-note
          onChange={(event) => setNote(event.currentTarget.value)}
        />
      </label>
      <label>
        <input
          type="checkbox"
          checked={attested}
          disabled={busy}
          data-production-review-revocation-attestation
          onChange={(event) => setAttested(event.currentTarget.checked)}
        />
        <span>{reviewer.revocationAttestation}</span>
      </label>
      <button
        type="button"
        disabled={busy || !attested || reason === ""}
        data-production-review-action="revoke_approval"
        onClick={() => {
          if (reason === "") return;
          void onRevoke({
            approval: {
              reviewId: review.reviewId,
              artifactId: review.artifactId,
              receiptId: review.receiptId,
              receiptContentId: review.receiptContentId,
            },
            reviewer: { id: reviewer.id, attestation: reviewer.revocationAttestation },
            revocation: { reasonCodes: [reason], note: note.trim() || null },
          });
        }}
      >
        Revoke caption-production approval
      </button>
      <p>
        Revocation blocks every new caption start. Already completed immutable caption artifacts
        remain inspectable and are marked as produced before revocation; they are not silently deleted.
      </p>
    </div>
  );
}
