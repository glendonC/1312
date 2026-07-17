import { execFile } from "node:child_process";
import { access, realpath } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import { identifyFile } from "../artifactStore.ts";
import { SEPARATION_METHOD, type SeparationProducerLineage, type SeparationRuntimeFileIdentity } from "../model.ts";
import { validateSeparationProducerLineage } from "../validation/separation.ts";
import { SourceSeparatorFailure, type SourceSeparationResult, type SourceSeparator } from "./separator.ts";

const MODEL_FILES = ["hyperparams.yaml", "encoder.ckpt", "decoder.ckpt", "masknet.ckpt"] as const;
const MODEL_IDS = new Map(MODEL_FILES.map((name, index) => [name, SEPARATION_METHOD.modelContentIds[index]]));

interface RuntimeDescription {
  python: { version: string; platform: string; arch: string };
  packages: { speechbrain: string; torch: string; torchaudio: string };
  runtimeFiles: Array<{ name: string; path: string }>;
}

function executeJson(file: string, args: readonly string[], timeoutMs: number, env: NodeJS.ProcessEnv): Promise<unknown> {
  return new Promise((resolvePromise, reject) => {
    execFile(file, [...args], { timeout: timeoutMs, maxBuffer: 1024 * 1024, windowsHide: true, env }, (error, stdout) => {
      if (error) return reject(error);
      try { resolvePromise(JSON.parse(stdout)); }
      catch (cause) { reject(new Error("Separation runtime returned malformed JSON", { cause })); }
    });
  });
}

export class SpeechbrainSepformerSeparator implements SourceSeparator {
  private readonly python: string;
  private readonly modelDirectory: string;
  private readonly runner: string;
  private readonly sandbox: string | null;

  constructor(options: { python?: string; modelDirectory?: string; runner?: string; sandbox?: string | null } = {}) {
    const localRoot = resolve(".studio", "separation-runtime");
    this.python = resolve(options.python ?? join(localRoot, "venv", "bin", "python"));
    this.modelDirectory = resolve(options.modelDirectory ?? join(localRoot, "model"));
    this.runner = resolve(options.runner ?? join(dirname(new URL(import.meta.url).pathname), "speechbrain_sepformer_runner.py"));
    this.sandbox = options.sandbox === undefined && process.platform === "darwin" ? "/usr/bin/sandbox-exec" : options.sandbox ?? null;
  }

  private environment(): NodeJS.ProcessEnv {
    return {
      ...process.env,
      HF_HUB_OFFLINE: "1",
      HF_DATASETS_OFFLINE: "1",
      TRANSFORMERS_OFFLINE: "1",
      HF_HUB_DISABLE_TELEMETRY: "1",
      OMP_NUM_THREADS: "1",
      MKL_NUM_THREADS: "1",
      VECLIB_MAXIMUM_THREADS: "1",
      NUMEXPR_NUM_THREADS: "1",
      PYTHONNOUSERSITE: "1",
    };
  }

  private command(args: readonly string[]): { file: string; args: string[] } {
    if (!this.sandbox) return { file: this.python, args: [this.runner, ...args] };
    return {
      file: this.sandbox,
      args: ["-p", "(version 1) (allow default) (deny network*)", this.python, this.runner, ...args],
    };
  }

  private async modelFiles(): Promise<SeparationRuntimeFileIdentity[]> {
    const files: SeparationRuntimeFileIdentity[] = [];
    for (const name of MODEL_FILES) {
      const path = join(this.modelDirectory, name);
      const content = await identifyFile(path).catch((cause) => {
        throw new SourceSeparatorFailure("model_unavailable", `Pinned separation model file ${name} is unavailable`, { cause });
      });
      if (content.contentId !== MODEL_IDS.get(name)) {
        throw new SourceSeparatorFailure("runtime_drift", `Pinned separation model file ${name} changed content identity`);
      }
      files.push({ name, content });
    }
    return files;
  }

  async currentLineage(deadlineAtMs: number): Promise<SeparationProducerLineage> {
    await Promise.all([access(this.python), access(this.runner), this.sandbox ? access(this.sandbox) : Promise.resolve()]).catch((cause) => {
      throw new SourceSeparatorFailure("model_unavailable", "Pinned separation Python runtime is unavailable", { cause });
    });
    const modelFiles = await this.modelFiles();
    const remainingMs = Math.max(1, Math.floor(deadlineAtMs - performance.now()));
    if (remainingMs <= 1) throw new SourceSeparatorFailure("separator_timeout", "Separation lineage deadline expired");
    const command = this.command(["--describe"]);
    let described: RuntimeDescription;
    try {
      described = await executeJson(command.file, command.args, remainingMs, this.environment()) as RuntimeDescription;
    } catch (cause) {
      const reason = (cause as Error & { killed?: boolean }).killed ? "separator_timeout" : "model_unavailable";
      throw new SourceSeparatorFailure(reason, "Pinned separation runtime could not describe itself", { cause });
    }
    if (
      described.python?.version !== "3.14" || described.python.platform !== "darwin" || described.python.arch !== "arm64" ||
      described.packages?.speechbrain !== "1.1.0" || described.packages.torch !== "2.11.0" || described.packages.torchaudio !== "2.11.0" ||
      !Array.isArray(described.runtimeFiles) || described.runtimeFiles.length < 3
    ) throw new SourceSeparatorFailure("runtime_drift", "Pinned separation package or platform versions drifted");
    const runtimeFiles: SeparationRuntimeFileIdentity[] = [{ name: "studio/speechbrain_sepformer_runner.py", content: await identifyFile(this.runner) }];
    for (const file of described.runtimeFiles) {
      const path = await realpath(file.path).catch((cause) => {
        throw new SourceSeparatorFailure("runtime_drift", `Separation runtime file ${file.name} is unavailable`, { cause });
      });
      runtimeFiles.push({ name: file.name, content: await identifyFile(path) });
    }
    return validateSeparationProducerLineage({
      schema: "studio.source-separation-lineage.v1",
      adapter: { id: SEPARATION_METHOD.id, version: SEPARATION_METHOD.version },
      runtime: {
        python: described.python,
        packages: {
          speechbrain: { version: described.packages.speechbrain },
          torch: { version: described.packages.torch },
          torchaudio: { version: described.packages.torchaudio },
        },
        files: runtimeFiles,
        execution: { engine: "python_subprocess", provider: "cpu", threads: 1, network: "disabled" },
      },
      model: {
        id: SEPARATION_METHOD.modelId,
        revision: SEPARATION_METHOD.modelRevision,
        license: "Apache-2.0-model-card-declaration",
        trainingDomain: "wsj0-2mix",
        files: modelFiles,
      },
      configuration: {
        contentId: SEPARATION_METHOD.configurationContentId,
        sampleRateHz: 8_000,
        channels: 1,
        sampleFormat: "pcm_s16le_wav",
        estimatedSources: 2,
        outputRoles: ["source_estimate_1", "source_estimate_2"],
        timing: "exact_granted_range_relative_audio",
      },
    }, "Separation runtime", "producer");
  }

  async separate(input: { wavPath: string; outputDirectory: string; expectedSampleCount: number }, deadlineAtMs: number): Promise<SourceSeparationResult> {
    const lineage = await this.currentLineage(deadlineAtMs);
    const remainingMs = Math.max(1, Math.floor(deadlineAtMs - performance.now()));
    if (remainingMs <= 1) throw new SourceSeparatorFailure("separator_timeout", "Separation deadline expired before inference");
    const stemOne = join(input.outputDirectory, "source-estimate-1.wav");
    const stemTwo = join(input.outputDirectory, "source-estimate-2.wav");
    const command = this.command(["--separate", this.modelDirectory, input.wavPath, join(input.outputDirectory, "runtime-cache"), stemOne, stemTwo, String(input.expectedSampleCount)]);
    let result: { sampleCount?: unknown };
    try {
      result = await executeJson(command.file, command.args, remainingMs, this.environment()) as { sampleCount?: unknown };
    } catch (cause) {
      const code = (cause as NodeJS.ErrnoException).code;
      throw new SourceSeparatorFailure(code === "ETIMEDOUT" ? "separator_timeout" : "separator_failed", "Pinned local separation failed", { cause });
    }
    if (result.sampleCount !== input.expectedSampleCount) throw new SourceSeparatorFailure("separator_failed", "Separator changed exact-range sample count");
    return {
      lineage,
      stems: [
        { role: "source_estimate_1", path: stemOne, sampleCount: input.expectedSampleCount },
        { role: "source_estimate_2", path: stemTwo, sampleCount: input.expectedSampleCount },
      ],
    };
  }
}
