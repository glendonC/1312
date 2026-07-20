import type {
  LearningViewingSource,
  PresentedText,
  SelectedLanguageSpan,
} from "./model.ts";

export const LEARNING_FACET_KINDS = [
  "meaning",
  "word",
  "phrase",
  "grammar",
  "translation_choice",
] as const;

export type LearningFacetKind = (typeof LEARNING_FACET_KINDS)[number];

export interface LearningFacetContentByKind {
  meaning: { sceneMeaning: string };
  word: { form: string; sense: string; role: string };
  phrase: { form: string; function: string };
  grammar: {
    construction: string;
    explanation: string;
    segments: Array<{ form: string; role: string }>;
  };
  translation_choice: { sourceChoice: string; targetChoice: string; rationale: string };
}

interface LearningFacetAuthority {
  authority: "design_fixture" | "host_receipted";
  semanticReviewState: "not_reviewed";
  claimIds: [];
  citationIds: [];
}

export type AvailableLearningFacet = {
  [Kind in LearningFacetKind]: LearningFacetAuthority & {
    kind: Kind;
    availability: "available";
    reasonCode: null;
    content: LearningFacetContentByKind[Kind];
  };
}[LearningFacetKind];

export interface MissingLearningFacet extends LearningFacetAuthority {
  kind: LearningFacetKind;
  availability: "withheld" | "unavailable";
  reasonCode:
    | "generator_abstained"
    | "facet_not_applicable"
    | "insufficient_caption_context"
    | "target_unavailable";
  content: null;
}

export type LearningFacet = AvailableLearningFacet | MissingLearningFacet;

export type LearningSelectionAuthority =
  | {
      dataClass: "design_fixture";
      productionAuthority: false;
      executionAuthority: null;
      semanticReviewState: "not_reviewed";
      artifactId: null;
      contentId: null;
      receiptId: null;
      receiptContentId: null;
    }
  | {
      dataClass: "runtime_artifact";
      productionAuthority: true;
      executionAuthority: "host_receipted";
      semanticReviewState: "not_reviewed";
      artifactId: string;
      contentId: string;
      receiptId: string;
      receiptContentId: string;
    };

export interface PreparedLearningSelection {
  selectionId: string;
  lineId: string;
  startMs: number;
  endMs: number;
  sourceLanguage: string;
  targetLanguage: string;
  source: PresentedText;
  target: PresentedText;
  span: SelectedLanguageSpan;
  facets: LearningFacet[];
  authority: LearningSelectionAuthority;
  nonClaims: readonly string[];
}

export type LearningSelectionRequest = Pick<
  PreparedLearningSelection,
  "lineId" | "startMs" | "endMs" | "sourceLanguage" | "targetLanguage" | "source" | "target" | "span"
>;

export type LearningExplanationState =
  | { state: "loading"; requestKey: string; request: LearningSelectionRequest }
  | {
      state: "available" | "partial" | "withheld" | "unavailable";
      requestKey: string;
      selection: PreparedLearningSelection;
    }
  | {
      state: "unavailable";
      requestKey: string;
      request: LearningSelectionRequest;
      reasonCode: "production_explanation_executor_unavailable";
      detail: string;
      retry: "unavailable";
    }
  | {
      state: "failed";
      requestKey: string;
      request: LearningSelectionRequest;
      reasonCode: "explanation_request_failed" | "explanation_retry_exhausted" | "invalid_explanation_binding";
      detail: string;
      retry: "available" | "unavailable";
    };

export type LearningPrototypeProjection =
  | { state: "ready"; selections: PreparedLearningSelection[] }
  | { state: "failed"; reasonCode: "invalid_source_binding" | "invalid_fixture_binding" | "mixed_authority" };

export type LearningPresentation =
  | {
      mode: "prototype";
      source: Extract<LearningViewingSource, { context: { origin: "recorded_fixture" } }>;
      explanations: LearningPrototypeProjection;
      savedItems: { state: "session" };
    }
  | {
      mode: "production";
      source: Extract<LearningViewingSource, { context: { origin: "verified_production_caption" } }>;
      explanations:
        | { state: "ready" }
        | {
            state: "unavailable";
            reasonCode:
              | "production_media_playback_unavailable"
              | "production_explanation_interaction_unavailable"
              | "caption_authority_revoked";
          };
      savedItems: { state: "unavailable"; reasonCode: "canonical_saved_item_missing" };
    };

export type SpanTranslationState =
  | { state: "loading"; requestKey: string; request: LearningSelectionRequest }
  | {
      state: "translated";
      requestKey: string;
      request: LearningSelectionRequest;
      translation: { language: string; text: string };
      authority: {
        dataClass: "runtime_artifact";
        productionAuthority: true;
        executionAuthority: "host_receipted";
        semanticReviewState: "not_reviewed";
        artifactId: string;
        contentId: string;
        receiptId: string;
        receiptContentId: string;
      };
    }
  | {
      state: "withheld";
      requestKey: string;
      request: LearningSelectionRequest;
      reasonCode: "generator_abstained" | "insufficient_caption_context";
    }
  | {
      state: "unavailable";
      requestKey: string;
      request: LearningSelectionRequest;
      reasonCode: "production_translation_executor_unavailable";
      detail: string;
      retry: "unavailable";
    }
  | {
      state: "failed";
      requestKey: string;
      request: LearningSelectionRequest;
      reasonCode: "translation_request_failed" | "translation_retry_exhausted" | "invalid_translation_binding";
      detail: string;
      retry: "available" | "unavailable";
    };

export interface ProductionLearningInteraction {
  explanation: LearningExplanationState | null;
  onRequest: (request: LearningSelectionRequest) => void;
  onRetry: (request: LearningSelectionRequest) => void;
  spanTranslation: SpanTranslationState | null;
  onTranslate: (request: LearningSelectionRequest) => void;
  onTranslateRetry: (request: LearningSelectionRequest) => void;
}

export type LearningPlayback =
  | {
      state: "available";
      authority: "recorded_fixture";
      currentTimeMs: number;
      onSeek: (timeMs: number) => void;
    }
  | {
      state: "available";
      authority: "verified_production_caption";
      binding: {
        runtimeId: string;
        sourceRevisionId: string;
        sourceArtifactId: string;
        sourceContentId: string;
        captionJobId: string;
        captionArtifactId: string;
        captionContentId: string;
        timestampOrigin: { kind: "source_media_zero"; offsetMs: 0 };
      };
      currentTimeMs: number;
      onSeek: (timeMs: number) => void;
    }
  | { state: "unavailable"; reasonCode: "production_media_playback_unavailable" };

export interface SessionSavedSelection {
  dataClass: "learner_owned_session_state";
  id: string;
  sourceOrigin: "recorded_fixture";
  lineId: string;
  startMs: number;
  endMs: number;
  sourceLanguage: string;
  targetLanguage: string;
  sourceText: string;
  target: PresentedText;
  selection: SelectedLanguageSpan;
  facetKinds: LearningFacetKind[];
}

export function learningRequestKey(
  source: Extract<LearningViewingSource, { context: { origin: "verified_production_caption" } }>,
  request: Pick<LearningSelectionRequest, "lineId" | "span">,
): string {
  const identity = source.context.identities;
  return [
    identity.runId,
    identity.captionJobId,
    identity.captionContentId,
    request.lineId,
    request.span.side,
    request.span.start,
    request.span.end,
    request.span.text,
  ].join("\u001f");
}

export const LEARNING_LENS_KINDS = [
  "word_order",
  "grammar_salience",
  "situating",
  "culture_reference",
  "historical_reference",
] as const;

export type LearningLensKind = (typeof LEARNING_LENS_KINDS)[number];

export const LEARNING_TEMPERATURES = ["low", "medium", "high"] as const;

export type LearningTemperature = (typeof LEARNING_TEMPERATURES)[number];

export interface LearningFineTuneDraft {
  armedLenses: LearningLensKind[];
  temperature: LearningTemperature;
}

export interface LearningPrepContentByLens {
  word_order: { sourcePhrase: string; targetPhrase: string; note: string };
  grammar_salience: { construction: string; note: string };
  situating: { situation: string };
  culture_reference: { referent: string; note: string };
  historical_reference: { referent: string; note: string };
}

type LearningPrepMomentAuthority = {
  dataClass: "runtime_artifact";
  productionAuthority: true;
  executionAuthority: "host_receipted";
  semanticReviewState: "not_reviewed";
  externalCitationIds: [];
} | {
  dataClass: "design_fixture";
  productionAuthority: false;
  executionAuthority: null;
  semanticReviewState: "not_reviewed";
  externalCitationIds: [];
};

export type AvailableLearningPrepMoment = {
  [Lens in LearningLensKind]: LearningPrepMomentAuthority & {
    lens: Lens;
    lineId: string;
    startMs: number;
    endMs: number;
    availability: "available";
    reasonCode: null;
    grounding: "caption_context_inference";
    content: LearningPrepContentByLens[Lens];
  };
}[LearningLensKind];

export type MissingLearningPrepMoment = LearningPrepMomentAuthority & {
  lens: LearningLensKind;
  lineId: string;
  startMs: number;
  endMs: number;
  availability: "withheld" | "unavailable";
  reasonCode:
    | "generator_abstained"
    | "insufficient_caption_context"
    | "external_grounding_unavailable"
    | "design_fixture_not_prepared";
  grounding: "none";
  content: null;
};

export type LearningPrepMoment = AvailableLearningPrepMoment | MissingLearningPrepMoment;

export interface LearningPrepLensSummary {
  lens: LearningLensKind;
  state: "surfaced" | "abstained";
  reasonCode: "generator_abstained" | "insufficient_caption_context" | "no_reference_detected" | null;
  candidateCount: number;
}

export type LearningPrepSegmentationView =
  | { mode: "beats"; beats: Array<{ beatId: string; startMs: number; endMs: number; lineIds: string[] }> }
  | { mode: "watch_through"; reasonCode: "no_beat_boundaries_warranted" | "insufficient_caption_context" };

export type LearningPrepProjection =
  | { state: "not_requested" }
  | { state: "loading"; prepKey: string; fineTune: LearningFineTuneDraft }
  | {
      state: "unavailable";
      prepKey: string;
      fineTune: LearningFineTuneDraft;
      reasonCode: "production_prep_executor_unavailable" | "caption_authority_revoked";
      detail: string;
      retry: "unavailable";
    }
  | {
      state: "failed";
      prepKey: string;
      fineTune: LearningFineTuneDraft;
      reasonCode: "prep_request_failed" | "prep_retry_exhausted" | "invalid_prep_binding";
      detail: string;
      retry: "available" | "unavailable";
    }
  | {
      state: "ready";
      prepKey: string;
      fineTune: LearningFineTuneDraft;
      resultState: "completed" | "partial" | "unavailable";
      segmentation: LearningPrepSegmentationView;
      moments: LearningPrepMoment[];
      lenses: LearningPrepLensSummary[];
      authority:
        | {
            dataClass: "runtime_artifact";
            productionAuthority: true;
            executionAuthority: "host_receipted";
            semanticReviewState: "not_reviewed";
            fixtureId: null;
            artifactId: string;
            contentId: string;
            receiptId: string;
            receiptContentId: string;
          }
        | {
            dataClass: "design_fixture";
            productionAuthority: false;
            executionAuthority: null;
            semanticReviewState: "not_reviewed";
            fixtureId: string;
            artifactId: null;
            contentId: null;
            receiptId: null;
            receiptContentId: null;
          };
      nonClaims: readonly string[];
    };

export interface LearningPrepInteraction {
  sourceAuthority: "recorded_fixture" | "verified_production_caption";
  draft: LearningFineTuneDraft;
  prep: LearningPrepProjection;
  availability:
    | { state: "available" }
    | { state: "unavailable"; reasonCode: "caption_authority_revoked" | "prep_interaction_unavailable" };
  onToggleLens: (lens: LearningLensKind) => void;
  onTemperature: (temperature: LearningTemperature) => void;
  onPrepare: () => void;
  onRetry: () => void;
}

export function learningPrepKey(
  source: Extract<LearningViewingSource, { context: { origin: "verified_production_caption" } }>,
  fineTune: LearningFineTuneDraft,
): string {
  const identity = source.context.identities;
  return [
    identity.runId,
    identity.captionJobId,
    identity.captionContentId,
    fineTune.temperature,
    ...fineTune.armedLenses,
  ].join("\u001f");
}
