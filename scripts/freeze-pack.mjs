#!/usr/bin/env node

/**
 * The only tool allowed to change a pack's state.
 *
 *   node scripts/freeze-pack.mjs init       --pack hard-ko-v1 --label "Hard-KO Clip Pack v1"
 *   node scripts/freeze-pack.mjs source     --pack hard-ko-v1 --slot slot-hard-01 \
 *                                           --clip <clip_id> --source-json <provenance.json>
 *   node scripts/freeze-pack.mjs gold-ready --pack hard-ko-v1 --slot slot-hard-01 \
 *                                           --gold <clip_id>.gold.json
 *   node scripts/freeze-pack.mjs freeze     --pack hard-ko-v1
 *
 * A clip advances planned -> sourced -> gold_ready one explicit step at a time, and the whole
 * pack freezes in one motion or not at all. Freezing is the only transition that matters and it
 * is the one this tool cannot fake:
 *
 *   - every clip must have a valid gold candidate file whose bytes are re-hashed now;
 *   - every clip needs TWO accept receipts in bench/reviews/, blinded, each binding those exact
 *     gold bytes, from reviewers with pairwise-distinct names AND git identities, neither being
 *     the drafter;
 *   - at least two clips must be independently sourced controls (no candidates manifest);
 *   - a clip mined for training can never freeze (exclusive routing).
 *
 * The result is an immutable freeze receipt binding all of it together. Identity honesty, v1:
 * distinct declared identities prove the receipts CLAIM two humans, not that two humans exist.
 * The expectation — documented in bench/README.md — is that each reviewer commits their own
 * receipt from their own git identity so ancestry can be audited. Until a real second
 * Korean-fluent reviewer exists, no genuine freeze can happen, and that blocker is a person,
 * not a flag.
 */

import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  freezeChecks,
  readJsonFile,
  validateGold,
  validatePack,
} from "./lib/bench-gold.mjs";
import { writeImmutableJson } from "./lib/immutable-receipts.mjs";
import { normalizeBenchSourceReceipt } from "./lib/source-receipts.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const REVIEWS = join(ROOT, "bench/reviews");

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 || i === process.argv.length - 1 ? fallback : process.argv[i + 1];
}

function die(message) {
  console.error(`\n  freeze-pack failed closed: ${message}\n`);
  process.exit(1);
}

const COMMAND = process.argv[2];
const PACK = arg("pack");
if (!PACK) die("--pack is required");
const PACK_DIR = join(ROOT, "bench/packs", PACK);
const PACK_FILE = join(PACK_DIR, "pack.json");

async function loadPack() {
  const pack = validatePack(await readJsonFile(PACK_FILE, `pack ${PACK}`), `pack ${PACK}`);
  if (pack.pack_id !== PACK) die(`pack file names ${pack.pack_id}, not ${PACK}`);
  return pack;
}

async function savePack(pack) {
  validatePack(pack, `pack ${PACK}`);
  await writeFile(PACK_FILE, `${JSON.stringify(pack, null, 2)}\n`, "utf8");
}

function slotOf(pack, slotName) {
  const clip = pack.clips.find((candidate) => candidate.slot === slotName);
  if (!clip) die(`pack ${PACK} has no slot ${slotName}`);
  return clip;
}

try {
  if (COMMAND === "init") {
    const label = arg("label");
    if (!label) die("--label is required");
    if (existsSync(PACK_FILE)) die(`pack ${PACK} already exists; state changes go through source/gold-ready/freeze`);
    const controls = Number(arg("controls", "2"));
    const hard = Number(arg("hard", "3"));
    if (!Number.isInteger(controls) || controls < 2) die("a pack needs at least two independently sourced control slots");
    if (!Number.isInteger(hard) || hard < 1) die("a pack needs at least one hard slot");
    const slot = (role, index) => ({
      slot: `slot-${role}-${String(index + 1).padStart(2, "0")}`,
      role,
      status: "planned",
      clip_id: null,
      source: null,
      gold_path: null,
      candidates_manifest: null,
    });
    const pack = {
      schema: "studio.bench.pack.v1",
      pack_id: PACK,
      label,
      frozen: false,
      target_clip_count: controls + hard,
      clips: [
        ...Array.from({ length: controls }, (_, index) => slot("control", index)),
        ...Array.from({ length: hard }, (_, index) => slot("hard", index)),
      ],
      freeze_receipt: null,
    };
    validatePack(pack, `pack ${PACK}`);
    await writeImmutableJson(PACK_FILE, pack);
    console.log(`\n  initialized bench/packs/${PACK}/pack.json: ${controls} control + ${hard} hard planned slots\n`);
  } else if (COMMAND === "source") {
    const pack = await loadPack();
    if (pack.frozen) die(`pack ${PACK} is frozen; a frozen pack never changes`);
    const clip = slotOf(pack, arg("slot") ?? die("--slot is required"));
    if (clip.status !== "planned") die(`slot ${clip.slot} is ${clip.status}; only a planned slot can be sourced`);
    const clipId = arg("clip");
    if (!clipId) die("--clip is required");
    const sourcePath = arg("source-json");
    if (!sourcePath) die("--source-json is required: a bench clip without recorded provenance is not evidence");
    const source = await readJsonFile(join(ROOT, sourcePath), "clip source provenance");
    normalizeBenchSourceReceipt(source);
    if (pack.clips.some((other) => other.clip_id === clipId)) die(`clip ${clipId} is already in this pack`);
    clip.status = "sourced";
    clip.clip_id = clipId;
    clip.source = source;
    await savePack(pack);
    console.log(`\n  ${clip.slot}: planned -> sourced (${clipId})\n`);
  } else if (COMMAND === "gold-ready") {
    const pack = await loadPack();
    if (pack.frozen) die(`pack ${PACK} is frozen; a frozen pack never changes`);
    const clip = slotOf(pack, arg("slot") ?? die("--slot is required"));
    if (clip.status !== "sourced") die(`slot ${clip.slot} is ${clip.status}; only a sourced slot can become gold_ready`);
    const goldPath = arg("gold");
    if (!goldPath) die("--gold is required (path relative to the pack directory)");
    const gold = await validateGold(await readJsonFile(join(PACK_DIR, goldPath), `gold ${goldPath}`), `gold ${goldPath}`);
    if (gold.pack_id !== PACK || gold.clip_id !== clip.clip_id) {
      die(`gold ${goldPath} names ${gold.pack_id}/${gold.clip_id}, not ${PACK}/${clip.clip_id}`);
    }
    if (clip.role === "control" && gold.mined_from !== null) {
      die(`slot ${clip.slot} is a control clip; controls must be independently sourced, not mined from the system's own misses`);
    }
    clip.status = "gold_ready";
    clip.gold_path = goldPath;
    clip.candidates_manifest = gold.mined_from?.path ?? null;
    await savePack(pack);
    console.log(`\n  ${clip.slot}: sourced -> gold_ready (${goldPath}). Freezing still requires two blinded human adjudication receipts.\n`);
  } else if (COMMAND === "freeze") {
    const pack = await loadPack();
    // frozen_at is stamped by this process, never supplied: an operator-chosen date could be
    // backdated below an existing capture to defeat pre-registration. The one exception is
    // resuming an interrupted freeze — if an immutable freeze.json already exists, its own
    // frozen_at is reused so the re-derived receipt is byte-identical and the write is
    // idempotent instead of colliding.
    const freezePath = join(PACK_DIR, "freeze.json");
    const frozenAt = existsSync(freezePath)
      ? (await readJsonFile(freezePath, `existing freeze receipt ${PACK}`)).frozen_at
      : new Date().toISOString();
    const receipt = await freezeChecks({
      pack,
      packDir: PACK_DIR,
      reviewsDir: REVIEWS,
      frozenAt,
      workspaceRoot: ROOT,
    });
    await writeImmutableJson(join(PACK_DIR, "freeze.json"), receipt);
    for (const clip of pack.clips) clip.status = "frozen";
    pack.frozen = true;
    pack.freeze_receipt = "freeze.json";
    await savePack(pack);
    console.log(`\n  pack ${PACK} FROZEN at ${receipt.frozen_at}\n  freeze receipt: ${receipt.freeze_id}\n  From this point the gold never changes, and every later capture of a pack clip must be scored.\n`);
  } else {
    die(`unknown command ${COMMAND ?? "(none)"}; use init | source | gold-ready | freeze`);
  }
} catch (error) {
  die(error instanceof Error ? error.message : String(error));
}
