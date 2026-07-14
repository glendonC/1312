#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { canonicalJson, canonicalJsonLine } from "../src/studio/runtime/production/observability/hash.ts";
import { buildRuntimeObservabilityIndex } from "../src/studio/runtime/production/observability/indexer.ts";
import { validateRuntimeObservabilityIndex } from "../src/studio/runtime/production/observability/validation.ts";

function usage(): never {
  throw new Error(
    "Usage: node scripts/index-runtime-observability.ts <events.ndjson> [observability.json] [--check]",
  );
}

const argumentsList = process.argv.slice(2);
const check = argumentsList.includes("--check");
const positional = argumentsList.filter((argument) => argument !== "--check");
if (positional.length < 1 || positional.length > 2 || (check && positional.length !== 2)) usage();

const journalPath = resolve(positional[0]);
const outputPath = positional[1] ? resolve(positional[1]) : null;
const rawJournal = await readFile(journalPath, "utf8");
const rebuilt = await buildRuntimeObservabilityIndex(rawJournal);

if (check) {
  const recorded = JSON.parse(await readFile(outputPath!, "utf8")) as unknown;
  await validateRuntimeObservabilityIndex(recorded);
  if (canonicalJson(recorded) !== canonicalJson(rebuilt)) {
    throw new Error(`Observability index ${outputPath} does not equal a deterministic rebuild`);
  }
  process.stdout.write(`validated ${rebuilt.indexId}\n`);
} else if (outputPath) {
  await writeFile(outputPath, canonicalJsonLine(rebuilt), {
    encoding: "utf8",
    mode: 0o600,
    flag: "wx",
  });
  process.stdout.write(`wrote ${outputPath} (${rebuilt.indexId})\n`);
} else {
  process.stdout.write(canonicalJsonLine(rebuilt));
}
