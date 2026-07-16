import type {
  AgentStatus,
  ExecutorOutcome,
  TaskStatus,
  WorkerKind,
} from "../model.ts";

export type IndexedOperationCapability = "media.extract" | "media.seek";

export interface Sha256Identity {
  algorithm: "sha256";
  digest: string;
  contentId: string;
  bytes: number;
}

export interface ObservabilitySourceReferences {
  eventIds: string[];
  receiptIds: string[];
  artifactIds: string[];
}

export interface ObservabilityEventSource {
  eventId: string;
  seq: number;
  type: string;
  producerKind: string;
  contentId: string;
}

export interface ObservabilityReceiptSource {
  receiptId: string;
  kind: "media_operation" | "evidence_assessment" | "evidence_decision" | "publish_review_intake" | "publish_review_decision" | "publish_review_revocation" | "caption_production" | "caption_quality_control" | "root_output_disposition" | "executor_span" | "model_usage";
  eventId: string;
  contentId: string;
  storage: "artifact_store" | "embedded_event";
  rawReceiptContentId: string | null;
}

export interface ObservabilityArtifactSource {
  artifactId: string;
  kind: string;
  eventId: string;
  contentId: string;
  receiptId: string | null;
}

export interface IndexedTask {
  runId: string;
  taskId: string;
  assignedAgentId: string;
  parentTaskId: string | null;
  depth: number;
  workerKind: WorkerKind;
  status: TaskStatus;
  sources: ObservabilitySourceReferences;
}

export interface IndexedAgent {
  runId: string;
  agentId: string;
  taskId: string;
  parentAgentId: string | null;
  kind: WorkerKind;
  status: AgentStatus;
  sources: ObservabilitySourceReferences;
}

export interface IndexedMediaOperation {
  runId: string;
  operationId: string;
  taskId: string;
  agentId: string;
  capability: IndexedOperationCapability;
  status: "started" | "completed" | "failed";
  artifactId: string;
  trackId: string;
  startMs: number;
  endMs: number;
  requestedDurationMs: number;
  outputArtifactId: string | null;
  receiptId: string | null;
  sources: ObservabilitySourceReferences;
}

export interface IndexedTokenMeasures {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
}

export interface IndexedExecution {
  runId: string;
  executionId: string;
  taskId: string;
  agentId: string;
  status: "active" | ExecutorOutcome;
  startedAt: string;
  endedAt: string | null;
  activeDurationMs: number | null;
  model: string | null;
  tokens: IndexedTokenMeasures | null;
  providerUnits: null;
  billing: { amount: null; currency: null };
  sources: ObservabilitySourceReferences;
}

export interface IndexedHandoff {
  runId: string;
  reportId: string;
  taskId: string;
  agentId: string;
  parentTaskId: string;
  parentAgentId: string;
  status: "submitted" | "accepted" | "rejected";
  outputArtifactIds: string[];
  sources: ObservabilitySourceReferences;
}

export interface IndexedFailure {
  runId: string;
  failureId: string;
  kind:
    | "spawn_rejected"
    | "task_failed"
    | "media_operation_failed"
    | "executor_failed"
    | "executor_timed_out"
    | "handoff_rejected";
  taskId: string | null;
  agentId: string | null;
  entityId: string;
  sources: ObservabilitySourceReferences;
}

export interface ObservabilityCounts {
  tasks: number;
  agents: number;
  operations: number;
  executions: number;
  handoffs: number;
  failures: number;
}

export interface ObservabilityMeasuredTotals {
  mediaRequestedDurationMs: number;
  activeDurationMs: number | null;
  inputTokens: number | null;
  cachedInputTokens: number | null;
  outputTokens: number | null;
  reasoningOutputTokens: number | null;
}

export interface ObservabilityCoverage {
  activeExecutionsMeasured: number;
  usageExecutionsMeasured: number;
  totalExecutions: number;
}

export interface ObservabilityUnavailableMeasures {
  queueDurationMs: null;
  dependencyWaitDurationMs: null;
  reportingDurationMs: null;
  criticalPathDurationMs: null;
  providerUnits: null;
  billing: { amount: null; currency: null };
}

export interface ObservabilityAggregate {
  counts: ObservabilityCounts;
  measured: ObservabilityMeasuredTotals;
  coverage: ObservabilityCoverage;
  unavailable: ObservabilityUnavailableMeasures;
}

export interface RuntimeObservabilityIndex {
  schema: "studio.runtime.observability-index.v1";
  indexId: string;
  content: Sha256Identity;
  producer: {
    id: "studio.runtime.observability-indexer";
    version: "1";
  };
  sourceJournal: {
    schema: "studio.runtime.event.v1";
    runId: string;
    content: Sha256Identity;
    eventCount: number;
    firstEventId: string;
    lastEventId: string;
  };
  sources: {
    events: ObservabilityEventSource[];
    receipts: ObservabilityReceiptSource[];
    artifacts: ObservabilityArtifactSource[];
  };
  records: {
    tasks: IndexedTask[];
    agents: IndexedAgent[];
    operations: IndexedMediaOperation[];
    executions: IndexedExecution[];
    handoffs: IndexedHandoff[];
    failures: IndexedFailure[];
  };
  summary: ObservabilityAggregate;
}

export interface ObservabilityFilters {
  runIds?: readonly string[];
  taskIds?: readonly string[];
  agentIds?: readonly string[];
  taskStatuses?: readonly TaskStatus[];
  operationCapabilities?: readonly IndexedOperationCapability[];
  executionOutcomes?: readonly ("active" | ExecutorOutcome)[];
  failureKinds?: readonly IndexedFailure["kind"][];
}

export interface ObservabilityGroup {
  key: string;
  count: number;
}

export interface ObservabilityQueryResult {
  filters: ObservabilityFilters;
  sources: RuntimeObservabilityIndex["sources"];
  records: RuntimeObservabilityIndex["records"];
  aggregate: ObservabilityAggregate;
  groups: {
    taskStatuses: ObservabilityGroup[];
    operationCapabilities: ObservabilityGroup[];
    executionOutcomes: ObservabilityGroup[];
    failureKinds: ObservabilityGroup[];
  };
}
