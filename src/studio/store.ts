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

import type { Layout } from "./layout";
import {
  applyTrace,
  finish,
  initialState,
  phaseOf,
  progress,
  seedCues,
  type AgentView,
  type Phase,
  type RunState,
} from "./replay";
import {
  ReplayTransport,
  type RunBundle,
  type RunHandle,
  type RunTransport,
} from "./transport";
import type { Trace, View } from "./types";

/** The swarm and the result are one screen: the agents stay on the canvas after the run. */
export type Stage = "input" | "run";
export type LoadStatus = "idle" | "loading" | "ready" | "failed";

export interface SessionOutcome {
  kind: "cancelled";
  reason: string;
}

interface StudioStore {
  stage: Stage;
  bundle: RunBundle | null;
  loadStatus: LoadStatus;
  error: string | null;
  outcome: SessionOutcome | null;
  /** Which worker's workspace and history is open. */
  selected: string | null;

  /** The event-sourced projection. The only source of agent truth. */
  state: RunState;

  speed: number;
  view: View;
  clipT: number;
  playing: boolean;

  /** How the swarm is arranged on the canvas. A way of looking, not a fact about the run. */
  layout: Layout;

  /** The run is held: the transport's clock is stopped, so the fold is stopped too. */
  paused: boolean;
  /** A live pause was requested but no runtime acknowledgement exists yet. */
  pausePending: boolean;

  boot: (transport: RunTransport) => Promise<void>;
  retry: () => Promise<void>;
  start: () => void;
  event: (trace: Trace) => void;
  end: () => void;
  reset: () => void;
  cancel: (reason?: string) => void;

  pause: () => void;
  resume: () => void;
  togglePause: () => void;

  select: (id: string | null) => void;
  setStage: (stage: Stage) => void;
  setSpeed: (speed: number) => void;
  setView: (view: View) => void;
  setLayout: (layout: Layout) => void;
  setClipT: (t: number) => void;
  setPlaying: (playing: boolean) => void;
}

let transport: RunTransport | null = null;
let handle: RunHandle | null = null;
let loadVersion = 0;

export const useStudio = create<StudioStore>((set, get) => ({
  stage: "input",
  bundle: null,
  loadStatus: "idle",
  error: null,
  outcome: null,
  selected: null,
  state: initialState(),
  speed: 6,
  view: "prepped",
  layout: "radial",
  clipT: 0,
  playing: false,
  paused: false,
  pausePending: false,

  async boot(next) {
    const version = ++loadVersion;
    handle?.stop();
    handle = null;
    transport = next;
    set({
      bundle: null,
      loadStatus: "loading",
      error: null,
      outcome: null,
      stage: "input",
      state: initialState(),
      selected: null,
      playing: false,
      paused: false,
      pausePending: false,
    });
    try {
      const bundle = await next.load();
      if (version !== loadVersion) return;
      set({ bundle, loadStatus: "ready", error: null });
    } catch (err) {
      if (version !== loadVersion) return;
      set({
        bundle: null,
        loadStatus: "failed",
        error: err instanceof Error ? err.message : "run data failed to load",
      });
    }
  },

  async retry() {
    if (!transport) return;
    await get().boot(transport);
  },

  start() {
    const { bundle } = get();
    if (!bundle || !transport) return;

    handle?.stop();

    set({
      stage: "run",
      selected: null,
      playing: false,
      paused: false,
      pausePending: false,
      outcome: null,
      clipT: 0,
      state: seedCues(initialState(), bundle.captions.cues.map((c) => c.id)),
    });

    handle = transport.stream({
      speed: get().speed,
      onEvent: (trace) => get().event(trace),
      onEnd: () => get().end(),
      onAbort: (reason) => get().cancel(reason),
    });
  },

  event(trace) {
    const { bundle, state } = get();
    if (!bundle) return;
    set({ state: applyTrace(state, trace, bundle.run) });
  },

  end() {
    handle?.stop();
    handle = null;
    // The stage does not change: the swarm stays on screen, the result appears under it.
    set((s) => ({ state: finish(s.state), paused: false, pausePending: false }));
  },

  reset() {
    handle?.stop();
    handle = null;
    set({
      stage: "input",
      state: initialState(),
      selected: null,
      clipT: 0,
      playing: false,
      paused: false,
      pausePending: false,
      outcome: null,
    });
  },

  cancel(reason = "The replay was stopped before completion.") {
    handle?.stop();
    handle = null;
    set({
      stage: "input",
      state: initialState(),
      selected: null,
      clipT: 0,
      playing: false,
      paused: false,
      pausePending: false,
      outcome: { kind: "cancelled", reason },
    });
  },

  /**
   * Pause is not a UI mood. The transport's clock actually stops, which stops the fold,
   * so a paused run advances by exactly nothing until it is resumed.
   */
  pause() {
    const { paused, pausePending, state } = get();
    if (!handle || paused || pausePending || state.status !== "running") return;
    const disposition = handle.pause();
    if (disposition === "applied") set({ paused: true, pausePending: false });
    else if (disposition === "requested") set({ pausePending: true });
  },

  resume() {
    if (!handle || !get().paused) return;
    if (handle.resume() === "applied") set({ paused: false, pausePending: false });
  },

  togglePause() {
    const { paused, resume, pause } = get();
    if (paused) resume();
    else pause();
  },

  select: (selected) => set({ selected }),
  setStage: (stage) => set({ stage }),
  setSpeed: (speed) => set({ speed }),
  setView: (view) => set({ view }),
  setLayout: (layout) => set({ layout }),
  setClipT: (clipT) =>
    set((state) => ({
      clipT: Math.max(0, Math.min(state.bundle?.run.clip.duration ?? 0, Number.isFinite(clipT) ? clipT : 0)),
    })),
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
      done: s.bundle ? progress(s.state, s.bundle.traces.length) : 0,
    })),
  );

export const useCueState = (id: string): string =>
  useStudio((s) => s.state.cues[id] ?? "pending");

export const useComplete = (): boolean => useStudio((s) => s.state.status === "complete");

export const usePaused = (): boolean => useStudio((s) => s.paused);

export const useLayout = (): Layout => useStudio((s) => s.layout);

/** A worker's full history is just the event log filtered by agent. Event sourcing pays for this. */
export const useAgentHistory = (id: string | null): Trace[] =>
  useStudio(
    useShallow((s) => (id ? s.state.emitted.filter((t) => t.agent === id) : [])),
  );
