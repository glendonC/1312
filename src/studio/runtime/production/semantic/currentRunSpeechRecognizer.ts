import { execFile } from "node:child_process";
import { readFile, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { canonicalSha256 } from "../artifactStore.ts";
import type {
  CurrentRunRecognizerDescriptor,
  RequestedSourceLanguage,
  SemanticEvidenceAvailabilityState,
  SemanticEvidenceAvailabilityReason,
  SemanticEvidenceNormalization,
} from "../model.ts";
import { SEMANTIC_EVIDENCE_LIMITS } from "../model.ts";

export const SEMANTIC_EVIDENCE_NORMALIZATION: SemanticEvidenceNormalization = {
  audio: { container: "wav", codec: "pcm_s16le", channels: 1, sampleRateHz: 16_000 },
  text: { unicode: "NFC", whitespace: "trim_and_collapse", preserveCase: true },
  timing: { unit: "integer_millisecond", range: "half_open_absolute_source" },
};

export interface CurrentRunRecognizerInput {
  sourcePath: string;
  trackIndex: number;
  range: { startMs: number; endMs: number };
  requestedSourceLanguage: RequestedSourceLanguage;
}

export interface CurrentRunRecognizerSegment {
  startMs: number;
  endMs: number;
  state: "available" | "unavailable" | "unknown";
  text: string | null;
}

export interface CurrentRunRecognizerResult {
  availability: SemanticEvidenceAvailabilityState;
  reason: Exclude<SemanticEvidenceAvailabilityReason, "segment_or_byte_ceiling">;
  segments: CurrentRunRecognizerSegment[];
}

export interface CurrentRunSpeechRecognizer {
  describe(input: Omit<CurrentRunRecognizerInput, "sourcePath" | "trackIndex" | "range">): Promise<CurrentRunRecognizerDescriptor>;
  recognize(input: CurrentRunRecognizerInput, signal: AbortSignal): Promise<CurrentRunRecognizerResult>;
}

function configuredLanguage(policy: RequestedSourceLanguage): string | null {
  return policy.mode === "declared" && policy.languages.length === 1 ? policy.languages[0] : null;
}

function descriptor(input: {
  id: string;
  version: string;
  model: string | null;
  runtime: { id: string; version: string };
  language: string | null;
  segmentation: "server_vad" | "producer_defined";
}): CurrentRunRecognizerDescriptor {
  const configuration = {
    id: `${input.id}.timed-segments.v1`,
    language: input.language,
    timestampMode: "segment" as const,
    segmentation: input.segmentation,
  };
  return {
    id: input.id,
    version: input.version,
    model: input.model,
    runtime: input.runtime,
    configuration: {
      ...configuration,
      contentId: `sha256:${canonicalSha256(configuration)}`,
    },
    executionScope: "current_run",
    fixtureContentId: null,
  };
}

/** Honest production fallback: a current invocation is recorded as unavailable, never as a fixture success. */
export class UnavailableCurrentRunSpeechRecognizer implements CurrentRunSpeechRecognizer {
  async describe(input: { requestedSourceLanguage: RequestedSourceLanguage }): Promise<CurrentRunRecognizerDescriptor> {
    return descriptor({
      id: "studio.unconfigured-current-run-speech-recognizer",
      version: "1",
      model: null,
      runtime: { id: "studio.runtime-host", version: "1" },
      language: configuredLanguage(input.requestedSourceLanguage),
      segmentation: "producer_defined",
    });
  }

  async recognize(_input: CurrentRunRecognizerInput, signal: AbortSignal): Promise<CurrentRunRecognizerResult> {
    if (signal.aborted) throw signal.reason ?? new Error("Current-run speech recognizer was aborted");
    return { availability: "unavailable", reason: "recognizer_unavailable", segments: [] };
  }
}

function execute(file: string, args: readonly string[], timeoutMs: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(
      file,
      [...args],
      { timeout: timeoutMs, maxBuffer: 1024 * 1024, windowsHide: true, signal },
      (error) => error ? reject(error) : resolve(),
    );
  });
}

async function apiJson(apiKey: string, body: FormData, signal: AbortSignal): Promise<unknown> {
  const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body,
    signal,
  });
  if (!response.ok) throw new Error(`Current-run speech recognizer returned ${response.status}`);
  return response.json() as Promise<unknown>;
}

/** Reusable current-run timed recognizer, independent of caption/review authority. */
export class OpenAiCurrentRunSpeechRecognizer implements CurrentRunSpeechRecognizer {
  private readonly apiKey: string;
  private readonly ffmpeg: string;
  private readonly model: string;

  constructor(options: { apiKey: string; ffmpeg?: string; model?: string }) {
    if (!options.apiKey.trim()) throw new Error("The current-run speech recognizer requires an API key");
    this.apiKey = options.apiKey.trim();
    this.ffmpeg = options.ffmpeg ?? "ffmpeg";
    this.model = options.model ?? "gpt-4o-transcribe-diarize";
  }

  async describe(input: { requestedSourceLanguage: RequestedSourceLanguage }): Promise<CurrentRunRecognizerDescriptor> {
    return descriptor({
      id: "studio.openai-current-run-speech-recognizer",
      version: "1",
      model: this.model,
      runtime: { id: "openai.audio-transcriptions", version: "v1" },
      language: configuredLanguage(input.requestedSourceLanguage),
      segmentation: "server_vad",
    });
  }

  async recognize(input: CurrentRunRecognizerInput, signal: AbortSignal): Promise<CurrentRunRecognizerResult> {
    const temporary = await mkdtemp(join(tmpdir(), "studio-semantic-evidence-"));
    const normalizedAudio = join(temporary, "range.wav");
    try {
      const durationMs = input.range.endMs - input.range.startMs;
      await execute(this.ffmpeg, [
        "-nostdin", "-hide_banner", "-loglevel", "error",
        "-ss", (input.range.startMs / 1_000).toFixed(3),
        "-t", (durationMs / 1_000).toFixed(3),
        "-i", input.sourcePath,
        "-map", `0:${input.trackIndex}`,
        "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", normalizedAudio,
      ], Math.min(20_000, SEMANTIC_EVIDENCE_LIMITS.maxWallMs), signal);
      if (signal.aborted) throw signal.reason ?? new Error("Current-run speech recognizer was aborted");
      const details = await stat(normalizedAudio);
      if (!details.isFile() || details.size <= 0 || details.size > SEMANTIC_EVIDENCE_LIMITS.maxNormalizedAudioBytes) {
        throw new Error("Normalized recognizer audio exceeds its byte ceiling");
      }
      const form = new FormData();
      form.append("file", new Blob([await readFile(normalizedAudio)], { type: "audio/wav" }), "range.wav");
      form.append("model", this.model);
      const language = configuredLanguage(input.requestedSourceLanguage);
      if (language) form.append("language", language);
      form.append("response_format", "diarized_json");
      form.append("chunking_strategy", JSON.stringify({ type: "server_vad" }));
      const value = await apiJson(this.apiKey, form, signal);
      const rawSegments = (value as { segments?: unknown }).segments;
      if (rawSegments === undefined) {
        return { availability: "unknown", reason: "recognizer_output_unknown", segments: [] };
      }
      if (!Array.isArray(rawSegments) || rawSegments.length === 0) {
        return { availability: "empty", reason: "recognizer_returned_no_segments", segments: [] };
      }
      const segments = rawSegments.map((candidate): CurrentRunRecognizerSegment => {
        const segment = candidate as { start?: unknown; end?: unknown; text?: unknown };
        const startMs = input.range.startMs + Math.round(Number(segment.start) * 1_000);
        const endMs = input.range.startMs + Math.round(Number(segment.end) * 1_000);
        const text = typeof segment.text === "string" ? segment.text : "";
        return text.trim()
          ? { startMs, endMs, state: "available", text }
          : { startMs, endMs, state: "unavailable", text: null };
      });
      return { availability: "available", reason: "current_run_hypotheses_returned", segments };
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  }
}
