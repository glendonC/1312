#!/usr/bin/env node

import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  certifiedReleasePath,
  materializeCertifiedRelease,
} from "./lib/bench-certified-release.mjs";
import { validateRuleChangeRegistration } from "./lib/bench-rule-change.mjs";
import { writeImmutableJson } from "./lib/immutable-receipts.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function usage(message = null) {
  if (message) console.error(`\n  ${message}\n`);
  console.error(`Usage:
  node scripts/certify-rule-change-release.mjs \\
    --registration <registration.json> --side <without|with>
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

async function main() {
  const registrationPath = one("registration");
  const side = one("side");
  const release = await materializeCertifiedRelease(
    { registrationPath, side },
    { workspaceRoot: ROOT, validateRegistration: validateRuleChangeRegistration },
  );
  const path = certifiedReleasePath(release);
  const state = await writeImmutableJson(resolve(ROOT, path), release);
  console.log(`${release.release_id}\n${path} (${state})`);
}

main().catch((error) => {
  console.error(`\n  ${error instanceof Error ? error.message : error}\n`);
  process.exit(1);
});
