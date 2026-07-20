import { clock } from "./format";
import type { RunBundle } from "./transport";

export interface ResultAccounting {
  /** "KO → EN" — the run's recorded language pair, uppercased for display. */
  pair: string;
  /** "0:00–0:40" — the recorded clip window; a recorded clip always starts at zero. */
  range: string;
  counts: { captioned: number; withheld: number; silent: number };
  /** Every cue in range, including silence — the denominator the counts must sum to. */
  totalLines: number;
}

/**
 * The one per-line accounting of what a completed run produced, read straight from the
 * receipted captions. The workspace hero, the Source and Coverage panels, and the canvas
 * artifact all present this projection, so their numbers and labels cannot drift apart.
 */
export function projectResultAccounting(bundle: RunBundle): ResultAccounting {
  const { run, captions } = bundle;

  const counts = { captioned: 0, withheld: 0, silent: 0 };
  for (const cue of captions.cues) {
    if (cue.silence) {
      counts.silent += 1;
      continue;
    }
    const target = cue.targets.find((candidate) => candidate.lang === run.pair.target);
    if (target?.withheld) counts.withheld += 1;
    else if (target?.text) counts.captioned += 1;
  }

  return {
    pair: `${run.pair.source.toUpperCase()} → ${run.pair.target.toUpperCase()}`,
    range: `${clock(0)}–${clock(run.clip.duration)}`,
    counts,
    totalLines: captions.cues.length,
  };
}
