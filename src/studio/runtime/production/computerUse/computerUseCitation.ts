import { canonicalSha256 } from "../canonicalIdentity.ts";
import type { VerifiedComputerUseSession } from "./computerUseAudit.ts";
import type { EvidenceCitationEnvelope, EvidenceCitationTarget } from "../model.ts";
import { evidenceCitationId, validateEvidenceCitationEnvelope } from "../validation/evidenceCitations.ts";

function sameRange(left: EvidenceCitationTarget, verified: VerifiedComputerUseSession): boolean {
  if (left.kind !== "media_context") return false;
  const media = verified.receipt.gap.media;
  return left.qualifiesMedia.artifactId === media.artifactId && left.qualifiesMedia.trackId === media.trackId &&
    left.qualifiesMedia.startMs === media.startMs && left.qualifiesMedia.endMs === media.endMs;
}

export function externalScreenRegionCitation(input: {
  verified: VerifiedComputerUseSession;
  stateId: string;
  region: { x: number; y: number; width: number; height: number };
  target: Extract<EvidenceCitationTarget, { kind: "media_context" }>;
}): EvidenceCitationEnvelope {
  if (!sameRange(input.target, input.verified)) throw new Error("External-screen citation target changed its granted media gap");
  const matches = input.verified.states.filter((state) => state.identity.stateId === input.stateId);
  if (matches.length !== 1) throw new Error("External-screen citation names no unique audited state");
  const state = matches[0].identity;
  const { x, y, width, height } = input.region;
  if (![x, y, width, height].every(Number.isSafeInteger) || x < 0 || y < 0 || width <= 0 || height <= 0 ||
      x + width > state.screenshot.width || y + height > state.screenshot.height) {
    throw new Error("External-screen citation region escapes the audited screenshot bounds");
  }
  const body: Omit<EvidenceCitationEnvelope, "schema" | "citationId"> = {
    evidenceKind: "external_screen_region",
    use: "cite_only",
    target: structuredClone(input.target),
    operationId: input.verified.receipt.operationId,
    evidence: { artifactId: state.screenshot.artifactId, contentId: state.screenshot.content.contentId },
    receipt: {
      receiptId: input.verified.receipt.receiptId,
      contentId: input.verified.receiptContentId,
      artifactId: input.verified.receiptArtifactId,
    },
    source: {
      artifactId: input.verified.receipt.gap.media.artifactId,
      contentId: input.verified.receipt.gap.media.contentId,
      trackId: input.verified.receipt.gap.media.trackId,
    },
    upstreamState: "available",
    upstreamReason: "Offline fixture screenshot bytes were captured and cold-audited; live state and meaning were not assessed.",
    observations: [{
      observationId: `external-screen-region:${canonicalSha256({ sessionId: input.verified.receipt.sessionId, stateId: state.stateId, region: input.region })}`,
      state: "available",
      rawState: "external-screen:offline_fixture:captured_bytes_only",
      locator: {
        kind: "screen_region",
        screen: {
          sessionId: input.verified.receipt.sessionId,
          stateId: state.stateId,
          ordinal: state.ordinal,
          screenshotId: state.screenshot.screenshotId,
          artifactId: state.screenshot.artifactId,
          ...input.region,
        },
        qualifiesMedia: structuredClone(input.target.qualifiesMedia),
      },
    }],
    nonClaims: { semanticCorrectness: "not_assessed", truthArbitration: "not_performed" },
  };
  return validateEvidenceCitationEnvelope({ schema: "studio.evidence-citation.v1", citationId: evidenceCitationId(body), ...body });
}
