export const EVIDENCE_CITATION_LIMITS = {
  maxObservations: 512,
  maxCitationsPerReport: 256,
  maxDocumentSpanUnits: 1_000_000,
} as const;

/**
 * Kinds with no registered producer/audit adapter are intentional future slots. A typed
 * discriminant is not admission authority: the audit registry rejects every unregistered kind.
 */
export type EvidenceCitationKind =
  | "current_run_speech"
  | "acoustic_range"
  | "frame_sample"
  | "ocr_span"
  | "visual_transition"
  | "speaker_turn"
  | "external_document_span"
  | "external_screen_region";

export type LandedEvidenceCitationKind =
  | "current_run_speech"
  | "acoustic_range"
  | "frame_sample"
  | "ocr_span"
  | "visual_transition"
  | "speaker_turn";

export type EvidenceCitationState =
  | "available"
  | "unknown"
  | "withheld"
  | "unavailable"
  | "truncated"
  | "conflicting"
  | "failed"
  | "not_in_scope";

export interface QualifiedMediaRange {
  artifactId: string;
  trackId: string;
  startMs: number;
  endMs: number;
}

export type EvidenceObservationLocator =
  | {
      kind: "temporal_range";
      media: QualifiedMediaRange;
    }
  | {
      kind: "media_point";
      media: {
        artifactId: string;
        trackId: string;
        timestampUs: number;
        qualifiesRange: { startMs: number; endMs: number };
      };
    }
  | {
      kind: "document_span";
      document: {
        entityId: string;
        artifactId: string;
        start: number;
        end: number;
        unit: "utf8_byte" | "unicode_code_point" | "page_character";
      };
      /** Non-temporal context has no authority unless it names the exact media it qualifies. */
      qualifiesMedia: QualifiedMediaRange;
    }
  | {
      kind: "screen_region";
      screen: {
        sessionId: string;
        stateId: string;
        ordinal: number;
        screenshotId: string;
        artifactId: string;
        x: number;
        y: number;
        width: number;
        height: number;
      };
      qualifiesMedia: QualifiedMediaRange;
    };

export interface EvidenceCitationObservation {
  observationId: string;
  state: EvidenceCitationState;
  rawState: string;
  locator: EvidenceObservationLocator;
}

export type EvidenceCitationTarget =
  | {
      kind: "claim";
      claimId: string;
      range: QualifiedMediaRange;
    }
  | {
      kind: "coverage";
      range: QualifiedMediaRange;
    }
  | {
      kind: "media_context";
      qualifiesMedia: QualifiedMediaRange;
    };

export type EvidenceCitationUse =
  | "claim_support"
  | "coverage_qualification"
  | "cite_only";

/**
 * Additive, producer-neutral citation contract. `citationId` closes the entire body. Artifact
 * lineage remains separate from the typed target association so a generic source list can never
 * masquerade as claim support.
 */
export interface EvidenceCitationEnvelope {
  schema: "studio.evidence-citation.v1";
  citationId: string;
  evidenceKind: EvidenceCitationKind;
  use: EvidenceCitationUse;
  target: EvidenceCitationTarget;
  operationId: string | null;
  evidence: {
    artifactId: string;
    contentId: string;
  };
  receipt: {
    receiptId: string;
    contentId: string;
    artifactId: string | null;
  };
  source: {
    artifactId: string;
    contentId: string;
    trackId: string;
  };
  upstreamState: EvidenceCitationState;
  upstreamReason: string;
  observations: EvidenceCitationObservation[];
  nonClaims: {
    semanticCorrectness: "not_assessed";
    truthArbitration: "not_performed";
  };
}
