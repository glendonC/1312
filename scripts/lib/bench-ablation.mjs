/**
 * Result-free ablation pre-registration over one frozen benchmark pack.
 *
 * A registration binds current pack and freeze bytes, two content-addressed configurations,
 * and exactly one scalar leaf delta. It plans evaluation; it never carries outputs or scores.
 * Structural diagnostics remain explicitly separate from human-labelled semantic score receipts.
 */

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import Ajv2020 from "ajv/dist/2020.js";

import {
  BENCH_GOLD_SCHEMAS,
  readJsonFile,
  validateFreezeReceipt,
  validatePack,
  verifiedBinding,
} from "./bench-gold.mjs";
import { canonicalJson, contentIdForJson, fileReceipt } from "./immutable-receipts.mjs";

export const BENCH_ABLATION_SCHEMA = BENCH_GOLD_SCHEMAS.ablation;
export const BENCH_ABLATION_FAMILIES = Object.freeze([
  "acoustic_policy",
  "frame_context",
  "research_context",
  "raw_vs_eligible_stem",
  "restudy_pass",
]);

function fail(message) {
  throw new Error(`bench ablation: ${message}`);
}

function exactKeys(value, allowed, context) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(`${context} must be an object`);
  }
  const extras = Object.keys(value).filter((key) => key !== "$schema" && !allowed.includes(key));
  const missing = allowed.filter((key) => !(key in value));
  if (extras.length > 0 || missing.length > 0) {
    fail(
      `${context} shape is not closed${extras.length ? `; extra: ${extras.join(", ")}` : ""}${missing.length ? `; missing: ${missing.join(", ")}` : ""}`,
    );
  }
}

function requiredText(value, context) {
  if (typeof value !== "string" || !value.trim()) fail(`${context} must be a non-empty string`);
  return value.trim();
}

function exactIsoUtc(value, context) {
  const text = requiredText(value, context);
  if (Number.isNaN(Date.parse(text)) || new Date(text).toISOString() !== text) {
    fail(`${context} must be an exact ISO-8601 UTC timestamp`);
  }
  return text;
}

function pointerPart(value) {
  return String(value).replaceAll("~", "~0").replaceAll("/", "~1");
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function scalar(value) {
  return value === null || ["string", "number", "boolean"].includes(typeof value);
}

function scalarEqual(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}

function leafDifferences(left, right, path = "") {
  if (scalar(left) || scalar(right)) {
    if (!scalar(left) || !scalar(right)) fail(`configurations change shape at ${path || "/"}`);
    return scalarEqual(left, right) ? [] : [{ path, baseline: left, variant: right }];
  }

  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
      fail(`configurations change array shape at ${path || "/"}`);
    }
    return left.flatMap((value, index) => leafDifferences(value, right[index], `${path}/${index}`));
  }

  if (!isObject(left) || !isObject(right)) fail(`configurations contain a non-JSON value at ${path || "/"}`);
  const leftKeys = Object.keys(left).sort((a, b) => a.localeCompare(b));
  const rightKeys = Object.keys(right).sort((a, b) => a.localeCompare(b));
  if (canonicalJson(leftKeys) !== canonicalJson(rightKeys)) {
    fail(`configurations change object shape at ${path || "/"}`);
  }
  return leftKeys.flatMap((key) => leafDifferences(left[key], right[key], `${path}/${pointerPart(key)}`));
}

export function benchConfigId(config) {
  if (!isObject(config) || Object.keys(config).length === 0) fail("configuration must be a non-empty object");
  return `bench-config:${contentIdForJson(config)}`;
}

export function benchAblationId(registration) {
  const { ablation_id: _id, $schema: _schemaPointer, ...body } = registration;
  return `bench-ablation:${contentIdForJson(body)}`;
}

let schemaValidator = null;

async function validateSchema(registration, context) {
  if (!schemaValidator) {
    schemaValidator = (async () => {
      const schema = JSON.parse(
        await readFile(new URL("../../bench/schemas/ablation.schema.json", import.meta.url), "utf8"),
      );
      const ajv = new Ajv2020({ allErrors: true, strict: true });
      ajv.addFormat(
        "date-time",
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/,
      );
      const validate = ajv.compile(schema);
      return { ajv, validate };
    })();
  }
  const { ajv, validate } = await schemaValidator;
  if (!validate(registration)) {
    fail(`${context} failed schema validation:\n${ajv.errorsText(validate.errors, { separator: "\n" })}`);
  }
}

export async function validateAblationRegistration(
  registration,
  { workspaceRoot, context = "ablation registration" },
) {
  await validateSchema(registration, context);
  if (registration.schema !== BENCH_ABLATION_SCHEMA) fail(`${context} schema is not registered`);
  exactIsoUtc(registration.registered_at, `${context} registered_at`);

  const baseline = registration.subject.baseline;
  const variant = registration.subject.variant;
  if (baseline.config_id !== benchConfigId(baseline.config)) {
    fail(`${context} baseline config_id does not match its canonical configuration`);
  }
  if (variant.config_id !== benchConfigId(variant.config)) {
    fail(`${context} variant config_id does not match its canonical configuration`);
  }
  if (baseline.config_id === variant.config_id) fail(`${context} baseline and variant are identical`);

  const differences = leafDifferences(baseline.config, variant.config);
  if (differences.length !== 1) {
    fail(`${context} must change exactly one scalar configuration leaf; found ${differences.length}`);
  }
  const [difference] = differences;
  if (
    registration.delta.path !== difference.path ||
    !scalarEqual(registration.delta.baseline, difference.baseline) ||
    !scalarEqual(registration.delta.variant, difference.variant)
  ) {
    fail(`${context} delta does not describe the exact canonical configuration difference`);
  }

  if (registration.ablation_id !== benchAblationId(registration)) {
    fail(`${context} ablation_id does not match its canonical contents`);
  }

  const expectedPackPath = `bench/packs/${registration.pack.pack_id}/pack.json`;
  if (registration.pack.manifest.path !== expectedPackPath) {
    fail(`${context} manifest binding must be ${expectedPackPath}`);
  }
  await verifiedBinding(registration.pack.manifest, workspaceRoot, `${context} pack manifest`);
  const pack = validatePack(
    await readJsonFile(resolve(workspaceRoot, expectedPackPath), `${context} pack manifest`),
    `${context} pack manifest`,
  );
  if (pack.pack_id !== registration.pack.pack_id || !pack.frozen || !pack.freeze_receipt) {
    fail(`${context} must bind one currently frozen pack`);
  }

  const expectedFreezePath = `bench/packs/${pack.pack_id}/${pack.freeze_receipt}`;
  if (registration.pack.freeze.path !== expectedFreezePath) {
    fail(`${context} freeze binding must be ${expectedFreezePath}`);
  }
  await verifiedBinding(registration.pack.freeze, workspaceRoot, `${context} freeze receipt`);
  const freeze = validateFreezeReceipt(
    await readJsonFile(resolve(workspaceRoot, expectedFreezePath), `${context} freeze receipt`),
    `${context} freeze receipt`,
  );
  if (freeze.pack_id !== pack.pack_id) fail(`${context} pack and freeze receipt disagree`);
  if (Date.parse(registration.registered_at) <= Date.parse(freeze.frozen_at)) {
    fail(`${context} must be registered strictly after the frozen pack`);
  }
  const packClipIds = pack.clips.map((clip) => clip.clip_id).sort((a, b) => a.localeCompare(b));
  const freezeClipIds = freeze.clips.map((clip) => clip.clip_id).sort((a, b) => a.localeCompare(b));
  if (canonicalJson(packClipIds) !== canonicalJson(freezeClipIds)) {
    fail(`${context} frozen pack and freeze receipt name different clip sets`);
  }

  return registration;
}

/** Materialize ids and current frozen-pack byte bindings from a result-free draft. */
export async function materializeAblationRegistration(
  draft,
  { workspaceRoot, registeredAt = new Date().toISOString() },
) {
  exactKeys(
    draft,
    [
      "schema",
      "slug",
      "status",
      "family",
      "hypothesis",
      "pack",
      "subject",
      "delta",
      "capture_policy",
      "lanes",
      "results",
      "notes",
    ],
    "ablation draft",
  );
  exactKeys(draft.pack, ["pack_id"], "ablation draft pack");
  exactKeys(draft.subject, ["system_id", "baseline", "variant"], "ablation draft subject");
  exactKeys(draft.subject.baseline, ["config"], "ablation draft baseline");
  exactKeys(draft.subject.variant, ["config"], "ablation draft variant");

  if (typeof draft.pack.pack_id !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(draft.pack.pack_id)) {
    fail("ablation draft pack_id must be a lowercase slug");
  }
  const packPath = `bench/packs/${draft.pack.pack_id}/pack.json`;
  const pack = validatePack(
    await readJsonFile(resolve(workspaceRoot, packPath), "ablation draft pack"),
    "ablation draft pack",
  );
  if (pack.pack_id !== draft.pack.pack_id) fail("ablation draft pack path and manifest disagree");
  if (!pack.frozen || !pack.freeze_receipt) fail(`pack ${pack.pack_id} is not frozen`);
  const freezePath = `bench/packs/${pack.pack_id}/${pack.freeze_receipt}`;
  const body = {
    schema: draft.schema,
    slug: draft.slug,
    status: draft.status,
    registered_at: exactIsoUtc(registeredAt, "registration time"),
    family: draft.family,
    hypothesis: draft.hypothesis,
    pack: {
      pack_id: pack.pack_id,
      manifest: await fileReceipt(resolve(workspaceRoot, packPath), packPath),
      freeze: await fileReceipt(resolve(workspaceRoot, freezePath), freezePath),
    },
    subject: {
      system_id: draft.subject.system_id,
      baseline: {
        config_id: benchConfigId(draft.subject.baseline.config),
        config: draft.subject.baseline.config,
      },
      variant: {
        config_id: benchConfigId(draft.subject.variant.config),
        config: draft.subject.variant.config,
      },
    },
    delta: draft.delta,
    capture_policy: draft.capture_policy,
    lanes: draft.lanes,
    results: draft.results,
    notes: draft.notes,
  };
  const registration = { ablation_id: benchAblationId(body), ...body };
  return validateAblationRegistration(registration, { workspaceRoot });
}
