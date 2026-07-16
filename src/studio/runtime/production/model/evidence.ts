import type { EvidenceKind } from "./tasks.ts";

export interface SpeechWindowEvidenceFact {
  kind: "speech_window" | "non_speech_window";
  index: number;
  startSample: number;
  endSample: number;
  startMs: number;
  endMs: number;
}

export interface LanguageRangeEvidenceFact {
  kind: "language_range";
  speechWindowIndex: number;
  chunkIndex: number;
  startSample: number;
  endSample: number;
  startMs: number;
  endMs: number;
  decision: {
    status: "classified" | "unknown" | "withheld";
    code: string | null;
    probability: number | null;
    margin: number | null;
    reason: string | null;
  };
}

export type EvidenceFact = SpeechWindowEvidenceFact | LanguageRangeEvidenceFact;

export interface EvidenceReadRequest {
  operationId: string;
  taskId: string;
  agentId: string;
  artifactId: string;
}

export interface EvidenceReadReceipt {
  schema: "studio.evidence-read.receipt.v2";
  receiptId: string;
  operationId: string;
  capability: "evidence.read";
  authorization: {
    grantId: string;
    taskId: string;
    agentId: string;
    sourceArtifactId: string;
    startMs: number;
    endMs: number;
    maxBytes: number;
    maxItems: number;
  };
  input: {
    artifactId: string;
    contentId: string;
    bytes: number;
    evidenceKind: EvidenceKind;
    receiptSchema: "studio.speech-activity.v1" | "studio.language-ranges.v1";
  };
  producer: {
    id: "studio.bounded-evidence-read";
    version: "2";
    rangePolicy: "intersect_and_clip_to_authorized_window";
  };
  facts: EvidenceFact[];
  result: {
    availableItems: number;
    returnedItems: number;
    returnedFactBytes: number;
    truncated: boolean;
  };
  lineage: {
    preflightId: string;
    preflightContentId: string;
    sourceArtifactIds: string[];
  };
}

export interface EvidenceReadReceiptIdentity {
  receiptId: string;
  receiptContentId: string;
}

export interface EvidenceAssessmentCitation extends EvidenceReadReceiptIdentity {
  /** Zero-based indexes into the cited evidence-read receipt's returned `facts` array. */
  factIndexes: number[];
}

export type EvidenceAssessmentClaim =
  | {
      kind: "speech_activity";
      value: "speech" | "non_speech";
      range: { startMs: number; endMs: number };
      citations: EvidenceAssessmentCitation[];
    }
  | {
      kind: "language_identity";
      value: string | null;
      range: { startMs: number; endMs: number };
      citations: EvidenceAssessmentCitation[];
    };

export interface EvidenceAssessmentRequest {
  operationId: string;
  taskId: string;
  agentId: string;
  readReceipts: EvidenceReadReceiptIdentity[];
  claims: EvidenceAssessmentClaim[];
}

export type EvidenceAssessmentState = "supported" | "unknown" | "withheld" | "truncated";

export type ReceiptedEvidenceAssessmentClaim = EvidenceAssessmentClaim & {
  claimIndex: number;
  /** `supported` appears only when no cited upstream state is unknown, withheld, or truncated. */
  states: EvidenceAssessmentState[];
};

export interface EvidenceAssessmentReceipt {
  schema: "studio.evidence-assessment.receipt.v1";
  receiptId: string;
  operationId: string;
  capability: "analysis.evidence.assess";
  authorization: {
    grantId: string;
    taskId: string;
    agentId: string;
    maxAssessments: number;
    maxReadReceipts: number;
    maxClaims: number;
    maxCitations: number;
    maxTokens: number;
  };
  inputs: Array<{
    readOperationId: string;
    receiptId: string;
    receiptContentId: string;
    evidenceArtifactId: string;
    evidenceKind: EvidenceKind;
    returnedItems: number;
    truncated: boolean;
  }>;
  producer: { id: "studio.bounded-evidence-assessment"; version: "1" };
  claims: ReceiptedEvidenceAssessmentClaim[];
  result: {
    readReceiptCount: number;
    claimCount: number;
    /** Total cited fact indexes, not merely receipt-level citation groups. */
    citationCount: number;
    tokenCount: number;
  };
}

export interface AuditedEvidenceAssessmentIdentity {
  operationId: string;
  artifactId: string;
  receiptId: string;
  receiptContentId: string;
}

export interface EvidenceDecisionRequest {
  operationId: string;
  taskId: string;
  agentId: string;
  auditedAssessments: AuditedEvidenceAssessmentIdentity[];
}

export type EvidenceDecisionOutcome = "withheld" | "proceed_to_publish_review";

export type EvidenceDecisionReasonCode =
  | "all_audited_claims_supported"
  | "audited_claim_withheld"
  | "audited_claim_unknown"
  | "audited_claim_truncated";

export interface EvidenceDecisionReceipt {
  schema: "studio.evidence-decision.receipt.v1";
  receiptId: string;
  operationId: string;
  capability: "analysis.evidence.decide";
  authorization: {
    grantId: string;
    taskId: string;
    agentId: string;
    maxDecisions: number;
    maxAuditedAssessments: number;
  };
  inputs: AuditedEvidenceAssessmentIdentity[];
  producer: {
    id: "studio.deterministic-audited-assessment-decision";
    version: "1";
    policy: "withhold_on_preserved_gap_state";
  };
  decision: {
    outcome: EvidenceDecisionOutcome;
    reasonCodes: EvidenceDecisionReasonCode[];
  };
  result: {
    auditedAssessmentCount: number;
    auditedClaimCount: number;
  };
}

/** The only caller-supplied input accepted by the publish-review intake producer. */
export interface EvidenceDecisionReceiptIdentity {
  operationId: string;
  artifactId: string;
  receiptId: string;
  receiptContentId: string;
}


export interface EvidenceReadRecord {
  id: string;
  taskId: string;
  agentId: string;
  grantId: string;
  artifactId: string;
  evidenceKind: EvidenceKind;
  sourceArtifactId: string;
  startMs: number;
  endMs: number;
  maxBytes: number;
  maxItems: number;
  status: "started" | "completed" | "failed";
  receiptId: string | null;
  receiptContentId: string | null;
  returnedItems: number | null;
  returnedFactBytes: number | null;
  truncated: boolean | null;
  failure: string | null;
}

export interface EvidenceAssessmentRecord {
  id: string;
  taskId: string;
  agentId: string;
  grantId: string;
  readReceiptIds: string[];
  readReceiptContentIds: string[];
  maxReadReceipts: number;
  maxClaims: number;
  maxCitations: number;
  maxTokens: number;
  status: "started" | "completed" | "failed";
  artifactId: string | null;
  receiptId: string | null;
  receiptContentId: string | null;
  claimCount: number | null;
  citationCount: number | null;
  tokenCount: number | null;
  failure: string | null;
}

export interface EvidenceDecisionRecord {
  id: string;
  taskId: string;
  agentId: string;
  grantId: string;
  assessmentOperationIds: string[];
  assessmentArtifactIds: string[];
  assessmentReceiptIds: string[];
  assessmentReceiptContentIds: string[];
  maxAuditedAssessments: number;
  status: "started" | "completed" | "failed";
  artifactId: string | null;
  receiptId: string | null;
  receiptContentId: string | null;
  outcome: EvidenceDecisionOutcome | null;
  reasonCodes: EvidenceDecisionReasonCode[];
  auditedClaimCount: number | null;
  failure: string | null;
}
