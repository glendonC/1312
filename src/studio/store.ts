/**
 * Studio store.
 *
 * Agent state is a projection of the event log, never component state. Events go
 * in one door (`event`), the pure reducer folds them, and components subscribe to
 * the narrowest slice they need — an agent card subscribes to its own agent, so a
 * worker updating re-renders one card and not the swarm.
 */

import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";

import {
  applyTrace,
  finish,
  initialState,
  phaseOf,
  seedCues,
  type AgentView,
  type Phase,
  type RunState,
} from "./replay";
import { ReplayTransport, type RunBundle, type RunTransport } from "./transport";
import type { Trace, View } from "./types";

/** The swarm and the result are one screen: the agents stay on the canvas after the run. */
export type Stage = "input" | "run";

interface StudioStore {
  stage: Stage;
  bundle: RunBundle | null;
  error: string | null;
  /** Which worker's workspace and history is open. */
  selected: string | null;

  /** The event-sourced projection. The only source of agent truth. */
  state: RunState;

  speed: number;
  view: View;
  clipT: number;
  playing: boolean;

  boot: (transport: RunTransport) => Promise<void>;
  start: () => void;
  event: (trace: Trace) => void;
  end: () => void;
  reset: () => void;

  select: (id: string | null) => void;
  setStage: (stage: Stage) => void;
  setSpeed: (speed: number) => void;
  setView: (view: View) => void;
  setClipT: (t: number) => void;
  setPlaying: (playing: boolean) => void;
}

let transport: RunTransport | null = null;
let stopStream: (() => void) | null = null;

export const useStudio = create<StudioStore>((set, get) => ({
  stage: "input",
  bundle: null,
  error: null,
  selected: null,
  state: initialState(),
  speed: 6,
  view: "prepped",
  clipT: 0,
  playing: false,

  async boot(next) {
    transport = next;
    try {
      const bundle = await next.load();
      set({ bundle, error: null });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : "run data failed to load" });
    }
  },

  start() {
    const { bundle } = get();
    if (!bundle || !transport) return;

    stopStream?.();

    set({
      stage: "run",
      selected: null,
      playing: false,
      clipT: 0,
      state: seedCues(initialState(), bundle.captions.cues.map((c) => c.id)),
    });

    stopStream = transport.stream({
      speed: get().speed,
      onEvent: (trace) => get().event(trace),
      onEnd: () => get().end(),
    });
  },

  event(trace) {
    const { bundle, state } = get();
    if (!bundle) return;
    set({ state: applyTrace(state, trace, bundle.run) });
  },

  end() {
    stopStream?.();
    stopStream = null;
    // The stage does not change: the swarm stays on screen, the result appears under it.
    set((s) => ({ state: finish(s.state) }));
  },

  reset() {
    stopStream?.();
    stopStream = null;
    set({ stage: "input", state: initialState(), selected: null, clipT: 0, playing: false });
  },

  select: (selected) => set({ selected }),
  setStage: (stage) => set({ stage }),
  setSpeed: (speed) => set({ speed }),
  setView: (view) => set({ view }),
  setClipT: (clipT) => set({ clipT }),
  setPlaying: (playing) => set({ playing }),
}));

/** Default wiring: replay a run recorded to disk. Swap for LiveTransport to go live. */
export function replayTransport(runId: string): RunTransport {
  return new ReplayTransport(runId);
}

/* ---------------------------------------------------------------- selectors */

export const useBundle = (): RunBundle | null => useStudio((s) => s.bundle);

export const useStage = (): Stage => useStudio((s) => s.stage);

/** Subscribes to exactly one worker. */
export const useAgent = (id: string): AgentView | undefined =>
  useStudio((s) => s.state.agents[id]);

export const useAgentIds = (): string[] => useStudio(useShallow((s) => s.state.order));

export const useOrchestrator = (): RunState["orchestrator"] =>
  useStudio(useShallow((s) => s.state.orchestrator));

export const useProgress = (): { phase: Phase; done: number } =>
  useStudio(
    useShallow((s) => ({
      phase: phaseOf(s.state, s.bundle?.captions.cues.length ?? 0),
      done: s.bundle ? Math.min(1, s.state.cursor / s.bundle.traces.length) : 0,
    })),
  );

export const useCueState = (id: string): string =>
  useStudio((s) => s.state.cues[id] ?? "pending");

export const useComplete = (): boolean => useStudio((s) => s.state.status === "complete");

/** A worker's full history is just the event log filtered by agent. Event sourcing pays for this. */
export const useAgentHistory = (id: string | null): Trace[] =>
  useStudio(
    useShallow((s) => (id ? s.state.emitted.filter((t) => t.agent === id) : [])),
  );
