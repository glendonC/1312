#!/usr/bin/env node

import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  captureExecutorPath,
  materializeCaptureExecutor,
} from "./lib/bench-capture-executor.mjs";
import { writeImmutableJson } from "./lib/immutable-receipts.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function usage(message = null) {
  if (message) console.error(`\n  ${message}\n`);
  console.error(`Usage:
  node scripts/certify-rule-change-executor.mjs \\
    --adapter <host-owned-adapter-id> --notes <audit-note>
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
  const executor = await materializeCaptureExecutor(
    { adapterId: one("adapter"), notes: one("notes") },
    { workspaceRoot: ROOT },
  );
  const path = captureExecutorPath(executor);
  const state = await writeImmutableJson(resolve(ROOT, path), executor);
  console.log(`${executor.executor_id}\n${path} (${state})`);
}

main().catch((error) => {
  console.error(`\n  ${error instanceof Error ? error.message : error}\n`);
  process.exit(1);
});
