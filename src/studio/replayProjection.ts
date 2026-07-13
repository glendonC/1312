import { applyTrace, finish, initialState, seedCues, type RunState } from "./replay";
import type { RunBundle } from "./transport";

export function clampCursor(cursor: number, total: number): number {
  if (!Number.isFinite(cursor) || !Number.isFinite(total) || total <= 0) return 0;
  return Math.max(0, Math.min(total, Math.trunc(cursor)));
}

/**
 * Reconstruct one cursor from recorded evidence. No snapshots and no component state.
 *
 * Cues are seeded, traces are folded from zero, and completion is projected only at the
 * completed cursor. Seeking backward therefore removes every later effect instead of trying
 * to undo it.
 */
export function projectRun(bundle: RunBundle, cursor: number): RunState {
  const at = clampCursor(cursor, bundle.traces.length);
  let state = seedCues(
    initialState(),
    bundle.captions.cues.map((cue) => cue.id),
  );

  for (let index = 0; index < at; index += 1) {
    state = applyTrace(state, bundle.traces[index], bundle.run);
  }

  return at === bundle.traces.length ? finish(state) : state;
}
