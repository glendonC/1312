#!/usr/bin/env node
/** Seal U1 acoustic observations and their separate producer receipt as immutable preflight V4. */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { validateAcousticObservations, validateAcousticReceipt } from "../src/studio/acoustic/validation.ts";
import { ACOUSTIC_LIMITS } from "../src/studio/acoustic/contracts.ts";
import { assertPreflightBundle } from "../src/studio/preflight/preflightBundleValidation.ts";
import { fingerprintFile } from "./lib/content-id.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const paths = { source: "source.json", probe: "media-probe.json", v3: "preflight-v3.json", speech: "speech-activity.json", language: "language-ranges.json", observations: "acoustic-observations.json", receipt: "acoustic-triage.json", output: "preflight-v4.json" };

function args(argv) {
  const values = new Map(); let check = false;
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]; if (token === "--check") { check = true; continue; }
    if (token !== "--run" && token !== "--directory") throw new Error(`unknown option ${token}`);
    const value = argv[++index]; if (!value || value.startsWith("--")) throw new Error(`${token} requires a value`); values.set(token.slice(2), value);
  }
  return { values, check };
}
function json(directory, name) { return JSON.parse(readFileSync(join(directory, name), "utf8")); }
function inside(root, candidate, label) {
  if (typeof candidate !== "string" || !candidate || isAbsolute(candidate) || candidate.split(/[\\/]/).includes("..")) throw new Error(`${label} escapes its registered root`);
  return join(root, candidate);
}
function indexed(fingerprint) { return { id: fingerprint.contentId, hash: { algorithm: "sha256", digest: fingerprint.digest }, bytes: fingerprint.bytes }; }
function binding(source, probe, v3) {
  const probeArtifact = v3.artifacts.find((artifact) => artifact.artifact_id === "container-probe");
  return { receiptId: source.receipt_id, receiptProducer: source.producer, receiptPath: paths.source, raw: { path: source.raw_media.path, contentId: source.raw_media.content_id, bytes: source.raw_media.bytes, producer: source.producer }, mediaProbe: { path: paths.probe, contentId: probeArtifact.content.id, producer: probe.producer } };
}
async function same(path, expected, label) {
  const measured = await fingerprintFile(path);
  if (measured.contentId !== expected.id || measured.bytes !== expected.bytes || measured.digest !== expected.hash?.digest) throw new Error(`${label} changed content identity`);
  return measured;
}
async function build(directory, runId) {
  const source = json(directory, paths.source); const probe = json(directory, paths.probe); const v3 = json(directory, paths.v3);
  const speech = json(directory, paths.speech); const language = json(directory, paths.language);
  const observations = validateAcousticObservations(json(directory, paths.observations));
  const receipt = validateAcousticReceipt(json(directory, paths.receipt), observations);
  const sourceBinding = binding(source, probe, v3);
  assertPreflightBundle(v3, sourceBinding, "Acoustic seal V3 input", speech, language);
  if (runId !== receipt.run || runId !== speech.run || runId !== language.run) throw new Error("acoustic evidence run does not match --run");
  for (const artifact of v3.artifacts) await same(inside(directory, artifact.path, artifact.artifact_id), artifact.content, `v3 artifact ${artifact.artifact_id}`);
  const observationsFingerprint = await same(join(directory, paths.observations), receipt.output.content, "acoustic observations");
  const receiptFingerprint = await fingerprintFile(join(directory, paths.receipt));
  if (observationsFingerprint.bytes > ACOUSTIC_LIMITS.maxObservationBytes || receiptFingerprint.bytes > ACOUSTIC_LIMITS.maxReceiptBytes) throw new Error("acoustic artifact byte limit exceeded");
  for (const file of receipt.producer.model.files) await same(inside(ROOT, file.path, "model file"), file.content, `acoustic model ${file.path}`);
  await same(inside(ROOT, receipt.producer.runtime.binary.path, "runtime binary"), receipt.producer.runtime.binary.content, "acoustic runtime binary");
  const raw = v3.artifacts.find((artifact) => artifact.artifact_id === "raw-media");
  const normalized = v3.artifacts.find((artifact) => artifact.artifact_id === "speech-detector-audio");
  const speechArtifact = v3.artifacts.find((artifact) => artifact.artifact_id === "speech-activity");
  if (!raw || !normalized || !speechArtifact) throw new Error("V3 input omits acoustic source lineage");
  const modelLineage = receipt.producer.model.files.map((file) => file.content.id);
  const bundle = {
    schema: "studio.preflight-bundle.v4", producer: "scripts/seal-acoustic-preflight.mjs", preflight_id: `preflight:${raw.content.id}:speech-v1:language-v1:acoustic-v1`, source: structuredClone(v3.source),
    artifacts: [...structuredClone(v3.artifacts),
      { artifact_id: "acoustic-observations", kind: "acoustic_observations", class: "derived", path: paths.observations, content: indexed(observationsFingerprint), producer: "scripts/detect-acoustics.mjs", source_content_ids: [raw.content.id, normalized.content.id, ...modelLineage] },
      { artifact_id: "acoustic-triage", kind: "acoustic_triage_receipt", class: "receipt", path: paths.receipt, content: indexed(receiptFingerprint), producer: "scripts/detect-acoustics.mjs", source_content_ids: [raw.content.id, speechArtifact.content.id, normalized.content.id, observationsFingerprint.contentId, ...modelLineage] }],
    findings: { container_tracks: v3.findings.container_tracks, speech_activity: v3.findings.speech_activity, language_ranges: v3.findings.language_ranges, acoustic_ranges: "acoustic-observations", speaker_overlap: null, complexity: null },
    note: "Immutable U1 acoustic evidence. Labels are conservative classifier hypotheses, not semantic understanding; mixed, weak, and conflicting evidence remains abstained by the dialogue-scope policy.",
  };
  assertPreflightBundle(bundle, sourceBinding, "Acoustic seal V4 output", speech, language, observations, receipt);
  return bundle;
}

try {
  const { values, check } = args(process.argv.slice(2)); const runId = values.get("run");
  if (!runId || !/^[a-z0-9-]+$/i.test(runId)) throw new Error("provide --run <id>");
  const directory = values.has("directory") ? resolve(values.get("directory")) : join(ROOT, ".studio", "runs", runId);
  const output = join(directory, paths.output); if (existsSync(output) && !check) throw new Error("preflight-v4.json already exists; refusing replacement");
  const serialized = `${JSON.stringify(await build(directory, runId), null, 2)}\n`;
  if (check) { if (!existsSync(output) || readFileSync(output, "utf8") !== serialized) throw new Error("preflight-v4.json does not match a fresh deterministic seal"); }
  else writeFileSync(output, serialized, { flag: "wx" });
  console.log(`acoustic preflight ${check ? "verified" : "wrote"} ${relative(ROOT, output)}`);
} catch (error) { console.error(`acoustic preflight seal: ${error instanceof Error ? error.message : String(error)}`); process.exitCode = 1; }
