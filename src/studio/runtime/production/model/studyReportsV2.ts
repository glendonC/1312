import type { EvidenceCitationEnvelope, EvidenceCitationState, QualifiedMediaRange } from "./evidenceCitations.ts";

export const STUDY_REPORT_V2_LIMITS = {
  maxArtifactBytes: 512 * 1024,
  maxRanges: 128,
  maxClaims: 128,
  maxCitations: 256,
  maxObservationCitations: 512,
} as const;

export type GeneralizedCoverageState = "supported" | Exclude<EvidenceCitationState, "available">;

export type GeneralizedCoverageReasonCode =
  | "evidence_unknown"
  | "worker_withheld"
  | "evidence_unavailable"
  | "evidence_truncated"
  | "evidence_conflicting"
  | "operation_failed"
  | "not_in_requested_scope";

export interface GeneralizedCoverageRange extends QualifiedMediaRange {
  state: GeneralizedCoverageState;
  claimIds: string[];
  citationIds: string[];
  rawStates: string[];
  reason: null | { code: GeneralizedCoverageReasonCode; detail: string };
}

export interface GeneralizedStudyClaim extends QualifiedMediaRange {
  claimId: string;
  statement: string;
  citationIds: string[];
}

/** Additive U3 report. V1 remains the closed current-run-speech contract. */
export interface StudyReportArtifactV2 {
  schema: "studio.study-report.v2";
  runId: string;
  task: { taskId: string; agentId: string; executionId: string; jobContextId: string };
  parent: { taskId: string; agentId: string };
  assignment: {
    source: { artifactId: string; contentId: string };
    mediaScope: QualifiedMediaRange[];
  };
  coverage: GeneralizedCoverageRange[];
  claims: GeneralizedStudyClaim[];
  evidenceCitations: EvidenceCitationEnvelope[];
  sourceArtifacts: Array<{ artifactId: string; contentId: string }>;
  limits: typeof STUDY_REPORT_V2_LIMITS;
  nonClaims: {
    correctness: "not_assessed";
    completeness: "partition_only";
    semanticQuality: "not_assessed";
    modalityReliabilityEquivalence: "not_claimed";
    independentCorroboration: "not_assessed";
  };
}

export interface StudyReportV2Identity {
  artifactId: string;
  contentId: string;
  bytes: number;
  schema: "studio.study-report.v2";
}

export interface StudyReportSubmissionBindingV2 {
  schema: "studio.study-report-submission.v2";
  jobContextId: string;
  outputSlot: { name: string; artifactKind: "studio.study-report.v2" };
  assignment: StudyReportArtifactV2["assignment"];
  coverage: GeneralizedCoverageRange[];
  claims: GeneralizedStudyClaim[];
  evidenceCitations: EvidenceCitationEnvelope[];
  output: StudyReportV2Identity;
  sourceArtifacts: Array<{ artifactId: string; contentId: string }>;
  executor: { executionId: string; receiptId: string; receiptContentId: string };
  parentEdge: { childTaskId: string; childAgentId: string; parentTaskId: string; parentAgentId: string };
}

export interface GeneralizedParentAdmissionRecord {
  contractVersion: 2;
  admissionId: string;
  reportId: string;
  parentTaskId: string;
  parentAgentId: string;
  childTaskId: string;
  childAgentId: string;
  inputArtifactId: string;
  receiptId: string;
  receiptContentId: string;
  receiptArtifactId: string;
  report: StudyReportV2Identity;
}

export interface GeneralizedParentArtifactReadRecord {
  contractVersion: 2;
  id: string;
  parentTaskId: string;
  parentAgentId: string;
  admissionId: string;
  reportArtifactId: string;
  reportContentId: string;
  status: "completed";
  receiptId: string;
  receiptContentId: string;
  receiptArtifactId: string;
}

export interface ParentArtifactAdmissionReceiptV2 {
  schema: "studio.parent-admission.receipt.v2";
  receiptId: string;
  admissionId: string;
  runId: string;
  report: StudyReportV2Identity;
  task: { taskId: string; agentId: string; executionId: string; jobContextId: string };
  parent: { taskId: string; agentId: string };
  auditedCitations: Array<{
    citationId: string;
    evidenceKind: EvidenceCitationEnvelope["evidenceKind"];
    use: EvidenceCitationEnvelope["use"];
    upstreamState: EvidenceCitationEnvelope["upstreamState"];
  }>;
  coverage: Array<{
    range: QualifiedMediaRange;
    state: GeneralizedCoverageState;
    rawStates: string[];
  }>;
  producer: {
    id: "studio.generalized-evidence-admission";
    version: "2";
    policy: "audit_each_kind_and_preserve_exact_states";
  };
  nonClaims: {
    semanticQuality: "not_assessed";
    parentAgreement: "not_claimed";
    truthArbitration: "not_performed";
  };
}

export interface ParentArtifactReadReceiptV2 {
  schema: "studio.parent-artifact-read.receipt.v2";
  receiptId: string;
  operationId: string;
  runId: string;
  admission: { admissionId: string; receiptId: string; receiptContentId: string };
  returned: StudyReportV2Identity;
  producer: {
    id: "studio.generalized-evidence-read";
    version: "2";
    policy: "content_addressed_admitted_report_only";
  };
}

export interface AdmittedStudyReportV2 {
  report: StudyReportV2Identity;
  admission: {
    admissionId: string;
    receiptId: string;
    receiptContentId: string;
  };
}
