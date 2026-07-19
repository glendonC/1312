import { canonicalJsonContentId } from "../artifactStore.ts";
import type {
  GeneratedLearningPrepOutput,
  LearningPrepExecutorDescriptor,
  LearningPrepExecutorInput,
  LearningPrepExecutorResult,
} from "../model.ts";
import {
  LEARNING_PREP_PROMPT_CONTENT_ID,
  type LearningPrepExecutor,
} from "./executor.ts";

export class DeterministicLearningPrepTestExecutor implements LearningPrepExecutor {
  private readonly produce: (input: LearningPrepExecutorInput) => GeneratedLearningPrepOutput;

  constructor(produce: (input: LearningPrepExecutorInput) => GeneratedLearningPrepOutput) {
    this.produce = produce;
  }

  describe(): LearningPrepExecutorDescriptor {
    return {
      id: "studio.deterministic-learning-prep-test-seam",
      version: "1",
      classification: "deterministic_test",
      executionScope: "current_run",
      model: "deterministic-test-model",
      promptContractContentId: LEARNING_PREP_PROMPT_CONTENT_ID,
      configurationContentId: canonicalJsonContentId({ provider: "deterministic_test", version: 1 }),
    };
  }

  async generate(
    input: LearningPrepExecutorInput,
    signal: AbortSignal,
  ): Promise<LearningPrepExecutorResult> {
    if (signal.aborted) throw signal.reason;
    return {
      output: this.produce(structuredClone(input)),
      execution: { providerResponseId: null, inputTokens: null, outputTokens: null },
    };
  }
}
