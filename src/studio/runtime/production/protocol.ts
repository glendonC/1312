import type {
  AgentRecord,
  CapabilityGrant,
  MediaExtractRequest,
  MediaOperationReceipt,
  ReportRecord,
  RuntimeArtifact,
  SpawnRejection,
  SpawnRequestInput,
  TaskRecord,
  TaskStatus,
} from "./model.ts";

export type RuntimeProducerKind = "scheduler" | "registry" | "artifact_store" | "media_host" | "handoff_host";

export interface RuntimeEventBase {
  schema: "studio.runtime.event.v1";
  runId: string;
  seq: number;
  eventId: string;
  recordedAt: string;
  producer: { kind: RuntimeProducerKind; id: string };
  causationId: string | null;
  correlationId: string | null;
}

export interface ArtifactRecordedEvent extends RuntimeEventBase {
  type: "artifact.recorded";
  data: { artifact: RuntimeArtifact };
}

export interface TaskCreatedEvent extends RuntimeEventBase {
  type: "task.created";
  data: { task: TaskRecord };
}

export interface SpawnRequestedEvent extends RuntimeEventBase {
  type: "spawn.requested";
  data: {
    requestId: string;
    requestedByTaskId: string;
    requestedByAgentId: string;
    input: SpawnRequestInput;
  };
}

export interface SpawnDecidedEvent extends RuntimeEventBase {
  type: "spawn.decided";
  data: {
    requestId: string;
    accepted: boolean;
    rejection: SpawnRejection | null;
    taskId: string | null;
    agentId: string | null;
    grants: CapabilityGrant[];
  };
}

export interface AgentRegisteredEvent extends RuntimeEventBase {
  type: "agent.registered";
  data: { agent: AgentRecord };
}

export interface TaskTransitionedEvent extends RuntimeEventBase {
  type: "task.transitioned";
  data: { taskId: string; agentId: string; status: TaskStatus; reason: string | null };
}

export interface MediaOperationStartedEvent extends RuntimeEventBase {
  type: "media.operation_started";
  data: { request: MediaExtractRequest; grantId: string };
}

export interface MediaOperationCompletedEvent extends RuntimeEventBase {
  type: "media.operation_completed";
  data: {
    operationId: string;
    outputArtifactId: string;
    receipt: MediaOperationReceipt;
  };
}

export interface MediaOperationFailedEvent extends RuntimeEventBase {
  type: "media.operation_failed";
  data: { operationId: string; reason: string };
}

export interface ReportSubmittedEvent extends RuntimeEventBase {
  type: "report.submitted";
  data: { report: ReportRecord };
}

export interface ReportDecidedEvent extends RuntimeEventBase {
  type: "report.decided";
  data: {
    reportId: string;
    decidedByTaskId: string;
    decidedByAgentId: string;
    accepted: boolean;
    reason: string;
  };
}

export type RuntimeEvent =
  | ArtifactRecordedEvent
  | TaskCreatedEvent
  | SpawnRequestedEvent
  | SpawnDecidedEvent
  | AgentRegisteredEvent
  | TaskTransitionedEvent
  | MediaOperationStartedEvent
  | MediaOperationCompletedEvent
  | MediaOperationFailedEvent
  | ReportSubmittedEvent
  | ReportDecidedEvent;

export type PendingRuntimeEvent = RuntimeEvent extends infer Event
  ? Event extends RuntimeEvent
    ? Pick<Event, "type" | "data">
    : never
  : never;
