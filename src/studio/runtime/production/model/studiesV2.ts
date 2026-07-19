import type { EvidenceCitationEnvelope, EvidenceCitationState, QualifiedMediaRange } from "./evidenceCitations.ts";
import type {
  AdmittedStudyReportV2,
  GeneralizedCoverageReasonCode,
  GeneralizedCoverageState,
} from "./studyReportsV2.ts";

export const OWNED_MEDIA_STUDY_V2_LIMITS = {
  maxArtifactBytes: 1024 * 1024,
  maxReports: 32,
  maxCoverageRanges: 256,
  maxClaims: 256,
  maxCitations: 512,
  maxPreservedStatesPerRange: 8,
} as const;

export interface OwnedMediaStudyCoverageRangeV2 extends QualifiedMediaRange {
  coverageId: string;
  state: GeneralizedCoverageState;
  preservedStates: GeneralizedCoverageState[];
  rawStates: string[];
  claimIds: string[];
  citationIds: string[];
  reason: null | { code: GeneralizedCoverageReasonCode; detail: string };
}

export interface OwnedMediaStudyClaimV2 extends QualifiedMediaRange {
  claimId: string;
  statement: string;
  childClaims: Array<{
    admissionId: string;
    reportArtifactId: string;
    reportContentId: string;
    claimId: string;
  }>;
  citationIds: string[];
}

/** Additive U3 synthesis. Every evidence citation must be copied from an admitted v2 report. */
export interface OwnedMediaStudyArtifactV2 {
  schema: "studio.owned-media-study.v2";
  runId: string;
  root: {
    taskId: string;
    agentId: string;
    executionId: string;
    jobContextId: string;
    source: { artifactId: string; contentId: string };
    mediaScope: QualifiedMediaRange[];
  };
  reports: AdmittedStudyReportV2[];
  coverage: OwnedMediaStudyCoverageRangeV2[];
  claims: OwnedMediaStudyClaimV2[];
  evidenceCitations: EvidenceCitationEnvelope[];
  sourceArtifacts: Array<{ artifactId: string; contentId: string }>;
  limits: typeof OWNED_MEDIA_STUDY_V2_LIMITS;
  nonClaims: {
    semanticCorrectness: "not_assessed";
    translationQuality: "not_assessed";
    truthArbitration: "not_performed";
    modalityReliabilityEquivalence: "not_claimed";
    independentCorroboration: "not_assessed";
    publication: "not_authorized";
  };
}

export interface OwnedMediaStudyExecutorReceiptV2 {
  schema: "studio.owned-media-study.executor-receipt.v2";
  receiptId: string;
  runId: string;
  input: {
    reportArtifactIds: string[];
    admissionIds: string[];
  };
  output: OwnedMediaStudyV2Identity;
  producer: {
    id: "studio.generalized-study-synthesis";
    version: "2";
    policy: "preserve_all_admitted_states_and_copy_only_audited_citations";
  };
  nonClaims: {
    semanticCorrectness: "not_assessed";
    truthArbitration: "not_performed";
  };
}

export interface OwnedMediaStudyV2Identity {
  studyId: string;
  artifactId: string;
  contentId: string;
  bytes: number;
  schema: "studio.owned-media-study.v2";
}

export interface StudyReadinessReceiptV3 {
  schema: "studio.study-readiness.receipt.v3";
  receiptId: string;
  readinessId: string;
  runId: string;
  input: OwnedMediaStudyV2Identity;
  reopened: {
    reportArtifactIds: string[];
    admissionIds: string[];
    evidenceArtifactIds: string[];
    evidenceReceiptContentIds: string[];
  };
  producer: {
    id: "studio.deterministic-study-readiness-audit";
    version: "3";
    policy: "generalized_state_integrity_and_coverage_gate_no_quality_score";
  };
  result: {
    outcome: "proceed_to_caption_review" | "withheld";
    reasonCodes: Array<"non_supported_root_coverage" | "unresolved_conflict" | "hidden_gap" | "stored_content_integrity_failed">;
    states: Array<GeneralizedCoverageState | EvidenceCitationState>;
    coverageIds: string[];
  };
  nonClaims: {
    semanticCorrectness: "not_assessed";
    translationQuality: "not_assessed";
    truthArbitration: "not_performed";
  };
}

export interface CaptionLineCausalityV3 {
  schema: "studio.caption-line-causality.v3";
  range: QualifiedMediaRange;
  source: { language: "ko"; state: "available" | "withheld" | "unavailable"; text: string | null; reasonCode: string | null };
  target: { language: "en"; state: "available" | "withheld" | "unavailable"; text: string | null; reasonCode: string | null };
  lineage: {
    study: OwnedMediaStudyV2Identity;
    readiness: { readinessId: string; receiptId: string; receiptContentId: string };
    coverageId: string | null;
    coverageState: GeneralizedCoverageState | "uncovered";
    preservedStates: GeneralizedCoverageState[];
    claimIds: string[];
    citationIds: string[];
  };
}

export interface OwnedMediaStudyRecordV2 {
  schema: "studio.owned-media-study.v2";
  id: string;
  rootTaskId: string;
  rootAgentId: string;
  executionId: string;
  artifactId: string;
  contentId: string;
  bytes: number;
  executorReceiptId: string;
  executorReceiptContentId: string;
  reports: AdmittedStudyReportV2[];
  coverage: OwnedMediaStudyCoverageRangeV2[];
  claims: OwnedMediaStudyClaimV2[];
  evidenceCitations: EvidenceCitationEnvelope[];
}

export interface StudyReadinessRecordV3 {
  schema: "studio.study-readiness.receipt.v3";
  id: string;
  studyId: string;
  studyArtifactId: string;
  studyContentId: string;
  status: "completed";
  artifactId: string;
  receiptId: string;
  receiptContentId: string;
  outcome: "proceed_to_caption_review" | "withheld";
  reasonCodes: StudyReadinessReceiptV3["result"]["reasonCodes"];
  states: StudyReadinessReceiptV3["result"]["states"];
  study: {
    study: OwnedMediaStudyV2Identity;
    executorReceiptId: string;
    executorReceiptContentId: string;
  };
}
