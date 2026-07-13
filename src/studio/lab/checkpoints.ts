import { phaseOf, type Phase } from "../replay";
import { projectRun } from "../replayProjection";
import type { RunBundle } from "../transport";

export interface Checkpoint {
  phase: Phase;
  /** Ready is session state before a run; every other phase is a reducer cursor. */
  cursor: number | null;
}

const ORDER: readonly Phase[] = ["Ready", "Spawning", "Listening", "Translating", "Merging", "Done"];

export function deriveCheckpoints(bundle: RunBundle): Checkpoint[] {
  const found = new Map<Phase, number>();
  for (let cursor = 0; cursor <= bundle.traces.length; cursor += 1) {
    const state = projectRun(bundle, cursor);
    const phase = phaseOf(state, bundle.captions.cues.length);
    if (!found.has(phase)) found.set(phase, cursor);
  }

  return ORDER.map((phase) => ({ phase, cursor: phase === "Ready" ? null : (found.get(phase) ?? null) }));
}
