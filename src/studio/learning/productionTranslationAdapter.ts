import type {
  VerifiedSpanTranslationResult,
} from "../runtime/production/model/spanTranslations.ts";
import {
  codePointSlice,
  type LearningViewingSource,
  type PresentedMoment,
} from "./model.ts";
import {
  learningRequestKey,
  type LearningSelectionRequest,
  type SpanTranslationState,
} from "./presentation.ts";
import { validateLearningViewingSource } from "./sourceAdapters.ts";

type ProductionSource = Extract<LearningViewingSource, { context: { origin: "verified_production_caption" } }>;

export function projectVerifiedProductionSpanTranslation(
  source: ProductionSource,
  request: LearningSelectionRequest,
  result: VerifiedSpanTranslationResult,
): SpanTranslationState {
  const requestKey = learningRequestKey(source, request);
  const failed = (detail: string): SpanTranslationState => ({
    state: "failed",
    requestKey,
    request,
    reasonCode: "invalid_translation_binding",
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
  const expectedLanguage = request.span.side === "source" ? "en" : "ko";
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
    artifact.input.line.lineId !== request.lineId ||
    artifact.translation.language !== expectedLanguage ||
    artifact.translation.semanticReview !== "not_reviewed" ||
    receipt.jobId !== verification.jobId ||
    receipt.receiptId !== verification.receiptId ||
    receipt.result.artifactId !== verification.artifactId ||
    receipt.result.contentId !== verification.contentId ||
    receipt.result.availability !== artifact.translation.availability ||
    receipt.result.reasonCode !== artifact.translation.reasonCode
  ) {
    return failed("The span-translation artifact does not close over the selected caption authority.");
  }
  if (artifact.translation.availability !== "available") {
    return {
      state: "withheld",
      requestKey,
      request,
      reasonCode: artifact.translation.reasonCode,
    };
  }
  return {
    state: "translated",
    requestKey,
    request,
    translation: { language: artifact.translation.language, text: artifact.translation.text },
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
