import type {
  AgentRecord,
  Capability,
  CapabilityGrant,
  ExecutorSpanReceipt,
  MediaOperationRequest,
  MediaOperationReceipt,
  ModelUsageReceipt,
  OrchestratorDecisionRecord,
  ReportRecord,
  RuntimeArtifact,
  SpawnRejection,
  SpawnRequestInput,
  TaskLaunchRecord,
  TaskRecord,
  TaskStatus,
  TerminalChildIdentity,
} from "../model.ts";
import type { RuntimeEventBase } from "./base.ts";

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
    authoredByExecutionId: string | null;
    toolCallId: string | null;
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

export interface TaskLaunchClaimedEvent extends RuntimeEventBase {
  type: "task.launch_claimed";
  data: { claim: TaskLaunchRecord };
}

export interface OrchestratorToolCalledEvent extends RuntimeEventBase {
  type: "orchestrator.tool_called";
  data: {
    callId: string;
    executionId: string;
    taskId: string;
    tool:
      | "task_spawn_request"
      | "task_reports_wait"
      | "report_disposition"
      | "artifact_read"
      | "study_planning_decision"
      | "study_restudy_request"
      | "study_separation_request"
      | "study_research_request"
      | "study_computer_use_request"
      | "study_synthesize";
  };
}

export interface ReportsWaitStartedEvent extends RuntimeEventBase {
  type: "reports.wait_started";
  data: { waitId: string; executionId: string; parentTaskId: string };
}

export interface ReportsWaitReturnedEvent extends RuntimeEventBase {
  type: "reports.wait_returned";
  data: {
    waitId: string;
    result: "all_terminal" | "closed_failure";
    failure: "no_children" | "child_interrupted" | "child_failed" | null;
    children: TerminalChildIdentity[];
  };
}

export interface OrchestratorDecisionRecordedEvent extends RuntimeEventBase {
  type: "orchestrator.decision_recorded";
  data: { decision: OrchestratorDecisionRecord };
}

export interface RuntimeInterruptedEvent extends RuntimeEventBase {
  type: "runtime.interrupted";
  data: { reason: string; taskIds: string[]; executionIds: string[] };
}

export interface TaskTransitionedEvent extends RuntimeEventBase {
  type: "task.transitioned";
  data: { taskId: string; agentId: string; status: TaskStatus; reason: string | null };
}

export interface ExecutorStartedEvent extends RuntimeEventBase {
  type: "executor.started";
  data: {
    executionId: string;
    taskId: string;
    agentId: string;
    launchClaimId: string;
    startedAt: string;
  };
}

export interface ModelUsageRecordedEvent extends RuntimeEventBase {
  type: "model.usage_recorded";
  data: { receipt: ModelUsageReceipt };
}

export interface ExecutorFinishedEvent extends RuntimeEventBase {
  type: "executor.finished";
  data: { receipt: ExecutorSpanReceipt };
}

export interface MediaOperationStartedEvent extends RuntimeEventBase {
  type: "media.operation_started";
  data: {
    capability: Extract<Capability, "media.extract" | "media.seek">;
    request: MediaOperationRequest;
    grantId: string;
  };
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
