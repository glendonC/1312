import { execFile } from "node:child_process";
import { readFile, stat, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { identifyFile } from "./artifactStore.ts";
import type {
  CaptionExecutorDescriptor,
  CaptionProductionLine,
} from "./model.ts";
import { CAPTION_PRODUCTION_LIMITS } from "./model.ts";

const MAX_FIXTURE_BYTES = 1024 * 1024;

export interface CaptionExecutorInput {
  sourcePath: string;
  fixtureCaptionPath: string;
  range: { startMs: number; endMs: number };
}

export interface CaptionProductionExecutor {
  describe(input: CaptionExecutorInput): Promise<CaptionExecutorDescriptor>;
  execute(input: CaptionExecutorInput, signal: AbortSignal): Promise<CaptionProductionLine[]>;
}

interface LegacyCaptionCue {
  id?: unknown;
  t_start?: unknown;
  t_end?: unknown;
  source?: { lang?: unknown; text?: unknown };
  targets?: Array<{
    lang?: unknown;
    text?: unknown;
    withheld?: { gate?: unknown; reason?: unknown };
  }>;
}

async function fixtureValue(path: string): Promise<{ value: unknown; contentId: string } | null> {
  let details;
  try {
    details = await stat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  if (!details.isFile() || details.size <= 0 || details.size > MAX_FIXTURE_BYTES) {
    throw new Error("Recorded caption fixture exceeds its bounded file contract");
  }
  const [raw, content] = await Promise.all([readFile(path, "utf8"), identifyFile(path)]);
  let value: unknown;
  try {
    value = JSON.parse(raw) as unknown;
  } catch (error) {
    throw new Error("Recorded caption fixture is invalid JSON", { cause: error });
  }
  return { value, contentId: content.contentId };
}

/** Adapts the checked run-clip caption shape; it does not claim recognizer execution in this job. */
export class RecordedCaptionFixtureExecutor implements CaptionProductionExecutor {
  async describe(input: CaptionExecutorInput): Promise<CaptionExecutorDescriptor> {
    const fixture = await fixtureValue(input.fixtureCaptionPath);
    return {
      id: "studio.recorded-caption-fixture-adapter",
      version: "1",
      classification: "recorded_real_pipeline_fixture",
      recognizer: "gpt-4o-transcribe-diarize (recorded prior run)",
      translator: "gpt-5 (recorded prior run)",
      sourceCaptionContentId: fixture?.contentId ?? null,
    };
  }

  async execute(input: CaptionExecutorInput, signal: AbortSignal): Promise<CaptionProductionLine[]> {
    if (signal.aborted) throw new Error("Caption fixture execution was aborted");
    const fixture = await fixtureValue(input.fixtureCaptionPath);
    if (!fixture) return [];
    const root = fixture.value as { pair?: { source?: unknown; target?: unknown }; cues?: unknown };
    if (root?.pair?.source !== "ko" || root?.pair?.target !== "en" || !Array.isArray(root.cues)) {
      throw new Error("Recorded caption fixture is not the compatible timed ko-to-en shape");
    }
    const lines: CaptionProductionLine[] = [];
    for (const [index, candidate] of (root.cues as LegacyCaptionCue[]).entries()) {
      if (signal.aborted) throw new Error("Caption fixture execution was aborted");
      const startMs = Math.round(Number(candidate.t_start) * 1_000);
      const endMs = Math.round(Number(candidate.t_end) * 1_000);
      if (!Number.isSafeInteger(startMs) || !Number.isSafeInteger(endMs) || endMs <= startMs) {
        throw new Error(`Recorded caption fixture cue ${index} has invalid timing`);
      }
      if (startMs < input.range.startMs || endMs > input.range.endMs) continue;
      const id = typeof candidate.id === "string" && candidate.id.trim() ? candidate.id : `line-${index + 1}`;
      const sourceText = candidate.source?.lang === "ko" && typeof candidate.source.text === "string"
        ? candidate.source.text.trim()
        : "";
      const target = candidate.targets?.find((entry) => entry.lang === "en");
      if (!sourceText) {
        lines.push({
          id,
          startMs,
          endMs,
          source: { language: "ko", state: "unavailable", text: null, reasonCode: "recognizer_empty" },
          target: { language: "en", state: "unavailable", text: null, reasonCode: "source_unavailable" },
        });
      } else if (typeof target?.text === "string" && target.text.trim()) {
        lines.push({
          id,
          startMs,
          endMs,
          source: { language: "ko", state: "available", text: sourceText, reasonCode: null },
          target: { language: "en", state: "available", text: target.text.trim(), reasonCode: null },
        });
      } else if (target?.withheld && typeof target.withheld.gate === "string") {
        lines.push({
          id,
          startMs,
          endMs,
          source: { language: "ko", state: "available", text: sourceText, reasonCode: null },
          target: { language: "en", state: "withheld", text: null, reasonCode: "recorded_quality_gate_withheld" },
        });
      } else {
        lines.push({
          id,
          startMs,
          endMs,
          source: { language: "ko", state: "available", text: sourceText, reasonCode: null },
          target: { language: "en", state: "unavailable", text: null, reasonCode: "translator_missing_line" },
        });
      }
    }
    if (lines.length > CAPTION_PRODUCTION_LIMITS.maxLines) {
      throw new Error("Recorded caption fixture exceeds the caption line ceiling");
    }
    return lines;
  }
}

function execute(file: string, args: readonly string[], timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(
      file,
      [...args],
      { timeout: timeoutMs, maxBuffer: 1024 * 1024, windowsHide: true },
      (error) => error ? reject(error) : resolve(),
    );
  });
}

async function apiJson(
  apiKey: string,
  path: string,
  body: BodyInit,
  signal: AbortSignal,
  contentType: string | null,
): Promise<unknown> {
  const response = await fetch(`https://api.openai.com/v1/${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      ...(contentType ? { "Content-Type": contentType } : {}),
    },
    body,
    signal,
  });
  if (!response.ok) throw new Error(`OpenAI caption producer ${path} returned ${response.status}`);
  return response.json() as Promise<unknown>;
}

/** Optional real path using the same recognizer/translator families and timed cue shape as run-clip. */
export class OpenAiCaptionProductionExecutor implements CaptionProductionExecutor {
  private readonly apiKey: string;
  private readonly ffmpeg: string;

  constructor(options: { apiKey: string; ffmpeg?: string }) {
    if (!options.apiKey.trim()) throw new Error("The real caption executor requires an API key");
    this.apiKey = options.apiKey.trim();
    this.ffmpeg = options.ffmpeg ?? "ffmpeg";
  }

  async describe(): Promise<CaptionExecutorDescriptor> {
    return {
      id: "studio.openai-caption-producer",
      version: "1",
      classification: "real_recognizer_translator",
      recognizer: "gpt-4o-transcribe-diarize",
      translator: "gpt-5",
      sourceCaptionContentId: null,
    };
  }

  async execute(input: CaptionExecutorInput, signal: AbortSignal): Promise<CaptionProductionLine[]> {
    const temporary = await mkdtemp(join(tmpdir(), "studio-caption-production-"));
    const audioPath = join(temporary, "range.wav");
    try {
      await execute(this.ffmpeg, [
        "-nostdin", "-hide_banner", "-loglevel", "error",
        "-ss", (input.range.startMs / 1_000).toFixed(3),
        "-t", ((input.range.endMs - input.range.startMs) / 1_000).toFixed(3),
        "-i", input.sourcePath,
        "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", audioPath,
      ], Math.min(20_000, CAPTION_PRODUCTION_LIMITS.maxWallMs));
      if (signal.aborted) throw new Error("Real caption execution was aborted");
      const form = new FormData();
      form.append("file", new Blob([await readFile(audioPath)], { type: "audio/wav" }), "range.wav");
      form.append("model", "gpt-4o-transcribe-diarize");
      form.append("language", "ko");
      form.append("response_format", "diarized_json");
      form.append("chunking_strategy", JSON.stringify({ type: "server_vad" }));
      let transcription: unknown;
      try {
        transcription = await apiJson(this.apiKey, "audio/transcriptions", form, signal, null);
      } catch {
        return [];
      }
      const segments = (transcription as { segments?: unknown }).segments;
      if (!Array.isArray(segments)) return [];
      const sourceLines: CaptionProductionLine[] = segments.map((candidate, index): CaptionProductionLine => {
        const segment = candidate as { start?: unknown; end?: unknown; text?: unknown };
        const startMs = input.range.startMs + Math.round(Number(segment.start) * 1_000);
        const endMs = input.range.startMs + Math.round(Number(segment.end) * 1_000);
        const text = typeof segment.text === "string" ? segment.text.trim() : "";
        if (
          !Number.isSafeInteger(startMs) || !Number.isSafeInteger(endMs) || endMs <= startMs ||
          startMs < input.range.startMs || endMs > input.range.endMs
        ) throw new Error("Real recognizer returned timing outside the approved range");
        return text
          ? {
              id: `line-${String(index + 1).padStart(3, "0")}`,
              startMs,
              endMs,
              source: { language: "ko", state: "available", text, reasonCode: null },
              target: { language: "en", state: "unavailable", text: null, reasonCode: "translator_unavailable" },
            }
          : {
              id: `line-${String(index + 1).padStart(3, "0")}`,
              startMs,
              endMs,
              source: { language: "ko", state: "unavailable", text: null, reasonCode: "recognizer_empty" },
              target: { language: "en", state: "unavailable", text: null, reasonCode: "source_unavailable" },
            };
      }).sort((left, right) => left.startMs - right.startMs);
      if (sourceLines.length > CAPTION_PRODUCTION_LIMITS.maxLines) {
        throw new Error("Real recognizer output exceeds the caption line ceiling");
      }
      const translatable = sourceLines.filter((line) => line.source.state === "available");
      if (translatable.length === 0) return sourceLines;
      try {
        const response = await apiJson(
          this.apiKey,
          "chat/completions",
          JSON.stringify({
            model: "gpt-5",
            messages: [
              {
                role: "system",
                content: "Translate each timed Korean source line into natural English subtitles. Preserve ids. If a line cannot be translated, omit it. Return JSON only.",
              },
              {
                role: "user",
                content: JSON.stringify({ lines: translatable.map((line) => ({ id: line.id, ko: line.source.text })) }),
              },
            ],
            response_format: { type: "json_object" },
            max_completion_tokens: 4_000,
          }),
          signal,
          "application/json",
        );
        const content = (response as { choices?: Array<{ message?: { content?: unknown } }> }).choices?.[0]?.message?.content;
        const translated = typeof content === "string" ? JSON.parse(content) as { lines?: unknown } : {};
        const byId = new Map<string, string>();
        if (Array.isArray(translated.lines)) {
          for (const candidate of translated.lines) {
            const line = candidate as { id?: unknown; en?: unknown };
            if (typeof line.id === "string" && typeof line.en === "string" && line.en.trim()) {
              byId.set(line.id, line.en.trim());
            }
          }
        }
        return sourceLines.map((line): CaptionProductionLine => {
          if (line.source.state !== "available") return line;
          const target = byId.get(line.id);
          return target
            ? { ...line, target: { language: "en", state: "available", text: target, reasonCode: null } }
            : { ...line, target: { language: "en", state: "unavailable", text: null, reasonCode: "translator_missing_line" } };
        });
      } catch {
        return sourceLines;
      }
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  }
}
