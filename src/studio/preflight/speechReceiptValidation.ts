import type { MediaProbeReceipt } from "../types";
import type {
  PreflightSourceBinding,
  Sha256Content,
  SpeechActivityReceipt,
} from "./contracts";

const SHA256 = /^[a-f0-9]{64}$/;
const MODEL_DIGEST = "7ed98ddbad84ccac4cd0aeb3099049280713df825c610a8ed34543318f1b2c49";
const MODEL_REVISION = "7e30209a3e901f9842f81b225f3e93d8199902b1";
const MODEL_PATH = "vendor/silero-vad/v6.2.1/silero_vad_16k_op15.onnx";
const LICENSE_PATH = "vendor/silero-vad/v6.2.1/LICENSE";
const MODEL_BYTES = 1_289_603;
const SAMPLE_RATE = 16_000;
const FRAME_SAMPLES = 512;
const DURATION_TOLERANCE_SECONDS = 0.15;

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

function probability(value: unknown, context: string, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    fail(context, path, "must be a finite probability from 0 through 1");
  }
  return value;
}

function relativePath(value: unknown, context: string, path: string): string {
  const candidate = text(value, context, path);
  if (candidate.startsWith("/") || candidate.startsWith("\\") || candidate.split(/[\\/]/).includes("..")) {
    fail(context, path, "must be a relative path without traversal");
  }
  return candidate;
}

function packageRelativePath(value: unknown, context: string, path: string): string {
  const candidate = relativePath(value, context, path);
  if (!candidate.startsWith("node_modules/onnxruntime-node/")) {
    fail(context, path, "must be inside the pinned onnxruntime-node package");
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

function ranges(
  value: unknown,
  sampleCount: number,
  context: string,
  path: string,
): Array<{ start: number; end: number; kind: "speech" | "non_speech" }> {
  const kind = path === "receipt.speech_windows" ? "speech" : "non_speech";
  let previousEnd = -1;
  return list(value, context, path).map((entry, index) => {
    const itemPath = `${path}[${index}]`;
    const item = record(entry, context, itemPath);
    exactKeys(item, ["start_sample", "end_sample"], context, itemPath);
    const start = nonNegativeInteger(item.start_sample, context, `${itemPath}.start_sample`);
    const end = positiveInteger(item.end_sample, context, `${itemPath}.end_sample`);
    if (end <= start) fail(context, itemPath, "must have a positive sample range");
    if (end > sampleCount) fail(context, `${itemPath}.end_sample`, "must not exceed normalization.sample_count");
    if (start < previousEnd) fail(context, itemPath, "must be ordered and non-overlapping");
    previousEnd = end;
    return { start, end, kind };
  });
}

function validatePartition(
  speech: Array<{ start: number; end: number; kind: "speech" | "non_speech" }>,
  nonSpeech: Array<{ start: number; end: number; kind: "speech" | "non_speech" }>,
  sampleCount: number,
  context: string,
): void {
  const combined = [...speech, ...nonSpeech].sort((left, right) => left.start - right.start || left.end - right.end);
  if (combined.length === 0) fail(context, "receipt.speech_windows", "and non_speech_windows must partition the input");
  let cursor = 0;
  for (let index = 0; index < combined.length; index += 1) {
    const range = combined[index];
    if (range.start !== cursor) {
      fail(context, "receipt.speech_windows", "and non_speech_windows must be an exact non-overlapping complement partition");
    }
    if (index > 0 && combined[index - 1].kind === range.kind) {
      fail(context, "receipt.speech_windows", "and non_speech_windows must use maximal alternating intervals");
    }
    cursor = range.end;
  }
  if (cursor !== sampleCount) {
    fail(context, "receipt.speech_windows", "and non_speech_windows must cover normalization.sample_count exactly");
  }
}

function deriveWindows(
  frames: SpeechActivityReceipt["frames"],
  sampleCount: number,
): Pick<SpeechActivityReceipt, "speech_windows" | "non_speech_windows"> {
  const minSpeechSamples = SAMPLE_RATE * 250 / 1000;
  const minSilenceSamples = SAMPLE_RATE * 100 / 1000;
  const speechPadSamples = SAMPLE_RATE * 30 / 1000;
  let triggered = false;
  let tempEnd = 0;
  let currentStart = 0;
  const unpadded: SpeechActivityReceipt["speech_windows"] = [];
  for (const frame of frames) {
    const currentSample = frame.start_sample;
    if (frame.probability >= 0.5 && tempEnd) tempEnd = 0;
    if (frame.probability >= 0.5 && !triggered) {
      triggered = true;
      currentStart = currentSample;
      continue;
    }
    if (frame.probability < 0.35 && triggered) {
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

  const speechWindows = unpadded.map((window) => ({ ...window }));
  for (let index = 0; index < speechWindows.length; index += 1) {
    const window = speechWindows[index];
    if (index === 0) window.start_sample = Math.max(0, window.start_sample - speechPadSamples);
    if (index !== speechWindows.length - 1) {
      const silence = speechWindows[index + 1].start_sample - window.end_sample;
      if (silence < 2 * speechPadSamples) {
        window.end_sample += Math.floor(silence / 2);
        speechWindows[index + 1].start_sample = Math.max(
          0,
          speechWindows[index + 1].start_sample - Math.floor(silence / 2),
        );
      } else {
        window.end_sample = Math.min(sampleCount, window.end_sample + speechPadSamples);
        speechWindows[index + 1].start_sample = Math.max(
          0,
          speechWindows[index + 1].start_sample - speechPadSamples,
        );
      }
    } else {
      window.end_sample = Math.min(sampleCount, window.end_sample + speechPadSamples);
    }
  }
  const nonSpeechWindows: SpeechActivityReceipt["non_speech_windows"] = [];
  let cursor = 0;
  for (const window of speechWindows) {
    if (cursor < window.start_sample) nonSpeechWindows.push({ start_sample: cursor, end_sample: window.start_sample });
    cursor = window.end_sample;
  }
  if (cursor < sampleCount) nonSpeechWindows.push({ start_sample: cursor, end_sample: sampleCount });
  return { speech_windows: speechWindows, non_speech_windows: nonSpeechWindows };
}

/**
 * Validate the closed Silero VAD receipt against its provider-neutral source and ffprobe evidence.
 */
export function assertSpeechActivityReceipt(
  value: unknown,
  binding: PreflightSourceBinding,
  mediaProbe: MediaProbeReceipt,
  context = "Studio speech-activity receipt",
): asserts value is SpeechActivityReceipt {
  const receipt = record(value, context, "receipt");
  exactKeys(
    receipt,
    [
      "schema",
      "producer",
      "run",
      "input",
      "normalization",
      "configuration",
      "frames",
      "speech_windows",
      "non_speech_windows",
      "note",
    ],
    context,
    "receipt",
  );
  exact(receipt.schema, "studio.speech-activity.v1", context, "receipt.schema");
  text(receipt.note, context, "receipt.note");

  const producer = record(receipt.producer, context, "receipt.producer");
  exactKeys(producer, ["id", "version", "implementation", "model", "runtime"], context, "receipt.producer");
  exact(producer.id, "silero-vad", context, "receipt.producer.id");
  exact(producer.version, "6.2.1", context, "receipt.producer.version");
  exact(producer.implementation, "scripts/detect-speech.mjs", context, "receipt.producer.implementation");

  const model = record(producer.model, context, "receipt.producer.model");
  exactKeys(model, ["revision", "path", "license", "license_path", "content"], context, "receipt.producer.model");
  exact(model.revision, MODEL_REVISION, context, "receipt.producer.model.revision");
  exact(relativePath(model.path, context, "receipt.producer.model.path"), MODEL_PATH, context, "receipt.producer.model.path");
  exact(model.license, "MIT", context, "receipt.producer.model.license");
  exact(
    relativePath(model.license_path, context, "receipt.producer.model.license_path"),
    LICENSE_PATH,
    context,
    "receipt.producer.model.license_path",
  );
  const modelContent = content(model.content, context, "receipt.producer.model.content");
  if (modelContent.hash.digest !== MODEL_DIGEST) {
    fail(context, "receipt.producer.model.content.hash.digest", `must equal ${MODEL_DIGEST}`);
  }
  if (modelContent.bytes !== MODEL_BYTES) {
    fail(context, "receipt.producer.model.content.bytes", `must equal ${MODEL_BYTES}`);
  }

  const runtime = record(producer.runtime, context, "receipt.producer.runtime");
  exactKeys(
    runtime,
    [
      "id",
      "version",
      "execution_provider",
      "execution_mode",
      "intra_op_threads",
      "inter_op_threads",
      "binary",
      "platform",
    ],
    context,
    "receipt.producer.runtime",
  );
  exact(runtime.id, "onnxruntime-node", context, "receipt.producer.runtime.id");
  exact(runtime.version, "1.27.0", context, "receipt.producer.runtime.version");
  exact(runtime.execution_provider, "cpu", context, "receipt.producer.runtime.execution_provider");
  exact(runtime.execution_mode, "sequential", context, "receipt.producer.runtime.execution_mode");
  exactNumber(runtime.intra_op_threads, 1, context, "receipt.producer.runtime.intra_op_threads");
  exactNumber(runtime.inter_op_threads, 1, context, "receipt.producer.runtime.inter_op_threads");
  const runtimeBinary = record(runtime.binary, context, "receipt.producer.runtime.binary");
  exactKeys(runtimeBinary, ["path", "content"], context, "receipt.producer.runtime.binary");
  packageRelativePath(runtimeBinary.path, context, "receipt.producer.runtime.binary.path");
  content(runtimeBinary.content, context, "receipt.producer.runtime.binary.content");
  const platform = record(runtime.platform, context, "receipt.producer.runtime.platform");
  exactKeys(platform, ["os", "arch", "node"], context, "receipt.producer.runtime.platform");
  text(platform.os, context, "receipt.producer.runtime.platform.os");
  text(platform.arch, context, "receipt.producer.runtime.platform.arch");
  text(platform.node, context, "receipt.producer.runtime.platform.node");

  exact(receipt.run, mediaProbe.run, context, "receipt.run");
  const input = record(receipt.input, context, "receipt.input");
  exactKeys(input, ["media", "content_id", "bytes", "track_index"], context, "receipt.input");
  const media = relativePath(input.media, context, "receipt.input.media");
  if (media !== binding.raw.path || media !== mediaProbe.media) {
    fail(context, "receipt.input.media", "does not match the receipted raw media and media probe");
  }
  exact(input.content_id, binding.raw.contentId, context, "receipt.input.content_id");
  if (mediaProbe.input.content_id !== binding.raw.contentId) {
    fail(context, "mediaProbe.input.content_id", "does not match the receipted raw media");
  }
  const inputBytes = positiveInteger(input.bytes, context, "receipt.input.bytes");
  if (inputBytes !== binding.raw.bytes || mediaProbe.input.bytes !== binding.raw.bytes) {
    fail(context, "receipt.input.bytes", "does not match the receipted raw media and media probe");
  }
  const trackIndex = nonNegativeInteger(input.track_index, context, "receipt.input.track_index");
  const selectedTracks = mediaProbe.tracks.filter((track) => track.type === "audio" && track.index === trackIndex);
  if (selectedTracks.length !== 1) {
    fail(context, "receipt.input.track_index", "must reference exactly one audio track in the media probe");
  }

  const normalization = record(receipt.normalization, context, "receipt.normalization");
  exactKeys(
    normalization,
    ["producer", "arguments", "sample_rate_hz", "channels", "sample_format", "sample_count", "artifact"],
    context,
    "receipt.normalization",
  );
  const normalizationProducer = record(normalization.producer, context, "receipt.normalization.producer");
  exactKeys(normalizationProducer, ["id", "version", "binary"], context, "receipt.normalization.producer");
  exact(normalizationProducer.id, "ffmpeg", context, "receipt.normalization.producer.id");
  text(normalizationProducer.version, context, "receipt.normalization.producer.version");
  const ffmpegBinary = record(normalizationProducer.binary, context, "receipt.normalization.producer.binary");
  exactKeys(ffmpegBinary, ["path", "content"], context, "receipt.normalization.producer.binary");
  const ffmpegPath = text(ffmpegBinary.path, context, "receipt.normalization.producer.binary.path");
  if (!/^(?:\/|[A-Za-z]:[\\/])/.test(ffmpegPath)) {
    fail(context, "receipt.normalization.producer.binary.path", "must identify the absolute executed binary");
  }
  content(ffmpegBinary.content, context, "receipt.normalization.producer.binary.content");

  const expectedArguments = [
    "-nostdin",
    "-hide_banner",
    "-loglevel",
    "error",
    "-threads",
    "1",
    "-i",
    "<input>",
    "-map",
    `0:${trackIndex}`,
    "-vn",
    "-ac",
    "1",
    "-ar",
    "16000",
    "-sample_fmt",
    "s16",
    "-c:a",
    "pcm_s16le",
    "-f",
    "s16le",
    "<output>",
  ];
  const argumentsValue = list(normalization.arguments, context, "receipt.normalization.arguments");
  if (
    argumentsValue.length !== expectedArguments.length ||
    argumentsValue.some((argument, index) => argument !== expectedArguments[index])
  ) {
    fail(context, "receipt.normalization.arguments", "must equal the fixed path-redacted ffmpeg arguments");
  }
  exactNumber(normalization.sample_rate_hz, SAMPLE_RATE, context, "receipt.normalization.sample_rate_hz");
  exactNumber(normalization.channels, 1, context, "receipt.normalization.channels");
  exact(normalization.sample_format, "s16le", context, "receipt.normalization.sample_format");
  const sampleCount = positiveInteger(normalization.sample_count, context, "receipt.normalization.sample_count");
  const decodedDuration = sampleCount / SAMPLE_RATE;
  if (Math.abs(decodedDuration - mediaProbe.duration) > DURATION_TOLERANCE_SECONDS) {
    fail(context, "receipt.normalization.sample_count", "does not match the probed duration within 150ms");
  }
  const selectedDuration = selectedTracks[0].duration;
  if (selectedDuration !== undefined && Math.abs(decodedDuration - selectedDuration) > DURATION_TOLERANCE_SECONDS) {
    fail(context, "receipt.normalization.sample_count", "does not match the selected audio-track duration within 150ms");
  }
  const normalizedArtifact = record(normalization.artifact, context, "receipt.normalization.artifact");
  exactKeys(normalizedArtifact, ["path", "content"], context, "receipt.normalization.artifact");
  const normalizedPath = relativePath(normalizedArtifact.path, context, "receipt.normalization.artifact.path");
  exact(normalizedPath, "speech-input.pcm", context, "receipt.normalization.artifact.path");
  const normalizedContent = content(normalizedArtifact.content, context, "receipt.normalization.artifact.content");
  if (normalizedContent.bytes !== sampleCount * 2) {
    fail(context, "receipt.normalization.artifact.content.bytes", "must equal sample_count * 2 for mono s16le PCM");
  }

  const configuration = record(receipt.configuration, context, "receipt.configuration");
  exactKeys(
    configuration,
    [
      "frame_samples",
      "threshold",
      "negative_threshold",
      "min_speech_duration_ms",
      "min_silence_duration_ms",
      "speech_pad_ms",
    ],
    context,
    "receipt.configuration",
  );
  exactNumber(configuration.frame_samples, FRAME_SAMPLES, context, "receipt.configuration.frame_samples");
  exactNumber(configuration.threshold, 0.5, context, "receipt.configuration.threshold");
  exactNumber(configuration.negative_threshold, 0.35, context, "receipt.configuration.negative_threshold");
  exactNumber(configuration.min_speech_duration_ms, 250, context, "receipt.configuration.min_speech_duration_ms");
  exactNumber(configuration.min_silence_duration_ms, 100, context, "receipt.configuration.min_silence_duration_ms");
  exactNumber(configuration.speech_pad_ms, 30, context, "receipt.configuration.speech_pad_ms");

  const frames = list(receipt.frames, context, "receipt.frames");
  if (frames.length !== Math.ceil(sampleCount / FRAME_SAMPLES)) {
    fail(context, "receipt.frames", "must contain exactly one entry for every normalized frame");
  }
  let frameCursor = 0;
  frames.forEach((entry, index) => {
    const path = `receipt.frames[${index}]`;
    const frame = record(entry, context, path);
    exactKeys(frame, ["start_sample", "end_sample", "probability"], context, path);
    const start = nonNegativeInteger(frame.start_sample, context, `${path}.start_sample`);
    const end = positiveInteger(frame.end_sample, context, `${path}.end_sample`);
    if (end <= start) fail(context, path, "must have a positive sample range");
    if (start !== frameCursor) fail(context, `${path}.start_sample`, "must continue the exact frame partition");
    const expectedEnd = Math.min(start + FRAME_SAMPLES, sampleCount);
    if (end !== expectedEnd) fail(context, `${path}.end_sample`, `must equal ${expectedEnd}`);
    probability(frame.probability, context, `${path}.probability`);
    frameCursor = end;
  });
  if (frameCursor !== sampleCount) fail(context, "receipt.frames", "must cover normalization.sample_count exactly");

  const speech = ranges(receipt.speech_windows, sampleCount, context, "receipt.speech_windows");
  const nonSpeech = ranges(receipt.non_speech_windows, sampleCount, context, "receipt.non_speech_windows");
  validatePartition(speech, nonSpeech, sampleCount, context);
  const derived = deriveWindows(receipt.frames as SpeechActivityReceipt["frames"], sampleCount);
  if (JSON.stringify(receipt.speech_windows) !== JSON.stringify(derived.speech_windows)) {
    fail(context, "receipt.speech_windows", "do not derive exactly from the receipted frame probabilities");
  }
  if (JSON.stringify(receipt.non_speech_windows) !== JSON.stringify(derived.non_speech_windows)) {
    fail(context, "receipt.non_speech_windows", "are not the exact derived complement of speech_windows");
  }
}
