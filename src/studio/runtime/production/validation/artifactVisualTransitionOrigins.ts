import type { ArtifactOriginValidationInput } from "./artifactOrigin.ts";
import { contentId, exact, fail, literal, string } from "./primitives.ts";

export function validateVisualTransitionArtifactOrigin(
  kind: string,
  { item, origin, mediaClass, sources, task, agent, context, path }: ArtifactOriginValidationInput,
): boolean {
  if (kind !== "visual_transition_observations" && kind !== "visual_transition_receipt") return false;
  if (mediaClass !== "non_media" || sources.length < 7 || task === null || agent === null) {
    fail(context, `${path}.origin`, "visual-transition artifacts must be private non-media task outputs with closed U2/U5 lineage");
  }
  literal(item.publication, "private", context, `${path}.publication`);
  if (kind === "visual_transition_observations") {
    exact(origin, ["kind", "operationId", "receiptId", "receiptContentId", "frameSamplingOperationId", "ocrOperationId"], context, `${path}.origin`);
    literal(origin.kind, kind, context, `${path}.origin.kind`);
    for (const key of ["operationId", "receiptId", "frameSamplingOperationId", "ocrOperationId"]) {
      string(origin[key], context, `${path}.origin.${key}`);
    }
    contentId(origin.receiptContentId, context, `${path}.origin.receiptContentId`);
    return true;
  }
  exact(origin, ["kind", "operationId", "receiptId", "observationsArtifactId", "frameSamplingOperationId", "ocrOperationId"], context, `${path}.origin`);
  literal(origin.kind, kind, context, `${path}.origin.kind`);
  for (const key of ["operationId", "receiptId", "observationsArtifactId", "frameSamplingOperationId", "ocrOperationId"]) {
    string(origin[key], context, `${path}.origin.${key}`);
  }
  return true;
}
