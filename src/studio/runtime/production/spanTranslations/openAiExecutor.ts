import { canonicalJsonContentId } from "../artifactStore.ts";
import type {
  SpanTranslationExecutorDescriptor,
  SpanTranslationExecutorInput,
  SpanTranslationExecutorResult,
} from "../model.ts";
import { SPAN_TRANSLATION_LIMITS } from "../model.ts";
import {
  spanTranslationTargetLanguage,
  validateGeneratedSpanTranslation,
} from "../validation/spanTranslations.ts";
import {
  SPAN_TRANSLATION_OUTPUT_SCHEMA,
  SPAN_TRANSLATION_PROMPT,
  SPAN_TRANSLATION_PROMPT_CONTENT_ID,
  type SpanTranslationExecutor,
} from "./executor.ts";

const RESPONSES_ENDPOINT = "https://api.openai.com/v1/responses";

interface OpenAiResponse {
  id?: unknown;
  status?: unknown;
  output?: unknown;
  usage?: unknown;
}

async function boundedResponseBytes(response: Response): Promise<Uint8Array> {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null) {
    const parsed = Number(declaredLength);
    if (Number.isFinite(parsed) && parsed > SPAN_TRANSLATION_LIMITS.maxProviderResponseBytes) {
      throw new Error("OpenAI span-translation envelope exceeded the response byte ceiling");
    }
  }
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > SPAN_TRANSLATION_LIMITS.maxProviderResponseBytes) {
        await reader.cancel("span-translation provider response byte ceiling exceeded");
        throw new Error("OpenAI span-translation envelope exceeded the response byte ceiling");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function outputText(value: OpenAiResponse): string {
  if (value.status !== "completed" || !Array.isArray(value.output)) {
    throw new Error("OpenAI span-translation response did not complete");
  }
  const texts: string[] = [];
  for (const item of value.output) {
    if (!item || typeof item !== "object") {
      throw new Error("OpenAI span-translation response contained an invalid output item");
    }
    const type = (item as { type?: unknown }).type;
    if (type === "reasoning") continue;
    if (type !== "message") {
      throw new Error("OpenAI span-translation response contained an unsupported output item");
    }
    const content = (item as { content?: unknown }).content;
    if (!Array.isArray(content)) {
      throw new Error("OpenAI span-translation response message omitted content");
    }
    for (const part of content) {
      if (!part || typeof part !== "object" || (part as { type?: unknown }).type !== "output_text" ||
          typeof (part as { text?: unknown }).text !== "string") {
        throw new Error("OpenAI span-translation response contained refusal or unsupported message content");
      }
      texts.push((part as { text: string }).text);
    }
  }
  if (texts.length !== 1 || !texts[0].trim()) {
    throw new Error("OpenAI span-translation response must contain exactly one output_text item");
  }
  return texts[0];
}

function tokenCount(value: unknown, key: "input_tokens" | "output_tokens"): number | null {
  if (!value || typeof value !== "object") return null;
  const count = (value as Record<string, unknown>)[key];
  return typeof count === "number" && Number.isSafeInteger(count) && count >= 0 ? count : null;
}

/**
 * Host-side executor over the OpenAI Responses API, behind the same seam, prompt contract, and
 * limits as the local Ollama executor, so receipts stay comparable across providers. This is the
 * zero-extra-install lane for hosts that already opt into real caption production with an OpenAI
 * key; the local executor remains the private offline lane.
 */
export class OpenAiSpanTranslationExecutor implements SpanTranslationExecutor {
  private readonly model: string;
  private readonly apiKey: string;

  constructor(input: { model: string; apiKey: string }) {
    if (!input.model.trim() || input.model.trim() !== input.model || input.model.length > 160) {
      throw new Error("OpenAI span-translation model must be an explicit bounded model id");
    }
    if (!input.apiKey.trim()) throw new Error("OpenAI span-translation executor requires an API key");
    this.model = input.model;
    this.apiKey = input.apiKey;
  }

  describe(): SpanTranslationExecutorDescriptor {
    return {
      id: "studio.openai-span-translation-generator",
      version: "1",
      classification: "real_model",
      executionScope: "current_run",
      model: this.model,
      promptContractContentId: SPAN_TRANSLATION_PROMPT_CONTENT_ID,
      configurationContentId: canonicalJsonContentId({
        provider: "openai",
        endpoint: RESPONSES_ENDPOINT,
        model: this.model,
        store: false,
        maxOutputTokens: SPAN_TRANSLATION_LIMITS.maxCompletionTokens,
      }),
    };
  }

  async generate(
    input: SpanTranslationExecutorInput,
    signal: AbortSignal,
  ): Promise<SpanTranslationExecutorResult> {
    const response = await fetch(RESPONSES_ENDPOINT, {
      method: "POST",
      signal,
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        instructions: SPAN_TRANSLATION_PROMPT,
        input: JSON.stringify({
          selectedLine: input.line,
          contextLines: input.contextLines,
          selectedSpan: input.grant.selection,
          translateTo: spanTranslationTargetLanguage(input.grant.selection.side),
        }),
        text: {
          format: {
            type: "json_schema",
            name: "studio_span_translation_v1",
            description: "Bounded caption-context translation of one exact selected span",
            strict: true,
            schema: SPAN_TRANSLATION_OUTPUT_SCHEMA,
          },
        },
        max_output_tokens: SPAN_TRANSLATION_LIMITS.maxCompletionTokens,
        store: false,
      }),
    });
    if (!response.ok) {
      throw new Error(`OpenAI span-translation request failed with HTTP ${response.status}`);
    }
    const responseBytes = await boundedResponseBytes(response);
    let raw: OpenAiResponse;
    try {
      raw = JSON.parse(new TextDecoder().decode(responseBytes)) as OpenAiResponse;
    } catch {
      throw new Error("OpenAI span-translation envelope was not valid JSON");
    }
    if (typeof raw.id !== "string" || !raw.id.trim()) {
      throw new Error("OpenAI span-translation response omitted its provider response id");
    }
    const text = outputText(raw);
    if (new TextEncoder().encode(text).byteLength > SPAN_TRANSLATION_LIMITS.maxOutputBytes) {
      throw new Error("OpenAI span-translation response exceeded the output byte ceiling");
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text) as unknown;
    } catch {
      throw new Error("OpenAI span-translation response was not valid JSON");
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) ||
        Object.keys(parsed).length !== 1 || !("t" in parsed)) {
      throw new Error("OpenAI span-translation response did not match the closed output envelope");
    }
    const t = (parsed as { t: unknown }).t;
    if (t !== null && typeof t !== "string") {
      throw new Error("OpenAI span-translation response did not match the closed output envelope");
    }
    const trimmed = t === null ? null : t.trim();
    return {
      translation: validateGeneratedSpanTranslation(
        trimmed === null || trimmed === ""
          ? { availability: "withheld", reasonCode: "generator_abstained", text: null }
          : { availability: "available", reasonCode: null, text: trimmed },
      ),
      execution: {
        providerResponseId: raw.id,
        inputTokens: tokenCount(raw.usage, "input_tokens"),
        outputTokens: tokenCount(raw.usage, "output_tokens"),
      },
    };
  }
}
