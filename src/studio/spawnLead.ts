/**
 * UI-side reading of a worker's birth, projected from the recorded trace stream.
 *
 * The swarm is event-sourced: a worker is `spawning` for exactly as long as the log keeps
 * it there, and the canvas already binds the forming orb + mitosis wire to that real status.
 * This module answers a narrower question the canvas cannot ask from status alone — *when* the
 * parent announced the child and *when* the child materialized — so the focus panel can label a
 * birth honestly instead of narrating one.
 *
 * The honesty rule (mirrors preflight/recordedForecast.ts): the runtime lane owns emitting a
 * genuine pre-spawn intent signal. Until it does, every recorded birth is instantaneous — the
 * parent's spawn/divide trace and the child's own first working trace share the same `t` — and
 * this projection says so. It never fabricates lead time. The moment a producer emits an open
 * trace (or a dedicated intent effect) at a later `t` than the announcing spawn, `intent` starts
 * reporting the real window with no change here. See docs/local/HANDOFF_spawn_intent.md.
 */

import type { RunManifest, Trace } from "./types";

export type SpawnLead =
  | {
      /** No recorded gap: the parent's announcement and the child's arrival share one `t`. */
      kind: "instant";
      /** The parent/divider that announced this child, or null if only the child's own trace exists. */
      announcedBy: string | null;
      /** Recorded seconds-from-start of the birth. */
      atS: number;
    }
  | {
      /** A real lead window: announced strictly before the child began working. */
      kind: "intent";
      announcedBy: string;
      /** When the parent announced the coming child. */
      announcedAtS: number;
      /** When the child's first working trace landed. */
      readyAtS: number;
      /** Recorded lead-time in seconds. Always > 0 for this variant. */
      leadS: number;
    }
  /** The child never appears in the recorded stream, so nothing can be said about its birth. */
  | { kind: "unavailable" };

/** Two recorded times are the same instant when they are within one recorded frame. */
const SAME_INSTANT_S = 1 / 30;

function announcingTrace(traces: Trace[], childId: string): Trace | null {
  // The parent (or divider) names the child in an agent effect that sets it `spawning`.
  for (const trace of traces) {
    for (const effect of trace.effects ?? []) {
      if (effect.type === "agent" && effect.id === childId && effect.status === "spawning") {
        return trace;
      }
    }
  }
  return null;
}

function firstWorkingTrace(traces: Trace[], childId: string): Trace | null {
  // The child's own arrival: the first trace that drives it to `working`.
  for (const trace of traces) {
    for (const effect of trace.effects ?? []) {
      if (effect.type === "agent" && effect.id === childId && effect.status === "working") {
        return trace;
      }
    }
  }
  return null;
}

/**
 * Classify one worker's recorded birth. Pure: same run + traces + id → same lead, every time.
 */
export function spawnLeadOf(
  childId: string,
  _run: RunManifest,
  traces: Trace[],
): SpawnLead {
  const announce = announcingTrace(traces, childId);
  const ready = firstWorkingTrace(traces, childId);

  // Nothing recorded for this child at all.
  if (!announce && !ready) return { kind: "unavailable" };

  // A child that reached `working` but was never separately announced (its own first trace both
  // registered and started it) is an instantaneous self-start.
  if (!announce && ready) {
    return { kind: "instant", announcedBy: null, atS: ready.t };
  }

  const announcedBy = announce!.agent;

  // Announced but never observed working: honest gap, not a fabricated forming window.
  if (announce && !ready) {
    return { kind: "instant", announcedBy, atS: announce.t };
  }

  const leadS = ready!.t - announce!.t;
  if (leadS > SAME_INSTANT_S) {
    return {
      kind: "intent",
      announcedBy,
      announcedAtS: announce!.t,
      readyAtS: ready!.t,
      leadS,
    };
  }

  return { kind: "instant", announcedBy, atS: announce!.t };
}
