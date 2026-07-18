import { readFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";

import type { ContentAddressedArtifactStore } from "./artifactStore.ts";
import { canonicalJson, canonicalJsonContentId } from "./artifactStore/contentIdentity.ts";
import {
  conditionalSeparationReceiptArtifactId,
  rawStemComparisonArtifactId,
  rawStemComparisonReceiptArtifactId,
  separationStemArtifactId,
} from "./artifactStore/separationArtifacts.ts";
import type { ConditionalSeparationReceipt, RawStemComparison, RawStemComparisonReceipt, RuntimeArtifact, RuntimeProjection } from "./model.ts";
import type { SourceSeparator } from "./separation/separator.ts";
import { SpeechbrainSepformerSeparator } from "./separation/speechbrainSepformerSeparator.ts";
import { reauditU1AcousticSeparationTrigger } from "./separation/acousticSeparationTriggerAudit.ts";
import type { SpeakerDiarizer } from "./speaker/diarizer.ts";
import { auditSpeakerOverlap } from "./speakerAudit.ts";
import { conditionalSeparationReceiptId, rawStemComparisonReceiptId, validateConditionalSeparationReceipt, validateRawStemComparison, validateRawStemComparisonReceipt } from "./validation/separation.ts";

export interface VerifiedConditionalSeparationAudit {
  sourceArtifact: RuntimeArtifact;
  stemArtifacts: [RuntimeArtifact, RuntimeArtifact];
  receipt: ConditionalSeparationReceipt;
  receiptArtifact: RuntimeArtifact;
  comparison: RawStemComparison;
  comparisonArtifact: RuntimeArtifact;
  comparisonReceipt: RawStemComparisonReceipt;
  comparisonReceiptArtifact: RuntimeArtifact;
}

function same(left: unknown, right: unknown): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

async function storedJson<T>(artifacts: ContentAddressedArtifactStore, artifact: RuntimeArtifact, maxBytes: number, label: string, validate: (value: unknown) => T): Promise<T> {
  const path = await artifacts.resolveVerified(artifact);
  const bytes = await readFile(path);
  if (bytes.length <= 0 || bytes.length > maxBytes) throw new Error(`${label} ${artifact.id} exceeds its byte limit`);
  let parsed: unknown;
  try { parsed = JSON.parse(bytes.toString("utf8")); }
  catch { throw new Error(`${label} ${artifact.id} is not JSON`); }
  const value = validate(parsed);
  if (!bytes.equals(Buffer.from(`${canonicalJson(value)}\n`, "utf8")) || canonicalJsonContentId(value) !== artifact.content.contentId) throw new Error(`${label} ${artifact.id} is not canonical content`);
  return value;
}

/** Reopens raw, both stems, both receipts, comparison, U6 trigger, and current pinned lineage by journal identity only. */
export async function auditConditionalSeparation(
  state: RuntimeProjection,
  artifacts: ContentAddressedArtifactStore,
  operationId: string,
  options: { separator?: SourceSeparator; speakerDiarizer?: SpeakerDiarizer; maxWallMs?: number } = {},
): Promise<VerifiedConditionalSeparationAudit> {
  const operation = state.conditionalSeparationOperations[operationId];
  if (!operation || operation.status !== "completed" || operation.stemArtifactIds.length !== 2) throw new Error(`Conditional separation audit requires completed operation ${operationId}`);
  const sourceArtifact = state.artifacts[operation.sourceArtifactId];
  const stems = operation.stemArtifactIds.map((id) => state.artifacts[id]);
  const receiptArtifact = operation.receiptArtifactId ? state.artifacts[operation.receiptArtifactId] : undefined;
  const comparisonArtifact = operation.comparisonArtifactId ? state.artifacts[operation.comparisonArtifactId] : undefined;
  const comparisonReceiptArtifact = operation.comparisonReceiptArtifactId ? state.artifacts[operation.comparisonReceiptArtifactId] : undefined;
  if (
    sourceArtifact?.origin.kind !== "ingest" || stems.some((artifact) => artifact?.origin.kind !== "separation_stem") ||
    receiptArtifact?.origin.kind !== "conditional_separation_receipt" || comparisonArtifact?.origin.kind !== "raw_stem_comparison" ||
    comparisonReceiptArtifact?.origin.kind !== "raw_stem_comparison_receipt"
  ) throw new Error(`Conditional separation audit ${operationId} has incomplete artifact lineage`);
  const [receipt, comparison, comparisonReceipt] = await Promise.all([
    storedJson(artifacts, receiptArtifact, operation.limits.maxReceiptBytes, "Separation receipt", (value) => validateConditionalSeparationReceipt(value)),
    storedJson(artifacts, comparisonArtifact, operation.limits.maxComparisonBytes, "Raw/stem comparison", (value) => validateRawStemComparison(value)),
    storedJson(artifacts, comparisonReceiptArtifact, operation.limits.maxComparisonReceiptBytes, "Raw/stem comparison receipt", (value) => validateRawStemComparisonReceipt(value)),
    artifacts.resolveVerified(sourceArtifact),
    ...stems.map((artifact) => artifacts.resolveVerified(artifact)),
  ]);
  const stemArtifacts = stems as [RuntimeArtifact, RuntimeArtifact];
  let triggerValid: boolean;
  if (operation.trigger.kind === "u6_speaker_overlap") {
    const auditedTrigger = await auditSpeakerOverlap(state, artifacts, operation.trigger.operationId, { diarizer: options.speakerDiarizer, maxWallMs: options.maxWallMs });
    const triggerCell = auditedTrigger.observations.accounting.find((cell) => cell.observationId === operation.trigger.observationId);
    triggerValid = Boolean(triggerCell) && triggerCell!.state === "conflicting" && triggerCell!.kind === "overlap" &&
      triggerCell!.startMs === operation.startMs && triggerCell!.endMs === operation.endMs;
  } else {
    triggerValid = await reauditU1AcousticSeparationTrigger(state, artifacts, operation.trigger, { startMs: operation.startMs, endMs: operation.endMs, trackId: operation.trackId });
  }
  if (
    !triggerValid ||
    receipt.operationId !== operation.id || receipt.receiptId !== operation.receiptId || receiptArtifact.content.contentId !== operation.receiptContentId ||
    receipt.authorization.grantId !== operation.grantId || receipt.authorization.taskId !== operation.taskId || receipt.authorization.agentId !== operation.agentId ||
    receipt.authorization.executionId !== operation.executionId || receipt.authorization.launchClaimId !== operation.launchClaimId ||
    receipt.source.artifactId !== sourceArtifact.id || receipt.source.contentId !== sourceArtifact.content.contentId || receipt.source.trackId !== operation.trackId ||
    receipt.source.range.startMs !== operation.startMs || receipt.source.range.endMs !== operation.endMs || !same(receipt.trigger, operation.trigger) ||
    !same(receipt.outputs.map((output) => output.artifactId), operation.stemArtifactIds)
  ) throw new Error(`Conditional separation audit ${operationId} changed authorization, raw source, range, trigger, or outputs`);
  for (const [index, stem] of stemArtifacts.entries()) {
    const output = receipt.outputs[index];
    if (
      stem.content.contentId !== output.contentId || stem.content.bytes !== output.bytes || stem.durationMs !== output.durationMs ||
      stem.publication !== "private" || stem.mediaClass !== "derived" || stem.origin.kind !== "separation_stem" || stem.origin.receiptId !== receipt.receiptId ||
      stem.origin.receiptContentId !== receiptArtifact.content.contentId || stem.origin.sourceArtifactId !== sourceArtifact.id ||
      stem.origin.startMs !== operation.startMs || stem.origin.endMs !== operation.endMs || stem.origin.triggerObservationId !== operation.trigger.observationId ||
      separationStemArtifactId(state.runId, operation.id, output.role, stem.content.contentId) !== stem.id
    ) throw new Error(`Conditional separation audit ${operationId} changed stem ${index + 1} lineage`);
  }
  if (
    conditionalSeparationReceiptArtifactId(state.runId, operation.id, receiptArtifact.content.contentId) !== receiptArtifact.id ||
    rawStemComparisonArtifactId(state.runId, operation.id, comparisonArtifact.content.contentId) !== comparisonArtifact.id ||
    rawStemComparisonReceiptArtifactId(state.runId, operation.id, comparisonReceiptArtifact.content.contentId) !== comparisonReceiptArtifact.id ||
    comparison.operationId !== operation.id || comparison.separationReceiptId !== receipt.receiptId || comparison.source.artifactId !== sourceArtifact.id ||
    comparison.deterministicGate.semanticPreference !== null || comparison.deterministicGate.semanticAuthority !== "not_granted" || comparison.deterministicGate.captionAuthority !== "not_granted" ||
    comparisonReceipt.receiptId !== operation.comparisonReceiptId || comparisonReceipt.operationId !== operation.id ||
    comparisonReceipt.separationReceiptId !== receipt.receiptId || comparisonReceipt.comparison.artifactId !== comparisonArtifact.id ||
    comparisonReceipt.comparison.contentId !== comparisonArtifact.content.contentId || !same(comparisonReceipt.recognizer, comparison.recognizer) ||
    !same(comparisonReceipt.inputArtifactIds, [sourceArtifact.id, ...operation.stemArtifactIds]) || comparisonReceipt.nonClaims.captionAuthority !== "not_granted"
  ) throw new Error(`Conditional separation audit ${operationId} changed comparison or receipt identities`);
  const { receiptId: _receiptId, ...receiptWithoutId } = receipt;
  const { receiptId: _comparisonReceiptId, ...comparisonReceiptWithoutId } = comparisonReceipt;
  if (
    conditionalSeparationReceiptId(receiptWithoutId) !== receipt.receiptId ||
    rawStemComparisonReceiptId(comparisonReceiptWithoutId) !== comparisonReceipt.receiptId
  ) throw new Error(`Conditional separation audit ${operationId} has non-derivable receipt identities`);
  const currentLineage = await (options.separator ?? new SpeechbrainSepformerSeparator()).currentLineage(performance.now() + Math.min(options.maxWallMs ?? 15_000, operation.limits.maxWallMs));
  if (!same(currentLineage, receipt.producer)) throw new Error(`Conditional separation audit ${operationId} runtime/model lineage drifted`);
  return { sourceArtifact, stemArtifacts, receipt, receiptArtifact, comparison, comparisonArtifact, comparisonReceipt, comparisonReceiptArtifact };
}
