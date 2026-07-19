import { canonicalJsonContentId } from "../artifactStore.ts";
import type {
  LearningPrepExecutorDescriptor,
  LearningPrepExecutorInput,
  LearningPrepExecutorResult,
} from "../model.ts";
import { LEARNING_PREP_LIMITS } from "../model.ts";
import { validateGeneratedLearningPrepOutput } from "../validation/learningPrep.ts";
import {
  LEARNING_PREP_OUTPUT_SCHEMA,
  LEARNING_PREP_PROMPT,
  LEARNING_PREP_PROMPT_CONTENT_ID,
  type LearningPrepExecutor,
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
    if (Number.isFinite(parsed) && parsed > LEARNING_PREP_LIMITS.maxProviderResponseBytes) {
      throw new Error("OpenAI learning-prep provider envelope exceeded the response byte ceiling");
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
      if (total > LEARNING_PREP_LIMITS.maxProviderResponseBytes) {
        await reader.cancel("learning-prep provider response byte ceiling exceeded");
        throw new Error("OpenAI learning-prep provider envelope exceeded the response byte ceiling");
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
    throw new Error("OpenAI learning-prep response did not complete");
  }
  const texts: string[] = [];
  for (const item of value.output) {
    if (!item || typeof item !== "object") {
      throw new Error("OpenAI learning-prep response contained an invalid output item");
    }
    const type = (item as { type?: unknown }).type;
    if (type === "reasoning") continue;
    if (type !== "message") {
      throw new Error("OpenAI learning-prep response contained an unsupported output item");
    }
    const content = (item as { content?: unknown }).content;
    if (!Array.isArray(content)) {
      throw new Error("OpenAI learning-prep response message omitted content");
    }
    for (const part of content) {
      if (!part || typeof part !== "object" || (part as { type?: unknown }).type !== "output_text" ||
          typeof (part as { text?: unknown }).text !== "string") {
        throw new Error("OpenAI learning-prep response contained refusal or unsupported message content");
      }
      texts.push((part as { text: string }).text);
    }
  }
  if (texts.length !== 1 || !texts[0].trim()) {
    throw new Error("OpenAI learning-prep response must contain exactly one output_text item");
  }
  return texts[0];
}

function tokenCount(value: unknown, key: "input_tokens" | "output_tokens"): number | null {
  if (!value || typeof value !== "object") return null;
  const count = (value as Record<string, unknown>)[key];
  return typeof count === "number" && Number.isSafeInteger(count) && count >= 0 ? count : null;
}

export class OpenAiLearningPrepExecutor implements LearningPrepExecutor {
  private readonly model: string;
  private readonly apiKey: string;

  constructor(input: { model: string; apiKey: string }) {
    if (!input.model.trim() || input.model.trim() !== input.model || input.model.length > 160) {
      throw new Error("OpenAI learning-prep model must be an explicit bounded model id");
    }
    if (!input.apiKey.trim()) throw new Error("OpenAI learning-prep executor requires an API key");
    this.model = input.model;
    this.apiKey = input.apiKey;
  }

  describe(): LearningPrepExecutorDescriptor {
    return {
      id: "studio.openai-learning-prep-generator",
      version: "1",
      classification: "real_model",
      executionScope: "current_run",
      model: this.model,
      promptContractContentId: LEARNING_PREP_PROMPT_CONTENT_ID,
      configurationContentId: canonicalJsonContentId({
        provider: "openai",
        endpoint: RESPONSES_ENDPOINT,
        model: this.model,
        store: false,
        maxOutputTokens: LEARNING_PREP_LIMITS.maxCompletionTokens,
      }),
    };
  }

  async generate(
    input: LearningPrepExecutorInput,
    signal: AbortSignal,
  ): Promise<LearningPrepExecutorResult> {
    const response = await fetch(RESPONSES_ENDPOINT, {
      method: "POST",
      signal,
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        instructions: LEARNING_PREP_PROMPT,
        input: JSON.stringify({
          fineTune: input.grant.fineTune,
          lines: input.lines,
        }),
        text: {
          format: {
            type: "json_schema",
            name: "studio_learning_prep_v1",
            description: "Bounded caption-context learning-prep segmentation, candidates, and abstentions",
            strict: true,
            schema: LEARNING_PREP_OUTPUT_SCHEMA,
          },
        },
        max_output_tokens: LEARNING_PREP_LIMITS.maxCompletionTokens,
        store: false,
      }),
    });
    if (!response.ok) {
      throw new Error(`OpenAI learning-prep request failed with HTTP ${response.status}`);
    }
    const responseBytes = await boundedResponseBytes(response);
    let raw: OpenAiResponse;
    try {
      raw = JSON.parse(new TextDecoder().decode(responseBytes)) as OpenAiResponse;
    } catch {
      throw new Error("OpenAI learning-prep provider envelope was not valid JSON");
    }
    if (typeof raw.id !== "string" || !raw.id.trim()) {
      throw new Error("OpenAI learning-prep response omitted its provider response id");
    }
    const text = outputText(raw);
    if (new TextEncoder().encode(text).byteLength > LEARNING_PREP_LIMITS.maxOutputBytes) {
      throw new Error("OpenAI learning-prep response exceeded the output byte ceiling");
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text) as unknown;
    } catch {
      throw new Error("OpenAI learning-prep response was not valid JSON");
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) ||
        Object.keys(parsed).length !== 3 || !("segmentation" in parsed) ||
        !("candidates" in parsed) || !("lensAbstentions" in parsed)) {
      throw new Error("OpenAI learning-prep response did not match the closed output envelope");
    }
    return {
      output: validateGeneratedLearningPrepOutput(parsed, input.grant.fineTune, input.lines),
      execution: {
        providerResponseId: raw.id,
        inputTokens: tokenCount(raw.usage, "input_tokens"),
        outputTokens: tokenCount(raw.usage, "output_tokens"),
      },
    };
  }
}
