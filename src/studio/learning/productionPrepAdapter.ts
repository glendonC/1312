import type { VerifiedLearningPrepResult } from "../runtime/production/model/learningPrep.ts";
import type { LearningViewingSource, PresentedMoment } from "./model.ts";
import {
  learningPrepKey,
  type LearningFineTuneDraft,
  type LearningPrepMoment,
  type LearningPrepProjection,
} from "./presentation.ts";
import { validateLearningViewingSource } from "./sourceAdapters.ts";

type ProductionSource = Extract<LearningViewingSource, { context: { origin: "verified_production_caption" } }>;

/**
 * Projects one host-verified learning-prep artifact onto the exact production caption view. Any
 * identity, fine-tune, anchor, or availability drift fails closed instead of presenting content.
 */
export function projectVerifiedProductionLearningPrep(
  source: ProductionSource,
  fineTune: LearningFineTuneDraft,
  result: VerifiedLearningPrepResult,
): LearningPrepProjection {
  const prepKey = learningPrepKey(source, fineTune);
  const failed = (detail: string): LearningPrepProjection => ({
    state: "failed",
    prepKey,
    fineTune,
    reasonCode: "invalid_prep_binding",
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
  const expectedFineTune = {
    schema: "studio.learning-fine-tune.v1",
    armedLenses: fineTune.armedLenses,
    temperature: fineTune.temperature,
  };
  if (
    JSON.stringify(artifact.grant.fineTune) !== JSON.stringify(expectedFineTune) ||
    JSON.stringify(verification.fineTune) !== JSON.stringify(expectedFineTune)
  ) {
    return failed("The stored learning prep does not carry this exact armed fine-tune.");
  }
  if (
    artifact.runId !== identities.runId ||
    artifact.jobId !== verification.jobId ||
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
    receipt.jobId !== verification.jobId ||
    receipt.receiptId !== verification.receiptId ||
    receipt.result.artifactId !== verification.artifactId ||
    receipt.result.contentId !== verification.contentId ||
    JSON.stringify(artifact.result) !== JSON.stringify(verification.result)
  ) {
    return failed("The learning-prep artifact does not close over the selected caption authority.");
  }

  const momentById = new Map<string, PresentedMoment>(source.moments.map((moment) => [moment.lineId, moment]));
  if (artifact.segmentation.mode === "beats") {
    const flattened = artifact.segmentation.beats.flatMap((beat) => beat.lineIds);
    if (JSON.stringify(flattened) !== JSON.stringify(source.moments.map((moment) => moment.lineId))) {
      return failed("The prep segmentation does not partition this exact caption view.");
    }
    for (const beat of artifact.segmentation.beats) {
      const first = momentById.get(beat.lineIds[0]);
      const last = momentById.get(beat.lineIds[beat.lineIds.length - 1]);
      if (!first || !last || beat.startMs !== first.startMs || beat.endMs !== last.endMs) {
        return failed("A prep beat does not carry the exact caption line media range.");
      }
    }
  }
  for (const candidate of artifact.candidates) {
    const moment = momentById.get(candidate.anchor.lineId);
    if (!moment || candidate.anchor.startMs !== moment.startMs || candidate.anchor.endMs !== moment.endMs) {
      return failed("A prep candidate does not anchor an exact caption moment.");
    }
    if (candidate.availability === "available") {
      if (moment.source.state !== "available") {
        return failed("An available prep candidate anchors a moment without available source text.");
      }
      if (candidate.lens === "word_order" && moment.target.state !== "available") {
        return failed("An available word-order candidate anchors a moment without available target text.");
      }
    }
  }

  const moments: LearningPrepMoment[] = artifact.candidates.map((candidate) =>
    candidate.availability === "available"
      ? {
          lens: candidate.lens,
          lineId: candidate.anchor.lineId,
          startMs: candidate.anchor.startMs,
          endMs: candidate.anchor.endMs,
          availability: "available",
          reasonCode: null,
          grounding: "caption_context_inference",
          content: candidate.content,
          executionAuthority: "host_receipted",
          semanticReviewState: "not_reviewed",
          externalCitationIds: [],
        } as LearningPrepMoment
      : {
          lens: candidate.lens,
          lineId: candidate.anchor.lineId,
          startMs: candidate.anchor.startMs,
          endMs: candidate.anchor.endMs,
          availability: candidate.availability,
          reasonCode: candidate.reasonCode,
          grounding: "none",
          content: null,
          executionAuthority: "host_receipted",
          semanticReviewState: "not_reviewed",
          externalCitationIds: [],
        });

  return {
    state: "ready",
    prepKey,
    fineTune,
    resultState: artifact.result.status,
    segmentation: artifact.segmentation.mode === "beats"
      ? {
          mode: "beats",
          beats: artifact.segmentation.beats.map((beat) => ({
            beatId: beat.beatId,
            startMs: beat.startMs,
            endMs: beat.endMs,
            lineIds: [...beat.lineIds],
          })),
        }
      : { mode: "watch_through", reasonCode: artifact.segmentation.reasonCode },
    moments,
    lenses: artifact.lenses.map((lens) => ({
      lens: lens.lens,
      state: lens.state,
      reasonCode: lens.reasonCode,
      candidateCount: lens.candidateCount,
    })),
    authority: {
      dataClass: "runtime_artifact",
      executionAuthority: "host_receipted",
      semanticReviewState: "not_reviewed",
      artifactId: verification.artifactId,
      contentId: verification.contentId,
      receiptId: verification.receiptId,
      receiptContentId: verification.receiptContentId,
    },
    nonClaims: artifact.nonClaims,
  };
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
