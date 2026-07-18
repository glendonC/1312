export type LearningReasonCode =
  | "recorded_silence"
  | "recorded_source_text_missing"
  | "recorded_target_withheld"
  | "recorded_target_text_missing"
  | "production_caption_withheld"
  | "production_caption_unavailable"
  | "explanation_not_prepared"
  | "prototype_facet_not_prepared"
  | "follow_up_producer_missing"
  | "practice_checker_missing"
  | "canonical_saved_item_missing"
  | "export_adapter_missing"
  | "media_export_excluded_from_p0"
  | "invalid_source_binding"
  | "invalid_fixture_binding"
  | "mixed_authority";

export type PresentedText =
  | {
      state: "available";
      text: string;
      reasonCode: null;
      upstreamReasonCode: null;
      detail: null;
    }
  | {
      state: "withheld" | "unavailable";
      text: null;
      reasonCode: LearningReasonCode;
      upstreamReasonCode: string | null;
      detail: string;
    };

export interface LearningRightsProjection {
  basis: "recorded_provider_licence" | "production_private_source_policy";
  licence: string | null;
  attribution: string | null;
  mediaExport: {
    state: "unavailable";
    reasonCode: "media_export_excluded_from_p0";
  };
  textExport: {
    state: "unavailable";
    reasonCode: "canonical_saved_item_missing" | "export_adapter_missing";
  };
}

export type LearningSourceContext =
  | {
      origin: "recorded_fixture";
      identities: {
        runId: string;
        sourceId: string;
        sourceContentId: string | null;
        cueIds: string[];
        captionArtifactId: string | null;
        captionContentId: string | null;
      };
      rights: LearningRightsProjection;
      nonClaims: readonly [
        "recorded_index_not_original_worker_lineage",
        "semantic_correctness_not_assessed",
        "production_authority_not_granted",
      ];
    }
  | {
      origin: "verified_production_caption";
      identities: {
        runId: string;
        sourceArtifactId: string;
        sourceContentId: string;
        analysisRequestId: string;
        studyId: string;
        studyArtifactId: string;
        studyContentId: string;
        readinessId: string;
        readinessArtifactId: string;
        readinessReceiptId: string;
        readinessReceiptContentId: string;
        captionJobId: string;
        captionArtifactId: string;
        captionContentId: string;
        captionReceiptArtifactId: string;
        captionReceiptId: string;
        captionReceiptContentId: string;
        lineIds: string[];
      };
      rights: LearningRightsProjection;
      nonClaims: readonly [
        "semantic_correctness_not_assessed",
        "translation_quality_not_assessed",
        "publication_not_authorized",
      ];
    };

interface PresentedMomentBase {
  lineId: string;
  startMs: number;
  endMs: number;
  sourceLanguage: string;
  targetLanguage: string;
  source: PresentedText;
  target: PresentedText;
}

export type RecordedPresentedMoment = PresentedMomentBase & {
  support: {
    state: "none";
    claimIds: [];
    citationIds: [];
    semanticEvidenceArtifactIds: [];
    semanticEvidenceReceiptIds: [];
  };
};

export type ProductionPresentedMoment = PresentedMomentBase & {
  support:
    | RecordedPresentedMoment["support"]
    | {
        state: "caption_line_support";
        claimIds: string[];
        citationIds: string[];
        semanticEvidenceArtifactIds: string[];
        semanticEvidenceReceiptIds: string[];
      };
};

export type PresentedMoment = RecordedPresentedMoment | ProductionPresentedMoment;

export type LearningViewingSource =
  | {
      context: Extract<LearningSourceContext, { origin: "recorded_fixture" }>;
      moments: RecordedPresentedMoment[];
    }
  | {
      context: Extract<LearningSourceContext, { origin: "verified_production_caption" }>;
      moments: ProductionPresentedMoment[];
    };

export type LearningSourceProjection =
  | { state: "ready"; source: LearningViewingSource }
  | { state: "failed"; reasonCode: "invalid_source_binding" | "mixed_authority" };

export interface SelectedLanguageSpan {
  side: "source" | "target";
  unit: "unicode_code_point";
  start: number;
  end: number;
  text: string;
}

export type LearningInsightKind =
  | "meaning"
  | "word"
  | "phrase"
  | "grammar"
  | "register"
  | "pragmatics"
  | "relationship"
  | "translation_choice"
  | "listening_difficulty"
  | "culture"
  | "reference";

export interface InsightContentByKind {
  meaning: { sceneMeaning: string };
  word: { form: string; sense: string; role: string };
  phrase: { form: string; function: string };
  grammar: {
    construction: string;
    explanation: string;
    segments: Array<{ form: string; role: string }>;
  };
  register: { observation: string; implication: string };
  pragmatics: { observation: string; implication: string };
  relationship: { observation: string; implication: string };
  translation_choice: { sourceChoice: string; targetChoice: string; rationale: string };
  listening_difficulty: { signal: string; difficulty: string; listeningCue: string };
  culture: { context: string; sourceLabel: string | null };
  reference: { context: string; sourceLabel: string };
}

interface LearningInsightAuthority {
  authority: "design_fixture" | "producer_verified";
  semanticReviewState: "not_reviewed" | "reviewed";
  claimIds: string[];
  citationIds: string[];
}

export type AvailableLearningInsight = {
  [Kind in LearningInsightKind]: LearningInsightAuthority & {
    kind: Kind;
    availability: "available";
    reasonCode: null;
    content: InsightContentByKind[Kind];
  };
}[LearningInsightKind];

export interface MissingLearningInsight extends LearningInsightAuthority {
  kind: LearningInsightKind;
  availability: "withheld" | "unavailable";
  reasonCode: LearningReasonCode;
  content: null;
}

export type LearningInsight = AvailableLearningInsight | MissingLearningInsight;

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
  insights: LearningInsight[];
  authority: {
    dataClass: "design_fixture";
    productionAuthority: false;
    semanticReviewState: "not_reviewed";
    semanticReviewReceiptId: null;
  };
  nonClaims: readonly string[];
}

export type LearningPrototypeProjection =
  | {
      state: "ready";
      context: Extract<LearningSourceContext, { origin: "recorded_fixture" }>;
      selections: PreparedLearningSelection[];
      unavailableDemonstrationLineId: string;
    }
  | {
      state: "failed";
      reasonCode: "invalid_source_binding" | "invalid_fixture_binding" | "mixed_authority";
    };

export interface SessionSavedSelection {
  dataClass: "learner_owned_session_state";
  id: string;
  sourceOrigin: LearningSourceContext["origin"];
  lineId: string;
  startMs: number;
  endMs: number;
  sourceLanguage: string;
  targetLanguage: string;
  sourceText: string;
  target: PresentedText;
  selection: SelectedLanguageSpan;
  insightKinds: LearningInsightKind[];
  practice: { state: "unavailable"; reasonCode: "practice_checker_missing" };
  export: { state: "unavailable"; reasonCode: "canonical_saved_item_missing" };
}

export function codePointSlice(text: string, start: number, end: number): string {
  return Array.from(text).slice(start, end).join("");
}

export function fullCodePointSpan(text: string, side: SelectedLanguageSpan["side"]): SelectedLanguageSpan {
  return {
    side,
    unit: "unicode_code_point",
    start: 0,
    end: Array.from(text).length,
    text,
  };
}
