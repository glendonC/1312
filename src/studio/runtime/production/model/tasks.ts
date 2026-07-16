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
