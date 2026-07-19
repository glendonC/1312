import type {
  LanguageExplanationCaptionIdentity,
  LanguageExplanationContextLine,
} from "./languageExplanations.ts";
import type { StudyReadinessReceiptIdentity } from "./studies.ts";

export const LEARNING_PREP_LENS_KINDS = [
  "word_order",
  "grammar_salience",
  "situating",
  "culture_reference",
  "historical_reference",
] as const;

export type LearningPrepLensKind = (typeof LEARNING_PREP_LENS_KINDS)[number];

export const LEARNING_PREP_TEMPERATURES = ["low", "medium", "high"] as const;

export type LearningPrepTemperature = (typeof LEARNING_PREP_TEMPERATURES)[number];

export const LEARNING_PREP_LIMITS = {
  maxArmedLenses: 5,
  maxLines: 64,
  maxBeats: 12,
  maxCandidates: 24,
  maxCandidateTextBytes: 2 * 1024,
  maxAttemptsPerRequest: 3,
  maxOutputBytes: 64 * 1024,
  maxProviderResponseBytes: 128 * 1024,
  maxArtifactBytes: 256 * 1024,
  maxCompletionTokens: 4_000,
  maxWallMs: 60_000,
} as const;

/**
 * Temperature bounds only how much available help may surface. It can never turn a withheld or
 * unavailable candidate into an available one.
 */
export const LEARNING_PREP_TEMPERATURE_CEILINGS: Record<
  LearningPrepTemperature,
  { maxAvailablePerBeat: number; maxAvailableTotal: number }
> = {
  low: { maxAvailablePerBeat: 1, maxAvailableTotal: 6 },
  medium: { maxAvailablePerBeat: 2, maxAvailableTotal: 12 },
  high: { maxAvailablePerBeat: 4, maxAvailableTotal: 24 },
} as const;

export const LEARNING_PREP_INTERRUPTED_REASON =
  "Learning prep was interrupted by an explicit runtime-host recovery; no result was invented.";

export type LearningPrepCaptionIdentity = LanguageExplanationCaptionIdentity;

export type LearningPrepContextLine = LanguageExplanationContextLine;

export interface LearningFineTune {
  schema: "studio.learning-fine-tune.v1";
  armedLenses: LearningPrepLensKind[];
  temperature: LearningPrepTemperature;
}

export interface LearningPrepRequest {
  caption: LearningPrepCaptionIdentity;
  fineTune: LearningFineTune;
}

export type LearningPrepExecutorDescriptor =
  | {
      id: "studio.unavailable-learning-prep-generator";
      version: "1";
      classification: "unavailable";
      executionScope: "current_run";
      model: null;
      promptContractContentId: string;
      configurationContentId: string;
    }
  | {
      id: "studio.deterministic-learning-prep-test-seam";
      version: "1";
      classification: "deterministic_test";
      executionScope: "current_run";
      model: "deterministic-test-model";
      promptContractContentId: string;
      configurationContentId: string;
    }
  | {
      id: "studio.openai-learning-prep-generator";
      version: "1";
      classification: "real_model";
      executionScope: "current_run";
      model: string;
      promptContractContentId: string;
      configurationContentId: string;
    };

export interface LearningPrepGrant {
  schema: "studio.learning-prep.grant.v1";
  grantId: string;
  attempt: number;
  runId: string;
  requestFingerprint: string;
  caption: LearningPrepCaptionIdentity;
  fineTune: LearningFineTune;
  rightsScope: "local_processing" | "redistribution";
  disposition: "private_apply_output";
  executor: LearningPrepExecutorDescriptor;
  limits: typeof LEARNING_PREP_LIMITS;
}

export interface LearningPrepInputAuthority {
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
  caption: LearningPrepCaptionIdentity;
  lines: LearningPrepContextLine[];
}

export interface LearningPrepExecutorInput {
  grant: LearningPrepGrant;
  lines: LearningPrepContextLine[];
}

export interface LearningPrepCandidateAnchor {
  lineId: string;
  startMs: number;
  endMs: number;
}

export interface LearningPrepCandidateContentByLens {
  word_order: { sourcePhrase: string; targetPhrase: string; note: string };
  grammar_salience: { construction: string; note: string };
  situating: { situation: string };
  culture_reference: { referent: string; note: string };
  historical_reference: { referent: string; note: string };
}

export type LearningPrepCandidateMissingReasonCode =
  | "generator_abstained"
  | "insufficient_caption_context"
  | "external_grounding_unavailable";

export type LearningPrepLensAbstentionReasonCode =
  | "generator_abstained"
  | "insufficient_caption_context"
  | "no_reference_detected";

export type AvailableLearningPrepCandidate = {
  [Lens in LearningPrepLensKind]: {
    lens: Lens;
    anchor: LearningPrepCandidateAnchor;
    availability: "available";
    reasonCode: null;
    content: LearningPrepCandidateContentByLens[Lens];
    executionAuthority: "host_receipted";
    semanticReview: "not_reviewed";
    grounding: "caption_context_inference";
    externalCitationIds: [];
  };
}[LearningPrepLensKind];

export interface MissingLearningPrepCandidate {
  lens: LearningPrepLensKind;
  anchor: LearningPrepCandidateAnchor;
  availability: "withheld" | "unavailable";
  reasonCode: LearningPrepCandidateMissingReasonCode;
  content: null;
  executionAuthority: "host_receipted";
  semanticReview: "not_reviewed";
  grounding: "none";
  externalCitationIds: [];
}

export type LearningPrepCandidate = AvailableLearningPrepCandidate | MissingLearningPrepCandidate;

export type GeneratedLearningPrepCandidate =
  | {
      [Lens in LearningPrepLensKind]: {
        lens: Lens;
        lineId: string;
        availability: "available";
        reasonCode: null;
        content: LearningPrepCandidateContentByLens[Lens];
      };
    }[LearningPrepLensKind]
  | {
      lens: LearningPrepLensKind;
      lineId: string;
      availability: "withheld" | "unavailable";
      reasonCode: LearningPrepCandidateMissingReasonCode;
      content: null;
    };

export type GeneratedLearningPrepSegmentation =
  | { mode: "beats"; beats: Array<{ lineIds: string[] }> }
  | {
      mode: "watch_through";
      reasonCode: "no_beat_boundaries_warranted" | "insufficient_caption_context";
    };

export interface GeneratedLearningPrepOutput {
  segmentation: GeneratedLearningPrepSegmentation;
  candidates: GeneratedLearningPrepCandidate[];
  lensAbstentions: Array<{
    lens: LearningPrepLensKind;
    reasonCode: LearningPrepLensAbstentionReasonCode;
  }>;
}

export type LearningPrepSegmentation =
  | {
      mode: "beats";
      beats: Array<{ beatId: string; startMs: number; endMs: number; lineIds: string[] }>;
    }
  | {
      mode: "watch_through";
      reasonCode: "no_beat_boundaries_warranted" | "insufficient_caption_context";
    };

export type LearningPrepLensOutcome =
  | {
      lens: LearningPrepLensKind;
      state: "surfaced";
      reasonCode: null;
      candidateCount: number;
    }
  | {
      lens: LearningPrepLensKind;
      state: "abstained";
      reasonCode: LearningPrepLensAbstentionReasonCode;
      candidateCount: 0;
    };

export const LEARNING_PREP_NON_CLAIMS = [
  "prep_semantic_correctness_not_assessed",
  "caption_context_not_culture_or_history_authority",
  "word_mapping_not_alignment_evidence",
  "no_external_grounding_or_citation",
  "publication_not_authorized",
  "learner_temperature_not_availability_authority",
  "prep_not_course_or_curriculum",
] as const;

export interface LearningPrepArtifact {
  schema: "studio.learning-prep.artifact.v1";
  jobId: string;
  runId: string;
  input: LearningPrepInputAuthority;
  grant: LearningPrepGrant;
  executor: LearningPrepExecutorDescriptor;
  segmentation: LearningPrepSegmentation;
  lenses: LearningPrepLensOutcome[];
  candidates: LearningPrepCandidate[];
  result: {
    status: "completed" | "partial" | "unavailable";
    armedLensCount: number;
    surfacedLensCount: number;
    abstainedLensCount: number;
    candidateCount: number;
    availableCandidateCount: number;
    withheldCandidateCount: number;
    unavailableCandidateCount: number;
    beatCount: number | null;
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
  nonClaims: typeof LEARNING_PREP_NON_CLAIMS;
}

export interface LearningPrepExecutionMeasurement {
  providerResponseId: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
}

export interface LearningPrepExecutorResult {
  output: GeneratedLearningPrepOutput;
  execution: LearningPrepExecutionMeasurement;
}

export interface LearningPrepReceipt {
  schema: "studio.learning-prep.receipt.v1";
  receiptId: string;
  jobId: string;
  grant: LearningPrepGrant;
  input: LearningPrepInputAuthority;
  producer: {
    id: "studio.host-learning-prep";
    version: "1";
    policy: "verified_current_caption_post_study_apply_only";
    executor: LearningPrepExecutorDescriptor;
  };
  limits: typeof LEARNING_PREP_LIMITS;
  execution: LearningPrepExecutionMeasurement;
  result: LearningPrepArtifact["result"] & {
    artifactId: string;
    contentId: string;
    bytes: number;
    lenses: Array<{
      lens: LearningPrepLensKind;
      state: "surfaced" | "abstained";
      reasonCode: LearningPrepLensAbstentionReasonCode | null;
      candidateCount: number;
    }>;
  };
  nonClaims: typeof LEARNING_PREP_NON_CLAIMS;
}

export interface LearningPrepRecord {
  jobId: string;
  attempt: number;
  requestFingerprint: string;
  caption: LearningPrepCaptionIdentity;
  fineTune: LearningFineTune;
  grantId: string;
  executor: LearningPrepExecutorDescriptor;
  limits: typeof LEARNING_PREP_LIMITS;
  status: "started" | "completed" | "failed";
  artifactId: string | null;
  contentId: string | null;
  receiptArtifactId: string | null;
  receiptId: string | null;
  receiptContentId: string | null;
  result: LearningPrepArtifact["result"] | null;
  failure: string | null;
}

export interface LearningPrepVerification {
  integrity: "stored_learning_prep_and_receipt_with_verified_current_caption";
  jobId: string;
  artifactId: string;
  contentId: string;
  receiptArtifactId: string;
  receiptId: string;
  receiptContentId: string;
  caption: LearningPrepCaptionIdentity;
  fineTune: LearningFineTune;
  executor: LearningPrepExecutorDescriptor;
  result: LearningPrepArtifact["result"];
}

export interface VerifiedLearningPrepResult {
  verification: LearningPrepVerification;
  artifact: LearningPrepArtifact;
  receipt: LearningPrepReceipt;
}

export interface LearningPrepAttemptState {
  jobId: string;
  attempt: number;
  caption: LearningPrepCaptionIdentity;
  fineTune: LearningFineTune;
  status: "started" | "completed" | "failed";
  failure: string | null;
}
