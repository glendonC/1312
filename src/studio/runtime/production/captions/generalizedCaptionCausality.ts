import type { CaptionLineCausalityV3, EvidenceCitationEnvelope, QualifiedMediaRange, RuntimeProjection } from "../model.ts";
import type { ContentAddressedArtifactStore } from "../artifactStore.ts";
import type { GeneralizedEvidenceAdmissionOptions } from "../admission/generalizedEvidenceAdmissionHost.ts";
import {
  GeneralizedStudyReadinessHost,
  type GeneralizedReadinessV3Reference,
} from "../study/generalizedStudyReadinessHost.ts";

function closesLine(range: QualifiedMediaRange, citations: EvidenceCitationEnvelope[]): boolean {
  const observations = citations.flatMap((citation) => citation.observations)
    .filter((entry) => entry.state === "available" && entry.locator.kind === "temporal_range")
    .map((entry) => entry.locator.kind === "temporal_range" ? entry.locator.media : null)
    .filter((entry): entry is QualifiedMediaRange => entry !== null && entry.artifactId === range.artifactId && entry.trackId === range.trackId && entry.endMs > range.startMs && entry.startMs < range.endMs)
    .map((entry) => ({ ...entry, startMs: Math.max(entry.startMs, range.startMs), endMs: Math.min(entry.endMs, range.endMs) }))
    .sort((left, right) => left.startMs - right.startMs || left.endMs - right.endMs);
  let cursor = range.startMs; for (const found of observations) { if (found.startMs > cursor) return false; cursor = Math.max(cursor, found.endMs); if (cursor >= range.endMs) return true; } return false;
}

function reason(state: CaptionLineCausalityV3["lineage"]["coverageState"]): string {
  if (state === "not_in_scope") return "not_in_requested_dialogue_scope";
  if (state === "conflicting") return "study_coverage_conflict";
  if (state === "truncated") return "study_coverage_truncated";
  if (state === "unavailable") return "study_coverage_unavailable";
  if (state === "failed") return "study_coverage_failed";
  if (state === "withheld") return "study_coverage_withheld";
  if (state === "unknown") return "study_coverage_unknown";
  return "study_coverage_uncovered";
}

/** Caption causality copies only range-closing speech citations; context-only frames cannot authorize text. */
export class GeneralizedCaptionCausalityHost {
  private readonly readiness: GeneralizedStudyReadinessHost;
  constructor(state: RuntimeProjection, artifacts: ContentAddressedArtifactStore, options: GeneralizedEvidenceAdmissionOptions = {}) {
    this.readiness = new GeneralizedStudyReadinessHost(state, artifacts, options);
  }

  async close(input: {
    readiness: GeneralizedReadinessV3Reference;
    range: QualifiedMediaRange;
    sourceText: string;
    targetText: string;
  }): Promise<CaptionLineCausalityV3> {
    const ready = await this.readiness.reopen(input.readiness); const study = ready.reopenedStudy;
    const covering = study?.envelope.coverage.filter((entry) => entry.artifactId === input.range.artifactId && entry.trackId === input.range.trackId && entry.startMs <= input.range.startMs && entry.endMs >= input.range.endMs) ?? [];
    const coverage = covering.length === 1 ? covering[0] : null;
    let claimIds: string[] = []; let citationIds: string[] = []; let allowed = false;
    if (ready.receipt.result.outcome === "proceed_to_caption_review" && study && coverage?.state === "supported") {
      const citationById = new Map(study.envelope.evidenceCitations.map((entry) => [entry.citationId, entry]));
      const claim = coverage.claimIds.map((id) => study.envelope.claims.find((entry) => entry.claimId === id)).find((entry) => {
        if (!entry || entry.startMs > input.range.startMs || entry.endMs < input.range.endMs) return false;
        const citations = entry.citationIds.map((id) => citationById.get(id)).filter((value): value is EvidenceCitationEnvelope => Boolean(value));
        return citations.every((citation) => citation.use === "claim_support" && citation.evidenceKind === "current_run_speech") && closesLine(input.range, citations);
      });
      if (claim) { allowed = true; claimIds = [claim.claimId]; citationIds = [...claim.citationIds]; }
    }
    const coverageState = coverage?.state ?? "uncovered"; const withheldReason = allowed ? null : ready.receipt.result.outcome === "withheld" ? "study_readiness_withheld" : reason(coverageState);
    return {
      schema: "studio.caption-line-causality.v3", range: structuredClone(input.range),
      source: { language: "ko", state: allowed ? "available" : "withheld", text: allowed ? input.sourceText : null, reasonCode: withheldReason },
      target: { language: "en", state: allowed ? "available" : "withheld", text: allowed ? input.targetText : null, reasonCode: withheldReason },
      lineage: { study: structuredClone(input.readiness.study.study), readiness: { readinessId: input.readiness.readinessId, receiptId: input.readiness.receiptId, receiptContentId: input.readiness.receiptContentId }, coverageId: coverage?.coverageId ?? null, coverageState, preservedStates: coverage?.preservedStates ?? [], claimIds, citationIds },
    };
  }
}
