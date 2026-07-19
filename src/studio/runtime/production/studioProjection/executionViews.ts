import type {
  Capability,
  EvidenceAssessmentScope,
  EvidenceDecisionScope,
  EvidenceKind,
  EvidenceReadScope,
  MediaScope,
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
    /**
     * Host-injected reviewed memory after a durable consumption receipt.
     * Null means unavailable for this task; never infer from materialization alone.
     * Entry values are omitted; keys and receipt identities are enough for product facts.
     */
    reviewedMemory: null | {
      consumptionId: string;
      materializationId: string;
      snapshotContentId: string;
      materializationReceiptContentId: string;
      entryCount: number;
      policy: {
        promotion: "reviewed_materialization_only";
        legacy_unreviewed: "excluded";
        unavailable: "fail_closed";
      };
      entries: Array<{
        namespace: string;
        kind: "glossary" | "correction" | "rule";
        key: string;
        proposalId: string;
        decisionId: string;
      }>;
    };
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
