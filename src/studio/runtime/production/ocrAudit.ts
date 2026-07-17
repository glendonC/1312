import { readFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";

import { ContentAddressedArtifactStore } from "./artifactStore.ts";
import { canonicalJson, canonicalJsonContentId } from "./artifactStore/contentIdentity.ts";
import { ocrObservationsArtifactId, ocrReceiptArtifactId } from "./artifactStore/ocrArtifacts.ts";
import { auditFrameSampling } from "./frameAudit.ts";
import type { FrameDecoder } from "./frames/decoder.ts";
import { FfmpegFrameDecoder } from "./frames/ffmpegDecoder.ts";
import type { OcrObservations, OcrReceipt, RuntimeArtifact, RuntimeProjection } from "./model.ts";
import type { OcrRecognizer } from "./ocr/recognizer.ts";
import { TesseractJsOcrRecognizer } from "./ocr/tesseractRecognizer.ts";
import { ocrReceiptId, validateOcrObservations, validateOcrReceipt } from "./validation/ocr.ts";

export interface VerifiedOcrAudit {
  observations: OcrObservations;
  observationsArtifact: RuntimeArtifact;
  receipt: OcrReceipt;
  receiptArtifact: RuntimeArtifact;
}

function same(left: unknown, right: unknown): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

async function storedJson<T>(
  artifacts: ContentAddressedArtifactStore,
  artifact: RuntimeArtifact,
  maxBytes: number,
  validate: (value: unknown) => T,
): Promise<T> {
  const path = await artifacts.resolveVerified(artifact);
  const bytes = await readFile(path);
  if (bytes.length > maxBytes) throw new Error(`OCR audit artifact ${artifact.id} exceeds its byte limit`);
  let parsed: unknown;
  try { parsed = JSON.parse(bytes.toString("utf8")); }
  catch { throw new Error(`OCR audit artifact ${artifact.id} is not JSON`); }
  const value = validate(parsed);
  if (!bytes.equals(Buffer.from(`${canonicalJson(value)}\n`, "utf8")) || canonicalJsonContentId(value) !== artifact.content.contentId) {
    throw new Error(`OCR audit artifact ${artifact.id} is not canonical content`);
  }
  return value;
}

export async function auditOcr(
  state: RuntimeProjection,
  artifacts: ContentAddressedArtifactStore,
  operationId: string,
  options: { recognizer?: OcrRecognizer; frameDecoder?: FrameDecoder; maxWallMs?: number } = {},
): Promise<VerifiedOcrAudit> {
  const operation = state.ocrOperations[operationId];
  if (!operation || operation.status !== "completed") throw new Error(`OCR audit requires completed operation ${operationId}`);
  const output = operation.outputArtifactId ? state.artifacts[operation.outputArtifactId] : undefined;
  const receiptArtifact = operation.receiptArtifactId ? state.artifacts[operation.receiptArtifactId] : undefined;
  if (!output || output.origin.kind !== "ocr_observations" || !receiptArtifact || receiptArtifact.origin.kind !== "ocr_receipt") {
    throw new Error(`OCR audit operation ${operationId} has incomplete artifact lineage`);
  }
  const [observations, receipt, frames] = await Promise.all([
    storedJson(artifacts, output, operation.limits.maxObservationBytes, (value) => validateOcrObservations(value)),
    storedJson(artifacts, receiptArtifact, operation.limits.maxReceiptBytes, (value) => validateOcrReceipt(value)),
    auditFrameSampling(state, artifacts, options.frameDecoder ?? new FfmpegFrameDecoder(), operation.frameSamplingOperationId),
  ]);
  if (
    observations.operationId !== operation.id || receipt.operationId !== operation.id ||
    receipt.receiptId !== operation.receiptId || receiptArtifact.content.contentId !== operation.receiptContentId ||
    observations.source.artifactId !== operation.sourceArtifactId || observations.source.videoTrackId !== operation.trackId ||
    observations.source.grantedRange.startMs !== operation.startMs || observations.source.grantedRange.endMs !== operation.endMs ||
    receipt.request.frameSamplingOperationId !== operation.frameSamplingOperationId ||
    observations.frameSampling.operationId !== frames.receipt.operationId ||
    observations.frameSampling.manifestArtifactId !== frames.manifestArtifact.id ||
    observations.frameSampling.manifestContentId !== frames.manifestArtifact.content.contentId ||
    observations.frameSampling.receiptId !== frames.receipt.receiptId ||
    observations.frameSampling.receiptArtifactId !== frames.receiptArtifact.id ||
    observations.frameSampling.receiptContentId !== frames.receiptArtifact.content.contentId
  ) throw new Error(`OCR audit operation ${operationId} changed source or U2 lineage`);
  const expectedInputFrames = frames.frames.map((frame) => ({
    frameId: frame.identity.frameId,
    artifactId: frame.artifact.id,
    contentId: frame.artifact.content.contentId,
    bytes: frame.bytes.length,
    actualTimestampUs: frame.identity.actualPresentationTimestamp.microseconds,
  }));
  if (!same(receipt.input.frames, expectedInputFrames) || observations.frames.length !== frames.frames.length || observations.frames.some((frame, index) =>
    frame.frameId !== frames.frames[index].identity.frameId || frame.frameArtifactId !== frames.frames[index].artifact.id ||
    frame.frameContentId !== frames.frames[index].artifact.content.contentId ||
    frame.actualTimestampUs !== frames.frames[index].identity.actualPresentationTimestamp.microseconds)) {
    throw new Error(`OCR audit operation ${operationId} changed frame identities or timestamps`);
  }
  const { receiptId: _receiptId, ...receiptWithoutId } = receipt;
  if (
    receipt.output.artifactId !== output.id || receipt.output.contentId !== output.content.contentId ||
    receipt.output.bytes !== output.content.bytes || receipt.output.state !== observations.state ||
    !same(receipt.producer, observations.producer) || !same(receipt.limits, observations.limits) ||
    !same(receipt.nonClaims, observations.nonClaims) || ocrReceiptId(receiptWithoutId) !== receipt.receiptId
  ) throw new Error(`OCR audit operation ${operationId} changed receipt or output identity`);
  if (
    ocrObservationsArtifactId(state.runId, operation.id, output.content.contentId) !== output.id ||
    ocrReceiptArtifactId(state.runId, operation.id, receiptArtifact.content.contentId) !== receiptArtifact.id ||
    canonicalJsonContentId(observations) !== output.content.contentId || canonicalJsonContentId(receipt) !== receiptArtifact.content.contentId
  ) throw new Error(`OCR audit operation ${operationId} has non-derivable content identities`);
  const deadlineAtMs = performance.now() + Math.min(options.maxWallMs ?? 5_000, operation.limits.maxWallMs);
  const currentLineage = await (options.recognizer ?? new TesseractJsOcrRecognizer()).currentLineage(deadlineAtMs);
  if (!same(currentLineage, receipt.producer)) throw new Error(`OCR audit operation ${operationId} runtime/model lineage drifted`);
  return { observations, observationsArtifact: output, receipt, receiptArtifact };
}
