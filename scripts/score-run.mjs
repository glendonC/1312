#!/usr/bin/env node

/**
 * Scores one pinned capture against one frozen gold clip.
 *
 *   node scripts/score-run.mjs --run run-007 --pack hard-ko-v1 \
 *     --labels bench/reviews/labels/run-007.json [--scored-at <iso>]
 *
 * This is the moment the whole conveyor exists for, so it is the most refusable step in the
 * repository. It will not run unless:
 *
 *   - the pack is FROZEN: gold bytes re-hashed now must match what the freeze receipt bound,
 *     together with two distinct blinded human adjudication receipts (a candidate or amended
 *     gold file scores nothing);
 *   - the capture was pinned strictly AFTER the freeze day (pre-registration: gold written
 *     after seeing a run's output would be grading the run against itself; same-day ordering
 *     is unprovable, so same-day fails too);
 *   - human output labels bind the exact capture bytes and judge every emitted line — and only
 *     emitted lines. Withheld and missing are mechanical facts read off the capture.
 *
 * What it emits is a content-addressed score receipt in bench/scores/<run>/score.json: per-line
 * four-way outcomes, critical-meaning and catastrophic headline values with null-never-zero
 * rates, measured latency copied from the capture, and delta_vs_cold when the capture carries
 * both a subject and an internal control. There is NO composite score, coverage appears
 * nowhere, and `judge` is pinned null: no model grades anything in this pipeline. If an LLM
 * judge is ever added it must arrive as a visible schema change carrying a pinned
 * different-family model and prompt hash — not as a default this script quietly grows.
 */

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  readJsonFile,
  scoreCapture,
  validateFreezeReceipt,
  validateGold,
  validateOutputLabels,
  validatePack,
} from "./lib/bench-gold.mjs";
import { fileReceipt, writeImmutableJson } from "./lib/immutable-receipts.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 || i === process.argv.length - 1 ? fallback : process.argv[i + 1];
}

function die(message) {
  console.error(`\n  score-run failed closed: ${message}\n`);
  process.exit(1);
}

const RUN = arg("run");
const PACK = arg("pack");
const LABELS = arg("labels");
if (!RUN || !PACK) die("--run and --pack are required");
if (!LABELS) die("--labels is required: correctness exists only as human judgment, and this pipeline has no other way to know it");

try {
  const packDir = join(ROOT, "bench/packs", PACK);
  const pack = validatePack(await readJsonFile(join(packDir, "pack.json"), `pack ${PACK}`), `pack ${PACK}`);
  if (!pack.frozen || pack.freeze_receipt === null) {
    die(`pack ${PACK} is not frozen. Candidate gold scores nothing: freezing requires two blinded human adjudication receipts per clip, and that human step has not happened.`);
  }
  const freezePath = join(packDir, pack.freeze_receipt);
  const freeze = validateFreezeReceipt(await readJsonFile(freezePath, `freeze receipt ${PACK}`), `freeze receipt ${PACK}`);
  if (freeze.pack_id !== PACK) die(`freeze receipt names ${freeze.pack_id}, not ${PACK}`);

  const capturePath = join(ROOT, "bench/runs", RUN, "capture.json");
  const capture = await readJsonFile(capturePath, `capture ${RUN}`);
  if (capture.capture_id !== RUN) die(`capture names ${capture.capture_id}, not ${RUN}`);

  const packClip = pack.clips.find((clip) => clip.clip_id === capture.clip.id);
  if (!packClip) die(`capture ${RUN} is over clip ${capture.clip.id}, which is not in pack ${PACK}`);

  const goldPath = join(packDir, packClip.gold_path);
  const gold = await validateGold(await readJsonFile(goldPath, `gold ${packClip.gold_path}`), `gold ${packClip.gold_path}`);

  const labelsPath = join(ROOT, LABELS);
  const labels = validateOutputLabels(await readJsonFile(labelsPath, `output labels ${LABELS}`), `output labels ${LABELS}`);

  const bindings = {
    gold: await fileReceipt(goldPath, `bench/packs/${PACK}/${packClip.gold_path}`),
    freeze: await fileReceipt(freezePath, `bench/packs/${PACK}/${pack.freeze_receipt}`),
    capture: await fileReceipt(capturePath, `bench/runs/${RUN}/capture.json`),
    labels: await fileReceipt(labelsPath, LABELS),
  };

  const receipt = scoreCapture({
    gold,
    freeze,
    capture,
    labels,
    bindings,
    scoredAt: arg("scored-at", new Date().toISOString()),
  });

  const out = join(ROOT, "bench/scores", RUN, "score.json");
  const state = await writeImmutableJson(out, receipt);

  const lines = Object.entries(receipt.systems)
    .map(([id, system]) => {
      const meaning = system.headline.critical_meaning;
      const catastrophic = system.headline.catastrophic;
      const outcomes = system.headline.critical_outcomes;
      return `    ${id.padEnd(16)} meaning ${meaning.passes}/${meaning.total} · outcomes c${outcomes.correct} w${outcomes.wrong} h${outcomes.withheld} m${outcomes.missing} · catastrophic ${catastrophic.count}/${catastrophic.denominator}`;
    })
    .join("\n");

  console.log(`
  scored ${RUN} against frozen ${PACK} -> bench/scores/${RUN}/score.json (${state})

${lines}

  Every correct/wrong above is a human label; every withheld/missing is mechanical; the rates
  with zero denominators are null, not zero. delta_vs_cold: ${receipt.delta_vs_cold ? JSON.stringify(receipt.delta_vs_cold) : "null (capture lacks a subject + internal control pair)"}
`);
} catch (error) {
  die(error instanceof Error ? error.message : String(error));
}
