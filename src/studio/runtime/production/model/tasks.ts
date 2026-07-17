export const CAPABILITIES = [
  "task.spawn.request",
  "task.reports.wait",
  "report.submit",
  "media.extract",
  "media.seek",
  "speech.transcribe",
  "evidence.read",
  "analysis.evidence.assess",
  "analysis.evidence.decide",
  "report.disposition",
  "artifact.read",
  "study.plan",
  "study.synthesize",
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

export type EvidenceKind = "speech_activity" | "language_ranges" | "acoustic_ranges";

/** Scheduler-issued, artifact-exact response budget for one existing evidence receipt. */
export interface EvidenceReadScope {
  artifactId: string;
  evidenceKind: EvidenceKind;
  sourceArtifactId: string;
  startMs: number;
  endMs: number;
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
export type TaskStatus =
  | "scheduled"
  | "working"
  | "waiting_for_children"
  | "reported"
  | "completed"
  | "failed"
  | "withheld"
  | "interrupted";
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

/** Path-free, content-addressed authority inherited or attenuated by the scheduler. */
export interface TaskJobContext {
  schema: "studio.task-job-context.v1";
  contextId: string;
  source: {
    artifactId: string;
    contentId: string;
  };
  analysisRequest: {
    requestId: string;
    requestedRange: { startMs: number; endMs: number };
    taskRange: { startMs: number; endMs: number };
    options: {
      speechScope: "foreground" | "all";
      includeLyrics: boolean;
      speaker: string | null;
      honorifics: "preserve" | "naturalize";
      translationStyle: "literal" | "natural";
      captionDensity: "compact" | "balanced" | "relaxed";
      slowAnalysis: boolean;
    };
  };
  requestedSourceLanguagePolicy: RequestedSourceLanguage;
  targetLanguage: string;
  selectedLanguagePackId: string | null;
  outputDepth: "captions" | "evidence";
  detectorEvidence: Array<{
    artifactId: string;
    contentId: string;
    evidenceKind: EvidenceKind;
  }>;
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
  jobContext: TaskJobContext;
  mediaScope: MediaScope[];
  inputArtifactIds: string[];
  requiredOutputs: RequiredOutput[];
  dependencies: string[];
  budget: RuntimeBudget;
  grants: CapabilityGrant[];
  status: TaskStatus;
  terminalReason: string | null;
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

/**
 * Exact model-facing spawn contract. Task, agent, grant, and dependency task identities are
 * deliberately absent; the scheduler resolves dependency workload keys and derives ownership.
 */
export interface OrchestratorSpawnContract extends Omit<SpawnRequestInput, "dependencies"> {
  dependencyWorkloadKeys: string[];
  /** Null for initial fan-out; exact planning causation is required for post-report follow-up. */
  followUpCause?: null | {
    planningDecisionId: string;
    kind: "gap" | "conflict";
    causeId: string;
  };
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

export interface TaskLaunchRecord {
  id: string;
  requestId: string;
  taskId: string;
  agentId: string;
  executorKind: "codex" | "deterministic_test";
  claimedAt: string;
  executionId: string | null;
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
  authoredByExecutionId: string | null;
  toolCallId: string | null;
}

export type ReportsWaitFailure = "no_children" | "child_interrupted" | "child_failed";

export interface TerminalChildIdentity {
  taskId: string;
  status: "reported" | "completed" | "failed" | "withheld" | "interrupted";
  reportId: string | null;
  artifactIds: string[];
  failure: { state: "failed" | "withheld" | "interrupted"; reason: string } | null;
}

export interface ReportsWaitRecord {
  id: string;
  executionId: string;
  parentTaskId: string;
  status: "waiting" | "returned";
  result: "all_terminal" | "closed_failure" | null;
  failure: ReportsWaitFailure | null;
  children: TerminalChildIdentity[];
}

export interface OrchestratorToolCallRecord {
  id: string;
  executionId: string;
  taskId: string;
  tool:
    | "task_spawn_request"
    | "task_reports_wait"
    | "report_disposition"
    | "artifact_read"
    | "study_planning_decision"
    | "study_synthesize";
  spawnRequestId: string | null;
}

export interface OrchestratorDecisionRecord {
  executionId: string;
  taskId: string;
  outcome: "completed" | "no_request" | "withheld";
  reason: string;
}
