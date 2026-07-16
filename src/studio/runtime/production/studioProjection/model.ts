import type {
  Capability,
  CaptionExecutorClassification,
  CaptionProductionStatus,
  CaptionQualityControlReasonCode,
  EvidenceAssessmentScope,
  EvidenceDecisionReasonCode,
  EvidenceDecisionScope,
  EvidenceKind,
  EvidenceReadScope,
  MediaScope,
  PublishReviewDecisionReasonCode,
  PublishReviewRevocationReasonCode,
  RequiredOutput,
  SpawnRejection,
  TaskStatus,
  WorkerKind,
} from "../model.ts";

export interface ProductionStudioTaskView {
  taskId: string;
  workloadKey: string;
  objective: string;
  kind: WorkerKind;
  label: string;
  parentTaskId: string | null;
  parentAgentId: string | null;
  depth: number;
  assignedAgentId: string;
  ownerAgentId: string | null;
  status: TaskStatus;
  terminalReason: string | null;
  jobContext: {
    contextId: string;
    sourceArtifactId: string;
    sourceContentId: string;
    analysisRequestId: string;
    requestedRange: { startMs: number; endMs: number };
    taskRange: { startMs: number; endMs: number };
    requestedSourceLanguagePolicy: import("../model.ts").RequestedSourceLanguage;
    targetLanguage: string;
    selectedLanguagePackId: string | null;
    outputDepth: "captions" | "evidence";
    detectorEvidence: Array<{ artifactId: string; contentId: string; evidenceKind: EvidenceKind }>;
  };
  mediaScope: MediaScope[];
  inputArtifactIds: string[];
  requiredOutputs: RequiredOutput[];
  dependencies: string[];
}

export interface ProductionStudioWorkerView {
  agentId: string;
  taskId: string;
  label: string;
  kind: WorkerKind;
  status: "registered" | "working" | "reporting" | "retired";
  taskStatus: TaskStatus;
  objective: string;
  parentAgentId: string | null;
  parentTaskId: string | null;
  depth: number;
  capabilities: string[];
  mediaScope: MediaScope[];
  execution: null | {
    id: string;
    launchClaimId: string;
    status: "active" | "completed" | "failed" | "timed_out" | "interrupted";
    activeDurationMs: number | null;
    usage: null | {
      model: string | null;
      inputTokens: number;
      cachedInputTokens: number;
      outputTokens: number;
      reasoningOutputTokens: number;
      billedAmount: null;
    };
  };
  report: null | {
    id: string;
    status: "submitted" | "accepted" | "rejected";
    summary: string;
  };
}

export interface ProductionStudioGrantView {
  grantId: string;
  taskId: string;
  agentId: string;
  capability: Capability;
  mediaScope: MediaScope[];
  evidenceScope: EvidenceReadScope[];
  assessmentScope: EvidenceAssessmentScope | null;
  decisionScope: EvidenceDecisionScope | null;
}

export interface ProductionStudioEvidenceArtifactView {
  artifactId: string;
  kind: string;
  evidenceKind: EvidenceKind;
  receiptSchema: "studio.speech-activity.v1" | "studio.language-ranges.v1";
  producerId: "silero-vad" | "whisper-language-id";
  contentId: string;
  bytes: number;
  sourceArtifactIds: string[];
  preflightId: string;
  preflightContentId: string;
}

export interface ProductionStudioEvidenceReadView {
  operationId: string;
  capability: "evidence.read";
  status: "started" | "completed" | "failed";
  taskId: string;
  agentId: string;
  grantId: string;
  inputArtifactId: string;
  evidenceKind: EvidenceKind;
  sourceArtifactId: string;
  startMs: number;
  endMs: number;
  maxBytes: number;
  maxItems: number;
  receiptId: string | null;
  receiptContentId: string | null;
  returnedItems: number | null;
  returnedFactBytes: number | null;
  truncated: boolean | null;
  failure: string | null;
}

export interface ProductionStudioEvidenceAssessmentView {
  operationId: string;
  capability: "analysis.evidence.assess";
  status: "started" | "completed" | "failed";
  taskId: string;
  agentId: string;
  grantId: string;
  readReceiptIds: string[];
  readReceiptContentIds: string[];
  maxReadReceipts: number;
  maxClaims: number;
  maxCitations: number;
  maxTokens: number;
  outputArtifactId: string | null;
  receiptId: string | null;
  receiptContentId: string | null;
  claimCount: number | null;
  citationCount: number | null;
  tokenCount: number | null;
  failure: string | null;
}

export interface ProductionStudioEvidenceAssessmentArtifactView {
  artifactId: string;
  kind: "evidence-assessment-receipt";
  contentId: string;
  bytes: number;
  producerTaskId: string;
  producerAgentId: string;
  operationId: string;
  receiptId: string;
  receiptContentId: string;
  readReceiptIds: string[];
  readReceiptContentIds: string[];
}

export interface ProductionStudioEvidenceDecisionView {
  operationId: string;
  capability: "analysis.evidence.decide";
  status: "started" | "completed" | "failed";
  taskId: string;
  agentId: string;
  grantId: string;
  assessmentOperationIds: string[];
  assessmentArtifactIds: string[];
  assessmentReceiptIds: string[];
  assessmentReceiptContentIds: string[];
  maxAuditedAssessments: number;
  outputArtifactId: string | null;
  receiptId: string | null;
  receiptContentId: string | null;
  outcome: "withheld" | "proceed_to_publish_review" | null;
  reasonCodes: EvidenceDecisionReasonCode[];
  auditedClaimCount: number | null;
  failure: string | null;
}

export interface ProductionStudioEvidenceDecisionArtifactView {
  artifactId: string;
  kind: "evidence-decision-receipt";
  contentId: string;
  bytes: number;
  producerTaskId: string;
  producerAgentId: string;
  operationId: string;
  receiptId: string;
  receiptContentId: string;
  assessmentOperationIds: string[];
  assessmentArtifactIds: string[];
  assessmentReceiptIds: string[];
  assessmentReceiptContentIds: string[];
}

export interface ProductionStudioPublishReviewIntakeView {
  intakeId: string;
  status: "started" | "completed" | "failed";
  decisionOperationId: string;
  decisionArtifactId: string;
  decisionReceiptId: string;
  decisionReceiptContentId: string;
  outputArtifactId: string | null;
  receiptId: string | null;
  receiptContentId: string | null;
  outcome: "queued" | "rejected" | null;
  reasonCodes: EvidenceDecisionReasonCode[];
  failure: string | null;
}

export interface ProductionStudioPublishReviewIntakeArtifactView {
  artifactId: string;
  kind: "publish-review-intake-receipt";
  contentId: string;
  bytes: number;
  intakeId: string;
  receiptId: string;
  receiptContentId: string;
  decisionOperationId: string;
  decisionArtifactId: string;
  decisionReceiptId: string;
  decisionReceiptContentId: string;
}

export interface ProductionStudioPublishReviewDecisionView {
  reviewId: string;
  status: "started" | "completed" | "failed";
  intakeId: string;
  intakeArtifactId: string;
  intakeReceiptId: string;
  intakeReceiptContentId: string;
  reviewerId: string;
  reviewerLabel: string;
  outputArtifactId: string | null;
  receiptId: string | null;
  receiptContentId: string | null;
  outcome: "approve_for_caption_production" | "reject_with_reasons" | null;
  reasonCodes: PublishReviewDecisionReasonCode[];
  note: string | null;
  failure: string | null;
}

export interface ProductionStudioPublishReviewRevocationView {
  revocationId: string;
  status: "started" | "completed" | "failed";
  reviewId: string;
  approvalArtifactId: string;
  approvalReceiptId: string;
  approvalReceiptContentId: string;
  reviewerId: string;
  reviewerLabel: string;
  outputArtifactId: string | null;
  receiptId: string | null;
  receiptContentId: string | null;
  reasonCodes: PublishReviewRevocationReasonCode[];
  note: string | null;
  failure: string | null;
}

export interface ProductionStudioPublishReviewDecisionArtifactView {
  artifactId: string;
  kind: "publish-review-decision-receipt";
  contentId: string;
  bytes: number;
  reviewId: string;
  receiptId: string;
  receiptContentId: string;
  intakeId: string;
  intakeArtifactId: string;
  intakeReceiptId: string;
  intakeReceiptContentId: string;
}

export interface ProductionStudioPublishReviewRevocationArtifactView {
  artifactId: string;
  kind: "publish-review-revocation-receipt";
  contentId: string;
  bytes: number;
  revocationId: string;
  receiptId: string;
  receiptContentId: string;
  reviewId: string;
  approvalArtifactId: string;
  approvalReceiptId: string;
  approvalReceiptContentId: string;
}

export interface ProductionStudioCaptionProductionView {
  jobId: string;
  status: "started" | "completed" | "failed";
  approvalReviewId: string;
  approvalArtifactId: string;
  approvalReceiptId: string;
  approvalReceiptContentId: string;
  sourceArtifactId: string;
  sourceContentId: string;
  analysisRequestId: string;
  range: { startMs: number; endMs: number };
  acceptedChildOutput: {
    artifactId: string;
    contentId: string;
  };
  rootPromotion: {
    dispositionId: string;
    artifactId: string;
    contentId: string;
    receiptId: string;
    receiptContentId: string;
  };
  executorClassification: CaptionExecutorClassification;
  executorExecutionScope: "test_demo_only" | "current_run";
  cognitionClaim: "none";
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
  failure: string | null;
}

export interface ProductionStudioCaptionQualityControlView {
  qcId: string;
  jobId: string;
  captionArtifactId: string;
  captionContentId: string;
  captionReceiptId: string;
  captionReceiptContentId: string;
  outputArtifactId: string;
  receiptId: string;
  receiptContentId: string;
  outcome: "accepted" | "withheld";
  reasonCodes: CaptionQualityControlReasonCode[];
}

export interface ProductionStudioCaptionArtifactView {
  artifactId: string;
  role: "timed_captions" | "production_receipt";
  kind: "caption-production-output" | "caption-production-receipt";
  contentId: string;
  bytes: number;
  jobId: string;
  approvalReviewId: string;
  approvalArtifactId: string;
}

export interface ProductionStudioReportView {
  reportId: string;
  taskId: string;
  agentId: string;
  parentTaskId: string;
  parentAgentId: string;
  outputArtifactIds: string[];
  summary: string;
  status: "submitted" | "accepted" | "rejected";
  decisionReason: string | null;
}

export interface ProductionStudioStudyReportView {
  reportId: string;
  artifactId: string;
  contentId: string;
  jobContextId: string;
  outputSlot: { name: string; artifactKind: "studio.study-report.v1" };
  coverage: import("../model.ts").StudyCoverageRange[];
  counts: import("../model.ts").StudyReportCounts;
  claims: import("../model.ts").StudyClaim[];
  sourceArtifacts: Array<{ artifactId: string; contentId: string }>;
  reportStatus: "submitted" | "accepted" | "rejected";
  disposition: {
    state: "absent" | "accepted" | "rejected";
    dispositionId: string | null;
    receiptId: string | null;
    receiptContentId: string | null;
  };
  admission: {
    state: "absent" | "admitted";
    admissionId: string | null;
    receiptId: string | null;
    receiptContentId: string | null;
    grant: import("../model.ts").ParentArtifactReadGrant | null;
  };
  reads: Array<{
    operationId: string;
    status: "started" | "completed" | "failed";
    returnedBytes: number | null;
    returnedItems: number | null;
    receiptId: string | null;
    failure: string | null;
  }>;
  audit: "not_checked" | "verified_on_reopen" | "absent_or_invalid";
}

export interface ProductionStudioStudyReportStateView {
  taskId: string;
  agentId: string;
  parentTaskId: string | null;
  parentAgentId: string | null;
  outputSlot: { name: string; artifactKind: "studio.study-report.v1" };
  state: "absent" | "submitted" | "accepted" | "rejected" | "failed" | "withheld" | "interrupted";
  reportId: string | null;
  artifactId: string | null;
  reason: string | null;
}

export interface ProductionStudioSpawnView {
  requestId: string;
  requestedByTaskId: string;
  requestedByAgentId: string;
  workloadKey: string;
  objective: string;
  workerKind: WorkerKind;
  workerLabel: string;
  mediaScope: MediaScope[];
  inputArtifactIds: string[];
  requiredOutputs: RequiredOutput[];
  requiredCapabilities: Capability[];
  dependencies: string[];
  decision: "pending" | "accepted" | "rejected";
  rejection: SpawnRejection | null;
  taskId: string | null;
  agentId: string | null;
  authoredByExecutionId: string | null;
  toolCallId: string | null;
}

export interface ProductionStudioTaskLaunchView {
  launchClaimId: string;
  requestId: string;
  taskId: string;
  agentId: string;
  executorKind: "codex" | "deterministic_test";
  claimedAt: string;
  executionId: string | null;
  executorState: "claimed" | "active" | "completed" | "failed" | "timed_out" | "interrupted";
}

export interface ProductionStudioReportsWaitView {
  waitId: string;
  executionId: string;
  parentTaskId: string;
  status: "waiting" | "returned";
  result: "all_terminal" | "closed_failure" | null;
  failure: "no_children" | "child_interrupted" | "child_failed" | null;
  children: import("../model.ts").TerminalChildIdentity[];
}

export interface ProductionStudioOrchestratorDecisionView {
  executionId: string;
  taskId: string;
  outcome: "completed" | "no_request" | "withheld";
  reason: string;
}

export interface ProductionStudioRootOutputDispositionView {
  dispositionId: string;
  reportId: string;
  spawnRequestId: string;
  rootTaskId: string;
  rootAgentId: string;
  childTaskId: string;
  childAgentId: string;
  inputArtifactId: string;
  outputArtifactId: string;
  outcome: "promoted_to_root" | "rejected_by_root";
  reason: string;
  receiptId: string;
  receiptContentId: string;
}

export interface ProductionStudioOperationView {
  operationId: string;
  capability: "media.extract" | "media.seek";
  status: "started" | "completed" | "failed";
  taskId: string;
  agentId: string;
  grantId: string;
  inputArtifactId: string;
  trackId: string;
  startMs: number;
  endMs: number;
  requestedDurationMs: number;
  outputArtifactId: string | null;
  receiptId: string | null;
  observation: {
    status: "observed";
    decodedDurationUs: number;
    kind: "audio_activity";
    value: "signal" | "digital_silence";
    range: { startMs: number; endMs: number };
    measurements: {
      meanVolumeDb: number | null;
      peakVolumeDb: number | null;
      silenceThresholdDb: -60;
    };
  } | null;
  failure: string | null;
}

export interface ProductionStudioSemanticEvidenceView {
  operationId: string;
  capability: "speech.transcribe";
  status: "started" | "completed" | "failed";
  audit: "not_completed" | "verified_at_completion" | "verified_on_reopen" | "absent_or_invalid";
  producer: {
    id: string;
    version: string;
    model: string | null;
    runtimeId: string;
    runtimeVersion: string;
    configurationId: string;
    configurationContentId: string;
    executionScope: "current_run";
  };
  executor: { taskId: string; agentId: string; executionId: string; launchClaimId: string; grantId: string };
  source: {
    artifactId: string;
    contentId: string;
    trackId: string;
    range: { startMs: number; endMs: number };
  };
  returnedRange: { startMs: number; endMs: number } | null;
  artifact: { artifactId: string; contentId: string } | null;
  receipt: { receiptId: string; contentId: string } | null;
  observationCount: number | null;
  availability: {
    id: string;
    state: "available" | "empty" | "unavailable" | "unknown";
    truncated: boolean;
  } | null;
  failure: string | null;
}

export type ProductionStudioOutputArtifactOrigin =
  | {
      kind: "media_operation" | "media_observation";
      operationId: string;
      receiptId: string;
      receiptContentId: string;
    }
  | {
      kind: "semantic_media_evidence";
      operationId: string;
      receiptId: string;
      receiptContentId: string;
      availabilityId: string;
    }
  | {
      kind: "worker_output";
      executionId: string;
      receiptId: string;
      receiptContentId: string;
    };

export interface ProductionStudioSourceArtifactView {
  artifactId: string;
  kind: string;
  mediaClass: "raw";
  publication: "private" | "public";
  contentId: string;
  bytes: number;
  durationMs: number | null;
  trackCount: number;
}

export interface ProductionStudioOutputArtifactView {
  artifactId: string;
  kind: string;
  mediaClass: "derived" | "non_media";
  publication: "private" | "public";
  contentId: string;
  bytes: number;
  durationMs: number | null;
  producerTaskId: string;
  producerAgentId: string;
  sourceArtifactIds: string[];
  origin: ProductionStudioOutputArtifactOrigin;
  reportIds: string[];
}

export interface ProductionStudioProjection {
  schema: "studio.production-projection.v1";
  source: {
    kind: "production_runtime_journal";
    recordedDemo: false;
  };
  runId: string;
  lastSeq: number;
  tasks: ProductionStudioTaskView[];
  workers: ProductionStudioWorkerView[];
  grants: ProductionStudioGrantView[];
  reports: ProductionStudioReportView[];
  studyReports: ProductionStudioStudyReportView[];
  studyReportStates: ProductionStudioStudyReportStateView[];
  spawnRequests: ProductionStudioSpawnView[];
  taskLaunches: ProductionStudioTaskLaunchView[];
  reportWaits: ProductionStudioReportsWaitView[];
  orchestratorDecisions: ProductionStudioOrchestratorDecisionView[];
  rootOutputDispositions: ProductionStudioRootOutputDispositionView[];
  operations: ProductionStudioOperationView[];
  /** Present on real production projections; optional only for older typed UI fixtures. */
  semanticEvidence?: ProductionStudioSemanticEvidenceView[];
  evidenceReads: ProductionStudioEvidenceReadView[];
  evidenceAssessments: ProductionStudioEvidenceAssessmentView[];
  evidenceDecisions: ProductionStudioEvidenceDecisionView[];
  publishReviewIntakes: ProductionStudioPublishReviewIntakeView[];
  publishReviewDecisions: ProductionStudioPublishReviewDecisionView[];
  publishReviewRevocations: ProductionStudioPublishReviewRevocationView[];
  captionProductions: ProductionStudioCaptionProductionView[];
  captionQualityControls: ProductionStudioCaptionQualityControlView[];
  sourceArtifacts: ProductionStudioSourceArtifactView[];
  evidenceArtifacts: ProductionStudioEvidenceArtifactView[];
  assessmentArtifacts: ProductionStudioEvidenceAssessmentArtifactView[];
  decisionArtifacts: ProductionStudioEvidenceDecisionArtifactView[];
  publishReviewIntakeArtifacts: ProductionStudioPublishReviewIntakeArtifactView[];
  publishReviewDecisionArtifacts: ProductionStudioPublishReviewDecisionArtifactView[];
  publishReviewRevocationArtifacts: ProductionStudioPublishReviewRevocationArtifactView[];
  captionArtifacts: ProductionStudioCaptionArtifactView[];
  outputArtifacts: ProductionStudioOutputArtifactView[];
  counts: {
    tasks: number;
    workers: number;
    grants: number;
    executions: number;
    reports: number;
    studyReports: number;
    studyReportStates: number;
    spawnRequests: number;
    taskLaunches: number;
    reportWaits: number;
    orchestratorDecisions: number;
    rootOutputDispositions: number;
    operations: number;
    semanticEvidence?: number;
    evidenceReads: number;
    evidenceAssessments: number;
    evidenceDecisions: number;
    publishReviewIntakes: number;
    publishReviewDecisions: number;
    publishReviewRevocations: number;
    captionProductions: number;
    captionQualityControls: number;
    sourceArtifacts: number;
    evidenceArtifacts: number;
    assessmentArtifacts: number;
    decisionArtifacts: number;
    publishReviewIntakeArtifacts: number;
    publishReviewDecisionArtifacts: number;
    publishReviewRevocationArtifacts: number;
    captionArtifacts: number;
    outputArtifacts: number;
  };
}
