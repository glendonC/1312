/**
 * Produce immutable, content-bound speech and non-speech windows from owned preflight media.
 *
 *   node scripts/detect-speech.mjs --run local-001 [--directory .studio/runs/local-001]
 *   node scripts/detect-speech.mjs --run local-001 --track 1
 *   node scripts/detect-speech.mjs --run local-001 --check
 *   node scripts/detect-speech.mjs --run local-001 --replace
 *
 * The producer performs no language, music, speaker, identity, or overlap inference. It decodes one
 * explicitly selected audio track to preserved 16 kHz mono signed 16-bit PCM, runs a vendored and
 * hash-pinned Silero VAD model through a pinned CPU runtime, and records every frame probability.
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  accessSync,
  constants,
  existsSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { delimiter, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import ort from "onnxruntime-node";

import { fingerprintFile } from "./lib/content-id.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PRODUCER_ID = "silero-vad";
const PRODUCER_VERSION = "6.2.1";
const PRODUCER_IMPLEMENTATION = "scripts/detect-speech.mjs";
const MODEL_REVISION = "7e30209a3e901f9842f81b225f3e93d8199902b1";
const MODEL_RELATIVE_PATH = "vendor/silero-vad/v6.2.1/silero_vad_16k_op15.onnx";
const MODEL_DIGEST = "7ed98ddbad84ccac4cd0aeb3099049280713df825c610a8ed34543318f1b2c49";
const LICENSE_RELATIVE_PATH = "vendor/silero-vad/v6.2.1/LICENSE";
const RUNTIME_VERSION = "1.27.0";
const NORMALIZED_PATH = "speech-input.pcm";
const RECEIPT_PATH = "speech-activity.json";
const SAMPLE_RATE = 16_000;
const FRAME_SAMPLES = 512;
const CONTEXT_SAMPLES = 64;
const THRESHOLD = 0.5;
const NEGATIVE_THRESHOLD = 0.35;
const MIN_SPEECH_DURATION_MS = 250;
const MIN_SILENCE_DURATION_MS = 100;
const SPEECH_PAD_MS = 30;
const MAX_PCM_BYTES = 512 * 1024 * 1024;

function fail(message) {
  console.error(`speech detector: ${message}`);
  process.exitCode = 1;
}

function parseArguments(argv) {
  const values = new Map();
  const flags = new Set();
  const valueNames = new Set(["run", "directory", "track"]);
  const flagNames = new Set(["replace", "check"]);
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) throw new Error(`unexpected argument ${token}`);
    const name = token.slice(2);
    if (flagNames.has(name)) {
      if (flags.has(name)) throw new Error(`--${name} was provided more than once`);
      flags.add(name);
      continue;
    }
    if (!valueNames.has(name)) throw new Error(`unknown option --${name}`);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`--${name} requires a value`);
    if (values.has(name)) throw new Error(`--${name} was provided more than once`);
    values.set(name, value);
    index += 1;
  }
  if (flags.has("replace") && flags.has("check")) throw new Error("--replace and --check cannot be combined");
  return { values, flags };
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
}

function relativePath(value, label) {
  if (
    typeof value !== "string" ||
    !value ||
    isAbsolute(value) ||
    value.split(/[\\/]/).includes("..")
  ) {
    throw new Error(`${label} must stay inside the preflight directory`);
  }
  return value;
}

function contentFromDigest(digest, bytes) {
  if (!/^[a-f0-9]{64}$/.test(digest) || !Number.isSafeInteger(bytes) || bytes <= 0) {
    throw new Error("content identity requires a non-empty SHA-256 identified file");
  }
  return {
    id: `sha256:${digest}`,
    hash: { algorithm: "sha256", digest },
    bytes,
  };
}

function contentFromBuffer(buffer) {
  return contentFromDigest(createHash("sha256").update(buffer).digest("hex"), buffer.length);
}

function contentFromFingerprint(fingerprint) {
  return contentFromDigest(fingerprint.digest, fingerprint.bytes);
}

function resolveExecutable(command) {
  const candidates = [];
  if (isAbsolute(command) || command.includes("/") || command.includes("\\")) {
    candidates.push(resolve(command));
  } else {
    const extensions = process.platform === "win32"
      ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";")
      : [""];
    for (const directory of (process.env.PATH ?? "").split(delimiter).filter(Boolean)) {
      for (const extension of extensions) candidates.push(join(directory, `${command}${extension}`));
    }
  }
  for (const candidate of candidates) {
    try {
      accessSync(candidate, constants.X_OK);
      return realpathSync(candidate);
    } catch {
      // Continue through the explicit PATH candidates.
    }
  }
  throw new Error(`${command} is not an executable available to the speech detector`);
}

function runtimeBinaryPath() {
  const entry = fileURLToPath(import.meta.resolve("onnxruntime-node"));
  const packageRoot = dirname(dirname(entry));
  const relativeBinary = join("bin", "napi-v6", process.platform, process.arch, "onnxruntime_binding.node");
  const absoluteBinary = join(packageRoot, relativeBinary);
  if (!existsSync(absoluteBinary)) {
    throw new Error(`onnxruntime-node has no pinned binary for ${process.platform}/${process.arch}`);
  }
  return {
    absolute: absoluteBinary,
    receipt: ["node_modules", "onnxruntime-node", ...relativeBinary.split(/[\\/]/)].join("/"),
  };
}

function parseProbe(value, runId) {
  exactKeys(
    value,
    ["schema", "producer", "run", "media", "input", "duration", "container", "container_long_name", "bit_rate", "tracks"],
    "mediaProbe",
  );
  if (value.schema !== "studio.media-probe.v1") throw new Error("mediaProbe.schema is not registered");
  if (value.producer !== "scripts/probe-media.mjs") throw new Error("mediaProbe.producer is not registered");
  if (value.run !== runId) throw new Error("mediaProbe.run does not match --run");
  if (!Number.isFinite(value.duration) || value.duration <= 0) throw new Error("mediaProbe.duration must be positive and finite");
  relativePath(value.media, "mediaProbe.media");
  exactKeys(value.input, ["content_id", "hash", "bytes"], "mediaProbe.input");
  exactKeys(value.input.hash, ["algorithm", "digest"], "mediaProbe.input.hash");
  if (value.input.hash.algorithm !== "sha256" || !/^[a-f0-9]{64}$/.test(value.input.hash.digest)) {
    throw new Error("mediaProbe.input.hash must be a lowercase SHA-256 identity");
  }
  if (value.input.content_id !== `sha256:${value.input.hash.digest}`) {
    throw new Error("mediaProbe.input.content_id does not match its digest");
  }
  if (!Number.isSafeInteger(value.input.bytes) || value.input.bytes <= 0) {
    throw new Error("mediaProbe.input.bytes must be a positive safe integer");
  }
  if (!Array.isArray(value.tracks) || value.tracks.length === 0) throw new Error("mediaProbe.tracks must not be empty");
  const indexes = new Set();
  for (const [position, track] of value.tracks.entries()) {
    if (track === null || typeof track !== "object" || Array.isArray(track)) {
      throw new Error(`mediaProbe.tracks[${position}] must be an object`);
    }
    const allowed = ["index", "type", "codec", ...(track.duration === undefined ? [] : ["duration"])]
      .concat(track.type === "audio" ? ["sample_rate", "channels"] : [])
      .concat(track.type === "video" ? ["width", "height"] : []);
    exactKeys(track, allowed, `mediaProbe.tracks[${position}]`);
    if (!Number.isSafeInteger(track.index) || track.index < 0 || indexes.has(track.index)) {
      throw new Error("mediaProbe.tracks must contain unique non-negative indexes");
    }
    indexes.add(track.index);
    if (typeof track.type !== "string" || !track.type || typeof track.codec !== "string" || !track.codec) {
      throw new Error(`mediaProbe.tracks[${position}] must contain type and codec`);
    }
    if (track.duration !== undefined && (!Number.isFinite(track.duration) || track.duration <= 0)) {
      throw new Error(`mediaProbe.tracks[${position}].duration must be positive and finite when present`);
    }
    if (
      track.type === "audio" &&
      (!Number.isFinite(track.sample_rate) || track.sample_rate <= 0 || !Number.isSafeInteger(track.channels) || track.channels <= 0)
    ) {
      throw new Error(`mediaProbe.tracks[${position}] has invalid audio measurements`);
    }
  }
  return value;
}

function chooseTrack(probe, requested) {
  const audioTracks = probe.tracks.filter((track) => track.type === "audio");
  if (requested !== null) {
    if (!/^(0|[1-9]\d*)$/.test(requested)) throw new Error("--track must be a non-negative integer track index");
    const index = Number(requested);
    const selected = audioTracks.find((track) => track.index === index);
    if (!selected) throw new Error(`--track ${index} does not reference a measured audio track`);
    return selected;
  }
  if (audioTracks.length === 0) throw new Error("media probe contains no audio track");
  if (audioTracks.length > 1) throw new Error("media probe contains multiple audio tracks; provide --track explicitly");
  return audioTracks[0];
}

function roundProbability(value) {
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error("Silero VAD emitted an invalid probability");
  return Number(value.toFixed(8));
}

function deriveWindows(frames, sampleCount) {
  const minSpeechSamples = SAMPLE_RATE * MIN_SPEECH_DURATION_MS / 1000;
  const minSilenceSamples = SAMPLE_RATE * MIN_SILENCE_DURATION_MS / 1000;
  const speechPadSamples = SAMPLE_RATE * SPEECH_PAD_MS / 1000;
  let triggered = false;
  let tempEnd = 0;
  let currentStart = 0;
  const unpadded = [];

  for (const frame of frames) {
    const currentSample = frame.start_sample;
    if (frame.probability >= THRESHOLD && tempEnd) tempEnd = 0;
    if (frame.probability >= THRESHOLD && !triggered) {
      triggered = true;
      currentStart = currentSample;
      continue;
    }
    if (frame.probability < NEGATIVE_THRESHOLD && triggered) {
      if (!tempEnd) tempEnd = currentSample;
      if (currentSample - tempEnd < minSilenceSamples) continue;
      if (tempEnd - currentStart > minSpeechSamples) {
        unpadded.push({ start_sample: currentStart, end_sample: tempEnd });
      }
      triggered = false;
      tempEnd = 0;
    }
  }

  if (triggered && sampleCount - currentStart > minSpeechSamples) {
    unpadded.push({ start_sample: currentStart, end_sample: sampleCount });
  }

  const speech = unpadded.map((window) => ({ ...window }));
  for (let index = 0; index < speech.length; index += 1) {
    const window = speech[index];
    if (index === 0) window.start_sample = Math.max(0, window.start_sample - speechPadSamples);
    if (index !== speech.length - 1) {
      const silence = speech[index + 1].start_sample - window.end_sample;
      if (silence < 2 * speechPadSamples) {
        window.end_sample += Math.floor(silence / 2);
        speech[index + 1].start_sample = Math.max(0, speech[index + 1].start_sample - Math.floor(silence / 2));
      } else {
        window.end_sample = Math.min(sampleCount, window.end_sample + speechPadSamples);
        speech[index + 1].start_sample = Math.max(0, speech[index + 1].start_sample - speechPadSamples);
      }
    } else {
      window.end_sample = Math.min(sampleCount, window.end_sample + speechPadSamples);
    }
  }

  const nonSpeech = [];
  let cursor = 0;
  for (const window of speech) {
    if (cursor < window.start_sample) nonSpeech.push({ start_sample: cursor, end_sample: window.start_sample });
    cursor = window.end_sample;
  }
  if (cursor < sampleCount) nonSpeech.push({ start_sample: cursor, end_sample: sampleCount });
  return { speech, nonSpeech };
}

async function inferFrames(pcm, sampleCount, modelPath) {
  const session = await ort.InferenceSession.create(modelPath, {
    executionProviders: ["cpu"],
    executionMode: "sequential",
    intraOpNumThreads: 1,
    interOpNumThreads: 1,
  });
  const stateValues = new Float32Array(2 * 1 * 128);
  let state = new ort.Tensor("float32", stateValues, [2, 1, 128]);
  let context = new Float32Array(CONTEXT_SAMPLES);
  const sampleRate = new ort.Tensor("int64", BigInt64Array.of(BigInt(SAMPLE_RATE)), []);
  const frames = [];

  for (let start = 0; start < sampleCount; start += FRAME_SAMPLES) {
    const input = new Float32Array(CONTEXT_SAMPLES + FRAME_SAMPLES);
    input.set(context, 0);
    const available = Math.min(FRAME_SAMPLES, sampleCount - start);
    for (let offset = 0; offset < available; offset += 1) {
      input[CONTEXT_SAMPLES + offset] = pcm.readInt16LE((start + offset) * 2) / 32768;
    }
    const result = await session.run({
      input: new ort.Tensor("float32", input, [1, input.length]),
      state,
      sr: sampleRate,
    });
    if (!result.output || !result.stateN || result.output.data.length !== 1) {
      throw new Error("Silero VAD returned an unexpected output contract");
    }
    frames.push({
      start_sample: start,
      end_sample: Math.min(sampleCount, start + FRAME_SAMPLES),
      probability: roundProbability(Number(result.output.data[0])),
    });
    state = result.stateN;
    context = input.slice(input.length - CONTEXT_SAMPLES);
  }
  return frames;
}

async function buildReceipt(runId, directory, requestedTrack) {
  const probePath = join(directory, "media-probe.json");
  let probe;
  try {
    probe = parseProbe(JSON.parse(readFileSync(probePath, "utf8")), runId);
  } catch (error) {
    throw new Error(`${probePath} is not an exact media probe: ${error instanceof Error ? error.message : String(error)}`);
  }
  const track = chooseTrack(probe, requestedTrack);
  const media = relativePath(probe.media, "mediaProbe.media");
  const mediaPath = join(directory, media);
  const mediaFingerprint = await fingerprintFile(mediaPath);
  if (mediaFingerprint.contentId !== probe.input.content_id || mediaFingerprint.bytes !== probe.input.bytes) {
    throw new Error("media probe input identity does not match the source media bytes");
  }

  const modelPath = join(ROOT, MODEL_RELATIVE_PATH);
  const licensePath = join(ROOT, LICENSE_RELATIVE_PATH);
  const [modelFingerprint, licenseFingerprint] = await Promise.all([
    fingerprintFile(modelPath),
    fingerprintFile(licensePath),
  ]);
  if (modelFingerprint.digest !== MODEL_DIGEST) {
    throw new Error(`Silero model hash ${modelFingerprint.digest} does not match the production pin ${MODEL_DIGEST}`);
  }
  if (licenseFingerprint.bytes <= 0) throw new Error("the pinned Silero license is unavailable");
  if (ort.env.versions.node !== RUNTIME_VERSION) {
    throw new Error(`onnxruntime-node ${String(ort.env.versions.node)} does not match the production pin ${RUNTIME_VERSION}`);
  }

  const runtimeBinary = runtimeBinaryPath();
  const ffmpegBinary = resolveExecutable("ffmpeg");
  const [runtimeFingerprint, ffmpegFingerprint] = await Promise.all([
    fingerprintFile(runtimeBinary.absolute),
    fingerprintFile(ffmpegBinary),
  ]);
  const ffmpegFirstLine = execFileSync(ffmpegBinary, ["-version"], { encoding: "utf8" }).split(/\r?\n/, 1)[0];
  const ffmpegVersion = ffmpegFirstLine.match(/^ffmpeg version\s+([^\s]+)/)?.[1];
  if (!ffmpegVersion) throw new Error("ffmpeg did not report a parseable version");

  const normalizationArguments = [
    "-nostdin",
    "-hide_banner",
    "-loglevel", "error",
    "-threads", "1",
    "-i", "<input>",
    "-map", `0:${track.index}`,
    "-vn",
    "-ac", "1",
    "-ar", String(SAMPLE_RATE),
    "-sample_fmt", "s16",
    "-c:a", "pcm_s16le",
    "-f", "s16le",
    "<output>",
  ];
  const executionArguments = normalizationArguments.map((argument) =>
    argument === "<input>" ? media : argument === "<output>" ? "pipe:1" : argument,
  );
  let pcm;
  try {
    pcm = execFileSync(ffmpegBinary, executionArguments, {
      cwd: directory,
      encoding: "buffer",
      maxBuffer: MAX_PCM_BYTES,
    });
  } catch (error) {
    throw new Error(`ffmpeg could not normalize audio track ${track.index}`, { cause: error });
  }
  if (!Buffer.isBuffer(pcm) || pcm.length === 0 || pcm.length % 2 !== 0) {
    throw new Error("ffmpeg returned no complete signed 16-bit PCM samples");
  }
  const sampleCount = pcm.length / 2;
  const normalizedDuration = sampleCount / SAMPLE_RATE;
  if (Math.abs(normalizedDuration - probe.duration) > 0.15) {
    throw new Error("normalized PCM duration does not match the measured container duration");
  }
  if (track.duration !== undefined && Math.abs(normalizedDuration - track.duration) > 0.15) {
    throw new Error(`normalized PCM duration does not match measured audio track ${track.index}`);
  }
  const normalizedContent = contentFromBuffer(pcm);
  const frames = await inferFrames(pcm, sampleCount, modelPath);
  const windows = deriveWindows(frames, sampleCount);

  const receipt = {
    schema: "studio.speech-activity.v1",
    producer: {
      id: PRODUCER_ID,
      version: PRODUCER_VERSION,
      implementation: PRODUCER_IMPLEMENTATION,
      model: {
        revision: MODEL_REVISION,
        path: MODEL_RELATIVE_PATH,
        license: "MIT",
        license_path: LICENSE_RELATIVE_PATH,
        content: contentFromFingerprint(modelFingerprint),
      },
      runtime: {
        id: "onnxruntime-node",
        version: RUNTIME_VERSION,
        execution_provider: "cpu",
        execution_mode: "sequential",
        intra_op_threads: 1,
        inter_op_threads: 1,
        binary: {
          path: runtimeBinary.receipt,
          content: contentFromFingerprint(runtimeFingerprint),
        },
        platform: { os: process.platform, arch: process.arch, node: process.version },
      },
    },
    run: runId,
    input: {
      media,
      content_id: mediaFingerprint.contentId,
      bytes: mediaFingerprint.bytes,
      track_index: track.index,
    },
    normalization: {
      producer: {
        id: "ffmpeg",
        version: ffmpegVersion,
        binary: { path: ffmpegBinary, content: contentFromFingerprint(ffmpegFingerprint) },
      },
      arguments: normalizationArguments,
      sample_rate_hz: SAMPLE_RATE,
      channels: 1,
      sample_format: "s16le",
      sample_count: sampleCount,
      artifact: { path: NORMALIZED_PATH, content: normalizedContent },
    },
    configuration: {
      frame_samples: FRAME_SAMPLES,
      threshold: THRESHOLD,
      negative_threshold: NEGATIVE_THRESHOLD,
      min_speech_duration_ms: MIN_SPEECH_DURATION_MS,
      min_silence_duration_ms: MIN_SILENCE_DURATION_MS,
      speech_pad_ms: SPEECH_PAD_MS,
    },
    frames,
    speech_windows: windows.speech,
    non_speech_windows: windows.nonSpeech,
    note:
      "Speech activity only. No language, music, speaker, overlap, identity, or ownership fact is inferred by this producer.",
  };
  return { pcm, receipt, serialized: Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`) };
}

function compareExisting(path, expected, label) {
  if (!existsSync(path)) throw new Error(`${label} is unavailable for --check`);
  const actual = readFileSync(path);
  if (!actual.equals(expected)) throw new Error(`${label} does not match a fresh deterministic producer run`);
}

async function main() {
  const { values, flags } = parseArguments(process.argv.slice(2));
  const runId = values.get("run");
  if (!runId || !/^[a-z0-9-]+$/i.test(runId)) throw new Error("provide --run <preflight-id>");
  const directory = values.has("directory")
    ? resolve(values.get("directory"))
    : join(ROOT, ".studio", "runs", runId);
  const normalizedPath = join(directory, NORMALIZED_PATH);
  const receiptPath = join(directory, RECEIPT_PATH);
  if (!flags.has("replace") && !flags.has("check") && (existsSync(normalizedPath) || existsSync(receiptPath))) {
    throw new Error("speech evidence already exists; pass --check to verify it or --replace to refresh it explicitly");
  }

  const output = await buildReceipt(runId, directory, values.get("track") ?? null);
  if (flags.has("check")) {
    compareExisting(normalizedPath, output.pcm, NORMALIZED_PATH);
    compareExisting(receiptPath, output.serialized, RECEIPT_PATH);
    console.log(`speech detector verified ${relative(ROOT, receiptPath) || receiptPath}`);
    return;
  }

  const audioFlag = flags.has("replace") ? "w" : "wx";
  const receiptFlag = flags.has("replace") ? "w" : "wx";
  let createdAudio = false;
  let createdReceipt = false;
  try {
    writeFileSync(normalizedPath, output.pcm, { flag: audioFlag });
    createdAudio = true;
    writeFileSync(receiptPath, output.serialized, { flag: receiptFlag });
    createdReceipt = true;
  } catch (error) {
    if (!flags.has("replace")) {
      if (createdAudio) rmSync(normalizedPath, { force: true });
      if (createdReceipt) rmSync(receiptPath, { force: true });
    }
    throw error;
  }
  console.log(
    `speech detector wrote ${relative(ROOT, receiptPath) || receiptPath} with ${output.receipt.speech_windows.length} speech window(s)`,
  );
}

try {
  await main();
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
