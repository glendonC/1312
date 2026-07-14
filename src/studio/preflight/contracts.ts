/**
 * Content-addressed preflight indexes, independent of a completed Studio run.
 *
 * V1 is an immutable source/probe-only contract. V2 adds one real speech-activity producer while
 * keeping language, acoustic, speaker/overlap, and complexity findings unavailable. Provider wire
 * fields remain in their source receipt; neither version permits them in the normalized bundle.
 */

export interface Sha256Content {
  id: string;
  hash: { algorithm: "sha256"; digest: string };
  bytes: number;
}

export type PreflightArtifactKindV1 = "raw_media" | "source_receipt" | "media_probe_receipt";
export type PreflightArtifactKindV2 =
  | PreflightArtifactKindV1
  | "detector_audio"
  | "speech_activity_receipt";
export type PreflightArtifactKind = PreflightArtifactKindV2;
export type PreflightArtifactClassV1 = "raw" | "receipt";
export type PreflightArtifactClassV2 = PreflightArtifactClassV1 | "derived";
export type PreflightArtifactClass = PreflightArtifactClassV2;

interface PreflightArtifactBase<
  Kind extends PreflightArtifactKind,
  ArtifactClass extends PreflightArtifactClass,
> {
  artifact_id: string;
  kind: Kind;
  class: ArtifactClass;
  path: string;
  content: Sha256Content;
  producer: string;
  source_content_ids: string[];
}

export type PreflightArtifactV1 =
  | PreflightArtifactBase<"raw_media", "raw">
  | PreflightArtifactBase<"source_receipt" | "media_probe_receipt", "receipt">;

export type PreflightArtifactV2 =
  | PreflightArtifactV1
  | PreflightArtifactBase<"detector_audio", "derived">
  | PreflightArtifactBase<"speech_activity_receipt", "receipt">;

export type PreflightArtifact = PreflightArtifactV2;

export interface PreflightFindingsV1 {
  container_tracks: string;
  speech_activity: null;
  language_ranges: null;
  acoustic_ranges: null;
  speaker_overlap: null;
  complexity: null;
}

export interface PreflightFindingsV2 {
  container_tracks: string;
  speech_activity: string;
  language_ranges: null;
  acoustic_ranges: null;
  speaker_overlap: null;
  complexity: null;
}

export type PreflightFindings = PreflightFindingsV1 | PreflightFindingsV2;

interface PreflightSourceReference {
  receipt_id: string;
  receipt_artifact_id: string;
  raw_artifact_id: string;
}

export interface PreflightBundleV1 {
  schema: "studio.preflight-bundle.v1";
  producer: "scripts/preflight-owned-media.mjs";
  preflight_id: string;
  source: PreflightSourceReference;
  artifacts: PreflightArtifactV1[];
  findings: PreflightFindingsV1;
  note: string;
}

export interface PreflightBundleV2 {
  schema: "studio.preflight-bundle.v2";
  producer: "scripts/seal-speech-preflight.mjs";
  preflight_id: string;
  source: PreflightSourceReference;
  artifacts: PreflightArtifactV2[];
  findings: PreflightFindingsV2;
  note: string;
}

export type PreflightBundle = PreflightBundleV1 | PreflightBundleV2;

export interface SpeechActivityReceipt {
  schema: "studio.speech-activity.v1";
  producer: {
    id: "silero-vad";
    version: "6.2.1";
    implementation: "scripts/detect-speech.mjs";
    model: {
      revision: "7e30209a3e901f9842f81b225f3e93d8199902b1";
      path: "vendor/silero-vad/v6.2.1/silero_vad_16k_op15.onnx";
      license: "MIT";
      license_path: "vendor/silero-vad/v6.2.1/LICENSE";
      content: Sha256Content;
    };
    runtime: {
      id: "onnxruntime-node";
      version: "1.27.0";
      execution_provider: "cpu";
      execution_mode: "sequential";
      intra_op_threads: 1;
      inter_op_threads: 1;
      binary: { path: string; content: Sha256Content };
      platform: { os: string; arch: string; node: string };
    };
  };
  run: string;
  input: {
    media: string;
    content_id: string;
    bytes: number;
    track_index: number;
  };
  normalization: {
    producer: {
      id: "ffmpeg";
      version: string;
      binary: { path: string; content: Sha256Content };
    };
    arguments: string[];
    sample_rate_hz: 16000;
    channels: 1;
    sample_format: "s16le";
    sample_count: number;
    artifact: { path: string; content: Sha256Content };
  };
  configuration: {
    frame_samples: 512;
    threshold: 0.5;
    negative_threshold: 0.35;
    min_speech_duration_ms: 250;
    min_silence_duration_ms: 100;
    speech_pad_ms: 30;
  };
  frames: Array<{ start_sample: number; end_sample: number; probability: number }>;
  speech_windows: Array<{ start_sample: number; end_sample: number }>;
  non_speech_windows: Array<{ start_sample: number; end_sample: number }>;
  note: string;
}

/** Provider-neutral facts supplied by a registered source adapter to bundle validation. */
export interface PreflightSourceBinding {
  receiptId: string;
  receiptProducer: string;
  receiptPath: string;
  raw: {
    path: string;
    contentId: string;
    bytes: number;
    producer: string;
  };
  mediaProbe: {
    path: string;
    contentId: string;
    producer: string;
  };
}
