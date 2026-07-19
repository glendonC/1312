import type { LearningPrepRequest } from "../runtime/production/model/learningPrep.ts";
import { LEARNING_PREP_LIMITS } from "../runtime/production/model/learningPrep.ts";
import type { RuntimeHostLearningPrepResponse } from "../runtime/production/runtimeHost/model.ts";
import type { LearningViewingSource } from "../learning/model.ts";
import {
  LEARNING_LENS_KINDS,
  LEARNING_TEMPERATURES,
  learningPrepKey,
  type LearningFineTuneDraft,
  type LearningPrepProjection,
} from "../learning/presentation.ts";
import { projectVerifiedProductionLearningPrep } from "../learning/productionPrepAdapter.ts";
import { validateLearningViewingSource } from "../learning/sourceAdapters.ts";
import { RuntimeHostClientError } from "./client/responseGuards.ts";

type ProductionSource = Extract<LearningViewingSource, { context: { origin: "verified_production_caption" } }>;

export interface ProductionLearningPrepRuntimeClient {
  learningPreps(runtimeId: string): Promise<RuntimeHostLearningPrepResponse>;
  createLearningPrep(
    runtimeId: string,
    request: LearningPrepRequest,
  ): Promise<RuntimeHostLearningPrepResponse>;
}

export interface ProductionLearningPrepControllerInput {
  runtimeId: string;
  source: ProductionSource;
  fineTune: LearningFineTuneDraft;
}

/**
 * One explicit learner action creates at most one prep request; cold reads come first so an
 * existing immutable result is never re-executed. Nothing here runs automatically on playback.
 */
export class ProductionLearningPrepController {
  private generation = 0;
  private readonly client: ProductionLearningPrepRuntimeClient;
  private readonly inFlight = new Map<string, Promise<LearningPrepProjection>>();

  constructor(client: ProductionLearningPrepRuntimeClient) {
    this.client = client;
  }

  invalidate(): void {
    this.generation += 1;
    this.inFlight.clear();
  }

  request(input: ProductionLearningPrepControllerInput): Promise<LearningPrepProjection> {
    return this.coalesce(input, () => this.performRequest(input));
  }

  retry(input: ProductionLearningPrepControllerInput): Promise<LearningPrepProjection> {
    return this.coalesce(input, () => this.performRetry(input));
  }

  private coalesce(
    input: ProductionLearningPrepControllerInput,
    operation: () => Promise<LearningPrepProjection>,
  ): Promise<LearningPrepProjection> {
    const key = learningPrepKey(input.source, input.fineTune);
    const existing = this.inFlight.get(key);
    if (existing) return existing;
    const pending = operation();
    this.inFlight.set(key, pending);
    const remove = () => {
      if (this.inFlight.get(key) === pending) this.inFlight.delete(key);
    };
    pending.then(remove, remove);
    return pending;
  }

  private async performRequest(input: ProductionLearningPrepControllerInput): Promise<LearningPrepProjection> {
    const generation = ++this.generation;
    const invalid = validateControllerInput(input);
    if (invalid) return invalid;
    try {
      const cold = await this.client.learningPreps(input.runtimeId);
      if (generation !== this.generation) return staleState(input);
      const existing = stateFromResponse(input, cold);
      if (existing) return existing;
      return await this.create(input, generation);
    } catch (error) {
      return failedState(input, error, "available");
    }
  }

  private async performRetry(input: ProductionLearningPrepControllerInput): Promise<LearningPrepProjection> {
    const generation = ++this.generation;
    const invalid = validateControllerInput(input);
    if (invalid) return invalid;
    try {
      const cold = await this.client.learningPreps(input.runtimeId);
      if (generation !== this.generation) return staleState(input);
      const result = matchingResult(input, cold);
      if (result) return projectVerifiedProductionLearningPrep(input.source, input.fineTune, result);
      const attempts = matchingAttempts(input, cold);
      if (attempts.some((attempt) => attempt.status === "started")) return loadingState(input);
      if (attempts.length === 0) {
        return failedState(input, "There is no failed learning-prep attempt to retry.", "unavailable");
      }
      if (attempts.length >= LEARNING_PREP_LIMITS.maxAttemptsPerRequest) {
        return exhaustedState(input);
      }
      return await this.create(input, generation);
    } catch (error) {
      return failedState(input, error, "available");
    }
  }

  private async create(
    input: ProductionLearningPrepControllerInput,
    generation: number,
  ): Promise<LearningPrepProjection> {
    try {
      const response = await this.client.createLearningPrep(input.runtimeId, runtimeRequest(input));
      if (generation !== this.generation) return staleState(input);
      const state = stateFromResponse(input, response);
      return state ?? failedState(
        input,
        "The runtime host returned no matching attempt or verified learning prep.",
        "unavailable",
      );
    } catch (error) {
      if (generation !== this.generation) return staleState(input);
      try {
        const cold = await this.client.learningPreps(input.runtimeId);
        if (generation !== this.generation) return staleState(input);
        const state = stateFromResponse(input, cold);
        if (state) return state;
      } catch {
        // Preserve the original closed host failure below.
      }
      if (unconfiguredExecutor(error)) return unavailableExecutorState(input, error);
      return failedState(input, error, "available");
    }
  }
}

function validateControllerInput(input: ProductionLearningPrepControllerInput): LearningPrepProjection | null {
  const prepKey = learningPrepKey(input.source, input.fineTune);
  try {
    validateLearningViewingSource(input.source);
    if (input.runtimeId !== input.source.context.identities.runId) {
      throw new Error("The runtime identity does not match the verified production caption.");
    }
    if (
      input.fineTune.armedLenses.length === 0 ||
      input.fineTune.armedLenses.some((lens) => !LEARNING_LENS_KINDS.includes(lens)) ||
      new Set(input.fineTune.armedLenses).size !== input.fineTune.armedLenses.length ||
      !LEARNING_TEMPERATURES.includes(input.fineTune.temperature)
    ) {
      throw new Error("Learning prep requires a unique non-empty set of armed lenses and one closed temperature.");
    }
  } catch (error) {
    return {
      state: "failed",
      prepKey,
      fineTune: input.fineTune,
      reasonCode: "invalid_prep_binding",
      detail: errorMessage(error),
      retry: "unavailable",
    };
  }
  if (input.source.context.authorityState !== "unrevoked") {
    return {
      state: "unavailable",
      prepKey,
      fineTune: input.fineTune,
      reasonCode: "caption_authority_revoked",
      detail: "Caption authority was revoked, so no new learning prep may be requested.",
      retry: "unavailable",
    };
  }
  return null;
}

function runtimeRequest(input: ProductionLearningPrepControllerInput): LearningPrepRequest {
  const identities = input.source.context.identities;
  return {
    caption: {
      jobId: identities.captionJobId,
      artifactId: identities.captionArtifactId,
      contentId: identities.captionContentId,
      receiptArtifactId: identities.captionReceiptArtifactId,
      receiptId: identities.captionReceiptId,
      receiptContentId: identities.captionReceiptContentId,
    },
    fineTune: {
      schema: "studio.learning-fine-tune.v1",
      armedLenses: [...input.fineTune.armedLenses],
      temperature: input.fineTune.temperature,
    },
  };
}

function stateFromResponse(
  input: ProductionLearningPrepControllerInput,
  response: RuntimeHostLearningPrepResponse,
): LearningPrepProjection | null {
  if (response.runtimeId !== input.runtimeId) {
    return failedState(input, "The runtime host changed identity while loading learning-prep artifacts.", "unavailable");
  }
  const result = matchingResult(input, response);
  if (result) return projectVerifiedProductionLearningPrep(input.source, input.fineTune, result);
  const attempts = matchingAttempts(input, response);
  if (attempts.some((attempt) => attempt.status === "started")) return loadingState(input);
  if (attempts.length >= LEARNING_PREP_LIMITS.maxAttemptsPerRequest) return exhaustedState(input);
  if (attempts.some((attempt) => attempt.status === "failed")) {
    return failedState(input, "The learning-prep attempt failed closed.", "available");
  }
  return null;
}

function matchingResult(
  input: ProductionLearningPrepControllerInput,
  response: RuntimeHostLearningPrepResponse,
) {
  const expected = runtimeRequest(input);
  return response.results.find((result) =>
    sameCaption(result.verification.caption, expected.caption) &&
    sameFineTune(result.verification.fineTune, expected.fineTune)
  );
}

function matchingAttempts(
  input: ProductionLearningPrepControllerInput,
  response: RuntimeHostLearningPrepResponse,
) {
  const expected = runtimeRequest(input);
  return response.attempts.filter((attempt) =>
    sameCaption(attempt.caption, expected.caption) &&
    sameFineTune(attempt.fineTune, expected.fineTune)
  );
}

function sameCaption(left: LearningPrepRequest["caption"], right: LearningPrepRequest["caption"]): boolean {
  return left.jobId === right.jobId && left.artifactId === right.artifactId &&
    left.contentId === right.contentId && left.receiptArtifactId === right.receiptArtifactId &&
    left.receiptId === right.receiptId && left.receiptContentId === right.receiptContentId;
}

function sameFineTune(left: LearningPrepRequest["fineTune"], right: LearningPrepRequest["fineTune"]): boolean {
  return left.schema === right.schema && left.temperature === right.temperature &&
    left.armedLenses.length === right.armedLenses.length &&
    left.armedLenses.every((lens, index) => lens === right.armedLenses[index]);
}

function loadingState(input: ProductionLearningPrepControllerInput): LearningPrepProjection {
  return {
    state: "loading",
    prepKey: learningPrepKey(input.source, input.fineTune),
    fineTune: input.fineTune,
  };
}

function failedState(
  input: ProductionLearningPrepControllerInput,
  error: unknown,
  retry: "available" | "unavailable",
): LearningPrepProjection {
  return {
    state: "failed",
    prepKey: learningPrepKey(input.source, input.fineTune),
    fineTune: input.fineTune,
    reasonCode: "prep_request_failed",
    detail: errorMessage(error),
    retry,
  };
}

function exhaustedState(input: ProductionLearningPrepControllerInput): LearningPrepProjection {
  return {
    state: "failed",
    prepKey: learningPrepKey(input.source, input.fineTune),
    fineTune: input.fineTune,
    reasonCode: "prep_retry_exhausted",
    detail: "The fixed learning-prep retry ceiling is exhausted.",
    retry: "unavailable",
  };
}

function unavailableExecutorState(
  input: ProductionLearningPrepControllerInput,
  error: RuntimeHostClientError,
): LearningPrepProjection {
  return {
    state: "unavailable",
    prepKey: learningPrepKey(input.source, input.fineTune),
    fineTune: input.fineTune,
    reasonCode: "production_prep_executor_unavailable",
    detail: error.message,
    retry: "unavailable",
  };
}

function staleState(input: ProductionLearningPrepControllerInput): LearningPrepProjection {
  return {
    state: "failed",
    prepKey: learningPrepKey(input.source, input.fineTune),
    fineTune: input.fineTune,
    reasonCode: "invalid_prep_binding",
    detail: "A newer fine-tune replaced this learning-prep response before it could be presented.",
    retry: "unavailable",
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : typeof error === "string" ? error : "Learning prep failed closed.";
}

function unconfiguredExecutor(error: unknown): error is RuntimeHostClientError {
  return error instanceof RuntimeHostClientError && error.code === "learning_prep_unavailable";
}
