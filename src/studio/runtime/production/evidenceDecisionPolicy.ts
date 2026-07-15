import type { EvidenceAssessmentAudit } from "./assessmentAudit.ts";
import type { EvidenceDecisionOutcome, EvidenceDecisionReasonCode } from "./model.ts";

export interface DerivedEvidenceDecision {
  outcome: EvidenceDecisionOutcome;
  reasonCodes: EvidenceDecisionReasonCode[];
  auditedClaimCount: number;
}

/** Closed deterministic policy over already-audited assessment states. */
export function deriveEvidenceDecision(audits: readonly EvidenceAssessmentAudit[]): DerivedEvidenceDecision {
  if (audits.length === 0 || audits.some((audit) => audit.claims.length === 0)) {
    throw new Error("Evidence decision requires non-empty audited assessment claims");
  }
  const states = new Set(audits.flatMap((audit) => audit.claims.flatMap((claim) => claim.states)));
  const reasonCodes: EvidenceDecisionReasonCode[] = [];
  if (states.has("withheld")) reasonCodes.push("audited_claim_withheld");
  if (states.has("unknown")) reasonCodes.push("audited_claim_unknown");
  if (states.has("truncated")) reasonCodes.push("audited_claim_truncated");
  if (reasonCodes.length === 0) reasonCodes.push("all_audited_claims_supported");
  return {
    outcome: reasonCodes[0] === "all_audited_claims_supported" ? "proceed_to_publish_review" : "withheld",
    reasonCodes,
    auditedClaimCount: audits.reduce((total, audit) => total + audit.claims.length, 0),
  };
}
