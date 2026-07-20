import { canonicalJsonContentId } from "../artifactStore.ts";
import type {
  GeneratedSpanTranslation,
  SpanTranslationExecutorDescriptor,
  SpanTranslationExecutorInput,
  SpanTranslationExecutorResult,
} from "../model.ts";
import {
  SPAN_TRANSLATION_PROMPT_CONTENT_ID,
  type SpanTranslationExecutor,
} from "./executor.ts";

export class DeterministicSpanTranslationTestExecutor implements SpanTranslationExecutor {
  private readonly produce: (
    input: SpanTranslationExecutorInput,
  ) => GeneratedSpanTranslation;

  constructor(
    produce: (
      input: SpanTranslationExecutorInput,
    ) => GeneratedSpanTranslation,
  ) {
    this.produce = produce;
  }

  describe(): SpanTranslationExecutorDescriptor {
    return {
      id: "studio.deterministic-span-translation-test-seam",
      version: "1",
      classification: "deterministic_test",
      executionScope: "current_run",
      model: "deterministic-test-model",
      promptContractContentId: SPAN_TRANSLATION_PROMPT_CONTENT_ID,
      configurationContentId: canonicalJsonContentId({ provider: "deterministic_test", version: 1 }),
    };
  }

  async generate(
    input: SpanTranslationExecutorInput,
    signal: AbortSignal,
  ): Promise<SpanTranslationExecutorResult> {
    if (signal.aborted) throw signal.reason;
    return {
      translation: this.produce(structuredClone(input)),
      execution: { providerResponseId: null, inputTokens: null, outputTokens: null },
    };
  }
}
