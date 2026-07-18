import { canonicalSha256 } from "../canonicalIdentity.ts";
import type {
  ConditionalSeparationReceipt,
  ConditionalSeparationTrigger,
  ContentIdentity,
  RawStemComparison,
  RawStemComparisonReceipt,
  RuntimeArtifact,
  SeparationStemOutput,
} from "../model.ts";
import { assertRuntimeArtifact } from "../validation/artifacts.ts";

/**
 * Ordered provenance artifact ids for a trigger. U6 links the speaker overlap observations plus its
 * separate receipt artifact; U1 acoustic evidence has no receipt artifact (the producer receipt is
 * content-addressed only), so it links the observations artifact alone.
 */
function triggerProvenanceArtifactIds(trigger: ConditionalSeparationTrigger): string[] {
  return trigger.kind === "u6_speaker_overlap"
    ? [trigger.observationsArtifactId, trigger.receiptArtifactId]
    : [trigger.observationsArtifactId];
}

export interface PreparedSeparationObject {
  artifactId: string;
  content: ContentIdentity;
  storageKey: string;
}

export function separationStemArtifactId(runId: string, operationId: string, role: SeparationStemOutput["role"], contentId: string): string {
  return `artifact:${canonicalSha256({ runId, operationId, role, kind: "studio.separated-audio-stem.v1", contentId })}`;
}

export function conditionalSeparationReceiptArtifactId(runId: string, operationId: string, contentId: string): string {
  return `artifact:${canonicalSha256({ runId, operationId, kind: "studio.conditional-separation.receipt.v1", contentId })}`;
}

export function rawStemComparisonArtifactId(runId: string, operationId: string, contentId: string): string {
  return `artifact:${canonicalSha256({ runId, operationId, kind: "studio.raw-stem-comparison.v1", contentId })}`;
}

export function rawStemComparisonReceiptArtifactId(runId: string, operationId: string, contentId: string): string {
  return `artifact:${canonicalSha256({ runId, operationId, kind: "studio.raw-stem-comparison.receipt.v1", contentId })}`;
}

export function buildSeparationStemArtifact(input: {
  runId: string;
  taskId: string;
  agentId: string;
  receipt: ConditionalSeparationReceipt;
  receiptContentId: string;
  output: SeparationStemOutput;
  prepared: PreparedSeparationObject;
}): RuntimeArtifact {
  const { source, trigger, producer } = input.receipt;
  const artifact: RuntimeArtifact = {
    schema: "studio.runtime.artifact.v1",
    id: input.prepared.artifactId,
    runId: input.runId,
    kind: "studio.separated-audio-stem.v1",
    mediaClass: "derived",
    publication: "private",
    content: input.prepared.content,
    storageKey: input.prepared.storageKey,
    durationMs: input.output.durationMs,
    tracks: [{ id: input.output.trackId, index: 0, kind: "audio", codec: "pcm_s16le", durationMs: input.output.durationMs }],
    sourceArtifactIds: [source.artifactId, ...triggerProvenanceArtifactIds(trigger)],
    producerTaskId: input.taskId,
    producerAgentId: input.agentId,
    origin: {
      kind: "separation_stem",
      operationId: input.receipt.operationId,
      receiptId: input.receipt.receiptId,
      receiptContentId: input.receiptContentId,
      stemRole: input.output.role,
      sourceArtifactId: source.artifactId,
      sourceContentId: source.contentId,
      trackId: source.trackId,
      startMs: source.range.startMs,
      endMs: source.range.endMs,
      triggerKind: trigger.kind,
      triggerObservationId: trigger.observationId,
      methodId: producer.adapter.id,
      modelContentIds: producer.model.files.map((file) => file.content.contentId),
      configurationContentId: producer.configuration.contentId,
    },
  };
  assertRuntimeArtifact(artifact);
  return artifact;
}

export function buildConditionalSeparationReceiptArtifact(input: {
  runId: string;
  taskId: string;
  agentId: string;
  receipt: ConditionalSeparationReceipt;
  prepared: PreparedSeparationObject;
}): RuntimeArtifact {
  const artifact: RuntimeArtifact = {
    schema: "studio.runtime.artifact.v1",
    id: input.prepared.artifactId,
    runId: input.runId,
    kind: "studio.conditional-separation.receipt.v1",
    mediaClass: "non_media",
    publication: "private",
    content: input.prepared.content,
    storageKey: input.prepared.storageKey,
    durationMs: null,
    tracks: [],
    sourceArtifactIds: [input.receipt.source.artifactId, ...triggerProvenanceArtifactIds(input.receipt.trigger), ...input.receipt.outputs.map((output) => output.artifactId)],
    producerTaskId: input.taskId,
    producerAgentId: input.agentId,
    origin: {
      kind: "conditional_separation_receipt",
      operationId: input.receipt.operationId,
      receiptId: input.receipt.receiptId,
      stemArtifactIds: [input.receipt.outputs[0].artifactId, input.receipt.outputs[1].artifactId],
    },
  };
  assertRuntimeArtifact(artifact);
  return artifact;
}

export function buildRawStemComparisonArtifact(input: {
  runId: string;
  taskId: string;
  agentId: string;
  separationReceiptArtifactId: string;
  comparison: RawStemComparison;
  receipt: RawStemComparisonReceipt;
  receiptContentId: string;
  prepared: PreparedSeparationObject;
}): RuntimeArtifact {
  const artifact: RuntimeArtifact = {
    schema: "studio.runtime.artifact.v1",
    id: input.prepared.artifactId,
    runId: input.runId,
    kind: "studio.raw-stem-comparison.v1",
    mediaClass: "non_media",
    publication: "private",
    content: input.prepared.content,
    storageKey: input.prepared.storageKey,
    durationMs: null,
    tracks: [],
    sourceArtifactIds: [...input.receipt.inputArtifactIds, input.separationReceiptArtifactId],
    producerTaskId: input.taskId,
    producerAgentId: input.agentId,
    origin: {
      kind: "raw_stem_comparison",
      operationId: input.comparison.operationId,
      separationReceiptId: input.comparison.separationReceiptId,
      receiptId: input.receipt.receiptId,
      receiptContentId: input.receiptContentId,
    },
  };
  assertRuntimeArtifact(artifact);
  return artifact;
}

export function buildRawStemComparisonReceiptArtifact(input: {
  runId: string;
  taskId: string;
  agentId: string;
  separationReceiptArtifactId: string;
  receipt: RawStemComparisonReceipt;
  prepared: PreparedSeparationObject;
}): RuntimeArtifact {
  const artifact: RuntimeArtifact = {
    schema: "studio.runtime.artifact.v1",
    id: input.prepared.artifactId,
    runId: input.runId,
    kind: "studio.raw-stem-comparison.receipt.v1",
    mediaClass: "non_media",
    publication: "private",
    content: input.prepared.content,
    storageKey: input.prepared.storageKey,
    durationMs: null,
    tracks: [],
    sourceArtifactIds: [...input.receipt.inputArtifactIds, input.separationReceiptArtifactId, input.receipt.comparison.artifactId],
    producerTaskId: input.taskId,
    producerAgentId: input.agentId,
    origin: {
      kind: "raw_stem_comparison_receipt",
      operationId: input.receipt.operationId,
      receiptId: input.receipt.receiptId,
      comparisonArtifactId: input.receipt.comparison.artifactId,
      separationReceiptId: input.receipt.separationReceiptId,
    },
  };
  assertRuntimeArtifact(artifact);
  return artifact;
}
