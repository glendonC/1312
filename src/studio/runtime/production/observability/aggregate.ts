import type {
  IndexedExecution,
  IndexedMediaOperation,
  ObservabilityAggregate,
  RuntimeObservabilityIndex,
} from "./model.ts";

function nullableSum(values: Array<number | null>): number | null {
  const measured = values.filter((value): value is number => value !== null);
  return measured.length === 0 ? null : measured.reduce((total, value) => total + value, 0);
}

export function aggregateObservability(
  records: RuntimeObservabilityIndex["records"],
): ObservabilityAggregate {
  const executions: IndexedExecution[] = records.executions;
  const operations: IndexedMediaOperation[] = records.operations;
  return {
    counts: {
      tasks: records.tasks.length,
      agents: records.agents.length,
      operations: operations.length,
      executions: executions.length,
      handoffs: records.handoffs.length,
      failures: records.failures.length,
    },
    measured: {
      mediaRequestedDurationMs: operations.reduce(
        (total, operation) => total + operation.requestedDurationMs,
        0,
      ),
      activeDurationMs: nullableSum(executions.map((execution) => execution.activeDurationMs)),
      inputTokens: nullableSum(executions.map((execution) => execution.tokens?.inputTokens ?? null)),
      cachedInputTokens: nullableSum(
        executions.map((execution) => execution.tokens?.cachedInputTokens ?? null),
      ),
      outputTokens: nullableSum(executions.map((execution) => execution.tokens?.outputTokens ?? null)),
      reasoningOutputTokens: nullableSum(
        executions.map((execution) => execution.tokens?.reasoningOutputTokens ?? null),
      ),
    },
    coverage: {
      activeExecutionsMeasured: executions.filter((execution) => execution.activeDurationMs !== null).length,
      usageExecutionsMeasured: executions.filter((execution) => execution.tokens !== null).length,
      totalExecutions: executions.length,
    },
    unavailable: {
      queueDurationMs: null,
      dependencyWaitDurationMs: null,
      reportingDurationMs: null,
      criticalPathDurationMs: null,
      providerUnits: null,
      billing: { amount: null, currency: null },
    },
  };
}
