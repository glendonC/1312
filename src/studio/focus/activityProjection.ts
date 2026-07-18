/**
 * Typed projection of one worker's recorded activity, for the focus-panel feed.
 *
 * The feed used to print each trace's raw action/target/detail as a flat prose stack. But a
 * recorded trace already carries STRUCTURED evidence in its `view`: a translation draft with its
 * cross-recogniser agreement, a QC gate with its measured value and limit, a resolved glossary
 * term, a hard mark, a withhold/correct stamp. This module lifts each of those into a typed facet
 * the renderer can format on its own terms instead of trusting prose to carry the shape.
 *
 * Honesty rule (mirrors spawnLead.ts / recordedForecast.ts): nothing here invents a datum. Every
 * facet is read straight off the recorded `view`, and the time counter is summed only from
 * recorded `t`/`clip_t`. A draft with no measurable agreement stays `null` — never a zero, which
 * would read as "the two recognisers disagreed" instead of "there was nothing to compare". Absent
 * evidence stays absent; there is no token or usage facet, because replay carries no such receipt.
 */

import type { Trace, TraceLevel } from "../types";

/** One structured, ready-to-format fragment lifted from a trace's recorded `view`. */
export type ActivityFacet =
  | { kind: "gloss"; term: string; gloss: string }
  | { kind: "draft"; source: string; target: string; agreement: number | null }
  | { kind: "mark"; label: string; hard: boolean }
  | { kind: "gate"; name: string; value: number; limit: number; failed: boolean }
  | { kind: "stamp"; verdict: "withheld" | "corrected" | "dropped"; text: string };

/** One recorded event, ready to render: base fields plus any typed facets from its view. */
/**
 * A recorded `detail` string, pulled apart into structure. Demo details pack several facts into one
 * ` · `-joined line ("40s · Creative Commons · 16k mono"); rather than reprint that middot soup, we
 * split it: short facts become discrete `chips`, and anything sentence-like becomes a `lines` of
 * prose. Nothing is invented — every piece is a verbatim slice of the recorded detail.
 */
export interface ActivityDetail {
  chips: string[];
  lines: string[];
}

export interface ActivityEntry {
  action: string;
  target: string | null;
  level: TraceLevel;
  /** Media time this event points at (playhead first, then clip_t), or null when neither exists. */
  clipT: number | null;
  /** The recorded detail, split into scannable chips and prose lines. */
  detail: ActivityDetail;
  /** Structured facets lifted from the recorded view, in a stable display order. */
  facets: ActivityFacet[];
}

/** Recorded activity totals for one agent. Real: summed only from recorded `t`/`clip_t`. */
export interface ActivityCounter {
  /** Number of recorded events. */
  events: number;
  /** Wall-clock seconds of the first and last recorded event. */
  firstT: number;
  lastT: number;
  /** Active wall-clock span between them, in seconds (>= 0). */
  spanS: number;
  /** Media window (clip seconds) the events touched, or null when none carried one. */
  mediaFromS: number | null;
  mediaToS: number | null;
}

/** The media time a trace points at: an explicit playhead wins, then clip_t, else none. */
function mediaTimeOf(trace: Trace): number | null {
  if (typeof trace.view?.playhead === "number") return trace.view.playhead;
  if (typeof trace.clip_t === "number") return trace.clip_t;
  return null;
}

/** Lift the typed facets out of a trace's recorded view. Order is stable and deterministic. */
export function activityFacets(trace: Trace): ActivityFacet[] {
  const view = trace.view;
  if (!view) return [];
  const facets: ActivityFacet[] = [];
  if (view.gloss) {
    facets.push({ kind: "gloss", term: view.gloss.term, gloss: view.gloss.gloss });
  }
  if (view.draft) {
    facets.push({
      kind: "draft",
      source: view.draft.source,
      target: view.draft.target,
      agreement: view.draft.conf,
    });
  }
  if (view.mark) {
    facets.push({ kind: "mark", label: view.mark.label, hard: view.mark.hard ?? false });
  }
  if (view.gate) {
    facets.push({
      kind: "gate",
      name: view.gate.name,
      value: view.gate.value,
      limit: view.gate.limit,
      failed: view.gate.fail ?? false,
    });
  }
  if (view.stamp) {
    facets.push({ kind: "stamp", verdict: view.stamp.kind, text: view.stamp.text });
  }
  return facets;
}

/**
 * A detail slice reads as prose (its own line) when it is long or sentence-like; else it is a chip.
 * A bare period between digits ("1.00", "16.2s") is a decimal, not a sentence end — only a period
 * that closes a clause (followed by a space or the end) counts.
 */
function isProseSlice(slice: string): boolean {
  return slice.length > 22 || /[;:!?]/.test(slice) || /\.(\s|$)/.test(slice) || /["'“”‘’「」『』]/.test(slice);
}

/**
 * Split a recorded detail on its ` · ` joins into scannable chips and prose lines. When the entry
 * already carries a typed facet for a fact (a draft's agreement, a gate's verdict), the chip that
 * would restate it is dropped so the two layers don't echo each other.
 */
export function parseDetail(detail: string | null | undefined, facets: ActivityFacet[]): ActivityDetail {
  if (!detail || !detail.trim()) return { chips: [], lines: [] };
  const covered = new Set(facets.map((facet) => facet.kind));
  const chips: string[] = [];
  const lines: string[] = [];
  for (const raw of detail.split(" · ")) {
    const slice = raw.trim();
    if (!slice) continue;
    if (isProseSlice(slice)) {
      lines.push(slice);
      continue;
    }
    const lower = slice.toLowerCase();
    const echoesAgreement = (covered.has("draft") || covered.has("gate")) && lower.includes("agreement");
    const echoesVerdict = covered.has("stamp")
      && ["withheld", "corrected", "dropped"].includes(lower);
    if (echoesAgreement || echoesVerdict) continue;
    chips.push(slice);
  }
  return { chips, lines };
}

/** Project one recorded trace into a typed activity entry. Pure: same trace in, same entry out. */
export function projectActivityEntry(trace: Trace): ActivityEntry {
  const facets = activityFacets(trace);
  return {
    action: trace.action,
    target: trace.target && trace.target.trim() ? trace.target : null,
    level: trace.level,
    clipT: mediaTimeOf(trace),
    detail: parseDetail(trace.detail, facets),
    facets,
  };
}

/**
 * Sum one agent's recorded activity into a real time/count reading. Returns null for an empty log
 * so the caller renders nothing rather than a fabricated zero-span counter.
 */
export function activityCounter(log: Trace[]): ActivityCounter | null {
  if (log.length === 0) return null;
  let firstT = Infinity;
  let lastT = -Infinity;
  let mediaFrom = Infinity;
  let mediaTo = -Infinity;
  for (const trace of log) {
    if (trace.t < firstT) firstT = trace.t;
    if (trace.t > lastT) lastT = trace.t;
    const media = mediaTimeOf(trace);
    if (media !== null) {
      if (media < mediaFrom) mediaFrom = media;
      if (media > mediaTo) mediaTo = media;
    }
  }
  const hasMedia = mediaFrom !== Infinity;
  return {
    events: log.length,
    firstT,
    lastT,
    spanS: lastT - firstT,
    mediaFromS: hasMedia ? mediaFrom : null,
    mediaToS: hasMedia ? mediaTo : null,
  };
}
