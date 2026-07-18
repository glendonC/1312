#!/usr/bin/env node

/**
 * Materialize one immutable frozen-pack ablation pre-registration.
 *
 *   node scripts/register-ablation.mjs --draft /path/to/result-free-draft.json
 *
 * The draft cannot choose timestamps, byte bindings, configuration ids, or an ablation id. This
 * tool derives them from current frozen bytes and writes bench/ablations/<slug>/registration.json.
 */

import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { materializeAblationRegistration } from "./lib/bench-ablation.mjs";
import { writeImmutableJson } from "./lib/immutable-receipts.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function arg(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 || index === process.argv.length - 1 ? null : process.argv[index + 1];
}

function die(message) {
  console.error(`\n  ablation registration failed closed: ${message}\n`);
  process.exit(1);
}

try {
  const draftPath = arg("draft");
  if (!draftPath) die("--draft is required");
  const draft = JSON.parse(await readFile(resolve(draftPath), "utf8"));
  const registration = await materializeAblationRegistration(draft, { workspaceRoot: ROOT });
  const output = join(ROOT, "bench/ablations", registration.slug, "registration.json");
  const state = await writeImmutableJson(output, registration);
  console.log(
    `\n  ${state} bench/ablations/${registration.slug}/registration.json\n  ${registration.ablation_id}\n  results=null, judge=null; no capture or score was produced\n`,
  );
} catch (error) {
  die(error instanceof Error ? error.message : String(error));
}
