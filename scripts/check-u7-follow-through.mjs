#!/usr/bin/env node

/** Read-only U7 minimum capture-grid, score, and local-readiness audit. */

import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { SpeechbrainSepformerSeparator } from "../src/studio/runtime/production/separation/speechbrainSepformerSeparator.ts";
import { validateAblationRegistration } from "./lib/bench-ablation.mjs";
import {
  buildU7FollowThroughReport,
  portableU7Readiness,
  probeU7LocalReadiness,
} from "./lib/bench-u7-follow-through.mjs";
import {
  validateU7AblationInputs,
  validateU7CapturePair,
} from "./lib/bench-u7-ablation.mjs";
import {
  readJsonFile,
  validateScoreReceipt,
  verifiedBinding,
} from "./lib/bench-gold.mjs";
import { fileReceipt } from "./lib/immutable-receipts.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ABLATION = "hard-ko-v1-raw-vs-eligible-stem";
const REGISTRATION_PATH = join(ROOT, "bench", "ablations", ABLATION, "registration.json");
const INPUTS_PATH = join(ROOT, "bench", "ablations", ABLATION, "inputs.json");

function flag(name) {
  return process.argv.includes(`--${name}`);
}

function fail(message) {
  throw new Error(`U7 follow-through check failed closed: ${message}`);
}

function workspacePath(path) {
  return relative(ROOT, path).split("\\").join("/");
}

async function jsonFiles(directory, filename) {
  if (!existsSync(directory)) return [];
  const entries = await readdir(directory, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory() && existsSync(join(directory, entry.name, filename)))
    .map((entry) => join(directory, entry.name, filename))
    .sort((left, right) => left.localeCompare(right));
}

async function captureInventory({ registration, registrationBinding, inputs, inputsBinding, pack }) {
  const grouped = new Map();
  for (const path of await jsonFiles(join(ROOT, "bench", "runs"), "capture.json")) {
    const capture = await readJsonFile(path, `U7 follow-through capture ${workspacePath(path)}`);
    if (capture.ablation?.registration?.ablation_id !== registration.ablation_id) continue;
    const key = JSON.stringify({ clipId: capture.clip?.id, repetition: capture.ablation?.repetition });
    const group = grouped.get(key) ?? [];
    group.push({ stemRole: capture.ablation?.stem_role, capture, path });
    grouped.set(key, group);
  }

  const captures = [];
  const byId = new Map();
  for (const group of grouped.values()) {
    group.sort((left, right) => left.stemRole.localeCompare(right.stemRole));
    await validateU7CapturePair(group.map(({ stemRole, capture }) => ({ stemRole, capture })), {
      registration,
      registrationBinding,
      inputs,
      inputsBinding,
      pack,
      context: `U7 follow-through pair ${group[0].capture.clip.id}/${group[0].capture.ablation.repetition}`,
    });
    for (const { capture, path } of group) {
      const held = {
        ablation_id: capture.ablation.registration.ablation_id,
        inputs_id: capture.ablation.inputs.inputs_id,
        clip_id: capture.clip.id,
        repetition: capture.ablation.repetition,
        stem_role: capture.ablation.stem_role,
        operation_id: capture.ablation.runtime.operation_id,
        capture_id: capture.capture_id,
        binding: await fileReceipt(path, workspacePath(path)),
      };
      captures.push(held);
      byId.set(capture.capture_id, held);
    }
  }
  return { captures, byId };
}

async function scoreInventory(captures, packId) {
  const scores = [];
  for (const path of await jsonFiles(join(ROOT, "bench", "scores"), "score.json")) {
    const score = validateScoreReceipt(
      await readJsonFile(path, `U7 follow-through score ${workspacePath(path)}`),
      `U7 follow-through score ${workspacePath(path)}`,
    );
    if (!score.run.startsWith("u7-ablation:")) continue;
    const capture = captures.byId.get(score.run);
    if (!capture) fail(`score ${score.score_id} names an absent U7 capture`);
    if (score.pack_id !== packId || score.clip_id !== capture.clip_id || score.judge !== null) {
      fail(`score ${score.score_id} changed U7 pack, clip, or judge authority`);
    }
    await verifiedBinding(score.bindings.capture, ROOT, `U7 score ${score.score_id} capture`);
    if (
      score.bindings.capture.path !== capture.binding.path ||
      score.bindings.capture.content_id !== capture.binding.content_id ||
      score.bindings.capture.bytes !== capture.binding.bytes
    ) {
      fail(`score ${score.score_id} does not bind its exact U7 capture bytes`);
    }
    scores.push({
      capture_id: score.run,
      score_id: score.score_id,
      judge: score.judge,
      binding: await fileReceipt(path, workspacePath(path)),
    });
  }
  return scores;
}

const registration = await validateAblationRegistration(
  await readJsonFile(REGISTRATION_PATH, "U7 follow-through registration"),
  { workspaceRoot: ROOT, context: "U7 follow-through registration" },
);
const validatedInputs = await validateU7AblationInputs(
  await readJsonFile(INPUTS_PATH, "U7 follow-through inputs"),
  { workspaceRoot: ROOT, context: "U7 follow-through inputs" },
);
const registrationBinding = await fileReceipt(REGISTRATION_PATH, workspacePath(REGISTRATION_PATH));
const inputsBinding = await fileReceipt(INPUTS_PATH, workspacePath(INPUTS_PATH));
const captures = await captureInventory({
  registration,
  registrationBinding,
  inputs: validatedInputs.registry,
  inputsBinding,
  pack: validatedInputs.pack,
});
const scores = await scoreInventory(captures, validatedInputs.pack.pack_id);
const environment = flag("portable")
  ? portableU7Readiness(validatedInputs.registry)
  : await probeU7LocalReadiness(validatedInputs.registry, {
      workspaceRoot: ROOT,
      separator: new SpeechbrainSepformerSeparator(),
    });
const report = buildU7FollowThroughReport({
  registration,
  inputs: validatedInputs.registry,
  captures: captures.captures,
  scores,
  environment,
});

if (flag("json")) {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} else {
  const sourceStates = report.environment.sources.reduce((counts, entry) => {
    counts[entry.state] = (counts[entry.state] ?? 0) + 1;
    return counts;
  }, {});
  console.log(
    `U7 follow-through check passed: ${report.summary.minimum_pairs_required} required pair(s), ` +
    `${report.summary.minimum_captured_slots}/${report.summary.minimum_capture_slots} minimum capture slot(s), ` +
    `${report.summary.minimum_scored_slots}/${report.summary.minimum_capture_slots} scored, ` +
    `${report.summary.extra_pairs} extra pair(s); sources ${JSON.stringify(sourceStates)}, ` +
    `separator ${report.environment.separator.state}; ${report.report_id}`,
  );
}

if (flag("require-complete") && !report.summary.minimum_score_complete) {
  fail("the exact minimum grid is not fully captured and human-scored");
}
