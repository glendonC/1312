#!/usr/bin/env node
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { readFile, realpath, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

import * as ort from "onnxruntime-node";
import { ACOUSTIC_CONFIGURATION, ACOUSTIC_LIMITS, ACOUSTIC_PATCH_SAMPLES } from "../src/studio/acoustic/contracts.ts";
import { sampleRangeFromMilliseconds, validateAcousticObservations, validateAcousticReceipt } from "../src/studio/acoustic/validation.ts";
import { pcm16Patch, yamnetLogMel } from "../src/studio/acoustic/yamnetFeatures.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MODEL_DIRECTORY = join(ROOT, "vendor", "yamnet", "v0.58.0");
const MODEL_PATH = join(MODEL_DIRECTORY, "yamnet.onnx");
const MODEL_DATA_PATH = join(MODEL_DIRECTORY, "yamnet.data");
const MODEL_LICENSE_PATH = join(MODEL_DIRECTORY, "LICENSE");
const CLASS_MAP_PATH = join(MODEL_DIRECTORY, "yamnet_class_map.csv");
const ONTOLOGY_LICENSE_PATH = join(MODEL_DIRECTORY, "ONTOLOGY_LICENSE");
const PACKAGE_ROOT = join(ROOT, "node_modules", "onnxruntime-node");
const RUNTIME_BINARY = join(PACKAGE_ROOT, "bin", "napi-v6", process.platform, process.arch, "onnxruntime_binding.node");
const SPEECH_INDEXES = [...ACOUSTIC_CONFIGURATION.speechClassIndexes];
const MUSIC_INDEXES = [...ACOUSTIC_CONFIGURATION.musicClassIndexes];
const SPEECH_SET = new Set(SPEECH_INDEXES); const MUSIC_SET = new Set(MUSIC_INDEXES);
const CONFIGURATION = { ...ACOUSTIC_CONFIGURATION, speechClassIndexes: SPEECH_INDEXES, musicClassIndexes: MUSIC_INDEXES };

function argument(name, fallback = null) {
  const index = process.argv.indexOf(name); return index < 0 ? fallback : process.argv[index + 1];
}
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
function round(value) { return Number(value.toFixed(CONFIGURATION.roundingDigits)); }
function sigmoid(value) { return 1 / (1 + Math.exp(-value)); }
async function identity(path) {
  const bytes = await readFile(path); const digest = createHash("sha256").update(bytes).digest("hex");
  return { id: `sha256:${digest}`, hash: { algorithm: "sha256", digest }, bytes: bytes.byteLength };
}
async function contained(directory, candidate, label) {
  if (!candidate || isAbsolute(candidate) || candidate.split(/[\\/]/).includes("..")) throw new Error(`${label} escapes the source directory`);
  const [root, target] = await Promise.all([realpath(directory), realpath(join(directory, candidate))]);
  const inside = relative(root, target); if (!inside || inside.startsWith("..") || isAbsolute(inside)) throw new Error(`${label} resolves outside the source directory`);
  return target;
}
function classify(logits, availableSamples) {
  if (availableSamples < CONFIGURATION.minPatchSamples) {
    return { classification: "unknown", confidence: { speechCandidate: 0, music: 0, noise: 0, winningScore: 0, margin: 0 }, certainty: "weak", reason: "insufficient_samples" };
  }
  let speech = 0; let music = 0; let noise = 0;
  for (let index = 0; index < logits.length; index += 1) {
    const probability = sigmoid(logits[index] ?? Number.NEGATIVE_INFINITY);
    if (SPEECH_SET.has(index)) speech = Math.max(speech, probability);
    else if (MUSIC_SET.has(index)) music = Math.max(music, probability);
    else noise = Math.max(noise, probability);
  }
  const scores = [{ value: speech, label: "speech_candidate" }, { value: music, label: "music" }, { value: noise, label: "noise" }];
  scores.sort((left, right) => right.value - left.value || ["speech_candidate", "music", "noise"].indexOf(left.label) - ["speech_candidate", "music", "noise"].indexOf(right.label));
  const winningScore = scores[0].value; const margin = winningScore - scores[1].value;
  const confidence = { speechCandidate: round(speech), music: round(music), noise: round(noise), winningScore: round(winningScore), margin: round(margin) };
  if (speech >= CONFIGURATION.supportThreshold && music >= CONFIGURATION.supportThreshold) return { classification: "mixed", confidence, certainty: "strong", reason: "supported_speech_and_music" };
  if (winningScore >= CONFIGURATION.strongThreshold && margin >= CONFIGURATION.marginThreshold) return { classification: scores[0].label, confidence, certainty: "strong", reason: "strong_single_family" };
  return { classification: "unknown", confidence, certainty: "weak", reason: "below_threshold_or_margin" };
}

async function boundedChild() {
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), ...process.argv.slice(2), "--internal-bounded-producer"], {
    cwd: process.cwd(), env: { ...process.env, STUDIO_ACOUSTIC_INTERNAL: "1" }, stdio: ["ignore", "pipe", "pipe"],
  });
  const output = []; const errors = []; let outputBytes = 0;
  const collect = (target, chunk) => { outputBytes += chunk.byteLength; if (outputBytes > 64 * 1024) child.kill("SIGKILL"); else target.push(chunk); };
  child.stdout.on("data", (chunk) => collect(output, chunk)); child.stderr.on("data", (chunk) => collect(errors, chunk));
  const timer = setTimeout(() => child.kill("SIGKILL"), ACOUSTIC_LIMITS.maxWallMs);
  const result = await new Promise((resolveResult, reject) => {
    child.once("error", reject); child.once("exit", (code, signal) => resolveResult({ code, signal }));
  });
  clearTimeout(timer);
  if (result.code !== 0) throw new Error(result.signal === "SIGKILL" ? "Acoustic producer exceeded its wall/output ceiling" : Buffer.concat(errors).toString("utf8").trim() || `Acoustic producer exited ${result.code}`);
  process.stdout.write(Buffer.concat(output));
}

async function produce() {
const directory = resolve(argument("--directory") ?? "");
if (!directory || !(await stat(directory)).isDirectory()) throw new Error("--directory must name an owned-media preflight directory");
const speech = JSON.parse(await readFile(await contained(directory, "speech-activity.json", "speech receipt"), "utf8"));
if (speech.schema !== "studio.speech-activity.v1" || speech.producer?.id !== "silero-vad") throw new Error("Acoustic triage requires the registered speech-activity receipt");
const sourcePath = await contained(directory, speech.input.media, "source media");
const pcmPath = await contained(directory, "speech-input.pcm", "normalized PCM");
const speechPath = await contained(directory, "speech-activity.json", "speech receipt");
const [sourceContent, pcmContent, speechContent, modelContent, modelDataContent, licenseContent, classMapContent, ontologyLicenseContent, runtimeContent] = await Promise.all([
  identity(sourcePath), identity(pcmPath), identity(speechPath), identity(MODEL_PATH), identity(MODEL_DATA_PATH), identity(MODEL_LICENSE_PATH), identity(CLASS_MAP_PATH), identity(ONTOLOGY_LICENSE_PATH), identity(RUNTIME_BINARY),
]);
const classMap = (await readFile(CLASS_MAP_PATH, "utf8")).trimEnd().split(/\r?\n/);
if (classMap.length !== 522 || classMap[0] !== "index,mid,display_name" || !classMap[1]?.endsWith(",Speech") || !classMap[25]?.endsWith(",Singing") || !classMap[133]?.endsWith(",Music") || !classMap[277]?.endsWith(",Scary music")) throw new Error("Pinned AudioSet class map no longer matches the acoustic family configuration");
if (sourceContent.id !== speech.input.content_id || sourceContent.bytes !== speech.input.bytes || pcmContent.id !== speech.normalization.artifact.content.id || pcmContent.bytes !== speech.normalization.artifact.content.bytes) throw new Error("Source or normalized audio bytes drifted from speech preflight lineage");
const pcm = await readFile(pcmPath); if (pcm.byteLength % 2 !== 0 || pcm.byteLength / 2 !== speech.normalization.sample_count) throw new Error("Normalized PCM sample count changed");
const defaultEndMs = Math.floor(speech.normalization.sample_count / 16);
const startMs = Number(argument("--start-ms", "0")); const endMs = Number(argument("--end-ms", String(defaultEndMs)));
const { startSample, endSample } = sampleRangeFromMilliseconds(startMs, endMs);
if (endSample > speech.normalization.sample_count || endMs - startMs > ACOUSTIC_LIMITS.maxRangeMs || endSample - startSample > ACOUSTIC_LIMITS.maxDecodedSamples) throw new Error("Requested acoustic range exceeds source or hard limits");
const itemCount = Math.ceil((endSample - startSample) / ACOUSTIC_PATCH_SAMPLES); if (itemCount > ACOUSTIC_LIMITS.maxItems) throw new Error("Requested acoustic range exceeds item limit");
const startedAt = new Date().toISOString(); const startClock = performance.now();
const session = await ort.InferenceSession.create(MODEL_PATH, { executionMode: "sequential", intraOpNumThreads: 1, interOpNumThreads: 1, executionProviders: ["cpu"], graphOptimizationLevel: "all" });
const observations = [];
for (let index = 0; index < itemCount; index += 1) {
  const cellStart = startSample + index * ACOUSTIC_PATCH_SAMPLES; const cellEnd = Math.min(endSample, cellStart + ACOUSTIC_PATCH_SAMPLES);
  const { patch, availableSamples } = pcm16Patch(pcm, cellStart, cellEnd); let decision;
  if (availableSamples < CONFIGURATION.minPatchSamples) decision = classify([], availableSamples);
  else {
    const output = await session.run({ audio: new ort.Tensor("float32", yamnetLogMel(patch), [1, 1, 96, 64]) });
    const logits = output.class_scores?.data; if (!logits || logits.length !== 521) throw new Error("Acoustic model returned malformed class logits");
    decision = classify(logits, availableSamples);
  }
  observations.push({ index, startSample: cellStart, endSample: cellEnd, startMs: Math.floor(cellStart / 16), endMs: Math.ceil(cellEnd / 16), ...decision });
}
const commonRange = { startMs, endMs, startSample, endSample };
const body = { schema: "studio.acoustic-observations.v1", source: { contentId: sourceContent.id, bytes: sourceContent.bytes, trackIndex: speech.input.track_index }, normalization: { content: pcmContent, sampleRateHz: 16000, channels: 1, sampleFormat: "s16le", sampleCount: speech.normalization.sample_count }, requestedRange: commonRange, returnedRange: commonRange, status: "complete", observations };
validateAcousticObservations(body);
const bodyBytes = Buffer.from(`${JSON.stringify(body, null, 2)}\n`); if (bodyBytes.byteLength > ACOUSTIC_LIMITS.maxObservationBytes) throw new Error("Acoustic observation artifact exceeds byte limit");
const bodyDigest = createHash("sha256").update(bodyBytes).digest("hex"); const bodyContent = { id: `sha256:${bodyDigest}`, hash: { algorithm: "sha256", digest: bodyDigest }, bytes: bodyBytes.byteLength };
const wallMs = Math.ceil(performance.now() - startClock); if (wallMs > ACOUSTIC_LIMITS.maxWallMs) throw new Error("Acoustic execution exceeded wall-time limit");
const receiptBody = {
  run: speech.run,
  input: {
    media: { path: speech.input.media, content: sourceContent, trackIndex: speech.input.track_index },
    normalizedAudio: {
      path: "speech-input.pcm",
      content: pcmContent,
      sampleCount: speech.normalization.sample_count,
    },
    speechActivity: { path: "speech-activity.json", content: speechContent },
    requestedRange: commonRange,
  },
  producer: {
    id: "yamnet-acoustic-triage",
    version: "1.0.0",
    implementation: "scripts/detect-acoustics.mjs",
    model: {
      id: "qualcomm/YamNet",
      revision: "v0.58.0",
      upstream: "w-hc/torch_audioset@e8852c5",
      license: "MIT",
      files: [
        { path: "vendor/yamnet/v0.58.0/yamnet.onnx", content: modelContent },
        { path: "vendor/yamnet/v0.58.0/yamnet.data", content: modelDataContent },
        { path: "vendor/yamnet/v0.58.0/LICENSE", content: licenseContent },
        { path: "vendor/yamnet/v0.58.0/yamnet_class_map.csv", content: classMapContent },
        { path: "vendor/yamnet/v0.58.0/ONTOLOGY_LICENSE", content: ontologyLicenseContent },
      ],
    },
    runtime: {
      id: "onnxruntime-node",
      version: "1.27.0",
      executionProvider: "cpu",
      executionMode: "sequential",
      intraOpThreads: 1,
      interOpThreads: 1,
      binary: { path: relative(ROOT, RUNTIME_BINARY), content: runtimeContent },
      platform: { os: process.platform, arch: process.arch, node: process.version },
    },
  },
  normalization: {
    contract: "sealed_speech_pcm_v1",
    sampleRateHz: 16000,
    channels: 1,
    sampleFormat: "s16le",
    amplitudeScale: "int16_div_32768",
    featureExtraction: "yamnet_vggish_log_mel_v1",
    windowSamples: 400,
    hopSamples: 160,
    fftSamples: 512,
    melBands: 64,
    melMinHz: 125,
    melMaxHz: 7500,
    logOffset: 0.001,
    patchSamples: 15360,
    patchFrames: 96,
    finalPatch: "right_zero_pad_and_mark_weak_below_min_samples",
  },
  configuration: CONFIGURATION,
  limits: ACOUSTIC_LIMITS,
  execution: {
    startedAt,
    completedAt: new Date().toISOString(),
    wallMs,
    toolCalls: 1,
    decodedSamples: endSample - startSample,
  },
  output: {
    path: "acoustic-observations.json",
    content: bodyContent,
    status: "complete",
    itemCount: observations.length,
    requestedRange: commonRange,
    returnedRange: commonRange,
  },
  determinism: {
    equalityScope: "exact_receipted_model_runtime_platform_configuration_and_input",
    crossPlatformNumericalEquality: "not_claimed",
  },
  nonClaims: {
    semanticUnderstanding: "not_assessed",
    speechDetectionCompleteness: "not_claimed",
    lyricsUnderstanding: "not_assessed",
    calibration: "not_established",
  },
};
const receipt = { schema: "studio.acoustic-triage.receipt.v1", receiptId: `acoustic-triage:${createHash("sha256").update(canonical(receiptBody)).digest("hex")}`, ...receiptBody };
validateAcousticReceipt(receipt, body);
const receiptBytes = Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`); if (receiptBytes.byteLength > ACOUSTIC_LIMITS.maxReceiptBytes) throw new Error("Acoustic receipt exceeds byte limit");
await Promise.all([writeFile(join(directory, "acoustic-observations.json"), bodyBytes, { flag: "wx" }), writeFile(join(directory, "acoustic-triage.json"), receiptBytes, { flag: "wx" })]);
console.log(JSON.stringify({ observations: bodyContent.id, receiptId: receipt.receiptId, items: observations.length, wallMs }));
}

if (process.argv.includes("--internal-bounded-producer")) {
  if (process.env.STUDIO_ACOUSTIC_INTERNAL !== "1") throw new Error("Internal acoustic producer mode is host-owned");
  await produce();
} else {
  await boundedChild();
}
