#!/usr/bin/env node

import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { materializeRuleChangeResult } from "./lib/bench-rule-change.mjs";
import { writeImmutableJson } from "./lib/immutable-receipts.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function usage(message = null) {
  if (message) console.error(`\n  ${message}\n`);
  console.error(`Usage:
  node scripts/qualify-rule-change.mjs \\
    --registration <registration.json> --pair <pair.json> [--pair <pair.json> ...] \\
    --out <result.json>
`);
  process.exit(1);
}

function one(name) {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) usage(`--${name} is required`);
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) usage(`--${name} requires a value`);
  return value;
}

function many(name) {
  const values = [];
  for (let index = 0; index < process.argv.length; index += 1) {
    if (process.argv[index] !== `--${name}`) continue;
    const value = process.argv[index + 1];
    if (!value || value.startsWith("--")) usage(`--${name} requires a value`);
    values.push(value);
  }
  if (values.length === 0) usage(`at least one --${name} is required`);
  return values;
}

async function main() {
  const registrationPath = one("registration");
  const pairPaths = many("pair");
  const out = one("out");
  const result = await materializeRuleChangeResult(
    { registrationPath, pairPaths },
    { workspaceRoot: ROOT },
  );
  const state = await writeImmutableJson(resolve(ROOT, out), result);
  console.log(`${result.result_id}\n${result.qualification.status}\n${out} (${state})`);
}

main().catch((error) => {
  console.error(`\n  ${error instanceof Error ? error.message : error}\n`);
  process.exit(1);
});
