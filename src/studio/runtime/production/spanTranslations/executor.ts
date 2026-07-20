import {
  canonicalJsonContentId,
} from "../artifactStore.ts";
import type {
  SpanTranslationExecutorDescriptor,
  SpanTranslationExecutorInput,
  SpanTranslationExecutorResult,
} from "../model.ts";

export const SPAN_TRANSLATION_PROMPT = `You translate one short selected span from a Korean caption line. The span is a fragment; translate only that fragment, into the requested language, as the fragment functions inside its line. Use only the supplied caption context. Do not claim external facts, citations, cultural authority, speaker identity, or semantic verification.

Reply as JSON {"t": string} with only the translation of the span, or {"t": null} if the context cannot support a translation of the span. Never translate the whole line, never add commentary, and keep the translation shorter than the whole line translation.

Example: line (ko) 지금 비가 와서 못 가 / line (en) It is raining now so I cannot go / span 비가 와서 / requested language en -> {"t": "because it is raining"}`;

export const SPAN_TRANSLATION_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["t"],
  properties: {
    t: { type: ["string", "null"] },
  },
} as const;

export const SPAN_TRANSLATION_PROMPT_CONTENT_ID = canonicalJsonContentId({
  prompt: SPAN_TRANSLATION_PROMPT,
  outputSchema: SPAN_TRANSLATION_OUTPUT_SCHEMA,
});

export interface SpanTranslationExecutor {
  describe(): SpanTranslationExecutorDescriptor;
  generate(
    input: SpanTranslationExecutorInput,
    signal: AbortSignal,
  ): Promise<SpanTranslationExecutorResult>;
}

export class UnavailableSpanTranslationExecutor implements SpanTranslationExecutor {
  describe(): SpanTranslationExecutorDescriptor {
    return {
      id: "studio.unavailable-span-translation-generator",
      version: "1",
      classification: "unavailable",
      executionScope: "current_run",
      model: null,
      promptContractContentId: SPAN_TRANSLATION_PROMPT_CONTENT_ID,
      configurationContentId: canonicalJsonContentId({ enabled: false, provider: "unavailable" }),
    };
  }

  async generate(): Promise<SpanTranslationExecutorResult> {
    throw new Error("Span translation is unavailable until a model is explicitly configured");
  }
}
