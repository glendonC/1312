import { canonicalSha256 } from "../canonicalIdentity.ts";
import type {
  EvidenceCitationEnvelope,
  EvidenceCitationKind,
  EvidenceCitationObservation,
  EvidenceCitationState,
  EvidenceCitationTarget,
  EvidenceCitationUse,
  EvidenceObservationLocator,
  QualifiedMediaRange,
} from "../model.ts";
import { EVIDENCE_CITATION_LIMITS } from "../model.ts";
import {
  array,
  contentId,
  exact,
  fail,
  integer,
  literal,
  object,
  oneOf,
  string,
} from "./primitives.ts";

const KINDS = new Set<EvidenceCitationKind>([
  "current_run_speech",
  "acoustic_range",
  "frame_sample",
  "ocr_span",
  "speaker_turn",
  "external_document_span",
]);
const STATES = new Set<EvidenceCitationState>([
  "available", "unknown", "withheld", "unavailable", "truncated", "conflicting", "failed", "not_in_scope",
]);
const USES = new Set(["claim_support", "coverage_qualification", "cite_only"] as const);

export function evidenceCitationId(value: Omit<EvidenceCitationEnvelope, "schema" | "citationId">): string {
  return `evidence-citation:${canonicalSha256(value)}`;
}

function mediaRange(value: unknown, context: string, path: string): QualifiedMediaRange {
  const item = object(value, context, path);
  exact(item, ["artifactId", "trackId", "startMs", "endMs"], context, path);
  const startMs = integer(item.startMs, context, `${path}.startMs`);
  const endMs = integer(item.endMs, context, `${path}.endMs`, 1);
  if (endMs <= startMs) fail(context, path, "must be a non-empty half-open media range");
  return {
    artifactId: string(item.artifactId, context, `${path}.artifactId`),
    trackId: string(item.trackId, context, `${path}.trackId`),
    startMs,
    endMs,
  };
}

function locator(value: unknown, context: string, path: string): EvidenceObservationLocator {
  const item = object(value, context, path);
  const kind = oneOf<EvidenceObservationLocator["kind"]>(item.kind, new Set(["temporal_range", "media_point", "document_span"]), context, `${path}.kind`);
  if (kind === "temporal_range") {
    exact(item, ["kind", "media"], context, path);
    return { kind, media: mediaRange(item.media, context, `${path}.media`) };
  }
  if (kind === "media_point") {
    exact(item, ["kind", "media"], context, path);
    const media = object(item.media, context, `${path}.media`);
    exact(media, ["artifactId", "trackId", "timestampUs", "qualifiesRange"], context, `${path}.media`);
    const qualifies = object(media.qualifiesRange, context, `${path}.media.qualifiesRange`);
    exact(qualifies, ["startMs", "endMs"], context, `${path}.media.qualifiesRange`);
    const startMs = integer(qualifies.startMs, context, `${path}.media.qualifiesRange.startMs`);
    const endMs = integer(qualifies.endMs, context, `${path}.media.qualifiesRange.endMs`, 1);
    const timestampUs = integer(media.timestampUs, context, `${path}.media.timestampUs`);
    if (endMs <= startMs || timestampUs < startMs * 1_000 || timestampUs >= endMs * 1_000) {
      fail(context, `${path}.media`, "point must fall inside the exact qualified media range");
    }
    return {
      kind,
      media: {
        artifactId: string(media.artifactId, context, `${path}.media.artifactId`),
        trackId: string(media.trackId, context, `${path}.media.trackId`),
        timestampUs,
        qualifiesRange: { startMs, endMs },
      },
    };
  }
  exact(item, ["kind", "document", "qualifiesMedia"], context, path);
  const document = object(item.document, context, `${path}.document`);
  exact(document, ["entityId", "artifactId", "start", "end", "unit"], context, `${path}.document`);
  const start = integer(document.start, context, `${path}.document.start`);
  const end = integer(document.end, context, `${path}.document.end`, 1);
  if (end <= start || end - start > EVIDENCE_CITATION_LIMITS.maxDocumentSpanUnits) {
    fail(context, `${path}.document`, "span must be non-empty and stay inside the closed unit ceiling");
  }
  return {
    kind,
    document: {
      entityId: string(document.entityId, context, `${path}.document.entityId`),
      artifactId: string(document.artifactId, context, `${path}.document.artifactId`),
      start,
      end,
      unit: oneOf(document.unit, new Set(["utf8_byte", "unicode_code_point", "page_character"]), context, `${path}.document.unit`),
    },
    qualifiesMedia: mediaRange(item.qualifiesMedia, context, `${path}.qualifiesMedia`),
  };
}

function observation(value: unknown, context: string, path: string): EvidenceCitationObservation {
  const item = object(value, context, path);
  exact(item, ["observationId", "state", "rawState", "locator"], context, path);
  return {
    observationId: string(item.observationId, context, `${path}.observationId`),
    state: oneOf(item.state, STATES, context, `${path}.state`),
    rawState: string(item.rawState, context, `${path}.rawState`),
    locator: locator(item.locator, context, `${path}.locator`),
  };
}

function target(value: unknown, context: string, path: string): EvidenceCitationTarget {
  const item = object(value, context, path);
  const kind = oneOf<EvidenceCitationTarget["kind"]>(item.kind, new Set(["claim", "coverage", "media_context"]), context, `${path}.kind`);
  if (kind === "claim") {
    exact(item, ["kind", "claimId", "range"], context, path);
    return { kind, claimId: string(item.claimId, context, `${path}.claimId`), range: mediaRange(item.range, context, `${path}.range`) };
  }
  if (kind === "coverage") {
    exact(item, ["kind", "range"], context, path);
    return { kind, range: mediaRange(item.range, context, `${path}.range`) };
  }
  exact(item, ["kind", "qualifiesMedia"], context, path);
  return { kind, qualifiesMedia: mediaRange(item.qualifiesMedia, context, `${path}.qualifiesMedia`) };
}

function qualifiedRange(candidate: EvidenceCitationTarget): QualifiedMediaRange {
  return candidate.kind === "media_context" ? candidate.qualifiesMedia : candidate.range;
}

function locatorQualifies(observation: EvidenceCitationObservation): QualifiedMediaRange {
  if (observation.locator.kind === "temporal_range") return observation.locator.media;
  if (observation.locator.kind === "document_span") return observation.locator.qualifiesMedia;
  return {
    artifactId: observation.locator.media.artifactId,
    trackId: observation.locator.media.trackId,
    ...observation.locator.media.qualifiesRange,
  };
}

function within(inner: QualifiedMediaRange, outer: QualifiedMediaRange): boolean {
  return inner.artifactId === outer.artifactId && inner.trackId === outer.trackId &&
    inner.startMs >= outer.startMs && inner.endMs <= outer.endMs;
}

export function validateEvidenceCitationEnvelope(
  value: unknown,
  context = "Evidence citation",
  path = "citation",
): EvidenceCitationEnvelope {
  const item = object(value, context, path);
  exact(item, [
    "schema", "citationId", "evidenceKind", "use", "target", "operationId", "evidence", "receipt",
    "source", "upstreamState", "upstreamReason", "observations", "nonClaims",
  ], context, path);
  literal(item.schema, "studio.evidence-citation.v1", context, `${path}.schema`);
  const evidenceKind = oneOf<EvidenceCitationKind>(item.evidenceKind, KINDS, context, `${path}.evidenceKind`);
  const use = oneOf<EvidenceCitationUse>(item.use, USES, context, `${path}.use`);
  const foundTarget = target(item.target, context, `${path}.target`);
  const evidence = object(item.evidence, context, `${path}.evidence`);
  exact(evidence, ["artifactId", "contentId"], context, `${path}.evidence`);
  const receipt = object(item.receipt, context, `${path}.receipt`);
  exact(receipt, ["receiptId", "contentId", "artifactId"], context, `${path}.receipt`);
  const source = object(item.source, context, `${path}.source`);
  exact(source, ["artifactId", "contentId", "trackId"], context, `${path}.source`);
  const nonClaims = object(item.nonClaims, context, `${path}.nonClaims`);
  exact(nonClaims, ["semanticCorrectness", "truthArbitration"], context, `${path}.nonClaims`);
  const observations = array(item.observations, context, `${path}.observations`)
    .map((entry, index) => observation(entry, context, `${path}.observations[${index}]`));
  if (observations.length > EVIDENCE_CITATION_LIMITS.maxObservations ||
      new Set(observations.map((entry) => entry.observationId)).size !== observations.length) {
    fail(context, `${path}.observations`, "exceeds the closed count or repeats observation identities");
  }
  const operationId = item.operationId === null ? null : string(item.operationId, context, `${path}.operationId`);
  const envelope: EvidenceCitationEnvelope = {
    schema: "studio.evidence-citation.v1",
    citationId: string(item.citationId, context, `${path}.citationId`),
    evidenceKind,
    use,
    target: foundTarget,
    operationId,
    evidence: {
      artifactId: string(evidence.artifactId, context, `${path}.evidence.artifactId`),
      contentId: contentId(evidence.contentId, context, `${path}.evidence.contentId`),
    },
    receipt: {
      receiptId: string(receipt.receiptId, context, `${path}.receipt.receiptId`),
      contentId: contentId(receipt.contentId, context, `${path}.receipt.contentId`),
      artifactId: receipt.artifactId === null ? null : string(receipt.artifactId, context, `${path}.receipt.artifactId`),
    },
    source: {
      artifactId: string(source.artifactId, context, `${path}.source.artifactId`),
      contentId: contentId(source.contentId, context, `${path}.source.contentId`),
      trackId: string(source.trackId, context, `${path}.source.trackId`),
    },
    upstreamState: oneOf(item.upstreamState, STATES, context, `${path}.upstreamState`),
    upstreamReason: string(item.upstreamReason, context, `${path}.upstreamReason`),
    observations,
    nonClaims: {
      semanticCorrectness: literal(nonClaims.semanticCorrectness, "not_assessed", context, `${path}.nonClaims.semanticCorrectness`),
      truthArbitration: literal(nonClaims.truthArbitration, "not_performed", context, `${path}.nonClaims.truthArbitration`),
    },
  };
  const range = qualifiedRange(envelope.target);
  if (range.artifactId !== envelope.source.artifactId || range.trackId !== envelope.source.trackId ||
      envelope.observations.some((entry) => !within(locatorQualifies(entry), range))) {
    fail(context, path, "target and every observation must qualify the exact cited source media range");
  }
  if (use === "claim_support" &&
      (foundTarget.kind !== "claim" || evidenceKind !== "current_run_speech" || envelope.upstreamState !== "available" ||
       observations.length === 0 || observations.some((entry) => entry.state !== "available" || entry.locator.kind !== "temporal_range"))) {
    fail(context, path, "claim support requires available current-run speech ranges and one exact claim target");
  }
  if (use === "coverage_qualification" && foundTarget.kind !== "coverage") {
    fail(context, `${path}.target`, "coverage qualification must name one exact coverage range");
  }
  if (use === "cite_only" && foundTarget.kind !== "media_context") {
    fail(context, `${path}.target`, "cite-only evidence must name the exact media context it qualifies");
  }
  if (evidenceKind === "frame_sample" &&
      (use !== "cite_only" || operationId === null || envelope.receipt.artifactId === null ||
       observations.length === 0 || observations.some((entry) => entry.locator.kind !== "media_point"))) {
    fail(context, path, "frame samples are audited point identities and remain cite-only");
  }
  if (evidenceKind === "ocr_span" &&
      (use !== "cite_only" || foundTarget.kind !== "media_context" || operationId === null ||
       envelope.receipt.artifactId === null ||
       observations.some((entry) => entry.locator.kind !== "media_point"))) {
    fail(context, path, "OCR hypotheses are audited point identities and remain cite-only media context");
  }
  if (evidenceKind === "speaker_turn" &&
      (use !== "coverage_qualification" || foundTarget.kind !== "coverage" || operationId === null ||
       envelope.receipt.artifactId === null || observations.length === 0 ||
       observations.some((entry) => entry.locator.kind !== "temporal_range"))) {
    fail(context, path, "anonymous speaker/overlap hypotheses may qualify exact temporal coverage but cannot support caption claims");
  }
  if (evidenceKind === "acoustic_range" && (use !== "coverage_qualification" || operationId !== null || envelope.receipt.artifactId !== null)) {
    fail(context, path, "acoustic observations may qualify coverage but cannot support transcript claims");
  }
  if (evidenceKind === "current_run_speech" && operationId === null) {
    fail(context, `${path}.operationId`, "current-run speech must name its exact operation");
  }
  if (evidenceKind === "external_document_span" &&
      (use !== "cite_only" || operationId === null || envelope.receipt.artifactId === null ||
       observations.length === 0 || observations.some((entry) => entry.locator.kind !== "document_span"))) {
    fail(context, path, "external document evidence remains cite-only over explicit receipted document spans");
  }
  const { schema: _schema, citationId: _citationId, ...body } = envelope;
  if (envelope.citationId !== evidenceCitationId(body)) {
    fail(context, `${path}.citationId`, "does not close the exact citation body");
  }
  return envelope;
}

/** Exact tiling over available temporal claim-support observations. Browser-safe; no Node I/O. */
export function validateSupportedClaimCitationClosure(
  claimId: string,
  range: QualifiedMediaRange,
  citations: readonly EvidenceCitationEnvelope[],
): void {
  const observations = citations
    .filter((citation) => citation.use === "claim_support" && citation.target.kind === "claim" && citation.target.claimId === claimId)
    .flatMap((citation) => citation.observations)
    .map((entry) => {
      if (entry.state !== "available" || entry.locator.kind !== "temporal_range") {
        throw new Error(`Supported claim ${claimId} contains non-available or non-temporal evidence`);
      }
      return entry;
    })
    .sort((left, right) => {
      const leftRange = left.locator.kind === "temporal_range" ? left.locator.media : range;
      const rightRange = right.locator.kind === "temporal_range" ? right.locator.media : range;
      return leftRange.startMs - rightRange.startMs || leftRange.endMs - rightRange.endMs || left.observationId.localeCompare(right.observationId);
    });
  let cursor = range.startMs;
  for (const observation of observations) {
    const found = observation.locator.kind === "temporal_range" ? observation.locator.media : null;
    if (!found || found.artifactId !== range.artifactId || found.trackId !== range.trackId ||
        found.startMs !== cursor || found.endMs > range.endMs) {
      throw new Error(`Supported claim ${claimId} citations do not exactly close its claimed range`);
    }
    cursor = found.endMs;
  }
  if (observations.length === 0 || cursor !== range.endMs) {
    throw new Error(`Supported claim ${claimId} citations leave an unsupported gap`);
  }
}
