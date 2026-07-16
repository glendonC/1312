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
  assessSubmittedPreviewRequest,
  cancelledPreflight,
  failedSubmittedSourceResolution,
  idlePreflight,
  loadingRecordedPreflight,
  recordedPreflight,
  resolvedSubmittedSourcePreflight,
  resolvingSubmittedSourcePreflight,
  submittedSourcePreflight,
  unavailableRecordedPreflight,
  type AnalysisRequest,
  type OutputDepth,
  type PreflightSession,
} from "./preflight/model";
import { createStudioPreviewSession, type StudioPreviewSession } from "./previewSession";
import { resolveRemoteSource, SourceResolutionClientError } from "./sourceResolution";
import {
  createSubmittedSourcePreparationRequest,
  type SubmittedSourceLanguageIntent,
} from "./submittedPreparation";
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
  preflight: PreflightSession;
  /** UI-only source context. Recorded evidence remains entirely inside bundle. */
  previewSession: StudioPreviewSession | null;
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

  /** The run is held: the transport's clock is stopped, so the fold is stopped too. */
  paused: boolean;
  /** A live pause was requested but no runtime acknowledgement exists yet. */
  pausePending: boolean;

  boot: (transport: RunTransport) => Promise<void>;
  retry: () => Promise<void>;
  openRecordedPreflight: () => void;
  submitSource: (source: string) => void;
  retrySubmittedSource: () => void;
  updatePreflightRequest: (request: Partial<AnalysisRequest>) => void;
  updateSubmittedSourceLanguage: (intent: SubmittedSourceLanguageIntent) => void;
  dismissPreflight: () => void;
  cancelPreflight: () => void;
  confirmPreflight: () => void;
  start: () => void;
  event: (trace: Trace) => void;
  end: () => void;
  reset: () => void;
  cancel: (reason?: string) => void;

  pause: () => void;
  resume: () => void;
  togglePause: () => void;
  seekCursor: (cursor: number) => void;
  stepTrace: () => void;
  restartReplay: () => void;

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
let sourceResolutionVersion = 0;
let submittedPreparationVersion = 0;

export const useStudio = create<StudioStore>((set, get) => {
  function invalidateSubmittedPreparation(): void {
    submittedPreparationVersion += 1;
    set((current) => current.previewSession
      ? {
          previewSession: {
            ...current.previewSession,
            preparation: { status: "idle", request: null, message: null },
          },
        }
      : current);
  }

  function rebuildSubmittedPreparation(): void {
    const { previewSession, preflight } = get();
    if (!previewSession?.resolution || preflight.status !== "ready") return;
    const version = ++submittedPreparationVersion;
    const resolutionId = previewSession.resolution.resolutionId;
    set((current) => current.previewSession?.resolution?.resolutionId === resolutionId
      ? {
          previewSession: {
            ...current.previewSession,
            preparation: { status: "building", request: null, message: null },
          },
        }
      : current);

    void createSubmittedSourcePreparationRequest(
      previewSession.resolution,
      preflight.request,
      previewSession.sourceLanguage,
    ).then((request) => {
      if (version !== submittedPreparationVersion) return;
      set((current) => current.previewSession?.resolution?.resolutionId === resolutionId
        ? {
            previewSession: {
              ...current.previewSession,
              preparation: { status: "ready", request, message: null },
            },
          }
        : current);
    }).catch((error: unknown) => {
      if (version !== submittedPreparationVersion) return;
      const message = error instanceof Error ? error.message : "Submitted preparation request is invalid.";
      set((current) => current.previewSession?.resolution?.resolutionId === resolutionId
        ? {
            previewSession: {
              ...current.previewSession,
              preparation: { status: "invalid", request: null, message },
            },
          }
        : current);
    });
  }

  function beginSubmittedResolution(source: string, existing?: StudioPreviewSession): void {
    const resolutionVersion = ++sourceResolutionVersion;
    submittedPreparationVersion += 1;
    const previewSession = existing ?? createStudioPreviewSession(source);
    if (!previewSession) {
      set({ preflight: submittedSourcePreflight(source), previewSession: null, outcome: null });
      return;
    }
    const pending: StudioPreviewSession = {
      ...previewSession,
      resolution: null,
      resolutionFailure: null,
      preparation: { status: "idle", request: null, message: null },
    };
    set({
      preflight: resolvingSubmittedSourcePreflight(),
      previewSession: pending,
      outcome: null,
    });

    void resolveRemoteSource(source).then((resolution) => {
      if (resolutionVersion !== sourceResolutionVersion) return;
      set((current) => current.previewSession?.source.raw === source
        ? {
            previewSession: {
              ...current.previewSession,
              resolution,
              resolutionFailure: null,
            },
            preflight: resolvedSubmittedSourcePreflight(resolution.source.durationMs / 1_000),
          }
        : current);
      rebuildSubmittedPreparation();
    }).catch((resolutionError: unknown) => {
      if (resolutionVersion !== sourceResolutionVersion) return;
      const code = resolutionError instanceof SourceResolutionClientError
        ? resolutionError.code
        : "source_resolution_failed";
      const message = resolutionError instanceof Error
        ? resolutionError.message
        : "Source metadata resolution failed.";
      const retryable = code !== "invalid_source" && code !== "unsupported_source";
      set((current) => current.previewSession?.source.raw === source
        ? {
            previewSession: {
              ...current.previewSession,
              resolution: null,
              resolutionFailure: { code, message, retryable },
              preparation: { status: "idle", request: null, message: null },
            },
            preflight: failedSubmittedSourceResolution(code, message),
          }
        : current);
    });
  }

  return ({
  stage: "input",
  bundle: null,
  loadStatus: "idle",
  error: null,
  outcome: null,
  preflight: idlePreflight(),
  previewSession: null,
  outputDepth: "evidence",
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
    submittedPreparationVersion += 1;
    handle?.stop();
    handle = null;
    transport = next;
    set({
      bundle: null,
      loadStatus: "loading",
      error: null,
      outcome: null,
      preflight: idlePreflight(),
      previewSession: null,
      outputDepth: "evidence",
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
    sourceResolutionVersion += 1;
    submittedPreparationVersion += 1;
    const { bundle, loadStatus } = get();
    if (loadStatus === "loading") {
      set({ preflight: loadingRecordedPreflight(), previewSession: null });
      return;
    }
    if (!bundle) {
      set({ preflight: unavailableRecordedPreflight(), previewSession: null });
      return;
    }
    set({ preflight: recordedPreflight(bundle), previewSession: null });
  },

  submitSource(source) {
    beginSubmittedResolution(source);
  },

  retrySubmittedSource() {
    const previewSession = get().previewSession;
    if (!previewSession || previewSession.resolutionFailure?.retryable !== true) return;
    beginSubmittedResolution(previewSession.source.raw, previewSession);
  },

  updatePreflightRequest(request) {
    set((current) => ({
      preflight: {
        ...current.preflight,
        request: { ...current.preflight.request, ...request },
      },
    }));
    invalidateSubmittedPreparation();
    rebuildSubmittedPreparation();
  },

  updateSubmittedSourceLanguage(sourceLanguage) {
    set((current) => current.previewSession
      ? { previewSession: { ...current.previewSession, sourceLanguage } }
      : current);
    invalidateSubmittedPreparation();
    rebuildSubmittedPreparation();
  },

  dismissPreflight() {
    sourceResolutionVersion += 1;
    submittedPreparationVersion += 1;
    set({ preflight: idlePreflight(), previewSession: null });
  },

  cancelPreflight() {
    set((current) => ({ preflight: cancelledPreflight(current.preflight) }));
  },

  confirmPreflight() {
    const { bundle, preflight, previewSession } = get();
    if (!bundle) return;
    if (previewSession) {
      if (!previewSession.resolution || previewSession.preparation.status !== "ready") return;
      const assessment = assessSubmittedPreviewRequest(
        preflight,
        previewSession.resolution.source.durationMs / 1_000,
      );
      if (!assessment.canReplay) return;
      set({ outputDepth: previewSession.preparation.request.output.depth });
      get().start();
      return;
    }
    const assessment = assessRecordedRequest(preflight, bundle, import.meta.env.DEV);
    if (!assessment.canReplay) return;
    set({ outputDepth: preflight.request.outputDepth });
    get().start();
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
      preflight: idlePreflight(),
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
    sourceResolutionVersion += 1;
    submittedPreparationVersion += 1;
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
      previewSession: null,
    });
  },

  cancel(reason = "The replay was stopped before completion.") {
    handle?.stop();
    handle = null;
    set({
      stage: "run",
      selected: null,
      playing: false,
      paused: false,
      pausePending: false,
      outcome: { kind: "cancelled", reason },
      preflight: idlePreflight(),
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
      onAbort: (reason) => get().cancel(reason),
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
