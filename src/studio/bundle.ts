import type { RunBundle } from "./transport";
import type { AgentStatus, CueState, Effect, Trace } from "./types";
import { canTransition } from "./lifecycle";
import { assertSourceReceipts } from "./preflight/receiptValidation";
import { assertTrace } from "./traceValidation";

const ROLES = new Set(["orchestrator", "segment", "context", "translate", "qc"]);
const STATUSES = new Set<AgentStatus>([
  "idle",
  "spawning",
  "working",
  "reporting",
  "gating",
  "retired",
  "done",
]);
const LEVELS = new Set(["info", "warn", "gate", "error"]);
const CUE_STATES = new Set<CueState>(["pending", "drafted", "committed", "withheld", "dropped"]);

function fail(context: string, path: string, message: string): never {
  throw new Error(`${context}: ${path} ${message}`);
}

function record(value: unknown, context: string, path: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail(context, path, "must be an object");
  }
  return value as Record<string, unknown>;
}

function list(value: unknown, context: string, path: string): unknown[] {
  if (!Array.isArray(value)) fail(context, path, "must be an array");
  return value;
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

function nullableNumber(
  value: unknown,
  context: string,
  path: string,
  min?: number,
  max?: number,
): number | null {
  return value === null ? null : number(value, context, path, min, max);
}

function line(value: unknown, context: string, path: string): void {
  const item = record(value, context, path);
  text(item.lang, context, `${path}.lang`);
  if (item.text !== null) text(item.text, context, `${path}.text`, true);
}

function effect(
  value: unknown,
  context: string,
  path: string,
  agents: Set<string>,
  cues: Set<string>,
): asserts value is Effect {
  const item = record(value, context, path);
  const type = text(item.type, context, `${path}.type`);
  if (type === "agent") {
    const id = text(item.id, context, `${path}.id`);
    if (!agents.has(id)) fail(context, `${path}.id`, `references unknown agent ${id}`);
    const status = text(item.status, context, `${path}.status`) as AgentStatus;
    if (!STATUSES.has(status)) fail(context, `${path}.status`, `has unknown value ${status}`);
  } else if (type === "cue") {
    const id = text(item.id, context, `${path}.id`);
    if (!cues.has(id)) fail(context, `${path}.id`, `references unknown cue ${id}`);
    const state = text(item.state, context, `${path}.state`) as CueState;
    if (!CUE_STATES.has(state)) fail(context, `${path}.state`, `has unknown value ${state}`);
  } else if (type === "cues") {
    const state = text(item.state, context, `${path}.state`) as CueState;
    if (!CUE_STATES.has(state)) fail(context, `${path}.state`, `has unknown value ${state}`);
  } else if (type === "score") {
    for (const key of ["hard_line", "coverage"] as const) {
      if (item[key] !== undefined) number(item[key], context, `${path}.${key}`, 0, 1);
    }
    if (item.fabrications !== undefined) number(item.fabrications, context, `${path}.fabrications`, 0);
  } else {
    fail(context, `${path}.type`, `has unknown value ${type}`);
  }
}

function trace(
  value: unknown,
  context: string,
  path: string,
  agents: Set<string>,
  cues: Set<string>,
): asserts value is Trace {
  assertTrace(value, context, { agents, cues, duration: Number.POSITIVE_INFINITY });
  const item = record(value, context, path);
  number(item.t, context, `${path}.t`, 0);
  const agent = text(item.agent, context, `${path}.agent`);
  if (!agents.has(agent)) fail(context, `${path}.agent`, `references unknown agent ${agent}`);
  text(item.action, context, `${path}.action`);
  text(item.target, context, `${path}.target`, true);
  text(item.detail, context, `${path}.detail`, true);
  const level = text(item.level, context, `${path}.level`);
  if (!LEVELS.has(level)) fail(context, `${path}.level`, `has unknown value ${level}`);
  if (item.clip_t !== undefined) number(item.clip_t, context, `${path}.clip_t`, 0);
  if (item.view !== undefined) record(item.view, context, `${path}.view`);
  if (item.effects !== undefined) {
    list(item.effects, context, `${path}.effects`).forEach((entry, index) =>
      effect(entry, context, `${path}.effects[${index}]`, agents, cues),
    );
  }
}

/**
 * Small, dependency-free assertion shared by recorded and live bundle loading.
 *
 * It deliberately validates references and null semantics in addition to outer JSON shapes.
 * A malformed stream must stop at the transport boundary instead of becoming a plausible
 * segment worker or a zero-valued result farther up the UI.
 */
export function assertRunBundle(value: unknown, context = "Studio run bundle"): asserts value is RunBundle {
  const bundle = record(value, context, "bundle");
  const run = record(bundle.run, context, "run");
  const runId = text(run.id, context, "run.id");
  const packId = text(run.pack, context, "run.pack");
  number(run.wall_s, context, "run.wall_s", 0);
  text(run.recorded, context, "run.recorded");
  const pair = record(run.pair, context, "run.pair");
  text(pair.source, context, "run.pair.source");
  text(pair.target, context, "run.pair.target");

  const clip = record(run.clip, context, "run.clip");
  const clipId = text(clip.id, context, "run.clip.id");
  const duration = number(clip.duration, context, "run.clip.duration", 0);
  if (duration === 0) fail(context, "run.clip.duration", "must be greater than zero");
  text(clip.title, context, "run.clip.title");
  text(clip.title_target, context, "run.clip.title_target");
  text(clip.lang, context, "run.clip.lang");
  const speakerIds = new Set<string>();
  list(clip.speakers, context, "run.clip.speakers").forEach((value, index) => {
    const speaker = record(value, context, `run.clip.speakers[${index}]`);
    const id = text(speaker.id, context, `run.clip.speakers[${index}].id`);
    if (speakerIds.has(id)) fail(context, `run.clip.speakers[${index}].id`, `duplicates ${id}`);
    speakerIds.add(id);
    text(speaker.label, context, `run.clip.speakers[${index}].label`);
  });
  for (const key of ["music", "silence"] as const) {
    list(clip[key], context, `run.clip.${key}`).forEach((value, index) => {
      const range = list(value, context, `run.clip.${key}[${index}]`);
      if (range.length !== 2) fail(context, `run.clip.${key}[${index}]`, "must contain start and end");
      const start = number(range[0], context, `run.clip.${key}[${index}][0]`, 0, duration);
      const end = number(range[1], context, `run.clip.${key}[${index}][1]`, 0, duration);
      if (end < start) fail(context, `run.clip.${key}[${index}]`, "ends before it starts");
    });
  }
  const clipSource = record(clip.source, context, "run.clip.source");
  if (clip.media !== null) text(clip.media, context, "run.clip.media");

  assertSourceReceipts(
    bundle.ingestReceipt,
    bundle.mediaProbe,
    { runId, duration, media: clip.media as string | null, source: clipSource },
    context,
  );

  const agentIds = new Set<string>(["orchestrator"]);
  list(run.agents, context, "run.agents").forEach((value, index) => {
    const agent = record(value, context, `run.agents[${index}]`);
    const id = text(agent.id, context, `run.agents[${index}].id`);
    if (agentIds.has(id)) fail(context, `run.agents[${index}].id`, `duplicates ${id}`);
    agentIds.add(id);
    const role = text(agent.role, context, `run.agents[${index}].role`);
    if (!ROLES.has(role) || role === "orchestrator") {
      fail(context, `run.agents[${index}].role`, `has invalid worker role ${role}`);
    }
    text(agent.label, context, `run.agents[${index}].label`);
    if (agent.parent !== null) text(agent.parent, context, `run.agents[${index}].parent`);
    if (agent.divided_from !== undefined) text(agent.divided_from, context, `run.agents[${index}].divided_from`);
    if (agent.window !== undefined) {
      const window = list(agent.window, context, `run.agents[${index}].window`);
      if (window.length !== 2) fail(context, `run.agents[${index}].window`, "must contain start and end");
      const start = number(window[0], context, `run.agents[${index}].window[0]`, 0, duration);
      const end = number(window[1], context, `run.agents[${index}].window[1]`, 0, duration);
      if (end < start) fail(context, `run.agents[${index}].window`, "ends before it starts");
    }
  });
  const declaredArtifacts = list(run.artifacts, context, "run.artifacts").map((value, index) =>
    text(value, context, `run.artifacts[${index}]`),
  );
  for (const required of ["captions.json", "corrections.json", "glossary.json", "score.json", "traces.json"]) {
    if (!declaredArtifacts.includes(required)) {
      fail(context, "run.artifacts", `must declare required artifact ${required}`);
    }
  }

  const captions = record(bundle.captions, context, "captions");
  if (text(captions.run, context, "captions.run") !== runId) fail(context, "captions.run", "does not match run.id");
  if (text(captions.clip, context, "captions.clip") !== clipId) fail(context, "captions.clip", "does not match run.clip.id");
  const cueIds = new Set<string>();
  list(captions.cues, context, "captions.cues").forEach((value, index) => {
    const cue = record(value, context, `captions.cues[${index}]`);
    const id = text(cue.id, context, `captions.cues[${index}].id`);
    if (cueIds.has(id)) fail(context, `captions.cues[${index}].id`, `duplicates ${id}`);
    cueIds.add(id);
    const start = number(cue.t_start, context, `captions.cues[${index}].t_start`, 0, duration);
    const end = number(cue.t_end, context, `captions.cues[${index}].t_end`, 0, duration);
    if (end < start) fail(context, `captions.cues[${index}]`, "ends before it starts");
    list(cue.speakers, context, `captions.cues[${index}].speakers`).forEach((speaker, speakerIndex) => {
      const id = text(speaker, context, `captions.cues[${index}].speakers[${speakerIndex}]`);
      if (!speakerIds.has(id)) fail(context, `captions.cues[${index}].speakers[${speakerIndex}]`, `references unknown speaker ${id}`);
    });
    line(cue.source, context, `captions.cues[${index}].source`);
    list(cue.targets, context, `captions.cues[${index}].targets`).forEach((target, targetIndex) => {
      line(target, context, `captions.cues[${index}].targets[${targetIndex}]`);
      const item = record(target, context, `captions.cues[${index}].targets[${targetIndex}]`);
      if (item.withheld !== undefined) {
        if (item.text !== null) fail(context, `captions.cues[${index}].targets[${targetIndex}].text`, "must be null when withheld");
        const withheld = record(item.withheld, context, `captions.cues[${index}].targets[${targetIndex}].withheld`);
        text(withheld.gate, context, `captions.cues[${index}].targets[${targetIndex}].withheld.gate`);
        text(withheld.reason, context, `captions.cues[${index}].targets[${targetIndex}].withheld.reason`);
      }
    });
    if (cue.corroboration !== undefined) {
      const corroboration = record(cue.corroboration, context, `captions.cues[${index}].corroboration`);
      nullableNumber(corroboration.agreement, context, `captions.cues[${index}].corroboration.agreement`, 0, 1);
      text(corroboration.by, context, `captions.cues[${index}].corroboration.by`);
      text(corroboration.heard, context, `captions.cues[${index}].corroboration.heard`, true);
    }
    const owner = text(cue.owner, context, `captions.cues[${index}].owner`);
    if (!agentIds.has(owner)) fail(context, `captions.cues[${index}].owner`, `references unknown agent ${owner}`);
  });

  const score = record(bundle.score, context, "score");
  if (text(score.run, context, "score.run") !== runId) fail(context, "score.run", "does not match run.id");
  if (text(score.clip, context, "score.clip") !== clipId) fail(context, "score.clip", "does not match run.clip.id");
  if (text(score.pack, context, "score.pack") !== packId) fail(context, "score.pack", "does not match run.pack");
  const scoreStatus = text(score.status, context, "score.status");
  const paths = record(score.paths, context, "score.paths");
  if (!(runId in paths)) fail(context, `score.paths.${runId}`, "is required for the recorded run");
  for (const [id, value] of Object.entries(paths)) {
    const item = record(value, context, `score.paths.${id}`);
    text(item.label, context, `score.paths.${id}.label`);
    for (const key of ["points", "hard_line", "coverage", "time_to_usable_s", "withheld", "hallucinated"] as const) {
      nullableNumber(item[key], context, `score.paths.${id}.${key}`, 0, key === "hard_line" || key === "coverage" ? 1 : undefined);
    }
    if (item.time_to_complete_s !== undefined) {
      nullableNumber(item.time_to_complete_s, context, `score.paths.${id}.time_to_complete_s`, 0);
    }
    if (scoreStatus === "unscored" && (item.points !== null || item.hard_line !== null)) {
      fail(context, `score.paths.${id}`, "must keep points and hard_line null while score.status is unscored");
    }
  }
  nullableNumber(score.delta_vs_cold, context, "score.delta_vs_cold", -1, 1);
  if (scoreStatus === "unscored" && score.delta_vs_cold !== null) {
    fail(context, "score.delta_vs_cold", "must be null while score.status is unscored");
  }

  const pack = record(bundle.pack, context, "pack");
  if (text(pack.id, context, "pack.id") !== packId) fail(context, "pack.id", "does not match run.pack");
  const wave = record(bundle.wave, context, "wave");
  const waveDuration = number(wave.duration, context, "wave.duration", 0);
  if (Math.abs(waveDuration - duration) > 0.15) fail(context, "wave.duration", "does not match run.clip.duration");
  list(wave.peaks, context, "wave.peaks").forEach((value, index) =>
    number(value, context, `wave.peaks[${index}]`, 0, 1),
  );

  const glossary = record(bundle.glossary, context, "glossary");
  if (text(glossary.run, context, "glossary.run") !== runId) fail(context, "glossary.run", "does not match run.id");
  if (text(glossary.clip, context, "glossary.clip") !== clipId) fail(context, "glossary.clip", "does not match run.clip.id");
  if (glossary.promotion !== undefined) {
    if (glossary.promoted_to !== null) fail(context, "glossary.promoted_to", "must be null while review is pending");
    const promotion = record(glossary.promotion, context, "glossary.promotion");
    const expected = ["status", "proposal_kind", "proposal_manifest", "note"];
    const keys = Object.keys(promotion);
    if (keys.length !== expected.length || keys.some((key) => !expected.includes(key))) {
      fail(context, "glossary.promotion", "must use the closed pending-review shape");
    }
    if (text(promotion.status, context, "glossary.promotion.status") !== "pending_review") {
      fail(context, "glossary.promotion.status", "must equal pending_review");
    }
    if (text(promotion.proposal_kind, context, "glossary.promotion.proposal_kind") !== "glossary") {
      fail(context, "glossary.promotion.proposal_kind", "must equal glossary");
    }
    const manifest = text(promotion.proposal_manifest, context, "glossary.promotion.proposal_manifest");
    if (!declaredArtifacts.includes(manifest)) {
      fail(context, "glossary.promotion.proposal_manifest", "must be declared in run.artifacts");
    }
    text(promotion.note, context, "glossary.promotion.note");
  } else {
    text(glossary.promoted_to, context, "glossary.promoted_to");
  }
  list(glossary.entries, context, "glossary.entries");
  const corrections = record(bundle.corrections, context, "corrections");
  if (text(corrections.run, context, "corrections.run") !== runId) fail(context, "corrections.run", "does not match run.id");
  if (text(corrections.clip, context, "corrections.clip") !== clipId) fail(context, "corrections.clip", "does not match run.clip.id");
  list(corrections.rows, context, "corrections.rows");

  const traces = list(bundle.traces, context, "traces");
  if (traces.length === 0) fail(context, "traces", "must contain recorded evidence");
  let previous = -Infinity;
  const lifecycle = new Map<string, AgentStatus>([...agentIds].map((id) => [id, "idle"]));
  traces.forEach((value, index) => {
    trace(value, context, `traces[${index}]`, agentIds, cueIds);
    const item = value as Trace;
    if (item.action === "done" && (item.agent !== "orchestrator" || index !== traces.length - 1)) {
      fail(context, `traces[${index}]`, "terminal done trace must be the final orchestrator event");
    }
    if (item.t < previous) fail(context, `traces[${index}].t`, "is earlier than the preceding trace");
    if (item.t > (run.wall_s as number) + 0.15) fail(context, `traces[${index}].t`, "is later than run.wall_s");
    if (item.agent === "orchestrator") lifecycle.set("orchestrator", "working");
    for (const entry of item.effects ?? []) {
      if (entry.type !== "agent") continue;
      const from = lifecycle.get(entry.id) ?? "idle";
      if (from !== entry.status && !canTransition(from, entry.status)) {
        fail(
          context,
          `traces[${index}].effects`,
          `contains illegal lifecycle transition ${entry.id}: ${from} -> ${entry.status}`,
        );
      }
      lifecycle.set(entry.id, entry.status);
    }
    previous = item.t;
  });
  const last = traces.at(-1) as Trace;
  if (last.agent !== "orchestrator" || last.action !== "done") {
    fail(context, "traces", "must end with an orchestrator done trace");
  }
}
