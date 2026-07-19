#!/usr/bin/env node

/**
 * Compare two score receipts on the same frozen pack/clip.
 *
 *   node scripts/compare-scores.mjs \
 *     --without bench/scores/run-007/score.json \
 *     --with bench/scores/<run-N>/score.json \
 *     [--with-memory memory/review/consumptions/<digest>.json] \
 *     [--out bench/scores/pairs/<slug>.json]
 *
 * Does not invent labels or captures. The with-memory binding is optional; omit it for
 * structural pairs. Product claims that the with side consumed reviewed memory must pass
 * --with-memory.
 */

import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  compareSubjectScores,
  pairedMemoryBindingFromReceipt,
} from "./lib/bench-paired-score.mjs";
import { fileReceipt, writeImmutableJson } from "./lib/immutable-receipts.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function usage(message = null) {
  if (message) console.error(`\n  ${message}\n`);
  console.error(`Usage:
  node scripts/compare-scores.mjs \\
    --without <score.json> --with <score.json> \\
    [--with-memory <consumption.json>] [--subject 1321-prepped] \\
    [--compared-at <iso>] [--out <pair.json>]
`);
  process.exit(1);
}

function arg(name, { required = false } = {}) {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) {
    if (required) usage(`--${name} is required`);
    return null;
  }
  const value = process.argv[index + 1];
  if (value === undefined || value.startsWith("--")) usage(`--${name} requires a value`);
  return value;
}

async function readJson(path, context) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    throw new Error(`${context} ${path} is not readable JSON`, { cause: error });
  }
}

async function main() {
  const withoutPath = arg("without", { required: true });
  const withPath = arg("with", { required: true });
  const withMemoryPath = arg("with-memory");
  const subject = arg("subject") ?? "1321-prepped";
  const comparedAt = arg("compared-at") ?? new Date().toISOString();
  const out = arg("out");

  const withoutAbs = resolve(ROOT, withoutPath);
  const withAbs = resolve(ROOT, withPath);
  const withoutScore = await readJson(withoutAbs, "without score");
  const withScore = await readJson(withAbs, "with score");
  const withoutBinding = await fileReceipt(withoutAbs, withoutPath);
  const withBinding = await fileReceipt(withAbs, withPath);

  let withMemory = null;
  if (withMemoryPath) {
    const memoryAbs = resolve(ROOT, withMemoryPath);
    const memory = await readJson(memoryAbs, "with-memory consumption");
    withMemory = await pairedMemoryBindingFromReceipt({
      receipt: memory,
      binding: await fileReceipt(memoryAbs, withMemoryPath),
      expectedRun: withScore.run,
    });
  }

  const pair = compareSubjectScores({
    withoutScore,
    withScore,
    withoutBinding,
    withBinding,
    withoutMemory: null,
    withMemory,
    subjectSystemId: subject,
    comparedAt,
  });

  if (out) {
    const state = await writeImmutableJson(resolve(ROOT, out), pair);
    console.log(`${pair.pair_id}\n${out} (${state})`);
  } else {
    console.log(JSON.stringify(pair, null, 2));
  }
}

main().catch((error) => {
  console.error(`\n  ${error instanceof Error ? error.message : error}\n`);
  process.exit(1);
});
