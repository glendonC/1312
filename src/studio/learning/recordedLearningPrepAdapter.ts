import type { LearningViewingSource } from "./model.ts";
import {
  bindLearningPrototypeFixture,
  type LearningPrototypeFixtureV1,
} from "./prototypeFixture.ts";
import type {
  AvailableLearningFacet,
  LearningFineTuneDraft,
  LearningPrepMoment,
  LearningPrepProjection,
} from "./presentation.ts";

type RecordedSource = Extract<LearningViewingSource, { context: { origin: "recorded_fixture" } }>;

export function recordedLearningPrepKey(
  source: RecordedSource,
  fixture: LearningPrototypeFixtureV1,
  fineTune: LearningFineTuneDraft,
): string {
  return [
    source.context.identities.runId,
    source.context.identities.captionContentId ?? "none",
    fixture.fixtureId,
    fineTune.temperature,
    ...fineTune.armedLenses,
  ].join("\u001f");
}

/**
 * Adapts run-bound design-fixture explanations into the same learning-prep projection consumed by
 * production results. It never upgrades fixture prose to host output: every moment and the ready
 * projection carry design_fixture authority, null execution authority, and no receipt identities.
 */
export function projectRecordedLearningPrep(
  source: RecordedSource,
  fixture: LearningPrototypeFixtureV1,
  fineTune: LearningFineTuneDraft,
): LearningPrepProjection {
  const prepKey = recordedLearningPrepKey(source, fixture, fineTune);
  const prototype = bindLearningPrototypeFixture(source, fixture);
  if (prototype.state !== "ready") {
    return {
      state: "failed",
      prepKey,
      fineTune,
      reasonCode: "invalid_prep_binding",
      detail: "The recorded learning overlay does not bind to this exact recorded caption source.",
      retry: "unavailable",
    };
  }

  const boundSelection = prototype.selections.find((selection) =>
    selection.lineId === fixture.binding.lineId &&
    selection.span.start === 0 &&
    selection.span.end === Array.from(fixture.binding.sourceText).length);
  const meaning = availableFacet(boundSelection?.facets, "meaning");
  const grammar = availableFacet(boundSelection?.facets, "grammar");
  const moments = fineTune.armedLenses.map((lens): LearningPrepMoment => {
    const base = {
      lens,
      lineId: fixture.binding.lineId,
      startMs: fixture.binding.startMs,
      endMs: fixture.binding.endMs,
      dataClass: "design_fixture" as const,
      productionAuthority: false as const,
      executionAuthority: null,
      semanticReviewState: "not_reviewed" as const,
      externalCitationIds: [] as [],
    };
    if (lens === "grammar_salience" && grammar?.kind === "grammar") {
      return {
        ...base,
        lens: "grammar_salience",
        availability: "available",
        reasonCode: null,
        grounding: "caption_context_inference",
        content: {
          construction: grammar.content.construction,
          note: grammar.content.explanation,
        },
      };
    }
    if (lens === "situating" && meaning?.kind === "meaning") {
      return {
        ...base,
        lens: "situating",
        availability: "available",
        reasonCode: null,
        grounding: "caption_context_inference",
        content: { situation: meaning.content.sceneMeaning },
      };
    }
    return {
      ...base,
      availability: "unavailable",
      reasonCode: "design_fixture_not_prepared",
      grounding: "none",
      content: null,
    };
  });
  const availableCount = moments.filter((moment) => moment.availability === "available").length;

  return {
    state: "ready",
    prepKey,
    fineTune,
    resultState: availableCount === 0
      ? "unavailable"
      : availableCount === moments.length ? "completed" : "partial",
    segmentation: { mode: "watch_through", reasonCode: "insufficient_caption_context" },
    moments,
    lenses: fineTune.armedLenses.map((lens) => {
      const surfaced = moments.some((moment) => moment.lens === lens && moment.availability === "available");
      return {
        lens,
        state: surfaced ? "surfaced" : "abstained",
        reasonCode: surfaced
          ? null
          : lens === "culture_reference" || lens === "historical_reference"
            ? "no_reference_detected"
            : "insufficient_caption_context",
        candidateCount: surfaced ? 1 : 0,
      };
    }),
    authority: {
      dataClass: "design_fixture",
      productionAuthority: false,
      executionAuthority: null,
      semanticReviewState: "not_reviewed",
      fixtureId: fixture.fixtureId,
      artifactId: null,
      contentId: null,
      receiptId: null,
      receiptContentId: null,
    },
    nonClaims: [
      "not_runtime_generated",
      "not_semantically_verified",
      "not_production_authority",
      "not_learner_persistence",
    ],
  };
}

function availableFacet<Kind extends AvailableLearningFacet["kind"]>(
  facets: readonly import("./presentation.ts").LearningFacet[] | undefined,
  kind: Kind,
): Extract<AvailableLearningFacet, { kind: Kind }> | undefined {
  return facets?.find((facet): facet is Extract<AvailableLearningFacet, { kind: Kind }> =>
    facet.kind === kind && facet.availability === "available");
}
