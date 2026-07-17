import type { SemanticEvidenceCitationInput } from "./semanticEvidence.ts";
import type {
  StudyCoverageReasonCode,
  StudyCoverageState,
} from "./studyReports.ts";
import type {
  MediaScope,
  SpawnRejection,
  TaskJobContext,
} from "./tasks.ts";

export const OWNED_MEDIA_STUDY_LIMITS = {
  maxArtifactBytes: 512 * 1024,
  maxPlanningReports: 32,
  maxCoverageRanges: 256,
  maxClaims: 256,
  maxChildCitations: 512,
  maxSemanticCitations: 512,
  maxConflicts: 128,
  maxLimitations: 128,
  maxFollowUps: 64,
} as const;

export type StudyPlanningOutcome =
  | "request_follow_up"
  | "synthesize_with_gaps"
  | "withhold";

export interface StudyPlanningReportInput {
  reportId: string;
  childTaskId: string;
  childAgentId: string;
  artifactId: string;
  contentId: string;
  dispositionId: string;
  dispositionReceiptId: string;
  dispositionReceiptContentId: string;
  admissionId: string;
  admissionReceiptId: string;
  admissionReceiptContentId: string;
  readOperationId: string;
  readReceiptId: string;
}

export interface StudyPlanningCoverageIdentity {
  coverageId: string;
  range: MediaScope;
  aggregate: "supported_candidate" | "gap" | "conflict";
  childRanges: Array<{
    reportId: string;
    artifactId: string;
    state: StudyCoverageState;
    claimIds: string[];
    reasonCode: StudyCoverageReasonCode | null;
  }>;
}

export interface StudyPlanningGapIdentity {
  gapId: string;
  coverageId: string;
  range: MediaScope;
  reasonCodes: StudyCoverageReasonCode[];
}

export interface StudyPlanningConflictIdentity {
  conflictId: string;
  coverageId: string;
  range: MediaScope;
  claims: Array<{
    reportId: string;
    artifactId: string;
    claimId: string;
    statement: string;
  }>;
}

export interface StudyPlanningInput {
  schema: "studio.study-planning-input.v1";
  inputId: string;
  runId: string;
  rootTaskId: string;
  rootAgentId: string;
  rootExecutionId: string;
  jobContextId: string;
  reports: StudyPlanningReportInput[];
  coverage: StudyPlanningCoverageIdentity[];
  gaps: StudyPlanningGapIdentity[];
  conflicts: StudyPlanningConflictIdentity[];
}

export interface StudyPlanningDecisionRequest {
  inputId: string;
  coverageIds: string[];
  gapIds: string[];
  conflictIds: string[];
  outcome: StudyPlanningOutcome;
  citedGapIds: string[];
  citedConflictIds: string[];
  reason: string;
}

export interface StudyPlanningDecisionReceipt {
  schema: "studio.study-planning-decision.receipt.v1";
  receiptId: string;
  decisionId: string;
  input: StudyPlanningInput;
  modelExecutor: {
    executionId: string;
    taskId: string;
    agentId: string;
  };
  decision: {
    outcome: StudyPlanningOutcome;
    citedGapIds: string[];
    citedConflictIds: string[];
    reason: string;
  };
  nonClaims: {
    semanticCorrectness: "not_assessed";
    truthArbitration: "not_performed";
    readiness: "not_decided";
  };
}

export interface StudyPlanningDecisionRecord {
  id: string;
  inputId: string;
  rootTaskId: string;
  rootAgentId: string;
  executionId: string;
  artifactId: string;
  receiptId: string;
  receiptContentId: string;
  outcome: StudyPlanningOutcome;
  coverageIds: string[];
  gapIds: string[];
  conflictIds: string[];
  citedGapIds: string[];
  citedConflictIds: string[];
  input: StudyPlanningInput;
  reason: string;
}

export interface StudyFollowUpCause {
  planningDecisionId: string;
  kind: "gap" | "conflict";
  causeId: string;
}

export interface StudyFollowUpRecord {
  id: string;
  planningDecisionId: string;
  cause: { kind: "gap" | "conflict"; id: string };
  spawnRequestId: string;
  accepted: boolean;
  rejection: SpawnRejection | null;
  taskId: string | null;
  agentId: string | null;
}

export interface OwnedMediaStudyChildReportCitation {
  reportId: string;
  artifactId: string;
  contentId: string;
  admissionId: string;
  claimId: string;
}

export interface OwnedMediaStudyClaim {
  claimId: string;
  artifactId: string;
  trackId: string;
  startMs: number;
  endMs: number;
  statement: string;
  childReportCitations: OwnedMediaStudyChildReportCitation[];
  semanticCitations: SemanticEvidenceCitationInput[];
}

export type OwnedMediaStudyCoverageReasonCode =
  | StudyCoverageReasonCode
  | "explicit_study_gap"
  | "unresolved_conflict"
  | "child_failure"
  | "rejected_input";

export interface OwnedMediaStudyCoverageRange {
  coverageId: string;
  artifactId: string;
  trackId: string;
  startMs: number;
  endMs: number;
  state: StudyCoverageState;
  claimIds: string[];
  reason: null | { code: OwnedMediaStudyCoverageReasonCode; detail: string };
}

export interface OwnedMediaStudyConflict {
  conflictId: string;
  coverageId: string;
  status: "unresolved";
  detail: string;
}

export type OwnedMediaStudyLimitationCode =
  | "explicit_gap"
  | "unresolved_conflict"
  | "partial_child_failure"
  | "rejected_child_input"
  | "recognizer_hypothesis_not_truth"
  | "semantic_quality_not_assessed";

export interface OwnedMediaStudyLimitation {
  code: OwnedMediaStudyLimitationCode;
  coverageIds: string[];
  detail: string;
}

export interface OwnedMediaStudyChildDisposition {
  childTaskId: string;
  childAgentId: string;
  reportId: string | null;
  artifactId: string | null;
  outcome: "accepted" | "rejected" | "failed" | "withheld" | "interrupted";
  reason: string;
  dispositionId: string | null;
  admissionId: string | null;
}

export interface OwnedMediaStudyFollowUpHistory {
  followUpId: string;
  planningDecisionId: string;
  cause: { kind: "gap" | "conflict"; id: string };
  spawnRequestId: string;
  accepted: boolean;
  rejection: SpawnRejection | null;
  taskId: string | null;
  agentId: string | null;
  terminal: null | {
    status: "reported" | "completed" | "failed" | "withheld" | "interrupted";
    reportId: string | null;
    reason: string | null;
  };
}

export interface OwnedMediaStudyArtifact {
  schema: "studio.owned-media-study.v1";
  runId: string;
  root: {
    taskId: string;
    agentId: string;
    executionId: string;
    jobContext: TaskJobContext;
  };
  planning: {
    decisionId: string;
    receiptId: string;
    receiptContentId: string;
    outcome: "synthesize_with_gaps";
    inputId: string;
  };
  reports: StudyPlanningReportInput[];
  childDispositions: OwnedMediaStudyChildDisposition[];
  followUpHistory: OwnedMediaStudyFollowUpHistory[];
  coverage: OwnedMediaStudyCoverageRange[];
  claims: OwnedMediaStudyClaim[];
  conflicts: OwnedMediaStudyConflict[];
  limitations: OwnedMediaStudyLimitation[];
  sourceArtifacts: Array<{ artifactId: string; contentId: string }>;
  limits: typeof OWNED_MEDIA_STUDY_LIMITS;
  nonClaims: {
    semanticCorrectness: "not_assessed";
    translationQuality: "not_assessed";
    truthArbitration: "not_performed";
    publication: "not_authorized";
  };
}

/** Model-authored fields only. Immutable lineage and history are host-injected from the ledger. */
export interface OwnedMediaStudySynthesisRequest {
  planningDecisionId: string;
  coverage: OwnedMediaStudyCoverageRange[];
  claims: OwnedMediaStudyClaim[];
  conflicts: OwnedMediaStudyConflict[];
  limitations: OwnedMediaStudyLimitation[];
}

export interface OwnedMediaStudyExecutorReceipt {
  schema: "studio.owned-media-study.executor-receipt.v1";
  receiptId: string;
  synthesisId: string;
  execution: { executionId: string; taskId: string; agentId: string };
  planning: { decisionId: string; receiptId: string; receiptContentId: string };
  output: { artifactId: string; contentId: string; bytes: number; schema: "studio.owned-media-study.v1" };
  producer: {
    id: "studio.model-root-study-synthesis";
    version: "1";
    authorship: "active_root_executor_tool_call";
  };
  outcome: "completed";
}

export interface OwnedMediaStudyRecord {
  id: string;
  planningDecisionId: string;
  rootTaskId: string;
  rootAgentId: string;
  executionId: string;
  artifactId: string;
  contentId: string;
  executorReceiptId: string;
  executorReceiptContentId: string;
  coverageIds: string[];
  conflictIds: string[];
  coverage: OwnedMediaStudyCoverageRange[];
  conflicts: OwnedMediaStudyConflict[];
}

export type StudyReadinessOutcome = "proceed_to_caption_review" | "withheld";

export type StudyReadinessReasonCode =
  | "non_supported_root_coverage"
  | "unresolved_conflict"
  | "hidden_gap"
  | "unsupported_synthesized_claim"
  | "stored_content_integrity_failed";

export interface StudyReadinessReceipt {
  schema: "studio.study-readiness.receipt.v1";
  receiptId: string;
  readinessId: string;
  input: {
    studyId: string;
    artifactId: string;
    contentId: string;
    executorReceiptId: string;
    executorReceiptContentId: string;
    planningDecisionId: string;
    planningReceiptId: string;
    planningReceiptContentId: string;
  };
  reopened: {
    sourceArtifactIds: string[];
    semanticEvidenceArtifactIds: string[];
    reportArtifactIds: string[];
    admissionIds: string[];
    planningDecisionIds: string[];
    executorIds: string[];
  };
  producer: {
    id: "studio.deterministic-study-readiness-audit";
    version: "1";
    policy: "closed_gap_and_integrity_gate_no_quality_score";
  };
  result: {
    outcome: StudyReadinessOutcome;
    reasonCodes: StudyReadinessReasonCode[];
    coverageIds: string[];
    conflictIds: string[];
  };
  nonClaims: {
    semanticCorrectness: "not_assessed";
    translationQuality: "not_assessed";
    truthArbitration: "not_performed";
  };
}

export interface StudyReadinessReceiptIdentity {
  readinessId: string;
  artifactId: string;
  receiptId: string;
  receiptContentId: string;
}

export interface StudyReadinessRecord {
  id: string;
  studyId: string;
  studyArtifactId: string;
  studyContentId: string;
  status: "completed";
  artifactId: string;
  receiptId: string;
  receiptContentId: string;
  outcome: StudyReadinessOutcome;
  reasonCodes: StudyReadinessReasonCode[];
}
