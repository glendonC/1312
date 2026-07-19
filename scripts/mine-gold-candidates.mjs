/**
 * Mines one recorded run's own misses into gold CANDIDATES.
 *
 *   node scripts/mine-gold-candidates.mjs --run run-006 --route gold --reason "..."
 *
 * This script DERIVES; it does not judge, call a model, or write a word of gold. Every candidate
 * is a cue the run itself flagged — a gate that fired, a cross-check that produced nothing, a
 * ko-v3 phenomenon detection, a cold/prepped divergence — copied out of the run folder with its
 * time window and its evidence, so a human adjudication pass has something concrete to start
 * from. `korean_gold` is pinned null on every candidate: what was actually said is a human's to
 * write, in a separate gold candidate file, behind two blinded reviews.
 *
 * The one decision this script does record is ROUTING, and it records it before anyone knows
 * what the clip will score. Every mined clip goes to exactly one pool:
 *
 *   gold      its misses may become bench gold; the clip then contributes NOTHING to glossary,
 *             rules, correction pairs, or any future training export — ever
 *   training  its misses may feed memory and future training rows; the clip may then never
 *             enter a bench pack
 *
 * check-bench.mjs enforces both directions across the whole repository. Routing after seeing
 * outcomes is the classic way to launder a test set into training data, which is why the route
 * is demanded up front, written immutably, and never defaulted.
 */

import { join } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  candidatesManifestId,
  validateCandidatesManifest,
  readJsonFile,
} from "./lib/bench-gold.mjs";
import { fileReceipt, writeImmutableJson } from "./lib/immutable-receipts.mjs";
import { normalizeSourceReceipt } from "./lib/source-receipts.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 || i === process.argv.length - 1 ? fallback : process.argv[i + 1];
}

function die(message) {
  console.error(`\n  ${message}\n`);
  process.exit(1);
}

const RUN = arg("run", "run-006");
const ROUTE = arg("route");
const REASON = arg("reason");

if (ROUTE !== "gold" && ROUTE !== "training") {
  die("--route gold|training is required. Routing is decided at mine time, before outcomes exist; there is no default.");
}
if (!REASON || !REASON.trim()) {
  die("--reason is required: the routing decision is immutable and must say why it was made.");
}

const DIR = join(ROOT, "public/demo/runs", RUN);
const OUT = join(ROOT, "bench/candidates", RUN, "candidates.json");

const run = await readJsonFile(join(DIR, "run.json"), `${RUN} run.json`);
const captions = await readJsonFile(join(DIR, "captions.json"), `${RUN} captions.json`);
const corrections = await readJsonFile(join(DIR, "corrections.json"), `${RUN} corrections.json`);
// Validates the rights receipt before anything is mined; a run without a normalizable source
// receipt does not get to seed a benchmark.
normalizeSourceReceipt(await readJsonFile(join(DIR, "source.json"), `${RUN} source.json`));

if (captions.clip !== run.clip.id || corrections.clip !== run.clip.id) {
  die(`${RUN} artifacts disagree about their clip id`);
}

/* --------------------------------------------------------------- candidates */

const SUBJECT = "1321-prepped";
const CONTROL = "1321-cold";

const candidates = [];
const counts = { withheld: 0, uncorroborated_commit: 0, phenomenon: 0, contrast: 0 };

for (const cue of captions.cues) {
  const target = cue.targets?.[0] ?? null;
  const emitted = typeof target?.text === "string";
  const withheld = target?.withheld ?? null;
  const coldText = cue.baseline?.target?.text ?? null;

  const signals = [];
  if (withheld) signals.push("withheld");
  if (emitted && cue.corroboration?.agreement === null) signals.push("uncorroborated_commit");
  if (cue.hard === true) signals.push("phenomenon");
  if (emitted && typeof coldText === "string" && coldText !== target.text) signals.push("contrast");
  if (signals.length === 0) continue;
  // Silence / non-speech cues can carry a phenomenon flag with a null source text; the
  // candidates schema requires a non-empty source_text, so those cues are not mineable.
  if (typeof cue.source?.text !== "string" || cue.source.text.trim().length === 0) continue;

  for (const signal of signals) counts[signal] += 1;

  candidates.push({
    t_start: cue.t_start,
    t_end: cue.t_end,
    source_text: cue.source.text,
    speakers: cue.speakers ?? [],
    signals,
    gate: withheld ? { id: withheld.gate, reason: withheld.reason } : null,
    corroboration: cue.corroboration ?? null,
    phenomenon: cue.hard === true ? (cue.error_subtype ?? null) : null,
    outputs: {
      [SUBJECT]: { text: emitted ? target.text : null, withheld },
      [CONTROL]: { text: typeof coldText === "string" ? coldText : null, withheld: null },
    },
    // Pinned. Gold is a human's to write, elsewhere, behind two blinded reviews.
    korean_gold: null,
    status: "candidate",
  });
}

if (candidates.length === 0) die(`${RUN} yielded no candidates; nothing to record`);

/* ----------------------------------------------------------------- manifest */

const sourceArtifacts = [];
for (const name of ["run.json", "captions.json", "corrections.json", "source.json"]) {
  sourceArtifacts.push(await fileReceipt(join(DIR, name), `public/demo/runs/${RUN}/${name}`));
}

const body = {
  schema: "studio.bench.candidates.v1",
  run: RUN,
  clip: { id: run.clip.id, lang: run.pair.source, duration_s: run.clip.duration },
  routing: { route: ROUTE, reason: REASON.trim() },
  status: "candidate",
  scorable: false,
  source_artifacts: sourceArtifacts,
  candidates,
  notes: `Derived from the recorded ${RUN} artifacts only. ${candidates.length} of ${captions.cues.length} cues carry at least one signal: ${counts.withheld} withheld by a gate, ${counts.uncorroborated_commit} committed uncorroborated, ${counts.phenomenon} ko-v3 phenomenon detections, ${counts.contrast} cold/prepped divergences. A signal is a reason for a human to look, not a verdict: nothing here says any line was right or wrong, and no candidate can be scored against. ${corrections.rows.length} correction rows exist in the run folder and are deliberately NOT candidates; corrections flow through the memory ledger, and this clip's route (${ROUTE}) decides which of the two pools — bench or memory — this clip may ever feed.`,
};

const manifest = { manifest_id: candidatesManifestId(body), ...body };
validateCandidatesManifest(manifest, `candidates manifest ${RUN}`);

const state = await writeImmutableJson(OUT, manifest);

console.log(`
  mined ${RUN} -> bench/candidates/${RUN}/candidates.json (${state})

  clip ${run.clip.id} routed: ${ROUTE.toUpperCase()} (exclusive; enforced by bench:check)
  ${candidates.length}/${captions.cues.length} cues carry a signal:
    withheld               ${counts.withheld}
    uncorroborated commit  ${counts.uncorroborated_commit}
    phenomenon (ko-v3)     ${counts.phenomenon}
    cold/prepped contrast  ${counts.contrast}

  korean_gold: null on every candidate. Drafting is a separate step; freezing needs two
  blinded human reviewers, and scoring needs a freeze receipt. This file alone proves nothing.
`);
