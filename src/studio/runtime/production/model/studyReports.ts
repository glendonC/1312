import type { SemanticEvidenceCitationInput } from "./semanticEvidence.ts";
import type { MediaScope } from "./tasks.ts";

export const STUDY_REPORT_LIMITS = {
  maxArtifactBytes: 256 * 1024,
  maxRanges: 128,
  maxClaims: 128,
  maxCitations: 256,
  maxObservationCitations: 512,
} as const;

export type StudyCoverageState = "supported" | "withheld" | "unknown" | "failed";

export type StudyCoverageReasonCode =
  | "semantic_evidence_unavailable"
  | "semantic_evidence_empty"
  | "insufficient_semantic_evidence"
  | "worker_withheld"
  | "operation_failed"
  | "unobserved_range";

export interface StudyCoverageRange {
  artifactId: string;
  trackId: string;
  startMs: number;
  endMs: number;
  state: StudyCoverageState;
  claimIds: string[];
  reason: null | { code: StudyCoverageReasonCode; detail: string };
}

export interface StudyClaim {
  claimId: string;
  artifactId: string;
  trackId: string;
  startMs: number;
  endMs: number;
  statement: string;
  citations: SemanticEvidenceCitationInput[];
}

export interface StudyReportArtifact {
  schema: "studio.study-report.v1";
  runId: string;
  task: { taskId: string; agentId: string; jobContextId: string };
  parent: { taskId: string; agentId: string };
  outputSlot: { name: string; artifactKind: "studio.study-report.v1" };
  assignment: {
    source: { artifactId: string; contentId: string };
    mediaScope: MediaScope[];
  };
  coverage: StudyCoverageRange[];
  claims: StudyClaim[];
  semanticEvidenceInputs: SemanticEvidenceCitationInput[];
  sourceArtifacts: Array<{ artifactId: string; contentId: string }>;
  limits: typeof STUDY_REPORT_LIMITS;
  nonClaims: {
    correctness: "not_assessed";
    completeness: "partition_only";
    semanticQuality: "not_assessed";
  };
}

export interface StudyReportCounts {
  ranges: Record<StudyCoverageState, number>;
  durationMs: Record<StudyCoverageState, number>;
  claims: number;
  citations: number;
  observationCitations: number;
}

export interface StudyReportSubmissionBinding {
  schema: "studio.study-report-submission.v1";
  jobContextId: string;
  outputSlot: { name: string; artifactKind: "studio.study-report.v1" };
  coverage: StudyCoverageRange[];
  claims: StudyClaim[];
  counts: StudyReportCounts;
  output: {
    artifactId: string;
    contentId: string;
    bytes: number;
    schema: "studio.study-report.v1";
  };
  sourceArtifacts: Array<{ artifactId: string; contentId: string }>;
  executor: {
    executionId: string;
    receiptId: string;
    receiptContentId: string;
  };
  parentEdge: {
    childTaskId: string;
    childAgentId: string;
    parentTaskId: string;
    parentAgentId: string;
  };
}

export interface ParentArtifactReadGrant {
  schema: "studio.parent-artifact-read-grant.v1";
  id: string;
  capability: "artifact.read";
  runId: string;
  reportId: string;
  dispositionId: string;
  parentTaskId: string;
  parentAgentId: string;
  contentScope: Array<{
    artifactId: string;
    contentId: string;
    schema: "studio.study-report.v1";
  }>;
  maxBytes: number;
  maxItems: number;
}

export interface ParentArtifactDispositionRequest {
  reportId: string;
  parentTaskId: string;
  parentAgentId: string;
  outputArtifactId: string;
  outcome: "accepted" | "rejected";
  reason: string;
}

export interface ParentArtifactAdmissionReceipt {
  schema: "studio.parent-admission.receipt.v1";
  receiptId: string;
  admissionId: string;
  dispositionId: string;
  runId: string;
  reportId: string;
  parent: { taskId: string; agentId: string };
  child: { taskId: string; agentId: string; jobContextId: string };
  admitted: Array<{
    artifactId: string;
    contentId: string;
    schema: "studio.study-report.v1";
  }>;
  grant: ParentArtifactReadGrant;
  nonClaims: {
    semanticQuality: "not_assessed";
    parentAgreement: "not_claimed";
  };
}

export interface ParentArtifactDispositionReceipt {
  schema: "studio.parent-artifact-disposition.receipt.v1";
  receiptId: string;
  dispositionId: string;
  runId: string;
  report: {
    reportId: string;
    status: "accepted" | "rejected";
    decisionReason: string;
  };
  parent: { taskId: string; agentId: string };
  child: { taskId: string; agentId: string; jobContextId: string };
  output: {
    artifactId: string;
    contentId: string;
    bytes: number;
    schema: "studio.study-report.v1";
    outputSlot: { name: string; artifactKind: "studio.study-report.v1" };
  };
  executor: {
    executionId: string;
    receiptId: string;
    receiptContentId: string;
  };
  decision: {
    outcome: "accepted" | "rejected";
    reason: string;
  };
  admission: null | {
    admissionId: string;
    receiptId: string;
    receiptContentId: string;
    artifactId: string;
    grant: ParentArtifactReadGrant;
  };
}

export interface ParentArtifactDispositionRecord {
  id: string;
  reportId: string;
  parentTaskId: string;
  parentAgentId: string;
  childTaskId: string;
  childAgentId: string;
  inputArtifactId: string;
  outcome: "accepted" | "rejected";
  receiptId: string;
  receiptContentId: string;
  receiptArtifactId: string;
  admissionId: string | null;
  admissionReceiptId: string | null;
  admissionReceiptContentId: string | null;
  admissionArtifactId: string | null;
  readGrantId: string | null;
}

export interface ParentArtifactReadRequest {
  operationId: string;
  parentTaskId: string;
  parentAgentId: string;
  grantId: string;
  contentIds: string[];
}

export interface ParentArtifactReadReceipt {
  schema: "studio.parent-artifact-read.receipt.v1";
  receiptId: string;
  operationId: string;
  runId: string;
  authorization: {
    grantId: string;
    parentTaskId: string;
    parentAgentId: string;
    dispositionId: string;
  };
  requestedContentIds: string[];
  returned: Array<{
    artifactId: string;
    contentId: string;
    schema: "studio.study-report.v1";
    bytes: number;
  }>;
  consumed: { bytes: number; items: number };
  ceilings: { maxBytes: number; maxItems: number };
}

export interface ParentArtifactReadRecord {
  id: string;
  parentTaskId: string;
  parentAgentId: string;
  grantId: string;
  dispositionId: string;
  requestedContentIds: string[];
  status: "started" | "completed" | "failed";
  returnedArtifactIds: string[];
  returnedContentIds: string[];
  returnedBytes: number | null;
  returnedItems: number | null;
  receiptId: string | null;
  failure: string | null;
}
