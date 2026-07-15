import { buildRuntimeObservabilityIndex, parseProductionRuntimeJournal } from "../observability/indexer.ts";
import type { RuntimeObservabilityIndex } from "../observability/model.ts";
import {
  projectProductionRuntimeJournal,
  type ProductionStudioProjection,
} from "../studioProjection.ts";

export interface LoadedRuntimeInspectorJournal {
  projection: ProductionStudioProjection;
  index: RuntimeObservabilityIndex;
}

export async function loadRuntimeInspectorJournal(raw: string): Promise<LoadedRuntimeInspectorJournal> {
  const index = await buildRuntimeObservabilityIndex(raw);
  const events = parseProductionRuntimeJournal(raw);
  return {
    projection: projectProductionRuntimeJournal(events),
    index,
  };
}
