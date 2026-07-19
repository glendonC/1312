import type {
  ExecutorFailureClassificationReceipt,
  ExecutorFailureCode,
  ExecutorSpanReceipt,
} from "../model.ts";
import { recoveryReceiptIdentity } from "./agentRecoveryIdentity.ts";
import { RETRYABLE_INITIAL_COVERAGE_FAILURES } from "./agentRecoveryPolicy.ts";

export function executorFailureClassificationReceipt(input: {
  runId: string;
  span: ExecutorSpanReceipt;
  code: ExecutorFailureCode;
  safeReason: string;
}): ExecutorFailureClassificationReceipt {
  if (input.span.outcome === "completed" || input.span.failure !== input.safeReason) {
    throw new Error("Failure classification requires one matching unsuccessful executor span");
  }
  const body = {
    runId: input.runId,
    taskId: input.span.taskId,
    agentId: input.span.agentId,
    executionId: input.span.executionId,
    executorReceiptId: input.span.receiptId,
    code: input.code,
    retryability: new Set<ExecutorFailureCode>(RETRYABLE_INITIAL_COVERAGE_FAILURES).has(input.code) ? "replaceable" as const : "terminal" as const,
    safeReason: input.safeReason,
    producer: {
      id: "studio.executor-failure-classifier" as const,
      version: "1" as const,
      policy: "typed_execution_faults_only_no_evidence_quality_retry" as const,
    },
  };
  return {
    schema: "studio.executor-failure-classification.receipt.v1",
    ...recoveryReceiptIdentity("executor-failure-classification", body),
    ...body,
  };
}
