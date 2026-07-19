import type { RuntimeBudget, SpawnRequestInput } from "./tasks.ts";

export const EXECUTOR_FAILURE_CODES = [
  "process_failed",
  "executor_timed_out",
  "required_tool_omitted",
  "invalid_structured_output",
  "provider_transport_failed",
  "authorization_failed",
  "configuration_failed",
  "output_limit_exceeded",
  "authority_violation",
  "report_handoff_rejected",
  "host_interrupted",
  "unknown_failure",
] as const;

export type ExecutorFailureCode = (typeof EXECUTOR_FAILURE_CODES)[number];
export type ExecutorFailureRetryability = "replaceable" | "terminal";

export interface AgentRecoveryPolicyContract {
  schema: "studio.agent-recovery-policy.v1";
  policyId: string;
  scope: "generalized_initial_coverage";
  maxAttemptsPerWork: 2;
  maxReplacementsPerRun: 2;
  baselineBudget: RuntimeBudget;
  recoveryContingency: RuntimeBudget;
  replacementBudget: RuntimeBudget;
  retryableFailureCodes: ExecutorFailureCode[];
  nonClaims: {
    success: "not_predicted";
    quality: "not_assessed";
    cost: "allocation_ceiling_only";
  };
}

export interface ExecutorFailureClassificationReceipt {
  schema: "studio.executor-failure-classification.receipt.v1";
  receiptId: string;
  contentId: string;
  runId: string;
  taskId: string;
  agentId: string;
  executionId: string;
  executorReceiptId: string;
  code: ExecutorFailureCode;
  retryability: ExecutorFailureRetryability;
  safeReason: string;
  producer: {
    id: "studio.executor-failure-classifier";
    version: "1";
    policy: "typed_execution_faults_only_no_evidence_quality_retry";
  };
}

export interface AgentRecoveryAuthorizationReceipt {
  schema: "studio.agent-recovery-authorization.receipt.v1";
  receiptId: string;
  contentId: string;
  runId: string;
  policy: AgentRecoveryPolicyContract;
  parent: { taskId: string; agentId: string; executionId: string };
  work: {
    workId: string;
    contractFingerprint: string;
    initialSpawnRequestId: string;
    initialInput: SpawnRequestInput;
    jobContextId: string;
  };
  failedAttempt: {
    attemptId: string;
    ordinal: 0;
    taskId: string;
    agentId: string;
    executionId: string;
    executorReceiptId: string;
    failureClassificationReceiptId: string;
    failureCode: ExecutorFailureCode;
  };
  replacement: {
    attemptId: string;
    ordinal: 1;
    spawnRequestId: string;
    taskId: string;
    agentId: string;
    workloadKey: string;
  };
  reservedSpend: RuntimeBudget;
  nonClaims: {
    outcome: "not_known_at_authorization";
    semanticPreference: "not_used";
    quality: "not_assessed";
  };
}

export interface AgentRecoveryTerminalReceipt {
  schema: "studio.agent-recovery-terminal.receipt.v1";
  receiptId: string;
  contentId: string;
  runId: string;
  policyId: string;
  workId: string;
  authorizationReceiptId: string;
  failedAttemptId: string;
  replacementAttemptId: string;
  replacementTaskId: string;
  replacementExecutionId: string;
  replacementReportId: string | null;
  outcome: "replacement_reported" | "exhausted";
  attemptsConsumed: 2;
  remainingAttempts: 0;
  authorizedAllocation: RuntimeBudget;
  reason: string;
  nonClaims: {
    correctness: "not_assessed";
    semanticQuality: "not_assessed";
    bestOfK: "not_performed";
  };
}

export interface AgentRecoveryRecord {
  workId: string;
  authorization: AgentRecoveryAuthorizationReceipt;
  terminal: AgentRecoveryTerminalReceipt | null;
}
