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
      explanations: {
        state: "unavailable";
        reasonCode: "production_media_playback_unavailable" | "caption_authority_revoked";
      };
      savedItems: { state: "unavailable"; reasonCode: "canonical_saved_item_missing" };
    };

export type LearningPlayback =
  | { state: "available"; currentTimeMs: number; onSeek: (timeMs: number) => void }
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
