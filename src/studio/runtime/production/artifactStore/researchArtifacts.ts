import { canonicalSha256 } from "../canonicalIdentity.ts";

/**
 * Content-addressed research artifact identities. The derivation matches
 * ContentAddressedArtifactStore.prepareDerived ({runId, operationId, kind, contentId}), so the
 * ids stay stable when the deferred projection origin wiring lands after the U7.1 lane.
 */
function researchArtifactId(runId: string, operationId: string, kind: string, contentId: string): string {
  return `artifact:${canonicalSha256({ runId, operationId, kind, contentId })}`;
}

export function researchSearchReceiptArtifactId(runId: string, operationId: string, contentId: string): string {
  return researchArtifactId(runId, operationId, "studio.research-search.receipt.v1", contentId);
}

export function researchDocumentArtifactId(runId: string, operationId: string, contentId: string): string {
  return researchArtifactId(runId, operationId, "studio.research-document-snapshot.v1", contentId);
}

export function researchExtractionArtifactId(runId: string, operationId: string, contentId: string): string {
  return researchArtifactId(runId, operationId, "studio.research-extraction.v1", contentId);
}

export function researchSnapshotReceiptArtifactId(runId: string, operationId: string, contentId: string): string {
  return researchArtifactId(runId, operationId, "studio.research-document-snapshot.receipt.v1", contentId);
}
