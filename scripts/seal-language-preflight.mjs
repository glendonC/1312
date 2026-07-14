/**
 * Seal deterministic language evidence beside an existing immutable v2 preflight index.
 *
 *   node scripts/seal-language-preflight.mjs --run local-001 [--directory .studio/runs/local-001]
 *   node scripts/seal-language-preflight.mjs --run local-001 --check
 *
 * The producer never edits preflight.json or preflight-v2.json. It validates the complete source,
 * speech, model, runtime, and language evidence unit and writes a new immutable preflight-v3.json.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { assertLanguageRangesReceipt } from "../src/studio/preflight/languageReceiptValidation.ts";
import { assertPreflightBundle } from "../src/studio/preflight/preflightBundleValidation.ts";
import { assertSpeechActivityReceipt } from "../src/studio/preflight/speechReceiptValidation.ts";
import { fingerprintFile } from "./lib/content-id.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE_PATH = "source.json";
const PROBE_PATH = "media-probe.json";
const V2_PATH = "preflight-v2.json";
const SPEECH_PATH = "speech-activity.json";
const LANGUAGE_PATH = "language-ranges.json";
const OUTPUT_PATH = "preflight-v3.json";

function fail(message) {
  console.error(`language preflight seal: ${message}`);
  process.exitCode = 1;
}

function parseArguments(argv) {
  const values = new Map();
  let check = false;
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--check") {
      if (check) throw new Error("--check was provided more than once");
      check = true;
      continue;
    }
    if (token !== "--run" && token !== "--directory") throw new Error(`unknown option ${token}`);
    const name = token.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${token} requires a value`);
    if (values.has(name)) throw new Error(`${token} was provided more than once`);
    values.set(name, value);
    index += 1;
  }
  return { values, check };
}

function readJson(path, label) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`${label} could not be read as JSON`, { cause: error });
  }
}

function indexedContent(fingerprint) {
  return {
    id: fingerprint.contentId,
    hash: { algorithm: "sha256", digest: fingerprint.digest },
    bytes: fingerprint.bytes,
  };
}

function inside(root, path, label) {
  if (typeof path !== "string" || !path || isAbsolute(path) || path.split(/[\\/]/).includes("..")) {
    throw new Error(`${label} must stay inside its registered root`);
  }
  return join(root, path);
}

function sameContent(fingerprint, expected, label) {
  if (
    !expected ||
    expected.id !== fingerprint.contentId ||
    expected.hash?.algorithm !== "sha256" ||
    expected.hash?.digest !== fingerprint.digest ||
    expected.bytes !== fingerprint.bytes
  ) {
    throw new Error(`${label} does not match its indexed bytes`);
  }
}

async function validateFile(root, receipt, label) {
  const fingerprint = await fingerprintFile(inside(root, receipt.path, `${label}.path`));
  sameContent(fingerprint, receipt.content, label);
  return fingerprint;
}

function sourceBinding(source, probe, v2) {
  const probeArtifact = v2.artifacts?.find((artifact) => artifact.artifact_id === "container-probe");
  if (!probeArtifact) throw new Error("preflight-v2.json is missing container-probe");
  return {
    receiptId: source.receipt_id,
    receiptProducer: source.producer,
    receiptPath: SOURCE_PATH,
    raw: {
      path: source.raw_media?.path,
      contentId: source.raw_media?.content_id,
      bytes: source.raw_media?.bytes,
      producer: source.producer,
    },
    mediaProbe: {
      path: PROBE_PATH,
      contentId: probeArtifact.content?.id,
      producer: probe.producer,
    },
  };
}

async function buildBundle(directory, runId) {
  const source = readJson(join(directory, SOURCE_PATH), SOURCE_PATH);
  const probe = readJson(join(directory, PROBE_PATH), PROBE_PATH);
  const v2 = readJson(join(directory, V2_PATH), V2_PATH);
  const speech = readJson(join(directory, SPEECH_PATH), SPEECH_PATH);
  const language = readJson(join(directory, LANGUAGE_PATH), LANGUAGE_PATH);
  const binding = sourceBinding(source, probe, v2);

  assertSpeechActivityReceipt(speech, binding, probe, "Language seal speech receipt");
  assertLanguageRangesReceipt(language, binding, probe, speech, "Language seal language receipt");
  assertPreflightBundle(v2, binding, "Language seal v2 preflight", speech);
  if (speech.run !== runId || language.run !== runId || probe.run !== runId) {
    throw new Error("source evidence run does not match --run");
  }

  for (const artifact of v2.artifacts) {
    const fingerprint = await fingerprintFile(inside(directory, artifact.path, `v2 artifact ${artifact.artifact_id}`));
    sameContent(fingerprint, artifact.content, `v2 artifact ${artifact.artifact_id}`);
  }
  for (const file of language.producer.model.files) {
    await validateFile(ROOT, file, `language model file ${file.role}`);
  }
  for (const key of ["manifest", "entry", "license"]) {
    await validateFile(ROOT, language.producer.runtime.package[key], `language runtime package ${key}`);
  }
  await validateFile(ROOT, language.producer.runtime.engine.binary, "language runtime engine binary");

  const languageFingerprint = await fingerprintFile(join(directory, LANGUAGE_PATH));
  sameContent(
    await fingerprintFile(join(directory, SPEECH_PATH)),
    language.input.speech_activity.content,
    "language speech-activity input",
  );
  sameContent(
    await fingerprintFile(join(directory, language.input.normalized_audio.path)),
    language.input.normalized_audio.content,
    "language normalized-audio input",
  );

  const raw = v2.artifacts.find((artifact) => artifact.artifact_id === "raw-media");
  const speechArtifact = v2.artifacts.find((artifact) => artifact.artifact_id === "speech-activity");
  const normalized = v2.artifacts.find((artifact) => artifact.artifact_id === "speech-detector-audio");
  if (!raw || !speechArtifact || !normalized) throw new Error("preflight-v2.json is missing registered speech artifacts");
  const modelLineage = language.producer.model.files.slice(0, 5).map((file) => file.content.id);
  if (modelLineage.length !== 5) throw new Error("language receipt is missing executable model lineage");

  return {
    schema: "studio.preflight-bundle.v3",
    producer: "scripts/seal-language-preflight.mjs",
    preflight_id: `preflight:${raw.content.id}:speech-v1:language-v1`,
    source: structuredClone(v2.source),
    artifacts: [
      ...structuredClone(v2.artifacts),
      {
        artifact_id: "language-ranges",
        kind: "language_ranges_receipt",
        class: "receipt",
        path: LANGUAGE_PATH,
        content: indexedContent(languageFingerprint),
        producer: "scripts/detect-language.mjs",
        source_content_ids: [
          raw.content.id,
          speechArtifact.content.id,
          normalized.content.id,
          ...modelLineage,
        ],
      },
    ],
    findings: {
      container_tracks: v2.findings.container_tracks,
      speech_activity: v2.findings.speech_activity,
      language_ranges: "language-ranges",
      acoustic_ranges: null,
      speaker_overlap: null,
      complexity: null,
    },
    note:
      "Immutable speech- and language-backed preflight index. Language decisions cover receipted speech windows only; scores are not calibrated confidence, and acoustic, speaker, overlap, and complexity findings remain unavailable.",
  };
}

async function main() {
  const { values, check } = parseArguments(process.argv.slice(2));
  const runId = values.get("run");
  if (!runId || !/^[a-z0-9-]+$/i.test(runId)) throw new Error("provide --run <preflight-id>");
  const directory = values.has("directory")
    ? resolve(values.get("directory"))
    : join(ROOT, ".studio", "runs", runId);
  const outputPath = join(directory, OUTPUT_PATH);
  if (existsSync(outputPath) && !check) {
    throw new Error(`${outputPath} already exists; refusing to replace the immutable v3 index`);
  }
  const bundle = await buildBundle(directory, runId);
  const serialized = `${JSON.stringify(bundle, null, 2)}\n`;
  if (check) {
    if (!existsSync(outputPath)) throw new Error(`${OUTPUT_PATH} is unavailable for --check`);
    if (readFileSync(outputPath, "utf8") !== serialized) {
      throw new Error(`${OUTPUT_PATH} does not match a fresh deterministic seal`);
    }
    console.log(`language preflight verified ${relative(ROOT, outputPath) || outputPath}`);
    return;
  }
  writeFileSync(outputPath, serialized, { flag: "wx" });
  console.log(`language preflight wrote ${relative(ROOT, outputPath) || outputPath}`);
}

try {
  await main();
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
