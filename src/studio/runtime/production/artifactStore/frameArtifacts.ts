import { canonicalSha256 } from "../canonicalIdentity.ts";
import type {
  ContentIdentity,
  FrameSamplingReceipt,
  RuntimeArtifact,
  SampledFrameIdentity,
} from "../model.ts";
import { assertRuntimeArtifact } from "../validation/artifacts.ts";

export interface PreparedFrameObject {
  artifactId: string;
  content: ContentIdentity;
  storageKey: string;
}

export interface PreparedFrameJsonObject extends PreparedFrameObject {}

export function frameArtifactId(runId: string, operationId: string, index: number, contentId: string): string {
  return `artifact:${canonicalSha256({ runId, operationId, index, kind: "sampled-video-frame", contentId })}`;
}

export function frameIdentity(input: {
  sourceContentId: string;
  trackId: string;
  requestedTimestampMs: number;
  actualPresentationTimestampUs: number;
  contentId: string;
}): string {
  return `frame:${canonicalSha256(input)}`;
}

export function frameManifestArtifactId(runId: string, operationId: string, contentId: string): string {
  return `artifact:${canonicalSha256({ runId, operationId, kind: "studio.frame-sample-manifest.v1", contentId })}`;
}

export function frameReceiptArtifactId(runId: string, operationId: string, contentId: string): string {
  return `artifact:${canonicalSha256({ runId, operationId, kind: "studio.frame-sampling.receipt.v1", contentId })}`;
}

export function buildSampledFrameArtifact(input: {
  runId: string;
  sourceArtifactId: string;
  taskId: string;
  agentId: string;
  manifestArtifactId: string;
  receipt: FrameSamplingReceipt;
  receiptContentId: string;
  frame: SampledFrameIdentity;
  prepared: PreparedFrameObject;
}): RuntimeArtifact {
  const artifact: RuntimeArtifact = {
    schema: "studio.runtime.artifact.v1",
    id: input.frame.artifactId,
    runId: input.runId,
    kind: "sampled-video-frame",
    mediaClass: "derived",
    publication: "private",
    content: input.prepared.content,
    storageKey: input.prepared.storageKey,
    durationMs: null,
    tracks: [],
    sourceArtifactIds: [input.sourceArtifactId],
    producerTaskId: input.taskId,
    producerAgentId: input.agentId,
    origin: {
      kind: "sampled_frame",
      operationId: input.receipt.operationId,
      frameId: input.frame.frameId,
      manifestArtifactId: input.manifestArtifactId,
      receiptId: input.receipt.receiptId,
      receiptContentId: input.receiptContentId,
    },
  };
  assertRuntimeArtifact(artifact);
  return artifact;
}

export function buildFrameManifestArtifact(input: {
  runId: string;
  sourceArtifactId: string;
  frameArtifactIds: string[];
  taskId: string;
  agentId: string;
  receipt: FrameSamplingReceipt;
  receiptContentId: string;
  prepared: PreparedFrameJsonObject;
}): RuntimeArtifact {
  const artifact: RuntimeArtifact = {
    schema: "studio.runtime.artifact.v1",
    id: input.prepared.artifactId,
    runId: input.runId,
    kind: "studio.frame-sample-manifest.v1",
    mediaClass: "non_media",
    publication: "private",
    content: input.prepared.content,
    storageKey: input.prepared.storageKey,
    durationMs: null,
    tracks: [],
    sourceArtifactIds: [input.sourceArtifactId, ...input.frameArtifactIds],
    producerTaskId: input.taskId,
    producerAgentId: input.agentId,
    origin: {
      kind: "frame_sample_manifest",
      operationId: input.receipt.operationId,
      receiptId: input.receipt.receiptId,
      receiptContentId: input.receiptContentId,
    },
  };
  assertRuntimeArtifact(artifact);
  return artifact;
}

export function buildFrameReceiptArtifact(input: {
  runId: string;
  sourceArtifactId: string;
  frameArtifactIds: string[];
  manifestArtifactId: string;
  taskId: string;
  agentId: string;
  receipt: FrameSamplingReceipt;
  prepared: PreparedFrameJsonObject;
}): RuntimeArtifact {
  const artifact: RuntimeArtifact = {
    schema: "studio.runtime.artifact.v1",
    id: input.prepared.artifactId,
    runId: input.runId,
    kind: "studio.frame-sampling.receipt.v1",
    mediaClass: "non_media",
    publication: "private",
    content: input.prepared.content,
    storageKey: input.prepared.storageKey,
    durationMs: null,
    tracks: [],
    sourceArtifactIds: [input.sourceArtifactId, input.manifestArtifactId, ...input.frameArtifactIds],
    producerTaskId: input.taskId,
    producerAgentId: input.agentId,
    origin: {
      kind: "frame_sampling_receipt",
      operationId: input.receipt.operationId,
      receiptId: input.receipt.receiptId,
      manifestArtifactId: input.manifestArtifactId,
    },
  };
  assertRuntimeArtifact(artifact);
  return artifact;
}
