#!/usr/bin/env node

/**
 * Validate and immutably materialize an agent-proposed studio.bench.gold.v1 file.
 *
 * This tool drafts nothing by itself. It accepts an agent's complete JSON proposal, rebinds it
 * to the content-addressed prompt/evidence pack, and refuses any drift in source provenance,
 * mined-candidate bytes, time windows, schema, or authority boundary. It never initializes or
 * advances a pack, writes a review, freezes gold, or scores a run.
 */

import { relative, resolve, sep } from "node:path";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  readJsonFile,
  receiptIdFor,
  validateCandidatesManifest,
  validateGold,
  verifiedBinding,
} from "./lib/bench-gold.mjs";
import {
  canonicalJson,
  fileReceipt,
  writeImmutableJson,
} from "./lib/immutable-receipts.mjs";
import { normalizeSourceReceipt } from "./lib/source-receipts.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_PROMPT = "bench/prompts/gold-drafter-v1/manifest.json";
const DRY_RUN_PREFIX = "[NON-AUTHORITATIVE DRY-RUN FIXTURE]";

function arg(name, fallback = null) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 || index === process.argv.length - 1 ? fallback : process.argv[index + 1];
}

function has(name) {
  return process.argv.includes(`--${name}`);
}

function die(message) {
  console.error(`\n  draft-gold failed closed: ${message}\n`);
  process.exit(1);
}

function exactKeys(value, allowed, context) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${context} must be an object`);
  }
  const extras = Object.keys(value).filter((key) => key !== "$schema" && !allowed.includes(key));
  const missing = allowed.filter((key) => !(key in value));
  if (extras.length > 0 || missing.length > 0) {
    throw new Error(
      `${context} shape is not closed${extras.length ? `; extra: ${extras.join(", ")}` : ""}${missing.length ? `; missing: ${missing.join(", ")}` : ""}`,
    );
  }
}

function workspacePath(path, context) {
  if (typeof path !== "string" || !path.trim()) throw new Error(`${context} is required`);
  const absolute = resolve(ROOT, path);
  if (absolute !== ROOT && !absolute.startsWith(`${ROOT}${sep}`)) {
    throw new Error(`${context} must stay inside the repository`);
  }
  return absolute;
}

function readableInputPath(path, context) {
  if (typeof path !== "string" || !path.trim()) throw new Error(`${context} is required`);
  return resolve(ROOT, path);
}

function recordedPath(path) {
  return relative(ROOT, path).split(sep).join("/");
}

function expectedGoldSource(sourceReceipt) {
  const source = normalizeSourceReceipt(sourceReceipt);
  if (source.kind !== "youtube") {
    throw new Error("gold-drafter-v1 is bound to the run-006 YouTube receipt");
  }
  return {
    kind: source.kind,
    url: source.locator.url,
    channel: source.creator,
    licence: source.rights.label,
    window: {
      start: source.selection.start,
      end: source.selection.end,
      duration: source.selection.duration,
    },
    attribution: source.rights.attribution,
  };
}

async function validatePromptPack(path) {
  const promptPack = await readJsonFile(path, "gold drafting prompt manifest");
  exactKeys(
    promptPack,
    ["schema", "prompt_id", "name", "version", "drafter_id", "pack_id", "clip_id", "prompt", "inputs", "output_contract", "notes"],
    "gold drafting prompt manifest",
  );
  if (promptPack.schema !== "studio.bench.gold-prompt-pack.v1") {
    throw new Error("gold drafting prompt manifest schema is not registered");
  }
  if (promptPack.prompt_id !== receiptIdFor("bench-gold-prompt", promptPack, "prompt_id")) {
    throw new Error("gold drafting prompt manifest id does not match its canonical contents");
  }
  if (promptPack.name !== "gold-drafter-v1" || promptPack.version !== "1.0.0") {
    throw new Error("gold drafting prompt manifest does not name version 1.0.0");
  }
  if (!/^agent:[a-z0-9][a-z0-9._-]*$/.test(promptPack.drafter_id)) {
    throw new Error("prompt drafter_id must be a stable agent id");
  }
  exactKeys(promptPack.prompt, ["path", "content_id", "bytes"], "prompt binding");
  await verifiedBinding(promptPack.prompt, ROOT, "prompt binding");
  if (!Array.isArray(promptPack.inputs) || promptPack.inputs.length === 0) {
    throw new Error("gold drafting prompt manifest has no inputs");
  }
  const roles = new Map();
  for (const [index, input] of promptPack.inputs.entries()) {
    exactKeys(input, ["role", "path", "content_id", "bytes"], `prompt input ${index}`);
    if (roles.has(input.role)) throw new Error(`prompt input repeats role ${input.role}`);
    roles.set(input.role, input);
    await verifiedBinding(
      { path: input.path, content_id: input.content_id, bytes: input.bytes },
      ROOT,
      `prompt input ${input.role}`,
    );
  }
  for (const role of ["candidates", "gold_schema", "source", "captions", "corrections", "run", "media", "ko_pack"]) {
    if (!roles.has(role)) throw new Error(`gold drafting prompt manifest lacks ${role}`);
  }
  exactKeys(promptPack.output_contract, ["schema", "status", "materializer"], "prompt output contract");
  if (
    promptPack.output_contract.schema !== "studio.bench.gold.v1" ||
    promptPack.output_contract.status !== "candidate" ||
    promptPack.output_contract.materializer !== "scripts/draft-gold-from-candidates.mjs"
  ) {
    throw new Error("gold drafting prompt manifest weakens the output contract");
  }
  return { promptPack, roles };
}

try {
  const draftArg = arg("draft");
  const candidatesArg = arg("candidates", "bench/candidates/run-006/candidates.json");
  const sourceArg = arg("source-json", "public/demo/runs/run-006/source.json");
  const promptArg = arg("prompt-manifest", DEFAULT_PROMPT);
  if (!draftArg) die("--draft is required (a complete studio.bench.gold.v1 proposal)");

  const draftPath = readableInputPath(draftArg, "--draft");
  const candidatesPath = workspacePath(candidatesArg, "--candidates");
  const sourcePath = workspacePath(sourceArg, "--source-json");
  const promptPath = workspacePath(promptArg, "--prompt-manifest");
  const draft = await validateGold(await readJsonFile(draftPath, "agent gold proposal"), "agent gold proposal");
  const { promptPack, roles } = await validatePromptPack(promptPath);

  if (draft.pack_id !== promptPack.pack_id || draft.clip_id !== promptPack.clip_id) {
    throw new Error("agent proposal names a different pack or clip than the prompt pack");
  }
  if (draft.drafter !== promptPack.drafter_id) {
    throw new Error(`agent proposal drafter must be ${promptPack.drafter_id}`);
  }
  if (draft.status !== "candidate") {
    throw new Error("agent proposal status must stay candidate");
  }
  if (roles.get("candidates").path !== recordedPath(candidatesPath)) {
    throw new Error("--candidates does not match the prompt pack binding");
  }
  if (roles.get("source").path !== recordedPath(sourcePath)) {
    throw new Error("--source-json does not match the prompt pack binding");
  }

  const candidates = validateCandidatesManifest(
    await readJsonFile(candidatesPath, "mined candidates manifest"),
    "mined candidates manifest",
  );
  if (candidates.routing.route !== "gold") {
    throw new Error("mined clip was not routed gold; exclusive routing forbids a gold proposal");
  }
  if (candidates.clip.id !== draft.clip_id) {
    throw new Error("mined candidates manifest names a different clip");
  }
  for (const [index, binding] of candidates.source_artifacts.entries()) {
    await verifiedBinding(binding, ROOT, `candidates source artifact ${index}`);
  }

  const candidateBinding = await fileReceipt(candidatesPath, recordedPath(candidatesPath));
  if (canonicalJson(draft.mined_from) !== canonicalJson(candidateBinding)) {
    throw new Error("agent proposal mined_from does not bind the exact candidates manifest bytes");
  }
  const sourceReceipt = await readJsonFile(sourcePath, "run source receipt");
  if (canonicalJson(draft.source) !== canonicalJson(expectedGoldSource(sourceReceipt))) {
    throw new Error("agent proposal source does not match normalized run-006 source provenance");
  }

  const expectedWindows = new Map(
    candidates.candidates.map((candidate) => [`${candidate.t_start}\0${candidate.t_end}`, candidate]),
  );
  if (draft.units.length !== expectedWindows.size) {
    throw new Error(`agent proposal must contain all ${expectedWindows.size} candidate windows exactly once`);
  }
  const seenWindows = new Set();
  const outputText = new Set(
    candidates.candidates.flatMap((candidate) =>
      Object.values(candidate.outputs)
        .map((output) => output.text?.trim())
        .filter(Boolean),
    ),
  );
  const koPack = await readJsonFile(workspacePath(roles.get("ko_pack").path, "ko pack"), "ko-v3 pack");
  const phenomena = new Set(["none", ...koPack.phenomena.map((phenomenon) => phenomenon.id)]);

  for (const [index, unit] of draft.units.entries()) {
    const key = `${unit.t_start}\0${unit.t_end}`;
    const candidate = expectedWindows.get(key);
    if (!candidate || seenWindows.has(key)) {
      throw new Error(`agent proposal unit ${index} is not one unique mined candidate window`);
    }
    seenWindows.add(key);
    if (!/[\u1100-\u11ff\u3130-\u318f\uac00-\ud7a3]/u.test(unit.korean_gold)) {
      throw new Error(`agent proposal unit ${index} korean_gold contains no Korean text`);
    }
    if (outputText.has(unit.korean_gold.trim())) {
      throw new Error(`agent proposal unit ${index} copied a system English output into korean_gold`);
    }
    if (typeof unit.english_guidance !== "string" || !unit.english_guidance.trim()) {
      throw new Error(`agent proposal unit ${index} needs non-empty grader guidance`);
    }
    for (const critical of unit.critical_units) {
      if (!phenomena.has(critical.phenomenon)) {
        throw new Error(`agent proposal critical unit ${critical.id} uses unregistered phenomenon ${critical.phenomenon}`);
      }
      if (critical.facts.length === 0) {
        throw new Error(`agent proposal critical unit ${critical.id} needs at least one human-checkable fact`);
      }
    }
  }

  const example = has("example");
  if (example && !draft.notes.startsWith(DRY_RUN_PREFIX)) {
    throw new Error(`--example proposals must begin notes with ${DRY_RUN_PREFIX}`);
  }
  if (!example && draft.notes.startsWith(DRY_RUN_PREFIX)) {
    throw new Error("a dry-run fixture cannot be materialized into a real pack");
  }

  const defaultOut = example
    ? `bench/examples/gold-drafts/${draft.clip_id}.gold.json`
    : `bench/packs/${draft.pack_id}/${draft.clip_id}.gold.json`;
  const outPath = workspacePath(arg("out", defaultOut), "--out");
  const out = recordedPath(outPath);
  if (example && !out.startsWith("bench/examples/gold-drafts/")) {
    throw new Error("--example output must stay under bench/examples/gold-drafts/");
  }
  if (!example && !out.startsWith(`bench/packs/${draft.pack_id}/`)) {
    throw new Error(`real gold proposals must stay under bench/packs/${draft.pack_id}/`);
  }

  await validateGold(draft, `materialized gold ${out}`);
  if (has("check")) {
    console.log(`\n  checked ${out}: valid candidate proposal; no file written\n`);
  } else {
    const state = await writeImmutableJson(outPath, draft);
    console.log(`\n  ${state} ${out}\n  status: candidate (unreviewed, unfrozen, unscoreable)\n`);
  }
} catch (error) {
  die(error instanceof Error ? error.message : String(error));
}
