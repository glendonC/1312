import type {
  SpanTranslationAttemptState,
  SpanTranslationRequest,
} from "../runtime/production/model/spanTranslations.ts";
import { SPAN_TRANSLATION_LIMITS } from "../runtime/production/model/spanTranslations.ts";
import type { RuntimeHostSpanTranslationResponse } from "../runtime/production/runtimeHost/model.ts";
import type { LearningViewingSource } from "../learning/model.ts";
import {
  learningRequestKey,
  type LearningSelectionRequest,
  type SpanTranslationState,
} from "../learning/presentation.ts";
import { projectVerifiedProductionSpanTranslation } from "../learning/productionTranslationAdapter.ts";
import { validateLearningViewingSource } from "../learning/sourceAdapters.ts";
import { productionSelectionRequest } from "./productionLearningController.ts";
import { RuntimeHostClientError } from "./client/responseGuards.ts";

type ProductionSource = Extract<LearningViewingSource, { context: { origin: "verified_production_caption" } }>;

export interface ProductionSpanTranslationRuntimeClient {
  spanTranslations(runtimeId: string): Promise<RuntimeHostSpanTranslationResponse>;
  createSpanTranslation(
    runtimeId: string,
    request: SpanTranslationRequest,
  ): Promise<RuntimeHostSpanTranslationResponse>;
}

export interface ProductionSpanTranslationControllerInput {
  runtimeId: string;
  source: ProductionSource;
  request: LearningSelectionRequest;
}

export class ProductionSpanTranslationController {
  private generation = 0;
  private readonly client: ProductionSpanTranslationRuntimeClient;
  private readonly inFlight = new Map<string, Promise<SpanTranslationState>>();

  constructor(client: ProductionSpanTranslationRuntimeClient) {
    this.client = client;
  }

  invalidate(): void {
    this.generation += 1;
    this.inFlight.clear();
  }

  request(input: ProductionSpanTranslationControllerInput): Promise<SpanTranslationState> {
    return this.coalesce(input, () => this.performRequest(input));
  }

  retry(input: ProductionSpanTranslationControllerInput): Promise<SpanTranslationState> {
    return this.coalesce(input, () => this.performRetry(input));
  }

  private coalesce(
    input: ProductionSpanTranslationControllerInput,
    operation: () => Promise<SpanTranslationState>,
  ): Promise<SpanTranslationState> {
    const key = learningRequestKey(input.source, input.request);
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

  private async performRequest(input: ProductionSpanTranslationControllerInput): Promise<SpanTranslationState> {
    const generation = ++this.generation;
    const invalid = validateControllerInput(input);
    if (invalid) return invalid;
    try {
      const cold = await this.client.spanTranslations(input.runtimeId);
      if (generation !== this.generation) return staleState(input);
      const existing = stateFromResponse(input, cold);
      if (existing) return existing;
      return await this.create(input, generation);
    } catch (error) {
      return failedState(input, error, "available");
    }
  }

  private async performRetry(input: ProductionSpanTranslationControllerInput): Promise<SpanTranslationState> {
    const generation = ++this.generation;
    const invalid = validateControllerInput(input);
    if (invalid) return invalid;
    try {
      const cold = await this.client.spanTranslations(input.runtimeId);
      if (generation !== this.generation) return staleState(input);
      const result = matchingResult(input, cold);
      if (result) return projectVerifiedProductionSpanTranslation(input.source, input.request, result);
      const attempts = matchingAttempts(input, cold);
      if (attempts.some((attempt) => attempt.status === "started")) return loadingState(input);
      if (attempts.length === 0) {
        return failedState(input, "There is no failed production attempt to retry.", "unavailable");
      }
      if (attempts.length >= SPAN_TRANSLATION_LIMITS.maxAttemptsPerRequest) {
        return exhaustedState(input);
      }
      return await this.create(input, generation);
    } catch (error) {
      return failedState(input, error, "available");
    }
  }

  private async create(
    input: ProductionSpanTranslationControllerInput,
    generation: number,
  ): Promise<SpanTranslationState> {
    try {
      const response = await this.client.createSpanTranslation(input.runtimeId, runtimeRequest(input));
      if (generation !== this.generation) return staleState(input);
      const state = stateFromResponse(input, response);
      return state ?? failedState(
        input,
        "The runtime host returned no matching attempt or verified translation.",
        "unavailable",
      );
    } catch (error) {
      if (generation !== this.generation) return staleState(input);
      try {
        const cold = await this.client.spanTranslations(input.runtimeId);
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

function validateControllerInput(input: ProductionSpanTranslationControllerInput): SpanTranslationState | null {
  const requestKey = learningRequestKey(input.source, input.request);
  try {
    validateLearningViewingSource(input.source);
    if (input.runtimeId !== input.source.context.identities.runId) {
      throw new Error("The runtime identity does not match the verified production caption.");
    }
    if (input.source.context.authorityState !== "unrevoked") {
      throw new Error("New span translations are unavailable after caption authority is revoked.");
    }
    const rebound = productionSelectionRequest(input.source, input.request.lineId, input.request.span);
    if (JSON.stringify(rebound) !== JSON.stringify(input.request)) {
      throw new Error("The selected production caption snapshot is stale.");
    }
  } catch (error) {
    return {
      state: "failed",
      requestKey,
      request: input.request,
      reasonCode: "invalid_translation_binding",
      detail: errorMessage(error),
      retry: "unavailable",
    };
  }
  return null;
}

function runtimeRequest(input: ProductionSpanTranslationControllerInput): SpanTranslationRequest {
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
    lineId: input.request.lineId,
    selection: { ...input.request.span },
  };
}

function stateFromResponse(
  input: ProductionSpanTranslationControllerInput,
  response: RuntimeHostSpanTranslationResponse,
): SpanTranslationState | null {
  if (response.runtimeId !== input.runtimeId) {
    return failedState(input, "The runtime host changed identity while loading translations.", "unavailable");
  }
  const result = matchingResult(input, response);
  if (result) return projectVerifiedProductionSpanTranslation(input.source, input.request, result);
  const attempts = matchingAttempts(input, response);
  if (attempts.some((attempt) => attempt.status === "started")) return loadingState(input);
  if (attempts.length >= SPAN_TRANSLATION_LIMITS.maxAttemptsPerRequest) return exhaustedState(input);
  if (attempts.some((attempt) => attempt.status === "failed")) {
    return failedState(input, "The production translation attempt failed closed.", "available");
  }
  return null;
}

function matchingResult(input: ProductionSpanTranslationControllerInput, response: RuntimeHostSpanTranslationResponse) {
  const expected = runtimeRequest(input);
  return response.results.find((result) =>
    sameCaption(result.verification.caption, expected.caption) &&
    result.verification.lineId === expected.lineId &&
    sameSelection(result.verification.selection, expected.selection)
  );
}

function matchingAttempts(
  input: ProductionSpanTranslationControllerInput,
  response: RuntimeHostSpanTranslationResponse,
): SpanTranslationAttemptState[] {
  const expected = runtimeRequest(input);
  return response.attempts.filter((attempt) =>
    sameCaption(attempt.caption, expected.caption) &&
    attempt.lineId === expected.lineId &&
    sameSelection(attempt.selection, expected.selection)
  );
}

function sameCaption(left: SpanTranslationRequest["caption"], right: SpanTranslationRequest["caption"]): boolean {
  return left.jobId === right.jobId && left.artifactId === right.artifactId &&
    left.contentId === right.contentId && left.receiptArtifactId === right.receiptArtifactId &&
    left.receiptId === right.receiptId && left.receiptContentId === right.receiptContentId;
}

function sameSelection(left: SpanTranslationRequest["selection"], right: SpanTranslationRequest["selection"]): boolean {
  return left.side === right.side && left.unit === right.unit && left.start === right.start &&
    left.end === right.end && left.text === right.text;
}

function loadingState(input: ProductionSpanTranslationControllerInput): SpanTranslationState {
  return { state: "loading", requestKey: learningRequestKey(input.source, input.request), request: input.request };
}

function failedState(
  input: ProductionSpanTranslationControllerInput,
  error: unknown,
  retry: "available" | "unavailable",
): SpanTranslationState {
  return {
    state: "failed",
    requestKey: learningRequestKey(input.source, input.request),
    request: input.request,
    reasonCode: "translation_request_failed",
    detail: errorMessage(error),
    retry,
  };
}

function exhaustedState(input: ProductionSpanTranslationControllerInput): SpanTranslationState {
  return {
    state: "failed",
    requestKey: learningRequestKey(input.source, input.request),
    request: input.request,
    reasonCode: "translation_retry_exhausted",
    detail: "The fixed production retry ceiling is exhausted.",
    retry: "unavailable",
  };
}

function unavailableExecutorState(
  input: ProductionSpanTranslationControllerInput,
  error: RuntimeHostClientError,
): SpanTranslationState {
  return {
    state: "unavailable",
    requestKey: learningRequestKey(input.source, input.request),
    request: input.request,
    reasonCode: "production_translation_executor_unavailable",
    detail: error.message,
    retry: "unavailable",
  };
}

function staleState(input: ProductionSpanTranslationControllerInput): SpanTranslationState {
  return {
    state: "failed",
    requestKey: learningRequestKey(input.source, input.request),
    request: input.request,
    reasonCode: "invalid_translation_binding",
    detail: "A newer production selection replaced this response before it could be presented.",
    retry: "unavailable",
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : typeof error === "string" ? error : "Production translation failed closed.";
}

function unconfiguredExecutor(error: unknown): error is RuntimeHostClientError {
  return error instanceof RuntimeHostClientError && error.code === "span_translation_unavailable";
}
