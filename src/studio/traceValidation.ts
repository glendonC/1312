import type { AgentStatus, CueState, Effect, Trace } from "./types";

const LEVELS = new Set(["info", "warn", "gate", "error"]);
const STATUSES = new Set<AgentStatus>([
  "idle",
  "spawning",
  "working",
  "reporting",
  "gating",
  "retired",
  "done",
]);
const CUE_STATES = new Set<CueState>(["pending", "drafted", "committed", "withheld", "dropped"]);

export interface TraceIdentityScope {
  agents: ReadonlySet<string>;
  cues: ReadonlySet<string>;
  duration: number;
}
function fail(context: string, path: string, message: string): never {
  throw new Error(`${context}: ${path} ${message}`);
}

function record(value: unknown, context: string, path: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail(context, path, "must be an object");
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[], context: string, path: string): void {
  const accepted = new Set(allowed);
  const unknown = Object.keys(value).find((key) => !accepted.has(key));
  if (unknown) fail(context, `${path}.${unknown}`, "is not part of the registered trace contract");
}

function text(value: unknown, context: string, path: string, allowEmpty = false): string {
  if (typeof value !== "string" || (!allowEmpty && value.trim().length === 0)) {
    fail(context, path, allowEmpty ? "must be a string" : "must be a non-empty string");
  }
  return value;
}

function number(value: unknown, context: string, path: string, min?: number, max?: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) fail(context, path, "must be finite");
  if (min !== undefined && value < min) fail(context, path, `must be at least ${min}`);
  if (max !== undefined && value > max) fail(context, path, `must be at most ${max}`);
  return value;
}

function boolean(value: unknown, context: string, path: string): boolean {
  if (typeof value !== "boolean") fail(context, path, "must be a boolean");
  return value;
}

function assertEffect(
  value: unknown,
  context: string,
  path: string,
  scope?: TraceIdentityScope,
): asserts value is Effect {
  const effect = record(value, context, path);
  const type = text(effect.type, context, `${path}.type`);

  if (type === "agent") {
    exactKeys(effect, ["type", "id", "status"], context, path);
    const id = text(effect.id, context, `${path}.id`);
    if (scope && !scope.agents.has(id)) fail(context, `${path}.id`, `references unknown agent ${id}`);
    const status = text(effect.status, context, `${path}.status`) as AgentStatus;
    if (!STATUSES.has(status)) fail(context, `${path}.status`, `has unknown value ${status}`);
    return;
  }

  if (type === "cue") {
    exactKeys(effect, ["type", "id", "state"], context, path);
    const id = text(effect.id, context, `${path}.id`);
    if (scope && !scope.cues.has(id)) fail(context, `${path}.id`, `references unknown cue ${id}`);
    const state = text(effect.state, context, `${path}.state`) as CueState;
    if (!CUE_STATES.has(state)) fail(context, `${path}.state`, `has unknown value ${state}`);
    return;
  }

  if (type === "cues") {
    exactKeys(effect, ["type", "state"], context, path);
    const state = text(effect.state, context, `${path}.state`) as CueState;
    if (!CUE_STATES.has(state)) fail(context, `${path}.state`, `has unknown value ${state}`);
    return;
  }

  if (type === "score") {
    exactKeys(effect, ["type", "hard_line", "coverage", "fabrications"], context, path);
    if (effect.hard_line !== undefined) number(effect.hard_line, context, `${path}.hard_line`, 0, 1);
    if (effect.coverage !== undefined) number(effect.coverage, context, `${path}.coverage`, 0, 1);
    if (effect.fabrications !== undefined) number(effect.fabrications, context, `${path}.fabrications`, 0);
    return;
  }

  fail(context, `${path}.type`, `has unknown value ${type}`);
}

function assertView(value: unknown, context: string, path: string): void {
  const view = record(value, context, path);
  exactKeys(view, ["playhead", "mark", "gloss", "draft", "gate", "stamp"], context, path);
  if (view.playhead !== undefined) number(view.playhead, context, `${path}.playhead`, 0);

  if (view.mark !== undefined) {
    const mark = record(view.mark, context, `${path}.mark`);
    exactKeys(mark, ["label", "hard"], context, `${path}.mark`);
    text(mark.label, context, `${path}.mark.label`);
    if (mark.hard !== undefined) boolean(mark.hard, context, `${path}.mark.hard`);
  }
  if (view.gloss !== undefined) {
    const gloss = record(view.gloss, context, `${path}.gloss`);
    exactKeys(gloss, ["term", "gloss"], context, `${path}.gloss`);
    text(gloss.term, context, `${path}.gloss.term`);
    text(gloss.gloss, context, `${path}.gloss.gloss`);
  }
  if (view.draft !== undefined) {
    const draft = record(view.draft, context, `${path}.draft`);
    exactKeys(draft, ["source", "target", "conf"], context, `${path}.draft`);
    text(draft.source, context, `${path}.draft.source`, true);
    text(draft.target, context, `${path}.draft.target`, true);
    if (draft.conf !== null) number(draft.conf, context, `${path}.draft.conf`, 0, 1);
  }
  if (view.gate !== undefined) {
    const gate = record(view.gate, context, `${path}.gate`);
    exactKeys(gate, ["name", "scope", "value", "limit", "fail"], context, `${path}.gate`);
    text(gate.name, context, `${path}.gate.name`);
    const gateScope = text(gate.scope, context, `${path}.gate.scope`);
    if (gateScope !== "universal" && gateScope !== "pack") {
      fail(context, `${path}.gate.scope`, "must be universal or pack");
    }
    number(gate.value, context, `${path}.gate.value`);
    number(gate.limit, context, `${path}.gate.limit`);
    if (gate.fail !== undefined) boolean(gate.fail, context, `${path}.gate.fail`);
  }
  if (view.stamp !== undefined) {
    const stamp = record(view.stamp, context, `${path}.stamp`);
    exactKeys(stamp, ["kind", "text"], context, `${path}.stamp`);
    const kind = text(stamp.kind, context, `${path}.stamp.kind`);
    if (kind !== "withheld" && kind !== "corrected" && kind !== "dropped") {
      fail(context, `${path}.stamp.kind`, "has an unknown value");
    }
    text(stamp.text, context, `${path}.stamp.text`);
  }
}

/**
 * Assert one trace before it crosses a transport boundary.
 *
 * Bundle validation supplies an identity scope; live validation additionally supplies the
 * previous timestamp. Dynamic runtime events use their own versioned protocol and must be
 * deliberately adapted before they can become a legacy Trace.
 */
export function assertTrace(
  value: unknown,
  context = "Studio trace",
  scope?: TraceIdentityScope,
  previousT?: number,
): asserts value is Trace {
  const trace = record(value, context, "trace");
  exactKeys(trace, ["t", "agent", "action", "target", "detail", "level", "clip_t", "view", "effects"], context, "trace");
  const at = number(trace.t, context, "trace.t", 0);
  if (previousT !== undefined && at < previousT) fail(context, "trace.t", "is earlier than the preceding trace");
  const agent = text(trace.agent, context, "trace.agent");
  if (scope && !scope.agents.has(agent)) fail(context, "trace.agent", `references unknown agent ${agent}`);
  text(trace.action, context, "trace.action");
  text(trace.target, context, "trace.target", true);
  text(trace.detail, context, "trace.detail", true);
  const level = text(trace.level, context, "trace.level");
  if (!LEVELS.has(level)) fail(context, "trace.level", `has unknown value ${level}`);
  if (trace.clip_t !== undefined) number(trace.clip_t, context, "trace.clip_t", 0, scope?.duration);
  if (trace.view !== undefined) assertView(trace.view, context, "trace.view");
  if (trace.effects !== undefined) {
    if (!Array.isArray(trace.effects)) fail(context, "trace.effects", "must be an array");
    trace.effects.forEach((effect, index) => assertEffect(effect, context, `trace.effects[${index}]`, scope));
  }
}
