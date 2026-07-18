#!/usr/bin/env node

/**
 * Cold-audit one completed U7 operation and materialize both fixed anonymous-stem captures.
 * The tool produces structural, unscored captures only. Existing bench guards require later human
 * labels and score receipts for both files before the repository can return green.
 */

import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { ContentAddressedArtifactStore } from "../src/studio/runtime/production/artifactStore.ts";
import { FileEventJournal, RuntimeLedger } from "../src/studio/runtime/production/journal.ts";
import { auditConditionalSeparation } from "../src/studio/runtime/production/separationAudit.ts";
import {
  materializeU7CaptureDrafts,
  validateU7AblationInputs,
  validateU7CapturePair,
} from "./lib/bench-u7-ablation.mjs";
import { readJsonFile, verifiedBinding } from "./lib/bench-gold.mjs";
import { fileReceipt, writeImmutableJson } from "./lib/immutable-receipts.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function arg(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 || index === process.argv.length - 1 ? null : process.argv[index + 1];
}

function die(message) {
  console.error(`\n  U7 ablation packaging failed closed: ${message}\n`);
  process.exit(1);
}

try {
  const runtimeDirectory = arg("runtime-dir");
  const runId = arg("run");
  const operationId = arg("operation");
  const clipId = arg("clip");
  const repetition = Number(arg("repetition"));
  if (!runtimeDirectory || !runId || !operationId || !clipId || !Number.isInteger(repetition)) {
    die("--runtime-dir, --run, --operation, --clip, and integer --repetition are required");
  }
  const registrationPath = "bench/ablations/hard-ko-v1-raw-vs-eligible-stem/registration.json";
  const inputsPath = "bench/ablations/hard-ko-v1-raw-vs-eligible-stem/inputs.json";
  const registration = await readJsonFile(resolve(ROOT, registrationPath), "U7 ablation registration");
  const inputs = await readJsonFile(resolve(ROOT, inputsPath), "U7 ablation inputs");
  const validated = await validateU7AblationInputs(inputs, {
    workspaceRoot: ROOT,
  });
  const selectedInput = inputs.clips.find((entry) => entry.clip_id === clipId);
  if (!selectedInput) die(`clip ${clipId} is not in the U7 input registry`);
  await verifiedBinding(selectedInput.source, ROOT, `U7 ablation source ${clipId}`);
  const registrationBinding = await fileReceipt(resolve(ROOT, registrationPath), registrationPath);
  const inputsBinding = await fileReceipt(resolve(ROOT, inputsPath), inputsPath);

  const absoluteRuntime = resolve(runtimeDirectory);
  const ledger = await RuntimeLedger.open(runId, new FileEventJournal(join(absoluteRuntime, "events.ndjson")));
  if (ledger.runId !== runId || ledger.state().runId !== runId) die("runtime journal does not name --run");
  const artifacts = new ContentAddressedArtifactStore(join(absoluteRuntime, "artifact-store"));
  const audit = await auditConditionalSeparation(ledger.state(), artifacts, operationId);
  const drafts = materializeU7CaptureDrafts({
    registration,
    registrationBinding,
    inputs,
    inputsBinding,
    pack: validated.pack,
    clipId,
    repetition,
    capturedAt: new Date().toISOString(),
    audit,
  });
  await validateU7CapturePair(drafts, {
    registration,
    registrationBinding,
    inputs,
    inputsBinding,
    pack: validated.pack,
  });

  for (const { capture } of drafts) {
    const output = join(ROOT, "bench/runs", capture.capture_id, "capture.json");
    await writeImmutableJson(output, capture);
  }
  console.log(
    `\n  created both fixed U7 capture drafts for ${clipId}, repetition ${repetition}\n  ${drafts.map(({ stemRole, capture }) => `${stemRole}: bench/runs/${capture.capture_id}/capture.json`).join("\n  ")}\n\n  Both captures remain unscored with judge=null. Add blinded human labels and score both; do not select one stem.\n`,
  );
} catch (error) {
  die(error instanceof Error ? error.message : String(error));
}
