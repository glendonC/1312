import type { ContentAddressedArtifactStore } from "./artifactStore.ts";
import type { RuntimeProjection } from "./model.ts";
import { reopenSemanticEvidence } from "./semanticEvidenceAudit.ts";
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
  return projection;
}
