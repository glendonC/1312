/**
 * Seal deterministic speech evidence beside an existing immutable v1 preflight index.
 *
 *   node scripts/seal-speech-preflight.mjs --run local-001 [--directory .studio/runs/local-001]
 *   node scripts/seal-speech-preflight.mjs --run local-001 --check
 *
 * This producer never edits preflight.json. It re-hashes every v1 artifact, the normalized PCM,
 * the VAD receipt, model, runtime, and ffmpeg binary before writing immutable preflight-v2.json.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { fingerprintFile } from "./lib/content-id.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const V1_PATH = "preflight.json";
const SPEECH_PATH = "speech-activity.json";
const PCM_PATH = "speech-input.pcm";
const OUTPUT_PATH = "preflight-v2.json";
const DETECTOR_ID = "scripts/detect-speech.mjs";
const MODEL_REVISION = "7e30209a3e901f9842f81b225f3e93d8199902b1";
const MODEL_PATH = "vendor/silero-vad/v6.2.1/silero_vad_16k_op15.onnx";
const MODEL_DIGEST = "7ed98ddbad84ccac4cd0aeb3099049280713df825c610a8ed34543318f1b2c49";
const LICENSE_PATH = "vendor/silero-vad/v6.2.1/LICENSE";
const RUNTIME_VERSION = "1.27.0";

function fail(message) {
  console.error(`speech preflight seal: ${message}`);
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

function exactKeys(value, expected, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new Error(`${label} must contain exactly ${wanted.join(", ")}`);
  }
  return value;
}

function exact(value, expected, label) {
  if (value !== expected) throw new Error(`${label} must equal ${expected}`);
}

function text(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be a non-empty string`);
  return value;
}

function integer(value, label, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum) throw new Error(`${label} must be an integer at least ${minimum}`);
  return value;
}

function finite(value, label, minimum = 0, maximum = Number.POSITIVE_INFINITY) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`${label} must be finite from ${minimum} through ${maximum}`);
  }
  return value;
}

function relativePath(value, label, extension = null) {
  const path = text(value, label);
  if (isAbsolute(path) || path.split(/[\\/]/).includes("..")) throw new Error(`${label} must stay inside its registered root`);
  if (extension && !path.endsWith(extension)) throw new Error(`${label} must end in ${extension}`);
  return path;
}

function content(value, label) {
  exactKeys(value, ["id", "hash", "bytes"], label);
  exactKeys(value.hash, ["algorithm", "digest"], `${label}.hash`);
  exact(value.hash.algorithm, "sha256", `${label}.hash.algorithm`);
  if (!/^[a-f0-9]{64}$/.test(value.hash.digest)) throw new Error(`${label}.hash.digest must be lowercase SHA-256`);
  exact(value.id, `sha256:${value.hash.digest}`, `${label}.id`);
  integer(value.bytes, `${label}.bytes`, 1);
  return value;
}

function sameContent(actual, expected, label) {
  if (actual.contentId !== expected.id || actual.bytes !== expected.bytes) {
    throw new Error(`${label} does not match its indexed bytes`);
  }
}

function artifact(value, label) {
  exactKeys(value, ["artifact_id", "kind", "class", "path", "content", "producer", "source_content_ids"], label);
  text(value.artifact_id, `${label}.artifact_id`);
  text(value.kind, `${label}.kind`);
  text(value.class, `${label}.class`);
  relativePath(value.path, `${label}.path`);
  content(value.content, `${label}.content`);
  text(value.producer, `${label}.producer`);
  if (!Array.isArray(value.source_content_ids)) throw new Error(`${label}.source_content_ids must be an array`);
  for (const [index, id] of value.source_content_ids.entries()) {
    if (!/^sha256:[a-f0-9]{64}$/.test(id)) throw new Error(`${label}.source_content_ids[${index}] is invalid`);
  }
  if (new Set(value.source_content_ids).size !== value.source_content_ids.length) {
    throw new Error(`${label}.source_content_ids must be unique`);
  }
  return value;
}

async function validateV1(value, directory) {
  exactKeys(value, ["schema", "producer", "preflight_id", "source", "artifacts", "findings", "note"], "preflightV1");
  exact(value.schema, "studio.preflight-bundle.v1", "preflightV1.schema");
  exact(value.producer, "scripts/preflight-owned-media.mjs", "preflightV1.producer");
  text(value.note, "preflightV1.note");
  exactKeys(value.source, ["receipt_id", "receipt_artifact_id", "raw_artifact_id"], "preflightV1.source");
  text(value.source.receipt_id, "preflightV1.source.receipt_id");
  exactKeys(
    value.findings,
    ["container_tracks", "speech_activity", "language_ranges", "acoustic_ranges", "speaker_overlap", "complexity"],
    "preflightV1.findings",
  );
  for (const key of ["speech_activity", "language_ranges", "acoustic_ranges", "speaker_overlap", "complexity"]) {
    if (value.findings[key] !== null) throw new Error(`preflightV1.findings.${key} must remain null`);
  }
  if (!Array.isArray(value.artifacts) || value.artifacts.length !== 3) {
    throw new Error("preflightV1.artifacts must contain the immutable three-artifact index");
  }
  const artifacts = value.artifacts.map((entry, index) => artifact(entry, `preflightV1.artifacts[${index}]`));
  if (new Set(artifacts.map((entry) => entry.artifact_id)).size !== artifacts.length) {
    throw new Error("preflightV1.artifacts contains duplicate ids");
  }
  const byId = new Map(artifacts.map((entry) => [entry.artifact_id, entry]));
  const raw = byId.get(value.source.raw_artifact_id);
  const source = byId.get(value.source.receipt_artifact_id);
  const probe = byId.get(value.findings.container_tracks);
  if (!raw || raw.kind !== "raw_media" || raw.class !== "raw") throw new Error("preflightV1 source raw artifact is invalid");
  if (!source || source.kind !== "source_receipt" || source.class !== "receipt") {
    throw new Error("preflightV1 source receipt artifact is invalid");
  }
  if (!probe || probe.kind !== "media_probe_receipt" || probe.class !== "receipt") {
    throw new Error("preflightV1 media probe artifact is invalid");
  }
  exact(value.preflight_id, `preflight:${raw.content.id}`, "preflightV1.preflight_id");
  if (raw.source_content_ids.length !== 0) throw new Error("preflightV1 raw artifact must have no derived sources");
  for (const candidate of [source, probe]) {
    if (candidate.source_content_ids.length !== 1 || candidate.source_content_ids[0] !== raw.content.id) {
      throw new Error(`preflightV1 artifact ${candidate.artifact_id} must derive directly from the raw content`);
    }
  }
  for (const candidate of artifacts) {
    const fingerprint = await fingerprintFile(join(directory, candidate.path));
    sameContent(fingerprint, candidate.content, `preflightV1 artifact ${candidate.artifact_id}`);
  }
  return { artifacts, raw };
}

function window(value, label, sampleCount) {
  exactKeys(value, ["start_sample", "end_sample"], label);
  const start = integer(value.start_sample, `${label}.start_sample`);
  const end = integer(value.end_sample, `${label}.end_sample`, 1);
  if (start >= end || end > sampleCount) throw new Error(`${label} must be a non-empty in-bounds sample range`);
  return value;
}

function deriveWindows(frames, configuration, sampleCount) {
  const minSpeechSamples = configuration.min_speech_duration_ms * 16;
  const minSilenceSamples = configuration.min_silence_duration_ms * 16;
  const speechPadSamples = configuration.speech_pad_ms * 16;
  let triggered = false;
  let tempEnd = 0;
  let currentStart = 0;
  const unpadded = [];
  for (const frame of frames) {
    const currentSample = frame.start_sample;
    if (frame.probability >= configuration.threshold && tempEnd) tempEnd = 0;
    if (frame.probability >= configuration.threshold && !triggered) {
      triggered = true;
      currentStart = currentSample;
      continue;
    }
    if (frame.probability < configuration.negative_threshold && triggered) {
      if (!tempEnd) tempEnd = currentSample;
      if (currentSample - tempEnd < minSilenceSamples) continue;
      if (tempEnd - currentStart > minSpeechSamples) unpadded.push({ start_sample: currentStart, end_sample: tempEnd });
      triggered = false;
      tempEnd = 0;
    }
  }
  if (triggered && sampleCount - currentStart > minSpeechSamples) {
    unpadded.push({ start_sample: currentStart, end_sample: sampleCount });
  }
  const speech = unpadded.map((entry) => ({ ...entry }));
  for (let index = 0; index < speech.length; index += 1) {
    if (index === 0) speech[index].start_sample = Math.max(0, speech[index].start_sample - speechPadSamples);
    if (index !== speech.length - 1) {
      const silence = speech[index + 1].start_sample - speech[index].end_sample;
      if (silence < 2 * speechPadSamples) {
        speech[index].end_sample += Math.floor(silence / 2);
        speech[index + 1].start_sample = Math.max(0, speech[index + 1].start_sample - Math.floor(silence / 2));
      } else {
        speech[index].end_sample = Math.min(sampleCount, speech[index].end_sample + speechPadSamples);
        speech[index + 1].start_sample = Math.max(0, speech[index + 1].start_sample - speechPadSamples);
      }
    } else {
      speech[index].end_sample = Math.min(sampleCount, speech[index].end_sample + speechPadSamples);
    }
  }
  const nonSpeech = [];
  let cursor = 0;
  for (const entry of speech) {
    if (cursor < entry.start_sample) nonSpeech.push({ start_sample: cursor, end_sample: entry.start_sample });
    cursor = entry.end_sample;
  }
  if (cursor < sampleCount) nonSpeech.push({ start_sample: cursor, end_sample: sampleCount });
  return { speech, nonSpeech };
}

async function validateSpeech(value, directory, runId, raw) {
  exactKeys(
    value,
    ["schema", "producer", "run", "input", "normalization", "configuration", "frames", "speech_windows", "non_speech_windows", "note"],
    "speech",
  );
  exact(value.schema, "studio.speech-activity.v1", "speech.schema");
  exact(value.run, runId, "speech.run");
  text(value.note, "speech.note");
  exactKeys(value.producer, ["id", "version", "implementation", "model", "runtime"], "speech.producer");
  exact(value.producer.id, "silero-vad", "speech.producer.id");
  exact(value.producer.version, "6.2.1", "speech.producer.version");
  exact(value.producer.implementation, DETECTOR_ID, "speech.producer.implementation");
  exactKeys(value.producer.model, ["revision", "path", "license", "license_path", "content"], "speech.producer.model");
  exact(value.producer.model.revision, MODEL_REVISION, "speech.producer.model.revision");
  exact(value.producer.model.path, MODEL_PATH, "speech.producer.model.path");
  exact(value.producer.model.license, "MIT", "speech.producer.model.license");
  exact(value.producer.model.license_path, LICENSE_PATH, "speech.producer.model.license_path");
  content(value.producer.model.content, "speech.producer.model.content");
  exact(value.producer.model.content.hash.digest, MODEL_DIGEST, "speech.producer.model.content.hash.digest");
  const modelFingerprint = await fingerprintFile(join(ROOT, relativePath(value.producer.model.path, "speech.producer.model.path", ".onnx")));
  sameContent(modelFingerprint, value.producer.model.content, "speech model");
  await fingerprintFile(join(ROOT, relativePath(value.producer.model.license_path, "speech.producer.model.license_path")));

  const runtime = value.producer.runtime;
  exactKeys(
    runtime,
    ["id", "version", "execution_provider", "execution_mode", "intra_op_threads", "inter_op_threads", "binary", "platform"],
    "speech.producer.runtime",
  );
  exact(runtime.id, "onnxruntime-node", "speech.producer.runtime.id");
  exact(runtime.version, RUNTIME_VERSION, "speech.producer.runtime.version");
  exact(runtime.execution_provider, "cpu", "speech.producer.runtime.execution_provider");
  exact(runtime.execution_mode, "sequential", "speech.producer.runtime.execution_mode");
  exact(runtime.intra_op_threads, 1, "speech.producer.runtime.intra_op_threads");
  exact(runtime.inter_op_threads, 1, "speech.producer.runtime.inter_op_threads");
  exactKeys(runtime.binary, ["path", "content"], "speech.producer.runtime.binary");
  const runtimePath = relativePath(runtime.binary.path, "speech.producer.runtime.binary.path", ".node");
  content(runtime.binary.content, "speech.producer.runtime.binary.content");
  sameContent(
    await fingerprintFile(join(ROOT, runtimePath)),
    runtime.binary.content,
    "speech runtime binary",
  );
  exactKeys(runtime.platform, ["os", "arch", "node"], "speech.producer.runtime.platform");
  for (const key of ["os", "arch", "node"]) text(runtime.platform[key], `speech.producer.runtime.platform.${key}`);

  exactKeys(value.input, ["media", "content_id", "bytes", "track_index"], "speech.input");
  exact(value.input.media, raw.path, "speech.input.media");
  exact(value.input.content_id, raw.content.id, "speech.input.content_id");
  exact(value.input.bytes, raw.content.bytes, "speech.input.bytes");
  integer(value.input.track_index, "speech.input.track_index");

  exactKeys(
    value.normalization,
    ["producer", "arguments", "sample_rate_hz", "channels", "sample_format", "sample_count", "artifact"],
    "speech.normalization",
  );
  exactKeys(value.normalization.producer, ["id", "version", "binary"], "speech.normalization.producer");
  exact(value.normalization.producer.id, "ffmpeg", "speech.normalization.producer.id");
  text(value.normalization.producer.version, "speech.normalization.producer.version");
  exactKeys(value.normalization.producer.binary, ["path", "content"], "speech.normalization.producer.binary");
  const ffmpegPath = text(value.normalization.producer.binary.path, "speech.normalization.producer.binary.path");
  if (!isAbsolute(ffmpegPath)) throw new Error("speech.normalization.producer.binary.path must identify the executed binary");
  content(value.normalization.producer.binary.content, "speech.normalization.producer.binary.content");
  sameContent(
    await fingerprintFile(ffmpegPath),
    value.normalization.producer.binary.content,
    "speech normalization binary",
  );
  const expectedArguments = [
    "-nostdin", "-hide_banner", "-loglevel", "error", "-threads", "1", "-i", "<input>",
    "-map", `0:${value.input.track_index}`, "-vn", "-ac", "1", "-ar", "16000", "-sample_fmt", "s16",
    "-c:a", "pcm_s16le", "-f", "s16le", "<output>",
  ];
  if (!Array.isArray(value.normalization.arguments) || JSON.stringify(value.normalization.arguments) !== JSON.stringify(expectedArguments)) {
    throw new Error("speech.normalization.arguments do not match the fixed audio normalization");
  }
  exact(value.normalization.sample_rate_hz, 16_000, "speech.normalization.sample_rate_hz");
  exact(value.normalization.channels, 1, "speech.normalization.channels");
  exact(value.normalization.sample_format, "s16le", "speech.normalization.sample_format");
  const sampleCount = integer(value.normalization.sample_count, "speech.normalization.sample_count", 1);
  exactKeys(value.normalization.artifact, ["path", "content"], "speech.normalization.artifact");
  exact(value.normalization.artifact.path, PCM_PATH, "speech.normalization.artifact.path");
  content(value.normalization.artifact.content, "speech.normalization.artifact.content");
  const pcmFingerprint = await fingerprintFile(join(directory, PCM_PATH));
  sameContent(pcmFingerprint, value.normalization.artifact.content, "speech normalized PCM");
  exact(value.normalization.artifact.content.bytes, sampleCount * 2, "speech.normalization.artifact.content.bytes");

  exactKeys(
    value.configuration,
    ["frame_samples", "threshold", "negative_threshold", "min_speech_duration_ms", "min_silence_duration_ms", "speech_pad_ms"],
    "speech.configuration",
  );
  const configuration = value.configuration;
  exact(configuration.frame_samples, 512, "speech.configuration.frame_samples");
  exact(configuration.threshold, 0.5, "speech.configuration.threshold");
  exact(configuration.negative_threshold, 0.35, "speech.configuration.negative_threshold");
  exact(configuration.min_speech_duration_ms, 250, "speech.configuration.min_speech_duration_ms");
  exact(configuration.min_silence_duration_ms, 100, "speech.configuration.min_silence_duration_ms");
  exact(configuration.speech_pad_ms, 30, "speech.configuration.speech_pad_ms");

  if (!Array.isArray(value.frames) || value.frames.length !== Math.ceil(sampleCount / configuration.frame_samples)) {
    throw new Error("speech.frames must cover every normalized sample exactly once");
  }
  for (const [index, frame] of value.frames.entries()) {
    exactKeys(frame, ["start_sample", "end_sample", "probability"], `speech.frames[${index}]`);
    exact(frame.start_sample, index * configuration.frame_samples, `speech.frames[${index}].start_sample`);
    exact(
      frame.end_sample,
      Math.min(sampleCount, frame.start_sample + configuration.frame_samples),
      `speech.frames[${index}].end_sample`,
    );
    finite(frame.probability, `speech.frames[${index}].probability`, 0, 1);
  }
  if (!Array.isArray(value.speech_windows) || !Array.isArray(value.non_speech_windows)) {
    throw new Error("speech windows must be arrays");
  }
  value.speech_windows.forEach((entry, index) => window(entry, `speech.speech_windows[${index}]`, sampleCount));
  value.non_speech_windows.forEach((entry, index) => window(entry, `speech.non_speech_windows[${index}]`, sampleCount));
  const derived = deriveWindows(value.frames, configuration, sampleCount);
  if (JSON.stringify(value.speech_windows) !== JSON.stringify(derived.speech)) {
    throw new Error("speech.speech_windows do not derive from the receipted frame probabilities");
  }
  if (JSON.stringify(value.non_speech_windows) !== JSON.stringify(derived.nonSpeech)) {
    throw new Error("speech.non_speech_windows are not the exact complement of speech windows");
  }
  return value;
}

function indexedContent(fingerprint) {
  return {
    id: fingerprint.contentId,
    hash: { algorithm: "sha256", digest: fingerprint.digest },
    bytes: fingerprint.bytes,
  };
}

async function buildBundle(directory, runId) {
  const v1Path = join(directory, V1_PATH);
  const speechPath = join(directory, SPEECH_PATH);
  const v1Value = readJson(v1Path, V1_PATH);
  const { artifacts, raw } = await validateV1(v1Value, directory);
  const speechValue = readJson(speechPath, SPEECH_PATH);
  const speech = await validateSpeech(speechValue, directory, runId, raw);
  const speechFingerprint = await fingerprintFile(speechPath);
  const normalized = speech.normalization.artifact.content;
  const model = speech.producer.model.content;
  return {
    schema: "studio.preflight-bundle.v2",
    producer: "scripts/seal-speech-preflight.mjs",
    preflight_id: `preflight:${raw.content.id}:speech-v1`,
    source: structuredClone(v1Value.source),
    artifacts: [
      ...structuredClone(artifacts),
      {
        artifact_id: "speech-detector-audio",
        kind: "detector_audio",
        class: "derived",
        path: PCM_PATH,
        content: structuredClone(normalized),
        producer: DETECTOR_ID,
        source_content_ids: [raw.content.id],
      },
      {
        artifact_id: "speech-activity",
        kind: "speech_activity_receipt",
        class: "receipt",
        path: SPEECH_PATH,
        content: indexedContent(speechFingerprint),
        producer: DETECTOR_ID,
        source_content_ids: [raw.content.id, normalized.id, model.id],
      },
    ],
    findings: {
      container_tracks: v1Value.findings.container_tracks,
      speech_activity: "speech-activity",
      language_ranges: null,
      acoustic_ranges: null,
      speaker_overlap: null,
      complexity: null,
    },
    note:
      "Immutable speech-backed preflight index. Speech and non-speech windows are detector receipts; language, acoustic, speaker, overlap, and complexity findings remain unavailable.",
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
    throw new Error(`${outputPath} already exists; refusing to replace the immutable v2 index`);
  }
  const bundle = await buildBundle(directory, runId);
  const serialized = `${JSON.stringify(bundle, null, 2)}\n`;
  if (check) {
    if (!existsSync(outputPath)) throw new Error(`${OUTPUT_PATH} is unavailable for --check`);
    if (readFileSync(outputPath, "utf8") !== serialized) {
      throw new Error(`${OUTPUT_PATH} does not match a fresh deterministic seal`);
    }
    console.log(`speech preflight verified ${relative(ROOT, outputPath) || outputPath}`);
    return;
  }
  writeFileSync(outputPath, serialized, { flag: "wx" });
  console.log(`speech preflight wrote ${relative(ROOT, outputPath) || outputPath}`);
}

try {
  await main();
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
