import type { MediaProbeReceipt } from "../types";
import type { PreflightSourceBinding, SpeechActivityReceipt } from "./contracts";
import { assertSpeechActivityReceipt } from "./speechReceiptValidation";

const RAW_DIGEST = "a".repeat(64);
const RAW_ID = `sha256:${RAW_DIGEST}`;
const NORMALIZED_DIGEST = "b".repeat(64);
const MODEL_DIGEST = "7ed98ddbad84ccac4cd0aeb3099049280713df825c610a8ed34543318f1b2c49";

export const SPEECH_BINDING_POLICY_FIXTURE: PreflightSourceBinding = {
  receiptId: `owned-local:${RAW_DIGEST}`,
  receiptProducer: "scripts/ingest-owned-media.mjs",
  receiptPath: "source.json",
  raw: {
    path: "raw-fixture.mov",
    contentId: RAW_ID,
    bytes: 4096,
    producer: "scripts/ingest-owned-media.mjs",
  },
  mediaProbe: {
    path: "media-probe.json",
    contentId: `sha256:${"c".repeat(64)}`,
    producer: "scripts/probe-media.mjs",
  },
};

export const SPEECH_MEDIA_PROBE_POLICY_FIXTURE: MediaProbeReceipt = {
  schema: "studio.media-probe.v1",
  producer: "scripts/probe-media.mjs",
  run: "speech-fixture",
  media: "raw-fixture.mov",
  input: {
    content_id: RAW_ID,
    hash: { algorithm: "sha256", digest: RAW_DIGEST },
    bytes: 4096,
  },
  duration: 0.064,
  container: ["mov", "mp4"],
  container_long_name: "QuickTime / MOV",
  bit_rate: 1024,
  tracks: [{ index: 1, type: "audio", codec: "aac", duration: 0.064, sample_rate: 48_000, channels: 2 }],
};

export const SPEECH_RECEIPT_POLICY_FIXTURE: SpeechActivityReceipt = {
  schema: "studio.speech-activity.v1",
  producer: {
    id: "silero-vad",
    version: "6.2.1",
    implementation: "scripts/detect-speech.mjs",
    model: {
      revision: "7e30209a3e901f9842f81b225f3e93d8199902b1",
      path: "vendor/silero-vad/v6.2.1/silero_vad_16k_op15.onnx",
      license: "MIT",
      license_path: "vendor/silero-vad/v6.2.1/LICENSE",
      content: {
        id: `sha256:${MODEL_DIGEST}`,
        hash: { algorithm: "sha256", digest: MODEL_DIGEST },
        bytes: 1_289_603,
      },
    },
    runtime: {
      id: "onnxruntime-node",
      version: "1.27.0",
      execution_provider: "cpu",
      execution_mode: "sequential",
      intra_op_threads: 1,
      inter_op_threads: 1,
      binary: {
        path: "node_modules/onnxruntime-node/bin/napi-v6/darwin/arm64/onnxruntime_binding.node",
        content: {
          id: `sha256:${"d".repeat(64)}`,
          hash: { algorithm: "sha256", digest: "d".repeat(64) },
          bytes: 1024,
        },
      },
      platform: { os: "darwin", arch: "arm64", node: "v24.0.0" },
    },
  },
  run: "speech-fixture",
  input: { media: "raw-fixture.mov", content_id: RAW_ID, bytes: 4096, track_index: 1 },
  normalization: {
    producer: {
      id: "ffmpeg",
      version: "7.1.1",
      binary: {
        path: "/usr/bin/ffmpeg",
        content: {
          id: `sha256:${"e".repeat(64)}`,
          hash: { algorithm: "sha256", digest: "e".repeat(64) },
          bytes: 2048,
        },
      },
    },
    arguments: [
      "-nostdin",
      "-hide_banner",
      "-loglevel",
      "error",
      "-threads",
      "1",
      "-i",
      "<input>",
      "-map",
      "0:1",
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
    ],
    sample_rate_hz: 16_000,
    channels: 1,
    sample_format: "s16le",
    sample_count: 1024,
    artifact: {
      path: "speech-input.pcm",
      content: {
        id: `sha256:${NORMALIZED_DIGEST}`,
        hash: { algorithm: "sha256", digest: NORMALIZED_DIGEST },
        bytes: 2048,
      },
    },
  },
  configuration: {
    frame_samples: 512,
    threshold: 0.5,
    negative_threshold: 0.35,
    min_speech_duration_ms: 250,
    min_silence_duration_ms: 100,
    speech_pad_ms: 30,
  },
  frames: [
    { start_sample: 0, end_sample: 512, probability: 0.01 },
    { start_sample: 512, end_sample: 1024, probability: 0.02 },
  ],
  speech_windows: [],
  non_speech_windows: [{ start_sample: 0, end_sample: 1024 }],
  note: "Deterministic no-speech policy fixture.",
};

type MutableReceipt = Record<string, unknown> & SpeechActivityReceipt;

/** Prove the VAD receipt rejects malformed producer identity, execution, input, and range evidence. */
export function checkSpeechReceiptPolicies(): void {
  assertSpeechActivityReceipt(
    SPEECH_RECEIPT_POLICY_FIXTURE,
    SPEECH_BINDING_POLICY_FIXTURE,
    SPEECH_MEDIA_PROBE_POLICY_FIXTURE,
    "Speech receipt reference",
  );

  const cases: Array<{
    label: string;
    expected: string;
    mutate: (receipt: MutableReceipt, probe: MediaProbeReceipt) => void;
  }> = [
    {
      label: "unknown root key",
      expected: "receipt must contain exactly",
      mutate: (receipt) => {
        receipt.untrusted = true;
      },
    },
    {
      label: "missing root key",
      expected: "receipt must contain exactly",
      mutate: (receipt) => {
        delete (receipt as Record<string, unknown>).note;
      },
    },
    {
      label: "unknown nested key",
      expected: "receipt.producer.model must contain exactly",
      mutate: (receipt) => {
        (receipt.producer.model as Record<string, unknown>).confidence = 1;
      },
    },
    {
      label: "invalid producer",
      expected: "receipt.producer.id must equal silero-vad",
      mutate: (receipt) => {
        receipt.producer.id = "guessed-vad" as "silero-vad";
      },
    },
    {
      label: "invalid model revision",
      expected: "receipt.producer.model.revision must equal",
      mutate: (receipt) => {
        receipt.producer.model.revision = "main" as SpeechActivityReceipt["producer"]["model"]["revision"];
      },
    },
    {
      label: "invalid model hash",
      expected: "receipt.producer.model.content.hash.digest must equal",
      mutate: (receipt) => {
        const digest = "f".repeat(64);
        receipt.producer.model.content.id = `sha256:${digest}`;
        receipt.producer.model.content.hash.digest = digest;
      },
    },
    {
      label: "invalid model license",
      expected: "receipt.producer.model.license must equal MIT",
      mutate: (receipt) => {
        receipt.producer.model.license = "unknown" as "MIT";
      },
    },
    {
      label: "invalid model byte count",
      expected: "receipt.producer.model.content.bytes must equal 1289603",
      mutate: (receipt) => {
        receipt.producer.model.content.bytes += 1;
      },
    },
    {
      label: "invalid runtime version",
      expected: "receipt.producer.runtime.version must equal 1.27.0",
      mutate: (receipt) => {
        receipt.producer.runtime.version = "latest" as "1.27.0";
      },
    },
    {
      label: "runtime parallelism",
      expected: "receipt.producer.runtime.intra_op_threads must equal 1",
      mutate: (receipt) => {
        receipt.producer.runtime.intra_op_threads = 2 as 1;
      },
    },
    {
      label: "runtime binary hash mismatch",
      expected: "receipt.producer.runtime.binary.content.id does not match its digest",
      mutate: (receipt) => {
        receipt.producer.runtime.binary.content.id = `sha256:${"f".repeat(64)}`;
      },
    },
    {
      label: "runtime binary outside package",
      expected: "receipt.producer.runtime.binary.path must be inside the pinned onnxruntime-node package",
      mutate: (receipt) => {
        receipt.producer.runtime.binary.path = "runtime.node";
      },
    },
    {
      label: "raw content mismatch",
      expected: "receipt.input.content_id must equal",
      mutate: (receipt) => {
        receipt.input.content_id = `sha256:${"f".repeat(64)}`;
      },
    },
    {
      label: "unknown track",
      expected: "receipt.input.track_index must reference exactly one audio track",
      mutate: (receipt) => {
        receipt.input.track_index = 9;
      },
    },
    {
      label: "fixed normalization arguments",
      expected: "receipt.normalization.arguments must equal the fixed path-redacted ffmpeg arguments",
      mutate: (receipt) => {
        receipt.normalization.arguments[5] = "8";
      },
    },
    {
      label: "relative ffmpeg binary",
      expected: "receipt.normalization.producer.binary.path must identify the absolute executed binary",
      mutate: (receipt) => {
        receipt.normalization.producer.binary.path = "ffmpeg";
      },
    },
    {
      label: "normalization path traversal",
      expected: "receipt.normalization.artifact.path must be a relative path without traversal",
      mutate: (receipt) => {
        receipt.normalization.artifact.path = "../speech-input.pcm";
      },
    },
    {
      label: "normalization extension",
      expected: "receipt.normalization.artifact.path must equal speech-input.pcm",
      mutate: (receipt) => {
        receipt.normalization.artifact.path = "speech-input.wav";
      },
    },
    {
      label: "normalization duration",
      expected: "receipt.normalization.sample_count does not match the probed duration within 150ms",
      mutate: (receipt) => {
        receipt.normalization.sample_count = 16_000;
      },
    },
    {
      label: "normalization byte count",
      expected: "receipt.normalization.artifact.content.bytes must equal sample_count * 2",
      mutate: (receipt) => {
        receipt.normalization.artifact.content.bytes = 2047;
      },
    },
    {
      label: "frame gap",
      expected: "receipt.frames[1].start_sample must continue the exact frame partition",
      mutate: (receipt) => {
        receipt.frames[1].start_sample = 513;
      },
    },
    {
      label: "extra frame",
      expected: "receipt.frames must contain exactly one entry for every normalized frame",
      mutate: (receipt) => {
        receipt.frames.push({ start_sample: 1024, end_sample: 1024, probability: 0 });
      },
    },
    {
      label: "frame end",
      expected: "receipt.frames[0].end_sample must equal 512",
      mutate: (receipt) => {
        receipt.frames[0].end_sample = 511;
      },
    },
    {
      label: "invalid probability",
      expected: "receipt.frames[0].probability must be a finite probability",
      mutate: (receipt) => {
        receipt.frames[0].probability = 1.1;
      },
    },
    {
      label: "window overlap",
      expected: "must be an exact non-overlapping complement partition",
      mutate: (receipt) => {
        receipt.speech_windows = [{ start_sample: 0, end_sample: 600 }];
        receipt.non_speech_windows = [{ start_sample: 500, end_sample: 1024 }];
      },
    },
    {
      label: "window gap",
      expected: "must be an exact non-overlapping complement partition",
      mutate: (receipt) => {
        receipt.speech_windows = [{ start_sample: 0, end_sample: 500 }];
        receipt.non_speech_windows = [{ start_sample: 501, end_sample: 1024 }];
      },
    },
    {
      label: "windows not derived from probabilities",
      expected: "receipt.speech_windows do not derive exactly from the receipted frame probabilities",
      mutate: (receipt) => {
        receipt.speech_windows = [{ start_sample: 0, end_sample: 512 }];
        receipt.non_speech_windows = [{ start_sample: 512, end_sample: 1024 }];
      },
    },
    {
      label: "window bounds",
      expected: "must not exceed normalization.sample_count",
      mutate: (receipt) => {
        receipt.non_speech_windows[0].end_sample = 1025;
      },
    },
    {
      label: "window order",
      expected: "must be ordered and non-overlapping",
      mutate: (receipt) => {
        receipt.non_speech_windows = [
          { start_sample: 512, end_sample: 1024 },
          { start_sample: 0, end_sample: 512 },
        ];
      },
    },
    {
      label: "non-canonical adjacent windows",
      expected: "must use maximal alternating intervals",
      mutate: (receipt) => {
        receipt.non_speech_windows = [
          { start_sample: 0, end_sample: 512 },
          { start_sample: 512, end_sample: 1024 },
        ];
      },
    },
    {
      label: "probe duration mismatch",
      expected: "receipt.normalization.sample_count does not match the probed duration within 150ms",
      mutate: (_receipt, probe) => {
        probe.duration = 1;
      },
    },
  ];

  for (const test of cases) {
    const receipt = structuredClone(SPEECH_RECEIPT_POLICY_FIXTURE) as MutableReceipt;
    const probe = structuredClone(SPEECH_MEDIA_PROBE_POLICY_FIXTURE);
    test.mutate(receipt, probe);
    let message: string | null = null;
    try {
      assertSpeechActivityReceipt(receipt, SPEECH_BINDING_POLICY_FIXTURE, probe, `Speech receipt ${test.label}`);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    if (!message?.includes(test.expected)) {
      throw new Error(`Speech receipt ${test.label}: expected ${test.expected}, received ${message ?? "acceptance"}`);
    }
  }
}
