import type { CaptionLineReasonCode, CaptionLineState } from "./captions.ts";
import type { StudyReadinessReceiptIdentity } from "./studies.ts";

export const LANGUAGE_EXPLANATION_FACET_KINDS = [
  "meaning",
  "word",
  "phrase",
  "grammar",
  "translation_choice",
] as const;

export type LanguageExplanationFacetKind = (typeof LANGUAGE_EXPLANATION_FACET_KINDS)[number];

export const LANGUAGE_EXPLANATION_LIMITS = {
  maxContextLines: 5,
  maxRequestedFacets: 5,
  maxAttemptsPerRequest: 3,
  maxSelectionCodePoints: 256,
  maxCaptionTextBytes: 32 * 1024,
  maxFacetTextBytes: 8 * 1024,
  maxOutputBytes: 64 * 1024,
  maxProviderResponseBytes: 128 * 1024,
  maxArtifactBytes: 128 * 1024,
  maxCompletionTokens: 4_000,
  maxWallMs: 60_000,
} as const;

export const LANGUAGE_EXPLANATION_INTERRUPTED_REASON =
  "Language explanation was interrupted by an explicit runtime-host recovery; no result was invented.";

export interface LanguageExplanationCaptionIdentity {
  jobId: string;
  artifactId: string;
  contentId: string;
  receiptArtifactId: string;
  receiptId: string;
  receiptContentId: string;
}

export interface LanguageExplanationRequest {
  caption: LanguageExplanationCaptionIdentity;
  lineId: string;
  selection: {
    side: "source" | "target";
    unit: "unicode_code_point";
    start: number;
    end: number;
    text: string;
  };
  facetKinds: LanguageExplanationFacetKind[];
}

export type LanguageExplanationTextSnapshot =
  | {
      language: "ko" | "en";
      state: "available";
      text: string;
      reasonCode: null;
    }
  | {
      language: "ko" | "en";
      state: Exclude<CaptionLineState, "available">;
      text: null;
      reasonCode: CaptionLineReasonCode;
    };

export interface LanguageExplanationContextLine {
  lineId: string;
  startMs: number;
  endMs: number;
  source: LanguageExplanationTextSnapshot;
  target: LanguageExplanationTextSnapshot;
}

export type LanguageExplanationExecutorDescriptor =
  | {
      id: "studio.unavailable-language-explanation-generator";
      version: "1";
      classification: "unavailable";
      executionScope: "current_run";
      model: null;
      promptContractContentId: string;
      configurationContentId: string;
    }
  | {
      id: "studio.deterministic-language-explanation-test-seam";
      version: "1";
      classification: "deterministic_test";
      executionScope: "current_run";
      model: "deterministic-test-model";
      promptContractContentId: string;
      configurationContentId: string;
    }
  | {
      id: "studio.openai-language-explanation-generator";
      version: "1";
      classification: "real_model";
      executionScope: "current_run";
      model: string;
      promptContractContentId: string;
      configurationContentId: string;
    };

export interface LanguageExplanationGrant {
  schema: "studio.language-explanation.grant.v1";
  grantId: string;
  attempt: number;
  runId: string;
  requestFingerprint: string;
  caption: LanguageExplanationCaptionIdentity;
  lineId: string;
  selection: LanguageExplanationRequest["selection"];
  facetKinds: LanguageExplanationFacetKind[];
  rightsScope: "local_processing" | "redistribution";
  disposition: "private_apply_output";
  executor: LanguageExplanationExecutorDescriptor;
  limits: typeof LANGUAGE_EXPLANATION_LIMITS;
}

export interface LanguageExplanationExecutorInput {
  grant: LanguageExplanationGrant;
  line: LanguageExplanationContextLine;
  contextLines: LanguageExplanationContextLine[];
}

export interface LanguageExplanationContentByKind {
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

export type AvailableLanguageExplanationFacet = {
  [Kind in LanguageExplanationFacetKind]: {
    kind: Kind;
    availability: "available";
    reasonCode: null;
    content: LanguageExplanationContentByKind[Kind];
    executionAuthority: "host_receipted";
    semanticReview: "not_reviewed";
    grounding: "caption_context_inference";
    externalCitationIds: [];
  };
}[LanguageExplanationFacetKind];

export interface MissingLanguageExplanationFacet {
  kind: LanguageExplanationFacetKind;
  availability: "withheld" | "unavailable";
  reasonCode:
    | "generator_abstained"
    | "facet_not_applicable"
    | "insufficient_caption_context"
    | "target_unavailable";
  content: null;
  executionAuthority: "host_receipted";
  semanticReview: "not_reviewed";
  grounding: "none";
  externalCitationIds: [];
}

export type LanguageExplanationFacet =
  | AvailableLanguageExplanationFacet
  | MissingLanguageExplanationFacet;

export type GeneratedLanguageExplanationFacet =
  | {
      [Kind in LanguageExplanationFacetKind]: {
        kind: Kind;
        availability: "available";
        reasonCode: null;
        content: LanguageExplanationContentByKind[Kind];
      };
    }[LanguageExplanationFacetKind]
  | {
      kind: LanguageExplanationFacetKind;
      availability: "withheld" | "unavailable";
      reasonCode: MissingLanguageExplanationFacet["reasonCode"];
      content: null;
    };

export interface LanguageExplanationInputAuthority {
  source: {
    artifactId: string;
    contentId: string;
    analysisRequestId: string;
    rightsScope: "local_processing" | "redistribution";
  };
  study: {
    studyId: string;
    artifactId: string;
    contentId: string;
  };
  readiness: StudyReadinessReceiptIdentity;
  approval: {
    reviewId: string;
    artifactId: string;
    receiptId: string;
    receiptContentId: string;
  };
  caption: LanguageExplanationCaptionIdentity;
  line: LanguageExplanationContextLine;
  contextLines: LanguageExplanationContextLine[];
  selection: LanguageExplanationRequest["selection"];
  inputContextLineage: {
    claimIds: string[];
    citationIds: string[];
    semanticEvidenceArtifactIds: string[];
    semanticEvidenceReceiptIds: string[];
  };
}

export const LANGUAGE_EXPLANATION_NON_CLAIMS = [
  "explanation_semantic_correctness_not_assessed",
  "caption_context_not_explanation_evidence",
  "publication_not_authorized",
  "learner_selection_not_runtime_evidence",
] as const;

export interface LanguageExplanationArtifact {
  schema: "studio.language-explanation.artifact.v1";
  jobId: string;
  runId: string;
  input: LanguageExplanationInputAuthority;
  grant: LanguageExplanationGrant;
  executor: LanguageExplanationExecutorDescriptor;
  facets: LanguageExplanationFacet[];
  result: {
    status: "completed" | "partial" | "unavailable";
    requestedFacetCount: number;
    availableFacetCount: number;
    withheldFacetCount: number;
    unavailableFacetCount: number;
  };
  semanticReview: {
    state: "not_reviewed";
    receiptId: null;
  };
  rights: {
    sourceScope: "local_processing" | "redistribution";
    publication: "private";
    exportEligibility: "unavailable";
  };
  nonClaims: typeof LANGUAGE_EXPLANATION_NON_CLAIMS;
}

export interface LanguageExplanationExecutionMeasurement {
  providerResponseId: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
}

export interface LanguageExplanationExecutorResult {
  facets: GeneratedLanguageExplanationFacet[];
  execution: LanguageExplanationExecutionMeasurement;
}

export interface LanguageExplanationReceipt {
  schema: "studio.language-explanation.receipt.v1";
  receiptId: string;
  jobId: string;
  grant: LanguageExplanationGrant;
  input: LanguageExplanationInputAuthority;
  producer: {
    id: "studio.host-language-explanation";
    version: "1";
    policy: "verified_current_caption_private_apply_only";
    executor: LanguageExplanationExecutorDescriptor;
  };
  limits: typeof LANGUAGE_EXPLANATION_LIMITS;
  execution: LanguageExplanationExecutionMeasurement;
  result: LanguageExplanationArtifact["result"] & {
    artifactId: string;
    contentId: string;
    bytes: number;
    facets: Array<{
      kind: LanguageExplanationFacetKind;
      availability: LanguageExplanationFacet["availability"];
      reasonCode: MissingLanguageExplanationFacet["reasonCode"] | null;
    }>;
  };
  nonClaims: typeof LANGUAGE_EXPLANATION_NON_CLAIMS;
}

export interface LanguageExplanationRecord {
  jobId: string;
  attempt: number;
  requestFingerprint: string;
  caption: LanguageExplanationCaptionIdentity;
  lineId: string;
  selection: LanguageExplanationRequest["selection"];
  facetKinds: LanguageExplanationFacetKind[];
  grantId: string;
  executor: LanguageExplanationExecutorDescriptor;
  limits: typeof LANGUAGE_EXPLANATION_LIMITS;
  status: "started" | "completed" | "failed";
  artifactId: string | null;
  contentId: string | null;
  receiptArtifactId: string | null;
  receiptId: string | null;
  receiptContentId: string | null;
  result: LanguageExplanationArtifact["result"] | null;
  failure: string | null;
}

export interface LanguageExplanationVerification {
  integrity: "stored_explanation_and_receipt_with_verified_current_caption";
  jobId: string;
  artifactId: string;
  contentId: string;
  receiptArtifactId: string;
  receiptId: string;
  receiptContentId: string;
  caption: LanguageExplanationCaptionIdentity;
  lineId: string;
  selection: LanguageExplanationRequest["selection"];
  executor: LanguageExplanationExecutorDescriptor;
  result: LanguageExplanationArtifact["result"];
}

export interface VerifiedLanguageExplanationResult {
  verification: LanguageExplanationVerification;
  artifact: LanguageExplanationArtifact;
  receipt: LanguageExplanationReceipt;
}

export interface LanguageExplanationAttemptState {
  jobId: string;
  attempt: number;
  caption: LanguageExplanationCaptionIdentity;
  lineId: string;
  selection: LanguageExplanationRequest["selection"];
  facetKinds: LanguageExplanationFacetKind[];
  status: "started" | "completed" | "failed";
  failure: string | null;
}
