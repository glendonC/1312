import { canonicalJsonContentId } from "../artifactStore.ts";
import type {
  LearningPrepExecutorDescriptor,
  LearningPrepExecutorInput,
  LearningPrepExecutorResult,
} from "../model.ts";

export const LEARNING_PREP_PROMPT = `You prepare an optional learning overlay for one studied clip from its exact Korean and English caption lines.

Use only the supplied caption context. Do not claim external facts, citations, cultural or historical authority, speaker identity, alignment truth, or semantic verification. Caption context is input, not proof. Surface a candidate only when this exact moment justifies it for an armed lens; otherwise abstain with an allowed reason code. Never let the armed temperature turn an abstention into content; temperature only caps how much available help may surface.

Propose beats only when the content warrants segmentation; otherwise return watch_through. Beats must partition every caption line contiguously, completely, and in order. Anchor every candidate to exactly one caption line, at most one candidate per lens per line, ordered by line time then armed lens order. Name every armed lens without candidates in lensAbstentions, in armed order.`;

export const LEARNING_PREP_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["segmentation", "candidates", "lensAbstentions"],
  properties: {
    segmentation: {
      anyOf: [
        {
          type: "object",
          additionalProperties: false,
          required: ["mode", "beats"],
          properties: {
            mode: { enum: ["beats"] },
            beats: {
              type: "array",
              minItems: 1,
              maxItems: 12,
              items: {
                type: "object",
                additionalProperties: false,
                required: ["lineIds"],
                properties: {
                  lineIds: { type: "array", minItems: 1, items: { type: "string" } },
                },
              },
            },
          },
        },
        {
          type: "object",
          additionalProperties: false,
          required: ["mode", "reasonCode"],
          properties: {
            mode: { enum: ["watch_through"] },
            reasonCode: { enum: ["no_beat_boundaries_warranted", "insufficient_caption_context"] },
          },
        },
      ],
    },
    candidates: {
      type: "array",
      maxItems: 24,
      items: {
        anyOf: [
          {
            type: "object",
            additionalProperties: false,
            required: ["lens", "lineId", "availability", "reasonCode", "content"],
            properties: {
              lens: { enum: ["word_order"] },
              lineId: { type: "string" },
              availability: { enum: ["available"] },
              reasonCode: { type: "null" },
              content: {
                type: "object",
                additionalProperties: false,
                required: ["sourcePhrase", "targetPhrase", "note"],
                properties: {
                  sourcePhrase: { type: "string" },
                  targetPhrase: { type: "string" },
                  note: { type: "string" },
                },
              },
            },
          },
          {
            type: "object",
            additionalProperties: false,
            required: ["lens", "lineId", "availability", "reasonCode", "content"],
            properties: {
              lens: { enum: ["grammar_salience"] },
              lineId: { type: "string" },
              availability: { enum: ["available"] },
              reasonCode: { type: "null" },
              content: {
                type: "object",
                additionalProperties: false,
                required: ["construction", "note"],
                properties: { construction: { type: "string" }, note: { type: "string" } },
              },
            },
          },
          {
            type: "object",
            additionalProperties: false,
            required: ["lens", "lineId", "availability", "reasonCode", "content"],
            properties: {
              lens: { enum: ["situating"] },
              lineId: { type: "string" },
              availability: { enum: ["available"] },
              reasonCode: { type: "null" },
              content: {
                type: "object",
                additionalProperties: false,
                required: ["situation"],
                properties: { situation: { type: "string" } },
              },
            },
          },
          {
            type: "object",
            additionalProperties: false,
            required: ["lens", "lineId", "availability", "reasonCode", "content"],
            properties: {
              lens: { enum: ["culture_reference", "historical_reference"] },
              lineId: { type: "string" },
              availability: { enum: ["available"] },
              reasonCode: { type: "null" },
              content: {
                type: "object",
                additionalProperties: false,
                required: ["referent", "note"],
                properties: { referent: { type: "string" }, note: { type: "string" } },
              },
            },
          },
          {
            type: "object",
            additionalProperties: false,
            required: ["lens", "lineId", "availability", "reasonCode", "content"],
            properties: {
              lens: {
                enum: ["word_order", "grammar_salience", "situating", "culture_reference", "historical_reference"],
              },
              lineId: { type: "string" },
              availability: { enum: ["withheld", "unavailable"] },
              reasonCode: {
                enum: ["generator_abstained", "insufficient_caption_context", "external_grounding_unavailable"],
              },
              content: { type: "null" },
            },
          },
        ],
      },
    },
    lensAbstentions: {
      type: "array",
      maxItems: 5,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["lens", "reasonCode"],
        properties: {
          lens: {
            enum: ["word_order", "grammar_salience", "situating", "culture_reference", "historical_reference"],
          },
          reasonCode: {
            enum: ["generator_abstained", "insufficient_caption_context", "no_reference_detected"],
          },
        },
      },
    },
  },
} as const;

export const LEARNING_PREP_PROMPT_CONTENT_ID = canonicalJsonContentId({
  prompt: LEARNING_PREP_PROMPT,
  outputSchema: LEARNING_PREP_OUTPUT_SCHEMA,
});

export interface LearningPrepExecutor {
  describe(): LearningPrepExecutorDescriptor;
  generate(
    input: LearningPrepExecutorInput,
    signal: AbortSignal,
  ): Promise<LearningPrepExecutorResult>;
}

export class UnavailableLearningPrepExecutor implements LearningPrepExecutor {
  describe(): LearningPrepExecutorDescriptor {
    return {
      id: "studio.unavailable-learning-prep-generator",
      version: "1",
      classification: "unavailable",
      executionScope: "current_run",
      model: null,
      promptContractContentId: LEARNING_PREP_PROMPT_CONTENT_ID,
      configurationContentId: canonicalJsonContentId({ enabled: false, provider: "unavailable" }),
    };
  }

  async generate(): Promise<LearningPrepExecutorResult> {
    throw new Error("Learning prep generation is unavailable until a model is explicitly configured");
  }
}
