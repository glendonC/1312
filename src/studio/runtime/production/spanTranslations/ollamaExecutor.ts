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

const KEEP_ALIVE = "30m";
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

interface OllamaChatResponse {
  message?: unknown;
  done?: unknown;
  done_reason?: unknown;
  prompt_eval_count?: unknown;
  eval_count?: unknown;
}

function loopbackEndpoint(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Ollama span-translation endpoint must be a valid URL");
  }
  if (
    url.protocol !== "http:" || !LOOPBACK_HOSTS.has(url.hostname) ||
    (url.pathname !== "" && url.pathname !== "/") || url.search !== "" || url.hash !== "" ||
    url.username !== "" || url.password !== ""
  ) {
    throw new Error("Ollama span-translation endpoint must be a plain loopback http origin");
  }
  return url.origin;
}

async function boundedResponseBytes(response: Response): Promise<Uint8Array> {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null) {
    const parsed = Number(declaredLength);
    if (Number.isFinite(parsed) && parsed > SPAN_TRANSLATION_LIMITS.maxProviderResponseBytes) {
      throw new Error("Ollama span-translation envelope exceeded the response byte ceiling");
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
        throw new Error("Ollama span-translation envelope exceeded the response byte ceiling");
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

function tokenCount(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

/**
 * Host-side executor over a local Ollama server's native chat API. The native API is deliberate:
 * it carries first-class thinking control and JSON-schema constrained output, where the
 * OpenAI-compatible shim can leave a thinking model spending the whole token budget on hidden
 * reasoning. The endpoint is restricted to a plain loopback origin so "local model" stays true.
 */
export class OllamaSpanTranslationExecutor implements SpanTranslationExecutor {
  private readonly model: string;
  private readonly endpoint: string;
  private readonly think: "off" | "low";

  constructor(input: { model: string; endpoint: string; think: "off" | "low" }) {
    if (!input.model.trim() || input.model.trim() !== input.model || input.model.length > 160) {
      throw new Error("Ollama span-translation model must be an explicit bounded model id");
    }
    this.model = input.model;
    this.endpoint = loopbackEndpoint(input.endpoint);
    this.think = input.think;
  }

  describe(): SpanTranslationExecutorDescriptor {
    return {
      id: "studio.ollama-span-translation-generator",
      version: "1",
      classification: "real_model",
      executionScope: "current_run",
      model: this.model,
      promptContractContentId: SPAN_TRANSLATION_PROMPT_CONTENT_ID,
      configurationContentId: canonicalJsonContentId({
        provider: "ollama",
        endpoint: this.endpoint,
        model: this.model,
        think: this.think,
        stream: false,
        keepAlive: KEEP_ALIVE,
        temperature: 0,
        maxCompletionTokens: SPAN_TRANSLATION_LIMITS.maxCompletionTokens,
      }),
    };
  }

  async generate(
    input: SpanTranslationExecutorInput,
    signal: AbortSignal,
  ): Promise<SpanTranslationExecutorResult> {
    const response = await fetch(`${this.endpoint}/api/chat`, {
      method: "POST",
      signal,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: this.model,
        stream: false,
        keep_alive: KEEP_ALIVE,
        think: this.think === "low" ? "low" : false,
        format: SPAN_TRANSLATION_OUTPUT_SCHEMA,
        options: { temperature: 0, num_predict: SPAN_TRANSLATION_LIMITS.maxCompletionTokens },
        messages: [
          { role: "system", content: SPAN_TRANSLATION_PROMPT },
          {
            role: "user",
            content: JSON.stringify({
              selectedLine: input.line,
              contextLines: input.contextLines,
              selectedSpan: input.grant.selection,
              translateTo: spanTranslationTargetLanguage(input.grant.selection.side),
            }),
          },
        ],
      }),
    });
    if (!response.ok) {
      throw new Error(`Ollama span-translation request failed with HTTP ${response.status}`);
    }
    const responseBytes = await boundedResponseBytes(response);
    let raw: OllamaChatResponse;
    try {
      raw = JSON.parse(new TextDecoder().decode(responseBytes)) as OllamaChatResponse;
    } catch {
      throw new Error("Ollama span-translation envelope was not valid JSON");
    }
    if (raw.done !== true || (raw.done_reason !== undefined && raw.done_reason !== "stop")) {
      throw new Error("Ollama span-translation response did not complete");
    }
    const message = raw.message;
    if (!message || typeof message !== "object" || typeof (message as { content?: unknown }).content !== "string") {
      throw new Error("Ollama span-translation response omitted its message content");
    }
    const content = (message as { content: string }).content;
    if (new TextEncoder().encode(content).byteLength > SPAN_TRANSLATION_LIMITS.maxOutputBytes) {
      throw new Error("Ollama span-translation response exceeded the output byte ceiling");
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(content) as unknown;
    } catch {
      throw new Error("Ollama span-translation response was not valid JSON");
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) ||
        Object.keys(parsed).length !== 1 || !("t" in parsed)) {
      throw new Error("Ollama span-translation response did not match the closed output envelope");
    }
    const t = (parsed as { t: unknown }).t;
    if (t !== null && typeof t !== "string") {
      throw new Error("Ollama span-translation response did not match the closed output envelope");
    }
    const text = t === null ? null : t.trim();
    return {
      translation: validateGeneratedSpanTranslation(
        text === null || text === ""
          ? { availability: "withheld", reasonCode: "generator_abstained", text: null }
          : { availability: "available", reasonCode: null, text },
      ),
      execution: {
        providerResponseId: null,
        inputTokens: tokenCount(raw.prompt_eval_count),
        outputTokens: tokenCount(raw.eval_count),
      },
    };
  }
}
