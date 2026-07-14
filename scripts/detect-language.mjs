/**
 * Produce time-ranged language evidence over immutable VAD speech windows.
 *
 *   node scripts/detect-language.mjs --run local-001 [--directory .studio/runs/local-001]
 *   node scripts/detect-language.mjs --run local-001 --check
 *   node scripts/detect-language.mjs --run local-001 --replace
 *
 * The producer consumes only the normalized PCM ranges named by a valid speech receipt. It runs
 * the first decoder-token language classifier of a vendored Whisper model locally and records all
 * 99 language logits and softmax scores. Scores are reproducible model outputs, not calibrated
 * confidence. Short or threshold-ambiguous ranges remain withheld or unknown.
 */

import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  AutoFeatureExtractor,
  Tensor,
  WhisperForConditionalGeneration,
  env,
} from "@huggingface/transformers";

import { assertPreflightBundle } from "../src/studio/preflight/preflightBundleValidation.ts";
import { assertSpeechActivityReceipt } from "../src/studio/preflight/speechReceiptValidation.ts";
import { preflightSourceBinding } from "../src/studio/preflight/sourceAdapters.ts";
import { fingerprintFile } from "./lib/content-id.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PRODUCER_IMPLEMENTATION = "scripts/detect-language.mjs";
const MODEL_ROOT = "vendor/whisper-language/whisper-tiny-5332fcc";
const MODEL_REVISION = "5332fcc35e32a33b86612b9a57a89be7906102b1";
const TRANSFORMERS_REVISION = "54652ba3366ccd1e3b64e689a96504309e6fb53b";
const SPEECH_PATH = "speech-activity.json";
const PCM_PATH = "speech-input.pcm";
const V2_PATH = "preflight-v2.json";
const SOURCE_PATH = "source.json";
const PROBE_PATH = "media-probe.json";
const OUTPUT_PATH = "language-ranges.json";
const SAMPLE_RATE = 16_000;
const MAX_CHUNK_SAMPLES = 480_000;
const MIN_CHUNK_SAMPLES = 16_000;
const MIN_PROBABILITY = 0.5;
const MIN_MARGIN = 0.15;
const ROUNDING_DIGITS = 8;

const MODEL_FILES = [
  {
    role: "encoder",
    path: `${MODEL_ROOT}/encoder_model_quantized.onnx`,
    digest: "fd9d995b9dcb0520f0dbf6cf68651af639fc385f594d9d876e69ca2802dc438e",
    bytes: 10_124_910,
  },
  {
    role: "decoder",
    path: `${MODEL_ROOT}/decoder_model_merged_quantized.onnx`,
    digest: "6c0c125986b007d2e3734bec84c18bda0152071b90b87fadac6d7764499927a0",
    bytes: 30_727_765,
  },
  {
    role: "model_config",
    path: `${MODEL_ROOT}/config.json`,
    digest: "2b2e4e519084e0ea028b19b153f95202735a971870d6844aa26e559edd292e94",
    bytes: 2_248,
  },
  {
    role: "generation_config",
    path: `${MODEL_ROOT}/generation_config.json`,
    digest: "68ac791fcb4999461a313472125042934656240ba1cba7d1c2627fcbb19ac24c",
    bytes: 3_716,
  },
  {
    role: "preprocessor_config",
    path: `${MODEL_ROOT}/preprocessor_config.json`,
    digest: "a6a76d28c93edb273669eb9e0b0636a2bddbb1272c3261e47b7ca6dfdbac1b8d",
    bytes: 339,
  },
  {
    role: "license_evidence",
    path: `${MODEL_ROOT}/MODEL_CARD.md`,
    digest: "cdd395427d195f122aee69c00e34183f2fadd8bc217aef35ca7c43395b96d29d",
    bytes: 1_160,
  },
  {
    role: "upstream_license",
    path: `${MODEL_ROOT}/LICENSE.openai-whisper`,
    digest: "b5d65a59060e68c4ff940e1eddfa6f94b2d68fdf58ed7f4dd57721c997e35e9d",
    bytes: 1_063,
  },
];

const RUNTIME_FILES = {
  manifest: {
    path: "node_modules/@huggingface/transformers/package.json",
    digest: "9cf12901d934e5a0628c6f163484abade392ab2d3b369d458ed3dfdeaa7f9a39",
    bytes: 2_673,
  },
  entry: {
    path: "node_modules/@huggingface/transformers/dist/transformers.node.mjs",
    digest: "4932ec78a6b136d97d09a12093afb476530d9aa099dbaf1f9822ad56bfe2bc3d",
    bytes: 1_256_499,
  },
  license: {
    path: `${MODEL_ROOT}/LICENSE.transformers-js`,
    digest: "cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30",
    bytes: 11_358,
  },
};

const LANGUAGE_CODES = (
  "en,zh,de,es,ru,ko,fr,ja,pt,tr,pl,ca,nl,ar,sv,it,id,hi,fi,vi,he,uk,el,ms,cs,ro,da,hu,ta,no,th,ur,hr,bg,lt,la,mi,ml,cy,sk,te,fa,lv,bn,sr,az,sl,kn,et,mk,br,eu,is,hy,ne,mn,bs,kk,sq,sw,gl,mr,pa,si,km,sn,yo,so,af,oc,ka,be,tg,sd,gu,am,yi,lo,uz,fo,ht,ps,tk,nn,mt,sa,lb,my,bo,tl,mg,as,tt,haw,ln,ha,ba,jw,su"
).split(",");
const LANGUAGES = LANGUAGE_CODES.map((code, index) => ({ code, token_id: 50_259 + index }));

function fail(message) {
  console.error(`language detector: ${message}`);
  process.exitCode = 1;
}

function parseArguments(argv) {
  const values = new Map();
  const flags = new Set();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--check" || token === "--replace") {
      const name = token.slice(2);
      if (flags.has(name)) throw new Error(`${token} was provided more than once`);
      flags.add(name);
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
  if (flags.has("check") && flags.has("replace")) throw new Error("--check and --replace cannot be combined");
  return { values, flags };
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
}

function contentFromFingerprint(fingerprint) {
  return {
    id: fingerprint.contentId,
    hash: { algorithm: "sha256", digest: fingerprint.digest },
    bytes: fingerprint.bytes,
  };
}

function assertContent(value, label) {
  exactKeys(value, ["id", "hash", "bytes"], label);
  exactKeys(value.hash, ["algorithm", "digest"], `${label}.hash`);
  if (
    value.hash.algorithm !== "sha256" ||
    !/^[a-f0-9]{64}$/.test(value.hash.digest) ||
    value.id !== `sha256:${value.hash.digest}` ||
    !Number.isSafeInteger(value.bytes) ||
    value.bytes <= 0
  ) {
    throw new Error(`${label} must be an exact non-empty SHA-256 content identity`);
  }
}

function sameContent(fingerprint, content, label) {
  assertContent(content, label);
  if (fingerprint.contentId !== content.id || fingerprint.bytes !== content.bytes) {
    throw new Error(`${label} does not match its indexed bytes`);
  }
}

async function pinnedFile(pin, label) {
  const fingerprint = await fingerprintFile(join(ROOT, pin.path));
  if (fingerprint.digest !== pin.digest || fingerprint.bytes !== pin.bytes) {
    throw new Error(`${label} does not match the production pin ${pin.digest}/${pin.bytes}`);
  }
  return { path: pin.path, content: contentFromFingerprint(fingerprint) };
}

async function validateInputs(directory, runId) {
  const speechFile = join(directory, SPEECH_PATH);
  const pcmFile = join(directory, PCM_PATH);
  const v2File = join(directory, V2_PATH);
  const source = readJson(join(directory, SOURCE_PATH), SOURCE_PATH);
  const probe = readJson(join(directory, PROBE_PATH), PROBE_PATH);
  const speech = readJson(speechFile, SPEECH_PATH);
  exactKeys(
    speech,
    ["schema", "producer", "run", "input", "normalization", "configuration", "frames", "speech_windows", "non_speech_windows", "note"],
    "speech",
  );
  if (speech.schema !== "studio.speech-activity.v1" || speech.run !== runId) {
    throw new Error("speech receipt schema or run does not match --run");
  }
  exactKeys(speech.producer, ["id", "version", "implementation", "model", "runtime"], "speech.producer");
  if (
    speech.producer.id !== "silero-vad" ||
    speech.producer.version !== "6.2.1" ||
    speech.producer.implementation !== "scripts/detect-speech.mjs"
  ) {
    throw new Error("speech.producer is not the registered deterministic VAD");
  }
  exactKeys(
    speech.normalization,
    ["producer", "arguments", "sample_rate_hz", "channels", "sample_format", "sample_count", "artifact"],
    "speech.normalization",
  );
  if (
    speech.normalization.sample_rate_hz !== SAMPLE_RATE ||
    speech.normalization.channels !== 1 ||
    speech.normalization.sample_format !== "s16le" ||
    !Number.isSafeInteger(speech.normalization.sample_count) ||
    speech.normalization.sample_count <= 0
  ) {
    throw new Error("speech.normalization is not registered 16 kHz mono signed 16-bit PCM");
  }
  exactKeys(speech.normalization.artifact, ["path", "content"], "speech.normalization.artifact");
  if (speech.normalization.artifact.path !== PCM_PATH) {
    throw new Error(`speech.normalization.artifact.path must equal ${PCM_PATH}`);
  }

  const [speechFingerprint, pcmFingerprint] = await Promise.all([
    fingerprintFile(speechFile),
    fingerprintFile(pcmFile),
  ]);
  sameContent(pcmFingerprint, speech.normalization.artifact.content, "speech normalized PCM");
  if (pcmFingerprint.bytes !== speech.normalization.sample_count * 2) {
    throw new Error("speech normalized PCM byte count does not match sample_count");
  }

  if (!Array.isArray(speech.speech_windows)) throw new Error("speech.speech_windows must be an array");
  let previousEnd = 0;
  speech.speech_windows.forEach((window, index) => {
    exactKeys(window, ["start_sample", "end_sample"], `speech.speech_windows[${index}]`);
    if (
      !Number.isSafeInteger(window.start_sample) ||
      !Number.isSafeInteger(window.end_sample) ||
      window.start_sample < previousEnd ||
      window.end_sample <= window.start_sample ||
      window.end_sample > speech.normalization.sample_count
    ) {
      throw new Error(`speech.speech_windows[${index}] is not an ordered in-bounds sample range`);
    }
    previousEnd = window.end_sample;
  });

  const v2 = readJson(v2File, V2_PATH);
  if (
    v2.schema !== "studio.preflight-bundle.v2" ||
    v2.producer !== "scripts/seal-speech-preflight.mjs" ||
    !Array.isArray(v2.artifacts)
  ) {
    throw new Error("preflight-v2.json is not the immutable speech-backed index");
  }
  const binding = preflightSourceBinding(source);
  if (!binding) throw new Error("language detector input has no content-addressed source adapter");
  assertSpeechActivityReceipt(speech, binding, probe, "Language detector input speech receipt");
  assertPreflightBundle(v2, binding, "Language detector input v2 preflight", speech);
  const speechArtifact = v2.artifacts.find((artifact) => artifact.artifact_id === "speech-activity");
  const pcmArtifact = v2.artifacts.find((artifact) => artifact.artifact_id === "speech-detector-audio");
  if (
    !speechArtifact ||
    speechArtifact.path !== SPEECH_PATH ||
    speechArtifact.producer !== "scripts/detect-speech.mjs" ||
    !pcmArtifact ||
    pcmArtifact.path !== PCM_PATH ||
    pcmArtifact.producer !== "scripts/detect-speech.mjs"
  ) {
    throw new Error("preflight-v2.json does not index the registered speech evidence");
  }
  sameContent(speechFingerprint, speechArtifact.content, "indexed speech receipt");
  sameContent(pcmFingerprint, pcmArtifact.content, "indexed speech PCM");
  return { speech, pcm: readFileSync(pcmFile), speechFingerprint, pcmFingerprint };
}

function runtimeBinaryPath(packageRoot) {
  const relativeBinary = join(
    "node_modules", "onnxruntime-node", "bin", "napi-v6", process.platform, process.arch,
    "onnxruntime_binding.node",
  );
  const absolute = join(packageRoot, relativeBinary);
  if (!existsSync(absolute)) {
    throw new Error(`pinned onnxruntime-node has no binary for ${process.platform}/${process.arch}`);
  }
  return {
    absolute,
    receipt: [
      "node_modules", "@huggingface", "transformers", ...relativeBinary.split(/[\\/]/),
    ].join("/"),
  };
}

function round(value) {
  if (!Number.isFinite(value)) throw new Error("language model emitted a non-finite score");
  return Number(value.toFixed(ROUNDING_DIGITS));
}

function makeDecision(scores) {
  const ranked = [...scores].sort(
    (left, right) => right.probability - left.probability || left.token_id - right.token_id,
  );
  const first = ranked[0];
  const second = ranked[1];
  const margin = round(first.probability - second.probability);
  const belowProbability = first.probability < MIN_PROBABILITY;
  const belowMargin = margin < MIN_MARGIN;
  if (!belowProbability && !belowMargin) {
    return {
      status: "classified",
      code: first.code,
      token_id: first.token_id,
      probability: first.probability,
      margin,
      reason: null,
    };
  }
  return {
    status: "unknown",
    code: null,
    token_id: null,
    probability: first.probability,
    margin,
    reason: belowProbability && belowMargin
      ? "below_probability_and_margin"
      : belowProbability
        ? "below_probability"
        : "below_margin",
  };
}

function pcmSamples(pcm, startSample, endSample) {
  const samples = new Float32Array(endSample - startSample);
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = pcm.readInt16LE((startSample + index) * 2) / 32_768;
  }
  return samples;
}

async function inferScores(model, extractor, pcm, startSample, endSample) {
  const samples = pcmSamples(pcm, startSample, endSample);
  const { input_features: inputFeatures } = await extractor(samples);
  const startToken = model.generation_config?.decoder_start_token_id;
  if (startToken !== 50_258) throw new Error("model decoder start token does not match the production pin");
  const decoderInputIds = new Tensor("int64", BigInt64Array.of(BigInt(startToken)), [1, 1]);
  const output = await model({ input_features: inputFeatures, decoder_input_ids: decoderInputIds });
  try {
    if (!output.logits || output.logits.dims.length !== 3 || output.logits.dims[0] !== 1 || output.logits.dims[1] !== 1) {
      throw new Error("Whisper language model returned an unexpected first-token output contract");
    }
    const scores = LANGUAGES.map(({ code, token_id: tokenId }) => ({
      code,
      token_id: tokenId,
      logit: round(Number(output.logits.data[tokenId])),
      probability: 0,
    }));
    const maximum = Math.max(...scores.map((score) => score.logit));
    const exponentials = scores.map((score) => Math.exp(score.logit - maximum));
    const denominator = exponentials.reduce((total, value) => total + value, 0);
    scores.forEach((score, index) => {
      score.probability = round(exponentials[index] / denominator);
    });
    return scores;
  } finally {
    for (const value of Object.values(output)) {
      if (value && typeof value.dispose === "function") await value.dispose();
    }
    if (typeof inputFeatures.dispose === "function") inputFeatures.dispose();
    if (typeof decoderInputIds.dispose === "function") decoderInputIds.dispose();
  }
}

async function buildReceipt(directory, runId) {
  const { speech, pcm, speechFingerprint, pcmFingerprint } = await validateInputs(directory, runId);
  const modelFiles = [];
  for (const pin of MODEL_FILES) {
    modelFiles.push({ role: pin.role, ...(await pinnedFile(pin, `model file ${pin.role}`)) });
  }
  const manifestValue = readJson(join(ROOT, RUNTIME_FILES.manifest.path), "Transformers.js package manifest");
  if (
    manifestValue.name !== "@huggingface/transformers" ||
    manifestValue.version !== "4.2.0" ||
    manifestValue.dependencies?.["onnxruntime-node"] !== "1.24.3"
  ) {
    throw new Error("Transformers.js manifest does not match the 4.2.0 runtime pin");
  }
  const runtimePackage = {
    manifest: await pinnedFile(RUNTIME_FILES.manifest, "Transformers.js package manifest"),
    entry: await pinnedFile(RUNTIME_FILES.entry, "Transformers.js runtime entry"),
    license: await pinnedFile(RUNTIME_FILES.license, "Transformers.js license"),
  };
  const resolvedEntry = fileURLToPath(import.meta.resolve("@huggingface/transformers"));
  if (resolvedEntry !== join(ROOT, RUNTIME_FILES.entry.path)) {
    throw new Error("resolved Transformers.js entry does not match the receipted runtime entry");
  }
  const packageRoot = dirname(dirname(resolvedEntry));
  const runtimeBinary = runtimeBinaryPath(packageRoot);
  const runtimeBinaryFingerprint = await fingerprintFile(runtimeBinary.absolute);

  const generation = readJson(join(ROOT, `${MODEL_ROOT}/generation_config.json`), "pinned generation config");
  const configuredLanguages = Object.entries(generation.lang_to_id ?? {})
    .map(([token, tokenId]) => ({ code: token.slice(2, -2), token_id: tokenId }))
    .sort((left, right) => left.token_id - right.token_id);
  if (JSON.stringify(configuredLanguages) !== JSON.stringify(LANGUAGES)) {
    throw new Error("pinned generation config does not contain the exact ordered 99-language token set");
  }

  env.allowRemoteModels = false;
  env.allowLocalModels = true;
  const localModelRoot = join(ROOT, MODEL_ROOT);
  const localOptions = { local_files_only: true, subfolder: "" };
  const extractor = await AutoFeatureExtractor.from_pretrained(localModelRoot, localOptions);
  const model = await WhisperForConditionalGeneration.from_pretrained(localModelRoot, {
    ...localOptions,
    dtype: "q8",
    device: "cpu",
    session_options: {
      executionProviders: ["cpu"],
      executionMode: "sequential",
      intraOpNumThreads: 1,
      interOpNumThreads: 1,
      graphOptimizationLevel: "all",
    },
  });
  try {
    const loadedLanguages = Object.entries(model.generation_config?.lang_to_id ?? {})
      .map(([token, tokenId]) => ({ code: token.slice(2, -2), token_id: tokenId }))
      .sort((left, right) => left.token_id - right.token_id);
    if (JSON.stringify(loadedLanguages) !== JSON.stringify(LANGUAGES)) {
      throw new Error("loaded Whisper model does not expose the pinned 99-language token set");
    }

    const ranges = [];
    for (const [speechWindowIndex, window] of speech.speech_windows.entries()) {
      let chunkIndex = 0;
      for (let startSample = window.start_sample; startSample < window.end_sample; startSample += MAX_CHUNK_SAMPLES) {
        const endSample = Math.min(startSample + MAX_CHUNK_SAMPLES, window.end_sample);
        if (endSample - startSample < MIN_CHUNK_SAMPLES) {
          ranges.push({
            speech_window_index: speechWindowIndex,
            chunk_index: chunkIndex,
            start_sample: startSample,
            end_sample: endSample,
            scores: [],
            decision: {
              status: "withheld",
              code: null,
              token_id: null,
              probability: null,
              margin: null,
              reason: "insufficient_samples",
            },
          });
        } else {
          const scores = await inferScores(model, extractor, pcm, startSample, endSample);
          ranges.push({
            speech_window_index: speechWindowIndex,
            chunk_index: chunkIndex,
            start_sample: startSample,
            end_sample: endSample,
            scores,
            decision: makeDecision(scores),
          });
        }
        chunkIndex += 1;
      }
    }

    return {
      schema: "studio.language-ranges.v1",
      producer: {
        id: "whisper-language-id",
        version: "1.0.0",
        implementation: PRODUCER_IMPLEMENTATION,
        model: {
          id: "Xenova/whisper-tiny",
          revision: MODEL_REVISION,
          base_model: "openai/whisper-tiny",
          quantization: "q8",
          license: "Apache-2.0",
          upstream_license: "MIT",
          files: modelFiles,
        },
        runtime: {
          id: "@huggingface/transformers",
          version: "4.2.0",
          revision: TRANSFORMERS_REVISION,
          license: "Apache-2.0",
          package: runtimePackage,
          engine: {
            id: "onnxruntime-node",
            version: "1.24.3",
            execution_provider: "cpu",
            execution_mode: "sequential",
            graph_optimization_level: "all",
            intra_op_threads: 1,
            inter_op_threads: 1,
            binary: { path: runtimeBinary.receipt, content: contentFromFingerprint(runtimeBinaryFingerprint) },
          },
          platform: { os: process.platform, arch: process.arch, node: process.version },
        },
      },
      run: runId,
      input: {
        speech_activity: { path: SPEECH_PATH, content: contentFromFingerprint(speechFingerprint) },
        normalized_audio: { path: PCM_PATH, content: contentFromFingerprint(pcmFingerprint) },
        sample_rate_hz: SAMPLE_RATE,
        sample_count: speech.normalization.sample_count,
      },
      configuration: {
        max_chunk_samples: MAX_CHUNK_SAMPLES,
        min_chunk_samples: MIN_CHUNK_SAMPLES,
        min_probability: MIN_PROBABILITY,
        min_margin: MIN_MARGIN,
        rounding_digits: ROUNDING_DIGITS,
        tie_break: "lowest_token_id",
        window_source: "speech_windows",
      },
      languages: LANGUAGES,
      ranges,
      note:
        "Time-ranged language identification over receipted speech windows only. Scores are a 99-language model softmax, not calibrated confidence; unknown and withheld decisions are not classifications.",
    };
  } finally {
    if (typeof model.dispose === "function") await model.dispose();
  }
}

async function main() {
  const { values, flags } = parseArguments(process.argv.slice(2));
  const runId = values.get("run");
  if (!runId || !/^[a-z0-9-]+$/i.test(runId)) throw new Error("provide --run <preflight-id>");
  const directory = values.has("directory")
    ? resolve(values.get("directory"))
    : join(ROOT, ".studio", "runs", runId);
  const outputPath = join(directory, OUTPUT_PATH);
  if (existsSync(outputPath) && !flags.has("check") && !flags.has("replace")) {
    throw new Error("language evidence already exists; pass --check to verify it or --replace to refresh it explicitly");
  }
  const receipt = await buildReceipt(directory, runId);
  const serialized = Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`);
  if (flags.has("check")) {
    if (!existsSync(outputPath)) throw new Error(`${OUTPUT_PATH} is unavailable for --check`);
    if (!readFileSync(outputPath).equals(serialized)) {
      throw new Error(`${OUTPUT_PATH} does not match a fresh deterministic producer run`);
    }
    console.log(`language detector verified ${relative(ROOT, outputPath) || outputPath}`);
    return;
  }
  let created = false;
  try {
    writeFileSync(outputPath, serialized, { flag: flags.has("replace") ? "w" : "wx" });
    created = true;
  } catch (error) {
    if (!flags.has("replace") && created) rmSync(outputPath, { force: true });
    throw error;
  }
  const counts = receipt.ranges.reduce((totals, range) => {
    totals[range.decision.status] += 1;
    return totals;
  }, { classified: 0, unknown: 0, withheld: 0 });
  console.log(
    `language detector wrote ${relative(ROOT, outputPath) || outputPath} with ` +
    `${counts.classified} classified, ${counts.unknown} unknown, and ${counts.withheld} withheld range(s)`,
  );
}

try {
  await main();
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
