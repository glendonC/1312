#!/usr/bin/env node

import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  materializeRuleChangeCampaignApproval,
  ruleChangeCampaignApprovalPath,
} from "./lib/bench-rule-change.mjs";
import { writeImmutableJson } from "./lib/immutable-receipts.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function usage(message = null) {
  if (message) console.error(`\n  ${message}\n`);
  console.error(`Usage:
  node scripts/approve-rule-change-campaign.mjs \\
    --proposal-draft <proposal-draft.json> --approved-by <human-name> \\
    --git-identity <name-and-email> --notes <review-note>

This approves exact proposal bytes for result-free registration only. It never authorizes live capture.
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
  const approval = await materializeRuleChangeCampaignApproval(
    {
      proposalDraftPath: one("proposal-draft"),
      approvedBy: {
        name: one("approved-by"),
        git_identity: one("git-identity"),
      },
      notes: one("notes"),
    },
    { workspaceRoot: ROOT },
  );
  const path = ruleChangeCampaignApprovalPath(approval);
  const state = await writeImmutableJson(resolve(ROOT, path), approval);
  console.log(`${approval.approval_id}\n${path} (${state})`);
}

main().catch((error) => {
  console.error(`\n  ${error instanceof Error ? error.message : error}\n`);
  process.exit(1);
});
