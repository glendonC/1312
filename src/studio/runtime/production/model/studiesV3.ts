import type { EvidenceCitationEnvelope, EvidenceCitationState, QualifiedMediaRange } from "./evidenceCitations.ts";
import type { ModelUsageReceipt } from "./execution.ts";
import type { AdmittedStudyReportV2, GeneralizedCoverageState } from "./studyReportsV2.ts";
import type { OwnedMediaStudyClaimV2, OwnedMediaStudyCoverageRangeV2 } from "./studiesV2.ts";
import type { RuntimeBudget, SpawnRejection } from "./tasks.ts";

export const RANGE_PASS_LIMITS = {
  maxAcceptedPassesPerRange: 1,
  maxAcceptedPassesPerProducer: 4,
  maxWallMsPerPass: 20_000,
  maxToolCallsPerPass: 1,
  maxPriorReports: 32,
  maxPriorCitations: 512,
} as const;

export type StudyRestudyCauseKind =
  | "unobserved_range"
  | "unknown_evidence"
  | "withheld_evidence"
  | "unavailable_evidence"
  | "truncated_evidence"
  | "speaker_overlap"
  | "recognizer_disagreement"
  | "failed_range";

export interface StudyRestudyCause {
  causeId: string;
  kind: StudyRestudyCauseKind;
  coverageId: string;
  /** Exact causal range; for speaker_overlap this may be narrower than the baseline weak cell. */
  range: QualifiedMediaRange;
  priorState: Exclude<GeneralizedCoverageState, "supported" | "not_in_scope">;
  reportArtifactIds: string[];
  citationIds: string[];
  observationIds: string[];
  rawStates: string[];
}

export interface StudyRestudyCandidate {
  coverageId: string;
  /** Baseline synthesized weak cell retained for pass caps and v3 projection. */
  range: QualifiedMediaRange;
  state: Exclude<GeneralizedCoverageState, "supported" | "not_in_scope">;
  priorEvidence: {
    reportArtifactIds: string[];
    admissionIds: string[];
    citationIds: string[];
    speechOperationIds: string[];
    speechExecutionRanges: QualifiedMediaRange[];
  };
  cause: StudyRestudyCause;
}

export interface StudyRestudyInput {
  schema: "studio.study-restudy-input.v1";
  inputId: string;
  runId: string;
  rootTaskId: string;
  rootAgentId: string;
  rootExecutionId: string;
  candidates: StudyRestudyCandidate[];
}

export type StudyRestudyDelta =
  | { kind: "attenuated_subrange"; executionRange: QualifiedMediaRange }
  | { kind: "padded_audio_window"; executionRange: QualifiedMediaRange; paddingBeforeMs: number; paddingAfterMs: number }
  | { kind: "denser_frame_timestamps"; executionRange: QualifiedMediaRange; timestampsMs: number[] }
  | { kind: "alternate_receipted_config"; executionRange: QualifiedMediaRange; configurationContentId: string }
  | { kind: "granted_specialist"; executionRange: QualifiedMediaRange; specialistKind: "acoustic" | "visual" | "speaker" | "context" };

export interface StudyRestudyRequest {
  inputId: string;
  coverageId: string;
  causeId: string;
  delta: StudyRestudyDelta;
}

export interface RangePassRequestReceipt {
  schema: "studio.study-range-pass-request.receipt.v1";
  receiptId: string;
  passId: string;
  runId: string;
  root: { taskId: string; agentId: string; executionId: string };
  inputId: string;
  coverageId: string;
  weakRange: QualifiedMediaRange;
  priorState: StudyRestudyCandidate["state"];
  priorEvidence: StudyRestudyCandidate["priorEvidence"];
  cause: StudyRestudyCause;
  delta: Extract<StudyRestudyDelta, { kind: "attenuated_subrange" }>;
  passNumber: number;
  producer: {
    kind: "current_run_speech";
    capability: "speech.transcribe";
    configurationScope: "runtime_injected_current_run_recognizer";
  };
  workFingerprint: string;
  reservedSpend: RuntimeBudget;
  limits: typeof RANGE_PASS_LIMITS;
  nonClaims: {
    understanding: "not_claimed";
    improvement: "not_claimed";
    semanticCorrectness: "not_assessed";
  };
}

export type RangePassTerminalOutcome =
  | "supported_new_citations"
  | "unknown_exhausted"
  | "withheld_exhausted"
  | "unavailable_exhausted";

export interface RangePassMeasuredSpend {
  executorActiveMs: number | null;
  capabilityCalls: number;
  modelUsage:
    | { state: "available"; receiptId: string; measured: ModelUsageReceipt["measured"] }
    | { state: "unavailable"; reason: "deterministic_executor" | "executor_failed_before_usage" };
}

export interface RangePassTerminalReceipt {
  schema: "studio.study-range-pass-terminal.receipt.v1";
  receiptId: string;
  passId: string;
  runId: string;
  requestReceiptId: string;
  requestReceiptContentId: string;
  scheduler: {
    spawnRequestId: string;
    taskId: string;
    agentId: string;
  };
  evidence: {
    reportId: string | null;
    reportArtifactId: string | null;
    reportContentId: string | null;
    admissionId: string | null;
    readOperationId: string | null;
    citationIds: string[];
    newCitationIds: string[];
    disagreementCitationIds: string[];
  };
  measuredSpend: RangePassMeasuredSpend;
  outcome: RangePassTerminalOutcome;
  exhausted: boolean;
  nonClaims: {
    understanding: "not_claimed";
    improvement: "not_claimed";
    semanticCorrectness: "not_assessed";
  };
}

export interface RangePassRecord {
  id: string;
  requestReceiptId: string;
  requestReceiptContentId: string;
  request: RangePassRequestReceipt;
  spawnRequestId: string;
  accepted: boolean;
  rejection: SpawnRejection | null;
  taskId: string | null;
  agentId: string | null;
  terminalReceiptId: string | null;
  terminalReceiptContentId: string | null;
  terminal: RangePassTerminalReceipt | null;
}

export const OWNED_MEDIA_STUDY_V3_LIMITS = {
  maxArtifactBytes: 1024 * 1024,
  maxReports: 32,
  maxPasses: 32,
  maxCoverageRanges: 256,
  maxClaims: 256,
  maxCitations: 512,
  maxPreservedStatesPerRange: 8,
} as const;

export interface OwnedMediaStudyCoverageRangeV3 extends OwnedMediaStudyCoverageRangeV2 {
  passIds: string[];
}

export interface OwnedMediaStudyArtifactV3 {
  schema: "studio.owned-media-study.v3";
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
  passes: RangePassRecord[];
  coverage: OwnedMediaStudyCoverageRangeV3[];
  claims: OwnedMediaStudyClaimV2[];
  evidenceCitations: EvidenceCitationEnvelope[];
  sourceArtifacts: Array<{ artifactId: string; contentId: string }>;
  limits: typeof OWNED_MEDIA_STUDY_V3_LIMITS;
  nonClaims: {
    semanticCorrectness: "not_assessed";
    translationQuality: "not_assessed";
    truthArbitration: "not_performed";
    modalityReliabilityEquivalence: "not_claimed";
    independentCorroboration: "not_assessed";
    passCountImpliesUnderstanding: "not_claimed";
    publication: "not_authorized";
  };
}

export interface OwnedMediaStudyV3Identity {
  studyId: string;
  artifactId: string;
  contentId: string;
  bytes: number;
  schema: "studio.owned-media-study.v3";
}

export interface OwnedMediaStudyExecutorReceiptV3 {
  schema: "studio.owned-media-study.executor-receipt.v3";
  receiptId: string;
  runId: string;
  input: { reportArtifactIds: string[]; admissionIds: string[]; passIds: string[] };
  output: OwnedMediaStudyV3Identity;
  producer: {
    id: "studio.restudied-study-synthesis";
    version: "3";
    policy: "retain_all_passes_and_only_upgrade_with_new_range_closing_speech_citations";
  };
  nonClaims: { semanticCorrectness: "not_assessed"; truthArbitration: "not_performed" };
}

export interface OwnedMediaStudyRecordV3 {
  schema: "studio.owned-media-study.v3";
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
  passes: RangePassRecord[];
  coverage: OwnedMediaStudyCoverageRangeV3[];
  claims: OwnedMediaStudyClaimV2[];
  evidenceCitations: EvidenceCitationEnvelope[];
}

export interface StudyReadinessReceiptV4 {
  schema: "studio.study-readiness.receipt.v4";
  receiptId: string;
  readinessId: string;
  runId: string;
  input: OwnedMediaStudyV3Identity;
  reopened: {
    reportArtifactIds: string[];
    admissionIds: string[];
    evidenceArtifactIds: string[];
    evidenceReceiptContentIds: string[];
    passIds: string[];
    passRequestReceiptContentIds: string[];
    passTerminalReceiptContentIds: string[];
  };
  producer: {
    id: "studio.deterministic-restudied-study-readiness-audit";
    version: "4";
    policy: "terminal_weak_ranges_do_not_block_unrelated_supported_ranges_no_quality_score";
  };
  result: {
    outcome: "proceed_to_caption_review" | "withheld";
    reasonCodes: Array<"unresolved_conflict" | "hidden_gap" | "stored_content_integrity_failed">;
    states: Array<GeneralizedCoverageState | EvidenceCitationState>;
    coverageIds: string[];
    terminalWeakCoverageIds: string[];
  };
  nonClaims: {
    semanticCorrectness: "not_assessed";
    translationQuality: "not_assessed";
    truthArbitration: "not_performed";
    terminalWeaknessImpliesGlobalFailure: "not_claimed";
  };
}

export interface StudyReadinessRecordV4 {
  schema: "studio.study-readiness.receipt.v4";
  id: string;
  studyId: string;
  studyArtifactId: string;
  studyContentId: string;
  status: "completed";
  artifactId: string;
  receiptId: string;
  receiptContentId: string;
  outcome: "proceed_to_caption_review" | "withheld";
  reasonCodes: StudyReadinessReceiptV4["result"]["reasonCodes"];
  states: StudyReadinessReceiptV4["result"]["states"];
  terminalWeakCoverageIds: string[];
  study: {
    study: OwnedMediaStudyV3Identity;
    executorReceiptId: string;
    executorReceiptContentId: string;
  };
}

export interface CaptionLineCausalityV4 {
  schema: "studio.caption-line-causality.v4";
  range: QualifiedMediaRange;
  source: { language: "ko"; state: "available" | "withheld"; text: string | null; reasonCode: string | null };
  target: { language: "en"; state: "available" | "withheld"; text: string | null; reasonCode: string | null };
  lineage: {
    study: OwnedMediaStudyV3Identity;
    readiness: { readinessId: string; receiptId: string; receiptContentId: string };
    coverageId: string | null;
    coverageState: GeneralizedCoverageState | "uncovered";
    preservedStates: GeneralizedCoverageState[];
    claimIds: string[];
    citationIds: string[];
    passIds: string[];
  };
}
