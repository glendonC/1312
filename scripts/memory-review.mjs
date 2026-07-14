#!/usr/bin/env node

import { readFile } from "node:fs/promises";

import {
  materializeMemory,
  recordDecision,
  recordLegacySnapshot,
  recordProposal,
} from "./lib/memory-review.mjs";

function usage(message = null) {
  if (message) console.error(`\n  ${message}\n`);
  console.error(`Usage:
  node scripts/memory-review.mjs legacy \\
    --store memory/review --namespace language/ko/glossary \\
    --source memory/glossary/ko.json

  node scripts/memory-review.mjs propose \\
    --store memory/review --namespace language/ko/glossary --kind glossary \\
    --key <semantic-key> --value-json <payload.json> --proposed-by <producer> \\
    --evidence <artifact> [--evidence <artifact> ...] \\
    [--source-json <provenance.json>] [--supersedes <proposal-id>] \\
    [--benchmark-pack <pack-id>]

  node scripts/memory-review.mjs decide \\
    --store memory/review --proposal <proposal-id> \\
    --action <accept|reject|revoke> --decided-by <reviewer> --reason <reason> \\
    [--bench-report <scored-report.json>]

  node scripts/memory-review.mjs materialize --store memory/review
`);
  process.exit(1);
}

function parse(argv) {
  const command = argv[0];
  if (!command || command.startsWith("--")) usage("a command is required");
  const flags = new Map();
  for (let index = 1; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) usage(`unexpected argument ${token}`);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) usage(`${token} requires a value`);
    const name = token.slice(2);
    const values = flags.get(name) ?? [];
    values.push(value);
    flags.set(name, values);
    index += 1;
  }
  return { command, flags };
}

function one(flags, name, { required = true } = {}) {
  const values = flags.get(name) ?? [];
  if (values.length > 1) usage(`--${name} may be supplied only once`);
  if (values.length === 0) {
    if (required) usage(`--${name} is required`);
    return null;
  }
  return values[0];
}

async function json(path, context) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    throw new Error(`${context} ${path} is not readable JSON`, { cause: error });
  }
}

async function main() {
  const { command, flags } = parse(process.argv.slice(2));
  const allowed = new Set(
    command === "legacy"
      ? ["store", "namespace", "source", "created-at"]
      : command === "propose"
        ? [
            "store",
            "namespace",
            "kind",
            "key",
            "value-json",
            "proposed-by",
            "evidence",
            "source-json",
            "supersedes",
            "benchmark-pack",
            "created-at",
          ]
        : command === "decide"
          ? ["store", "proposal", "action", "decided-by", "reason", "bench-report", "created-at"]
          : command === "materialize"
            ? ["store", "created-at"]
            : [],
  );
  for (const name of flags.keys()) {
    if (!allowed.has(name)) usage(`--${name} is not valid for ${command}`);
  }
  const store = one(flags, "store");
  const at = one(flags, "created-at", { required: false });

  if (command === "legacy") {
    const result = await recordLegacySnapshot({
      store,
      namespace: one(flags, "namespace"),
      sourcePath: one(flags, "source"),
      createdAt: at ?? undefined,
    });
    console.log(`${result.snapshot.snapshot_id}\n${result.path}`);
    return;
  }

  if (command === "propose") {
    const valuePath = one(flags, "value-json");
    const sourcePath = one(flags, "source-json", { required: false });
    const result = await recordProposal({
      store,
      namespace: one(flags, "namespace"),
      kind: one(flags, "kind"),
      key: one(flags, "key"),
      value: await json(valuePath, "proposal value"),
      proposedBy: one(flags, "proposed-by"),
      evidencePaths: flags.get("evidence") ?? [],
      supersedes: one(flags, "supersedes", { required: false }),
      source: sourcePath ? await json(sourcePath, "proposal source") : null,
      benchmarkPackId: one(flags, "benchmark-pack", { required: false }),
      createdAt: at ?? undefined,
    });
    console.log(`${result.proposal.proposal_id}\n${result.path}`);
    return;
  }

  if (command === "decide") {
    const result = await recordDecision({
      store,
      proposalId: one(flags, "proposal"),
      action: one(flags, "action"),
      decidedBy: one(flags, "decided-by"),
      reason: one(flags, "reason"),
      benchReport: one(flags, "bench-report", { required: false }),
      createdAt: at ?? undefined,
    });
    console.log(`${result.decision.decision_id}\n${result.path}`);
    return;
  }

  if (command === "materialize") {
    const result = await materializeMemory({ store, createdAt: at ?? undefined });
    console.log(`${result.materialization.materialization_id}\n${result.path}`);
    return;
  }

  usage(`unknown command ${command}`);
}

main().catch((error) => {
  console.error(`\n  memory review failed closed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
