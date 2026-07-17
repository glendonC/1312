import type { ArtifactOriginValidationInput } from "./artifactOrigin.ts";
import { contentId, exact, fail, string } from "./primitives.ts";

export function validateSpeakerArtifactOrigin(kind: string, input: ArtifactOriginValidationInput): boolean {
  const { item, origin, mediaClass, sources, task, agent, context, path } = input;
  if (kind === "speaker_overlap_observations") {
    exact(origin, ["kind", "operationId", "receiptId", "receiptContentId"], context, `${path}.origin`);
    string(origin.operationId, context, `${path}.origin.operationId`);
    string(origin.receiptId, context, `${path}.origin.receiptId`);
    contentId(origin.receiptContentId, context, `${path}.origin.receiptContentId`);
    if (
      item.kind !== "studio.speaker-overlap-observations.v1" || mediaClass !== "non_media" ||
      item.publication !== "private" || item.durationMs !== null || (item.tracks as unknown[]).length !== 0 ||
      sources.length !== 1 || task === null || agent === null
    ) fail(context, path, "speaker/overlap observations must be private canonical metadata with one owned source and task producer");
    return true;
  }
  if (kind === "speaker_overlap_receipt") {
    exact(origin, ["kind", "operationId", "receiptId", "observationsArtifactId"], context, `${path}.origin`);
    string(origin.operationId, context, `${path}.origin.operationId`);
    string(origin.receiptId, context, `${path}.origin.receiptId`);
    string(origin.observationsArtifactId, context, `${path}.origin.observationsArtifactId`);
    if (
      item.kind !== "studio.speaker-overlap-producer.receipt.v1" || mediaClass !== "non_media" ||
      item.publication !== "private" || item.durationMs !== null || (item.tracks as unknown[]).length !== 0 ||
      sources.length !== 2 || task === null || agent === null
    ) fail(context, path, "speaker/overlap receipts must be private canonical metadata with source/observations lineage");
    return true;
  }
  return false;
}
