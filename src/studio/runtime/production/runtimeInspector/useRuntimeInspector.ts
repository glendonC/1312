import { useMemo, useState } from "react";

import type { TaskStatus } from "../model.ts";
import { MAX_OBSERVABILITY_JOURNAL_BYTES } from "../observability/indexer.ts";
import type {
  IndexedOperationCapability,
  RuntimeObservabilityIndex,
} from "../observability/model.ts";
import { ImmutableObservabilityQueryStore } from "../observability/query.ts";
import type { ProductionStudioProjection } from "../studioProjection.ts";
import { loadRuntimeInspectorJournal } from "./journalLoader.ts";

export function useRuntimeInspector() {
  const [projection, setProjection] = useState<ProductionStudioProjection | null>(null);
  const [index, setIndex] = useState<RuntimeObservabilityIndex | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filename, setFilename] = useState<string | null>(null);
  const [agentFilter, setAgentFilter] = useState("all");
  const [taskStatusFilter, setTaskStatusFilter] = useState("all");
  const [operationFilter, setOperationFilter] = useState("all");

  const store = useMemo(
    () => (index ? new ImmutableObservabilityQueryStore([index]) : null),
    [index],
  );
  const query = useMemo(() => {
    if (!store) return null;
    return store.query({
      agentIds: agentFilter === "all" ? undefined : [agentFilter],
      taskStatuses:
        taskStatusFilter === "all" ? undefined : [taskStatusFilter as TaskStatus],
      operationCapabilities:
        operationFilter === "all"
          ? undefined
          : [operationFilter as IndexedOperationCapability],
    });
  }, [agentFilter, operationFilter, store, taskStatusFilter]);

  const load = async (file: File | undefined): Promise<void> => {
    setProjection(null);
    setIndex(null);
    setError(null);
    setFilename(file?.name ?? null);
    setAgentFilter("all");
    setTaskStatusFilter("all");
    setOperationFilter("all");
    if (!file) return;
    if (file.size <= 0 || file.size > MAX_OBSERVABILITY_JOURNAL_BYTES) {
      setError("The journal must be non-empty and no larger than 5 MB.");
      return;
    }
    try {
      const loaded = await loadRuntimeInspectorJournal(await file.text());
      setProjection(loaded.projection);
      setIndex(loaded.index);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The production journal could not be validated.");
    }
  };

  return {
    projection,
    index,
    error,
    filename,
    agentFilter,
    setAgentFilter,
    taskStatusFilter,
    setTaskStatusFilter,
    operationFilter,
    setOperationFilter,
    query,
    agentOptions: index?.records.agents.map((agent) => agent.agentId) ?? [],
    taskStatusOptions: [...new Set(index?.records.tasks.map((task) => task.status) ?? [])].sort(),
    operationOptions: [
      ...new Set(index?.records.operations.map((operation) => operation.capability) ?? []),
    ].sort(),
    load,
  };
}
