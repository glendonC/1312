import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";

import { identifyFile } from "../artifactStore.ts";
import type { SpeakerOverlapProducerLineage, SpeakerRuntimeFileIdentity } from "../model.ts";
import {
  SpeakerDiarizerFailure,
  type SpeakerDiarizer,
  type SpeakerDiarizerInput,
  type SpeakerDiarizerResult,
} from "./diarizer.ts";

const require = createRequire(import.meta.url);
const DEFAULT_MODEL_DIRECTORY = fileURLToPath(new URL(
  "../../../../../vendor/speaker-diarization/sherpa-onnx-pyannote-3d-speaker-2024-10/",
  import.meta.url,
));
const WRAPPER_FILES = [
  "sherpa-onnx.js",
  "non-streaming-speaker-diarization.js",
  "addon.js",
] as const;
const DARWIN_ARM64_RUNTIME_FILES = [
  "index.js",
  "sherpa-onnx.node",
  "libsherpa-onnx-c-api.dylib",
  "libsherpa-onnx-cxx-api.dylib",
  "libonnxruntime.dylib",
] as const;

interface SherpaDiarizationHandle {
  sampleRate: number;
  process(samples: Float32Array): Array<{ start: number; end: number; speaker: number }>;
}

interface SherpaPackage {
  OfflineSpeakerDiarization: new (config: unknown) => SherpaDiarizationHandle;
  version: string;
  gitSha1: string;
}

async function runtimeFiles(): Promise<SpeakerRuntimeFileIdentity[]> {
  if (process.platform !== "darwin" || process.arch !== "arm64") {
    throw new SpeakerDiarizerFailure("model_unavailable", "Pinned U6 native runtime is available only for darwin-arm64 in this slice");
  }
  const wrapperRoot = dirname(require.resolve("sherpa-onnx-node"));
  const platformRoot = dirname(require.resolve("sherpa-onnx-darwin-arm64"));
  return Promise.all([
    ...WRAPPER_FILES.map(async (file) => ({ name: `sherpa-onnx-node/${file}`, content: await identifyFile(join(wrapperRoot, file)) })),
    ...DARWIN_ARM64_RUNTIME_FILES.map(async (file) => ({ name: `sherpa-onnx-darwin-arm64/${file}`, content: await identifyFile(join(platformRoot, file)) })),
  ]);
}

function assertBeforeDeadline(deadlineAtMs: number): void {
  if (performance.now() >= deadlineAtMs) throw new SpeakerDiarizerFailure("diarizer_timeout", "Speaker diarization exceeded its wall-time grant");
}

function normalizedFloat32(pcm16: Buffer): Float32Array {
  if (pcm16.byteLength % 2 !== 0) throw new SpeakerDiarizerFailure("diarizer_failed", "Normalized PCM has an incomplete int16 sample");
  const result = new Float32Array(pcm16.byteLength / 2);
  for (let index = 0; index < result.length; index += 1) result[index] = pcm16.readInt16LE(index * 2) / 32_768;
  return result;
}

export class SherpaOnnxSpeakerDiarizer implements SpeakerDiarizer {
  private readonly modelDirectory: string;

  constructor(options: { modelDirectory?: string } = {}) {
    this.modelDirectory = options.modelDirectory ?? DEFAULT_MODEL_DIRECTORY;
  }

  async currentLineage(deadlineAtMs: number): Promise<SpeakerOverlapProducerLineage> {
    assertBeforeDeadline(deadlineAtMs);
    try {
      const [files, segmentation, embedding] = await Promise.all([
        runtimeFiles(),
        identifyFile(join(this.modelDirectory, "segmentation.onnx")),
        identifyFile(join(this.modelDirectory, "embedding.onnx")),
      ]);
      assertBeforeDeadline(deadlineAtMs);
      return {
        schema: "studio.speaker-overlap-producer-lineage.v1",
        adapter: { id: "sherpa-onnx-anonymous-speaker-overlap", version: "1" },
        runtime: {
          package: {
            name: "sherpa-onnx-node",
            version: "1.13.4",
            gitRevision: "142807252687d81b40d6315f23470a1512a00de3",
            license: "Apache-2.0",
            files,
          },
          node: { version: process.version, platform: process.platform, arch: process.arch },
          execution: { engine: "native_node_addon", provider: "cpu", threads: 1, network: "disabled" },
        },
        models: {
          segmentation: {
            id: "pyannote/segmentation-3.0",
            format: "onnx",
            source: "k2-fsa/sherpa-onnx:speaker-segmentation-models",
            releaseDate: "2024-10-08",
            license: "MIT",
            content: segmentation,
          },
          embedding: {
            id: "3D-Speaker/ERes2Net-base-16k",
            format: "onnx",
            source: "k2-fsa/sherpa-onnx:speaker-recongition-models",
            releaseDate: "2024-10-14",
            license: "Apache-2.0",
            content: embedding,
          },
        },
        configuration: {
          sampleRateHz: 16_000,
          channels: 1,
          sampleFormat: "f32le_normalized_from_s16le",
          numClusters: -1,
          clusteringThreshold: 0.5,
          minDurationOnSeconds: 0.3,
          minDurationOffSeconds: 0.5,
          timing: "integer_millisecond_half_open_absolute_source",
          speakerLabels: "first_appearance_anon_cluster_index",
          uncertainty: "model_scores_unavailable_boundary_policy_v1",
        },
      };
    } catch (cause) {
      if (cause instanceof SpeakerDiarizerFailure) throw cause;
      throw new SpeakerDiarizerFailure("model_unavailable", "Pinned speaker-diarization runtime or model files are unavailable", { cause });
    }
  }

  async diarize(input: SpeakerDiarizerInput, deadlineAtMs: number): Promise<SpeakerDiarizerResult> {
    const lineage = await this.currentLineage(deadlineAtMs);
    let handle: SherpaDiarizationHandle | null = null;
    try {
      assertBeforeDeadline(deadlineAtMs);
      const sherpa = require("sherpa-onnx-node") as SherpaPackage;
      if (sherpa.version !== "1.13.4" || sherpa.gitSha1 !== lineage.runtime.package.gitRevision.slice(0, 8)) {
        throw new SpeakerDiarizerFailure("model_unavailable", "Pinned sherpa-onnx package identity drifted");
      }
      handle = new sherpa.OfflineSpeakerDiarization({
        segmentation: {
          pyannote: { model: join(this.modelDirectory, "segmentation.onnx") },
          numThreads: 1,
          debug: 0,
          provider: "cpu",
        },
        embedding: {
          model: join(this.modelDirectory, "embedding.onnx"),
          numThreads: 1,
          debug: 0,
          provider: "cpu",
        },
        clustering: { numClusters: -1, threshold: 0.5 },
        minDurationOn: 0.3,
        minDurationOff: 0.5,
      });
      if (handle.sampleRate !== input.sampleRateHz) throw new SpeakerDiarizerFailure("diarizer_failed", "Pinned diarizer sample rate changed");
      const raw = handle.process(normalizedFloat32(input.pcm16));
      assertBeforeDeadline(deadlineAtMs);
      const segments = raw.map((segment) => {
        if (!Number.isFinite(segment.start) || !Number.isFinite(segment.end) || !Number.isSafeInteger(segment.speaker) || segment.speaker < 0) {
          throw new SpeakerDiarizerFailure("diarizer_failed", "Pinned diarizer returned an invalid segment");
        }
        return {
          startMs: Math.round(segment.start * 1_000),
          endMs: Math.round(segment.end * 1_000),
          speakerCluster: segment.speaker,
        };
      });
      return { lineage, segments };
    } catch (cause) {
      if (cause instanceof SpeakerDiarizerFailure) throw cause;
      throw new SpeakerDiarizerFailure("diarizer_failed", "Pinned local speaker diarization failed", { cause });
    } finally {
      handle = null;
    }
  }
}
