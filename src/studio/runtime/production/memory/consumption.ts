import { memoryContentId } from "./contentIdentity.ts";
import {
  MEMORY_REVIEW_SCHEMAS,
  type ConsumeMemoryRequest,
  type ConsumedMemorySnapshot,
  type MemoryConsumptionReceipt,
} from "./model.ts";
import { inspectMemoryReviewArtifacts } from "./reviewInspection.ts";
import { memoryInspectionFailure, parseConsumeMemoryRequest } from "./validation.ts";

/**
 * The only boundary in this slice that returns accepted cross-run values. It validates the
 * complete selected receipt chain and waits for the exact run/snapshot binding to be durably
 * recorded before exposing entries. No production run calls this yet, so current consumption is
 * honestly unavailable rather than inferred from a materialization's existence.
 */
export async function consumeAcceptedMemorySnapshotForRun(
  artifacts: readonly unknown[],
  requestValue: ConsumeMemoryRequest,
  record: (receipt: MemoryConsumptionReceipt) => Promise<void>,
): Promise<ConsumedMemorySnapshot> {
  if (typeof record !== "function") memoryInspectionFailure("consumption recorder", "is required");
  const { runId, materializationId, consumedAt } = parseConsumeMemoryRequest(requestValue);
  const inspection = await inspectMemoryReviewArtifacts(artifacts);
  if (inspection.consumptions.some((item) => item.runId === runId)) {
    memoryInspectionFailure("consumption request.runId", "already has a selected memory consumption receipt");
  }
  const snapshot = inspection.materializations.find((item) => item.materializationId === materializationId);
  if (!snapshot) {
    memoryInspectionFailure(
      "consumption request.materializationId",
      "is not a validated selected materialization",
    );
  }
  const body = {
    schema: MEMORY_REVIEW_SCHEMAS.consumption,
    run_id: runId,
    consumed_at: consumedAt,
    snapshot: {
      materialization_id: snapshot.materializationId,
      snapshot_content_id: snapshot.snapshotContentId,
      materialization_receipt_content_id: snapshot.receiptContentId,
      entry_count: snapshot.entries.length,
    },
    policy: {
      promotion: "reviewed_materialization_only" as const,
      legacy_unreviewed: "excluded" as const,
      unavailable: "fail_closed" as const,
    },
  };
  const receipt: MemoryConsumptionReceipt = {
    consumption_id: `memory-consumption:${await memoryContentId(body)}`,
    ...body,
  };
  await record(structuredClone(receipt));
  return { receipt, entries: structuredClone(snapshot.entries) };
}
