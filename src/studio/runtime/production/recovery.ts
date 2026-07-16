import type { RuntimeLedger } from "./journal.ts";
import type { PendingRuntimeEvent } from "./protocol.ts";

const AMBIGUOUS_TASK_STATES = new Set(["scheduled", "working", "waiting_for_children"]);

/**
 * Close ambiguous process-local work from durable facts. This never relaunches a model turn,
 * completes a report, or fabricates an executor receipt.
 */
export async function interruptAmbiguousRuntime(
  ledger: RuntimeLedger,
  reason = "The host restarted while model execution or an accepted launch remained ambiguous.",
): Promise<boolean> {
  const state = ledger.state();
  const taskIds = Object.values(state.tasks)
    .filter((task) => AMBIGUOUS_TASK_STATES.has(task.status))
    .map((task) => task.id)
    .sort();
  const executionIds = Object.values(state.executions)
    .filter((execution) => execution.status === "active")
    .map((execution) => execution.id)
    .sort();
  if (taskIds.length === 0 && executionIds.length === 0) return false;
  await ledger.transact(
    { producer: { kind: "recovery_host", id: "durable-runtime-recovery" }, causationId: "host-restart" },
    () => ({
      pending: [{ type: "runtime.interrupted", data: { reason, taskIds, executionIds } }] satisfies PendingRuntimeEvent[],
      result: undefined,
    }),
  );
  return true;
}
