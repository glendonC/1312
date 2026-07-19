import { consumeAcceptedMemorySnapshotForRun } from "./consumption.ts";
import type {
  ConsumedMemorySnapshot,
  MemoryConsumptionReceipt,
} from "./model.ts";
import type { ReviewedMemoryJobBinding } from "../model/tasks.ts";

export interface ReviewedMemoryConsumeRequest {
  artifacts: readonly unknown[];
  materializationId: string;
  consumedAt: string;
  record: (receipt: MemoryConsumptionReceipt) => Promise<void>;
}

/** Convert a recorded consumption into path-free root job-context authority. */
export function reviewedMemoryJobBindingFromConsumption(
  consumed: ConsumedMemorySnapshot,
): ReviewedMemoryJobBinding {
  return {
    consumptionId: consumed.receipt.consumption_id,
    materializationId: consumed.receipt.snapshot.materialization_id,
    snapshotContentId: consumed.receipt.snapshot.snapshot_content_id,
    materializationReceiptContentId: consumed.receipt.snapshot.materialization_receipt_content_id,
    entryCount: consumed.receipt.snapshot.entry_count,
    policy: structuredClone(consumed.receipt.policy),
    entries: consumed.entries.map((entry) => ({
      namespace: entry.namespace,
      kind: entry.kind,
      key: entry.key,
      value: structuredClone(entry.value),
      proposalId: entry.proposal_id,
      decisionId: entry.decision_id,
    })),
  };
}

/**
 * Record the consumption receipt for this run, then return the only host binding allowed on
 * root job context. Callers must not expose entries before this resolves.
 */
export async function bindReviewedMemoryForRun(
  runId: string,
  request: ReviewedMemoryConsumeRequest,
): Promise<ReviewedMemoryJobBinding> {
  const consumed = await consumeAcceptedMemorySnapshotForRun(
    request.artifacts,
    {
      runId,
      materializationId: request.materializationId,
      consumedAt: request.consumedAt,
    },
    request.record,
  );
  return reviewedMemoryJobBindingFromConsumption(consumed);
}
