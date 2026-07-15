import type {
  ForecastArtifact,
  ForecastWorkPlan,
  FrozenForecastArtifact,
} from "./forecast/model.ts";

export const CAPABILITIES = [
  "task.spawn.request",
  "report.submit",
  "media.extract",
  "media.seek",
  "evidence.read",
  "analysis.evidence.assess",
  "analysis.evidence.decide",
] as const;

export type Capability = (typeof CAPABILITIES)[number];

export interface RuntimeBudget {
  /** Reserved task-runtime allocation. This is not measured model usage. */
  wallMs: number;
  /** Maximum capability-host calls this task may start. */
  toolCalls: number;
}

export interface RuntimeLimits {
  maxDepth: number;
  maxActiveWorkers: number;
  runBudget: RuntimeBudget;
  grantableCapabilities: Capability[];
}

/** Integer millisecond, half-open range: startMs <= t < endMs. */
export interface MediaScope {
  artifactId: string;
  trackId: string;
  startMs: number;
  endMs: number;
}

export type EvidenceKind = "speech_activity" | "language_ranges";

/** Scheduler-issued, artifact-exact response budget for one existing evidence receipt. */
export interface EvidenceReadScope {
  artifactId: string;
  evidenceKind: EvidenceKind;
  maxBytes: number;
  maxItems: number;
}

/** Scheduler-issued hard envelope for one assessment over completed evidence-read receipts. */
export interface EvidenceAssessmentScope {
  evidenceArtifactIds: string[];
  maxAssessments: number;
  maxReadReceipts: number;
  maxClaims: number;
  /** Maximum total fact indexes across all citation groups. */
  maxCitations: number;
  /** Host-defined deterministic structured-token units, not model/provider usage. */
  maxTokens: number;
}

/** Scheduler-issued hard envelope for decisions over live, fully audited assessment identities. */
export interface EvidenceDecisionScope {
  maxDecisions: number;
  maxAuditedAssessments: number;
}

export interface RequiredOutput {
  name: string;
  artifactKind: string;
  required: boolean;
}

export type WorkerKind = "orchestrator" | "media" | "analysis" | "translation" | "quality";
export type TaskStatus = "scheduled" | "working" | "reported" | "completed" | "failed" | "withheld";
export type AgentStatus = "registered" | "working" | "reporting" | "retired";

/** The requested source language is policy input. Detector evidence never mutates this value. */
export type RequestedSourceLanguage =
  | { mode: "declared"; languages: [string]; reason: null }
  | { mode: "automatic"; languages: []; reason: null }
  | { mode: "mixed"; languages: [string, string, ...string[]]; reason: null }
  | { mode: "unknown"; languages: []; reason: null }
  | { mode: "withheld"; languages: []; reason: string };

/**
 * Language context carried by the production AnalysisRequest. A run has one explicit target
 * language; pack selection and detector evidence are separate, immutable inputs. Scheduler task
 * propagation is a later contract revision, not implied by this run-start slice.
 */
export interface LanguageJobContext {
  languagePair: {
    requestedSource: RequestedSourceLanguage;
    targetLanguage: string;
  };
  selectedLanguagePackId: string | null;
  detectedLanguageEvidenceContentIds: string[];
}

export interface TaskRecord {
  id: string;
  runId: string;
  workloadKey: string;
  objective: string;
  workerKind: WorkerKind;
  workerLabel: string;
  parentTaskId: string | null;
  parentAgentId: string | null;
  depth: number;
  assignedAgentId: string;
  ownerAgentId: string | null;
  mediaScope: MediaScope[];
  inputArtifactIds: string[];
  requiredOutputs: RequiredOutput[];
  dependencies: string[];
  budget: RuntimeBudget;
  grants: CapabilityGrant[];
  status: TaskStatus;
}

export interface CapabilityGrant {
  id: string;
  capability: Capability;
  taskId: string;
  agentId: string;
  mediaScope: MediaScope[];
  evidenceScope: EvidenceReadScope[];
  assessmentScope: EvidenceAssessmentScope | null;
  decisionScope: EvidenceDecisionScope | null;
}

export interface AgentRecord {
  id: string;
  taskId: string;
  parentTaskId: string | null;
  parentAgentId: string | null;
  kind: WorkerKind;
  label: string;
  grants: CapabilityGrant[];
  status: AgentStatus;
}

export interface ContentIdentity {
  algorithm: "sha256";
  digest: string;
  contentId: string;
  bytes: number;
}

export interface MediaTrackDescriptor {
  id: string;
  index: number;
  kind: "audio" | "video" | "subtitle" | "data" | "attachment";
  codec: string;
  durationMs: number | null;
}

/**
 * Provider-neutral output of a registered source adapter. Provider receipt fields stop before
 * this boundary; the runtime retains only an opaque receipt reference and enforceable scope.
 */
export interface SourceArtifactDescriptor {
  schema: "studio.source-artifact.v1";
  adapterId: string;
  sourceReceiptRef: string;
  publication: "private" | "public";
  path: string;
  content: ContentIdentity;
  durationMs: number;
  tracks: MediaTrackDescriptor[];
}

/** Host-only descriptor for producer-validated evidence that existed before runtime start. */
export interface PreflightEvidenceArtifactDescriptor {
  schema: "studio.preflight-evidence-artifact.v1";
  evidenceKind: EvidenceKind;
  receiptSchema: "studio.speech-activity.v1" | "studio.language-ranges.v1";
  producerId: "silero-vad" | "whisper-language-id";
  path: string;
  content: ContentIdentity;
  preflightId: string;
  preflightContentId: string;
}

export interface ProductionSourceSession {
  schema: "studio.source-session.v1";
  sessionId: string;
  revisionId: string;
  adapterId: "owned-local-source-adapter.v1";
  sourceReceipt: {
    schema: "studio.ingest.owned-local.v1";
    receiptId: string;
    contentId: string;
    rightsScope: "local_processing" | "redistribution";
  };
  source: {
    contentId: string;
    bytes: number;
    durationMs: number;
  };
  mediaProbe: {
    schema: "studio.media-probe.v1";
    producer: "scripts/probe-media.mjs";
    contentId: string;
  };
  preflight: {
    schema: "studio.preflight-bundle.v1" | "studio.preflight-bundle.v2" | "studio.preflight-bundle.v3";
    preflightId: string;
    contentId: string;
  };
  detectedLanguageEvidenceContentIds: string[];
}

export interface ProductionAnalysisRequest {
  schema: "studio.analysis-request.v1";
  requestId: string;
  sourceSessionId: string;
  sourceRevisionId: string;
  sourceContentId: string;
  range: { startMs: number; endMs: number };
  language: LanguageJobContext;
  outputDepth: "captions" | "evidence";
  options: {
    speechScope: "foreground" | "all";
    includeLyrics: boolean;
    speaker: string | null;
    honorifics: "preserve" | "naturalize";
    translationStyle: "literal" | "natural";
    captionDensity: "compact" | "balanced" | "relaxed";
    slowAnalysis: boolean;
  };
}

export interface RuntimeStartRecord {
  schema: "studio.runtime-start.v1";
  producer: { id: "studio.local-runtime-start"; version: "1" };
  commandId: string;
  runtimeId: string;
  journalId: string;
  sourceSession: ProductionSourceSession;
  sourceArtifactId: string;
  analysisRequest: ProductionAnalysisRequest;
  workPlan: ForecastWorkPlan;
  forecast: ForecastArtifact;
  frozenForecast: FrozenForecastArtifact;
  startedAt: string;
}

export interface SourceArtifactOrigin {
  kind: "ingest";
  adapterId: string;
  sourceReceiptRef: string;
}

export interface MediaOperationArtifactOrigin {
  kind: "media_operation";
  operationId: string;
  receiptId: string;
  receiptContentId: string;
}

export interface MediaObservationArtifactOrigin {
  kind: "media_observation";
  operationId: string;
  receiptId: string;
  receiptContentId: string;
}

export interface WorkerOutputArtifactOrigin {
  kind: "worker_output";
  executionId: string;
  receiptId: string;
  receiptContentId: string;
}

export interface PreflightEvidenceArtifactOrigin {
  kind: "preflight_evidence";
  evidenceKind: EvidenceKind;
  receiptSchema: "studio.speech-activity.v1" | "studio.language-ranges.v1";
  producerId: "silero-vad" | "whisper-language-id";
  preflightId: string;
  preflightContentId: string;
}

export interface EvidenceAssessmentArtifactOrigin {
  kind: "evidence_assessment";
  operationId: string;
  receiptId: string;
  receiptContentId: string;
  readReceiptIds: string[];
  readReceiptContentIds: string[];
}

export interface EvidenceDecisionArtifactOrigin {
  kind: "evidence_decision";
  operationId: string;
  receiptId: string;
  receiptContentId: string;
  assessmentOperationIds: string[];
  assessmentArtifactIds: string[];
  assessmentReceiptIds: string[];
  assessmentReceiptContentIds: string[];
}

export interface PublishReviewIntakeArtifactOrigin {
  kind: "publish_review_intake";
  intakeId: string;
  receiptId: string;
  receiptContentId: string;
  decisionOperationId: string;
  decisionArtifactId: string;
  decisionReceiptId: string;
  decisionReceiptContentId: string;
}

export interface RuntimeArtifact {
  schema: "studio.runtime.artifact.v1";
  id: string;
  runId: string;
  kind: string;
  mediaClass: "raw" | "derived" | "non_media";
  publication: "private" | "public";
  content: ContentIdentity;
  storageKey: string;
  durationMs: number | null;
  tracks: MediaTrackDescriptor[];
  sourceArtifactIds: string[];
  producerTaskId: string | null;
  producerAgentId: string | null;
  origin:
    | SourceArtifactOrigin
    | MediaOperationArtifactOrigin
    | MediaObservationArtifactOrigin
    | WorkerOutputArtifactOrigin
    | PreflightEvidenceArtifactOrigin
    | EvidenceAssessmentArtifactOrigin
    | EvidenceDecisionArtifactOrigin
    | PublishReviewIntakeArtifactOrigin;
}

export interface WorkerOutputEnvelope {
  schema: "studio.worker-output.v1";
  executionId: string;
  taskId: string;
  agentId: string;
  output: {
    name: string;
    kind: string;
    content: string;
  };
}

export interface SpawnRequestInput {
  workloadKey: string;
  objective: string;
  workerKind: WorkerKind;
  workerLabel: string;
  mediaScope: MediaScope[];
  inputArtifactIds: string[];
  requiredOutputs: RequiredOutput[];
  requiredCapabilities: Capability[];
  dependencies: string[];
  budget: RuntimeBudget;
}

export type SpawnRejection =
  | "requester_not_authorized"
  | "max_depth"
  | "max_active_workers"
  | "run_budget"
  | "duplicate_owner"
  | "missing_output_contract"
  | "dependency_unavailable"
  | "scope_violation"
  | "capability_not_grantable";

export interface LaunchPermit {
  requestId: string;
  taskId: string;
  agentId: string;
  registrationSecret: string;
}

export interface MediaExtractRequest {
  operationId: string;
  taskId: string;
  agentId: string;
  artifactId: string;
  trackId: string;
  startMs: number;
  endMs: number;
}

export interface MediaSeekRequest {
  operationId: string;
  taskId: string;
  agentId: string;
  artifactId: string;
  trackId: string;
  startMs: number;
  endMs: number;
}

export type MediaOperationRequest = MediaExtractRequest | MediaSeekRequest;

export interface MediaExtractReceipt {
  schema: "studio.media-operation.receipt.v1";
  receiptId: string;
  operationId: string;
  capability: "media.extract";
  authorization: {
    grantId: string;
    taskId: string;
    agentId: string;
  };
  request: {
    artifactId: string;
    trackId: string;
    startMs: number;
    endMs: number;
  };
  producer: {
    id: "ffmpeg.audio-range-extract";
    version: string;
  };
  input: {
    artifactId: string;
    contentId: string;
  };
  output: {
    artifactId: string;
    contentId: string;
    bytes: number;
    durationMs: number;
    trackId: string;
  };
  sourceArtifactIds: string[];
}

export interface MediaSeekObservationReceipt {
  schema: "studio.media-operation.receipt.v1";
  receiptId: string;
  operationId: string;
  capability: "media.seek";
  authorization: {
    grantId: string;
    taskId: string;
    agentId: string;
  };
  request: {
    artifactId: string;
    trackId: string;
    startMs: number;
    endMs: number;
  };
  producer: {
    id: "ffmpeg.bounded-seek-observation";
    version: string;
  };
  input: {
    artifactId: string;
    contentId: string;
  };
  observation: {
    status: "decoded";
    decodedDurationUs: number;
  };
  sourceArtifactIds: string[];
}

export type MediaOperationReceipt = MediaExtractReceipt | MediaSeekObservationReceipt;

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
  schema: "studio.evidence-read.receipt.v1";
  receiptId: string;
  operationId: string;
  capability: "evidence.read";
  authorization: {
    grantId: string;
    taskId: string;
    agentId: string;
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
  producer: { id: "studio.bounded-evidence-read"; version: "1" };
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

export type PublishReviewIntakeOutcome = "queued" | "rejected";

export interface PublishReviewIntakeReceipt {
  schema: "studio.publish-review-intake.receipt.v1";
  receiptId: string;
  intakeId: string;
  input: {
    decision: EvidenceDecisionReceiptIdentity;
    verification: {
      integrity: "stored_decision_and_audited_inputs_verified";
      producer: "deterministic_audit_state_gate_v1";
    };
  };
  producer: {
    id: "studio.host-publish-review-intake";
    version: "1";
    policy: "queue_verified_proceed_reject_verified_withheld";
  };
  result: {
    outcome: PublishReviewIntakeOutcome;
    reasonCodes: EvidenceDecisionReasonCode[];
  };
}

export interface OperationRecord {
  id: string;
  capability: "media.extract" | "media.seek";
  taskId: string;
  agentId: string;
  grantId: string;
  artifactId: string;
  trackId: string;
  startMs: number;
  endMs: number;
  status: "started" | "completed" | "failed";
  outputArtifactId: string | null;
  receiptId: string | null;
  failure: string | null;
}

export interface EvidenceReadRecord {
  id: string;
  taskId: string;
  agentId: string;
  grantId: string;
  artifactId: string;
  evidenceKind: EvidenceKind;
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

export interface PublishReviewIntakeRecord {
  id: string;
  decisionOperationId: string;
  decisionArtifactId: string;
  decisionReceiptId: string;
  decisionReceiptContentId: string;
  status: "started" | "completed" | "failed";
  artifactId: string | null;
  receiptId: string | null;
  receiptContentId: string | null;
  outcome: PublishReviewIntakeOutcome | null;
  reasonCodes: EvidenceDecisionReasonCode[];
  failure: string | null;
}

export type ExecutorOutcome = "completed" | "failed" | "timed_out";

export interface ExecutorSpanReceipt {
  schema: "studio.executor-span.receipt.v1";
  receiptId: string;
  executionId: string;
  taskId: string;
  agentId: string;
  phase: "active";
  producer:
    | {
        id: "codex.exec";
        version: string;
        sandbox: "read-only";
        ephemeral: true;
      }
    | {
        id: "studio.deterministic-test-executor";
        version: "1";
        sandbox: "read-only";
        ephemeral: true;
      };
  startedAt: string;
  endedAt: string;
  monotonicDurationMs: number;
  outcome: ExecutorOutcome;
  process: {
    exitCode: number | null;
    signal: string | null;
  };
  outputArtifactIds: string[];
  modelUsageReceiptId: string | null;
  failure: string | null;
}

export interface ModelUsageReceipt {
  schema: "studio.model-usage.receipt.v1";
  receiptId: string;
  executionId: string;
  taskId: string;
  agentId: string;
  producer: {
    id: "codex.exec";
    version: string;
  };
  /** The CLI JSONL contract does not currently identify the selected model. */
  model: string | null;
  measured: {
    inputTokens: number;
    cachedInputTokens: number;
    outputTokens: number;
    reasoningOutputTokens: number;
  };
  /** No provider-unit or billing producer exists in this launcher. */
  providerUnits: null;
  billing: {
    amount: null;
    currency: null;
  };
  rawReceipt: {
    source: "codex.exec.turn.completed";
    contentId: string;
    storageKey: string;
  };
}

export interface ExecutorRecord {
  id: string;
  taskId: string;
  agentId: string;
  startedAt: string;
  status: "active" | ExecutorOutcome;
  receipt: ExecutorSpanReceipt | null;
  outputArtifactIds: string[];
  modelUsageReceiptId: string | null;
}

export interface ReportRecord {
  id: string;
  taskId: string;
  agentId: string;
  parentTaskId: string;
  parentAgentId: string;
  outputArtifactIds: string[];
  summary: string;
  status: "submitted" | "accepted" | "rejected";
  decisionReason: string | null;
}

export interface ReportSubmitRequest {
  taskId: string;
  agentId: string;
  outputArtifactIds: string[];
  summary: string;
}

export interface ReportDecisionRequest {
  reportId: string;
  decidedByTaskId: string;
  decidedByAgentId: string;
  accepted: boolean;
  reason: string;
}

export interface SpawnRequestRecord {
  id: string;
  requestedByTaskId: string;
  requestedByAgentId: string;
  input: SpawnRequestInput;
  accepted: boolean | null;
  rejection: SpawnRejection | null;
  taskId: string | null;
  agentId: string | null;
}

export interface RuntimeProjection {
  runId: string;
  lastSeq: number;
  tasks: Record<string, TaskRecord>;
  agents: Record<string, AgentRecord>;
  artifacts: Record<string, RuntimeArtifact>;
  spawnRequests: Record<string, SpawnRequestRecord>;
  operations: Record<string, OperationRecord>;
  evidenceReads: Record<string, EvidenceReadRecord>;
  evidenceAssessments: Record<string, EvidenceAssessmentRecord>;
  evidenceDecisions: Record<string, EvidenceDecisionRecord>;
  publishReviewIntakes: Record<string, PublishReviewIntakeRecord>;
  executions: Record<string, ExecutorRecord>;
  modelUsage: Record<string, ModelUsageReceipt>;
  reports: Record<string, ReportRecord>;
}
