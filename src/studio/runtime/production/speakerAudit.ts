import { readFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";

import { ContentAddressedArtifactStore } from "./artifactStore.ts";
import { canonicalJson, canonicalJsonContentId } from "./artifactStore/contentIdentity.ts";
import {
  speakerObservationsArtifactId,
  speakerReceiptArtifactId,
} from "./artifactStore/speakerArtifacts.ts";
import type {
  RuntimeArtifact,
  RuntimeProjection,
  SpeakerOverlapObservations,
  SpeakerOverlapReceipt,
} from "./model.ts";
import type { SpeakerDiarizer } from "./speaker/diarizer.ts";
import { SherpaOnnxSpeakerDiarizer } from "./speaker/sherpaOnnxDiarizer.ts";
import {
  speakerOverlapReceiptId,
  validateSpeakerOverlapObservations,
  validateSpeakerOverlapReceipt,
} from "./validation/speakers.ts";

export interface VerifiedSpeakerOverlapAudit {
  observations: SpeakerOverlapObservations;
  observationsArtifact: RuntimeArtifact;
  receipt: SpeakerOverlapReceipt;
  receiptArtifact: RuntimeArtifact;
}

function same(left: unknown, right: unknown): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

async function storedJson<T>(
  artifacts: ContentAddressedArtifactStore,
  artifact: RuntimeArtifact,
  maxBytes: number,
  label: string,
  validate: (value: unknown) => T,
): Promise<T> {
  const path = await artifacts.resolveVerified(artifact);
  const bytes = await readFile(path);
  if (bytes.length <= 0 || bytes.length > maxBytes) throw new Error(`${label} ${artifact.id} exceeds its byte limit`);
  let parsed: unknown;
  try { parsed = JSON.parse(bytes.toString("utf8")); }
  catch { throw new Error(`${label} ${artifact.id} is not JSON`); }
  const value = validate(parsed);
  if (!bytes.equals(Buffer.from(`${canonicalJson(value)}\n`, "utf8")) || canonicalJsonContentId(value) !== artifact.content.contentId) {
    throw new Error(`${label} ${artifact.id} is not canonical content`);
  }
  return value;
}

/** Reopens both U6 artifacts and the owned source. Inference is not rerun; pinned lineage is rehashed. */
export async function auditSpeakerOverlap(
  state: RuntimeProjection,
  artifacts: ContentAddressedArtifactStore,
  operationId: string,
  options: { diarizer?: SpeakerDiarizer; maxWallMs?: number } = {},
): Promise<VerifiedSpeakerOverlapAudit> {
  const operation = state.speakerOverlapOperations[operationId];
  if (!operation || operation.status !== "completed") throw new Error(`Speaker/overlap audit requires completed operation ${operationId}`);
  const observationsArtifact = operation.outputArtifactId ? state.artifacts[operation.outputArtifactId] : undefined;
  const receiptArtifact = operation.receiptArtifactId ? state.artifacts[operation.receiptArtifactId] : undefined;
  const source = state.artifacts[operation.sourceArtifactId];
  if (
    !observationsArtifact || observationsArtifact.origin.kind !== "speaker_overlap_observations" ||
    !receiptArtifact || receiptArtifact.origin.kind !== "speaker_overlap_receipt" ||
    !source || source.origin.kind !== "ingest"
  ) throw new Error(`Speaker/overlap audit operation ${operationId} has incomplete artifact lineage`);
  const [observations, receipt] = await Promise.all([
    storedJson(artifacts, observationsArtifact, operation.limits.maxObservationBytes, "Speaker/overlap observations", (value) => validateSpeakerOverlapObservations(value)),
    storedJson(artifacts, receiptArtifact, operation.limits.maxReceiptBytes, "Speaker/overlap receipt", (value) => validateSpeakerOverlapReceipt(value)),
    artifacts.resolveVerified(source),
  ]);
  if (
    observations.operationId !== operation.id || observations.runId !== state.runId ||
    observations.source.artifactId !== source.id || observations.source.contentId !== source.content.contentId ||
    observations.source.audioTrackId !== operation.trackId ||
    observations.source.grantedRange.startMs !== operation.startMs || observations.source.grantedRange.endMs !== operation.endMs ||
    observations.labelScope.runId !== state.runId || observations.labelScope.sourceArtifactId !== source.id ||
    observations.labelScope.operationId !== operation.id || !same(observations.limits, operation.limits) ||
    receipt.operationId !== operation.id || receipt.receiptId !== operation.receiptId ||
    receiptArtifact.content.contentId !== operation.receiptContentId || receipt.input.sourceBytes !== source.content.bytes ||
    !same(receipt.input.artifactId, observations.source.artifactId) || !same(receipt.input.contentId, observations.source.contentId) ||
    !same(receipt.input.audioTrackId, observations.source.audioTrackId) || !same(receipt.input.grantedRange, observations.source.grantedRange)
  ) throw new Error(`Speaker/overlap audit operation ${operationId} changed source, range, or label scope`);
  if (
    receipt.authorization.grantId !== operation.grantId || receipt.authorization.taskId !== operation.taskId ||
    receipt.authorization.agentId !== operation.agentId || receipt.authorization.executionId !== operation.executionId ||
    receipt.authorization.launchClaimId !== operation.launchClaimId ||
    receipt.output.artifactId !== observationsArtifact.id || receipt.output.contentId !== observationsArtifact.content.contentId ||
    receipt.output.bytes !== observationsArtifact.content.bytes || receipt.output.state !== observations.state ||
    receipt.execution.accountingCellCount !== observations.accounting.length ||
    !same(receipt.producer, observations.producer) || !same(receipt.limits, observations.limits) ||
    !same(receipt.nonClaims, observations.nonClaims) || observations.nonClaims.dialogueAuthority !== "not_granted" ||
    observationsArtifact.origin.receiptId !== receipt.receiptId ||
    observationsArtifact.origin.receiptContentId !== receiptArtifact.content.contentId ||
    receiptArtifact.origin.receiptId !== receipt.receiptId || receiptArtifact.origin.observationsArtifactId !== observationsArtifact.id
  ) throw new Error(`Speaker/overlap audit operation ${operationId} changed authorization, receipt, or output identity`);
  const { receiptId: _receiptId, ...receiptWithoutId } = receipt;
  if (
    speakerOverlapReceiptId(receiptWithoutId) !== receipt.receiptId ||
    speakerObservationsArtifactId(state.runId, operation.id, observationsArtifact.content.contentId) !== observationsArtifact.id ||
    speakerReceiptArtifactId(state.runId, operation.id, receiptArtifact.content.contentId) !== receiptArtifact.id
  ) throw new Error(`Speaker/overlap audit operation ${operationId} has non-derivable identities`);
  const deadlineAtMs = performance.now() + Math.min(options.maxWallMs ?? 5_000, operation.limits.maxWallMs);
  const currentLineage = await (options.diarizer ?? new SherpaOnnxSpeakerDiarizer()).currentLineage(deadlineAtMs);
  if (!same(currentLineage, receipt.producer)) throw new Error(`Speaker/overlap audit operation ${operationId} runtime/model lineage drifted`);
  return { observations, observationsArtifact, receipt, receiptArtifact };
}
