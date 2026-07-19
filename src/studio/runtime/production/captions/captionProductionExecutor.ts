import { execFile } from "node:child_process";
import { readFile, stat, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { identifyFile } from "../artifactStore.ts";
import type {
  CaptionExecutorDescriptor,
  CaptionProductionLine,
} from "../model.ts";
import { CAPTION_PRODUCTION_LIMITS } from "../model.ts";

const MAX_FIXTURE_BYTES = 1024 * 1024;
const MAX_CONCURRENT_CAPTION_RECOGNITION_RANGES = 4;
const MINIMUM_CAPTION_RECOGNITION_RANGE_MS = 1_000;

export interface CaptionExecutorInput {
  sourcePath: string;
  fixtureCaptionPath: string;
  range: { startMs: number; endMs: number };
  /** Host-derived source ranges. Real recognition is executed separately inside each range. */
  productionRanges: Array<{ startMs: number; endMs: number }>;
}

export type CaptionExecutorLine = Omit<CaptionProductionLine, "lineage">;

export interface CaptionProductionExecutor {
  describe(input: CaptionExecutorInput): Promise<CaptionExecutorDescriptor>;
  execute(input: CaptionExecutorInput, signal: AbortSignal): Promise<CaptionExecutorLine[]>;
}

export type CaptionProductionExecutorErrorCode =
  | "recognizer_provider_failed"
  | "recognizer_output_invalid"
  | "translator_provider_failed"
  | "translator_output_invalid";

/** Safe executor classification. Provider payloads and transcript bytes never enter the runtime journal. */
export class CaptionProductionExecutorError extends Error {
  readonly code: CaptionProductionExecutorErrorCode;

  constructor(code: CaptionProductionExecutorErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "CaptionProductionExecutorError";
    this.code = code;
  }
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
      executionScope: "test_demo_only",
      cognitionClaim: "none",
      recognizer: "gpt-4o-transcribe-diarize (recorded prior run)",
      translator: "gpt-5 (recorded prior run)",
      sourceCaptionContentId: fixture?.contentId ?? null,
    };
  }

  async execute(input: CaptionExecutorInput, signal: AbortSignal): Promise<CaptionExecutorLine[]> {
    if (signal.aborted) throw new Error("Caption fixture execution was aborted");
    const fixture = await fixtureValue(input.fixtureCaptionPath);
    if (!fixture) return [];
    const root = fixture.value as { pair?: { source?: unknown; target?: unknown }; cues?: unknown };
    if (root?.pair?.source !== "ko" || root?.pair?.target !== "en" || !Array.isArray(root.cues)) {
      throw new Error("Recorded caption fixture is not the compatible timed ko-to-en shape");
    }
    const lines: CaptionExecutorLine[] = [];
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

/** Explicit no-model browser-test seam. Its numbered interval labels make no transcription claim. */
export class DeterministicCurrentRunCaptionTestExecutor implements CaptionProductionExecutor {
  async describe(): Promise<CaptionExecutorDescriptor> {
    return {
      id: "studio.deterministic-current-run-caption-test-seam",
      version: "1",
      classification: "deterministic_current_run_test_seam",
      executionScope: "current_run",
      cognitionClaim: "none",
      recognizer: "deterministic-numbered-interval-test-seam",
      translator: "deterministic-numbered-interval-test-seam",
      sourceCaptionContentId: null,
    };
  }

  async execute(input: CaptionExecutorInput, signal: AbortSignal): Promise<CaptionExecutorLine[]> {
    if (signal.aborted) throw new Error("Deterministic caption test execution was aborted");
    const durationMs = input.range.endMs - input.range.startMs;
    const lineCount = Math.min(6, Math.max(1, Math.floor(durationMs / 500)));
    return Array.from({ length: lineCount }, (_, index) => {
      const startMs = input.range.startMs + Math.floor(durationMs * index / lineCount);
      const endMs = input.range.startMs + Math.floor(durationMs * (index + 1) / lineCount);
      return {
        id: `deterministic-current-run-line-${String(index + 1).padStart(3, "0")}`,
        startMs,
        endMs,
        source: {
          language: "ko" as const,
          state: "available" as const,
          text: `테스트 구간 ${index + 1}`,
          reasonCode: null,
        },
        target: {
          language: "en" as const,
          state: "available" as const,
          text: `Test interval ${index + 1}`,
          reasonCode: null,
        },
      };
    });
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
      version: "2",
      classification: "real_recognizer_translator",
      executionScope: "current_run",
      cognitionClaim: "none",
      recognizer: "gpt-4o-transcribe-diarize (host-derived ranges at least 1000ms, max 4 concurrent, no retry; shorter or failed ranges unavailable)",
      translator: "gpt-5 (strict structured output)",
      sourceCaptionContentId: null,
    };
  }

  async execute(input: CaptionExecutorInput, signal: AbortSignal): Promise<CaptionExecutorLine[]> {
    const temporary = await mkdtemp(join(tmpdir(), "studio-caption-production-"));
    try {
      if (input.productionRanges.length === 0 || input.productionRanges.length > CAPTION_PRODUCTION_LIMITS.maxLines) {
        throw new CaptionProductionExecutorError(
          "recognizer_output_invalid",
          "Real caption recognition requires a bounded non-empty host-derived production range set",
        );
      }
      for (const range of input.productionRanges) {
        if (
          !Number.isSafeInteger(range.startMs) || !Number.isSafeInteger(range.endMs) ||
          range.startMs < input.range.startMs || range.endMs > input.range.endMs || range.endMs <= range.startMs
        ) {
          throw new CaptionProductionExecutorError(
            "recognizer_output_invalid",
            "The host-derived caption production range is outside the approved analysis range",
          );
        }
      }
      const unavailableRangeLine = (
        rangeIndex: number,
        range: CaptionExecutorInput["productionRanges"][number],
        reasonCode: "recognizer_unavailable" | "recognizer_empty",
      ): CaptionExecutorLine => ({
        id: `line-${String(rangeIndex + 1).padStart(3, "0")}-unavailable`,
        startMs: range.startMs,
        endMs: range.endMs,
        source: { language: "ko", state: "unavailable", text: null, reasonCode },
        target: { language: "en", state: "unavailable", text: null, reasonCode: "source_unavailable" },
      });
      const recognizeRange = async (
        rangeIndex: number,
        range: CaptionExecutorInput["productionRanges"][number],
      ): Promise<CaptionExecutorLine[]> => {
        try {
          if (range.endMs - range.startMs < MINIMUM_CAPTION_RECOGNITION_RANGE_MS) {
            return [unavailableRangeLine(rangeIndex, range, "recognizer_unavailable")];
          }
          const audioPath = join(temporary, `range-${String(rangeIndex + 1).padStart(3, "0")}.wav`);
          await execute(this.ffmpeg, [
            "-nostdin", "-hide_banner", "-loglevel", "error",
            "-ss", (range.startMs / 1_000).toFixed(3),
            "-t", ((range.endMs - range.startMs) / 1_000).toFixed(3),
            "-i", input.sourcePath,
            "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", audioPath,
          ], Math.min(20_000, CAPTION_PRODUCTION_LIMITS.maxWallMs));
          if (signal.aborted) throw new Error("Real caption execution was aborted");
          const form = new FormData();
          form.append(
            "file",
            new Blob([await readFile(audioPath)], { type: "audio/wav" }),
            `range-${String(rangeIndex + 1).padStart(3, "0")}.wav`,
          );
          form.append("model", "gpt-4o-transcribe-diarize");
          form.append("language", "ko");
          form.append("response_format", "diarized_json");
          form.append("chunking_strategy", "auto");
          let transcription: unknown;
          try {
            transcription = await apiJson(this.apiKey, "audio/transcriptions", form, signal, null);
          } catch (error) {
            throw new CaptionProductionExecutorError(
              "recognizer_provider_failed",
              "The bounded current-run caption recognizer failed closed",
              { cause: error },
            );
          }
          const segments = (transcription as { segments?: unknown }).segments;
          if (!Array.isArray(segments)) {
            throw new CaptionProductionExecutorError(
              "recognizer_output_invalid",
              "The bounded current-run caption recognizer returned no segment array",
            );
          }
          if (segments.length === 0) {
            return [unavailableRangeLine(rangeIndex, range, "recognizer_empty")];
          }
          const rangeLines: CaptionExecutorLine[] = [];
          for (const [segmentIndex, candidate] of segments.entries()) {
            const segment = candidate as { start?: unknown; end?: unknown; text?: unknown };
            const startMs = range.startMs + Math.round(Number(segment.start) * 1_000);
            const endMs = range.startMs + Math.round(Number(segment.end) * 1_000);
            const text = typeof segment.text === "string" ? segment.text.trim() : "";
            if (
              !Number.isSafeInteger(startMs) || !Number.isSafeInteger(endMs) || endMs <= startMs ||
              startMs < range.startMs || endMs > range.endMs
            ) {
              throw new CaptionProductionExecutorError(
                "recognizer_output_invalid",
                "The bounded current-run caption recognizer returned timing outside its host-derived production range",
              );
            }
            const id = `line-${String(rangeIndex + 1).padStart(3, "0")}-${String(segmentIndex + 1).padStart(3, "0")}`;
            rangeLines.push(text
              ? {
                  id,
                  startMs,
                  endMs,
                  source: { language: "ko", state: "available", text, reasonCode: null },
                  target: { language: "en", state: "unavailable", text: null, reasonCode: "translator_unavailable" },
                }
              : {
                  id,
                  startMs,
                  endMs,
                  source: { language: "ko", state: "unavailable", text: null, reasonCode: "recognizer_empty" },
                  target: { language: "en", state: "unavailable", text: null, reasonCode: "source_unavailable" },
                });
          }
          return rangeLines;
        } catch (error) {
          if (signal.aborted) throw error;
          return [unavailableRangeLine(rangeIndex, range, "recognizer_unavailable")];
        }
      };
      const sourceLines: CaptionExecutorLine[] = [];
      for (let offset = 0; offset < input.productionRanges.length; offset += MAX_CONCURRENT_CAPTION_RECOGNITION_RANGES) {
        const batch = input.productionRanges.slice(offset, offset + MAX_CONCURRENT_CAPTION_RECOGNITION_RANGES);
        const settled = await Promise.allSettled(batch.map((range, index) => recognizeRange(offset + index, range)));
        const failure = settled.find((entry): entry is PromiseRejectedResult => entry.status === "rejected");
        if (failure) throw failure.reason;
        for (const result of settled) if (result.status === "fulfilled") sourceLines.push(...result.value);
      }
      sourceLines.sort((left, right) => left.startMs - right.startMs || left.endMs - right.endMs || left.id.localeCompare(right.id));
      if (sourceLines.length > CAPTION_PRODUCTION_LIMITS.maxLines) {
        throw new CaptionProductionExecutorError(
          "recognizer_output_invalid",
          "Real recognizer output exceeds the caption line ceiling",
        );
      }
      const translatable = sourceLines.filter((line) => line.source.state === "available");
      if (translatable.length === 0) return sourceLines;
      let response: unknown;
      try {
        response = await apiJson(
          this.apiKey,
          "chat/completions",
          JSON.stringify({
            model: "gpt-5",
            messages: [
              {
                role: "system",
                content: "Translate every Korean source line into a natural English subtitle. Copy every id exactly once and emit the required JSON schema only.",
              },
              {
                role: "user",
                content: JSON.stringify({ lines: translatable.map((line) => ({ id: line.id, ko: line.source.text })) }),
              },
            ],
            response_format: {
              type: "json_schema",
              json_schema: {
                name: "caption_translations",
                strict: true,
                schema: {
                  type: "object",
                  properties: {
                    lines: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: { id: { type: "string" }, en: { type: "string" } },
                        required: ["id", "en"],
                        additionalProperties: false,
                      },
                    },
                  },
                  required: ["lines"],
                  additionalProperties: false,
                },
              },
            },
            max_completion_tokens: 4_000,
          }),
          signal,
          "application/json",
        );
      } catch (error) {
        throw new CaptionProductionExecutorError(
          "translator_provider_failed",
          "The bounded current-run caption translator provider failed closed",
          { cause: error },
        );
      }
      try {
        const content = (response as { choices?: Array<{ message?: { content?: unknown } }> }).choices?.[0]?.message?.content;
        const translated = typeof content === "string" ? JSON.parse(content) as { lines?: unknown } : {};
        const byId = new Map<string, string>();
        if (Array.isArray(translated.lines)) {
          for (const candidate of translated.lines) {
            const line = candidate as { id?: unknown; en?: unknown };
            if (typeof line.id === "string" && typeof line.en === "string" && line.en.trim()) {
              if (byId.has(line.id)) throw new Error("duplicate translation id");
              byId.set(line.id, line.en.trim());
            }
          }
        }
        const expectedIds = new Set(translatable.map((line) => line.id));
        if (byId.size !== expectedIds.size || [...byId.keys()].some((id) => !expectedIds.has(id))) {
          throw new Error("translation ids do not close the exact source line set");
        }
        return sourceLines.map((line): CaptionExecutorLine => {
          if (line.source.state !== "available") return line;
          const target = byId.get(line.id);
          return target
            ? { ...line, target: { language: "en", state: "available", text: target, reasonCode: null } }
            : { ...line, target: { language: "en", state: "unavailable", text: null, reasonCode: "translator_missing_line" } };
        });
      } catch (error) {
        throw new CaptionProductionExecutorError(
          "translator_output_invalid",
          "The bounded current-run caption translator returned invalid structured output",
          { cause: error },
        );
      }
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  }
}
