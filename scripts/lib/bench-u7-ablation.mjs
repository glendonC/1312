/** U7 raw-versus-stem input registration and exact capture-draft packaging. */

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import Ajv2020 from "ajv/dist/2020.js";

import {
  benchAblationId,
  benchConfigId,
  validateAblationRegistration,
} from "./bench-ablation.mjs";
import {
  readJsonFile,
  validatePack,
  validateScoreReceipt,
  verifiedBinding,
} from "./bench-gold.mjs";
import {
  canonicalJson,
  contentIdForJson,
  fileReceipt,
} from "./immutable-receipts.mjs";

export const BENCH_U7_INPUTS_SCHEMA = "studio.bench.u7-ablation-inputs.v1";
export const BENCH_U7_CAPTURE_BINDING_SCHEMA = "studio.bench.u7-capture-binding.v1";

function fail(message) {
  throw new Error(`bench U7 ablation: ${message}`);
}

function exactIsoUtc(value, context) {
  if (
    typeof value !== "string" ||
    Number.isNaN(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  ) {
    fail(`${context} must be an exact ISO-8601 UTC timestamp`);
  }
  return value;
}

function exactKeys(value, allowed, context) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${context} must be an object`);
  const extras = Object.keys(value).filter((key) => key !== "$schema" && !allowed.includes(key));
  const missing = allowed.filter((key) => !(key in value));
  if (extras.length > 0 || missing.length > 0) {
    fail(
      `${context} shape is not closed${extras.length ? `; extra: ${extras.join(", ")}` : ""}${missing.length ? `; missing: ${missing.join(", ")}` : ""}`,
    );
  }
}

function workspacePath(path, context) {
  if (typeof path !== "string" || !path || path.startsWith("/") || path.split("/").includes("..")) {
    fail(`${context} must be a contained workspace-relative path`);
  }
  return path;
}

export function benchU7InputsId(registry) {
  const { inputs_id: _id, $schema: _schemaPointer, ...body } = registry;
  return `bench-u7-inputs:${contentIdForJson(body)}`;
}

let inputsSchemaValidator = null;

async function validateInputsSchema(registry, context) {
  if (!inputsSchemaValidator) {
    inputsSchemaValidator = (async () => {
      const schema = JSON.parse(
        await readFile(new URL("../../bench/schemas/u7-ablation-inputs.schema.json", import.meta.url), "utf8"),
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
  const { ajv, validate } = await inputsSchemaValidator;
  if (!validate(registry)) {
    fail(`${context} failed schema validation:\n${ajv.errorsText(validate.errors, { separator: "\n" })}`);
  }
}

export async function validateU7AblationInputs(
  registry,
  { workspaceRoot, context = "U7 ablation inputs", verifySourceFiles = false },
) {
  await validateInputsSchema(registry, context);
  exactIsoUtc(registry.registered_at, `${context} registered_at`);
  if (registry.inputs_id !== benchU7InputsId(registry)) {
    fail(`${context} inputs_id does not match its canonical contents`);
  }

  const registrationPath = workspacePath(registry.ablation.registration.path, `${context} registration path`);
  await verifiedBinding(registry.ablation.registration, workspaceRoot, `${context} registration`);
  const registration = await validateAblationRegistration(
    await readJsonFile(resolve(workspaceRoot, registrationPath), `${context} registration`),
    { workspaceRoot, context: `${context} registration` },
  );
  if (
    registration.ablation_id !== registry.ablation.ablation_id ||
    benchAblationId(registration) !== registry.ablation.ablation_id ||
    registration.family !== "raw_vs_eligible_stem" ||
    registration.pack.pack_id !== registry.pack_id
  ) {
    fail(`${context} does not bind the registered raw-versus-eligible-stem ablation`);
  }
  if (Date.parse(registry.registered_at) <= Date.parse(registration.registered_at)) {
    fail(`${context} must be registered strictly after the ablation`);
  }

  const packPath = `bench/packs/${registry.pack_id}/pack.json`;
  const pack = validatePack(
    await readJsonFile(resolve(workspaceRoot, packPath), `${context} pack`),
    `${context} pack`,
  );
  if (!pack.frozen || pack.pack_id !== registry.pack_id) fail(`${context} pack is not frozen`);
  const expectedClipIds = pack.clips.map((clip) => clip.clip_id).sort((a, b) => a.localeCompare(b));
  const heldClipIds = registry.clips.map((clip) => clip.clip_id).sort((a, b) => a.localeCompare(b));
  if (new Set(heldClipIds).size !== heldClipIds.length || canonicalJson(expectedClipIds) !== canonicalJson(heldClipIds)) {
    fail(`${context} must register every frozen clip exactly once`);
  }

  for (const entry of registry.clips) {
    const clip = pack.clips.find((candidate) => candidate.clip_id === entry.clip_id);
    if (!clip) fail(`${context} names non-pack clip ${entry.clip_id}`);
    workspacePath(entry.source.path, `${context} ${entry.clip_id} source path`);
    if (entry.basis.kind === "pack_local_copy") {
      if (
        !clip.source?.local_copy ||
        clip.source.local_copy.path !== entry.source.path ||
        clip.source.local_copy.content_id !== entry.source.content_id ||
        clip.source.local_copy.bytes !== entry.source.bytes
      ) {
        fail(`${context} ${entry.clip_id} does not match its pack local-copy receipt`);
      }
    } else {
      workspacePath(entry.basis.capture.path, `${context} ${entry.clip_id} capture path`);
      workspacePath(entry.basis.score.path, `${context} ${entry.clip_id} score path`);
      await verifiedBinding(entry.basis.capture, workspaceRoot, `${context} ${entry.clip_id} scored capture`);
      await verifiedBinding(entry.basis.score, workspaceRoot, `${context} ${entry.clip_id} score receipt`);
      const capture = await readJsonFile(
        resolve(workspaceRoot, entry.basis.capture.path),
        `${context} ${entry.clip_id} scored capture`,
      );
      const score = validateScoreReceipt(
        await readJsonFile(resolve(workspaceRoot, entry.basis.score.path), `${context} ${entry.clip_id} score`),
        `${context} ${entry.clip_id} score`,
      );
      if (
        capture.clip?.id !== entry.clip_id ||
        capture.artifacts?.media !== entry.source.path ||
        score.pack_id !== registry.pack_id ||
        score.clip_id !== entry.clip_id ||
        score.run !== capture.capture_id ||
        score.bindings.capture.content_id !== entry.basis.capture.content_id ||
        score.bindings.capture.bytes !== entry.basis.capture.bytes
      ) {
        fail(`${context} ${entry.clip_id} source is not the media bound by its scored capture`);
      }
    }
    if (verifySourceFiles) {
      await verifiedBinding(entry.source, workspaceRoot, `${context} ${entry.clip_id} source`);
    }
  }

  return { registry, registration, pack };
}

export async function materializeU7AblationInputs(
  draft,
  { workspaceRoot, registeredAt = new Date().toISOString() },
) {
  exactKeys(draft, ["schema", "ablation", "clips", "notes"], "U7 input draft");
  exactKeys(draft.ablation, ["registration_path"], "U7 input draft ablation");
  const registrationPath = workspacePath(draft.ablation.registration_path, "U7 input draft registration");
  const registration = await validateAblationRegistration(
    await readJsonFile(resolve(workspaceRoot, registrationPath), "U7 input draft registration"),
    { workspaceRoot },
  );
  const clips = [];
  for (const [index, entry] of draft.clips.entries()) {
    exactKeys(entry, ["clip_id", "source_path", "basis"], `U7 input draft clip ${index}`);
    workspacePath(entry.source_path, `U7 input draft clip ${index} source`);
    exactKeys(
      entry.basis,
      entry.basis.kind === "pack_local_copy" ? ["kind"] : ["kind", "capture_path", "score_path"],
      `U7 input draft clip ${index} basis`,
    );
    const basis = entry.basis.kind === "pack_local_copy"
      ? { kind: "pack_local_copy" }
      : {
          kind: "scored_capture_media",
          capture: await fileReceipt(
            resolve(workspaceRoot, workspacePath(entry.basis.capture_path, "scored capture path")),
            entry.basis.capture_path,
          ),
          score: await fileReceipt(
            resolve(workspaceRoot, workspacePath(entry.basis.score_path, "score path")),
            entry.basis.score_path,
          ),
        };
    clips.push({
      clip_id: entry.clip_id,
      source: await fileReceipt(resolve(workspaceRoot, entry.source_path), entry.source_path),
      basis,
    });
  }
  const body = {
    schema: draft.schema,
    registered_at: exactIsoUtc(registeredAt, "U7 input registration time"),
    ablation: {
      ablation_id: registration.ablation_id,
      registration: await fileReceipt(resolve(workspaceRoot, registrationPath), registrationPath),
    },
    pack_id: registration.pack.pack_id,
    clips,
    notes: draft.notes,
  };
  const registry = { inputs_id: benchU7InputsId(body), ...body };
  return (await validateU7AblationInputs(registry, { workspaceRoot, verifySourceFiles: true })).registry;
}

function usableSegments(result) {
  return result.segments.filter(
    (segment) =>
      segment.state === "available" &&
      typeof segment.text === "string" &&
      segment.text.trim().length > 0,
  );
}

export function u7CaptureDisposition(result) {
  if (result.availability === "available") {
    return usableSegments(result).length > 0 ? "emitted" : "missing";
  }
  if (result.availability === "empty") return "missing";
  return "withheld";
}

function systemOutput(result, range, interval) {
  const disposition = u7CaptureDisposition(result);
  if (disposition === "missing") return { text: null, withheld: null };
  if (disposition === "withheld") {
    return {
      text: null,
      withheld: {
        gate: "u7_recognizer_availability",
        reason: `${result.availability}:${result.reason}`,
        range,
      },
    };
  }
  const text = usableSegments(result)
    .filter((segment) => segment.startMs < interval.endMs && segment.endMs > interval.startMs)
    .map((segment) => segment.text.trim())
    .join(" ");
  return { text: text || null, withheld: null };
}

export function u7CaptureUnits(raw, stem, range, rawSystemId, stemSystemId) {
  const boundaries = new Set([range.startMs, range.endMs]);
  for (const result of [raw, stem]) {
    if (u7CaptureDisposition(result) !== "emitted") continue;
    for (const segment of usableSegments(result)) {
      boundaries.add(segment.startMs);
      boundaries.add(segment.endMs);
    }
  }
  const ordered = [...boundaries].sort((left, right) => left - right);
  const units = [];
  for (let index = 0; index < ordered.length - 1; index += 1) {
    const interval = { startMs: ordered[index], endMs: ordered[index + 1] };
    if (interval.endMs <= interval.startMs) continue;
    const rawOutput = systemOutput(raw, range, interval);
    const stemOutput = systemOutput(stem, range, interval);
    units.push({
      t_start: interval.startMs / 1000,
      t_end: interval.endMs / 1000,
      source: rawOutput.text ?? "",
      outputs: {
        [rawSystemId]: rawOutput,
        [stemSystemId]: stemOutput,
      },
      gold: null,
    });
  }
  return units;
}

function measuredFor(units, systemId) {
  const outputs = units.map((unit) => unit.outputs[systemId]);
  const emitted = outputs.filter((output) => typeof output.text === "string").length;
  const withheld = outputs.filter((output) => output.withheld !== null).length;
  return {
    units_total: units.length,
    units_emitted: emitted,
    units_withheld: withheld,
    coverage: units.length === 0 ? 0 : emitted / units.length,
    latency: { first_usable_s: null, complete_s: null },
  };
}

export function benchU7CaptureId(body) {
  const { capture_id: _id, $schema: _schemaPointer, ...withoutId } = body;
  return `u7-ablation:${contentIdForJson({ ...withoutId, capture_id: null })}`;
}

let captureSchemaValidator = null;

async function validateCaptureSchema(capture, context) {
  if (!captureSchemaValidator) {
    captureSchemaValidator = (async () => {
      const schema = JSON.parse(
        await readFile(new URL("../../bench/schemas/capture.schema.json", import.meta.url), "utf8"),
      );
      const ajv = new Ajv2020({ allErrors: true, strict: true });
      ajv.addFormat("date", /^\d{4}-\d{2}-\d{2}$/);
      ajv.addFormat(
        "date-time",
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/,
      );
      const validate = ajv.compile(schema);
      return { ajv, validate };
    })();
  }
  const { ajv, validate } = await captureSchemaValidator;
  if (!validate(capture)) {
    fail(`${context} failed capture schema validation:\n${ajv.errorsText(validate.errors, { separator: "\n" })}`);
  }
}

export async function validateU7CapturePair(
  drafts,
  { registration, registrationBinding, inputs, inputsBinding, pack, context = "U7 capture pair" },
) {
  if (!Array.isArray(drafts) || drafts.length !== 2) fail(`${context} must retain both anonymous stems`);
  const roles = drafts.map((entry) => entry.stemRole);
  if (canonicalJson(roles) !== canonicalJson(["source_estimate_1", "source_estimate_2"])) {
    fail(`${context} changed or reordered the anonymous stem roles`);
  }
  const seenIds = new Set();
  let common = null;
  for (const [index, entry] of drafts.entries()) {
    const capture = entry.capture;
    await validateCaptureSchema(capture, `${context} ${entry.stemRole}`);
    if (capture.capture_id !== benchU7CaptureId(capture) || seenIds.has(capture.capture_id)) {
      fail(`${context} capture ${index + 1} identity is not canonical and unique`);
    }
    seenIds.add(capture.capture_id);
    const binding = capture.ablation;
    if (
      binding.registration.ablation_id !== registration.ablation_id ||
      binding.registration.path !== registrationBinding.path ||
      binding.registration.content_id !== registrationBinding.content_id ||
      binding.registration.bytes !== registrationBinding.bytes ||
      binding.inputs.inputs_id !== inputs.inputs_id ||
      binding.inputs.path !== inputsBinding.path ||
      binding.inputs.content_id !== inputsBinding.content_id ||
      binding.inputs.bytes !== inputsBinding.bytes ||
      binding.stem_role !== entry.stemRole ||
      Object.values(binding.semantic).some((value) => value !== null)
    ) {
      fail(`${context} changed registration, input, role, or semantic non-authority`);
    }
    exactIsoUtc(binding.packaged_at, `${context} ${entry.stemRole} packaged_at`);
    if (
      Date.parse(binding.packaged_at) <= Date.parse(inputs.registered_at) ||
      capture.captured_at !== binding.packaged_at.slice(0, 10)
    ) {
      fail(`${context} must be packaged after input registration with one consistent date`);
    }
    const subject = capture.systems.find((system) => system.role === "subject");
    const control = capture.systems.find((system) => system.role === "internal_control");
    const registeredInput = inputs.clips.find((candidate) => candidate.clip_id === capture.clip.id);
    const packClip = pack.clips.find((candidate) => candidate.clip_id === capture.clip.id);
    if (
      capture.systems.length !== 2 ||
      !subject ||
      !control ||
      !registeredInput ||
      !packClip ||
      pack.pack_id !== inputs.pack_id ||
      canonicalJson(capture.clip) !== canonicalJson(u7CaptureClip(packClip)) ||
      binding.runtime.source_content_id !== registeredInput.source.content_id ||
      benchConfigId(subject.config) !== registration.subject.variant.config_id ||
      benchConfigId(control.config) !== registration.subject.baseline.config_id ||
      subject.id !== `${registration.subject.system_id}:${entry.stemRole}` ||
      control.id !== `${registration.subject.system_id}:raw`
    ) {
      fail(`${context} does not preserve the exact registered input, raw config, and stem config`);
    }
    const systemIds = [subject.id, control.id].sort((left, right) => left.localeCompare(right));
    if (
      canonicalJson(Object.keys(capture.measured).sort((left, right) => left.localeCompare(right))) !== canonicalJson(systemIds) ||
      capture.units.some(
        (unit) =>
          !unit.outputs ||
          canonicalJson(Object.keys(unit.outputs).sort((left, right) => left.localeCompare(right))) !== canonicalJson(systemIds),
      ) ||
      systemIds.some((systemId) => canonicalJson(capture.measured[systemId]) !== canonicalJson(measuredFor(capture.units, systemId)))
    ) {
      fail(`${context} does not exactly account for both registered systems`);
    }
    const key = canonicalJson({
      clip: capture.clip,
      repetition: binding.repetition,
      packagedAt: binding.packaged_at,
      runtime: binding.runtime,
    });
    if (common !== null && common !== key) fail(`${context} captures do not form one paired operation`);
    common = key;
  }
  return drafts;
}

function u7CaptureClip(packClip) {
  return {
    id: packClip.clip_id,
    duration_s: packClip.source.duration,
    lang: "ko",
    pair: "ko->en",
    source: {
      kind: packClip.source.kind,
      url: packClip.source.url,
      channel: packClip.source.channel,
      licence: packClip.source.licence,
      window: packClip.source.window,
      attribution: packClip.source.attribution,
    },
  };
}

export function materializeU7CaptureDrafts({
  registration,
  registrationBinding,
  inputs,
  inputsBinding,
  pack,
  clipId,
  repetition,
  capturedAt,
  audit,
}) {
  if (!Number.isInteger(repetition) || repetition < 1) {
    fail("repetition must be a positive integer");
  }
  if (registration.ablation_id !== benchAblationId(registration)) fail("registration identity drifted");
  if (
    registration.subject.baseline.config_id !== benchConfigId(registration.subject.baseline.config) ||
    registration.subject.variant.config_id !== benchConfigId(registration.subject.variant.config)
  ) {
    fail("registered config identity drifted");
  }
  if (
    inputs.ablation.ablation_id !== registration.ablation_id ||
    !inputs.clips.some((entry) => entry.clip_id === clipId) ||
    !pack.clips.some((entry) => entry.clip_id === clipId)
  ) {
    fail("clip is not registered for this frozen ablation");
  }
  const expectedSource = inputs.clips.find((entry) => entry.clip_id === clipId).source;
  if (
    audit.sourceArtifact.content.contentId !== expectedSource.content_id ||
    audit.sourceArtifact.content.bytes !== expectedSource.bytes ||
    audit.comparison.inputs.raw.artifactId !== audit.sourceArtifact.id ||
    audit.comparison.inputs.raw.contentId !== audit.sourceArtifact.content.contentId ||
    audit.comparison.operationId !== audit.receipt.operationId ||
    audit.comparisonReceipt.comparison.artifactId !== audit.comparisonArtifact.id ||
    audit.comparisonReceipt.inputArtifactIds[0] !== audit.sourceArtifact.id
  ) {
    fail("cold-audited U7 source or comparison lineage does not match the registered clip input");
  }
  const stemRoles = audit.comparison.inputs.stems.map((stem) => stem.role);
  if (canonicalJson(stemRoles) !== canonicalJson(["source_estimate_1", "source_estimate_2"])) {
    fail("cold-audited U7 comparison does not retain both ordered anonymous stems");
  }
  if (
    audit.comparison.deterministicGate.semanticPreference !== null ||
    audit.comparison.deterministicGate.semanticAuthority !== "not_granted" ||
    audit.comparison.deterministicGate.captionAuthority !== "not_granted"
  ) {
    fail("U7 comparison carries semantic or caption authority");
  }
  const packClip = pack.clips.find((entry) => entry.clip_id === clipId);
  const capturedDate = exactIsoUtc(capturedAt, "capture time").slice(0, 10);
  const subjectBase = registration.subject.system_id;
  const rawSystemId = `${subjectBase}:raw`;

  return audit.comparison.inputs.stems.map((stem, index) => {
    const stemArtifact = audit.stemArtifacts[index];
    const receiptOutput = audit.receipt.outputs[index];
    if (
      stem.artifactId !== stemArtifact.id ||
      stem.contentId !== stemArtifact.content.contentId ||
      receiptOutput.role !== stem.role ||
      receiptOutput.artifactId !== stem.artifactId
    ) {
      fail(`cold-audited U7 stem ${index + 1} lineage drifted`);
    }
    const stemSystemId = `${subjectBase}:${stem.role}`;
    const range = audit.comparison.source.range;
    const units = u7CaptureUnits(
      audit.comparison.inputs.raw.result,
      stem.result,
      range,
      rawSystemId,
      stemSystemId,
    );
    const binding = {
      schema: BENCH_U7_CAPTURE_BINDING_SCHEMA,
      registration: {
        path: registrationBinding.path,
        content_id: registrationBinding.content_id,
        bytes: registrationBinding.bytes,
        ablation_id: registration.ablation_id,
      },
      inputs: {
        path: inputsBinding.path,
        content_id: inputsBinding.content_id,
        bytes: inputsBinding.bytes,
        inputs_id: inputs.inputs_id,
      },
      packaged_at: capturedAt,
      repetition,
      stem_role: stem.role,
      runtime: {
        run_id: audit.comparison.runId,
        operation_id: audit.receipt.operationId,
        source_artifact_id: audit.sourceArtifact.id,
        source_content_id: audit.sourceArtifact.content.contentId,
        separation_receipt_id: audit.receipt.receiptId,
        separation_receipt_artifact_id: audit.receiptArtifact.id,
        separation_receipt_content_id: audit.receiptArtifact.content.contentId,
        comparison_artifact_id: audit.comparisonArtifact.id,
        comparison_content_id: audit.comparisonArtifact.content.contentId,
        comparison_receipt_id: audit.comparisonReceipt.receiptId,
        comparison_receipt_artifact_id: audit.comparisonReceiptArtifact.id,
        comparison_receipt_content_id: audit.comparisonReceiptArtifact.content.contentId,
      },
      semantic: { labels: null, score: null, judge: null, preference: null },
    };
    const body = {
      schema_version: "0.1.0",
      kind: "capture",
      captured_at: capturedDate,
      scored: false,
      pack_evidence: false,
      clip: u7CaptureClip(packClip),
      reproducible: {
        deterministic: false,
        note: "One registered paired repetition over one cold-audited U7 operation. Both anonymous stems are packaged separately; this capture was not selected by outcome.",
      },
      systems: [
        { id: stemSystemId, role: "subject", config: registration.subject.variant.config },
        { id: rawSystemId, role: "internal_control", config: registration.subject.baseline.config },
      ],
      measured: {
        [stemSystemId]: measuredFor(units, stemSystemId),
        [rawSystemId]: measuredFor(units, rawSystemId),
      },
      unscored: {
        critical_meaning: null,
        critical_outcomes: null,
        catastrophic: null,
        reason: "This U7 capture contains structural recognizer output only. Correctness requires exact-byte-bound blinded human labels; comparison agreement and availability are not semantic quality.",
      },
      units,
      ablation: binding,
      notes: "Raw and one fixed anonymous estimate from the same cold-audited U7 comparison. Missing and withheld are mechanical; no model or structural signal judges correctness.",
    };
    const capture = { capture_id: benchU7CaptureId(body), ...body };
    return { stemRole: stem.role, capture };
  });
}
