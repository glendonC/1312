import { readFile } from "node:fs/promises";

import type { AcousticObservations, AcousticTriageReceipt } from "../../../acoustic/contracts.ts";
import { validateAcousticObservations, validateAcousticReceipt } from "../../../acoustic/validation.ts";
import { canonicalSha256, ContentAddressedArtifactStore } from "../artifactStore.ts";
import { auditFrameSampling, type VerifiedFrameSampling } from "../frameAudit.ts";
import type { FrameDecoder } from "../frames/decoder.ts";
import { FfmpegFrameDecoder } from "../frames/ffmpegDecoder.ts";
import type {
  EvidenceCitationEnvelope,
  EvidenceCitationObservation,
  EvidenceCitationState,
  EvidenceCitationTarget,
  RuntimeProjection,
} from "../model.ts";
import { reopenSemanticEvidence, type VerifiedSemanticEvidence } from "../semantic/semanticEvidenceAudit.ts";
import {
  evidenceCitationId,
  validateEvidenceCitationEnvelope,
  validateSupportedClaimCitationClosure,
} from "../validation/evidenceCitations.ts";

export { validateSupportedClaimCitationClosure };

function same(left: unknown, right: unknown): boolean {
  return canonicalSha256(left) === canonicalSha256(right);
}

function makeCitation(body: Omit<EvidenceCitationEnvelope, "schema" | "citationId">): EvidenceCitationEnvelope {
  return validateEvidenceCitationEnvelope({
    schema: "studio.evidence-citation.v1",
    citationId: evidenceCitationId(body),
    ...body,
  });
}

function speechUpstreamState(verified: VerifiedSemanticEvidence): EvidenceCitationState {
  if (verified.envelope.availability.truncated) return "truncated";
  if (verified.envelope.availability.state === "available") return "available";
  if (verified.envelope.availability.state === "unavailable") return "unavailable";
  return "unknown";
}

function speechObservation(
  verified: VerifiedSemanticEvidence,
  observationId: string,
): EvidenceCitationObservation {
  const found = verified.envelope.observations.find((entry) => entry.observationId === observationId);
  if (!found) throw new Error(`Current-run speech citation names absent observation ${observationId}`);
  return {
    observationId: found.observationId,
    state: found.state === "available" ? "available" : found.state,
    rawState: found.state,
    locator: {
      kind: "temporal_range",
      media: {
        artifactId: verified.envelope.source.artifactId,
        trackId: verified.envelope.source.trackId,
        startMs: found.range.startMs,
        endMs: found.range.endMs,
      },
    },
  };
}

export function currentRunSpeechCitation(input: {
  verified: VerifiedSemanticEvidence;
  target: Extract<EvidenceCitationTarget, { kind: "claim" | "coverage" }>;
  observationIds: string[];
}): EvidenceCitationEnvelope {
  const { verified } = input;
  const use = input.target.kind === "claim" ? "claim_support" as const : "coverage_qualification" as const;
  return makeCitation({
    evidenceKind: "current_run_speech",
    use,
    target: structuredClone(input.target),
    operationId: verified.operationId,
    evidence: { artifactId: verified.artifactId, contentId: verified.artifactContentId },
    receipt: { receiptId: verified.receiptId, contentId: verified.receiptContentId, artifactId: null },
    source: structuredClone(verified.envelope.source),
    upstreamState: speechUpstreamState(verified),
    upstreamReason: verified.envelope.availability.reason,
    observations: input.observationIds.map((id) => speechObservation(verified, id)),
    nonClaims: { semanticCorrectness: "not_assessed", truthArbitration: "not_performed" },
  });
}

async function parseStoredJson(
  artifacts: ContentAddressedArtifactStore,
  contentId: string,
  path: string | null,
  label: string,
): Promise<unknown> {
  const bytes = path === null ? await artifacts.receiptBytes(contentId) : await readFile(path);
  if (bytes.byteLength <= 0 || bytes.byteLength > 512 * 1024) throw new Error(`${label} exceeds its bounded JSON contract`);
  try { return JSON.parse(bytes.toString("utf8")) as unknown; }
  catch { throw new Error(`${label} is not valid JSON`); }
}

export interface VerifiedAcousticCitationSource {
  artifactId: string;
  artifactContentId: string;
  receiptId: string;
  receiptContentId: string;
  source: { artifactId: string; contentId: string; trackId: string };
  observations: AcousticObservations;
  receipt: AcousticTriageReceipt;
}

/** Reopens U1 bytes and separate producer receipt; it never trusts an evidence-read projection. */
export async function reopenAcousticCitationSource(
  state: RuntimeProjection,
  artifacts: ContentAddressedArtifactStore,
  artifactId: string,
): Promise<VerifiedAcousticCitationSource> {
  const artifact = state.artifacts[artifactId];
  if (
    !artifact || artifact.origin.kind !== "preflight_evidence" ||
    artifact.origin.evidenceKind !== "acoustic_ranges" || !artifact.origin.producerReceiptContentId ||
    artifact.sourceArtifactIds.length !== 1
  ) throw new Error(`Acoustic citation source ${artifactId} lacks its closed U1 origin`);
  const source = state.artifacts[artifact.sourceArtifactIds[0]];
  if (!source || source.origin.kind !== "ingest") throw new Error(`Acoustic citation source ${artifactId} lost its owned media source`);
  const artifactPath = await artifacts.resolveVerified(artifact);
  await artifacts.resolveVerified(source);
  const [observationsValue, receiptValue] = await Promise.all([
    parseStoredJson(artifacts, artifact.content.contentId, artifactPath, "Stored acoustic observations"),
    parseStoredJson(artifacts, artifact.origin.producerReceiptContentId, null, "Stored acoustic producer receipt"),
  ]);
  const observations = validateAcousticObservations(observationsValue);
  const receipt = validateAcousticReceipt(receiptValue, observations);
  const track = source.tracks.find((candidate) => candidate.kind === "audio" && candidate.index === receipt.input.media.trackIndex);
  if (!track || observations.source.contentId !== source.content.contentId || receipt.output.content.id !== artifact.content.contentId) {
    throw new Error(`Acoustic citation source ${artifactId} changed source, track, or output lineage`);
  }
  return {
    artifactId: artifact.id,
    artifactContentId: artifact.content.contentId,
    receiptId: receipt.receiptId,
    receiptContentId: artifact.origin.producerReceiptContentId,
    source: { artifactId: source.id, contentId: source.content.contentId, trackId: track.id },
    observations,
    receipt,
  };
}

export function acousticObservationId(
  verified: VerifiedAcousticCitationSource,
  index: number,
): string {
  const observation = verified.observations.observations[index];
  if (!observation) throw new Error(`Acoustic citation names absent observation index ${index}`);
  return `acoustic-observation:${canonicalSha256({
    artifactId: verified.artifactId,
    contentId: verified.artifactContentId,
    receiptContentId: verified.receiptContentId,
    index: observation.index,
    startSample: observation.startSample,
    endSample: observation.endSample,
  })}`;
}

function acousticState(verified: VerifiedAcousticCitationSource): EvidenceCitationState {
  if (verified.observations.status === "complete") return "available";
  if (verified.observations.status === "unavailable") return "unavailable";
  if (verified.observations.status === "truncated") return "truncated";
  return "failed";
}

function acousticObservation(
  verified: VerifiedAcousticCitationSource,
  index: number,
): EvidenceCitationObservation {
  const found = verified.observations.observations[index];
  if (!found) throw new Error(`Acoustic citation names absent observation index ${index}`);
  return {
    observationId: acousticObservationId(verified, index),
    state: found.certainty === "strong" ? "available" : "unknown",
    rawState: `${found.classification}:${found.certainty}:${found.reason}`,
    locator: {
      kind: "temporal_range",
      media: {
        artifactId: verified.source.artifactId,
        trackId: verified.source.trackId,
        startMs: found.startMs,
        endMs: found.endMs,
      },
    },
  };
}

export function acousticRangeCitation(input: {
  verified: VerifiedAcousticCitationSource;
  target: Extract<EvidenceCitationTarget, { kind: "coverage" }>;
  observationIndexes: number[];
}): EvidenceCitationEnvelope {
  return makeCitation({
    evidenceKind: "acoustic_range",
    use: "coverage_qualification",
    target: structuredClone(input.target),
    operationId: null,
    evidence: { artifactId: input.verified.artifactId, contentId: input.verified.artifactContentId },
    receipt: { receiptId: input.verified.receiptId, contentId: input.verified.receiptContentId, artifactId: null },
    source: structuredClone(input.verified.source),
    upstreamState: acousticState(input.verified),
    upstreamReason: `acoustic_status:${input.verified.observations.status}`,
    observations: input.observationIndexes.map((index) => acousticObservation(input.verified, index)),
    nonClaims: { semanticCorrectness: "not_assessed", truthArbitration: "not_performed" },
  });
}

export function frameSampleCitation(input: {
  verified: VerifiedFrameSampling;
  frameIndex: number;
  target: Extract<EvidenceCitationTarget, { kind: "media_context" }>;
}): EvidenceCitationEnvelope {
  const frame = input.verified.frames[input.frameIndex];
  if (!frame) throw new Error(`Frame citation names absent frame index ${input.frameIndex}`);
  const receipt = input.verified.receipt;
  return makeCitation({
    evidenceKind: "frame_sample",
    use: "cite_only",
    target: structuredClone(input.target),
    operationId: receipt.operationId,
    evidence: { artifactId: frame.artifact.id, contentId: frame.artifact.content.contentId },
    receipt: {
      receiptId: receipt.receiptId,
      contentId: input.verified.receiptArtifact.content.contentId,
      artifactId: input.verified.receiptArtifact.id,
    },
    source: {
      artifactId: receipt.source.artifactId,
      contentId: receipt.source.contentId,
      trackId: receipt.source.videoTrack.id,
    },
    upstreamState: "available",
    upstreamReason: "sampled_png_bytes_verified",
    observations: [{
      observationId: frame.identity.frameId,
      state: "available",
      rawState: "sampled_png_identity_verified",
      locator: {
        kind: "media_point",
        media: {
          artifactId: receipt.source.artifactId,
          trackId: receipt.source.videoTrack.id,
          timestampUs: frame.identity.actualPresentationTimestamp.microseconds,
          qualifiesRange: { startMs: receipt.source.grantedRange.startMs, endMs: receipt.source.grantedRange.endMs },
        },
      },
    }],
    nonClaims: { semanticCorrectness: "not_assessed", truthArbitration: "not_performed" },
  });
}

export interface EvidenceCitationAuditOptions {
  frameDecoder?: FrameDecoder;
}

/** Producer-specific cold audit dispatch. Future typed kinds have no adapter and fail closed. */
export async function auditEvidenceCitation(
  state: RuntimeProjection,
  artifacts: ContentAddressedArtifactStore,
  value: unknown,
  options: EvidenceCitationAuditOptions = {},
): Promise<EvidenceCitationEnvelope> {
  const citation = validateEvidenceCitationEnvelope(value);
  let expected: EvidenceCitationEnvelope;
  if (citation.evidenceKind === "current_run_speech") {
    const verified = await reopenSemanticEvidence(state, artifacts, citation.operationId!);
    expected = currentRunSpeechCitation({
      verified,
      target: citation.target as Extract<EvidenceCitationTarget, { kind: "claim" | "coverage" }>,
      observationIds: citation.observations.map((entry) => entry.observationId),
    });
  } else if (citation.evidenceKind === "acoustic_range") {
    const verified = await reopenAcousticCitationSource(state, artifacts, citation.evidence.artifactId);
    const byId = new Map(verified.observations.observations.map((entry) => [acousticObservationId(verified, entry.index), entry.index]));
    const indexes = citation.observations.map((entry) => {
      const index = byId.get(entry.observationId);
      if (index === undefined) throw new Error(`Acoustic citation names unsupported observation ${entry.observationId}`);
      return index;
    });
    expected = acousticRangeCitation({
      verified,
      target: citation.target as Extract<EvidenceCitationTarget, { kind: "coverage" }>,
      observationIndexes: indexes,
    });
  } else if (citation.evidenceKind === "frame_sample") {
    const verified = await auditFrameSampling(
      state,
      artifacts,
      options.frameDecoder ?? new FfmpegFrameDecoder(),
      citation.operationId!,
    );
    const frameIndex = verified.frames.findIndex((entry) => entry.identity.frameId === citation.observations[0]?.observationId);
    expected = frameSampleCitation({
      verified,
      frameIndex,
      target: citation.target as Extract<EvidenceCitationTarget, { kind: "media_context" }>,
    });
  } else {
    throw new Error(`Evidence citation kind ${citation.evidenceKind} has no registered producer or audit adapter`);
  }
  if (!same(citation, expected)) throw new Error(`Evidence citation ${citation.citationId} changed its audited producer projection`);
  return structuredClone(expected);
}
