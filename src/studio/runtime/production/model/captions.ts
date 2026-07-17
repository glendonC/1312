import type { PublishReviewDecisionReceiptIdentity } from "./review.ts";
import type { SemanticEvidenceCitationInput } from "./semanticEvidence.ts";
import type {
  OwnedMediaStudyCoverageReasonCode,
  StudyPlanningReportInput,
  StudyReadinessReceiptIdentity,
} from "./studies.ts";

export const CAPTION_PRODUCTION_LIMITS = {
  maxDurationMs: 120_000,
  maxLines: 64,
  maxSourceBytes: 32 * 1024,
  maxTargetBytes: 32 * 1024,
  maxArtifactBytes: 128 * 1024,
  maxWallMs: 60_000,
} as const;

export interface CaptionProductionRequest {
  approval: PublishReviewDecisionReceiptIdentity;
}

export type CaptionLineState = "available" | "withheld" | "unavailable";

export type CaptionLineReasonCode =
  | "recorded_quality_gate_withheld"
  | "recognizer_unavailable"
  | "recognizer_empty"
  | "translator_unavailable"
  | "translator_missing_line"
  | "source_unavailable"
  | "study_coverage_withheld"
  | "study_coverage_unknown"
  | "study_coverage_failed"
  | "study_coverage_conflict"
  | "study_coverage_uncovered"
  | "study_citation_mismatch"
  | "not_in_requested_dialogue_scope";

export interface CaptionStudyIdentity {
  studyId: string;
  artifactId: string;
  contentId: string;
  executorReceiptId: string;
  executorReceiptContentId: string;
}

export interface CaptionLineStudySupport {
  coverage: {
    coverageId: string | null;
    state: "supported" | "withheld" | "unknown" | "failed" | "uncovered" | "conflict";
    reasonCode: OwnedMediaStudyCoverageReasonCode | "uncovered" | "citation_mismatch" | null;
  };
  claimIds: string[];
  semanticCitations: SemanticEvidenceCitationInput[];
  childReports: StudyPlanningReportInput[];
}

export interface CaptionProductionLine {
  id: string;
  startMs: number;
  endMs: number;
  lineage: {
    derivation: "recorded_fixture_test_demo_only" | "current_run_source_execution";
    source: {
      artifactId: string;
      contentId: string;
      window: { startMs: number; endMs: number };
    };
    study: CaptionStudyIdentity & CaptionLineStudySupport;
    readiness: StudyReadinessReceiptIdentity;
    approval: PublishReviewDecisionReceiptIdentity;
    captionExecutor: {
      jobId: string;
      id: CaptionExecutorDescriptor["id"];
      version: "1";
      executionScope: CaptionExecutorDescriptor["executionScope"];
      cognitionClaim: "none";
    };
  };
  source: {
    language: "ko";
    state: CaptionLineState;
    text: string | null;
    reasonCode: CaptionLineReasonCode | null;
  };
  target: {
    language: "en";
    state: CaptionLineState;
    text: string | null;
    reasonCode: CaptionLineReasonCode | null;
  };
}

export type CaptionProductionStatus = "completed" | "partial" | "withheld" | "unavailable";

export type CaptionExecutorClassification =
  | "recorded_real_pipeline_fixture"
  | "deterministic_current_run_test_seam"
  | "real_recognizer_translator";

export interface CaptionExecutorDescriptor {
  id:
    | "studio.recorded-caption-fixture-adapter"
    | "studio.deterministic-current-run-caption-test-seam"
    | "studio.openai-caption-producer";
  version: "1";
  classification: CaptionExecutorClassification;
  executionScope: "test_demo_only" | "current_run";
  cognitionClaim: "none";
  recognizer: string | null;
  translator: string | null;
  sourceCaptionContentId: string | null;
}

export interface CaptionProductionArtifact {
  schema: "studio.caption-production.artifact.v1" | "studio.caption-production.artifact.v2";
  jobId: string;
  runId: string;
  input: {
    sourceArtifactId: string;
    sourceContentId: string;
    analysisRequestId: string;
    range: { startMs: number; endMs: number };
    sourceLanguage: "ko";
    targetLanguage: "en";
    study: CaptionStudyIdentity;
    readiness: StudyReadinessReceiptIdentity;
  };
  executor: CaptionExecutorDescriptor;
  lines: CaptionProductionLine[];
  result: {
    status: CaptionProductionStatus;
    lineCount: number;
    sourceAvailableCount: number;
    targetAvailableCount: number;
    withheldCount: number;
    unavailableCount: number;
  };
}

export interface CaptionProductionReceipt {
  schema: "studio.caption-production.receipt.v1" | "studio.caption-production.receipt.v2";
  receiptId: string;
  jobId: string;
  authority: {
    approval: PublishReviewDecisionReceiptIdentity;
    verification: {
      integrity: "stored_review_and_verified_queued_intake";
      producer: "host_publish_review_v1";
      outcome: "approve_for_caption_production";
      readiness: StudyReadinessReceiptIdentity;
      study: CaptionStudyIdentity;
      unrevokedAtStart: true;
    };
  };
  input: CaptionProductionArtifact["input"];
  producer: {
    id: "studio.host-caption-production";
    version: "1" | "2";
    policy: "verified_unrevoked_approval_only" | "verified_unrevoked_approval_and_dialogue_scope_only";
    executor: CaptionExecutorDescriptor;
  };
  limits: typeof CAPTION_PRODUCTION_LIMITS;
  result: CaptionProductionArtifact["result"] & {
    captionArtifactId: string;
    captionContentId: string;
    captionBytes: number;
    lines: Array<{
      lineId: string;
      startMs: number;
      endMs: number;
      sourceState: CaptionLineState;
      targetState: CaptionLineState;
      reasonCode: CaptionLineReasonCode | null;
      coverageId: string | null;
      coverageState: CaptionLineStudySupport["coverage"]["state"];
      claimIds: string[];
      semanticEvidenceArtifactIds: string[];
      reportArtifactIds: string[];
    }>;
  };
}

export type CaptionQualityControlOutcome = "accepted" | "withheld";

export type CaptionQualityControlReasonCode =
  | "current_run_candidate_structurally_complete"
  | "recorded_fixture_test_demo_only"
  | "candidate_has_unavailable_or_withheld_lines"
  | "candidate_has_no_lines";

export interface CaptionQualityControlRequest {
  candidate: {
    jobId: string;
    captionArtifactId: string;
    captionContentId: string;
    captionReceiptId: string;
    captionReceiptContentId: string;
  };
}

export interface CaptionQualityControlReceipt {
  schema: "studio.caption-quality-control.receipt.v1";
  receiptId: string;
  qcId: string;
  input: {
    jobId: string;
    captionArtifactId: string;
    captionContentId: string;
    captionReceiptId: string;
    captionReceiptContentId: string;
  };
  lineage: {
    candidateInput: CaptionProductionArtifact["input"];
    executor: CaptionExecutorDescriptor;
    study: CaptionStudyIdentity;
    readiness: StudyReadinessReceiptIdentity;
    approval: PublishReviewDecisionReceiptIdentity;
  };
  producer: {
    id: "studio.host-caption-quality-control";
    version: "1";
    independence: "separate_from_caption_executor";
    policy: "structural_current_run_gate_without_semantic_quality_score";
  };
  decision: {
    outcome: CaptionQualityControlOutcome;
    reasonCodes: CaptionQualityControlReasonCode[];
    lines: Array<{
      lineId: string;
      outcome: CaptionQualityControlOutcome;
      reasonCode: CaptionQualityControlReasonCode;
    }>;
  };
}


export interface CaptionProductionRecord {
  id: string;
  approvalReviewId: string;
  approvalArtifactId: string;
  approvalReceiptId: string;
  approvalReceiptContentId: string;
  sourceArtifactId: string;
  sourceContentId: string;
  analysisRequestId: string;
  range: { startMs: number; endMs: number };
  study: CaptionStudyIdentity;
  readiness: StudyReadinessReceiptIdentity;
  limits: typeof CAPTION_PRODUCTION_LIMITS;
  executor: CaptionExecutorDescriptor;
  status: "started" | "completed" | "failed";
  captionArtifactId: string | null;
  captionContentId: string | null;
  receiptArtifactId: string | null;
  receiptId: string | null;
  receiptContentId: string | null;
  resultStatus: CaptionProductionStatus | null;
  lineCount: number | null;
  sourceAvailableCount: number | null;
  targetAvailableCount: number | null;
  withheldCount: number | null;
  unavailableCount: number | null;
  lines: CaptionProductionReceipt["result"]["lines"];
  failure: string | null;
}

export interface CaptionQualityControlRecord {
  id: string;
  jobId: string;
  captionArtifactId: string;
  captionContentId: string;
  captionReceiptId: string;
  captionReceiptContentId: string;
  outputArtifactId: string;
  receiptId: string;
  receiptContentId: string;
  outcome: CaptionQualityControlOutcome;
  reasonCodes: CaptionQualityControlReasonCode[];
  lines: CaptionQualityControlReceipt["decision"]["lines"];
}
