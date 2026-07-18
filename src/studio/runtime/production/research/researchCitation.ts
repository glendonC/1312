import { ContentAddressedArtifactStore } from "../artifactStore.ts";
import { canonicalSha256 } from "../canonicalIdentity.ts";
import type {
  EvidenceCitationEnvelope,
  EvidenceCitationObservation,
  EvidenceCitationTarget,
} from "../model/evidenceCitations.ts";
import {
  evidenceCitationId,
  validateEvidenceCitationEnvelope,
} from "../validation/evidenceCitations.ts";
import { auditResearchSnapshot, type VerifiedResearchSnapshotAudit } from "./researchAudit.ts";

export interface ResearchDocumentSpan {
  start: number;
  end: number;
}

export type VerifiedResearchCitationSource = VerifiedResearchSnapshotAudit;

/** Reopens and replays the whole snapshot lineage; it never trusts a projection or a caller. */
export async function reopenResearchCitationSource(
  artifacts: ContentAddressedArtifactStore,
  runId: string,
  snapshotReceiptContentId: string,
): Promise<VerifiedResearchCitationSource> {
  return auditResearchSnapshot(artifacts, runId, snapshotReceiptContentId);
}

export function researchObservationId(input: {
  operationId: string;
  extractionContentId: string;
  start: number;
  end: number;
}): string {
  return `research-observation:${canonicalSha256({ ...input, unit: "utf8_byte" })}`;
}

/**
 * Cite-only external document context. Snippets and URLs can never reach this constructor:
 * only a replayed extraction backed by a stored document snapshot can, and the produced
 * citation can only qualify the exact unresolved media range the grant was scoped to.
 */
export function externalDocumentSpanCitation(input: {
  verified: VerifiedResearchCitationSource;
  target: Extract<EvidenceCitationTarget, { kind: "media_context" }>;
  spans: ResearchDocumentSpan[];
}): EvidenceCitationEnvelope {
  const { verified, target, spans } = input;
  const receipt = verified.receipt;
  const gapMedia = receipt.gap.media;
  if (
    target.qualifiesMedia.artifactId !== gapMedia.artifactId ||
    target.qualifiesMedia.trackId !== gapMedia.trackId ||
    target.qualifiesMedia.startMs !== gapMedia.startMs ||
    target.qualifiesMedia.endMs !== gapMedia.endMs
  ) {
    throw new Error("External document citation target escapes its granted research gap");
  }
  if (spans.length === 0) {
    throw new Error("External document citation requires at least one exact document span");
  }
  const observations = spans.map((span): EvidenceCitationObservation => {
    if (
      !Number.isSafeInteger(span.start) || !Number.isSafeInteger(span.end) ||
      span.start < 0 || span.end <= span.start || span.end > verified.extraction.envelope.unitCount
    ) {
      throw new Error("External document citation span escapes the stored extraction");
    }
    return {
      observationId: researchObservationId({
        operationId: receipt.operationId,
        extractionContentId: verified.extraction.contentId,
        start: span.start,
        end: span.end,
      }),
      state: "available",
      rawState: `research:${receipt.extraction.method}`,
      locator: {
        kind: "document_span",
        document: {
          entityId: `research-gap:${receipt.gap.triggerId}`,
          artifactId: verified.extraction.artifactId,
          start: span.start,
          end: span.end,
          unit: "utf8_byte",
        },
        qualifiesMedia: {
          artifactId: gapMedia.artifactId,
          trackId: gapMedia.trackId,
          startMs: gapMedia.startMs,
          endMs: gapMedia.endMs,
        },
      },
    };
  });
  const body: Omit<EvidenceCitationEnvelope, "schema" | "citationId"> = {
    evidenceKind: "external_document_span",
    use: "cite_only",
    target: structuredClone(target),
    operationId: receipt.operationId,
    evidence: {
      artifactId: verified.extraction.artifactId,
      contentId: verified.extraction.contentId,
    },
    receipt: {
      receiptId: receipt.receiptId,
      contentId: verified.receiptContentId,
      artifactId: verified.receiptArtifactId,
    },
    source: {
      artifactId: gapMedia.artifactId,
      contentId: gapMedia.contentId,
      trackId: gapMedia.trackId,
    },
    upstreamState: "available",
    upstreamReason: `research_snapshot:${receipt.state}`,
    observations,
    nonClaims: { semanticCorrectness: "not_assessed", truthArbitration: "not_performed" },
  };
  return validateEvidenceCitationEnvelope({
    schema: "studio.evidence-citation.v1",
    citationId: evidenceCitationId(body),
    ...body,
  });
}
