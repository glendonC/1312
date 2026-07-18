import { canonicalJsonContentId } from "../artifactStore.ts";
import type {
  GeneratedLanguageExplanationFacet,
  LanguageExplanationExecutorDescriptor,
  LanguageExplanationExecutorInput,
  LanguageExplanationExecutorResult,
} from "../model.ts";
import {
  LANGUAGE_EXPLANATION_PROMPT_CONTENT_ID,
  type LanguageExplanationExecutor,
} from "./executor.ts";

export class DeterministicLanguageExplanationTestExecutor implements LanguageExplanationExecutor {
  private readonly produce: (
    input: LanguageExplanationExecutorInput,
  ) => GeneratedLanguageExplanationFacet[];

  constructor(
    produce: (
      input: LanguageExplanationExecutorInput,
    ) => GeneratedLanguageExplanationFacet[],
  ) {
    this.produce = produce;
  }

  describe(): LanguageExplanationExecutorDescriptor {
    return {
      id: "studio.deterministic-language-explanation-test-seam",
      version: "1",
      classification: "deterministic_test",
      executionScope: "current_run",
      model: "deterministic-test-model",
      promptContractContentId: LANGUAGE_EXPLANATION_PROMPT_CONTENT_ID,
      configurationContentId: canonicalJsonContentId({ provider: "deterministic_test", version: 1 }),
    };
  }

  async generate(
    input: LanguageExplanationExecutorInput,
    signal: AbortSignal,
  ): Promise<LanguageExplanationExecutorResult> {
    if (signal.aborted) throw signal.reason;
    return {
      facets: this.produce(structuredClone(input)),
      execution: { providerResponseId: null, inputTokens: null, outputTokens: null },
    };
  }
}
