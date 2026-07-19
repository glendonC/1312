import type { RuntimeProjection } from "../model.ts";
import type { RuntimeEvent } from "../protocol.ts";
import {
  initialCoverageRecoveryBasis,
  recoveryAttemptId,
  replacementWorkloadKey,
} from "../recovery/agentRecoveryIdentity.ts";
import {
  RETRYABLE_INITIAL_COVERAGE_FAILURES,
  validateAgentRecoveryPolicyIdentity,
} from "../recovery/agentRecoveryPolicy.ts";
import { invariant } from "./shared.ts";

function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function applyAgentRecoveryEvent(next: RuntimeProjection, event: RuntimeEvent): boolean {
  if (event.type === "executor.failure_classified") {
    invariant(event.producer.kind === "launcher", event, "executor failure classification must come from the launcher");
    const receipt = event.data.receipt;
    const execution = next.executions[receipt.executionId];
    invariant(execution?.receipt && (execution.status === "failed" || execution.status === "timed_out"), event, `failure classification ${receipt.receiptId} has no terminal failed executor`);
    invariant(
      execution.taskId === receipt.taskId && execution.agentId === receipt.agentId &&
        execution.receipt.receiptId === receipt.executorReceiptId &&
        execution.receipt.failure === receipt.safeReason &&
        ((execution.status === "timed_out") === (receipt.code === "executor_timed_out")) &&
        receipt.retryability === (new Set<string>(RETRYABLE_INITIAL_COVERAGE_FAILURES).has(receipt.code) ? "replaceable" : "terminal"),
      event,
      `failure classification ${receipt.receiptId} changed executor ownership, reason, outcome, or retryability`,
    );
    invariant(!next.executorFailureClassifications[receipt.receiptId], event, `failure classification ${receipt.receiptId} is duplicated`);
    invariant(!Object.values(next.executorFailureClassifications).some((entry) => entry.executionId === execution.id), event, `execution ${execution.id} was classified twice`);
    next.executorFailureClassifications[receipt.receiptId] = structuredClone(receipt);
    return true;
  }

  if (event.type === "agent.recovery_authorized") {
    invariant(event.producer.kind === "scheduler", event, "agent recovery authorization must come from the scheduler");
    const receipt = event.data.receipt;
    invariant(validateAgentRecoveryPolicyIdentity(receipt.policy), event, `recovery ${receipt.work.workId} changed policy identity`);
    const basis = initialCoverageRecoveryBasis(next, receipt.policy, receipt.parent.executionId, receipt.failedAttempt.taskId);
    invariant(basis, event, `recovery ${receipt.work.workId} has no exact retryable generalized initial-coverage basis`);
    invariant(
      receipt.runId === next.runId && receipt.parent.taskId === basis.root.id &&
        receipt.parent.agentId === basis.root.ownerAgentId && receipt.parent.executionId === basis.rootExecution.id &&
        receipt.work.workId === basis.workId && receipt.work.contractFingerprint === basis.contractFingerprint &&
        receipt.work.initialSpawnRequestId === basis.request.id && receipt.work.jobContextId === basis.task.jobContext.contextId &&
        same(receipt.work.initialInput, basis.request.input) &&
        receipt.failedAttempt.attemptId === recoveryAttemptId(basis.workId, 0) &&
        receipt.failedAttempt.taskId === basis.task.id && receipt.failedAttempt.agentId === basis.task.assignedAgentId &&
        receipt.failedAttempt.executionId === basis.execution.id && receipt.failedAttempt.executorReceiptId === basis.execution.receipt?.receiptId &&
        receipt.failedAttempt.failureClassificationReceiptId === basis.classification.receiptId &&
        receipt.failedAttempt.failureCode === basis.classification.code &&
        receipt.replacement.attemptId === recoveryAttemptId(basis.workId, 1) &&
        receipt.replacement.workloadKey === replacementWorkloadKey(basis.workId) &&
        same(receipt.reservedSpend, receipt.policy.replacementBudget),
      event,
      `recovery ${receipt.work.workId} changed work, failure, replacement, or budget authority`,
    );
    invariant(!next.agentRecoveries[receipt.work.workId], event, `recovery work ${receipt.work.workId} is duplicated`);
    invariant(!Object.values(next.agentRecoveries).some((entry) => entry.authorization.failedAttempt.taskId === basis.task.id), event, `failed task ${basis.task.id} already has recovery authority`);
    invariant(!next.tasks[receipt.replacement.taskId] && !next.agents[receipt.replacement.agentId], event, `recovery ${receipt.work.workId} reused replacement ownership`);
    const authorized = Object.values(next.agentRecoveries).map((entry) => entry.authorization.reservedSpend).reduce(
      (sum, budget) => ({ wallMs: sum.wallMs + budget.wallMs, toolCalls: sum.toolCalls + budget.toolCalls }),
      { wallMs: receipt.reservedSpend.wallMs, toolCalls: receipt.reservedSpend.toolCalls },
    );
    invariant(
      authorized.wallMs <= receipt.policy.recoveryContingency.wallMs &&
        authorized.toolCalls <= receipt.policy.recoveryContingency.toolCalls &&
        Object.keys(next.agentRecoveries).length < receipt.policy.maxReplacementsPerRun,
      event,
      `recovery ${receipt.work.workId} escaped the contingency ceiling`,
    );
    next.agentRecoveries[receipt.work.workId] = {
      workId: receipt.work.workId,
      authorization: structuredClone(receipt),
      terminal: null,
    };
    return true;
  }

  if (event.type === "agent.recovery_terminal_recorded") {
    invariant(event.producer.kind === "recovery_host", event, "agent recovery terminal evidence must come from the recovery host");
    const receipt = event.data.receipt;
    const recovery = next.agentRecoveries[receipt.workId];
    invariant(recovery && recovery.terminal === null, event, `recovery ${receipt.workId} is unknown or already terminal`);
    const authorization = recovery.authorization;
    const task = next.tasks[authorization.replacement.taskId];
    const execution = Object.values(next.executions).find((entry) => entry.taskId === task?.id);
    const report = Object.values(next.reports).find((entry) => entry.taskId === task?.id) ?? null;
    const reported = task?.status === "reported" || task?.status === "completed";
    const exhausted = task?.status === "failed" || task?.status === "withheld" || task?.status === "interrupted";
    invariant(
      receipt.runId === next.runId && receipt.policyId === authorization.policy.policyId &&
        receipt.authorizationReceiptId === authorization.receiptId &&
        receipt.failedAttemptId === authorization.failedAttempt.attemptId &&
        receipt.replacementAttemptId === authorization.replacement.attemptId &&
        receipt.replacementTaskId === authorization.replacement.taskId &&
        receipt.replacementExecutionId === execution?.id && same(receipt.authorizedAllocation, authorization.reservedSpend) &&
        ((receipt.outcome === "replacement_reported" && reported && report?.id === receipt.replacementReportId) ||
          (receipt.outcome === "exhausted" && exhausted && report === null && receipt.replacementReportId === null)),
      event,
      `recovery ${receipt.workId} changed replacement terminal lineage or selected among reports`,
    );
    recovery.terminal = structuredClone(receipt);
    return true;
  }

  return false;
}
