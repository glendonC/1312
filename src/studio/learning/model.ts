export type LearningReasonCode =
  | "recorded_silence"
  | "recorded_source_text_missing"
  | "recorded_target_withheld"
  | "recorded_target_text_missing"
  | "production_caption_withheld"
  | "production_caption_unavailable"
  | "explanation_not_prepared"
  | "production_media_playback_unavailable"
  | "caption_authority_revoked"
  | "generator_abstained"
  | "facet_not_applicable"
  | "insufficient_caption_context"
  | "target_unavailable"
  | "explanation_request_failed"
  | "explanation_retry_exhausted"
  | "canonical_saved_item_missing"
  | "export_adapter_missing"
  | "media_export_excluded_from_p0"
  | "invalid_source_binding"
  | "invalid_fixture_binding"
  | "invalid_explanation_binding"
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
      authorityState: "unrevoked" | "revoked_after_completion";
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
        approvalReviewId: string;
        approvalArtifactId: string;
        approvalReceiptId: string;
        approvalReceiptContentId: string;
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
