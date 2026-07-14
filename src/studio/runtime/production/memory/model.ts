export const MEMORY_REVIEW_SCHEMAS = {
  proposal: "studio.memory.proposal.v1",
  decision: "studio.memory.decision.v1",
  legacy: "studio.memory.legacy-snapshot.v1",
  materialization: "studio.memory.materialization.v1",
  consumption: "studio.memory.consumption.v1",
} as const;

export type MemoryKind = "glossary" | "correction" | "rule";
export type MemoryDecisionAction = "accept" | "reject" | "revoke";
export type MemoryProposalStatus = "pending" | "accepted" | "rejected" | "revoked" | "superseded";

export interface MemoryFileReceipt {
  path: string;
  content_id: string;
  bytes: number;
}

export interface MemoryProposal {
  proposal_id: string;
  schema: typeof MEMORY_REVIEW_SCHEMAS.proposal;
  namespace: string;
  kind: MemoryKind;
  key: string;
  value: unknown;
  proposed_by: string;
  created_at: string;
  source: unknown | null;
  evidence: MemoryFileReceipt[];
  supersedes: string | null;
  review_requirements: { benchmark: { pack_id: string } } | null;
}

export interface MemoryBenchmarkReceipt {
  pack_id: string;
  rule_content_id: string;
  with_rule: MemoryFileReceipt & { generated_at: string };
  without_rule: MemoryFileReceipt & { generated_at: string };
  delta: {
    critical_meaning_rate: number;
    catastrophic_count: number;
  };
}

export interface MemoryDecision {
  decision_id: string;
  schema: typeof MEMORY_REVIEW_SCHEMAS.decision;
  proposal_id: string;
  proposal_content_id: string;
  action: MemoryDecisionAction;
  decided_by: string;
  reason: string;
  created_at: string;
  benchmark_receipt: MemoryBenchmarkReceipt | null;
}

export interface MemoryLegacySnapshot {
  schema: typeof MEMORY_REVIEW_SCHEMAS.legacy;
  snapshot_id: string;
  namespace: string;
  status: "legacy_unreviewed";
  created_at: string;
  source: MemoryFileReceipt;
  entry_count: number | null;
  note: string;
}

export interface MemoryMaterializationEntry {
  namespace: string;
  kind: MemoryKind;
  key: string;
  value: unknown;
  proposal_id: string;
  proposal_content_id: string;
  decision_id: string;
  evidence: MemoryFileReceipt[];
}

export interface MemoryMaterialization {
  materialization_id: string;
  schema: typeof MEMORY_REVIEW_SCHEMAS.materialization;
  created_at: string;
  entries: MemoryMaterializationEntry[];
  proposal_receipts: Array<{
    id: string;
    content_id: string;
    status: "pending" | "accepted" | "rejected" | "revoked";
    superseded_by: string | null;
  }>;
  decision_receipts: Array<{ id: string; content_id: string }>;
  legacy_inputs: Array<{
    snapshot_id: string;
    namespace: string;
    status: "legacy_unreviewed";
    source: MemoryFileReceipt;
  }>;
}

export interface MemoryConsumptionReceipt {
  consumption_id: string;
  schema: typeof MEMORY_REVIEW_SCHEMAS.consumption;
  run_id: string;
  consumed_at: string;
  snapshot: {
    materialization_id: string;
    snapshot_content_id: string;
    materialization_receipt_content_id: string;
    entry_count: number;
  };
  policy: {
    promotion: "reviewed_materialization_only";
    legacy_unreviewed: "excluded";
    unavailable: "fail_closed";
  };
}

export type MemoryReviewArtifact =
  | MemoryProposal
  | MemoryDecision
  | MemoryLegacySnapshot
  | MemoryMaterialization
  | MemoryConsumptionReceipt;

export interface MemoryProposalInspection {
  proposalId: string;
  proposalContentId: string;
  namespace: string;
  kind: MemoryKind;
  key: string;
  value: unknown;
  proposedBy: string;
  createdAt: string;
  source: unknown | null;
  evidence: MemoryFileReceipt[];
  status: MemoryProposalStatus;
  supersedes: string | null;
  supersededBy: string | null;
  primaryDecision: MemoryDecision | null;
  revocation: MemoryDecision | null;
}

export interface MemoryReviewTransition {
  type: "supersession" | "revocation";
  proposalId: string;
  decisionId: string;
  createdAt: string;
  priorProposalId: string | null;
  restoredProposalId: string | null;
}

export interface MemoryMaterializationInspection {
  materializationId: string;
  snapshotContentId: string;
  receiptContentId: string;
  createdAt: string;
  entries: MemoryMaterializationEntry[];
  proposalReceiptIds: string[];
  decisionReceiptIds: string[];
  legacyInputs: MemoryMaterialization["legacy_inputs"];
}

export interface MemoryConsumptionInspection {
  consumptionId: string;
  receiptContentId: string;
  runId: string;
  consumedAt: string;
  snapshot: MemoryConsumptionReceipt["snapshot"];
}

export interface MemoryReviewInspection {
  schema: "studio.memory.review-inspection.v1";
  scope: "operator_selected_receipts";
  completeness: "not_repository_discovery";
  proposals: MemoryProposalInspection[];
  decisions: MemoryDecision[];
  transitions: MemoryReviewTransition[];
  materializations: MemoryMaterializationInspection[];
  consumptions: MemoryConsumptionInspection[];
  legacyInputs: MemoryLegacySnapshot[];
  counts: {
    proposals: number;
    decisions: number;
    revocations: number;
    materializations: number;
    consumptions: number;
    legacyUnreviewed: number;
  };
}

export interface ConsumeMemoryRequest {
  runId: string;
  materializationId: string;
  consumedAt: string;
}

export interface ConsumedMemorySnapshot {
  receipt: MemoryConsumptionReceipt;
  entries: MemoryMaterializationEntry[];
}
