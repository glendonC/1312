import { canonicalSha256 } from "../canonicalIdentity.ts";
import type { ContentIdentity, RuntimeArtifact, SpeakerOverlapReceipt } from "../model.ts";
import { assertRuntimeArtifact } from "../validation/artifacts.ts";

export interface PreparedSpeakerJsonObject {
  artifactId: string;
  content: ContentIdentity;
  storageKey: string;
}

export function speakerObservationsArtifactId(runId: string, operationId: string, contentId: string): string {
  return `artifact:${canonicalSha256({ runId, operationId, kind: "studio.speaker-overlap-observations.v1", contentId })}`;
}

export function speakerReceiptArtifactId(runId: string, operationId: string, contentId: string): string {
  return `artifact:${canonicalSha256({ runId, operationId, kind: "studio.speaker-overlap-producer.receipt.v1", contentId })}`;
}

export function buildSpeakerObservationsArtifact(input: {
  runId: string;
  sourceArtifactId: string;
  taskId: string;
  agentId: string;
  receipt: SpeakerOverlapReceipt;
  receiptContentId: string;
  prepared: PreparedSpeakerJsonObject;
}): RuntimeArtifact {
  const artifact: RuntimeArtifact = {
    schema: "studio.runtime.artifact.v1",
    id: input.prepared.artifactId,
    runId: input.runId,
    kind: "studio.speaker-overlap-observations.v1",
    mediaClass: "non_media",
    publication: "private",
    content: input.prepared.content,
    storageKey: input.prepared.storageKey,
    durationMs: null,
    tracks: [],
    sourceArtifactIds: [input.sourceArtifactId],
    producerTaskId: input.taskId,
    producerAgentId: input.agentId,
    origin: {
      kind: "speaker_overlap_observations",
      operationId: input.receipt.operationId,
      receiptId: input.receipt.receiptId,
      receiptContentId: input.receiptContentId,
    },
  };
  assertRuntimeArtifact(artifact);
  return artifact;
}

export function buildSpeakerReceiptArtifact(input: {
  runId: string;
  sourceArtifactId: string;
  taskId: string;
  agentId: string;
  receipt: SpeakerOverlapReceipt;
  prepared: PreparedSpeakerJsonObject;
}): RuntimeArtifact {
  const artifact: RuntimeArtifact = {
    schema: "studio.runtime.artifact.v1",
    id: input.prepared.artifactId,
    runId: input.runId,
    kind: "studio.speaker-overlap-producer.receipt.v1",
    mediaClass: "non_media",
    publication: "private",
    content: input.prepared.content,
    storageKey: input.prepared.storageKey,
    durationMs: null,
    tracks: [],
    sourceArtifactIds: [input.sourceArtifactId, input.receipt.output.artifactId],
    producerTaskId: input.taskId,
    producerAgentId: input.agentId,
    origin: {
      kind: "speaker_overlap_receipt",
      operationId: input.receipt.operationId,
      receiptId: input.receipt.receiptId,
      observationsArtifactId: input.receipt.output.artifactId,
    },
  };
  assertRuntimeArtifact(artifact);
  return artifact;
}
