import type {
  LanguageExplanationAttemptState,
  LanguageExplanationRequest,
} from "../runtime/production/model/languageExplanations.ts";
import {
  LANGUAGE_EXPLANATION_FACET_KINDS,
  LANGUAGE_EXPLANATION_LIMITS,
} from "../runtime/production/model/languageExplanations.ts";
import type { RuntimeHostLanguageExplanationResponse } from "../runtime/production/runtimeHost/model.ts";
import {
  codePointSlice,
  type LearningViewingSource,
  type SelectedLanguageSpan,
} from "../learning/model.ts";
import {
  learningRequestKey,
  type LearningExplanationState,
  type LearningSelectionRequest,
} from "../learning/presentation.ts";
import { projectVerifiedProductionLearningExplanation } from "../learning/productionExplanationAdapter.ts";
import { validateLearningViewingSource } from "../learning/sourceAdapters.ts";

type ProductionSource = Extract<LearningViewingSource, { context: { origin: "verified_production_caption" } }>;

export interface ProductionLearningRuntimeClient {
  languageExplanations(runtimeId: string): Promise<RuntimeHostLanguageExplanationResponse>;
  createLanguageExplanation(
    runtimeId: string,
    request: LanguageExplanationRequest,
  ): Promise<RuntimeHostLanguageExplanationResponse>;
}

export interface ProductionLearningControllerInput {
  runtimeId: string;
  source: ProductionSource;
  request: LearningSelectionRequest;
}

export class ProductionLearningController {
  private generation = 0;
  private readonly client: ProductionLearningRuntimeClient;

  constructor(client: ProductionLearningRuntimeClient) {
    this.client = client;
  }

  invalidate(): void {
    this.generation += 1;
  }

  async request(input: ProductionLearningControllerInput): Promise<LearningExplanationState> {
    const generation = ++this.generation;
    const invalid = validateControllerInput(input);
    if (invalid) return invalid;
    try {
      const cold = await this.client.languageExplanations(input.runtimeId);
      if (generation !== this.generation) return staleState(input);
      const existing = stateFromResponse(input, cold);
      if (existing) return existing;
      return await this.create(input, generation);
    } catch (error) {
      return failedState(input, error, "available");
    }
  }

  async retry(input: ProductionLearningControllerInput): Promise<LearningExplanationState> {
    const generation = ++this.generation;
    const invalid = validateControllerInput(input);
    if (invalid) return invalid;
    try {
      const cold = await this.client.languageExplanations(input.runtimeId);
      if (generation !== this.generation) return staleState(input);
      const result = matchingResult(input, cold);
      if (result) return projectVerifiedProductionLearningExplanation(input.source, input.request, result);
      const attempts = matchingAttempts(input, cold);
      if (attempts.some((attempt) => attempt.status === "started")) return loadingState(input);
      if (attempts.length === 0) {
        return failedState(input, "There is no failed production attempt to retry.", "unavailable");
      }
      if (attempts.length >= LANGUAGE_EXPLANATION_LIMITS.maxAttemptsPerRequest) {
        return exhaustedState(input);
      }
      return await this.create(input, generation);
    } catch (error) {
      return failedState(input, error, "available");
    }
  }

  private async create(
    input: ProductionLearningControllerInput,
    generation: number,
  ): Promise<LearningExplanationState> {
    try {
      const response = await this.client.createLanguageExplanation(input.runtimeId, runtimeRequest(input));
      if (generation !== this.generation) return staleState(input);
      const state = stateFromResponse(input, response);
      return state ?? failedState(
        input,
        "The runtime host returned no matching attempt or verified explanation.",
        "unavailable",
      );
    } catch (error) {
      if (generation !== this.generation) return staleState(input);
      try {
        const cold = await this.client.languageExplanations(input.runtimeId);
        if (generation !== this.generation) return staleState(input);
        const state = stateFromResponse(input, cold);
        if (state) return state;
      } catch {
        // Preserve the original closed host failure below.
      }
      return failedState(input, error, "available");
    }
  }
}

export function productionSelectionRequest(
  source: ProductionSource,
  lineId: string,
  span: SelectedLanguageSpan,
): LearningSelectionRequest {
  validateLearningViewingSource(source);
  const moment = source.moments.find((candidate) => candidate.lineId === lineId);
  if (!moment) throw new Error("The selected production caption line does not exist.");
  const selectedSide = span.side === "source" ? moment.source : moment.target;
  if (
    selectedSide.state !== "available" ||
    span.unit !== "unicode_code_point" ||
    span.start < 0 || span.end <= span.start ||
    codePointSlice(selectedSide.text, span.start, span.end) !== span.text
  ) throw new Error("The exact selected span does not bind to available verified caption text.");
  return {
    lineId,
    startMs: moment.startMs,
    endMs: moment.endMs,
    sourceLanguage: moment.sourceLanguage,
    targetLanguage: moment.targetLanguage,
    source: moment.source,
    target: moment.target,
    span: { ...span },
  };
}

function validateControllerInput(input: ProductionLearningControllerInput): LearningExplanationState | null {
  const requestKey = learningRequestKey(input.source, input.request);
  try {
    validateLearningViewingSource(input.source);
    if (input.runtimeId !== input.source.context.identities.runId) {
      throw new Error("The runtime identity does not match the verified production caption.");
    }
    if (input.source.context.authorityState !== "unrevoked") {
      throw new Error("New language explanations are unavailable after caption authority is revoked.");
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
      reasonCode: "invalid_explanation_binding",
      detail: errorMessage(error),
      retry: "unavailable",
    };
  }
  return null;
}

function runtimeRequest(input: ProductionLearningControllerInput): LanguageExplanationRequest {
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
    facetKinds: [...LANGUAGE_EXPLANATION_FACET_KINDS],
  };
}

function stateFromResponse(
  input: ProductionLearningControllerInput,
  response: RuntimeHostLanguageExplanationResponse,
): LearningExplanationState | null {
  if (response.runtimeId !== input.runtimeId) {
    return failedState(input, "The runtime host changed identity while loading learning artifacts.", "unavailable");
  }
  const result = matchingResult(input, response);
  if (result) return projectVerifiedProductionLearningExplanation(input.source, input.request, result);
  const attempts = matchingAttempts(input, response);
  if (attempts.some((attempt) => attempt.status === "started")) return loadingState(input);
  if (attempts.length >= LANGUAGE_EXPLANATION_LIMITS.maxAttemptsPerRequest) return exhaustedState(input);
  if (attempts.some((attempt) => attempt.status === "failed")) {
    return failedState(input, "The production explanation attempt failed closed.", "available");
  }
  return null;
}

function matchingResult(input: ProductionLearningControllerInput, response: RuntimeHostLanguageExplanationResponse) {
  const expected = runtimeRequest(input);
  return response.results.find((result) =>
    sameCaption(result.verification.caption, expected.caption) &&
    result.verification.lineId === expected.lineId &&
    sameSelection(result.verification.selection, expected.selection) &&
    sameFacets(result.artifact.grant.facetKinds, expected.facetKinds)
  );
}

function matchingAttempts(
  input: ProductionLearningControllerInput,
  response: RuntimeHostLanguageExplanationResponse,
): LanguageExplanationAttemptState[] {
  const expected = runtimeRequest(input);
  return response.attempts.filter((attempt) =>
    sameCaption(attempt.caption, expected.caption) &&
    attempt.lineId === expected.lineId &&
    sameSelection(attempt.selection, expected.selection) &&
    sameFacets(attempt.facetKinds, expected.facetKinds)
  );
}

function sameCaption(left: LanguageExplanationRequest["caption"], right: LanguageExplanationRequest["caption"]): boolean {
  return left.jobId === right.jobId && left.artifactId === right.artifactId &&
    left.contentId === right.contentId && left.receiptArtifactId === right.receiptArtifactId &&
    left.receiptId === right.receiptId && left.receiptContentId === right.receiptContentId;
}

function sameSelection(left: LanguageExplanationRequest["selection"], right: LanguageExplanationRequest["selection"]): boolean {
  return left.side === right.side && left.unit === right.unit && left.start === right.start &&
    left.end === right.end && left.text === right.text;
}

function sameFacets(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((facet, index) => facet === right[index]);
}

function loadingState(input: ProductionLearningControllerInput): LearningExplanationState {
  return { state: "loading", requestKey: learningRequestKey(input.source, input.request), request: input.request };
}

function failedState(
  input: ProductionLearningControllerInput,
  error: unknown,
  retry: "available" | "unavailable",
): LearningExplanationState {
  return {
    state: "failed",
    requestKey: learningRequestKey(input.source, input.request),
    request: input.request,
    reasonCode: "explanation_request_failed",
    detail: errorMessage(error),
    retry,
  };
}

function exhaustedState(input: ProductionLearningControllerInput): LearningExplanationState {
  return {
    state: "failed",
    requestKey: learningRequestKey(input.source, input.request),
    request: input.request,
    reasonCode: "explanation_retry_exhausted",
    detail: "The fixed production retry ceiling is exhausted.",
    retry: "unavailable",
  };
}

function staleState(input: ProductionLearningControllerInput): LearningExplanationState {
  return {
    state: "failed",
    requestKey: learningRequestKey(input.source, input.request),
    request: input.request,
    reasonCode: "invalid_explanation_binding",
    detail: "A newer production selection replaced this response before it could be presented.",
    retry: "unavailable",
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : typeof error === "string" ? error : "Production explanation failed closed.";
}
