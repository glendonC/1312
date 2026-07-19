#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { materializeRuleChangeRegistration } from "./lib/bench-rule-change.mjs";
import { writeImmutableJson } from "./lib/immutable-receipts.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function usage(message = null) {
  if (message) console.error(`\n  ${message}\n`);
  console.error(`Usage:
  node scripts/register-rule-change.mjs --draft <draft.json> --out <registration.json> \\
    [--campaign-approval <approval.json>]
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
  if (!value || value.startsWith("--")) usage(`--${name} requires a value`);
  return value;
}

async function main() {
  const draftPath = arg("draft", { required: true });
  const out = arg("out", { required: true });
  const draft = JSON.parse(await readFile(resolve(ROOT, draftPath), "utf8"));
  const registration = await materializeRuleChangeRegistration(draft, {
    workspaceRoot: ROOT,
    campaignApprovalPath: arg("campaign-approval"),
  });
  const state = await writeImmutableJson(resolve(ROOT, out), registration);
  console.log(`${registration.registration_id}\n${out} (${state})`);
}

main().catch((error) => {
  console.error(`\n  ${error instanceof Error ? error.message : error}\n`);
  process.exit(1);
});
