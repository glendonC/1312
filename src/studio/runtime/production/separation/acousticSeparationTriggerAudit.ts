import type { ContentAddressedArtifactStore } from "../artifactStore.ts";
import { acousticObservationId, reopenAcousticCitationSource, type VerifiedAcousticCitationSource } from "../evidenceCitations/audit.ts";
import type { ConditionalSeparationTriggerOption, RuntimeProjection, U1AcousticSeparationTrigger } from "../model.ts";
import { isEligibleU1AcousticMixedCell } from "./acousticSeparationTrigger.ts";

function triggerBody(
  verified: VerifiedAcousticCitationSource,
  index: number,
): Omit<ConditionalSeparationTriggerOption, "triggerId"> {
  const cell = verified.observations.observations[index];
  return {
    source: {
      artifactId: verified.source.artifactId,
      contentId: verified.source.contentId,
      trackId: verified.source.trackId,
      range: { startMs: cell.startMs, endMs: cell.endMs },
    },
    trigger: {
      kind: "u1_acoustic_mixed",
      observationsArtifactId: verified.artifactId,
      observationsContentId: verified.artifactContentId,
      receiptId: verified.receiptId,
      receiptContentId: verified.receiptContentId,
      observationId: acousticObservationId(verified, index),
      observationIndex: index,
      trackId: verified.source.trackId,
      range: { startMs: cell.startMs, endMs: cell.endMs },
    },
  };
}

/**
 * Host-derived, cold-audited list of exact U7.1 (acoustic mixed-cell) triggers eligible for U7
 * (conditional separation). Mirrors the U6.1 (speaker_overlap) loop in
 * ConditionalSeparationRequestHost: enumerate the preflight acoustic artifacts, reopen and
 * re-verify their bytes/receipt lineage, and surface one option per `mixed` cell. A broken or
 * tampered artifact reopens to an error and is skipped (fail closed by offering no trigger).
 */
export async function deriveU1AcousticSeparationTriggerBodies(
  state: RuntimeProjection,
  artifacts: ContentAddressedArtifactStore,
): Promise<Array<Omit<ConditionalSeparationTriggerOption, "triggerId">>> {
  const bodies: Array<Omit<ConditionalSeparationTriggerOption, "triggerId">> = [];
  const acousticArtifacts = Object.values(state.artifacts)
    .filter((artifact) => artifact.origin.kind === "preflight_evidence" && artifact.origin.evidenceKind === "acoustic_ranges")
    .sort((left, right) => left.id.localeCompare(right.id));
  for (const artifact of acousticArtifacts) {
    const verified = await reopenAcousticCitationSource(state, artifacts, artifact.id).catch(() => null);
    if (!verified) continue;
    for (const cell of verified.observations.observations) {
      if (!isEligibleU1AcousticMixedCell(verified.observations, cell)) continue;
      bodies.push(triggerBody(verified, cell.index));
    }
  }
  return bodies;
}

/**
 * Re-audit one U1 acoustic trigger from journal identity, used by the producer pre-run check and the
 * cold replay audit. Reopen may throw on byte/lineage tamper (the caller propagates that as the
 * canonical content-identity failure); an ineligible or drifted cell/identity returns false so the
 * caller can fail with its own trigger-invalid error.
 */
export async function reauditU1AcousticSeparationTrigger(
  state: RuntimeProjection,
  artifacts: ContentAddressedArtifactStore,
  trigger: U1AcousticSeparationTrigger,
  expected: { startMs: number; endMs: number; trackId: string },
): Promise<boolean> {
  const verified = await reopenAcousticCitationSource(state, artifacts, trigger.observationsArtifactId);
  const cell = verified.observations.observations[trigger.observationIndex];
  return Boolean(cell) &&
    isEligibleU1AcousticMixedCell(verified.observations, cell) &&
    cell.startMs === expected.startMs && cell.endMs === expected.endMs &&
    cell.startMs === trigger.range.startMs && cell.endMs === trigger.range.endMs &&
    verified.artifactId === trigger.observationsArtifactId &&
    verified.artifactContentId === trigger.observationsContentId &&
    verified.receiptId === trigger.receiptId &&
    verified.receiptContentId === trigger.receiptContentId &&
    verified.source.trackId === expected.trackId &&
    verified.source.trackId === trigger.trackId &&
    acousticObservationId(verified, trigger.observationIndex) === trigger.observationId;
}
