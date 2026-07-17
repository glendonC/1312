import { canonicalSha256 } from "../canonicalIdentity.ts";
import type { ContentIdentity, OcrReceipt, RuntimeArtifact } from "../model.ts";
import { assertRuntimeArtifact } from "../validation/artifacts.ts";

export interface PreparedOcrJsonObject {
  artifactId: string;
  content: ContentIdentity;
  storageKey: string;
}

export function ocrObservationsArtifactId(runId: string, operationId: string, contentId: string): string {
  return `artifact:${canonicalSha256({ runId, operationId, kind: "studio.ocr-observations.v1", contentId })}`;
}

export function ocrReceiptArtifactId(runId: string, operationId: string, contentId: string): string {
  return `artifact:${canonicalSha256({ runId, operationId, kind: "studio.ocr-producer.receipt.v1", contentId })}`;
}

export function buildOcrObservationsArtifact(input: {
  runId: string;
  sourceArtifactIds: string[];
  taskId: string;
  agentId: string;
  receipt: OcrReceipt;
  receiptContentId: string;
  prepared: PreparedOcrJsonObject;
}): RuntimeArtifact {
  const artifact: RuntimeArtifact = {
    schema: "studio.runtime.artifact.v1",
    id: input.prepared.artifactId,
    runId: input.runId,
    kind: "studio.ocr-observations.v1",
    mediaClass: "non_media",
    publication: "private",
    content: input.prepared.content,
    storageKey: input.prepared.storageKey,
    durationMs: null,
    tracks: [],
    sourceArtifactIds: [...input.sourceArtifactIds],
    producerTaskId: input.taskId,
    producerAgentId: input.agentId,
    origin: {
      kind: "ocr_observations",
      operationId: input.receipt.operationId,
      receiptId: input.receipt.receiptId,
      receiptContentId: input.receiptContentId,
      frameSamplingOperationId: input.receipt.request.frameSamplingOperationId,
    },
  };
  assertRuntimeArtifact(artifact);
  return artifact;
}

export function buildOcrReceiptArtifact(input: {
  runId: string;
  sourceArtifactIds: string[];
  taskId: string;
  agentId: string;
  receipt: OcrReceipt;
  prepared: PreparedOcrJsonObject;
}): RuntimeArtifact {
  const artifact: RuntimeArtifact = {
    schema: "studio.runtime.artifact.v1",
    id: input.prepared.artifactId,
    runId: input.runId,
    kind: "studio.ocr-producer.receipt.v1",
    mediaClass: "non_media",
    publication: "private",
    content: input.prepared.content,
    storageKey: input.prepared.storageKey,
    durationMs: null,
    tracks: [],
    sourceArtifactIds: [...input.sourceArtifactIds],
    producerTaskId: input.taskId,
    producerAgentId: input.agentId,
    origin: {
      kind: "ocr_receipt",
      operationId: input.receipt.operationId,
      receiptId: input.receipt.receiptId,
      observationsArtifactId: input.receipt.output.artifactId,
      frameSamplingOperationId: input.receipt.request.frameSamplingOperationId,
    },
  };
  assertRuntimeArtifact(artifact);
  return artifact;
}
