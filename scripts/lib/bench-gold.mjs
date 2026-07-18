/**
 * The conveyor's contracts: candidates -> gold -> adjudication -> freeze -> score, plus
 * result-free frozen-pack ablation pre-registration.
 *
 * Agents draft; humans decide; code freezes; nothing scores itself. Every artifact here is
 * content-addressed and append-only, and every claim a later stage relies on is re-derived from
 * bytes rather than trusted from a status string:
 *
 *   studio.bench.candidates.v1   what a run's own misses looked like, routed gold|training at
 *                                mine time and never both (exclusive routing)
 *   studio.bench.gold.v1         drafted gold, pinned status "candidate" — a gold file cannot
 *                                self-promote (JSON Schema in bench/schemas/gold.schema.json)
 *   studio.bench.review.v1       one blinded human's decision, bound to exact candidate bytes
 *                                (JSON Schema in bench/schemas/adjudication.schema.json)
 *   studio.bench.pack.v1         freeze-pack.mjs's working state for one pack
 *   studio.bench.freeze.v1       the immutable receipt that makes gold scoreable: it binds the
 *                                exact gold bytes to two distinct blinded human accept receipts
 *   studio.bench.output-labels.v1  human judgments of one capture's emitted lines against gold
 *   studio.bench.score.v1        the scored result: mechanical withheld/missing, human-labelled
 *                                correct/wrong, four-way outcomes, null-never-zero rates
 *   studio.bench.ablation.v1     one exact config delta, bound before captures to frozen bytes;
 *                                results null and structural diagnostics non-semantic
 *
 * What is mechanical and what is human is deliberate: withheld and missing are read off the
 * capture (a gate either fired or it did not), while correct/wrong/catastrophic exist ONLY as
 * human labels. There is no LLM-judge path in this module — `judge` is pinned null in the score
 * receipt so its later addition has to be a visible contract change, not a quiet default.
 */

import { readFile, readdir } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";

import Ajv2020 from "ajv/dist/2020.js";

import { contentIdForJson, fileReceipt } from "./immutable-receipts.mjs";

export const BENCH_GOLD_SCHEMAS = Object.freeze({
  candidates: "studio.bench.candidates.v1",
  gold: "studio.bench.gold.v1",
  adjudication: "studio.bench.review.v1",
  pack: "studio.bench.pack.v1",
  freeze: "studio.bench.freeze.v1",
  labels: "studio.bench.output-labels.v1",
  score: "studio.bench.score.v1",
  ablation: "studio.bench.ablation.v1",
});

export const CANDIDATE_SIGNALS = Object.freeze([
  "withheld",
  "uncorroborated_commit",
  "phenomenon",
  "contrast",
]);

const CLIP_ROLES = new Set(["control", "hard"]);
const CLIP_STATUSES = new Set(["planned", "sourced", "gold_ready", "frozen"]);

/* ------------------------------------------------------------------ helpers */

function fail(message) {
  throw new Error(`bench gold: ${message}`);
}

function requiredText(value, context) {
  if (typeof value !== "string" || !value.trim()) fail(`${context} must be a non-empty string`);
  return value.trim();
}

function exactKeys(value, allowed, context) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${context} must be an object`);
  // "$schema" is an optional presentation pointer everywhere; ids and validation ignore it.
  const extras = Object.keys(value).filter((key) => key !== "$schema" && !allowed.includes(key));
  const missing = allowed.filter((key) => !(key in value));
  if (extras.length > 0 || missing.length > 0) {
    fail(
      `${context} shape is not closed${extras.length ? `; extra: ${extras.join(", ")}` : ""}${missing.length ? `; missing: ${missing.join(", ")}` : ""}`,
    );
  }
}

function isoDateTime(value, context) {
  const text = requiredText(value, context);
  if (Number.isNaN(Date.parse(text)) || new Date(text).toISOString() !== text) {
    fail(`${context} must be an exact ISO-8601 UTC timestamp`);
  }
  return text;
}

function isoDate(value, context) {
  const text = requiredText(value, context);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) fail(`${context} must be a YYYY-MM-DD date`);
  return text;
}

function fileBinding(value, context) {
  exactKeys(value, ["path", "content_id", "bytes"], context);
  requiredText(value.path, `${context}.path`);
  if (!/^sha256:[a-f0-9]{64}$/.test(value.content_id)) fail(`${context}.content_id is not a content id`);
  if (!Number.isInteger(value.bytes) || value.bytes <= 0) fail(`${context}.bytes must be a positive integer`);
  return value;
}

function timeRange(unit, context) {
  if (typeof unit.t_start !== "number" || unit.t_start < 0) fail(`${context} t_start is invalid`);
  if (typeof unit.t_end !== "number" || unit.t_end <= unit.t_start) fail(`${context} ends before it starts`);
}

function receiptIdFor(prefix, record, idField) {
  const { [idField]: _id, $schema: _schemaRef, ...body } = record;
  return `${prefix}:${contentIdForJson(body)}`;
}

function checkReceiptId(prefix, record, idField, context) {
  if (record[idField] !== receiptIdFor(prefix, record, idField)) {
    fail(`${context} ${idField} does not match its canonical contents`);
  }
}

function resolveFile(path, workspaceRoot) {
  return isAbsolute(path) ? path : resolve(workspaceRoot, path);
}

async function verifiedBinding(binding, workspaceRoot, context) {
  fileBinding(binding, context);
  const current = await fileReceipt(resolveFile(binding.path, workspaceRoot), binding.path);
  if (current.content_id !== binding.content_id || current.bytes !== binding.bytes) {
    fail(`${context} no longer matches its recorded bytes (${binding.path})`);
  }
  return current;
}

export async function readJsonFile(path, context = path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    throw new Error(`bench gold: ${context} is not readable JSON`, { cause: error });
  }
}

async function jsonFilesIn(dir) {
  try {
    return (await readdir(dir, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => join(dir, entry.name))
      .sort((left, right) => left.localeCompare(right));
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

async function directoriesIn(dir) {
  try {
    return (await readdir(dir, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort((left, right) => left.localeCompare(right));
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

/* ------------------------------------------------- schema-backed validators */

let ajvValidators = null;

async function schemaValidators() {
  if (!ajvValidators) {
    ajvValidators = (async () => {
      const ajv = new Ajv2020({ allErrors: true, strict: true });
      ajv.addFormat("date", /^\d{4}-\d{2}-\d{2}$/);
      ajv.addFormat(
        "date-time",
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/,
      );
      const gold = JSON.parse(
        await readFile(new URL("../../bench/schemas/gold.schema.json", import.meta.url), "utf8"),
      );
      const adjudication = JSON.parse(
        await readFile(new URL("../../bench/schemas/adjudication.schema.json", import.meta.url), "utf8"),
      );
      return { gold: ajv.compile(gold), adjudication: ajv.compile(adjudication), ajv };
    })();
  }
  return ajvValidators;
}

export async function validateGold(gold, context = "gold candidate") {
  const { gold: validate, ajv } = await schemaValidators();
  if (!validate(gold)) {
    fail(`${context} failed schema validation:\n${ajv.errorsText(validate.errors, { separator: "\n" })}`);
  }
  const unitIds = new Set();
  for (const [index, unit] of gold.units.entries()) {
    timeRange(unit, `${context} unit ${index}`);
    for (const critical of unit.critical_units) {
      if (unitIds.has(critical.id)) fail(`${context} repeats critical unit id ${critical.id}`);
      unitIds.add(critical.id);
    }
  }
  return gold;
}

export async function validateAdjudication(receipt, context = "adjudication receipt") {
  const { adjudication: validate, ajv } = await schemaValidators();
  if (!validate(receipt)) {
    fail(`${context} failed schema validation:\n${ajv.errorsText(validate.errors, { separator: "\n" })}`);
  }
  checkReceiptId("bench-review", receipt, "review_id", context);
  for (const [index, decision] of receipt.unit_decisions.entries()) {
    timeRange(decision, `${context} unit decision ${index}`);
  }
  if (receipt.reviewer.name === receipt.drafter || receipt.reviewer.git_identity === receipt.drafter) {
    fail(`${context} was reviewed by its drafter`);
  }
  return receipt;
}

/* --------------------------------------------------- candidates manifest */

export function validateCandidatesManifest(manifest, context = "candidates manifest") {
  exactKeys(
    manifest,
    ["schema", "manifest_id", "run", "clip", "routing", "status", "scorable", "source_artifacts", "candidates", "notes"],
    context,
  );
  if (manifest.schema !== BENCH_GOLD_SCHEMAS.candidates) fail(`${context} schema is not registered`);
  if (manifest.status !== "candidate") fail(`${context} status must stay "candidate"`);
  if (manifest.scorable !== false) fail(`${context} must pin scorable to false: a mining manifest can never score anything`);
  requiredText(manifest.run, `${context} run`);
  exactKeys(manifest.clip, ["id", "lang", "duration_s"], `${context} clip`);
  requiredText(manifest.clip.id, `${context} clip id`);
  requiredText(manifest.clip.lang, `${context} clip lang`);
  if (typeof manifest.clip.duration_s !== "number" || manifest.clip.duration_s <= 0) {
    fail(`${context} clip duration is invalid`);
  }
  exactKeys(manifest.routing, ["route", "reason"], `${context} routing`);
  if (manifest.routing.route !== "gold" && manifest.routing.route !== "training") {
    fail(`${context} routing must be exactly gold or training, decided at mine time`);
  }
  requiredText(manifest.routing.reason, `${context} routing reason`);
  if (!Array.isArray(manifest.source_artifacts) || manifest.source_artifacts.length === 0) {
    fail(`${context} requires source artifact receipts`);
  }
  for (const [index, artifact] of manifest.source_artifacts.entries()) {
    fileBinding(artifact, `${context} source artifact ${index}`);
  }
  if (!Array.isArray(manifest.candidates) || manifest.candidates.length === 0) {
    fail(`${context} contains no candidates`);
  }
  for (const [index, candidate] of manifest.candidates.entries()) {
    const c = `${context} candidate ${index}`;
    exactKeys(
      candidate,
      ["t_start", "t_end", "source_text", "speakers", "signals", "gate", "corroboration", "phenomenon", "outputs", "korean_gold", "status"],
      c,
    );
    timeRange(candidate, c);
    requiredText(candidate.source_text, `${c} source_text`);
    if (!Array.isArray(candidate.speakers)) fail(`${c} speakers must be an array`);
    if (!Array.isArray(candidate.signals) || candidate.signals.length === 0) {
      fail(`${c} carries no signal; a candidate must say why it was mined`);
    }
    const seen = new Set();
    for (const signal of candidate.signals) {
      if (!CANDIDATE_SIGNALS.includes(signal)) fail(`${c} signal ${signal} is not registered`);
      if (seen.has(signal)) fail(`${c} repeats signal ${signal}`);
      seen.add(signal);
    }
    if (candidate.gate !== null) {
      exactKeys(candidate.gate, ["id", "reason"], `${c} gate`);
      requiredText(candidate.gate.id, `${c} gate id`);
      requiredText(candidate.gate.reason, `${c} gate reason`);
    }
    if (candidate.corroboration !== null && (typeof candidate.corroboration !== "object" || Array.isArray(candidate.corroboration))) {
      fail(`${c} corroboration must be an object or null`);
    }
    if (candidate.phenomenon !== null) requiredText(candidate.phenomenon, `${c} phenomenon`);
    if (!candidate.outputs || typeof candidate.outputs !== "object" || Array.isArray(candidate.outputs) || Object.keys(candidate.outputs).length === 0) {
      fail(`${c} outputs must record what each system emitted`);
    }
    for (const [systemId, output] of Object.entries(candidate.outputs)) {
      exactKeys(output, ["text", "withheld"], `${c} output ${systemId}`);
      if (output.text !== null && typeof output.text !== "string") fail(`${c} output ${systemId} text is invalid`);
      if (output.withheld !== null && (typeof output.withheld !== "object" || Array.isArray(output.withheld))) {
        fail(`${c} output ${systemId} withheld is invalid`);
      }
    }
    if (candidate.korean_gold !== null) {
      fail(`${c} carries korean_gold; a mining manifest structurally cannot hold gold — drafts live in a separate gold candidate file`);
    }
    if (candidate.status !== "candidate") fail(`${c} status must stay "candidate"`);
  }
  requiredText(manifest.notes, `${context} notes`);
  checkReceiptId("bench-candidates", manifest, "manifest_id", context);
  return manifest;
}

export function candidatesManifestId(body) {
  return receiptIdFor("bench-candidates", { manifest_id: null, ...body }, "manifest_id");
}

/* ----------------------------------------------------------- pack + freeze */

export function validatePack(pack, context = "pack manifest") {
  exactKeys(
    pack,
    ["schema", "pack_id", "label", "frozen", "target_clip_count", "clips", "freeze_receipt"],
    context,
  );
  if (pack.schema !== BENCH_GOLD_SCHEMAS.pack) fail(`${context} schema is not registered`);
  requiredText(pack.pack_id, `${context} pack_id`);
  requiredText(pack.label, `${context} label`);
  if (typeof pack.frozen !== "boolean") fail(`${context} frozen must be a boolean`);
  if (!Number.isInteger(pack.target_clip_count) || pack.target_clip_count < 1) {
    fail(`${context} target_clip_count is invalid`);
  }
  if (!Array.isArray(pack.clips) || pack.clips.length !== pack.target_clip_count) {
    fail(`${context} clip slots must match the declared target count`);
  }
  const slots = new Set();
  const clipIds = new Set();
  for (const clip of pack.clips) {
    const c = `${context} slot ${clip?.slot ?? "?"}`;
    exactKeys(clip, ["slot", "role", "status", "clip_id", "source", "gold_path", "candidates_manifest"], c);
    requiredText(clip.slot, `${c} slot`);
    if (slots.has(clip.slot)) fail(`${context} repeats slot ${clip.slot}`);
    slots.add(clip.slot);
    if (!CLIP_ROLES.has(clip.role)) fail(`${c} role is not registered`);
    if (!CLIP_STATUSES.has(clip.status)) fail(`${c} status is not registered`);
    if (clip.status === "planned") {
      if (clip.clip_id !== null || clip.source !== null || clip.gold_path !== null || clip.candidates_manifest !== null) {
        fail(`${c} is planned but already claims a source, gold, or manifest`);
      }
      continue;
    }
    requiredText(clip.clip_id, `${c} clip_id`);
    if (clipIds.has(clip.clip_id)) fail(`${context} repeats clip ${clip.clip_id}`);
    clipIds.add(clip.clip_id);
    if (!clip.source || typeof clip.source !== "object" || Array.isArray(clip.source)) {
      fail(`${c} claims ${clip.status} without source provenance`);
    }
    if (clip.status === "sourced") {
      if (clip.gold_path !== null) fail(`${c} is sourced but already claims gold`);
    } else {
      requiredText(clip.gold_path, `${c} gold_path`);
    }
    if (clip.candidates_manifest !== null) requiredText(clip.candidates_manifest, `${c} candidates_manifest`);
  }
  if (pack.frozen) {
    if (!pack.clips.every((clip) => clip.status === "frozen")) fail(`${context} is frozen with non-frozen clips`);
    requiredText(pack.freeze_receipt, `${context} freeze_receipt`);
  } else if (pack.clips.some((clip) => clip.status === "frozen") || pack.freeze_receipt !== null) {
    fail(`${context} has frozen clips or a freeze receipt without pack.frozen`);
  }
  return pack;
}

export function validateFreezeReceipt(receipt, context = "freeze receipt") {
  exactKeys(receipt, ["schema", "freeze_id", "pack_id", "frozen_at", "protocol", "clips"], context);
  if (receipt.schema !== BENCH_GOLD_SCHEMAS.freeze) fail(`${context} schema is not registered`);
  requiredText(receipt.pack_id, `${context} pack_id`);
  isoDateTime(receipt.frozen_at, `${context} frozen_at`);
  exactKeys(receipt.protocol, ["minimum_reviewers", "blinded_review", "adjudication_required"], `${context} protocol`);
  if (receipt.protocol.minimum_reviewers < 2 || receipt.protocol.blinded_review !== true || receipt.protocol.adjudication_required !== true) {
    fail(`${context} weakens the review protocol; two blinded human adjudications are the floor`);
  }
  if (!Array.isArray(receipt.clips) || receipt.clips.length === 0) fail(`${context} freezes no clips`);
  for (const clip of receipt.clips) {
    const c = `${context} clip ${clip?.clip_id ?? "?"}`;
    exactKeys(clip, ["clip_id", "role", "source_url", "gold", "candidates_manifest", "adjudications"], c);
    requiredText(clip.clip_id, `${c} clip_id`);
    if (clip.source_url !== null) requiredText(clip.source_url, `${c} source_url`);
    if (!CLIP_ROLES.has(clip.role)) fail(`${c} role is not registered`);
    fileBinding(clip.gold, `${c} gold`);
    if (clip.candidates_manifest !== null) fileBinding(clip.candidates_manifest, `${c} candidates_manifest`);
    if (clip.role === "control" && clip.candidates_manifest !== null) {
      fail(`${c} is a control clip mined from the system's own misses; controls must be independently sourced`);
    }
    if (!Array.isArray(clip.adjudications) || clip.adjudications.length < receipt.protocol.minimum_reviewers) {
      fail(`${c} lacks the required adjudication receipts`);
    }
    const names = new Set();
    const identities = new Set();
    for (const [index, adjudication] of clip.adjudications.entries()) {
      const a = `${c} adjudication ${index}`;
      exactKeys(adjudication, ["path", "content_id", "bytes", "review_id", "reviewer_name", "reviewer_git_identity"], a);
      fileBinding({ path: adjudication.path, content_id: adjudication.content_id, bytes: adjudication.bytes }, a);
      requiredText(adjudication.review_id, `${a} review_id`);
      requiredText(adjudication.reviewer_name, `${a} reviewer_name`);
      requiredText(adjudication.reviewer_git_identity, `${a} reviewer_git_identity`);
      if (names.has(adjudication.reviewer_name) || identities.has(adjudication.reviewer_git_identity)) {
        fail(`${c} adjudications do not come from distinct reviewers`);
      }
      names.add(adjudication.reviewer_name);
      identities.add(adjudication.reviewer_git_identity);
    }
  }
  checkReceiptId("bench-freeze", receipt, "freeze_id", context);
  return receipt;
}

/**
 * Everything that must be true before a pack may freeze. Reads bytes, not statuses: gold files
 * are re-hashed, adjudication receipts must bind those exact bytes, and the two reviewers must
 * be distinct declared humans who are not the drafter. Returns the freeze receipt body for
 * writeImmutableJson; it never mutates anything itself.
 *
 * v1 honesty boundary: reviewer distinctness is checked on declared name + git identity. That
 * proves the receipts CLAIM two humans, not that two humans exist. The documented expectation is
 * that each reviewer commits their own receipt from their own git identity so ancestry can be
 * audited; mechanical ancestry verification is future work, and until a real second
 * Korean-fluent reviewer is recruited no genuine freeze can happen at all.
 */
export async function freezeChecks({ pack, packDir, reviewsDir, frozenAt, workspaceRoot }) {
  validatePack(pack);
  if (pack.frozen) fail(`pack ${pack.pack_id} is already frozen`);
  const controls = pack.clips.filter((clip) => clip.role === "control");
  if (controls.length < 2) {
    fail(`pack ${pack.pack_id} needs at least two independently sourced control clips before freezing`);
  }
  const receipts = [];
  for (const path of await jsonFilesIn(reviewsDir)) {
    receipts.push({ path, receipt: await validateAdjudication(await readJsonFile(path), `adjudication ${path}`) });
  }

  const clips = [];
  for (const clip of pack.clips) {
    const c = `pack ${pack.pack_id} slot ${clip.slot}`;
    if (clip.status !== "gold_ready") fail(`${c} is ${clip.status}; every clip must be gold_ready to freeze`);
    const goldPath = join(packDir, clip.gold_path);
    const gold = await validateGold(await readJsonFile(goldPath), `${c} gold`);
    if (gold.pack_id !== pack.pack_id || gold.clip_id !== clip.clip_id) {
      fail(`${c} gold names a different pack or clip`);
    }
    const goldBinding = await fileReceipt(goldPath, join("bench/packs", pack.pack_id, clip.gold_path));

    let manifestBinding = null;
    if (clip.role === "control") {
      if (gold.mined_from !== null || clip.candidates_manifest !== null) {
        fail(`${c} is a control clip but was mined from the system's own misses`);
      }
    } else if (gold.mined_from !== null) {
      manifestBinding = await verifiedBinding(gold.mined_from, workspaceRoot, `${c} mined_from`);
      const manifest = validateCandidatesManifest(
        await readJsonFile(resolveFile(gold.mined_from.path, workspaceRoot)),
        `${c} candidates manifest`,
      );
      if (manifest.clip.id !== clip.clip_id) fail(`${c} candidates manifest names a different clip`);
      if (manifest.routing.route !== "gold") {
        fail(`${c} was routed to training at mine time; exclusive routing forbids freezing it as gold`);
      }
      manifestBinding = { path: gold.mined_from.path, content_id: manifestBinding.content_id, bytes: manifestBinding.bytes };
    }

    const accepts = receipts.filter(
      ({ receipt }) =>
        receipt.pack_id === pack.pack_id &&
        receipt.clip_id === clip.clip_id &&
        receipt.action === "accept" &&
        receipt.blinded === true &&
        receipt.candidate.content_id === goldBinding.content_id &&
        receipt.candidate.bytes === goldBinding.bytes &&
        receipt.drafter === gold.drafter,
    );
    const names = new Set();
    const identities = new Set();
    const distinct = [];
    for (const entry of accepts) {
      const { reviewer } = entry.receipt;
      if (reviewer.name === gold.drafter || reviewer.git_identity === gold.drafter) continue;
      if (names.has(reviewer.name) || identities.has(reviewer.git_identity)) continue;
      names.add(reviewer.name);
      identities.add(reviewer.git_identity);
      distinct.push(entry);
    }
    if (distinct.length < 2) {
      fail(
        `${c} has ${distinct.length} distinct blinded human accept receipt(s) binding the current gold bytes; freezing requires two. This is the human bottleneck, and it is not solvable in code.`,
      );
    }
    for (const { receipt } of distinct.slice(0, 2)) {
      if (Date.parse(frozenAt) < Date.parse(receipt.created_at)) {
        fail(
          `${c} freeze at ${frozenAt} predates adjudication ${receipt.review_id} (${receipt.created_at}); a freeze cannot be dated before the receipts that authorize it`,
        );
      }
    }
    clips.push({
      clip_id: clip.clip_id,
      role: clip.role,
      source_url: typeof clip.source?.url === "string" && clip.source.url.trim() ? clip.source.url : null,
      gold: goldBinding,
      candidates_manifest: manifestBinding,
      adjudications: await Promise.all(
        distinct.slice(0, 2).map(async ({ path, receipt }) => {
          const binding = await fileReceipt(path, path.startsWith(workspaceRoot) ? path.slice(workspaceRoot.length + 1) : path);
          return {
            ...binding,
            review_id: receipt.review_id,
            reviewer_name: receipt.reviewer.name,
            reviewer_git_identity: receipt.reviewer.git_identity,
          };
        }),
      ),
    });
  }

  const body = {
    schema: BENCH_GOLD_SCHEMAS.freeze,
    pack_id: pack.pack_id,
    frozen_at: isoDateTime(frozenAt, "frozen_at"),
    protocol: { minimum_reviewers: 2, blinded_review: true, adjudication_required: true },
    clips,
  };
  const receipt = { freeze_id: receiptIdFor("bench-freeze", { freeze_id: null, ...body }, "freeze_id"), ...body };
  return validateFreezeReceipt(receipt);
}

/* ----------------------------------------------------------- output labels */

export function validateOutputLabels(labels, context = "output labels") {
  exactKeys(
    labels,
    ["schema", "labels_id", "pack_id", "clip_id", "run", "capture", "blinded", "reviewers", "labels", "notes"],
    context,
  );
  if (labels.schema !== BENCH_GOLD_SCHEMAS.labels) fail(`${context} schema is not registered`);
  requiredText(labels.pack_id, `${context} pack_id`);
  requiredText(labels.clip_id, `${context} clip_id`);
  requiredText(labels.run, `${context} run`);
  fileBinding(labels.capture, `${context} capture`);
  if (labels.blinded !== true) fail(`${context} must record blinded review; unblinded labels cannot score anything`);
  if (!Array.isArray(labels.reviewers) || labels.reviewers.length < 2) {
    fail(`${context} requires at least two reviewers`);
  }
  const names = new Set();
  const identities = new Set();
  for (const [index, reviewer] of labels.reviewers.entries()) {
    exactKeys(reviewer, ["name", "git_identity"], `${context} reviewer ${index}`);
    requiredText(reviewer.name, `${context} reviewer ${index} name`);
    requiredText(reviewer.git_identity, `${context} reviewer ${index} git_identity`);
    if (names.has(reviewer.name) || identities.has(reviewer.git_identity)) {
      fail(`${context} reviewers are not distinct`);
    }
    names.add(reviewer.name);
    identities.add(reviewer.git_identity);
  }
  if (!Array.isArray(labels.labels) || labels.labels.length === 0) fail(`${context} contains no labels`);
  const seen = new Set();
  for (const [index, label] of labels.labels.entries()) {
    const l = `${context} label ${index}`;
    exactKeys(label, ["t_start", "t_end", "system_id", "meaning_preserved", "critical_units", "note"], l);
    timeRange(label, l);
    requiredText(label.system_id, `${l} system_id`);
    if (typeof label.meaning_preserved !== "boolean") fail(`${l} meaning_preserved must be a boolean`);
    if (!Array.isArray(label.critical_units) || label.critical_units.length === 0) {
      fail(`${l} judges no critical units`);
    }
    for (const [cuIndex, cu] of label.critical_units.entries()) {
      exactKeys(cu, ["id", "correct", "catastrophic"], `${l} critical unit ${cuIndex}`);
      requiredText(cu.id, `${l} critical unit ${cuIndex} id`);
      if (typeof cu.correct !== "boolean" || typeof cu.catastrophic !== "boolean") {
        fail(`${l} critical unit ${cuIndex} judgments must be booleans`);
      }
      if (cu.catastrophic && cu.correct) {
        fail(`${l} critical unit ${cuIndex} is both correct and catastrophic`);
      }
    }
    if (label.note !== null) requiredText(label.note, `${l} note`);
    const key = `${label.t_start}\0${label.t_end}\0${label.system_id}`;
    if (seen.has(key)) fail(`${context} repeats a label for the same unit and system`);
    seen.add(key);
  }
  requiredText(labels.notes, `${context} notes`);
  checkReceiptId("bench-labels", labels, "labels_id", context);
  return labels;
}

/* ------------------------------------------------------------------ scoring */

function overlapSeconds(a, b) {
  return Math.min(a.t_end, b.t_end) - Math.max(a.t_start, b.t_start);
}

/**
 * Pure derivation of one score receipt. Every input arrives already validated and byte-bound by
 * the caller; this function decides outcomes and refuses to invent anything:
 *
 * - withheld / missing are mechanical (read off the capture's outputs);
 * - correct / wrong / catastrophic exist only as human labels, required for every emitted line
 *   and forbidden for every non-emitted one;
 * - a capture dated on or before the freeze day cannot be scored (pre-registration: gold must
 *   exist before the run it grades, and within-day ordering is unprovable so the same day fails);
 * - zero denominators leave rates null, never zero; there is no composite score and coverage
 *   does not appear at all.
 */
export function scoreCapture({ gold, freeze, capture, labels, bindings, scoredAt }) {
  const frozenClip = freeze.clips.find((clip) => clip.clip_id === gold.clip_id);
  if (!frozenClip) fail(`freeze receipt ${freeze.freeze_id} does not freeze clip ${gold.clip_id}`);
  if (freeze.pack_id !== gold.pack_id) fail("gold and freeze receipt name different packs");
  if (frozenClip.gold.content_id !== bindings.gold.content_id || frozenClip.gold.bytes !== bindings.gold.bytes) {
    fail("the gold being scored against is not the gold the freeze receipt bound; a candidate or amended gold cannot score anything");
  }
  if (capture.scored !== false || capture.pack_evidence !== false) {
    fail("capture claims scored or pack-evidence status it cannot have");
  }
  if (capture.clip.id !== gold.clip_id) fail("capture and gold name different clips");
  if (labels.pack_id !== gold.pack_id || labels.clip_id !== gold.clip_id || labels.run !== capture.capture_id) {
    fail("output labels do not name this pack, clip, and capture");
  }
  if (labels.capture.content_id !== bindings.capture.content_id || labels.capture.bytes !== bindings.capture.bytes) {
    fail("output labels do not bind the exact capture bytes being scored");
  }

  const capturedDay = isoDate(capture.captured_at, "capture captured_at");
  const frozenDay = isoDateTime(freeze.frozen_at, "freeze frozen_at").slice(0, 10);
  if (capturedDay <= frozenDay) {
    fail(
      `pre-registration: capture ${capture.capture_id} is dated ${capturedDay}, not strictly after the pack freeze on ${frozenDay}. Same-day ordering is unprovable, so it fails closed.`,
    );
  }

  const systems = {};
  const labelFor = new Map(labels.labels.map((label) => [`${label.t_start}\0${label.t_end}\0${label.system_id}`, label]));
  const usedLabels = new Set();

  for (const system of capture.systems) {
    const measured = capture.measured[system.id];
    if (!measured) fail(`capture measured nothing for system ${system.id}`);
    const perLine = [];

    for (const unit of gold.units) {
      // EVERY capture unit overlapping the gold window is consulted, not just the best match.
      // The diarizer is non-deterministic (11-15 segments observed on one clip), so a gold
      // window routinely spans several capture units; pairing with only the largest overlap
      // would let an emission in the smaller segment — including a catastrophic one — vanish
      // from the receipt with no label required and none permitted. If ANYTHING was emitted in
      // the window, the window was emitted and a human must judge it.
      const outputs = capture.units
        .filter((candidate) => overlapSeconds(unit, candidate) > 0)
        .map((candidate) => candidate.outputs?.[system.id] ?? null)
        .filter((output) => output !== null);
      const emitted = outputs.some((output) => output.withheld === null && typeof output.text === "string");
      const withheld = !emitted && outputs.some((output) => output.withheld !== null);
      const key = `${unit.t_start}\0${unit.t_end}\0${system.id}`;
      const label = labelFor.get(key) ?? null;

      if (!emitted && label) {
        fail(
          `a human label exists for ${system.id} at ${unit.t_start}-${unit.t_end}, but the system emitted nothing there; a judgment about nothing is fabricated evidence`,
        );
      }

      if (withheld) {
        perLine.push({
          t_start: unit.t_start,
          t_end: unit.t_end,
          disposition: "withheld",
          meaning_preserved: null,
          critical_units: unit.critical_units.map((cu) => ({ id: cu.id, outcome: "withheld", catastrophic: null })),
          basis: "mechanical",
        });
        continue;
      }
      if (!emitted) {
        perLine.push({
          t_start: unit.t_start,
          t_end: unit.t_end,
          disposition: "missing",
          meaning_preserved: null,
          critical_units: unit.critical_units.map((cu) => ({ id: cu.id, outcome: "missing", catastrophic: null })),
          basis: "mechanical",
        });
        continue;
      }
      if (!label) {
        fail(
          `system ${system.id} emitted a line at ${unit.t_start}-${unit.t_end} and no human label judges it; correctness is not derivable by this process, so scoring fails closed`,
        );
      }
      usedLabels.add(key);
      const expectedIds = unit.critical_units.map((cu) => cu.id).sort();
      const labelledIds = label.critical_units.map((cu) => cu.id).sort();
      if (JSON.stringify(expectedIds) !== JSON.stringify(labelledIds)) {
        fail(`label for ${system.id} at ${unit.t_start}-${unit.t_end} does not judge exactly the pre-registered critical units`);
      }
      perLine.push({
        t_start: unit.t_start,
        t_end: unit.t_end,
        disposition: "emitted",
        meaning_preserved: label.meaning_preserved,
        critical_units: label.critical_units.map((cu) => ({
          id: cu.id,
          outcome: cu.correct ? "correct" : "wrong",
          catastrophic: cu.catastrophic,
        })),
        basis: "human_label",
      });
    }

    const criticalUnits = perLine.flatMap((line) => line.critical_units);
    const outcomes = {
      correct: criticalUnits.filter((cu) => cu.outcome === "correct").length,
      wrong: criticalUnits.filter((cu) => cu.outcome === "wrong").length,
      withheld: criticalUnits.filter((cu) => cu.outcome === "withheld").length,
      missing: criticalUnits.filter((cu) => cu.outcome === "missing").length,
      total: criticalUnits.length,
    };
    const passes = perLine.filter((line) => line.meaning_preserved === true).length;
    const meaningTotal = gold.units.length;
    const emittedCritical = perLine
      .filter((line) => line.disposition === "emitted")
      .reduce((sum, line) => sum + line.critical_units.length, 0);
    const catastrophicCount = criticalUnits.filter((cu) => cu.catastrophic === true).length;

    systems[system.id] = {
      role: system.role,
      per_line: perLine,
      headline: {
        critical_meaning: {
          passes,
          total: meaningTotal,
          rate: meaningTotal === 0 ? null : passes / meaningTotal,
        },
        critical_outcomes: outcomes,
        catastrophic: {
          count: catastrophicCount,
          denominator: emittedCritical,
          rate: emittedCritical === 0 ? null : catastrophicCount / emittedCritical,
        },
        latency: {
          first_usable_s: measured.latency.first_usable_s,
          complete_s: measured.latency.complete_s,
        },
      },
    };
  }

  for (const label of labels.labels) {
    const key = `${label.t_start}\0${label.t_end}\0${label.system_id}`;
    if (!usedLabels.has(key)) {
      fail(
        `label at ${label.t_start}-${label.t_end} for ${label.system_id} matches no pre-registered gold unit and system; a label that grades nothing is fabricated evidence`,
      );
    }
  }

  const subject = capture.systems.filter((system) => system.role === "subject");
  const control = capture.systems.filter((system) => system.role === "internal_control");
  const delta =
    subject.length === 1 && control.length === 1
      ? {
          subject: subject[0].id,
          internal_control: control[0].id,
          critical_meaning_rate:
            systems[subject[0].id].headline.critical_meaning.rate !== null &&
            systems[control[0].id].headline.critical_meaning.rate !== null
              ? systems[subject[0].id].headline.critical_meaning.rate - systems[control[0].id].headline.critical_meaning.rate
              : null,
          catastrophic_count:
            systems[subject[0].id].headline.catastrophic.count - systems[control[0].id].headline.catastrophic.count,
        }
      : null;

  const body = {
    schema: BENCH_GOLD_SCHEMAS.score,
    pack_id: gold.pack_id,
    clip_id: gold.clip_id,
    run: capture.capture_id,
    scored_at: isoDateTime(scoredAt, "scored_at"),
    judge: null,
    bindings,
    preregistration: { frozen_at: freeze.frozen_at, captured_at: capture.captured_at, capture_after_freeze: true },
    systems,
    delta_vs_cold: delta,
    notes:
      "Withheld and missing are mechanical; correct, wrong, and catastrophic are human labels; judge is pinned null because no model grades anything in this pipeline. There is no composite score and coverage appears nowhere in this receipt: a system must not look better by refusing everything or by flooding easy lines.",
  };
  const receipt = { score_id: receiptIdFor("bench-score", { score_id: null, ...body }, "score_id"), ...body };
  return validateScoreReceipt(receipt);
}

export function validateScoreReceipt(receipt, context = "score receipt") {
  exactKeys(
    receipt,
    ["schema", "score_id", "pack_id", "clip_id", "run", "scored_at", "judge", "bindings", "preregistration", "systems", "delta_vs_cold", "notes"],
    context,
  );
  if (receipt.schema !== BENCH_GOLD_SCHEMAS.score) fail(`${context} schema is not registered`);
  requiredText(receipt.pack_id, `${context} pack_id`);
  requiredText(receipt.clip_id, `${context} clip_id`);
  requiredText(receipt.run, `${context} run`);
  isoDateTime(receipt.scored_at, `${context} scored_at`);
  if (receipt.judge !== null) {
    fail(`${context} names a judge; no LLM-judge path exists in this contract version, and adding one must be a visible schema change with a pinned different-family model, not a default`);
  }
  exactKeys(receipt.bindings, ["gold", "freeze", "capture", "labels"], `${context} bindings`);
  for (const name of ["gold", "freeze", "capture", "labels"]) {
    fileBinding(receipt.bindings[name], `${context} bindings.${name}`);
  }
  exactKeys(receipt.preregistration, ["frozen_at", "captured_at", "capture_after_freeze"], `${context} preregistration`);
  const frozenDay = isoDateTime(receipt.preregistration.frozen_at, `${context} frozen_at`).slice(0, 10);
  const capturedDay = isoDate(receipt.preregistration.captured_at, `${context} captured_at`);
  if (receipt.preregistration.capture_after_freeze !== true || capturedDay <= frozenDay) {
    fail(`${context} violates pre-registration: the capture must be dated strictly after the freeze`);
  }
  if (!receipt.systems || typeof receipt.systems !== "object" || Array.isArray(receipt.systems) || Object.keys(receipt.systems).length === 0) {
    fail(`${context} scores no systems`);
  }
  for (const [systemId, system] of Object.entries(receipt.systems)) {
    const s = `${context} system ${systemId}`;
    exactKeys(system, ["role", "per_line", "headline"], s);
    requiredText(system.role, `${s} role`);
    if (!Array.isArray(system.per_line) || system.per_line.length === 0) fail(`${s} has no per-line evidence`);
    const criticalUnits = [];
    let passes = 0;
    let emittedCritical = 0;
    for (const [index, line] of system.per_line.entries()) {
      const l = `${s} line ${index}`;
      exactKeys(line, ["t_start", "t_end", "disposition", "meaning_preserved", "critical_units", "basis"], l);
      timeRange(line, l);
      if (!["emitted", "withheld", "missing"].includes(line.disposition)) fail(`${l} disposition is not registered`);
      if (line.disposition === "emitted") {
        if (typeof line.meaning_preserved !== "boolean" || line.basis !== "human_label") {
          fail(`${l} is emitted without a human meaning judgment`);
        }
        if (line.meaning_preserved) passes += 1;
        emittedCritical += line.critical_units.length;
      } else if (line.meaning_preserved !== null || line.basis !== "mechanical") {
        fail(`${l} is ${line.disposition} but carries a judgment; refusals and misses are mechanical facts`);
      }
      if (!Array.isArray(line.critical_units) || line.critical_units.length === 0) fail(`${l} has no critical units`);
      for (const cu of line.critical_units) {
        exactKeys(cu, ["id", "outcome", "catastrophic"], `${l} critical unit`);
        if (!["correct", "wrong", "withheld", "missing"].includes(cu.outcome)) fail(`${l} critical unit outcome is not registered`);
        if (line.disposition === "emitted") {
          if (cu.outcome === "withheld" || cu.outcome === "missing" || typeof cu.catastrophic !== "boolean") {
            fail(`${l} emitted line carries non-emitted critical outcomes`);
          }
          if (cu.catastrophic && cu.outcome === "correct") fail(`${l} critical unit is both correct and catastrophic`);
        } else if (cu.outcome !== line.disposition || cu.catastrophic !== null) {
          fail(`${l} critical unit outcome disagrees with its line disposition`);
        }
        criticalUnits.push(cu);
      }
    }
    const outcomes = system.headline.critical_outcomes;
    const recount = {
      correct: criticalUnits.filter((cu) => cu.outcome === "correct").length,
      wrong: criticalUnits.filter((cu) => cu.outcome === "wrong").length,
      withheld: criticalUnits.filter((cu) => cu.outcome === "withheld").length,
      missing: criticalUnits.filter((cu) => cu.outcome === "missing").length,
      total: criticalUnits.length,
    };
    exactKeys(system.headline, ["critical_meaning", "critical_outcomes", "catastrophic", "latency"], `${s} headline`);
    exactKeys(outcomes, ["correct", "wrong", "withheld", "missing", "total"], `${s} critical_outcomes`);
    for (const key of Object.keys(recount)) {
      if (outcomes[key] !== recount[key]) fail(`${s} critical_outcomes.${key} does not match its per-line evidence`);
    }
    if (outcomes.correct + outcomes.wrong + outcomes.withheld + outcomes.missing !== outcomes.total) {
      fail(`${s} critical outcomes do not sum to total`);
    }
    const meaning = system.headline.critical_meaning;
    exactKeys(meaning, ["passes", "total", "rate"], `${s} critical_meaning`);
    if (meaning.passes !== passes || meaning.total !== system.per_line.length) {
      fail(`${s} critical_meaning does not match its per-line evidence`);
    }
    if (meaning.total === 0) {
      if (meaning.rate !== null) fail(`${s} zero-denominator meaning rate must stay null`);
    } else if (meaning.rate === null || Math.abs(meaning.rate - meaning.passes / meaning.total) >= 1e-9) {
      fail(`${s} critical meaning rate is inconsistent`);
    }
    const catastrophic = system.headline.catastrophic;
    exactKeys(catastrophic, ["count", "denominator", "rate"], `${s} catastrophic`);
    const catastrophicRecount = criticalUnits.filter((cu) => cu.catastrophic === true).length;
    if (catastrophic.count !== catastrophicRecount || catastrophic.denominator !== emittedCritical) {
      fail(`${s} catastrophic counts do not match their per-line evidence`);
    }
    if (catastrophic.denominator === 0) {
      if (catastrophic.rate !== null) fail(`${s} zero-denominator catastrophic rate must stay null, never zero`);
    } else if (catastrophic.rate === null || Math.abs(catastrophic.rate - catastrophic.count / catastrophic.denominator) >= 1e-9) {
      fail(`${s} catastrophic rate is inconsistent`);
    }
    exactKeys(system.headline.latency, ["first_usable_s", "complete_s"], `${s} latency`);
  }
  if (receipt.delta_vs_cold !== null) {
    exactKeys(receipt.delta_vs_cold, ["subject", "internal_control", "critical_meaning_rate", "catastrophic_count"], `${context} delta_vs_cold`);
    const subject = receipt.systems[receipt.delta_vs_cold.subject];
    const control = receipt.systems[receipt.delta_vs_cold.internal_control];
    if (!subject || !control || subject.role !== "subject" || control.role !== "internal_control") {
      fail(`${context} delta_vs_cold names systems it did not score`);
    }
    const expectedRate =
      subject.headline.critical_meaning.rate !== null && control.headline.critical_meaning.rate !== null
        ? subject.headline.critical_meaning.rate - control.headline.critical_meaning.rate
        : null;
    const recordedRate = receipt.delta_vs_cold.critical_meaning_rate;
    if (
      (expectedRate === null) !== (recordedRate === null) ||
      (expectedRate !== null && Math.abs(expectedRate - recordedRate) >= 1e-9)
    ) {
      fail(`${context} delta_vs_cold meaning rate is inconsistent`);
    }
    if (receipt.delta_vs_cold.catastrophic_count !== subject.headline.catastrophic.count - control.headline.catastrophic.count) {
      fail(`${context} delta_vs_cold catastrophic count is inconsistent`);
    }
  }
  requiredText(receipt.notes, `${context} notes`);
  checkReceiptId("bench-score", receipt, "score_id", context);
  return receipt;
}

/* ------------------------------------------------- repository-level guards */

export async function loadCandidatesManifests(candidatesDir, workspaceRoot) {
  const manifests = [];
  for (const run of await directoriesIn(candidatesDir)) {
    const path = join(candidatesDir, run, "candidates.json");
    const manifest = validateCandidatesManifest(await readJsonFile(path), `candidates manifest ${run}`);
    if (manifest.run !== run) fail(`candidates manifest ${path} names run ${manifest.run}`);
    for (const [index, artifact] of manifest.source_artifacts.entries()) {
      await verifiedBinding(artifact, workspaceRoot, `candidates manifest ${run} source artifact ${index}`);
    }
    manifests.push({ path, manifest });
  }
  return manifests;
}

/**
 * Exclusive routing and clip-level contamination, enforced in one place.
 *
 * The routing decision is per CLIP, not per byte: a glossary entry mined from a committed line
 * of clip X legally carries exactly the knowledge a gold unit from a withheld line of clip X
 * tests, so byte-level content-id matching would miss the leak. A clip routed to gold — or
 * already sitting in a pack — must therefore contribute nothing to reviewed memory, and a clip
 * routed to training may never enter a pack.
 *
 * Proposals name their clip in source.clip_id (run-clip.mjs writes it). When a proposal only
 * names a run, the run is resolved to its clip; a proposal whose run cannot be resolved fails
 * closed, because "we cannot check" is not "clean".
 */
export function contaminationGuard({ proposals, manifests, packClips, resolveRunClip }) {
  const routes = new Map();
  for (const { path, manifest } of manifests) {
    const existing = routes.get(manifest.clip.id);
    if (existing && existing.route !== manifest.routing.route) {
      fail(
        `clip ${manifest.clip.id} is routed ${existing.route} by ${existing.path} and ${manifest.routing.route} by ${path}; exclusive routing allows exactly one`,
      );
    }
    routes.set(manifest.clip.id, { route: manifest.routing.route, path });
  }

  for (const { pack_id: packId, clip_id: clipId } of packClips) {
    const route = routes.get(clipId);
    if (route?.route === "training") {
      fail(`clip ${clipId} was routed to training at mine time but appears in pack ${packId}; exclusive routing forbids it`);
    }
  }

  const guarded = new Set([
    ...packClips.map((clip) => clip.clip_id),
    ...[...routes.entries()].filter(([, value]) => value.route === "gold").map(([clipId]) => clipId),
  ]);

  for (const proposal of proposals) {
    const clips = new Set();
    const runs = new Set();
    if (proposal.source && typeof proposal.source === "object" && !Array.isArray(proposal.source)) {
      if (typeof proposal.source.clip_id === "string") clips.add(proposal.source.clip_id);
      if (typeof proposal.source.run_id === "string") runs.add(proposal.source.run_id);
    }
    for (const evidence of proposal.evidence) {
      const match = /(?:public\/demo\/runs|\.studio\/runs)\/([^/]+)\//.exec(evidence.path);
      if (match) {
        runs.add(match[1]);
      } else if (clips.size === 0) {
        // Evidence from nowhere recognizable, on a proposal that names no clip of its own:
        // there is nothing to check this against, and "we cannot check" is not "clean".
        fail(
          `memory proposal ${proposal.proposal_id} evidence ${evidence.path} cannot be attributed to any run or clip; contamination cannot be checked, so it fails closed`,
        );
      }
    }
    for (const run of runs) {
      const clip = resolveRunClip(run);
      if (clip === null) {
        // Unconditional: a self-declared source.clip_id is the proposal's own claim about
        // itself and must never stand in for a run reference that cannot be verified.
        fail(
          `memory proposal ${proposal.proposal_id} references run ${run} whose clip cannot be resolved; contamination cannot be checked, so it fails closed`,
        );
      }
      clips.add(clip);
    }
    for (const clip of clips) {
      if (guarded.has(clip)) {
        fail(
          `memory proposal ${proposal.proposal_id} draws on clip ${clip}, which is routed to gold or held by a pack; a bench clip contributes nothing to memory, ever`,
        );
      }
    }
  }

  return { routes, guarded };
}

/**
 * Score-everything: once a pack is frozen, every capture of a pack clip pinned after the freeze
 * must carry a score receipt. Best-of-K rerun cherry-picking becomes structurally visible
 * instead of procedurally forbidden.
 */
export function scoreEverythingCheck({ freezes, captures, scores }) {
  for (const freeze of freezes) {
    const frozenDay = freeze.frozen_at.slice(0, 10);
    const clipIds = new Set(freeze.clips.map((clip) => clip.clip_id));
    const sourceUrls = new Set(freeze.clips.map((clip) => clip.source_url).filter(Boolean));
    for (const capture of captures) {
      if (capture.captured_at <= frozenDay) continue;
      // Clip identity is matched on the id AND on the recorded source url: a rerun pinned
      // under a fresh label is still a capture of the frozen media, and relabelling must not
      // exempt it from scoring.
      const idMatch = clipIds.has(capture.clip.id);
      const urlMatch = typeof capture.clip?.source?.url === "string" && sourceUrls.has(capture.clip.source.url);
      if (urlMatch && !idMatch) {
        fail(
          `capture ${capture.capture_id} carries clip id ${capture.clip.id} but its source url matches a clip frozen in ${freeze.pack_id}; identity confusion over frozen media fails closed`,
        );
      }
      if (!idMatch) continue;
      const scored = scores.some(
        (score) => score.run === capture.capture_id && score.pack_id === freeze.pack_id,
      );
      if (!scored) {
        fail(
          `capture ${capture.capture_id} of pack clip ${capture.clip.id} is dated after the ${freeze.pack_id} freeze and has no score receipt; every post-freeze capture must be scored so a favourable rerun cannot be selected silently`,
        );
      }
    }
  }
}

export { verifiedBinding, receiptIdFor, exactKeys as exactBenchKeys };
