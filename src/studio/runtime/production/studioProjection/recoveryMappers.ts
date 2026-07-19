import type { RuntimeProjection } from "../model.ts";
import type {
  ProductionStudioAgentRecoveryView,
  ProductionStudioExecutorFailureClassificationView,
} from "./recoveryViews.ts";

export function projectExecutorFailureClassifications(
  state: RuntimeProjection,
): ProductionStudioExecutorFailureClassificationView[] {
  return Object.values(state.executorFailureClassifications)
    .map((receipt) => structuredClone(receipt))
    .sort((left, right) => left.receiptId.localeCompare(right.receiptId));
}

export function projectAgentRecoveries(state: RuntimeProjection): ProductionStudioAgentRecoveryView[] {
  return Object.values(state.agentRecoveries)
    .map((record): ProductionStudioAgentRecoveryView => {
      const authorization = record.authorization;
      const classification = state.executorFailureClassifications[
        authorization.failedAttempt.failureClassificationReceiptId
      ];
      if (
        !classification ||
        classification.taskId !== authorization.failedAttempt.taskId ||
        classification.agentId !== authorization.failedAttempt.agentId ||
        classification.executionId !== authorization.failedAttempt.executionId ||
        classification.executorReceiptId !== authorization.failedAttempt.executorReceiptId ||
        classification.code !== authorization.failedAttempt.failureCode ||
        classification.retryability !== "replaceable"
      ) {
        throw new Error(
          `Production Studio projection: recovery ${record.workId} has no exact replaceable failure classification`,
        );
      }
      if (record.workId !== authorization.work.workId) {
        throw new Error(
          `Production Studio projection: recovery record ${record.workId} changed authorization work identity`,
        );
      }

      const terminal = record.terminal;
      if (
        terminal &&
        (terminal.workId !== record.workId ||
          terminal.authorizationReceiptId !== authorization.receiptId ||
          terminal.failedAttemptId !== authorization.failedAttempt.attemptId ||
          terminal.replacementAttemptId !== authorization.replacement.attemptId ||
          terminal.replacementTaskId !== authorization.replacement.taskId)
      ) {
        throw new Error(
          `Production Studio projection: recovery ${record.workId} changed terminal attempt lineage`,
        );
      }

      return {
        workId: record.workId,
        state: terminal?.outcome ?? "authorized",
        authorization: {
          schema: authorization.schema,
          receiptId: authorization.receiptId,
          contentId: authorization.contentId,
          policy: {
            policyId: authorization.policy.policyId,
            scope: authorization.policy.scope,
            maxAttemptsPerWork: authorization.policy.maxAttemptsPerWork,
            maxReplacementsPerRun: authorization.policy.maxReplacementsPerRun,
            baselineBudget: structuredClone(authorization.policy.baselineBudget),
            recoveryContingency: structuredClone(authorization.policy.recoveryContingency),
            replacementBudget: structuredClone(authorization.policy.replacementBudget),
            nonClaims: structuredClone(authorization.policy.nonClaims),
          },
          parent: structuredClone(authorization.parent),
          work: {
            contractFingerprint: authorization.work.contractFingerprint,
            initialSpawnRequestId: authorization.work.initialSpawnRequestId,
            jobContextId: authorization.work.jobContextId,
          },
          failedAttempt: structuredClone(authorization.failedAttempt),
          replacement: structuredClone(authorization.replacement),
          reservedSpend: structuredClone(authorization.reservedSpend),
          nonClaims: structuredClone(authorization.nonClaims),
        },
        terminal: terminal
          ? {
              schema: terminal.schema,
              receiptId: terminal.receiptId,
              contentId: terminal.contentId,
              outcome: terminal.outcome,
              replacementExecutionId: terminal.replacementExecutionId,
              replacementReportId: terminal.replacementReportId,
              attemptsConsumed: terminal.attemptsConsumed,
              remainingAttempts: terminal.remainingAttempts,
              authorizedAllocation: structuredClone(terminal.authorizedAllocation),
              reason: terminal.reason,
              nonClaims: structuredClone(terminal.nonClaims),
            }
          : null,
      };
    })
    .sort((left, right) => left.workId.localeCompare(right.workId));
}
