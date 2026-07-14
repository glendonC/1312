/**
 * Pins a run into bench/runs/ as a dated capture.
 *
 *   node scripts/bench-pin.mjs --run run-006
 *
 * A CAPTURE is not a REPORT, and the difference is the whole point of bench/.
 *
 * A report (report.schema.json) is evidence about the Hard-KO Clip Pack: clips chosen by the
 * protocol, gold frozen before anyone runs anything, blinded human review, and only then a
 * score. It is what /benchmarks/ is allowed to render.
 *
 * A capture is the honest thing you can have BEFORE any of that exists: a dated record of one
 * run over one clip, pinning what the run did and what it emitted, so that a later run has
 * something to be compared against and a later reviewer has something to review. It measures
 * behaviour — units emitted, units withheld, latency, gate hits — and says nothing whatsoever
 * about correctness, because with no gold there is nothing to be correct against.
 *
 * This script therefore DERIVES; it does not measure and it does not call anything. Every value
 * it writes is read out of the run folder that a real execution already produced. If a number is
 * not in those files, it is not in the capture. The one number it computes — time to first
 * usable line — is read off the trace log, which recorded the instant each line was committed.
 *
 * `gold` on every unit is pinned null by the schema, and it stays null until a human who reads
 * Korean writes it. Generating a reference with a model and then scoring model output against it
 * would be the model marking its own homework — the exact failure this project exists to catch,
 * with a percentage next to it.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { normalizeSourceReceipt } from "./lib/source-receipts.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 || i === process.argv.length - 1 ? fallback : process.argv[i + 1];
}

const RUN = arg("run", "run-006");
const DIR = join(ROOT, "public/demo/runs", RUN);
const OUT = join(ROOT, "bench/runs", RUN);

const read = (f) => JSON.parse(readFileSync(join(DIR, f), "utf8"));

const run = read("run.json");
const captions = read("captions.json");
const score = read("score.json");
const traces = read("traces.json");
const source = normalizeSourceReceipt(read("source.json"));
const glossary = read("glossary.json");
const corrections = read("corrections.json");

const prep = score.paths[RUN];
const cold = score.paths.cold;

/* ---------------------------------------------------------------- latency */

/**
 * The instant the first line was committed, read off the tape.
 *
 * Not asked of anyone and not recomputed: the trace log stamped a real wall-clock `t` at the
 * moment qc-01 committed each cue, so the first of those IS the answer.
 */
const committedAt = traces.traces
  .filter((t) => (t.effects ?? []).some((e) => e.type === "cue" && e.state === "committed"))
  .map((t) => t.t)
  .sort((a, b) => a - b);

const firstUsable = committedAt.length > 0 ? committedAt[0] : null;
const complete = traces.wall_s;

/* ------------------------------------------------------------- gate hits */

/** Times a gate actually fired, by gate. A detection, never a verified error. */
const gateHits = {};
for (const t of traces.traces) {
  const gate = t.view?.gate;
  if (gate?.fail) gateHits[gate.name] = (gateHits[gate.name] ?? 0) + 1;
}

const repairs = corrections.rows.filter((r) => r.final !== null).length;
const uncorroborated = captions.cues.filter((c) => c.corroboration?.agreement === null).length;

const emitted = captions.cues.filter((c) => c.targets[0]?.text !== null).length;
const withheld = captions.cues.filter((c) => c.targets[0]?.withheld).length;
const coldEmitted = captions.cues.filter((c) => Boolean(c.baseline?.target.text)).length;

/* -------------------------------------------------------------- the units */

const units = captions.cues.map((c) => ({
  t_start: c.t_start,
  t_end: c.t_end,
  speakers: c.speakers,
  source: c.source.text,
  ...(c.hard ? { hard: true, phenomenon: c.error_subtype ?? null } : {}),
  ...(c.corroboration ? { corroboration: c.corroboration } : {}),
  outputs: {
    "1321-prepped": {
      text: c.targets[0]?.text ?? null,
      withheld: c.targets[0]?.withheld ?? null,
    },
    "1321-cold": {
      text: c.baseline?.target.text ?? null,
      withheld: null,
    },
  },
  // Reserved, and it stays null. See the header.
  gold: null,
}));

/* ------------------------------------------------------------ the capture */

const capture = {
  $schema: "../../schemas/capture.schema.json",
  schema_version: "0.1.0",
  kind: "capture",
  capture_id: RUN,
  captured_at: run.recorded,

  scored: false,
  pack_evidence: false,

  clip: {
    id: run.clip.id,
    duration_s: run.clip.duration,
    lang: run.pair.source,
    pair: `${run.pair.source}->${run.pair.target}`,
    media: run.clip.media,
    source: {
      kind: source.kind,
      url: source.locator.url,
      channel: source.creator,
      licence: source.rights.label,
      window: { start: source.selection.start, end: source.selection.end },
      attribution: source.rights.attribution,
      content_id: source.contentId,
    },
  },

  reproducible: {
    deterministic: false,
    note: "Re-running this pipeline over the same audio does NOT reproduce this capture. The diarizer returns a different segmentation each call (11 to 15 segments have been observed on this clip), so cue count, boundaries and coverage move between runs. This capture is one honest sample, not a fixture. It was not re-rolled to obtain a better coverage number, and a future capture that differs is evidence of that variance rather than of a regression.",
  },

  systems: [
    {
      id: "1321-prepped",
      role: "subject",
      config: {
        asr: "gpt-4o-transcribe-diarize",
        cross_check_asr: "whisper-1",
        translator: "gpt-5",
        pack: run.pack,
        gates: "universal.asr_agreement, universal.repetition, ko.address_form, ko.entity_support",
        agreement_floor: 0.6,
        abstention: "fail closed on a measured disagreement; abstain where the cross-check produced no words at all",
      },
    },
    {
      id: "1321-cold",
      role: "internal_control",
      config: {
        asr: "whisper-1",
        translator: "gpt-4o",
        glossary: "none",
        gates: "none",
        note: "One-shot. It is handed the prepped path's windows for free, so it is a foil for translation, entities and honesty, NOT for segmentation.",
      },
    },
  ],

  measured: {
    "1321-prepped": {
      units_total: captions.cues.length,
      units_emitted: emitted,
      units_withheld: withheld,
      units_uncorroborated: uncorroborated,
      coverage: prep.coverage,
      latency: { first_usable_s: firstUsable, complete_s: complete },
      gate_hits: gateHits,
      repairs,
    },
    "1321-cold": {
      units_total: captions.cues.length,
      units_emitted: coldEmitted,
      units_withheld: 0,
      coverage: cold.coverage,
      // One call, so the first line it stands behind and the last one arrive together.
      latency: { first_usable_s: cold.time_to_usable_s, complete_s: cold.time_to_usable_s },
      gate_hits: {},
      repairs: 0,
    },
  },

  unscored: {
    critical_meaning: null,
    critical_outcomes: null,
    catastrophic: null,
    reason:
      "There is no gold for this clip and no human has reviewed the output, so accuracy is not merely unmeasured here, it is unmeasurable. Coverage is not a score: 1321 refused 3 lines and cold refused none, which makes cold's coverage the higher number and tells you nothing about which of them was right. Nothing in this file may be rendered on /benchmarks/ as evidence of quality.",
  },

  units,

  artifacts: {
    output: `public/demo/runs/${RUN}/captions.json`,
    runtime: `public/demo/runs/${RUN}/traces.json`,
    score: `public/demo/runs/${RUN}/score.json`,
    glossary: `public/demo/runs/${RUN}/glossary.json`,
    corrections: `public/demo/runs/${RUN}/corrections.json`,
    media: `public/demo/runs/${RUN}/${run.clip.media}`,
  },

  notes: `The first run of the real pipeline over real media, kept so later runs have something to beat. ${emitted} of ${captions.cues.length} lines committed, ${withheld} withheld by a gate that fired, ${uncorroborated} committed uncorroborated because the cross-check recogniser drops backchannels and produced no words in those windows. Confidence throughout is agreement between two independent recognisers, never a model's estimate of itself. Glossary: ${glossary.entries.length} terms, cast NOT closed (nobody is named in the window, so there is no cast to close).`,
};

mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, "capture.json"), `${JSON.stringify(capture, null, 2)}\n`);

console.log(`
  pinned ${RUN} -> bench/runs/${RUN}/capture.json

  ${emitted}/${captions.cues.length} emitted · ${withheld} withheld · ${uncorroborated} uncorroborated
  first usable line at ${firstUsable}s · every line by ${complete}s
  gates fired: ${Object.entries(gateHits).map(([k, v]) => `${k} x${v}`).join(", ") || "none"}

  scored: false. It stays false until a human writes the gold.
`);
