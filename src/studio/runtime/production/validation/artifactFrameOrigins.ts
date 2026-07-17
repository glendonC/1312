import type { ArtifactOriginValidationInput } from "./artifactOrigin.ts";
import { contentId, exact, fail, string } from "./primitives.ts";

export function validateFrameArtifactOrigin(
  kind: string,
  input: ArtifactOriginValidationInput,
): boolean {
  const { item, origin, mediaClass, sources, task, agent, context, path } = input;
  if (kind === "sampled_frame") {
    exact(origin, ["kind", "operationId", "frameId", "manifestArtifactId", "receiptId", "receiptContentId"], context, `${path}.origin`);
    string(origin.operationId, context, `${path}.origin.operationId`);
    string(origin.frameId, context, `${path}.origin.frameId`);
    string(origin.manifestArtifactId, context, `${path}.origin.manifestArtifactId`);
    string(origin.receiptId, context, `${path}.origin.receiptId`);
    contentId(origin.receiptContentId, context, `${path}.origin.receiptContentId`);
    if (
      item.kind !== "sampled-video-frame" || mediaClass !== "derived" || item.publication !== "private" ||
      item.durationMs !== null || (item.tracks as unknown[]).length !== 0 || sources.length !== 1 ||
      task === null || agent === null
    ) fail(context, path, "sampled frames must be private derived image bytes with one source and task producer");
    return true;
  }
  if (kind === "frame_sample_manifest") {
    exact(origin, ["kind", "operationId", "receiptId", "receiptContentId"], context, `${path}.origin`);
    string(origin.operationId, context, `${path}.origin.operationId`);
    string(origin.receiptId, context, `${path}.origin.receiptId`);
    contentId(origin.receiptContentId, context, `${path}.origin.receiptContentId`);
    if (
      item.kind !== "studio.frame-sample-manifest.v1" || mediaClass !== "non_media" || item.publication !== "private" ||
      item.durationMs !== null || (item.tracks as unknown[]).length !== 0 || sources.length < 2 ||
      task === null || agent === null
    ) fail(context, path, "frame manifests must be private canonical metadata with source/frame lineage and a task producer");
    return true;
  }
  if (kind === "frame_sampling_receipt") {
    exact(origin, ["kind", "operationId", "receiptId", "manifestArtifactId"], context, `${path}.origin`);
    string(origin.operationId, context, `${path}.origin.operationId`);
    string(origin.receiptId, context, `${path}.origin.receiptId`);
    string(origin.manifestArtifactId, context, `${path}.origin.manifestArtifactId`);
    if (
      item.kind !== "studio.frame-sampling.receipt.v1" || mediaClass !== "non_media" || item.publication !== "private" ||
      item.durationMs !== null || (item.tracks as unknown[]).length !== 0 || sources.length < 3 ||
      task === null || agent === null || origin.receiptId === ""
    ) fail(context, path, "frame receipts must be private canonical metadata with complete source/manifest/frame lineage");
    return true;
  }
  if (kind === "ocr_observations") {
    exact(origin, ["kind", "operationId", "receiptId", "receiptContentId", "frameSamplingOperationId"], context, `${path}.origin`);
    string(origin.operationId, context, `${path}.origin.operationId`);
    string(origin.receiptId, context, `${path}.origin.receiptId`);
    contentId(origin.receiptContentId, context, `${path}.origin.receiptContentId`);
    string(origin.frameSamplingOperationId, context, `${path}.origin.frameSamplingOperationId`);
    if (
      item.kind !== "studio.ocr-observations.v1" || mediaClass !== "non_media" || item.publication !== "private" ||
      item.durationMs !== null || (item.tracks as unknown[]).length !== 0 || sources.length < 4 ||
      task === null || agent === null
    ) fail(context, path, "OCR observations must be private canonical metadata with complete U2 frame lineage");
    return true;
  }
  if (kind === "ocr_receipt") {
    exact(origin, ["kind", "operationId", "receiptId", "observationsArtifactId", "frameSamplingOperationId"], context, `${path}.origin`);
    string(origin.operationId, context, `${path}.origin.operationId`);
    string(origin.receiptId, context, `${path}.origin.receiptId`);
    string(origin.observationsArtifactId, context, `${path}.origin.observationsArtifactId`);
    string(origin.frameSamplingOperationId, context, `${path}.origin.frameSamplingOperationId`);
    if (
      item.kind !== "studio.ocr-producer.receipt.v1" || mediaClass !== "non_media" || item.publication !== "private" ||
      item.durationMs !== null || (item.tracks as unknown[]).length !== 0 || sources.length < 5 ||
      task === null || agent === null
    ) fail(context, path, "OCR receipts must be private canonical metadata with observations and U2 frame lineage");
    return true;
  }
  return false;
}
