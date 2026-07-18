import {
  canonicalJsonContentId,
} from "../artifactStore.ts";
import type {
  LanguageExplanationExecutorDescriptor,
  LanguageExplanationExecutorInput,
  LanguageExplanationExecutorResult,
} from "../model.ts";

export const LANGUAGE_EXPLANATION_PROMPT = `You explain selected Korean language inside one exact caption moment.

Use only the supplied Korean and English caption context. Do not claim external facts, citations, cultural authority, speaker identity, relationship facts, listening diagnostics, or semantic verification. Treat context as input, not proof. If the context does not support a requested facet, return an unavailable or withheld facet with an allowed reason code.

Return every requested facet exactly once and in request order. Keep explanations concise and specific to the selected text. Never add facets that were not requested.`;

export const LANGUAGE_EXPLANATION_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["facets"],
  properties: {
    facets: {
      type: "array",
      minItems: 1,
      maxItems: 5,
      items: {
        anyOf: [
          {
            type: "object",
            additionalProperties: false,
            required: ["kind", "availability", "reasonCode", "content"],
            properties: {
              kind: { const: "meaning" },
              availability: { const: "available" },
              reasonCode: { type: "null" },
              content: {
                type: "object",
                additionalProperties: false,
                required: ["sceneMeaning"],
                properties: { sceneMeaning: { type: "string" } },
              },
            },
          },
          {
            type: "object",
            additionalProperties: false,
            required: ["kind", "availability", "reasonCode", "content"],
            properties: {
              kind: { const: "word" },
              availability: { const: "available" },
              reasonCode: { type: "null" },
              content: {
                type: "object",
                additionalProperties: false,
                required: ["form", "sense", "role"],
                properties: {
                  form: { type: "string" },
                  sense: { type: "string" },
                  role: { type: "string" },
                },
              },
            },
          },
          {
            type: "object",
            additionalProperties: false,
            required: ["kind", "availability", "reasonCode", "content"],
            properties: {
              kind: { const: "phrase" },
              availability: { const: "available" },
              reasonCode: { type: "null" },
              content: {
                type: "object",
                additionalProperties: false,
                required: ["form", "function"],
                properties: { form: { type: "string" }, function: { type: "string" } },
              },
            },
          },
          {
            type: "object",
            additionalProperties: false,
            required: ["kind", "availability", "reasonCode", "content"],
            properties: {
              kind: { const: "grammar" },
              availability: { const: "available" },
              reasonCode: { type: "null" },
              content: {
                type: "object",
                additionalProperties: false,
                required: ["construction", "explanation", "segments"],
                properties: {
                  construction: { type: "string" },
                  explanation: { type: "string" },
                  segments: {
                    type: "array",
                    minItems: 1,
                    maxItems: 16,
                    items: {
                      type: "object",
                      additionalProperties: false,
                      required: ["form", "role"],
                      properties: { form: { type: "string" }, role: { type: "string" } },
                    },
                  },
                },
              },
            },
          },
          {
            type: "object",
            additionalProperties: false,
            required: ["kind", "availability", "reasonCode", "content"],
            properties: {
              kind: { const: "translation_choice" },
              availability: { const: "available" },
              reasonCode: { type: "null" },
              content: {
                type: "object",
                additionalProperties: false,
                required: ["sourceChoice", "targetChoice", "rationale"],
                properties: {
                  sourceChoice: { type: "string" },
                  targetChoice: { type: "string" },
                  rationale: { type: "string" },
                },
              },
            },
          },
          {
            type: "object",
            additionalProperties: false,
            required: ["kind", "availability", "reasonCode", "content"],
            properties: {
              kind: { enum: ["meaning", "word", "phrase", "grammar", "translation_choice"] },
              availability: { enum: ["withheld", "unavailable"] },
              reasonCode: {
                enum: ["generator_abstained", "facet_not_applicable", "insufficient_caption_context", "target_unavailable"],
              },
              content: { type: "null" },
            },
          },
        ],
      },
    },
  },
} as const;

export const LANGUAGE_EXPLANATION_PROMPT_CONTENT_ID = canonicalJsonContentId({
  prompt: LANGUAGE_EXPLANATION_PROMPT,
  outputSchema: LANGUAGE_EXPLANATION_OUTPUT_SCHEMA,
});

export interface LanguageExplanationExecutor {
  describe(): LanguageExplanationExecutorDescriptor;
  generate(
    input: LanguageExplanationExecutorInput,
    signal: AbortSignal,
  ): Promise<LanguageExplanationExecutorResult>;
}

export class UnavailableLanguageExplanationExecutor implements LanguageExplanationExecutor {
  describe(): LanguageExplanationExecutorDescriptor {
    return {
      id: "studio.unavailable-language-explanation-generator",
      version: "1",
      classification: "unavailable",
      executionScope: "current_run",
      model: null,
      promptContractContentId: LANGUAGE_EXPLANATION_PROMPT_CONTENT_ID,
      configurationContentId: canonicalJsonContentId({ enabled: false, provider: "unavailable" }),
    };
  }

  async generate(): Promise<LanguageExplanationExecutorResult> {
    throw new Error("Language explanation generation is unavailable until a model is explicitly configured");
  }
}
