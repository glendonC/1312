import type {
  ExecutorFailureCode,
  ExecutorFailureRetryability,
  RuntimeBudget,
} from "../model.ts";

export interface ProductionStudioExecutorFailureClassificationView {
  schema: "studio.executor-failure-classification.receipt.v1";
  receiptId: string;
  contentId: string;
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

export interface ProductionStudioAgentRecoveryView {
  workId: string;
  state: "authorized" | "replacement_reported" | "exhausted";
  authorization: {
    schema: "studio.agent-recovery-authorization.receipt.v1";
    receiptId: string;
    contentId: string;
    policy: {
      policyId: string;
      scope: "generalized_initial_coverage";
      maxAttemptsPerWork: 2;
      maxReplacementsPerRun: 2;
      baselineBudget: RuntimeBudget;
      recoveryContingency: RuntimeBudget;
      replacementBudget: RuntimeBudget;
      nonClaims: {
        success: "not_predicted";
        quality: "not_assessed";
        cost: "allocation_ceiling_only";
      };
    };
    parent: { taskId: string; agentId: string; executionId: string };
    work: {
      contractFingerprint: string;
      initialSpawnRequestId: string;
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
  };
  terminal: null | {
    schema: "studio.agent-recovery-terminal.receipt.v1";
    receiptId: string;
    contentId: string;
    outcome: "replacement_reported" | "exhausted";
    replacementExecutionId: string;
    replacementReportId: string | null;
    attemptsConsumed: 2;
    remainingAttempts: 0;
    authorizedAllocation: RuntimeBudget;
    reason: string;
    nonClaims: {
      correctness: "not_assessed";
      semanticQuality: "not_assessed";
      bestOfK: "not_performed";
    };
  };
}
