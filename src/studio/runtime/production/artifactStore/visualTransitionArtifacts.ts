import { canonicalSha256 } from "../canonicalIdentity.ts";
import type { ContentIdentity, RuntimeArtifact } from "../model.ts";
import type { VisualTransitionReceipt } from "../model/visualTransitions.ts";
import { assertRuntimeArtifact } from "../validation/artifacts.ts";

export interface PreparedVisualTransitionJsonObject {
  artifactId: string;
  content: ContentIdentity;
  storageKey: string;
}

export function visualTransitionObservationsArtifactId(runId: string, operationId: string, contentId: string): string {
  return `artifact:${canonicalSha256({ runId, operationId, kind: "studio.visual-transition-observations.v1", contentId })}`;
}

export function visualTransitionReceiptArtifactId(runId: string, operationId: string, contentId: string): string {
  return `artifact:${canonicalSha256({ runId, operationId, kind: "studio.visual-transition-producer.receipt.v1", contentId })}`;
}

export function buildVisualTransitionObservationsArtifact(input: {
  runId: string;
  sourceArtifactIds: string[];
  taskId: string;
  agentId: string;
  receipt: VisualTransitionReceipt;
  receiptContentId: string;
  prepared: PreparedVisualTransitionJsonObject;
}): RuntimeArtifact {
  const artifact: RuntimeArtifact = {
    schema: "studio.runtime.artifact.v1",
    id: input.prepared.artifactId,
    runId: input.runId,
    kind: "studio.visual-transition-observations.v1",
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
      kind: "visual_transition_observations",
      operationId: input.receipt.operationId,
      receiptId: input.receipt.receiptId,
      receiptContentId: input.receiptContentId,
      frameSamplingOperationId: input.receipt.request.frameSamplingOperationId,
      ocrOperationId: input.receipt.request.ocrOperationId,
    },
  };
  assertRuntimeArtifact(artifact);
  return artifact;
}

export function buildVisualTransitionReceiptArtifact(input: {
  runId: string;
  sourceArtifactIds: string[];
  taskId: string;
  agentId: string;
  receipt: VisualTransitionReceipt;
  prepared: PreparedVisualTransitionJsonObject;
}): RuntimeArtifact {
  const artifact: RuntimeArtifact = {
    schema: "studio.runtime.artifact.v1",
    id: input.prepared.artifactId,
    runId: input.runId,
    kind: "studio.visual-transition-producer.receipt.v1",
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
      kind: "visual_transition_receipt",
      operationId: input.receipt.operationId,
      receiptId: input.receipt.receiptId,
      observationsArtifactId: input.receipt.output.artifactId,
      frameSamplingOperationId: input.receipt.request.frameSamplingOperationId,
      ocrOperationId: input.receipt.request.ocrOperationId,
    },
  };
  assertRuntimeArtifact(artifact);
  return artifact;
}
