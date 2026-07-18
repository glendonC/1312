import { canonicalSha256 } from "../canonicalIdentity.ts";
import type { VerifiedSampledFrame } from "../frameAudit.ts";
import type { OcrFrameObservations } from "../model/ocr.ts";
import type { VisualTransitionFrameIdentity } from "../model/visualTransitions.ts";

export function visualTransitionFrameIdentity(
  frame: VerifiedSampledFrame,
  ocrFrame: OcrFrameObservations,
): VisualTransitionFrameIdentity {
  if (
    ocrFrame.frameId !== frame.identity.frameId ||
    ocrFrame.frameArtifactId !== frame.artifact.id ||
    ocrFrame.frameContentId !== frame.artifact.content.contentId ||
    ocrFrame.actualTimestampUs !== frame.identity.actualPresentationTimestamp.microseconds ||
    ocrFrame.width !== frame.identity.width ||
    ocrFrame.height !== frame.identity.height
  ) throw new Error("Visual-transition U2/U5 frame set mismatch");
  const hypotheses = [...new Set(ocrFrame.observations
    .filter((observation) => observation.state === "available" && observation.normalizedText !== null)
    .map((observation) => observation.normalizedText as string))].sort();
  return {
    frameId: frame.identity.frameId,
    artifactId: frame.artifact.id,
    contentId: frame.artifact.content.contentId,
    bytes: frame.bytes.length,
    width: frame.identity.width,
    height: frame.identity.height,
    actualTimestampUs: frame.identity.actualPresentationTimestamp.microseconds,
    ocrState: ocrFrame.state,
    availableOcrHypothesisCount: hypotheses.length,
    availableOcrHypothesisSetFingerprint: `ocr-hypothesis-set:${canonicalSha256(hypotheses)}`,
  };
}
