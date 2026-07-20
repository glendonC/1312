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
  assessRecordedRequest,
  cancelledPreflight,
  idlePreflight,
  loadingRecordedPreflight,
  recordedPreflight,
  unavailableRecordedPreflight,
  type AnalysisRequest,
  type OutputDepth,
  type PreflightSession,
} from "./preflight/model";
import {
  PREPARATION_STAGES,
  preparationStageIndex,
  type PreparationStage,
} from "./preflight/PreparationStages";
import { projectRun } from "./replayProjection";
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

/**
 * Which view of a completed run is on screen: the finished result, or the read-only completed
 * process graph. Presentation state only — switching re-projects the already-folded event log
 * and never restarts the transport.
 */
export type ResultView = "result" | "process";

/**
 * Which face of the open result workspace is showing. "arrival" is the completion moment —
 * the big finished-processing statement with the result brief — and shows once per run;
 * continuing lands on "report" (video preview beside the brief), and "watch" is the
 * full-viewport study room. Re-entry through the orb resumes the last face, never arrival.
 */
export type ResultFace = "arrival" | "report" | "watch";
export type LoadStatus = "idle" | "loading" | "ready" | "failed";

export interface SessionOutcome {
  kind: "cancelled" | "failed";
  reason: string;
}

export type RunInitializationKind = "recorded-replay";

interface StudioStore {
  stage: Stage;
  bundle: RunBundle | null;
  loadStatus: LoadStatus;
  error: string | null;
  outcome: SessionOutcome | null;
  preflight: PreflightSession;
  preparationStage: PreparationStage;
  preparationFurthestStage: number;
  initialization: RunInitializationKind | null;
  outputDepth: OutputDepth;
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

  /** Which view of a completed run is on screen. Result is always the default. */
  resultView: ResultView;
  /** Which face of the open result workspace is showing. Resets to "arrival" with each run. */
  resultFace: ResultFace;

  /** The run is held: the transport's clock is stopped, so the fold is stopped too. */
  paused: boolean;
  /** A live pause was requested but no runtime acknowledgement exists yet. */
  pausePending: boolean;

  boot: (transport: RunTransport) => Promise<void>;
  retry: () => Promise<void>;
  openRecordedPreflight: () => void;
  updatePreflightRequest: (request: Partial<AnalysisRequest>) => void;
  selectPreparationStage: (stage: PreparationStage) => void;
  advancePreparationStage: () => void;
  dismissPreflight: () => void;
  cancelPreflight: () => void;
  cancelInitialization: () => void;
  confirmPreflight: () => void;
  start: () => void;
  event: (trace: Trace) => void;
  end: () => void;
  reset: () => void;
  cancel: (reason?: string) => void;
  fail: (reason: string) => void;

  pause: () => void;
  resume: () => void;
  togglePause: () => void;
  seekCursor: (cursor: number) => void;
  stepTrace: () => void;
  restartReplay: () => void;

  select: (id: string | null) => void;
  setStage: (stage: Stage) => void;
  setResultView: (view: ResultView) => void;
  setResultFace: (face: ResultFace) => void;
  setSpeed: (speed: number) => void;
  setView: (view: View) => void;
  setLayout: (layout: Layout) => void;
  setClipT: (t: number) => void;
  setPlaying: (playing: boolean) => void;
}

let transport: RunTransport | null = null;
let handle: RunHandle | null = null;
let loadVersion = 0;
let initializationVersion = 0;
let initializationTimer: ReturnType<typeof setTimeout> | null = null;

export const useStudio = create<StudioStore>((set, get) => {
  function clearInitialization(): void {
    initializationVersion += 1;
    if (initializationTimer !== null) clearTimeout(initializationTimer);
    initializationTimer = null;
  }

  function resetPreparationLifecycle(): Pick<
    StudioStore,
    "preparationStage" | "preparationFurthestStage" | "initialization"
  > {
    return {
      preparationStage: "source",
      preparationFurthestStage: 0,
      initialization: null,
    };
  }

  return ({
  stage: "input",
  bundle: null,
  loadStatus: "idle",
  error: null,
  outcome: null,
  preflight: idlePreflight(),
  preparationStage: "source",
  preparationFurthestStage: 0,
  initialization: null,
  outputDepth: "evidence",
  selected: null,
  state: initialState(),
  speed: 6,
  view: "prepped",
  layout: "radial",
  resultView: "result",
  resultFace: "arrival",
  clipT: 0,
  playing: false,
  paused: false,
  pausePending: false,

  async boot(next) {
    clearInitialization();
    const version = ++loadVersion;
    handle?.stop();
    handle = null;
    transport = next;
    set({
      bundle: null,
      loadStatus: "loading",
      error: null,
      outcome: null,
      preflight: idlePreflight(),
      ...resetPreparationLifecycle(),
      outputDepth: "evidence",
      stage: "input",
      state: initialState(),
      selected: null,
      resultView: "result",
      resultFace: "arrival",
      playing: false,
      paused: false,
      pausePending: false,
    });
    try {
      const bundle = await next.load();
      if (version !== loadVersion) return;
      set({
        bundle,
        loadStatus: "ready",
        error: null,
      });
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

  openRecordedPreflight() {
    clearInitialization();
    const { bundle, loadStatus } = get();
    if (loadStatus === "loading") {
      set({ preflight: loadingRecordedPreflight(), ...resetPreparationLifecycle() });
      return;
    }
    if (!bundle) {
      set({ preflight: unavailableRecordedPreflight(), ...resetPreparationLifecycle() });
      return;
    }
    set({ preflight: recordedPreflight(bundle), ...resetPreparationLifecycle() });
  },

  updatePreflightRequest(request) {
    set((current) => ({
      preflight: {
        ...current.preflight,
        request: { ...current.preflight.request, ...request },
      },
    }));
  },

  selectPreparationStage(preparationStage) {
    if (preparationStageIndex(preparationStage) > get().preparationFurthestStage) return;
    set({ preparationStage });
  },

  advancePreparationStage() {
    const currentIndex = preparationStageIndex(get().preparationStage);
    const preparationStage = PREPARATION_STAGES[currentIndex + 1]?.id;
    if (!preparationStage) return;
    set((current) => ({
      preparationStage,
      preparationFurthestStage: Math.max(current.preparationFurthestStage, currentIndex + 1),
    }));
  },

  dismissPreflight() {
    clearInitialization();
    set({ preflight: idlePreflight(), ...resetPreparationLifecycle() });
  },

  cancelPreflight() {
    clearInitialization();
    set((current) => ({ preflight: cancelledPreflight(current.preflight) }));
  },

  cancelInitialization() {
    clearInitialization();
    set({ initialization: null });
  },

  confirmPreflight() {
    const { bundle, preflight } = get();
    if (!bundle) return;
    const assessment = assessRecordedRequest(preflight, bundle, import.meta.env.DEV);
    if (!assessment.canReplay) return;
    const version = ++initializationVersion;
    set({ outputDepth: preflight.request.outputDepth, initialization: "recorded-replay" });
    initializationTimer = setTimeout(() => {
      initializationTimer = null;
      if (version !== initializationVersion || get().initialization !== "recorded-replay") return;
      get().start();
    }, 520);
  },

  start() {
    const { bundle } = get();
    if (!bundle || !transport) return;

    handle?.stop();

    set({
      stage: "run",
      selected: null,
      resultView: "result",
      resultFace: "arrival",
      playing: false,
      paused: false,
      pausePending: false,
      outcome: null,
      initialization: null,
      preflight: idlePreflight(),
      clipT: 0,
      state: seedCues(initialState(), bundle.captions.cues.map((c) => c.id)),
    });

    handle = transport.stream({
      speed: get().speed,
      onEvent: (trace) => get().event(trace),
      onEnd: () => get().end(),
      onAbort: (reason) => get().fail(reason),
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
    clearInitialization();
    handle?.stop();
    handle = null;
    set({
      stage: "input",
      state: initialState(),
      selected: null,
      resultView: "result",
      resultFace: "arrival",
      clipT: 0,
      playing: false,
      paused: false,
      pausePending: false,
      outcome: null,
      preflight: idlePreflight(),
      ...resetPreparationLifecycle(),
    });
  },

  cancel(reason = "The replay was stopped before completion.") {
    handle?.stop();
    handle = null;
    set({
      stage: "run",
      selected: null,
      resultView: "result",
      resultFace: "arrival",
      playing: false,
      paused: false,
      pausePending: false,
      outcome: { kind: "cancelled", reason },
      preflight: idlePreflight(),
      initialization: null,
    });
  },

  fail(reason) {
    handle?.stop();
    handle = null;
    set({
      stage: "run",
      selected: null,
      resultView: "result",
      resultFace: "arrival",
      playing: false,
      paused: false,
      pausePending: false,
      outcome: { kind: "failed", reason },
      preflight: idlePreflight(),
      initialization: null,
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

  seekCursor(cursor) {
    const { bundle } = get();
    if (!bundle || !transport) return;
    if (transport.mode !== "replay") {
      set({ error: "This transport does not support deterministic seeking." });
      return;
    }
    const projected = projectRun(bundle, cursor);

    handle?.stop();
    handle = null;

    set({
      stage: "run",
      state: projected,
      selected: null,
      resultView: "result",
      resultFace: "arrival",
      clipT: 0,
      playing: false,
      paused: projected.status !== "complete",
      pausePending: false,
      outcome: null,
    });

    if (projected.status === "complete") return;

    const nextHandle = transport.stream({
      speed: get().speed,
      onEvent: (trace) => get().event(trace),
      onEnd: () => get().end(),
      onAbort: (reason) => get().fail(reason),
    });
    if (!nextHandle.replay || nextHandle.pause() !== "applied") {
      nextHandle.stop();
      set({ paused: false, error: "This transport does not support deterministic seeking." });
      return;
    }
    nextHandle.replay.seek(projected.cursor);
    handle = nextHandle;
  },

  stepTrace() {
    const { bundle, state } = get();
    if (!bundle || state.status === "complete") return;
    if (!handle?.replay) get().seekCursor(state.cursor);
    if (!get().paused) get().pause();
    if (!get().paused) return;
    handle?.replay?.step();
  },

  restartReplay() {
    get().seekCursor(0);
  },

  select: (selected) => set({ selected }),
  setStage: (stage) => set({ stage }),
  /** Choosing Process also stills the clip: the graph is a projection, never a resumed run. */
  setResultView: (resultView) =>
    set(resultView === "process" ? { resultView, playing: false } : { resultView }),
  setResultFace: (resultFace) => set({ resultFace }),
  setSpeed: (speed) => {
    if (!Number.isFinite(speed) || speed <= 0) return;
    const safe = Math.max(0.25, Math.min(24, speed));
    handle?.replay?.setSpeed(safe);
    set({ speed: safe });
  },
  setView: (view) => set({ view }),
  setLayout: (layout) => set({ layout }),
  setClipT: (clipT) =>
    set((state) => ({
      clipT: Math.max(0, Math.min(state.bundle?.run.clip.duration ?? 0, Number.isFinite(clipT) ? clipT : 0)),
    })),
  setPlaying: (playing) => set({ playing }),
  });
});

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

/**
 * The ids currently in the recorded `spawning` state — the workers a parent is mid-division of.
 * Bound to the reducer, so it holds under pause and lasts exactly as long as the log keeps a
 * worker forming; it never comes from a UI clock.
 */
export const useSpawningIds = (): string[] =>
  useStudio(
    useShallow((s) => s.state.order.filter((id) => s.state.agents[id]?.status === "spawning")),
  );

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

export const useResultView = (): ResultView => useStudio((s) => s.resultView);
export const useResultFace = (): ResultFace => useStudio((s) => s.resultFace);

export const usePaused = (): boolean => useStudio((s) => s.paused);

export const useLayout = (): Layout => useStudio((s) => s.layout);

/** A worker's full history is just the event log filtered by agent. Event sourcing pays for this. */
export const useAgentHistory = (id: string | null): Trace[] =>
  useStudio(
    useShallow((s) => (id ? s.state.emitted.filter((t) => t.agent === id) : [])),
  );
