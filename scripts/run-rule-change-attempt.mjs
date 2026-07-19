#!/usr/bin/env node

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { validateRuleChangeRegistration } from "./lib/bench-rule-change.mjs";
import { runSingleAttempt } from "./lib/bench-single-attempt.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function usage(message = null) {
  if (message) console.error(`\n  ${message}\n`);
  console.error(`Usage:
  node scripts/run-rule-change-attempt.mjs \\
    --registration <registration.json> --release <release.json> \\
    --executor <executor.json> --run <run-id> --side <without|with> \\
    [--allow-live-provider]

Provider execution additionally requires STUDIO_BENCH_PROVIDER_MODE=live and OPENAI_API_KEY.
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
  const allowLiveProvider = process.argv.includes("--allow-live-provider");
  const providerExecution = allowLiveProvider
    ? {
        mode: "live",
        allowLive: true,
        environment: process.env.STUDIO_BENCH_PROVIDER_MODE,
        apiKey: process.env.OPENAI_API_KEY,
      }
    : null;
  const state = await runSingleAttempt(
    {
      registrationPath: one("registration"),
      releasePath: one("release"),
      executorManifestPath: one("executor"),
      run: one("run"),
      side: one("side"),
    },
    {
      workspaceRoot: ROOT,
      validateRegistration: validateRuleChangeRegistration,
      providerExecution,
    },
  );
  console.log(`${state.attribution.attribution_id}\n${state.paths.attribution}`);
}

main().catch((error) => {
  console.error(`\n  ${error instanceof Error ? error.message : error}\n`);
  process.exit(1);
});
