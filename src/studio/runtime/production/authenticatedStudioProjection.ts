import type { ContentAddressedArtifactStore } from "./artifactStore.ts";
import type { RuntimeProjection } from "./model.ts";
import { reopenSemanticEvidence } from "./semanticEvidenceAudit.ts";
import { reopenStudyReport } from "./studyReportAudit.ts";
import { reopenParentArtifactDisposition } from "./parentArtifactAdmissionAudit.ts";
import { reopenStudyPlanningDecision } from "./studyPlanningAudit.ts";
import { reopenOwnedMediaStudy } from "./studySynthesisAudit.ts";
import { reopenStudyReadiness } from "./studyReadinessAudit.ts";
import { adaptProductionRuntime, type ProductionStudioProjection } from "./studioProjection.ts";

/** Storage-aware projection: invalid/absent semantic bytes never expose availability identities. */
export async function adaptAuthenticatedProductionRuntime(
  state: RuntimeProjection,
  artifacts: ContentAddressedArtifactStore,
): Promise<ProductionStudioProjection> {
  const projection = adaptProductionRuntime(state);
  if (!projection.semanticEvidence) return projection;
  for (const view of projection.semanticEvidence) {
    if (view.status !== "completed") continue;
    try {
      await reopenSemanticEvidence(state, artifacts, view.operationId);
      view.audit = "verified_on_reopen";
    } catch {
      view.audit = "absent_or_invalid";
      view.returnedRange = null;
      view.artifact = null;
      view.receipt = null;
      view.observationCount = null;
      view.availability = null;
      view.failure = "Stored semantic evidence is absent or invalid.";
    }
  }
  for (const view of projection.studyReports) {
    try {
      if (view.disposition.dispositionId) {
        await reopenParentArtifactDisposition(state, artifacts, view.disposition.dispositionId);
      } else {
        await reopenStudyReport(state, artifacts, view.artifactId);
      }
      view.audit = "verified_on_reopen";
    } catch {
      view.audit = "absent_or_invalid";
      view.coverage = [];
      view.claims = [];
      view.counts = {
        ranges: { supported: 0, withheld: 0, unknown: 0, failed: 0 },
        durationMs: { supported: 0, withheld: 0, unknown: 0, failed: 0 },
        claims: 0,
        citations: 0,
        observationCitations: 0,
      };
      view.admission = { state: "absent", admissionId: null, receiptId: null, receiptContentId: null, grant: null };
    }
  }
  for (const view of projection.studyPlanningDecisions) {
    await reopenStudyPlanningDecision(state, artifacts, view.decisionId);
  }
  for (const view of projection.ownedMediaStudies) {
    await reopenOwnedMediaStudy(state, artifacts, view.studyId);
  }
  for (const view of projection.studyReadiness) {
    await reopenStudyReadiness(state, artifacts, view.readinessId);
  }
  return projection;
}
