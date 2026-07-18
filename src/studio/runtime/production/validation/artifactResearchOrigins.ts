import type { ArtifactOriginValidationInput } from "./artifactOrigin.ts";
import { exact, fail, integer, oneOf, string } from "./primitives.ts";

function privateResearchArtifact(input: ArtifactOriginValidationInput, expected: { kind: string; sources: number }): void {
  const { item, mediaClass, sources, task, agent, context, path } = input;
  if (
    item.kind !== expected.kind || mediaClass !== "non_media" || item.publication !== "private" ||
    sources.length !== expected.sources || task === null || agent === null ||
    item.durationMs !== null || (item.tracks as unknown[]).length !== 0
  ) fail(context, path, `${expected.kind} must be a private task-owned research artifact with closed lineage`);
}

export function validateResearchArtifactOrigin(kind: string, input: ArtifactOriginValidationInput): boolean {
  const { origin, context, path } = input;
  if (kind === "research_search_receipt") {
    exact(origin, ["kind", "operationId", "receiptId"], context, `${path}.origin`);
    string(origin.operationId, context, `${path}.origin.operationId`);
    string(origin.receiptId, context, `${path}.origin.receiptId`);
    privateResearchArtifact(input, { kind: "studio.research-search.receipt.v1", sources: 0 });
    return true;
  }
  if (kind === "research_document_snapshot") {
    exact(origin, ["kind", "operationId", "searchOperationId", "resultIndex"], context, `${path}.origin`);
    string(origin.operationId, context, `${path}.origin.operationId`);
    string(origin.searchOperationId, context, `${path}.origin.searchOperationId`);
    integer(origin.resultIndex, context, `${path}.origin.resultIndex`, 0);
    privateResearchArtifact(input, { kind: "studio.research-document-snapshot.v1", sources: 1 });
    return true;
  }
  if (kind === "research_extraction") {
    exact(origin, ["kind", "operationId", "documentArtifactId", "method"], context, `${path}.origin`);
    string(origin.operationId, context, `${path}.origin.operationId`);
    string(origin.documentArtifactId, context, `${path}.origin.documentArtifactId`);
    oneOf(origin.method, new Set(["html_text_v1", "plain_text_v1"]), context, `${path}.origin.method`);
    privateResearchArtifact(input, { kind: "studio.research-extraction.v1", sources: 1 });
    return true;
  }
  if (kind === "research_snapshot_receipt") {
    exact(origin, ["kind", "operationId", "receiptId", "documentArtifactId", "extractionArtifactId"], context, `${path}.origin`);
    for (const key of ["operationId", "receiptId", "documentArtifactId", "extractionArtifactId"]) string(origin[key], context, `${path}.origin.${key}`);
    privateResearchArtifact(input, { kind: "studio.research-document-snapshot.receipt.v1", sources: 3 });
    return true;
  }
  return false;
}
