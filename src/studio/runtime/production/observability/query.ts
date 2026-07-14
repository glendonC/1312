import { aggregateObservability } from "./aggregate.ts";
import { assertRuntimeObservabilityIndex } from "./validation.ts";
import type {
  ObservabilityFilters,
  ObservabilityGroup,
  ObservabilityQueryResult,
  RuntimeObservabilityIndex,
} from "./model.ts";

export interface ObservabilityQueryStore {
  query(filters?: ObservabilityFilters): ObservabilityQueryResult;
}

function selected(values: readonly string[] | undefined): Set<string> | null {
  return values === undefined ? null : new Set(values);
}

function key(runId: string, entityId: string): string {
  return `${runId}\u0000${entityId}`;
}

function groups(values: readonly string[]): ObservabilityGroup[] {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts]
    .map(([groupKey, count]) => ({ key: groupKey, count }))
    .sort((left, right) => left.key.localeCompare(right.key));
}

function uniqueBy<T>(values: readonly T[], identity: (value: T) => string): T[] {
  const result = new Map<string, T>();
  for (const value of values) {
    const id = identity(value);
    if (!result.has(id)) result.set(id, value);
  }
  return [...result.values()];
}

/** In-memory implementation of the query-store boundary; no raw journal text is searchable. */
export class ImmutableObservabilityQueryStore implements ObservabilityQueryStore {
  private readonly indexes: RuntimeObservabilityIndex[];

  constructor(indexes: readonly unknown[]) {
    indexes.forEach(assertRuntimeObservabilityIndex);
    const typed = indexes as readonly RuntimeObservabilityIndex[];
    const runIds = typed.map((index) => index.sourceJournal.runId);
    if (new Set(runIds).size !== runIds.length) {
      throw new Error("Observability query store accepts one immutable index per run");
    }
    this.indexes = structuredClone([...typed]);
  }

  query(filters: ObservabilityFilters = {}): ObservabilityQueryResult {
    const runIds = selected(filters.runIds);
    const taskIds = selected(filters.taskIds);
    const agentIds = selected(filters.agentIds);
    const taskStatuses = selected(filters.taskStatuses);
    const operationCapabilities = selected(filters.operationCapabilities);
    const executionOutcomes = selected(filters.executionOutcomes);
    const failureKinds = selected(filters.failureKinds);
    const includedIndexes = this.indexes.filter(
      (index) => runIds === null || runIds.has(index.sourceJournal.runId),
    );
    const allTasks = includedIndexes.flatMap((index) => index.records.tasks);
    const tasks = allTasks.filter(
      (task) =>
        (taskIds === null || taskIds.has(task.taskId)) &&
        (agentIds === null || agentIds.has(task.assignedAgentId)) &&
        (taskStatuses === null || taskStatuses.has(task.status)),
    );
    const selectedTasks = new Set(tasks.map((task) => key(task.runId, task.taskId)));
    const entityIncluded = (record: { runId: string; taskId: string; agentId: string }): boolean =>
      selectedTasks.has(key(record.runId, record.taskId)) &&
      (agentIds === null || agentIds.has(record.agentId));

    const agents = includedIndexes
      .flatMap((index) => index.records.agents)
      .filter((agent) => entityIncluded(agent));
    const operations = includedIndexes
      .flatMap((index) => index.records.operations)
      .filter(
        (operation) =>
          entityIncluded(operation) &&
          (operationCapabilities === null || operationCapabilities.has(operation.capability)),
      );
    const executions = includedIndexes
      .flatMap((index) => index.records.executions)
      .filter(
        (execution) =>
          entityIncluded(execution) &&
          (executionOutcomes === null || executionOutcomes.has(execution.status)),
      );
    const handoffs = includedIndexes
      .flatMap((index) => index.records.handoffs)
      .filter((handoff) => entityIncluded(handoff));
    const failures = includedIndexes
      .flatMap((index) => index.records.failures)
      .filter(
        (failure) =>
          (failure.taskId === null || selectedTasks.has(key(failure.runId, failure.taskId))) &&
          (agentIds === null || failure.agentId === null || agentIds.has(failure.agentId)) &&
          (failureKinds === null || failureKinds.has(failure.kind)),
      );
    const records = structuredClone({ tasks, agents, operations, executions, handoffs, failures });
    const sourceEvents = includedIndexes.flatMap((index) => index.sources.events);
    const sourceReceipts = includedIndexes.flatMap((index) => index.sources.receipts);
    const sourceArtifacts = includedIndexes.flatMap((index) => index.sources.artifacts);

    return {
      filters: structuredClone(filters),
      sources: {
        events: uniqueBy(sourceEvents, (source) => source.eventId),
        receipts: uniqueBy(sourceReceipts, (source) => source.receiptId),
        artifacts: uniqueBy(sourceArtifacts, (source) => source.artifactId),
      },
      records,
      aggregate: aggregateObservability(records),
      groups: {
        taskStatuses: groups(records.tasks.map((task) => task.status)),
        operationCapabilities: groups(records.operations.map((operation) => operation.capability)),
        executionOutcomes: groups(records.executions.map((execution) => execution.status)),
        failureKinds: groups(records.failures.map((failure) => failure.kind)),
      },
    };
  }
}
