import type {
  AgentRecord,
  CaptionExecutorDescriptor,
  CaptionProductionArtifact,
  CaptionProductionReceipt,
  CaptionProductionRequest,
  Capability,
  CapabilityGrant,
  EvidenceAssessmentReceipt,
  EvidenceAssessmentRequest,
  EvidenceDecisionReceipt,
  EvidenceDecisionRequest,
  EvidenceDecisionReceiptIdentity,
  ExecutorSpanReceipt,
  EvidenceReadReceipt,
  EvidenceReadRequest,
  MediaOperationRequest,
  MediaOperationReceipt,
  ModelUsageReceipt,
  PublishReviewDecisionReceipt,
  PublishReviewDecisionRequest,
  PublishReviewIntakeReceipt,
  PublishReviewRevocationReceipt,
  PublishReviewRevocationRequest,
  ReportRecord,
  RuntimeArtifact,
  SpawnRejection,
  SpawnRequestInput,
  TaskRecord,
  TaskStatus,
} from "./model.ts";

export type RuntimeProducerKind =
  | "scheduler"
  | "registry"
  | "artifact_store"
  | "media_host"
  | "evidence_host"
  | "assessment_host"
  | "decision_host"
  | "publish_review_intake_host"
  | "publish_review_host"
  | "caption_production_host"
  | "handoff_host"
  | "launcher";

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

export interface ExecutorStartedEvent extends RuntimeEventBase {
  type: "executor.started";
  data: {
    executionId: string;
    taskId: string;
    agentId: string;
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

export interface EvidenceReadStartedEvent extends RuntimeEventBase {
  type: "evidence.read_started";
  data: {
    request: EvidenceReadRequest;
    grantId: string;
    evidenceKind: EvidenceReadReceipt["input"]["evidenceKind"];
    sourceArtifactId: string;
    startMs: number;
    endMs: number;
    maxBytes: number;
    maxItems: number;
  };
}

export interface EvidenceReadCompletedEvent extends RuntimeEventBase {
  type: "evidence.read_completed";
  data: { operationId: string; receiptContentId: string; receipt: EvidenceReadReceipt };
}

export interface EvidenceReadFailedEvent extends RuntimeEventBase {
  type: "evidence.read_failed";
  data: { operationId: string; reason: string };
}

export interface EvidenceAssessmentStartedEvent extends RuntimeEventBase {
  type: "analysis.evidence.assessment_started";
  data: {
    request: EvidenceAssessmentRequest;
    grantId: string;
    maxReadReceipts: number;
    maxClaims: number;
    maxCitations: number;
    maxTokens: number;
  };
}

export interface EvidenceAssessmentCompletedEvent extends RuntimeEventBase {
  type: "analysis.evidence.assessment_completed";
  data: {
    operationId: string;
    outputArtifactId: string;
    receiptContentId: string;
    receipt: EvidenceAssessmentReceipt;
  };
}

export interface EvidenceAssessmentFailedEvent extends RuntimeEventBase {
  type: "analysis.evidence.assessment_failed";
  data: { operationId: string; reason: string };
}

export interface EvidenceDecisionStartedEvent extends RuntimeEventBase {
  type: "analysis.evidence.decision_started";
  data: { request: EvidenceDecisionRequest; grantId: string; maxAuditedAssessments: number };
}

export interface EvidenceDecisionCompletedEvent extends RuntimeEventBase {
  type: "analysis.evidence.decision_completed";
  data: {
    operationId: string;
    outputArtifactId: string;
    receiptContentId: string;
    receipt: EvidenceDecisionReceipt;
  };
}

export interface EvidenceDecisionFailedEvent extends RuntimeEventBase {
  type: "analysis.evidence.decision_failed";
  data: { operationId: string; reason: string };
}

export interface PublishReviewIntakeStartedEvent extends RuntimeEventBase {
  type: "publish.review.intake_started";
  data: { intakeId: string; decision: EvidenceDecisionReceiptIdentity };
}

export interface PublishReviewIntakeCompletedEvent extends RuntimeEventBase {
  type: "publish.review.intake_completed";
  data: {
    intakeId: string;
    outputArtifactId: string;
    receiptContentId: string;
    receipt: PublishReviewIntakeReceipt;
  };
}

export interface PublishReviewIntakeFailedEvent extends RuntimeEventBase {
  type: "publish.review.intake_failed";
  data: { intakeId: string; reason: string };
}

export interface PublishReviewDecisionStartedEvent extends RuntimeEventBase {
  type: "publish.review.decision_started";
  data: {
    reviewId: string;
    request: PublishReviewDecisionRequest;
    reviewerLabel: string;
  };
}

export interface PublishReviewDecisionCompletedEvent extends RuntimeEventBase {
  type: "publish.review.decision_completed";
  data: {
    reviewId: string;
    outputArtifactId: string;
    receiptContentId: string;
    receipt: PublishReviewDecisionReceipt;
  };
}

export interface PublishReviewDecisionFailedEvent extends RuntimeEventBase {
  type: "publish.review.decision_failed";
  data: { reviewId: string; reason: string };
}

export interface PublishReviewRevocationStartedEvent extends RuntimeEventBase {
  type: "publish.review.revocation_started";
  data: {
    revocationId: string;
    request: PublishReviewRevocationRequest;
    reviewerLabel: string;
  };
}

export interface PublishReviewRevocationCompletedEvent extends RuntimeEventBase {
  type: "publish.review.revocation_completed";
  data: {
    revocationId: string;
    outputArtifactId: string;
    receiptContentId: string;
    receipt: PublishReviewRevocationReceipt;
  };
}

export interface PublishReviewRevocationFailedEvent extends RuntimeEventBase {
  type: "publish.review.revocation_failed";
  data: { revocationId: string; reason: string };
}

export interface CaptionProductionStartedEvent extends RuntimeEventBase {
  type: "caption.production_started";
  data: {
    jobId: string;
    request: CaptionProductionRequest;
    input: CaptionProductionArtifact["input"];
    limits: CaptionProductionReceipt["limits"];
    executor: CaptionExecutorDescriptor;
  };
}

export interface CaptionProductionCompletedEvent extends RuntimeEventBase {
  type: "caption.production_completed";
  data: {
    jobId: string;
    captionArtifactId: string;
    captionContentId: string;
    receiptArtifactId: string;
    receiptContentId: string;
    receipt: CaptionProductionReceipt;
  };
}

export interface CaptionProductionFailedEvent extends RuntimeEventBase {
  type: "caption.production_failed";
  data: { jobId: string; reason: string };
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
  | ExecutorStartedEvent
  | ModelUsageRecordedEvent
  | ExecutorFinishedEvent
  | MediaOperationStartedEvent
  | MediaOperationCompletedEvent
  | MediaOperationFailedEvent
  | EvidenceReadStartedEvent
  | EvidenceReadCompletedEvent
  | EvidenceReadFailedEvent
  | EvidenceAssessmentStartedEvent
  | EvidenceAssessmentCompletedEvent
  | EvidenceAssessmentFailedEvent
  | EvidenceDecisionStartedEvent
  | EvidenceDecisionCompletedEvent
  | EvidenceDecisionFailedEvent
  | PublishReviewIntakeStartedEvent
  | PublishReviewIntakeCompletedEvent
  | PublishReviewIntakeFailedEvent
  | PublishReviewDecisionStartedEvent
  | PublishReviewDecisionCompletedEvent
  | PublishReviewDecisionFailedEvent
  | PublishReviewRevocationStartedEvent
  | PublishReviewRevocationCompletedEvent
  | PublishReviewRevocationFailedEvent
  | CaptionProductionStartedEvent
  | CaptionProductionCompletedEvent
  | CaptionProductionFailedEvent
  | ReportSubmittedEvent
  | ReportDecidedEvent;

export type PendingRuntimeEvent = RuntimeEvent extends infer Event
  ? Event extends RuntimeEvent
    ? Pick<Event, "type" | "data">
    : never
  : never;
