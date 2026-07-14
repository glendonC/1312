#!/usr/bin/env node

/**
 * Turn one human-completed worksheet into an immutable studio.bench.review.v1 receipt.
 * The helper derives the candidate byte binding and canonical review_id. It does not decide
 * anything for the reviewer, create a second identity, edit gold, freeze a pack, or score.
 */

import { execFileSync } from "node:child_process";
import { relative, resolve, sep } from "node:path";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  readJsonFile,
  receiptIdFor,
  validateAdjudication,
  validateGold,
} from "./lib/bench-gold.mjs";
import { fileReceipt, writeImmutableJson } from "./lib/immutable-receipts.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function arg(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 || index === process.argv.length - 1 ? null : process.argv[index + 1];
}

function die(message) {
  console.error(`\n  adjudication receipt failed closed: ${message}\n`);
  process.exit(1);
}

function exactKeys(value, allowed, context) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${context} must be an object`);
  }
  const extras = Object.keys(value).filter((key) => !allowed.includes(key));
  const missing = allowed.filter((key) => !(key in value));
  if (extras.length > 0 || missing.length > 0) {
    throw new Error(
      `${context} shape is not closed${extras.length ? `; extra: ${extras.join(", ")}` : ""}${missing.length ? `; missing: ${missing.join(", ")}` : ""}`,
    );
  }
}

function workspacePath(path, context) {
  if (!path) throw new Error(`${context} is required`);
  const absolute = resolve(ROOT, path);
  if (absolute !== ROOT && !absolute.startsWith(`${ROOT}${sep}`)) {
    throw new Error(`${context} must stay inside the repository`);
  }
  return absolute;
}

function readableInputPath(path, context) {
  if (!path) throw new Error(`${context} is required`);
  return resolve(ROOT, path);
}

function recordedPath(path) {
  return relative(ROOT, path).split(sep).join("/");
}

function configuredGitIdentity() {
  const get = (key) => execFileSync("git", ["config", "--get", key], { cwd: ROOT, encoding: "utf8" }).trim();
  const name = get("user.name");
  const email = get("user.email");
  if (!name || !email) throw new Error("git user.name and user.email must be configured for the human reviewer");
  return `${name} <${email}>`;
}

try {
  const candidatePath = workspacePath(arg("candidate"), "--candidate");
  const worksheetPath = readableInputPath(arg("worksheet"), "--worksheet");
  const candidate = await validateGold(await readJsonFile(candidatePath, "gold candidate"), "gold candidate");
  const candidateRecordedPath = recordedPath(candidatePath);
  if (!candidateRecordedPath.startsWith(`bench/packs/${candidate.pack_id}/`)) {
    throw new Error("adjudication receipts may bind only real pack candidates under bench/packs/, never examples");
  }
  const worksheet = await readJsonFile(worksheetPath, "human adjudication worksheet");
  exactKeys(
    worksheet,
    ["reviewer", "blinded", "action", "reason", "unit_decisions", "minutes_spent", "created_at"],
    "human adjudication worksheet",
  );
  exactKeys(worksheet.reviewer, ["name", "git_identity"], "worksheet reviewer");

  const gitIdentity = configuredGitIdentity();
  if (worksheet.reviewer.git_identity !== gitIdentity) {
    throw new Error(
      `worksheet reviewer.git_identity is ${worksheet.reviewer.git_identity}, but this checkout is configured as ${gitIdentity}; each human must author and commit their own receipt`,
    );
  }
  if (!Array.isArray(worksheet.unit_decisions) || worksheet.unit_decisions.length !== candidate.units.length) {
    throw new Error(`worksheet must decide all ${candidate.units.length} candidate units exactly once`);
  }
  const expected = new Set(candidate.units.map((unit) => `${unit.t_start}\0${unit.t_end}`));
  const seen = new Set();
  for (const [index, decision] of worksheet.unit_decisions.entries()) {
    exactKeys(decision, ["t_start", "t_end", "action", "note"], `worksheet unit decision ${index}`);
    const key = `${decision.t_start}\0${decision.t_end}`;
    if (!expected.has(key) || seen.has(key)) {
      throw new Error(`worksheet unit decision ${index} does not align to one unique gold unit`);
    }
    if (decision.action !== "accept" && (typeof decision.note !== "string" || !decision.note.trim())) {
      throw new Error(`worksheet unit decision ${index} must explain its ${decision.action} action`);
    }
    seen.add(key);
  }

  const unitActions = worksheet.unit_decisions.map((decision) => decision.action);
  if (worksheet.action === "accept" && !unitActions.every((action) => action === "accept")) {
    throw new Error("an overall accept requires every unit decision to accept");
  }
  if (worksheet.action === "amend" && (!unitActions.includes("amend") || unitActions.includes("reject"))) {
    throw new Error("an overall amend requires at least one unit amendment and no rejected unit");
  }
  if (worksheet.action === "reject" && !unitActions.includes("reject")) {
    throw new Error("an overall reject requires at least one rejected unit");
  }

  const body = {
    schema: "studio.bench.review.v1",
    pack_id: candidate.pack_id,
    clip_id: candidate.clip_id,
    candidate: await fileReceipt(candidatePath, candidateRecordedPath),
    reviewer: worksheet.reviewer,
    drafter: candidate.drafter,
    blinded: worksheet.blinded,
    action: worksheet.action,
    reason: worksheet.reason,
    unit_decisions: worksheet.unit_decisions,
    minutes_spent: worksheet.minutes_spent,
    created_at: worksheet.created_at,
  };
  const receipt = {
    review_id: receiptIdFor("bench-review", { review_id: null, ...body }, "review_id"),
    ...body,
  };
  await validateAdjudication(receipt, "human adjudication receipt");
  const digest = receipt.review_id.slice("bench-review:sha256:".length);
  const output = workspacePath(`bench/reviews/${candidate.clip_id}.${digest}.review.json`, "review output");
  const state = await writeImmutableJson(output, receipt);
  console.log(`\n  ${state} ${recordedPath(output)}\n  ${receipt.action}, blinded=${receipt.blinded}; no freeze or score was produced\n`);
} catch (error) {
  die(error instanceof Error ? error.message : String(error));
}
