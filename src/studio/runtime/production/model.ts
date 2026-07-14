export const CAPABILITIES = [
  "task.spawn.request",
  "report.submit",
  "media.extract",
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

export interface RequiredOutput {
  name: string;
  artifactKind: string;
  required: boolean;
}

export type WorkerKind = "orchestrator" | "media" | "analysis" | "translation" | "quality";
export type TaskStatus = "scheduled" | "working" | "reported" | "completed" | "failed" | "withheld";
export type AgentStatus = "registered" | "working" | "reporting" | "retired";

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

export interface WorkerOutputArtifactOrigin {
  kind: "worker_output";
  executionId: string;
  receiptId: string;
  receiptContentId: string;
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
  origin: SourceArtifactOrigin | MediaOperationArtifactOrigin | WorkerOutputArtifactOrigin;
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

export interface MediaOperationReceipt {
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

export interface OperationRecord {
  id: string;
  capability: "media.extract";
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

export type ExecutorOutcome = "completed" | "failed" | "timed_out";

export interface ExecutorSpanReceipt {
  schema: "studio.executor-span.receipt.v1";
  receiptId: string;
  executionId: string;
  taskId: string;
  agentId: string;
  phase: "active";
  producer: {
    id: "codex.exec";
    version: string;
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
  executions: Record<string, ExecutorRecord>;
  modelUsage: Record<string, ModelUsageReceipt>;
  reports: Record<string, ReportRecord>;
}
