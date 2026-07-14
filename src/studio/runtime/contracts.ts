/**
 * Production-inert proposal for a future live runtime.
 *
 * These shapes are intentionally not part of RunBundle, Trace, applyTrace, RunState, or the
 * transport. No production producer exists. Exact development fixtures exercise the contract
 * and policy validator without implying that an orchestrator performed this work.
 */

export type TaskStatus = "defined" | "scheduled" | "working" | "reported" | "completed" | "failed" | "withheld";

export type Capability =
  | "media.read"
  | "media.seek"
  | "media.step"
  | "media.loop"
  | "media.mark"
  | "media.extract"
  | "media.track.select"
  | "media.frames.read"
  | "media.waveform.read"
  | "media.spectrogram.read"
  | "media.ocr.read"
  | "recognizer.run"
  | "detector.run"
  | "artifact.write"
  | "task.spawn.request"
  | "report.submit"
  | "memory.propose"
  | "output.withhold";

export interface RuntimeBudget {
  wallMs: number;
  toolCalls: number;
  tokens: number;
}

export interface RuntimeLimits {
  maxDepth: number;
  maxActiveWorkers: number;
  runBudget: RuntimeBudget;
}

export interface MediaScope {
  artifactId: string;
  trackId: string | null;
  range: [number, number];
}

export interface RequiredOutput {
  name: string;
  artifactKind: string;
  required: boolean;
}

export interface TaskDefinition {
  id: string;
  runId: string;
  dedupeKey: string;
  objective: string;
  parentTaskId: string | null;
  parentAgentId: string | null;
  ownerAgentId: string | null;
  depth: number;
  mediaScope: MediaScope[];
  inputArtifacts: string[];
  requiredOutputs: RequiredOutput[];
  requiredCapabilities: Capability[];
  dependencies: string[];
  budget: RuntimeBudget;
  status: TaskStatus;
}

export interface CapabilityGrant {
  capability: Capability;
  mediaScope: MediaScope[];
}

export interface RuntimeArtifact {
  id: string;
  kind: string;
  mediaClass: "raw" | "derived" | "non_media";
  producerTaskId: string;
  producerAgentId: string;
  sourceArtifactIds: string[];
  receiptId: string;
}

interface RuntimeContractEventBase {
  seq: number;
  fixtureOnly: true;
}

export interface SpawnRequestedEvent extends RuntimeContractEventBase {
  type: "spawn_requested";
  requestId: string;
  requestedByTaskId: string;
  requestedByAgentId: string;
  task: TaskDefinition;
}

export type SpawnRejection =
  | "max_depth"
  | "max_active_workers"
  | "run_budget"
  | "duplicate_owner"
  | "missing_output_contract"
  | "least_privilege";

export interface SpawnDecidedEvent extends RuntimeContractEventBase {
  type: "spawn_decided";
  requestId: string;
  schedulerId: string;
  accepted: boolean;
  rejection: SpawnRejection | null;
  grants: CapabilityGrant[];
}

export interface AgentRegisteredEvent extends RuntimeContractEventBase {
  type: "agent_registered";
  agentId: string;
  taskId: string;
  parentTaskId: string;
  parentAgentId: string;
  grants: CapabilityGrant[];
}

export interface TaskTransitionEvent extends RuntimeContractEventBase {
  type: "task_transition";
  taskId: string;
  agentId: string;
  status: TaskStatus;
  reason: string | null;
}

export interface ArtifactRecordedEvent extends RuntimeContractEventBase {
  type: "artifact_recorded";
  artifact: RuntimeArtifact;
}

export interface ReportSubmittedEvent extends RuntimeContractEventBase {
  type: "report_submitted";
  reportId: string;
  taskId: string;
  agentId: string;
  parentTaskId: string;
  parentAgentId: string;
  outputArtifactIds: string[];
  summary: string;
}

export interface ReportDecidedEvent extends RuntimeContractEventBase {
  type: "report_decided";
  reportId: string;
  decidedByTaskId: string;
  decidedByAgentId: string;
  accepted: boolean;
  reason: string;
}

export interface ControlRequestedEvent extends RuntimeContractEventBase {
  type: "control_requested";
  requestId: string;
  action: "pause" | "resume" | "cancel";
  requestedBy: string;
}

export interface ControlAcknowledgedEvent extends RuntimeContractEventBase {
  type: "control_acknowledged";
  requestId: string;
  runtimeId: string;
  accepted: boolean;
  reason: string;
}

export interface MemoryProposedEvent extends RuntimeContractEventBase {
  type: "memory_proposed";
  proposalId: string;
  taskId: string;
  agentId: string;
  kind: "glossary" | "correction" | "rule";
  evidenceArtifactIds: string[];
}

export interface MemoryDecidedEvent extends RuntimeContractEventBase {
  type: "memory_decided";
  proposalId: string;
  decidedBy: string;
  accepted: boolean;
  reason: string;
}

export type RuntimeContractEvent =
  | SpawnRequestedEvent
  | SpawnDecidedEvent
  | AgentRegisteredEvent
  | TaskTransitionEvent
  | ArtifactRecordedEvent
  | ReportSubmittedEvent
  | ReportDecidedEvent
  | ControlRequestedEvent
  | ControlAcknowledgedEvent
  | MemoryProposedEvent
  | MemoryDecidedEvent;

export interface RuntimeContractFixture {
  id: string;
  fixtureOnly: true;
  note: string;
  limits: RuntimeLimits;
  seedTasks: TaskDefinition[];
  seedArtifacts: RuntimeArtifact[];
  events: RuntimeContractEvent[];
}
