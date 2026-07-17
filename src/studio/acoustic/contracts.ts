import type { Sha256Content } from "../preflight/contracts.ts";

export const ACOUSTIC_SAMPLE_RATE_HZ = 16_000 as const;
export const ACOUSTIC_PATCH_SAMPLES = 15_360 as const;

export const ACOUSTIC_LIMITS = {
  maxRangeMs: 120_000,
  maxDecodedSamples: 1_920_000,
  maxItems: 125,
  maxObservationBytes: 256 * 1024,
  maxReceiptBytes: 128 * 1024,
  maxWallMs: 60_000,
  maxToolCalls: 1,
} as const;

export const ACOUSTIC_CONFIGURATION = {
  logitsTransform: "sigmoid",
  speechClassIndexes: [...Array.from({ length: 13 }, (_, index) => index), 63, 65],
  musicClassIndexes: [...Array.from({ length: 9 }, (_, index) => index + 24), ...Array.from({ length: 145 }, (_, index) => index + 132)],
  strongThreshold: 0.55,
  supportThreshold: 0.35,
  marginThreshold: 0.15,
  minPatchSamples: 8_000,
  roundingDigits: 8,
  tieBreak: "class_order_speech_music_noise",
} as const;

export type AcousticClass = "speech_candidate" | "music" | "noise" | "mixed" | "unknown";
export type AcousticEvidenceStatus = "complete" | "unavailable" | "truncated" | "failed";

export interface AcousticObservation {
  index: number;
  startSample: number;
  endSample: number;
  startMs: number;
  endMs: number;
  classification: AcousticClass;
  confidence: {
    speechCandidate: number;
    music: number;
    noise: number;
    winningScore: number;
    margin: number;
  };
  certainty: "strong" | "weak";
  reason: "strong_single_family" | "supported_speech_and_music" | "below_threshold_or_margin" | "insufficient_samples";
}

export interface AcousticObservations {
  schema: "studio.acoustic-observations.v1";
  source: { contentId: string; bytes: number; trackIndex: number };
  normalization: {
    content: Sha256Content;
    sampleRateHz: 16000;
    channels: 1;
    sampleFormat: "s16le";
    sampleCount: number;
  };
  requestedRange: { startMs: number; endMs: number; startSample: number; endSample: number };
  returnedRange: { startMs: number; endMs: number; startSample: number; endSample: number };
  status: AcousticEvidenceStatus;
  observations: AcousticObservation[];
}

export interface AcousticTriageReceipt {
  schema: "studio.acoustic-triage.receipt.v1";
  receiptId: string;
  run: string;
  input: {
    media: { path: string; content: Sha256Content; trackIndex: number };
    normalizedAudio: { path: "speech-input.pcm"; content: Sha256Content; sampleCount: number };
    speechActivity: { path: "speech-activity.json"; content: Sha256Content };
    requestedRange: { startMs: number; endMs: number; startSample: number; endSample: number };
  };
  producer: {
    id: "yamnet-acoustic-triage";
    version: "1.0.0";
    implementation: "scripts/detect-acoustics.mjs";
    model: {
      id: "qualcomm/YamNet";
      revision: "v0.58.0";
      upstream: "w-hc/torch_audioset@e8852c5";
      license: "MIT";
      files: Array<{ path: string; content: Sha256Content }>;
    };
    runtime: {
      id: "onnxruntime-node";
      version: "1.27.0";
      executionProvider: "cpu";
      executionMode: "sequential";
      intraOpThreads: 1;
      interOpThreads: 1;
      binary: { path: string; content: Sha256Content };
      platform: { os: string; arch: string; node: string };
    };
  };
  normalization: {
    contract: "sealed_speech_pcm_v1";
    sampleRateHz: 16000;
    channels: 1;
    sampleFormat: "s16le";
    amplitudeScale: "int16_div_32768";
    featureExtraction: "yamnet_vggish_log_mel_v1";
    windowSamples: 400;
    hopSamples: 160;
    fftSamples: 512;
    melBands: 64;
    melMinHz: 125;
    melMaxHz: 7500;
    logOffset: 0.001;
    patchSamples: 15360;
    patchFrames: 96;
    finalPatch: "right_zero_pad_and_mark_weak_below_min_samples";
  };
  configuration: {
    logitsTransform: "sigmoid";
    speechClassIndexes: number[];
    musicClassIndexes: number[];
    strongThreshold: number;
    supportThreshold: number;
    marginThreshold: number;
    minPatchSamples: number;
    roundingDigits: number;
    tieBreak: "class_order_speech_music_noise";
  };
  limits: typeof ACOUSTIC_LIMITS;
  execution: { startedAt: string; completedAt: string; wallMs: number; toolCalls: 1; decodedSamples: number };
  output: {
    path: "acoustic-observations.json";
    content: Sha256Content;
    status: AcousticEvidenceStatus;
    itemCount: number;
    requestedRange: AcousticObservations["requestedRange"];
    returnedRange: AcousticObservations["returnedRange"];
  };
  determinism: {
    equalityScope: "exact_receipted_model_runtime_platform_configuration_and_input";
    crossPlatformNumericalEquality: "not_claimed";
  };
  nonClaims: {
    semanticUnderstanding: "not_assessed";
    speechDetectionCompleteness: "not_claimed";
    lyricsUnderstanding: "not_assessed";
    calibration: "not_established";
  };
}
