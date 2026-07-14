import type { MediaProbeReceipt } from "../types";
import type {
  LanguageCodeToken,
  LanguageModelFileRole,
  LanguageRange,
  LanguageRangeDecision,
  LanguageRangeScore,
  LanguageRangesReceipt,
  PreflightSourceBinding,
  Sha256Content,
  SpeechActivityReceipt,
} from "./contracts";

const SHA256 = /^[a-f0-9]{64}$/;
const LANGUAGE_CODE = /^[a-z]{2,3}(?:-[A-Za-z0-9]+)*$/;
const MODEL_ROOT = "vendor/whisper-language/whisper-tiny-5332fcc/";
const MAX_CHUNK_SAMPLES = 480_000;
const MIN_CHUNK_SAMPLES = 16_000;
const MIN_PROBABILITY = 0.5;
const MIN_MARGIN = 0.15;
const ROUNDING_DIGITS = 8;
const PROBABILITY_SUM_TOLERANCE = 0.000001;

function round(value: number): number {
  return Number(value.toFixed(ROUNDING_DIGITS));
}

interface PinnedFile {
  role: LanguageModelFileRole;
  path: string;
  digest: string;
  bytes: number;
}

// The hashes and byte counts are part of the producer version, never inferred from a filename.
// Keep this table ordered because the receipt and V3 lineage use the same deterministic order.
const PINNED_MODEL_FILES: readonly PinnedFile[] = [
  {
    role: "encoder",
    path: `${MODEL_ROOT}encoder_model_quantized.onnx`,
    digest: "fd9d995b9dcb0520f0dbf6cf68651af639fc385f594d9d876e69ca2802dc438e",
    bytes: 10_124_910,
  },
  {
    role: "decoder",
    path: `${MODEL_ROOT}decoder_model_merged_quantized.onnx`,
    digest: "6c0c125986b007d2e3734bec84c18bda0152071b90b87fadac6d7764499927a0",
    bytes: 30_727_765,
  },
  {
    role: "model_config",
    path: `${MODEL_ROOT}config.json`,
    digest: "2b2e4e519084e0ea028b19b153f95202735a971870d6844aa26e559edd292e94",
    bytes: 2_248,
  },
  {
    role: "generation_config",
    path: `${MODEL_ROOT}generation_config.json`,
    digest: "68ac791fcb4999461a313472125042934656240ba1cba7d1c2627fcbb19ac24c",
    bytes: 3_716,
  },
  {
    role: "preprocessor_config",
    path: `${MODEL_ROOT}preprocessor_config.json`,
    digest: "a6a76d28c93edb273669eb9e0b0636a2bddbb1272c3261e47b7ca6dfdbac1b8d",
    bytes: 339,
  },
  {
    role: "license_evidence",
    path: `${MODEL_ROOT}MODEL_CARD.md`,
    digest: "cdd395427d195f122aee69c00e34183f2fadd8bc217aef35ca7c43395b96d29d",
    bytes: 1_160,
  },
  {
    role: "upstream_license",
    path: `${MODEL_ROOT}LICENSE.openai-whisper`,
    digest: "b5d65a59060e68c4ff940e1eddfa6f94b2d68fdf58ed7f4dd57721c997e35e9d",
    bytes: 1_063,
  },
];
const PINNED_RUNTIME_FILES: Readonly<Record<"manifest" | "entry" | "license", Omit<PinnedFile, "role">>> = {
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
    path: `${MODEL_ROOT}LICENSE.transformers-js`,
    digest: "cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30",
    bytes: 11_358,
  },
};
const PINNED_LANGUAGES: readonly LanguageCodeToken[] = (
  "en,zh,de,es,ru,ko,fr,ja,pt,tr,pl,ca,nl,ar,sv,it,id,hi,fi,vi,he,uk,el,ms,cs,ro,da,hu,ta,no,th,ur,hr,bg,lt,la,mi,ml,cy,sk,te,fa,lv,bn,sr,az,sl,kn,et,mk,br,eu,is,hy,ne,mn,bs,kk,sq,sw,gl,mr,pa,si,km,sn,yo,so,af,oc,ka,be,tg,sd,gu,am,yi,lo,uz,fo,ht,ps,tk,nn,mt,sa,lb,my,bo,tl,mg,as,tt,haw,ln,ha,ba,jw,su"
).split(",").map((code, index) => ({ code, token_id: 50_259 + index }));

function fail(context: string, path: string, message: string): never {
  throw new Error(`${context}: ${path} ${message}`);
}

function record(value: unknown, context: string, path: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail(context, path, "must be an object");
  }
  return value as Record<string, unknown>;
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  context: string,
  path: string,
): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    fail(context, path, `must contain exactly ${wanted.join(", ")}`);
  }
}

function list(value: unknown, context: string, path: string): unknown[] {
  if (!Array.isArray(value)) fail(context, path, "must be an array");
  return value;
}

function text(value: unknown, context: string, path: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    fail(context, path, "must be a non-empty string");
  }
  return value;
}

function exact(value: unknown, expected: string, context: string, path: string): void {
  if (text(value, context, path) !== expected) fail(context, path, `must equal ${expected}`);
}

function exactNumber(value: unknown, expected: number, context: string, path: string): void {
  if (value !== expected) fail(context, path, `must equal ${expected}`);
}

function positiveInteger(value: unknown, context: string, path: string): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    fail(context, path, "must be a positive safe integer");
  }
  return value as number;
}

function nonNegativeInteger(value: unknown, context: string, path: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    fail(context, path, "must be a non-negative safe integer");
  }
  return value as number;
}

function roundedFinite(value: unknown, context: string, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) fail(context, path, "must be finite");
  if (Number(value.toFixed(ROUNDING_DIGITS)) !== value) {
    fail(context, path, `must be rounded to at most ${ROUNDING_DIGITS} decimal places`);
  }
  return value;
}

function probability(value: unknown, context: string, path: string): number {
  const result = roundedFinite(value, context, path);
  if (result < 0 || result > 1) fail(context, path, "must be from 0 through 1");
  return result;
}

function relativePath(value: unknown, context: string, path: string): string {
  const candidate = text(value, context, path);
  if (candidate.startsWith("/") || candidate.startsWith("\\") || candidate.split(/[\\/]/).includes("..")) {
    fail(context, path, "must be a relative path without traversal");
  }
  return candidate;
}

function content(value: unknown, context: string, path: string): Sha256Content {
  const item = record(value, context, path);
  exactKeys(item, ["id", "hash", "bytes"], context, path);
  const id = text(item.id, context, `${path}.id`);
  if (!id.startsWith("sha256:") || !SHA256.test(id.slice("sha256:".length))) {
    fail(context, `${path}.id`, "must be a sha256:<lowercase digest> content id");
  }
  const hash = record(item.hash, context, `${path}.hash`);
  exactKeys(hash, ["algorithm", "digest"], context, `${path}.hash`);
  exact(hash.algorithm, "sha256", context, `${path}.hash.algorithm`);
  const digest = text(hash.digest, context, `${path}.hash.digest`);
  if (!SHA256.test(digest)) fail(context, `${path}.hash.digest`, "must be a lowercase SHA-256 digest");
  if (id !== `sha256:${digest}`) fail(context, `${path}.id`, "does not match its digest");
  positiveInteger(item.bytes, context, `${path}.bytes`);
  return value as Sha256Content;
}

function pinnedContent(
  value: unknown,
  pin: { path: string; digest: string; bytes: number },
  context: string,
  path: string,
): void {
  const item = record(value, context, path);
  exactKeys(item, ["path", "content"], context, path);
  exact(relativePath(item.path, context, `${path}.path`), pin.path, context, `${path}.path`);
  const identity = content(item.content, context, `${path}.content`);
  if (identity.hash.digest !== pin.digest || identity.bytes !== pin.bytes) {
    fail(context, `${path}.content`, "does not match the pinned producer file identity");
  }
}

function language(value: unknown, expected: LanguageCodeToken, context: string, path: string): LanguageCodeToken {
  const item = record(value, context, path);
  exactKeys(item, ["code", "token_id"], context, path);
  const code = text(item.code, context, `${path}.code`);
  if (!LANGUAGE_CODE.test(code)) fail(context, `${path}.code`, "must be a normalized language code");
  exact(code, expected.code, context, `${path}.code`);
  const tokenId = nonNegativeInteger(item.token_id, context, `${path}.token_id`);
  if (tokenId !== expected.token_id) fail(context, `${path}.token_id`, `must equal ${expected.token_id}`);
  return { code, token_id: tokenId };
}

function score(value: unknown, expected: LanguageCodeToken, context: string, path: string): LanguageRangeScore {
  const item = record(value, context, path);
  exactKeys(item, ["code", "token_id", "logit", "probability"], context, path);
  const identity = language({ code: item.code, token_id: item.token_id }, expected, context, path);
  return {
    ...identity,
    logit: roundedFinite(item.logit, context, `${path}.logit`),
    probability: probability(item.probability, context, `${path}.probability`),
  };
}

function expectedDecision(scores: LanguageRangeScore[]): LanguageRangeDecision {
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

function assertSoftmaxProbabilities(
  scores: LanguageRangeScore[],
  context: string,
  path: string,
): void {
  const maximum = Math.max(...scores.map((candidate) => candidate.logit));
  const exponentials = scores.map((candidate) => Math.exp(candidate.logit - maximum));
  const denominator = exponentials.reduce((total, candidate) => total + candidate, 0);
  exponentials.forEach((candidate, index) => {
    const expected = round(candidate / denominator);
    if (scores[index].probability !== expected) {
      fail(
        context,
        `${path}[${index}].probability`,
        `must equal the ${ROUNDING_DIGITS}-decimal softmax probability ${expected}`,
      );
    }
  });
}

function decision(
  value: unknown,
  expected: LanguageRangeDecision,
  context: string,
  path: string,
): LanguageRangeDecision {
  const item = record(value, context, path);
  exactKeys(item, ["status", "code", "token_id", "probability", "margin", "reason"], context, path);
  for (const key of ["status", "code", "token_id", "probability", "margin", "reason"] as const) {
    if (item[key] !== expected[key]) {
      fail(context, `${path}.${key}`, `must equal ${String(expected[key])}`);
    }
  }
  return value as LanguageRangeDecision;
}

function expectedRanges(speech: SpeechActivityReceipt): Array<Omit<LanguageRange, "scores" | "decision">> {
  const expected: Array<Omit<LanguageRange, "scores" | "decision">> = [];
  speech.speech_windows.forEach((window, speechWindowIndex) => {
    let cursor = window.start_sample;
    let chunkIndex = 0;
    while (cursor < window.end_sample) {
      const end = Math.min(cursor + MAX_CHUNK_SAMPLES, window.end_sample);
      expected.push({
        speech_window_index: speechWindowIndex,
        chunk_index: chunkIndex,
        start_sample: cursor,
        end_sample: end,
      });
      cursor = end;
      chunkIndex += 1;
    }
  });
  return expected;
}

/** Validate a language receipt only after its source, probe, and speech receipt have been validated. */
export function assertLanguageRangesReceipt(
  value: unknown,
  binding: PreflightSourceBinding,
  mediaProbe: MediaProbeReceipt,
  speechActivity: SpeechActivityReceipt,
  context = "Studio language-ranges receipt",
): asserts value is LanguageRangesReceipt {
  const receipt = record(value, context, "receipt");
  exactKeys(receipt, ["schema", "producer", "run", "input", "configuration", "languages", "ranges", "note"], context, "receipt");
  exact(receipt.schema, "studio.language-ranges.v1", context, "receipt.schema");
  text(receipt.note, context, "receipt.note");

  const producer = record(receipt.producer, context, "receipt.producer");
  exactKeys(producer, ["id", "version", "implementation", "model", "runtime"], context, "receipt.producer");
  exact(producer.id, "whisper-language-id", context, "receipt.producer.id");
  exact(producer.version, "1.0.0", context, "receipt.producer.version");
  exact(producer.implementation, "scripts/detect-language.mjs", context, "receipt.producer.implementation");

  const model = record(producer.model, context, "receipt.producer.model");
  exactKeys(model, ["id", "revision", "base_model", "quantization", "license", "upstream_license", "files"], context, "receipt.producer.model");
  exact(model.id, "Xenova/whisper-tiny", context, "receipt.producer.model.id");
  exact(model.revision, "5332fcc35e32a33b86612b9a57a89be7906102b1", context, "receipt.producer.model.revision");
  exact(model.base_model, "openai/whisper-tiny", context, "receipt.producer.model.base_model");
  exact(model.quantization, "q8", context, "receipt.producer.model.quantization");
  exact(model.license, "Apache-2.0", context, "receipt.producer.model.license");
  exact(model.upstream_license, "MIT", context, "receipt.producer.model.upstream_license");
  const modelFiles = list(model.files, context, "receipt.producer.model.files");
  if (modelFiles.length !== PINNED_MODEL_FILES.length) {
    fail(context, "receipt.producer.model.files", "must contain the exact ordered pinned model files");
  }
  modelFiles.forEach((entry, index) => {
    const item = record(entry, context, `receipt.producer.model.files[${index}]`);
    exactKeys(item, ["role", "path", "content"], context, `receipt.producer.model.files[${index}]`);
    exact(item.role, PINNED_MODEL_FILES[index].role, context, `receipt.producer.model.files[${index}].role`);
    pinnedContent(
      { path: item.path, content: item.content },
      PINNED_MODEL_FILES[index],
      context,
      `receipt.producer.model.files[${index}]`,
    );
  });

  const runtime = record(producer.runtime, context, "receipt.producer.runtime");
  exactKeys(runtime, ["id", "version", "revision", "license", "package", "engine", "platform"], context, "receipt.producer.runtime");
  exact(runtime.id, "@huggingface/transformers", context, "receipt.producer.runtime.id");
  exact(runtime.version, "4.2.0", context, "receipt.producer.runtime.version");
  exact(runtime.revision, "54652ba3366ccd1e3b64e689a96504309e6fb53b", context, "receipt.producer.runtime.revision");
  exact(runtime.license, "Apache-2.0", context, "receipt.producer.runtime.license");
  const runtimePackage = record(runtime.package, context, "receipt.producer.runtime.package");
  exactKeys(runtimePackage, ["manifest", "entry", "license"], context, "receipt.producer.runtime.package");
  for (const key of ["manifest", "entry", "license"] as const) {
    pinnedContent(runtimePackage[key], PINNED_RUNTIME_FILES[key], context, `receipt.producer.runtime.package.${key}`);
  }
  const engine = record(runtime.engine, context, "receipt.producer.runtime.engine");
  exactKeys(
    engine,
    [
      "id",
      "version",
      "execution_provider",
      "execution_mode",
      "graph_optimization_level",
      "intra_op_threads",
      "inter_op_threads",
      "binary",
    ],
    context,
    "receipt.producer.runtime.engine",
  );
  exact(engine.id, "onnxruntime-node", context, "receipt.producer.runtime.engine.id");
  exact(engine.version, "1.24.3", context, "receipt.producer.runtime.engine.version");
  exact(engine.execution_provider, "cpu", context, "receipt.producer.runtime.engine.execution_provider");
  exact(engine.execution_mode, "sequential", context, "receipt.producer.runtime.engine.execution_mode");
  exact(engine.graph_optimization_level, "all", context, "receipt.producer.runtime.engine.graph_optimization_level");
  exactNumber(engine.intra_op_threads, 1, context, "receipt.producer.runtime.engine.intra_op_threads");
  exactNumber(engine.inter_op_threads, 1, context, "receipt.producer.runtime.engine.inter_op_threads");
  const platform = record(runtime.platform, context, "receipt.producer.runtime.platform");
  exactKeys(platform, ["os", "arch", "node"], context, "receipt.producer.runtime.platform");
  const platformOs = text(platform.os, context, "receipt.producer.runtime.platform.os");
  const platformArch = text(platform.arch, context, "receipt.producer.runtime.platform.arch");
  text(platform.node, context, "receipt.producer.runtime.platform.node");
  const engineBinary = record(engine.binary, context, "receipt.producer.runtime.engine.binary");
  exactKeys(engineBinary, ["path", "content"], context, "receipt.producer.runtime.engine.binary");
  exact(
    relativePath(engineBinary.path, context, "receipt.producer.runtime.engine.binary.path"),
    `node_modules/@huggingface/transformers/node_modules/onnxruntime-node/bin/napi-v6/${platformOs}/${platformArch}/onnxruntime_binding.node`,
    context,
    "receipt.producer.runtime.engine.binary.path",
  );
  content(engineBinary.content, context, "receipt.producer.runtime.engine.binary.content");

  exact(receipt.run, speechActivity.run, context, "receipt.run");
  if (mediaProbe.run !== speechActivity.run) fail(context, "mediaProbe.run", "does not match the speech receipt");
  if (
    mediaProbe.schema !== "studio.media-probe.v1" ||
    mediaProbe.producer !== binding.mediaProbe.producer ||
    mediaProbe.media !== binding.raw.path ||
    mediaProbe.input.content_id !== binding.raw.contentId ||
    mediaProbe.input.bytes !== binding.raw.bytes
  ) {
    fail(context, "mediaProbe", "does not match the receipted raw media");
  }
  if (
    speechActivity.input.content_id !== binding.raw.contentId ||
    speechActivity.input.media !== binding.raw.path ||
    speechActivity.input.bytes !== binding.raw.bytes
  ) {
    fail(context, "speechActivity.input", "does not match the receipted raw media");
  }
  const input = record(receipt.input, context, "receipt.input");
  exactKeys(input, ["speech_activity", "normalized_audio", "sample_rate_hz", "sample_count"], context, "receipt.input");
  const speechInput = record(input.speech_activity, context, "receipt.input.speech_activity");
  exactKeys(speechInput, ["path", "content"], context, "receipt.input.speech_activity");
  exact(speechInput.path, "speech-activity.json", context, "receipt.input.speech_activity.path");
  content(speechInput.content, context, "receipt.input.speech_activity.content");
  const audioInput = record(input.normalized_audio, context, "receipt.input.normalized_audio");
  exactKeys(audioInput, ["path", "content"], context, "receipt.input.normalized_audio");
  exact(audioInput.path, speechActivity.normalization.artifact.path, context, "receipt.input.normalized_audio.path");
  const audioContent = content(audioInput.content, context, "receipt.input.normalized_audio.content");
  const speechAudio = speechActivity.normalization.artifact.content;
  if (audioContent.id !== speechAudio.id || audioContent.bytes !== speechAudio.bytes) {
    fail(context, "receipt.input.normalized_audio.content", "does not match the speech detector PCM");
  }
  exactNumber(input.sample_rate_hz, speechActivity.normalization.sample_rate_hz, context, "receipt.input.sample_rate_hz");
  exactNumber(input.sample_count, speechActivity.normalization.sample_count, context, "receipt.input.sample_count");

  const configuration = record(receipt.configuration, context, "receipt.configuration");
  exactKeys(
    configuration,
    ["max_chunk_samples", "min_chunk_samples", "min_probability", "min_margin", "rounding_digits", "tie_break", "window_source"],
    context,
    "receipt.configuration",
  );
  exactNumber(configuration.max_chunk_samples, MAX_CHUNK_SAMPLES, context, "receipt.configuration.max_chunk_samples");
  exactNumber(configuration.min_chunk_samples, MIN_CHUNK_SAMPLES, context, "receipt.configuration.min_chunk_samples");
  exactNumber(configuration.min_probability, MIN_PROBABILITY, context, "receipt.configuration.min_probability");
  exactNumber(configuration.min_margin, MIN_MARGIN, context, "receipt.configuration.min_margin");
  exactNumber(configuration.rounding_digits, ROUNDING_DIGITS, context, "receipt.configuration.rounding_digits");
  exact(configuration.tie_break, "lowest_token_id", context, "receipt.configuration.tie_break");
  exact(configuration.window_source, "speech_windows", context, "receipt.configuration.window_source");

  const languageEntries = list(receipt.languages, context, "receipt.languages");
  if (languageEntries.length !== PINNED_LANGUAGES.length) {
    fail(context, "receipt.languages", "must contain the exact ordered 99-language token set");
  }
  languageEntries.forEach((entry, index) => language(entry, PINNED_LANGUAGES[index], context, `receipt.languages[${index}]`));

  const expected = expectedRanges(speechActivity);
  const rangeEntries = list(receipt.ranges, context, "receipt.ranges");
  if (rangeEntries.length !== expected.length) {
    fail(context, "receipt.ranges", "must exactly partition every receipted speech window");
  }
  rangeEntries.forEach((entry, index) => {
    const path = `receipt.ranges[${index}]`;
    const item = record(entry, context, path);
    exactKeys(item, ["speech_window_index", "chunk_index", "start_sample", "end_sample", "scores", "decision"], context, path);
    const expectedRange = expected[index];
    for (const key of ["speech_window_index", "chunk_index", "start_sample", "end_sample"] as const) {
      const actual = nonNegativeInteger(item[key], context, `${path}.${key}`);
      if (actual !== expectedRange[key]) fail(context, `${path}.${key}`, `must equal ${expectedRange[key]}`);
    }
    const length = expectedRange.end_sample - expectedRange.start_sample;
    const scores = list(item.scores, context, `${path}.scores`);
    if (length < MIN_CHUNK_SAMPLES) {
      if (scores.length !== 0) fail(context, `${path}.scores`, "must be empty for a withheld short chunk");
      decision(
        item.decision,
        {
          status: "withheld",
          code: null,
          token_id: null,
          probability: null,
          margin: null,
          reason: "insufficient_samples",
        },
        context,
        `${path}.decision`,
      );
      return;
    }
    if (scores.length !== PINNED_LANGUAGES.length) {
      fail(context, `${path}.scores`, "must contain all 99 ordered language scores for a measured chunk");
    }
    const normalizedScores = scores.map((entryValue, scoreIndex) =>
      score(entryValue, PINNED_LANGUAGES[scoreIndex], context, `${path}.scores[${scoreIndex}]`),
    );
    assertSoftmaxProbabilities(normalizedScores, context, `${path}.scores`);
    const sum = normalizedScores.reduce((total, candidate) => total + candidate.probability, 0);
    if (Math.abs(sum - 1) > PROBABILITY_SUM_TOLERANCE) {
      fail(context, `${path}.scores`, "probabilities must sum to one within the rounding tolerance");
    }
    decision(item.decision, expectedDecision(normalizedScores), context, `${path}.decision`);
  });
}

export const LANGUAGE_MODEL_ROOT = MODEL_ROOT;
