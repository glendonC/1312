import { readFile, stat } from "node:fs/promises";

import { assertRuntimeEvent } from "../assertions.ts";
import type { RuntimeProjection } from "../model.ts";
import type { RuntimeEvent } from "../protocol.ts";
import { initialRuntimeProjection, projectRuntimeEvents } from "../projection.ts";
import { RuntimeHostError } from "./errors.ts";
import type {
  RuntimeHostFailureReason,
  RuntimeHostLifecycleState,
} from "./model.ts";

export const MAX_RUNTIME_POLL_JOURNAL_BYTES = 5 * 1024 * 1024;
export const MAX_RUNTIME_POLL_EVENTS = 200;
export const DEFAULT_RUNTIME_POLL_EVENTS = 100;

export interface ValidatedRuntimeJournal {
  events: RuntimeEvent[];
  state: RuntimeProjection;
  head: number;
}

export interface RuntimeEvidenceLifecycle {
  lifecycle: Extract<RuntimeHostLifecycleState, "initializing" | "running" | "terminal" | "failed">;
  reason: RuntimeHostFailureReason | null;
}

export async function readValidatedRuntimeJournal(
  path: string,
  runtimeId: string,
): Promise<ValidatedRuntimeJournal> {
  let raw: string;
  try {
    const details = await stat(path);
    if (!details.isFile()) {
      throw new RuntimeHostError("invalid_journal", "The production journal is not a regular file.", 409);
    }
    if (details.size > MAX_RUNTIME_POLL_JOURNAL_BYTES) {
      throw new RuntimeHostError("journal_too_large", "The production journal exceeds the polling limit.", 409);
    }
    raw = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { events: [], state: initialRuntimeProjection(runtimeId), head: 0 };
    }
    throw error;
  }
  if (raw.length === 0) return { events: [], state: initialRuntimeProjection(runtimeId), head: 0 };
  if (!raw.endsWith("\n")) {
    throw new RuntimeHostError(
      "partial_journal_line",
      "The production journal ends with an incomplete line; retry after the append finishes.",
      409,
    );
  }
  const lines = raw.slice(0, -1).split("\n");
  const events = lines.map((line, index): RuntimeEvent => {
    if (line.length === 0) {
      throw new RuntimeHostError("malformed_journal", `Production journal line ${index + 1} is empty.`, 409);
    }
    let value: unknown;
    try {
      value = JSON.parse(line) as unknown;
    } catch (error) {
      throw new RuntimeHostError(
        "malformed_journal",
        `Production journal line ${index + 1} is not valid JSON.`,
        409,
        { cause: error },
      );
    }
    try {
      assertRuntimeEvent(value, `Runtime polling journal line ${index + 1}`);
    } catch (error) {
      throw new RuntimeHostError(
        "malformed_journal",
        `Production journal line ${index + 1} failed runtime-event validation.`,
        409,
        { cause: error },
      );
    }
    return value;
  });
  let state: RuntimeProjection;
  try {
    state = projectRuntimeEvents(runtimeId, events);
  } catch (error) {
    throw new RuntimeHostError(
      "invalid_journal_chain",
      "The production journal is gapped, duplicated, cross-run, or violates runtime invariants.",
      409,
      { cause: error },
    );
  }
  for (let index = 1; index < events.length; index += 1) {
    if (Date.parse(events[index].recordedAt) < Date.parse(events[index - 1].recordedAt)) {
      throw new RuntimeHostError(
        "invalid_journal_chain",
        "The production journal event time moves backward.",
        409,
      );
    }
  }
  return { events, state, head: state.lastSeq };
}

export function lifecycleFromRuntimeEvidence(state: RuntimeProjection): RuntimeEvidenceLifecycle {
  const tasks = Object.values(state.tasks);
  const executions = Object.values(state.executions);
  const activeExecution = executions.some((execution) => execution.status === "active");
  const terminalTasks = tasks.length > 0 && tasks.every((task) =>
    task.status === "completed" || task.status === "failed" || task.status === "withheld"
  );
  const failedEvidence = tasks.some((task) => task.status === "failed") ||
    executions.some((execution) => execution.status === "failed" || execution.status === "timed_out");
  if (failedEvidence && !activeExecution) {
    return {
      lifecycle: "failed",
      reason: {
        code: "runtime_evidence_failed",
        message: "Validated runtime evidence contains a failed or timed-out task.",
      },
    };
  }
  if (terminalTasks && !activeExecution) {
    return { lifecycle: "terminal", reason: null };
  }
  if (executions.length > 0) return { lifecycle: "running", reason: null };
  return { lifecycle: "initializing", reason: null };
}

export function validatePollCursor(afterValue: string | null, limitValue: string | null): {
  after: number;
  limit: number;
} {
  const parse = (value: string, label: string, minimum: number): number => {
    if (!/^(0|[1-9][0-9]*)$/.test(value)) {
      throw new RuntimeHostError("invalid_cursor", `${label} must be a non-negative base-10 integer.`);
    }
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < minimum) {
      throw new RuntimeHostError("invalid_cursor", `${label} is outside the supported integer range.`);
    }
    return parsed;
  };
  const after = afterValue === null ? 0 : parse(afterValue, "after", 0);
  const limit = limitValue === null ? DEFAULT_RUNTIME_POLL_EVENTS : parse(limitValue, "limit", 1);
  if (limit > MAX_RUNTIME_POLL_EVENTS) {
    throw new RuntimeHostError(
      "invalid_limit",
      `limit must be no greater than ${MAX_RUNTIME_POLL_EVENTS}.`,
    );
  }
  return { after, limit };
}
