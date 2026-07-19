import type {
  AgentRecoveryAuthorizationReceipt,
  AgentRecoveryTerminalReceipt,
  ExecutorFailureClassificationReceipt,
} from "../model.ts";
import { EXECUTOR_FAILURE_CODES } from "../model.ts";
import {
  validateFailureClassificationIdentity,
  validateRecoveryAuthorizationIdentity,
  validateRecoveryTerminalIdentity,
} from "../recovery/agentRecoveryIdentity.ts";
import { validateAgentRecoveryPolicyIdentity } from "../recovery/agentRecoveryPolicy.ts";
import { assertSpawnRequestInput } from "./scheduling.ts";
import {
  exact,
  fail,
  integer,
  literal,
  nullableString,
  object,
  oneOf,
  string,
} from "./primitives.ts";

const FAILURE_CODES = new Set<string>(EXECUTOR_FAILURE_CODES);

function runtimeBudget(value: unknown, context: string, path: string): void {
  const item = object(value, context, path);
  exact(item, ["wallMs", "toolCalls"], context, path);
  integer(item.wallMs, context, `${path}.wallMs`, 1);
  integer(item.toolCalls, context, `${path}.toolCalls`, 1);
}

function nonClaims(value: unknown, keys: readonly string[], context: string, path: string): Record<string, unknown> {
  const item = object(value, context, path);
  exact(item, keys, context, path);
  return item;
}

export function validateExecutorFailureClassificationReceipt(
  value: unknown,
  context: string,
  path: string,
): asserts value is ExecutorFailureClassificationReceipt {
  const item = object(value, context, path);
  exact(item, ["schema", "receiptId", "contentId", "runId", "taskId", "agentId", "executionId", "executorReceiptId", "code", "retryability", "safeReason", "producer"], context, path);
  literal(item.schema, "studio.executor-failure-classification.receipt.v1", context, `${path}.schema`);
  for (const key of ["receiptId", "contentId", "runId", "taskId", "agentId", "executionId", "executorReceiptId", "safeReason"] as const) {
    string(item[key], context, `${path}.${key}`);
  }
  oneOf(item.code, FAILURE_CODES, context, `${path}.code`);
  oneOf(item.retryability, new Set(["replaceable", "terminal"]), context, `${path}.retryability`);
  const producer = object(item.producer, context, `${path}.producer`);
  exact(producer, ["id", "version", "policy"], context, `${path}.producer`);
  literal(producer.id, "studio.executor-failure-classifier", context, `${path}.producer.id`);
  literal(producer.version, "1", context, `${path}.producer.version`);
  literal(producer.policy, "typed_execution_faults_only_no_evidence_quality_retry", context, `${path}.producer.policy`);
  if (!validateFailureClassificationIdentity(item as unknown as ExecutorFailureClassificationReceipt)) {
    fail(context, path, "changed its content-addressed identity");
  }
}

export function validateAgentRecoveryAuthorizationReceipt(
  value: unknown,
  context: string,
  path: string,
): asserts value is AgentRecoveryAuthorizationReceipt {
  const item = object(value, context, path);
  exact(item, ["schema", "receiptId", "contentId", "runId", "policy", "parent", "work", "failedAttempt", "replacement", "reservedSpend", "nonClaims"], context, path);
  literal(item.schema, "studio.agent-recovery-authorization.receipt.v1", context, `${path}.schema`);
  for (const key of ["receiptId", "contentId", "runId"] as const) string(item[key], context, `${path}.${key}`);
  if (!validateAgentRecoveryPolicyIdentity(item.policy as AgentRecoveryAuthorizationReceipt["policy"])) fail(context, `${path}.policy`, "changed policy identity or ceilings");
  const parent = object(item.parent, context, `${path}.parent`);
  exact(parent, ["taskId", "agentId", "executionId"], context, `${path}.parent`);
  for (const key of ["taskId", "agentId", "executionId"] as const) string(parent[key], context, `${path}.parent.${key}`);
  const work = object(item.work, context, `${path}.work`);
  exact(work, ["workId", "contractFingerprint", "initialSpawnRequestId", "initialInput", "jobContextId"], context, `${path}.work`);
  for (const key of ["workId", "contractFingerprint", "initialSpawnRequestId", "jobContextId"] as const) string(work[key], context, `${path}.work.${key}`);
  assertSpawnRequestInput(work.initialInput, context);
  const failed = object(item.failedAttempt, context, `${path}.failedAttempt`);
  exact(failed, ["attemptId", "ordinal", "taskId", "agentId", "executionId", "executorReceiptId", "failureClassificationReceiptId", "failureCode"], context, `${path}.failedAttempt`);
  if (integer(failed.ordinal, context, `${path}.failedAttempt.ordinal`) !== 0) fail(context, `${path}.failedAttempt.ordinal`, "must be zero");
  for (const key of ["attemptId", "taskId", "agentId", "executionId", "executorReceiptId", "failureClassificationReceiptId"] as const) string(failed[key], context, `${path}.failedAttempt.${key}`);
  oneOf(failed.failureCode, FAILURE_CODES, context, `${path}.failedAttempt.failureCode`);
  const replacement = object(item.replacement, context, `${path}.replacement`);
  exact(replacement, ["attemptId", "ordinal", "spawnRequestId", "taskId", "agentId", "workloadKey"], context, `${path}.replacement`);
  if (integer(replacement.ordinal, context, `${path}.replacement.ordinal`) !== 1) fail(context, `${path}.replacement.ordinal`, "must be one");
  for (const key of ["attemptId", "spawnRequestId", "taskId", "agentId", "workloadKey"] as const) string(replacement[key], context, `${path}.replacement.${key}`);
  runtimeBudget(item.reservedSpend, context, `${path}.reservedSpend`);
  const claims = nonClaims(item.nonClaims, ["outcome", "semanticPreference", "quality"], context, `${path}.nonClaims`);
  literal(claims.outcome, "not_known_at_authorization", context, `${path}.nonClaims.outcome`);
  literal(claims.semanticPreference, "not_used", context, `${path}.nonClaims.semanticPreference`);
  literal(claims.quality, "not_assessed", context, `${path}.nonClaims.quality`);
  if (!validateRecoveryAuthorizationIdentity(item as unknown as AgentRecoveryAuthorizationReceipt)) fail(context, path, "changed its content-addressed identity");
}

export function validateAgentRecoveryTerminalReceipt(
  value: unknown,
  context: string,
  path: string,
): asserts value is AgentRecoveryTerminalReceipt {
  const item = object(value, context, path);
  exact(item, ["schema", "receiptId", "contentId", "runId", "policyId", "workId", "authorizationReceiptId", "failedAttemptId", "replacementAttemptId", "replacementTaskId", "replacementExecutionId", "replacementReportId", "outcome", "attemptsConsumed", "remainingAttempts", "authorizedAllocation", "reason", "nonClaims"], context, path);
  literal(item.schema, "studio.agent-recovery-terminal.receipt.v1", context, `${path}.schema`);
  for (const key of ["receiptId", "contentId", "runId", "policyId", "workId", "authorizationReceiptId", "failedAttemptId", "replacementAttemptId", "replacementTaskId", "replacementExecutionId", "reason"] as const) string(item[key], context, `${path}.${key}`);
  nullableString(item.replacementReportId, context, `${path}.replacementReportId`);
  oneOf(item.outcome, new Set(["replacement_reported", "exhausted"]), context, `${path}.outcome`);
  if (integer(item.attemptsConsumed, context, `${path}.attemptsConsumed`) !== 2) fail(context, `${path}.attemptsConsumed`, "must be two");
  if (integer(item.remainingAttempts, context, `${path}.remainingAttempts`) !== 0) fail(context, `${path}.remainingAttempts`, "must be zero");
  runtimeBudget(item.authorizedAllocation, context, `${path}.authorizedAllocation`);
  const claims = nonClaims(item.nonClaims, ["correctness", "semanticQuality", "bestOfK"], context, `${path}.nonClaims`);
  literal(claims.correctness, "not_assessed", context, `${path}.nonClaims.correctness`);
  literal(claims.semanticQuality, "not_assessed", context, `${path}.nonClaims.semanticQuality`);
  literal(claims.bestOfK, "not_performed", context, `${path}.nonClaims.bestOfK`);
  if (!validateRecoveryTerminalIdentity(item as unknown as AgentRecoveryTerminalReceipt)) fail(context, path, "changed its content-addressed identity");
}
