import { SEPARATION_METHOD } from "../model.ts";
import type { ArtifactOriginValidationInput } from "./artifactOrigin.ts";
import { array, contentId, exact, fail, integer, literal, string } from "./primitives.ts";

function privateTaskArtifact(input: ArtifactOriginValidationInput, expected: { kind: string; mediaClass: "derived" | "non_media"; sources: number; media: boolean }): void {
  const { item, mediaClass, sources, task, agent, context, path } = input;
  if (
    item.kind !== expected.kind || mediaClass !== expected.mediaClass || item.publication !== "private" ||
    sources.length !== expected.sources || task === null || agent === null ||
    (expected.media ? (item.durationMs as number) <= 0 || (item.tracks as unknown[]).length !== 1 : item.durationMs !== null || (item.tracks as unknown[]).length !== 0)
  ) fail(context, path, `${expected.kind} must be a private task-owned ${expected.media ? "derived audio" : "canonical metadata"} artifact with closed lineage`);
}

export function validateSeparationArtifactOrigin(kind: string, input: ArtifactOriginValidationInput): boolean {
  const { origin, context, path } = input;
  if (kind === "separation_stem") {
    exact(origin, ["kind", "operationId", "receiptId", "receiptContentId", "stemRole", "sourceArtifactId", "sourceContentId", "trackId", "startMs", "endMs", "triggerOperationId", "triggerObservationId", "methodId", "modelContentIds", "configurationContentId"], context, `${path}.origin`);
    for (const key of ["operationId", "receiptId", "sourceArtifactId", "trackId", "triggerOperationId", "triggerObservationId"]) string(origin[key], context, `${path}.origin.${key}`);
    contentId(origin.receiptContentId, context, `${path}.origin.receiptContentId`);
    contentId(origin.sourceContentId, context, `${path}.origin.sourceContentId`);
    literal(origin.methodId, SEPARATION_METHOD.id, context, `${path}.origin.methodId`);
    literal(origin.configurationContentId, SEPARATION_METHOD.configurationContentId, context, `${path}.origin.configurationContentId`);
    literal(origin.stemRole, origin.stemRole === "source_estimate_1" ? "source_estimate_1" : "source_estimate_2", context, `${path}.origin.stemRole`);
    const modelIds = array(origin.modelContentIds, context, `${path}.origin.modelContentIds`).map((entry, index) => contentId(entry, context, `${path}.origin.modelContentIds[${index}]`));
    if (JSON.stringify(modelIds) !== JSON.stringify(SEPARATION_METHOD.modelContentIds)) fail(context, `${path}.origin.modelContentIds`, "changed pinned model bytes");
    const startMs = integer(origin.startMs, context, `${path}.origin.startMs`);
    const endMs = integer(origin.endMs, context, `${path}.origin.endMs`, 1);
    if (endMs <= startMs) fail(context, `${path}.origin`, "must bind a non-empty exact range");
    privateTaskArtifact(input, { kind: "studio.separated-audio-stem.v1", mediaClass: "derived", sources: 3, media: true });
    return true;
  }
  if (kind === "conditional_separation_receipt") {
    exact(origin, ["kind", "operationId", "receiptId", "stemArtifactIds"], context, `${path}.origin`);
    string(origin.operationId, context, `${path}.origin.operationId`);
    string(origin.receiptId, context, `${path}.origin.receiptId`);
    const stems = array(origin.stemArtifactIds, context, `${path}.origin.stemArtifactIds`).map((entry, index) => string(entry, context, `${path}.origin.stemArtifactIds[${index}]`));
    if (stems.length !== 2 || new Set(stems).size !== 2) fail(context, `${path}.origin.stemArtifactIds`, "must identify both unique stems");
    privateTaskArtifact(input, { kind: "studio.conditional-separation.receipt.v1", mediaClass: "non_media", sources: 5, media: false });
    return true;
  }
  if (kind === "raw_stem_comparison") {
    exact(origin, ["kind", "operationId", "separationReceiptId", "receiptId", "receiptContentId"], context, `${path}.origin`);
    for (const key of ["operationId", "separationReceiptId", "receiptId"]) string(origin[key], context, `${path}.origin.${key}`);
    contentId(origin.receiptContentId, context, `${path}.origin.receiptContentId`);
    privateTaskArtifact(input, { kind: "studio.raw-stem-comparison.v1", mediaClass: "non_media", sources: 4, media: false });
    return true;
  }
  if (kind === "raw_stem_comparison_receipt") {
    exact(origin, ["kind", "operationId", "receiptId", "comparisonArtifactId", "separationReceiptId"], context, `${path}.origin`);
    for (const key of ["operationId", "receiptId", "comparisonArtifactId", "separationReceiptId"]) string(origin[key], context, `${path}.origin.${key}`);
    privateTaskArtifact(input, { kind: "studio.raw-stem-comparison.receipt.v1", mediaClass: "non_media", sources: 5, media: false });
    return true;
  }
  return false;
}
