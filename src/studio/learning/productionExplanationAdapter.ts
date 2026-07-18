import type {
  LanguageExplanationFacet,
  LanguageExplanationTextSnapshot,
  VerifiedLanguageExplanationResult,
} from "../runtime/production/model/languageExplanations.ts";
import {
  codePointSlice,
  type LearningViewingSource,
  type PresentedMoment,
  type PresentedText,
} from "./model.ts";
import {
  LEARNING_FACET_KINDS,
  learningRequestKey,
  type LearningExplanationState,
  type LearningFacet,
  type LearningFacetKind,
  type LearningPresentation,
  type LearningSelectionRequest,
  type PreparedLearningSelection,
} from "./presentation.ts";
import { validateLearningViewingSource } from "./sourceAdapters.ts";

type ProductionSource = Extract<LearningViewingSource, { context: { origin: "verified_production_caption" } }>;

export function projectProductionLearningPresentation(
  source: ProductionSource,
  options: { playbackAvailable?: boolean } = {},
): Extract<LearningPresentation, { mode: "production" }> {
  validateLearningViewingSource(source);
  return {
    mode: "production",
    source,
    explanations: source.context.authorityState === "unrevoked"
      ? {
          state: "unavailable",
          reasonCode: options.playbackAvailable
            ? "production_explanation_interaction_unavailable"
            : "production_media_playback_unavailable",
        }
      : { state: "unavailable", reasonCode: "caption_authority_revoked" },
    savedItems: { state: "unavailable", reasonCode: "canonical_saved_item_missing" },
  };
}

export function projectVerifiedProductionLearningExplanation(
  source: ProductionSource,
  request: LearningSelectionRequest,
  result: VerifiedLanguageExplanationResult,
): LearningExplanationState {
  const requestKey = learningRequestKey(source, request);
  const failed = (detail: string): LearningExplanationState => ({
    state: "failed",
    requestKey,
    request,
    reasonCode: "invalid_explanation_binding",
    detail,
    retry: "unavailable",
  });

  try {
    validateLearningViewingSource(source);
  } catch {
    return failed("The production caption source failed closed validation.");
  }
  const { artifact, receipt, verification } = result;
  const identities = source.context.identities;
  const moment = source.moments.find((candidate) => candidate.lineId === request.lineId);
  if (!moment || !sameRequestMoment(request, moment)) {
    return failed("The selected span no longer binds to the verified production caption.");
  }
  const selectedSide = request.span.side === "source" ? moment.source : moment.target;
  if (
    selectedSide.state !== "available" ||
    codePointSlice(selectedSide.text, request.span.start, request.span.end) !== request.span.text
  ) {
    return failed("The selected Unicode code-point span does not reconstruct verified caption text.");
  }
  if (
    artifact.runId !== identities.runId ||
    artifact.jobId !== verification.jobId ||
    verification.lineId !== request.lineId ||
    !sameSelection(verification.selection, request.span) ||
    !sameSelection(artifact.input.selection, request.span) ||
    !sameCaptionIdentity(verification.caption, identities) ||
    !sameCaptionIdentity(artifact.input.caption, identities) ||
    artifact.input.source.artifactId !== identities.sourceArtifactId ||
    artifact.input.source.contentId !== identities.sourceContentId ||
    artifact.input.source.analysisRequestId !== identities.analysisRequestId ||
    artifact.input.study.studyId !== identities.studyId ||
    artifact.input.study.artifactId !== identities.studyArtifactId ||
    artifact.input.study.contentId !== identities.studyContentId ||
    artifact.input.readiness.readinessId !== identities.readinessId ||
    artifact.input.readiness.artifactId !== identities.readinessArtifactId ||
    artifact.input.readiness.receiptId !== identities.readinessReceiptId ||
    artifact.input.readiness.receiptContentId !== identities.readinessReceiptContentId ||
    artifact.input.approval.reviewId !== identities.approvalReviewId ||
    artifact.input.approval.artifactId !== identities.approvalArtifactId ||
    artifact.input.approval.receiptId !== identities.approvalReceiptId ||
    artifact.input.approval.receiptContentId !== identities.approvalReceiptContentId ||
    !sameContextLine(artifact.input.line, moment) ||
    receipt.jobId !== verification.jobId ||
    receipt.receiptId !== verification.receiptId ||
    receipt.result.artifactId !== verification.artifactId ||
    receipt.result.contentId !== verification.contentId
  ) {
    return failed("The language-explanation artifact does not close over the selected caption authority.");
  }
  if (
    artifact.facets.length === 0 ||
    new Set(artifact.facets.map((facet) => facet.kind)).size !== artifact.facets.length ||
    artifact.facets.some((facet) => !LEARNING_FACET_KINDS.includes(facet.kind))
  ) {
    return failed("The language-explanation artifact contains an unsupported or duplicate facet.");
  }

  const selection: PreparedLearningSelection = {
    selectionId: verification.jobId,
    ...request,
    facets: artifact.facets.map(projectFacet),
    authority: {
      dataClass: "runtime_artifact",
      productionAuthority: true,
      executionAuthority: "host_receipted",
      semanticReviewState: "not_reviewed",
      artifactId: verification.artifactId,
      contentId: verification.contentId,
      receiptId: verification.receiptId,
      receiptContentId: verification.receiptContentId,
    },
    nonClaims: artifact.nonClaims,
  };
  const state = artifact.result.status === "completed"
    ? "available"
    : artifact.result.status === "partial"
      ? "partial"
      : artifact.facets.every((facet) => facet.availability === "withheld")
        ? "withheld"
        : "unavailable";
  return { state, requestKey, selection };
}

function projectFacet(facet: LanguageExplanationFacet): LearningFacet {
  const authority = {
    authority: "host_receipted" as const,
    semanticReviewState: "not_reviewed" as const,
    claimIds: [] as [],
    citationIds: [] as [],
  };
  if (facet.availability === "available") {
    return {
      ...authority,
      kind: facet.kind,
      availability: "available",
      reasonCode: null,
      content: facet.content,
    } as LearningFacet;
  }
  return {
    ...authority,
    kind: facet.kind as LearningFacetKind,
    availability: facet.availability,
    reasonCode: facet.reasonCode,
    content: null,
  };
}

function sameRequestMoment(request: LearningSelectionRequest, moment: PresentedMoment): boolean {
  return request.startMs === moment.startMs && request.endMs === moment.endMs &&
    request.sourceLanguage === moment.sourceLanguage && request.targetLanguage === moment.targetLanguage &&
    JSON.stringify(request.source) === JSON.stringify(moment.source) &&
    JSON.stringify(request.target) === JSON.stringify(moment.target);
}

function sameSelection(
  actual: { side: string; unit: string; start: number; end: number; text: string },
  expected: LearningSelectionRequest["span"],
): boolean {
  return actual.side === expected.side && actual.unit === "unicode_code_point" &&
    actual.start === expected.start && actual.end === expected.end && actual.text === expected.text;
}

function sameCaptionIdentity(
  actual: {
    jobId: string;
    artifactId: string;
    contentId: string;
    receiptArtifactId: string;
    receiptId: string;
    receiptContentId: string;
  },
  expected: ProductionSource["context"]["identities"],
): boolean {
  return actual.jobId === expected.captionJobId &&
    actual.artifactId === expected.captionArtifactId &&
    actual.contentId === expected.captionContentId &&
    actual.receiptArtifactId === expected.captionReceiptArtifactId &&
    actual.receiptId === expected.captionReceiptId &&
    actual.receiptContentId === expected.captionReceiptContentId;
}

function sameContextLine(actual: {
  lineId: string;
  startMs: number;
  endMs: number;
  source: LanguageExplanationTextSnapshot;
  target: LanguageExplanationTextSnapshot;
}, expected: PresentedMoment): boolean {
  return actual.lineId === expected.lineId && actual.startMs === expected.startMs && actual.endMs === expected.endMs &&
    sameTextSnapshot(actual.source, expected.source, expected.sourceLanguage) &&
    sameTextSnapshot(actual.target, expected.target, expected.targetLanguage);
}

function sameTextSnapshot(actual: LanguageExplanationTextSnapshot, expected: PresentedText, language: string): boolean {
  if (actual.language !== language || actual.state !== expected.state) return false;
  if (actual.state === "available") return expected.state === "available" && actual.text === expected.text;
  return expected.state !== "available" && actual.text === null && actual.reasonCode === expected.upstreamReasonCode;
}
