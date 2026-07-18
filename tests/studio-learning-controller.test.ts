import assert from "node:assert/strict";
import test from "node:test";

import {
  ProductionLearningController,
  productionSelectionRequest,
  type ProductionLearningRuntimeClient,
} from "../src/studio/localRuntime/productionLearningController.ts";
import type { LearningViewingSource } from "../src/studio/learning/model.ts";
import type { LearningSelectionRequest } from "../src/studio/learning/presentation.ts";
import { projectVerifiedProductionLearningExplanation } from "../src/studio/learning/productionExplanationAdapter.ts";
import {
  LANGUAGE_EXPLANATION_FACET_KINDS,
  LANGUAGE_EXPLANATION_NON_CLAIMS,
  type LanguageExplanationFacet,
  type LanguageExplanationRequest,
  type VerifiedLanguageExplanationResult,
} from "../src/studio/runtime/production/model/languageExplanations.ts";
import type { RuntimeHostLanguageExplanationResponse } from "../src/studio/runtime/production/runtimeHost/model.ts";

type ProductionSource = Extract<LearningViewingSource, { context: { origin: "verified_production_caption" } }>;

function source(): ProductionSource {
  return {
    context: {
      origin: "verified_production_caption",
      authorityState: "unrevoked",
      timeline: {
        analysisRange: { startMs: 0, endMs: 1_000 },
        timestampOrigin: { kind: "source_media_zero", offsetMs: 0 },
      },
      identities: {
        runId: "runtime-1",
        sourceArtifactId: "source-artifact-1",
        sourceContentId: "sha256:source",
        analysisRequestId: "analysis-1",
        studyId: "study-1",
        studyArtifactId: "study-artifact-1",
        studyContentId: "sha256:study",
        readinessId: "readiness-1",
        readinessArtifactId: "readiness-artifact-1",
        readinessReceiptId: "readiness-receipt-1",
        readinessReceiptContentId: "sha256:readiness-receipt",
        approvalReviewId: "review-1",
        approvalArtifactId: "review-artifact-1",
        approvalReceiptId: "review-receipt-1",
        approvalReceiptContentId: "sha256:review-receipt",
        captionJobId: "caption-job-1",
        captionArtifactId: "caption-artifact-1",
        captionContentId: "sha256:caption",
        captionReceiptArtifactId: "caption-receipt-artifact-1",
        captionReceiptId: "caption-receipt-1",
        captionReceiptContentId: "sha256:caption-receipt",
        lineIds: ["line-1"],
      },
      rights: {
        basis: "production_private_source_policy",
        licence: null,
        attribution: null,
        mediaExport: { state: "unavailable", reasonCode: "media_export_excluded_from_p0" },
        textExport: { state: "unavailable", reasonCode: "export_adapter_missing" },
      },
      nonClaims: [
        "semantic_correctness_not_assessed",
        "translation_quality_not_assessed",
        "publication_not_authorized",
      ],
    },
    moments: [{
      lineId: "line-1",
      startMs: 0,
      endMs: 1_000,
      sourceLanguage: "ko",
      targetLanguage: "en",
      source: {
        state: "available",
        text: "현재 실행",
        reasonCode: null,
        upstreamReasonCode: null,
        detail: null,
      },
      target: {
        state: "available",
        text: "Current run",
        reasonCode: null,
        upstreamReasonCode: null,
        detail: null,
      },
      support: {
        state: "none",
        claimIds: [],
        citationIds: [],
        semanticEvidenceArtifactIds: [],
        semanticEvidenceReceiptIds: [],
      },
    }],
  };
}

function request(sourceValue = source()): LearningSelectionRequest {
  return productionSelectionRequest(sourceValue, "line-1", {
    side: "source",
    unit: "unicode_code_point",
    start: 0,
    end: 2,
    text: "현재",
  });
}

function availableFacet(kind: (typeof LANGUAGE_EXPLANATION_FACET_KINDS)[number]): LanguageExplanationFacet {
  const base = {
    kind,
    availability: "available" as const,
    reasonCode: null,
    executionAuthority: "host_receipted" as const,
    semanticReview: "not_reviewed" as const,
    grounding: "caption_context_inference" as const,
    externalCitationIds: [] as [],
  };
  switch (kind) {
    case "meaning": return { ...base, kind, content: { sceneMeaning: "This refers to the current run." } };
    case "word": return { ...base, kind, content: { form: "현재", sense: "current", role: "modifier" } };
    case "phrase": return { ...base, kind, content: { form: "현재 실행", function: "identifies the current run" } };
    case "grammar": return {
      ...base,
      kind,
      content: {
        construction: "현재 + 실행",
        explanation: "A noun modifier precedes the event noun.",
        segments: [{ form: "현재", role: "modifier" }, { form: "실행", role: "event noun" }],
      },
    };
    case "translation_choice": return {
      ...base,
      kind,
      content: { sourceChoice: "현재 실행", targetChoice: "Current run", rationale: "The modifier stays attributive." },
    };
  }
}

function missingFacet(
  kind: (typeof LANGUAGE_EXPLANATION_FACET_KINDS)[number],
  availability: "withheld" | "unavailable" = "unavailable",
): LanguageExplanationFacet {
  return {
    kind,
    availability,
    reasonCode: "insufficient_caption_context",
    content: null,
    executionAuthority: "host_receipted",
    semanticReview: "not_reviewed",
    grounding: "none",
    externalCitationIds: [],
  };
}

function verifiedResult(
  sourceValue: ProductionSource,
  requestValue: LearningSelectionRequest,
  facets: LanguageExplanationFacet[] = [
    availableFacet("meaning"),
    availableFacet("word"),
    missingFacet("phrase"),
    missingFacet("grammar"),
    missingFacet("translation_choice"),
  ],
): VerifiedLanguageExplanationResult {
  const identities = sourceValue.context.identities;
  const caption = {
    jobId: identities.captionJobId,
    artifactId: identities.captionArtifactId,
    contentId: identities.captionContentId,
    receiptArtifactId: identities.captionReceiptArtifactId,
    receiptId: identities.captionReceiptId,
    receiptContentId: identities.captionReceiptContentId,
  };
  const availableFacetCount = facets.filter((facet) => facet.availability === "available").length;
  const withheldFacetCount = facets.filter((facet) => facet.availability === "withheld").length;
  const unavailableFacetCount = facets.filter((facet) => facet.availability === "unavailable").length;
  const status = availableFacetCount === facets.length
    ? "completed"
    : availableFacetCount > 0 ? "partial" : "unavailable";
  const result = {
    status,
    requestedFacetCount: facets.length,
    availableFacetCount,
    withheldFacetCount,
    unavailableFacetCount,
  } as const;
  const artifactId = "language-artifact-1";
  const contentId = "sha256:language";
  const receiptId = "language-receipt-1";
  const receiptContentId = "sha256:language-receipt";
  return {
    verification: {
      integrity: "stored_explanation_and_receipt_with_verified_current_caption",
      jobId: "language-job-1",
      artifactId,
      contentId,
      receiptArtifactId: "language-receipt-artifact-1",
      receiptId,
      receiptContentId,
      caption,
      lineId: requestValue.lineId,
      selection: requestValue.span,
      executor: {
        id: "studio.deterministic-language-explanation-test-seam",
        version: "1",
        classification: "deterministic_test",
        executionScope: "current_run",
        model: "deterministic-test-model",
        promptContractContentId: "sha256:prompt",
        configurationContentId: "sha256:configuration",
      },
      result,
    },
    artifact: {
      schema: "studio.language-explanation.artifact.v1",
      jobId: "language-job-1",
      runId: identities.runId,
      input: {
        source: {
          artifactId: identities.sourceArtifactId,
          contentId: identities.sourceContentId,
          analysisRequestId: identities.analysisRequestId,
          rightsScope: "local_processing",
        },
        study: {
          studyId: identities.studyId,
          artifactId: identities.studyArtifactId,
          contentId: identities.studyContentId,
        },
        readiness: {
          readinessId: identities.readinessId,
          artifactId: identities.readinessArtifactId,
          receiptId: identities.readinessReceiptId,
          receiptContentId: identities.readinessReceiptContentId,
        },
        approval: {
          reviewId: identities.approvalReviewId,
          artifactId: identities.approvalArtifactId,
          receiptId: identities.approvalReceiptId,
          receiptContentId: identities.approvalReceiptContentId,
        },
        caption,
        line: {
          lineId: requestValue.lineId,
          startMs: requestValue.startMs,
          endMs: requestValue.endMs,
          source: { language: "ko", state: "available", text: "현재 실행", reasonCode: null },
          target: { language: "en", state: "available", text: "Current run", reasonCode: null },
        },
        contextLines: [],
        selection: requestValue.span,
        inputContextLineage: {
          claimIds: [],
          citationIds: [],
          semanticEvidenceArtifactIds: [],
          semanticEvidenceReceiptIds: [],
        },
      },
      grant: {
        schema: "studio.language-explanation.grant.v1",
        grantId: "language-grant-1",
        attempt: 0,
        runId: identities.runId,
        requestFingerprint: "sha256:fingerprint",
        caption,
        lineId: requestValue.lineId,
        selection: requestValue.span,
        facetKinds: [...LANGUAGE_EXPLANATION_FACET_KINDS],
        rightsScope: "local_processing",
        disposition: "private_apply_output",
        executor: {
          id: "studio.deterministic-language-explanation-test-seam",
          version: "1",
          classification: "deterministic_test",
          executionScope: "current_run",
          model: "deterministic-test-model",
          promptContractContentId: "sha256:prompt",
          configurationContentId: "sha256:configuration",
        },
        limits: {} as never,
      },
      executor: {
        id: "studio.deterministic-language-explanation-test-seam",
        version: "1",
        classification: "deterministic_test",
        executionScope: "current_run",
        model: "deterministic-test-model",
        promptContractContentId: "sha256:prompt",
        configurationContentId: "sha256:configuration",
      },
      facets,
      result,
      semanticReview: { state: "not_reviewed", receiptId: null },
      rights: { sourceScope: "local_processing", publication: "private", exportEligibility: "unavailable" },
      nonClaims: LANGUAGE_EXPLANATION_NON_CLAIMS,
    },
    receipt: {
      schema: "studio.language-explanation.receipt.v1",
      receiptId,
      jobId: "language-job-1",
      grant: {} as never,
      input: {} as never,
      producer: {} as never,
      limits: {} as never,
      execution: { providerResponseId: null, inputTokens: null, outputTokens: null },
      result: {
        ...result,
        artifactId,
        contentId,
        bytes: 1,
        facets: facets.map((facet) => ({
          kind: facet.kind,
          availability: facet.availability,
          reasonCode: facet.reasonCode,
        })),
      },
      nonClaims: LANGUAGE_EXPLANATION_NON_CLAIMS,
    },
  };
}

function response(
  sourceValue: ProductionSource,
  _requestValue: LearningSelectionRequest,
  options: {
    results?: VerifiedLanguageExplanationResult[];
    attempts?: RuntimeHostLanguageExplanationResponse["attempts"];
  } = {},
): RuntimeHostLanguageExplanationResponse {
  return {
    schema: "studio.local-runtime-language-explanations.v1",
    commandId: "command-1",
    runtimeId: sourceValue.context.identities.runId,
    journalHead: 1,
    attempts: options.attempts ?? [],
    results: options.results ?? [],
  };
}

function attempt(
  sourceValue: ProductionSource,
  requestValue: LearningSelectionRequest,
  number: number,
  status: "started" | "failed" | "completed",
): RuntimeHostLanguageExplanationResponse["attempts"][number] {
  const identities = sourceValue.context.identities;
  return {
    jobId: `language-job-${number}`,
    attempt: number,
    caption: {
      jobId: identities.captionJobId,
      artifactId: identities.captionArtifactId,
      contentId: identities.captionContentId,
      receiptArtifactId: identities.captionReceiptArtifactId,
      receiptId: identities.captionReceiptId,
      receiptContentId: identities.captionReceiptContentId,
    },
    lineId: requestValue.lineId,
    selection: requestValue.span,
    facetKinds: [...LANGUAGE_EXPLANATION_FACET_KINDS],
    status,
    failure: status === "failed" ? "Language explanation generation failed closed" : null,
  };
}

test("verified production adapter maps only five host-receipted facets and exact terminal states", () => {
  const sourceValue = source();
  const requestValue = request(sourceValue);
  const partial = projectVerifiedProductionLearningExplanation(
    sourceValue,
    requestValue,
    verifiedResult(sourceValue, requestValue),
  );
  assert.equal(partial.state, "partial");
  if (partial.state !== "partial") return;
  assert.equal(partial.selection.authority.executionAuthority, "host_receipted");
  assert.equal(partial.selection.authority.semanticReviewState, "not_reviewed");
  assert.deepEqual(partial.selection.facets.map((facet) => facet.kind), LANGUAGE_EXPLANATION_FACET_KINDS);
  assert.equal(JSON.stringify(partial).includes("design_fixture"), false);

  const completedFacets = LANGUAGE_EXPLANATION_FACET_KINDS.map(availableFacet);
  assert.equal(projectVerifiedProductionLearningExplanation(
    sourceValue,
    requestValue,
    verifiedResult(sourceValue, requestValue, completedFacets),
  ).state, "available");
  assert.equal(projectVerifiedProductionLearningExplanation(
    sourceValue,
    requestValue,
    verifiedResult(sourceValue, requestValue, LANGUAGE_EXPLANATION_FACET_KINDS.map((kind) => missingFacet(kind, "withheld"))),
  ).state, "withheld");
  assert.equal(projectVerifiedProductionLearningExplanation(
    sourceValue,
    requestValue,
    verifiedResult(sourceValue, requestValue, LANGUAGE_EXPLANATION_FACET_KINDS.map((kind) => missingFacet(kind))),
  ).state, "unavailable");
});

test("production adapter rejects stale caption identity and unsupported facets without fixture leakage", () => {
  const sourceValue = source();
  const requestValue = request(sourceValue);
  const stale = structuredClone(verifiedResult(sourceValue, requestValue));
  stale.verification.caption.contentId = "sha256:stale-caption";
  assert.equal(projectVerifiedProductionLearningExplanation(sourceValue, requestValue, stale).state, "failed");

  const unsupported = structuredClone(verifiedResult(sourceValue, requestValue)) as unknown as VerifiedLanguageExplanationResult;
  (unsupported.artifact.facets as unknown as Array<{ kind: string }>)[0].kind = "culture";
  const projected = projectVerifiedProductionLearningExplanation(sourceValue, requestValue, unsupported);
  assert.equal(projected.state, "failed");
  assert.equal(JSON.stringify(projected).includes("design_fixture"), false);
});

test("controller cold-reads, creates once, and requests the fixed five-facet contract", async () => {
  const sourceValue = source();
  const requestValue = request(sourceValue);
  const created = verifiedResult(sourceValue, requestValue);
  const posted: LanguageExplanationRequest[] = [];
  const client: ProductionLearningRuntimeClient = {
    async languageExplanations() { return response(sourceValue, requestValue); },
    async createLanguageExplanation(_runtimeId, input) {
      posted.push(input);
      return response(sourceValue, requestValue, {
        attempts: [attempt(sourceValue, requestValue, 0, "completed")],
        results: [created],
      });
    },
  };
  const state = await new ProductionLearningController(client).request({
    runtimeId: "runtime-1",
    source: sourceValue,
    request: requestValue,
  });
  assert.equal(state.state, "partial");
  assert.equal(posted.length, 1);
  assert.deepEqual(posted[0].facetKinds, LANGUAGE_EXPLANATION_FACET_KINDS);
  assert.equal("prompt" in posted[0], false);
});

test("controller exposes explicit retry, loading, and exhausted states without automatic fixture fallback", async () => {
  const sourceValue = source();
  const requestValue = request(sourceValue);
  let created = 0;
  const failedAttempt = attempt(sourceValue, requestValue, 0, "failed");
  const client: ProductionLearningRuntimeClient = {
    async languageExplanations() {
      return response(sourceValue, requestValue, { attempts: [failedAttempt] });
    },
    async createLanguageExplanation() {
      created += 1;
      return response(sourceValue, requestValue, {
        attempts: [failedAttempt, attempt(sourceValue, requestValue, 1, "completed")],
        results: [verifiedResult(sourceValue, requestValue)],
      });
    },
  };
  const controller = new ProductionLearningController(client);
  const failed = await controller.request({ runtimeId: "runtime-1", source: sourceValue, request: requestValue });
  assert.deepEqual({ state: failed.state, retry: failed.state === "failed" ? failed.retry : null }, {
    state: "failed",
    retry: "available",
  });
  assert.equal(created, 0);
  assert.equal((await controller.retry({ runtimeId: "runtime-1", source: sourceValue, request: requestValue })).state, "partial");
  assert.equal(created, 1);

  const loadingClient: ProductionLearningRuntimeClient = {
    async languageExplanations() {
      return response(sourceValue, requestValue, { attempts: [attempt(sourceValue, requestValue, 0, "started")] });
    },
    async createLanguageExplanation() { throw new Error("must not create while loading"); },
  };
  assert.equal((await new ProductionLearningController(loadingClient).request({
    runtimeId: "runtime-1", source: sourceValue, request: requestValue,
  })).state, "loading");

  const exhaustedClient: ProductionLearningRuntimeClient = {
    async languageExplanations() {
      return response(sourceValue, requestValue, {
        attempts: [0, 1, 2].map((number) => attempt(sourceValue, requestValue, number, "failed")),
      });
    },
    async createLanguageExplanation() { throw new Error("must not exceed retry ceiling"); },
  };
  const exhausted = await new ProductionLearningController(exhaustedClient).request({
    runtimeId: "runtime-1", source: sourceValue, request: requestValue,
  });
  assert.equal(exhausted.state, "failed");
  if (exhausted.state === "failed") assert.equal(exhausted.reasonCode, "explanation_retry_exhausted");
});

test("controller rejects mixed authority, invalid spans, failed hosts, and superseded responses", async () => {
  const sourceValue = source();
  const requestValue = request(sourceValue);
  let reads = 0;
  const neverCalled: ProductionLearningRuntimeClient = {
    async languageExplanations() { reads += 1; return response(sourceValue, requestValue); },
    async createLanguageExplanation() { throw new Error("must not create"); },
  };
  const mixed = structuredClone(sourceValue) as unknown as ProductionSource;
  (mixed.context.identities as unknown as Record<string, unknown>).cueIds = ["recorded-cue"];
  const mixedState = await new ProductionLearningController(neverCalled).request({
    runtimeId: "runtime-1", source: mixed, request: requestValue,
  });
  assert.equal(mixedState.state, "failed");
  const invalidSpan = structuredClone(requestValue);
  invalidSpan.span.text = "실행";
  assert.equal((await new ProductionLearningController(neverCalled).request({
    runtimeId: "runtime-1", source: sourceValue, request: invalidSpan,
  })).state, "failed");
  assert.equal(reads, 0);

  const failedHost: ProductionLearningRuntimeClient = {
    async languageExplanations() { return response(sourceValue, requestValue); },
    async createLanguageExplanation() { throw new Error("provider unavailable"); },
  };
  const failed = await new ProductionLearningController(failedHost).request({
    runtimeId: "runtime-1", source: sourceValue, request: requestValue,
  });
  assert.equal(failed.state, "failed");
  assert.equal(JSON.stringify(failed).includes("design_fixture"), false);

  let release!: (value: RuntimeHostLanguageExplanationResponse) => void;
  const pending = new Promise<RuntimeHostLanguageExplanationResponse>((resolve) => { release = resolve; });
  const staleClient: ProductionLearningRuntimeClient = {
    async languageExplanations() { return pending; },
    async createLanguageExplanation() { throw new Error("must not create stale request"); },
  };
  const staleController = new ProductionLearningController(staleClient);
  const inFlight = staleController.request({ runtimeId: "runtime-1", source: sourceValue, request: requestValue });
  staleController.invalidate();
  release(response(sourceValue, requestValue));
  const stale = await inFlight;
  assert.equal(stale.state, "failed");
  if (stale.state === "failed") assert.match(stale.detail, /newer production selection/);
});
