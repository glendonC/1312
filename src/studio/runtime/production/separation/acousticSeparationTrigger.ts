import type { AcousticObservation, AcousticObservations } from "../../../acoustic/contracts.ts";
import { CONDITIONAL_SEPARATION_LIMITS } from "../model.ts";
import type { RuntimeArtifact, U1AcousticSeparationTrigger } from "../model.ts";

/**
 * Closed U7.1 (acoustic mixed-cell separation trigger) eligibility predicate.
 * A representable acoustic cell is `mixed` only when the classifier proved strong certainty and
 * both speech and music families cleared the support threshold (see acoustic/validation.ts: weak
 * forces `unknown`, and `mixed` requires `supported_speech_and_music`). It is therefore the one
 * acoustic state that is a host-derived fact of two co-present source families, not a guess. We
 * additionally require a complete partition and the shared U7 (conditional separation) range cap.
 * This proves co-presence only; it never asserts the streams are separable or that separation
 * improves meaning.
 */
export function isEligibleU1AcousticMixedCell(
  observations: AcousticObservations,
  cell: AcousticObservation,
): boolean {
  return observations.status === "complete" &&
    cell.classification === "mixed" &&
    cell.endMs > cell.startMs &&
    cell.endMs - cell.startMs <= CONDITIONAL_SEPARATION_LIMITS.maxRangeMs;
}

/**
 * Synchronous lineage check reused by the scheduler grant, the grant-consumption authorization, and
 * the started-event projection invariant. It confirms the trigger still names a preflight acoustic
 * artifact with unchanged content and producer-receipt identity, bound to the same owned ingest
 * source and audio track. The deep cell-level `mixed` re-audit runs asynchronously in the host
 * inspect, producer pre-run, and cold replay; the content-id pin here means those bytes are the
 * exact ones already audited.
 */
export function u1AcousticTriggerLineageMatches(
  artifacts: Record<string, RuntimeArtifact>,
  trigger: U1AcousticSeparationTrigger,
  expectedSourceArtifactId: string,
  expectedTrackId: string,
): boolean {
  const acoustic = artifacts[trigger.observationsArtifactId];
  return Boolean(acoustic) &&
    acoustic.origin.kind === "preflight_evidence" &&
    acoustic.origin.evidenceKind === "acoustic_ranges" &&
    acoustic.origin.producerReceiptContentId === trigger.receiptContentId &&
    acoustic.content.contentId === trigger.observationsContentId &&
    acoustic.sourceArtifactIds.length === 1 &&
    acoustic.sourceArtifactIds[0] === expectedSourceArtifactId &&
    trigger.trackId === expectedTrackId;
}
