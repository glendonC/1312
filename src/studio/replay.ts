/**
 * The replay core.
 *
 * `applyTrace` is a pure reducer: (state, trace) -> state. The UI is a fold of
 * the trace stream, nothing more. That is the whole point of the design — today
 * the stream comes from a recorded run on disk, tomorrow it can come from a live
 * `codex exec` orchestrator over a socket, and not one component changes. Only
 * the producer in data.ts is swapped.
 */

import { transition } from "./lifecycle";
import type {
  AgentStatus,
  CueState,
  GateScope,
  Role,
  RunManifest,
  Trace,
} from "./types";

export interface GateReading {
  name: string;
  scope: GateScope;
  value: number;
  limit: number;
  fail: boolean;
}

export interface ThinkLine {
  key: number;
  action: string;
  target: string;
  detail: string;
  level: Trace["level"];
}

/** Everything one worker is doing, derived only from its own traces. */
export interface AgentView {
  id: string;
  role: Role;
  label: string;
  status: AgentStatus;
  window: [number, number] | null;
  dividedFrom: string | null;
  playhead: number | null;
  marks: { label: string; hard: boolean }[];
  gloss: { term: string; gloss: string }[];
  draft: { source: string; target: string; conf: number } | null;
  gates: GateReading[];
  stamp: { kind: string; text: string } | null;
  think: ThinkLine[];
  actions: number;
}

export interface RunState {
  status: "idle" | "running" | "complete";
  /** How many traces have been folded in. */
  cursor: number;
  orchestrator: { status: AgentStatus; note: string };
  agents: Record<string, AgentView>;
  order: string[];
  cues: Record<string, CueState>;
  hardLine: number | null;
  coverage: number | null;
  fabrications: number | null;
  emitted: Trace[];
}

/**
 * The status verb.
 *
 * Derived from the state of the run, never from the last trace's verb: drafting and
 * gating interleave, so a verb-per-trace label flickers between them several times a
 * second. Five stable gerunds that only ever move forward read as progress instead of
 * noise. The per-action detail is still there, in each worker's own history.
 */
export type Phase = "Ready" | "Spawning" | "Listening" | "Translating" | "Merging" | "Done";

export function phaseOf(state: RunState, totalCues: number): Phase {
  if (state.status === "complete") return "Done";
  if (state.status === "idle") return "Ready";
  if (state.order.length === 0) return "Spawning";

  const resolved = Object.values(state.cues).filter(
    (c) => c === "committed" || c === "withheld" || c === "dropped",
  ).length;
  if (totalCues > 0 && resolved >= totalCues) return "Merging";

  const translating = state.order.some((id) => state.agents[id]?.role === "translate");
  return translating ? "Translating" : "Listening";
}

const THINK_KEEP = 2;

export function initialState(): RunState {
  return {
    status: "idle",
    cursor: 0,
    orchestrator: { status: "idle", note: "waiting for a clip" },
    agents: {},
    order: [],
    cues: {},
    hardLine: null,
    coverage: null,
    fabrications: null,
    emitted: [],
  };
}

function blankAgent(id: string, run: RunManifest): AgentView {
  const spec = run.agents.find((a) => a.id === id);
  return {
    id,
    role: spec?.role ?? "segment",
    label: spec?.label ?? id,
    status: "spawning",
    window: spec?.window ?? null,
    dividedFrom: spec?.divided_from ?? null,
    playhead: null,
    marks: [],
    gloss: [],
    draft: null,
    gates: [],
    stamp: null,
    think: [],
    actions: 0,
  };
}

/** Fold one recorded action into the run state. Pure. */
export function applyTrace(state: RunState, trace: Trace, run: RunManifest): RunState {
  const next: RunState = {
    ...state,
    status: "running",
    cursor: state.cursor + 1,
    emitted: [...state.emitted, trace],
    agents: { ...state.agents },
    cues: { ...state.cues },
  };

  // The orchestrator has no workspace; it narrates itself in the header.
  if (trace.agent === "orchestrator") {
    next.orchestrator = { status: "working", note: trace.detail };
  } else {
    const prev = next.agents[trace.agent] ?? blankAgent(trace.agent, run);
    const agent: AgentView = {
      ...prev,
      actions: prev.actions + 1,
      think: [
        {
          key: state.cursor,
          action: trace.action,
          target: trace.target,
          detail: trace.detail,
          level: trace.level,
        },
        ...prev.think,
      ].slice(0, THINK_KEEP),
    };

    const view = trace.view;
    if (view) {
      if (typeof view.playhead === "number") agent.playhead = view.playhead;
      if (view.mark) {
        agent.marks = [...agent.marks, { label: view.mark.label, hard: Boolean(view.mark.hard) }].slice(-6);
      }
      if (view.gloss) {
        agent.gloss = [...agent.gloss, view.gloss].slice(-4);
      }
      if (view.draft) agent.draft = view.draft;
      if (view.gate) {
        agent.gates = [
          ...agent.gates,
          {
            name: view.gate.name,
            scope: view.gate.scope,
            value: view.gate.value,
            limit: view.gate.limit,
            fail: Boolean(view.gate.fail),
          },
        ].slice(-3);
      }
      if (view.stamp) agent.stamp = view.stamp;
    }

    if (!next.agents[trace.agent]) next.order = [...state.order, trace.agent];
    next.agents[trace.agent] = agent;
  }

  for (const fx of trace.effects ?? []) {
    if (fx.type === "agent") {
      if (fx.id === "orchestrator") {
        next.orchestrator = {
          ...next.orchestrator,
          status: transition(next.orchestrator.status, fx.status),
        };
      } else {
        const prev = next.agents[fx.id] ?? blankAgent(fx.id, run);
        if (!next.agents[fx.id]) next.order = [...next.order, fx.id];
        next.agents[fx.id] = { ...prev, status: transition(prev.status, fx.status) };
      }
    } else if (fx.type === "cue") {
      next.cues[fx.id] = fx.state;
    } else if (fx.type === "cues") {
      for (const id of Object.keys(next.cues)) next.cues[id] = fx.state;
    } else if (fx.type === "score") {
      if (typeof fx.hard_line === "number") next.hardLine = fx.hard_line;
      if (typeof fx.coverage === "number") next.coverage = fx.coverage;
      if (typeof fx.fabrications === "number") next.fabrications = fx.fabrications;
    }
  }

  return next;
}

/** Seed the cue map so the transcript has its shape before any text lands. */
export function seedCues(state: RunState, ids: string[]): RunState {
  const cues: Record<string, CueState> = {};
  for (const id of ids) cues[id] = "pending";
  return { ...state, cues, status: "running" };
}

export function finish(state: RunState): RunState {
  const agents: Record<string, AgentView> = {};
  for (const [id, a] of Object.entries(state.agents)) {
    agents[id] = a.status === "retired" ? a : { ...a, status: "retired" };
  }
  return { ...state, status: "complete", agents };
}

export function progress(state: RunState, total: number): number {
  if (total === 0) return 0;
  return Math.min(1, state.cursor / total);
}
