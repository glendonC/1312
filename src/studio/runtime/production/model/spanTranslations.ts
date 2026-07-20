import type {
  LanguageExplanationCaptionIdentity,
  LanguageExplanationContextLine,
} from "./languageExplanations.ts";
import type { StudyReadinessReceiptIdentity } from "./studies.ts";

export const SPAN_TRANSLATION_LIMITS = {
  maxContextLines: 3,
  maxAttemptsPerRequest: 3,
  maxSelectionCodePoints: 128,
  maxTranslationTextBytes: 2 * 1024,
  maxOutputBytes: 4 * 1024,
  maxProviderResponseBytes: 64 * 1024,
  maxArtifactBytes: 64 * 1024,
  maxCompletionTokens: 200,
  maxWallMs: 20_000,
} as const;

export const SPAN_TRANSLATION_INTERRUPTED_REASON =
  "Span translation was interrupted by an explicit runtime-host recovery; no result was invented.";

/** Span translations bind the same six-part verified caption identity as language explanations. */
export type SpanTranslationCaptionIdentity = LanguageExplanationCaptionIdentity;

/** Span translations reuse the exact caption line snapshot shape language explanations verify. */
export type SpanTranslationContextLine = LanguageExplanationContextLine;

export interface SpanTranslationRequest {
  caption: SpanTranslationCaptionIdentity;
  lineId: string;
  selection: {
    side: "source" | "target";
    unit: "unicode_code_point";
    start: number;
    end: number;
    text: string;
  };
}

export type SpanTranslationExecutorDescriptor =
  | {
      id: "studio.unavailable-span-translation-generator";
      version: "1";
      classification: "unavailable";
      executionScope: "current_run";
      model: null;
      promptContractContentId: string;
      configurationContentId: string;
    }
  | {
      id: "studio.deterministic-span-translation-test-seam";
      version: "1";
      classification: "deterministic_test";
      executionScope: "current_run";
      model: "deterministic-test-model";
      promptContractContentId: string;
      configurationContentId: string;
    }
  | {
      id: "studio.ollama-span-translation-generator";
      version: "1";
      classification: "real_model";
      executionScope: "current_run";
      model: string;
      promptContractContentId: string;
      configurationContentId: string;
    }
  | {
      id: "studio.openai-span-translation-generator";
      version: "1";
      classification: "real_model";
      executionScope: "current_run";
      model: string;
      promptContractContentId: string;
      configurationContentId: string;
    };

export interface SpanTranslationGrant {
  schema: "studio.span-translation.grant.v1";
  grantId: string;
  attempt: number;
  runId: string;
  requestFingerprint: string;
  caption: SpanTranslationCaptionIdentity;
  lineId: string;
  selection: SpanTranslationRequest["selection"];
  rightsScope: "local_processing" | "redistribution";
  disposition: "private_apply_output";
  executor: SpanTranslationExecutorDescriptor;
  limits: typeof SPAN_TRANSLATION_LIMITS;
}

export interface SpanTranslationExecutorInput {
  grant: SpanTranslationGrant;
  line: SpanTranslationContextLine;
  contextLines: SpanTranslationContextLine[];
}

export type GeneratedSpanTranslation =
  | { availability: "available"; reasonCode: null; text: string }
  | {
      availability: "withheld" | "unavailable";
      reasonCode: "generator_abstained" | "insufficient_caption_context";
      text: null;
    };

export type SpanTranslationBody =
  | {
      language: "ko" | "en";
      availability: "available";
      reasonCode: null;
      text: string;
      executionAuthority: "host_receipted";
      semanticReview: "not_reviewed";
      grounding: "caption_context_inference";
      externalCitationIds: [];
    }
  | {
      language: "ko" | "en";
      availability: "withheld" | "unavailable";
      reasonCode: "generator_abstained" | "insufficient_caption_context";
      text: null;
      executionAuthority: "host_receipted";
      semanticReview: "not_reviewed";
      grounding: "none";
      externalCitationIds: [];
    };

export interface SpanTranslationInputAuthority {
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
  caption: SpanTranslationCaptionIdentity;
  line: SpanTranslationContextLine;
  contextLines: SpanTranslationContextLine[];
  selection: SpanTranslationRequest["selection"];
  inputContextLineage: {
    claimIds: string[];
    citationIds: string[];
    semanticEvidenceArtifactIds: string[];
    semanticEvidenceReceiptIds: string[];
  };
}

export const SPAN_TRANSLATION_NON_CLAIMS = [
  "translation_semantic_correctness_not_assessed",
  "caption_context_not_translation_evidence",
  "publication_not_authorized",
  "learner_selection_not_runtime_evidence",
] as const;

export interface SpanTranslationArtifact {
  schema: "studio.span-translation.artifact.v1";
  jobId: string;
  runId: string;
  input: SpanTranslationInputAuthority;
  grant: SpanTranslationGrant;
  executor: SpanTranslationExecutorDescriptor;
  translation: SpanTranslationBody;
  result: {
    status: "completed" | "withheld" | "unavailable";
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
  nonClaims: typeof SPAN_TRANSLATION_NON_CLAIMS;
}

export interface SpanTranslationExecutionMeasurement {
  providerResponseId: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
}

export interface SpanTranslationExecutorResult {
  translation: GeneratedSpanTranslation;
  execution: SpanTranslationExecutionMeasurement;
}

export interface SpanTranslationReceipt {
  schema: "studio.span-translation.receipt.v1";
  receiptId: string;
  jobId: string;
  grant: SpanTranslationGrant;
  input: SpanTranslationInputAuthority;
  producer: {
    id: "studio.host-span-translation";
    version: "1";
    policy: "verified_current_caption_private_apply_only";
    executor: SpanTranslationExecutorDescriptor;
  };
  limits: typeof SPAN_TRANSLATION_LIMITS;
  execution: SpanTranslationExecutionMeasurement;
  result: SpanTranslationArtifact["result"] & {
    availability: SpanTranslationBody["availability"];
    reasonCode: SpanTranslationBody["reasonCode"];
    artifactId: string;
    contentId: string;
    bytes: number;
  };
  nonClaims: typeof SPAN_TRANSLATION_NON_CLAIMS;
}

export interface SpanTranslationRecord {
  jobId: string;
  attempt: number;
  requestFingerprint: string;
  caption: SpanTranslationCaptionIdentity;
  lineId: string;
  selection: SpanTranslationRequest["selection"];
  grantId: string;
  executor: SpanTranslationExecutorDescriptor;
  limits: typeof SPAN_TRANSLATION_LIMITS;
  status: "started" | "completed" | "failed";
  artifactId: string | null;
  contentId: string | null;
  receiptArtifactId: string | null;
  receiptId: string | null;
  receiptContentId: string | null;
  result: SpanTranslationArtifact["result"] | null;
  failure: string | null;
}

export interface SpanTranslationVerification {
  integrity: "stored_translation_and_receipt_with_verified_current_caption";
  jobId: string;
  artifactId: string;
  contentId: string;
  receiptArtifactId: string;
  receiptId: string;
  receiptContentId: string;
  caption: SpanTranslationCaptionIdentity;
  lineId: string;
  selection: SpanTranslationRequest["selection"];
  executor: SpanTranslationExecutorDescriptor;
  result: SpanTranslationArtifact["result"];
}

export interface VerifiedSpanTranslationResult {
  verification: SpanTranslationVerification;
  artifact: SpanTranslationArtifact;
  receipt: SpanTranslationReceipt;
}

export interface SpanTranslationAttemptState {
  jobId: string;
  attempt: number;
  caption: SpanTranslationCaptionIdentity;
  lineId: string;
  selection: SpanTranslationRequest["selection"];
  status: "started" | "completed" | "failed";
  failure: string | null;
}
