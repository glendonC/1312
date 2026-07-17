import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import {
  canonicalJsonContentId,
  canonicalSha256,
  ContentAddressedArtifactStore,
} from "../artifactStore.ts";
import type {
  RuntimeProjection,
  SemanticEvidenceCitationInput,
  SemanticMediaEvidenceArtifact,
  SemanticMediaEvidenceReceipt,
} from "../model.ts";
import {
  semanticReceiptId,
  validateSemanticMediaEvidenceArtifact,
  validateSemanticMediaEvidenceReceipt,
} from "../validation/semanticEvidence.ts";

export interface VerifiedSemanticEvidence {
  operationId: string;
  artifactId: string;
  artifactContentId: string;
  receiptId: string;
  receiptContentId: string;
  envelope: SemanticMediaEvidenceArtifact;
  receipt: SemanticMediaEvidenceReceipt;
}

async function storedJsonBytes(
  bytes: Buffer,
  contentId: string,
  maximumBytes: number,
  context: string,
): Promise<unknown> {
  if (bytes.byteLength <= 0 || bytes.byteLength > maximumBytes) {
    throw new Error(`${context} exceeds its bounded JSON contract`);
  }
  const measured = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  if (measured !== contentId) throw new Error(`${context} changed content identity`);
  let value: unknown;
  try {
    value = JSON.parse(bytes.toString("utf8")) as unknown;
  } catch {
    throw new Error(`${context} is invalid JSON`);
  }
  if (canonicalJsonContentId(value) !== contentId) throw new Error(`${context} is not canonical JSON`);
  return value;
}

function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/** Re-hashes source, evidence artifact, and receipt, then closes grant/task/executor lineage. */
export async function reopenSemanticEvidence(
  state: RuntimeProjection,
  artifacts: ContentAddressedArtifactStore,
  operationId: string,
): Promise<VerifiedSemanticEvidence> {
  const operation = state.semanticEvidence[operationId];
  if (
    !operation || operation.status !== "completed" ||
    !operation.outputArtifactId || !operation.outputContentId ||
    !operation.receiptId || !operation.receiptContentId || !operation.availability
  ) throw new Error(`Semantic evidence ${operationId} has no completed stored identity`);
  const artifact = state.artifacts[operation.outputArtifactId];
  const source = state.artifacts[operation.sourceArtifactId];
  const task = state.tasks[operation.taskId];
  const execution = state.executions[operation.executionId];
  const launch = state.taskLaunches[operation.taskId];
  const grant = task?.grants.find((candidate) => candidate.id === operation.grantId);
  if (
    !artifact || artifact.origin.kind !== "semantic_media_evidence" ||
    !source || source.origin.kind !== "ingest" ||
    !task || !execution || !launch || !grant || grant.capability !== "speech.transcribe" ||
    task.assignedAgentId !== operation.agentId ||
    task.jobContext.source.artifactId !== source.id ||
    task.jobContext.source.contentId !== source.content.contentId ||
    execution.taskId !== task.id || execution.agentId !== operation.agentId ||
    execution.launchClaimId !== operation.launchClaimId ||
    launch.id !== operation.launchClaimId || launch.executionId !== execution.id ||
    !grant.mediaScope.some((scope) =>
      scope.artifactId === source.id && scope.trackId === operation.trackId &&
      operation.startMs >= scope.startMs && operation.endMs <= scope.endMs)
  ) throw new Error(`Semantic evidence ${operationId} lost its journal, grant, task, or executor lineage`);
  if (
    artifact.runId !== state.runId || artifact.publication !== "private" ||
    artifact.content.contentId !== operation.outputContentId ||
    artifact.producerTaskId !== task.id || artifact.producerAgentId !== operation.agentId ||
    artifact.sourceArtifactIds.length !== 1 || artifact.sourceArtifactIds[0] !== source.id ||
    artifact.origin.operationId !== operation.id ||
    artifact.origin.receiptId !== operation.receiptId ||
    artifact.origin.receiptContentId !== operation.receiptContentId ||
    artifact.origin.availabilityId !== operation.availability.id
  ) throw new Error(`Semantic evidence ${operationId} changed its stored artifact lineage`);

  const [sourcePath, artifactPath, receiptBytes] = await Promise.all([
    artifacts.resolveVerified(source),
    artifacts.resolveVerified(artifact),
    artifacts.receiptBytes(operation.receiptContentId),
  ]);
  // resolveVerified above performs the source and semantic-artifact byte re-hashes.
  if (!sourcePath || !artifactPath) throw new Error(`Semantic evidence ${operationId} storage is unavailable`);
  const [envelopeValue, receiptValue] = await Promise.all([
    readFile(artifactPath).then((bytes) => storedJsonBytes(
      bytes,
      artifact.content.contentId,
      operation.limits.maxArtifactBytes,
      "Stored semantic evidence artifact",
    )),
    storedJsonBytes(receiptBytes, operation.receiptContentId, 256 * 1024, "Stored semantic evidence receipt"),
  ]);
  const envelope = validateSemanticMediaEvidenceArtifact(envelopeValue);
  const receipt = validateSemanticMediaEvidenceReceipt(receiptValue);
  const expectedArtifactId = `artifact:${canonicalSha256({
    runId: state.runId,
    operationId,
    kind: "studio.semantic-media-evidence.v1",
    contentId: artifact.content.contentId,
  })}`;
  const { receiptId: _receiptId, ...receiptWithoutId } = receipt;
  if (
    artifact.id !== expectedArtifactId ||
    receipt.receiptId !== semanticReceiptId(receiptWithoutId) ||
    receipt.receiptId !== operation.receiptId ||
    envelope.operationId !== operation.id || envelope.runId !== state.runId ||
    envelope.authorization.taskId !== task.id || envelope.authorization.agentId !== operation.agentId ||
    envelope.authorization.grantId !== grant.id || envelope.authorization.executionId !== execution.id ||
    envelope.authorization.launchClaimId !== launch.id ||
    envelope.source.artifactId !== source.id || envelope.source.contentId !== source.content.contentId ||
    envelope.source.trackId !== operation.trackId ||
    envelope.requestedRange.startMs !== operation.startMs || envelope.requestedRange.endMs !== operation.endMs ||
    receipt.output.artifactId !== artifact.id || receipt.output.contentId !== artifact.content.contentId ||
    receipt.output.bytes !== artifact.content.bytes ||
    !same(receipt.authorization, envelope.authorization) ||
    !same(receipt.source, envelope.source) ||
    !same(receipt.request, envelope.requestedRange) ||
    !same(receipt.returnedRange, envelope.returnedRange) ||
    !same(receipt.normalization, envelope.normalization) ||
    !same(receipt.producer, envelope.producer) ||
    !same(receipt.limits, envelope.limits) ||
    !same(receipt.availability, envelope.availability) ||
    !same(receipt.observations, envelope.observations) ||
    !same(operation.returnedRange, envelope.returnedRange) ||
    operation.observationCount !== envelope.observations.length ||
    !same(operation.availability, envelope.availability)
  ) throw new Error(`Semantic evidence ${operationId} changed its artifact, receipt, observations, or lineage`);
  return {
    operationId,
    artifactId: artifact.id,
    artifactContentId: artifact.content.contentId,
    receiptId: receipt.receiptId,
    receiptContentId: operation.receiptContentId,
    envelope: structuredClone(envelope),
    receipt: structuredClone(receipt),
  };
}

export function semanticEvidenceCitation(verified: VerifiedSemanticEvidence): SemanticEvidenceCitationInput {
  return {
    operationId: verified.operationId,
    artifactId: verified.artifactId,
    contentId: verified.artifactContentId,
    receiptId: verified.receiptId,
    receiptContentId: verified.receiptContentId,
    observations: verified.envelope.observations.map((observation) => ({
      observationId: observation.observationId,
      startMs: observation.range.startMs,
      endMs: observation.range.endMs,
    })),
  };
}
