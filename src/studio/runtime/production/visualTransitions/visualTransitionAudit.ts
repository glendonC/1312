import { readFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";

import { ContentAddressedArtifactStore } from "../artifactStore.ts";
import { canonicalJson, canonicalJsonContentId } from "../artifactStore/contentIdentity.ts";
import {
  visualTransitionObservationsArtifactId,
  visualTransitionReceiptArtifactId,
} from "../artifactStore/visualTransitionArtifacts.ts";
import { auditFrameSampling } from "../frameAudit.ts";
import type { FrameDecoder } from "../frames/decoder.ts";
import { FfmpegFrameDecoder } from "../frames/ffmpegDecoder.ts";
import type { RuntimeArtifact, RuntimeProjection } from "../model.ts";
import type {
  VisualTransitionObservations,
  VisualTransitionOperationRecord,
  VisualTransitionReceipt,
} from "../model/visualTransitions.ts";
import type { OcrRecognizer } from "../ocr/recognizer.ts";
import { auditOcr } from "../ocrAudit.ts";
import {
  validateVisualTransitionObservations,
  validateVisualTransitionReceipt,
} from "../validation/visualTransitions.ts";
import {
  DeterministicRgbGridVisualTransitionAnalyzer,
  type VisualTransitionAnalyzer,
} from "./analyzer.ts";
import { visualTransitionFrameIdentity } from "./lineage.ts";

type VisualTransitionProjection = RuntimeProjection & {
  visualTransitionOperations: Record<string, VisualTransitionOperationRecord>;
};

export interface VerifiedVisualTransitionAudit {
  observations: VisualTransitionObservations;
  observationsArtifact: RuntimeArtifact;
  receipt: VisualTransitionReceipt;
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
  if (bytes.length > maxBytes) throw new Error(`Visual-transition audit artifact ${artifact.id} exceeds its byte limit`);
  let parsed: unknown;
  try { parsed = JSON.parse(bytes.toString("utf8")); }
  catch { throw new Error(`Visual-transition audit artifact ${artifact.id} is not JSON`); }
  const value = validate(parsed);
  if (!bytes.equals(Buffer.from(`${canonicalJson(value)}\n`, "utf8")) || canonicalJsonContentId(value) !== artifact.content.contentId) {
    throw new Error(`Visual-transition audit artifact ${artifact.id} is not canonical content`);
  }
  return value;
}

export async function auditVisualTransition(
  projection: RuntimeProjection,
  artifacts: ContentAddressedArtifactStore,
  operationId: string,
  options: {
    frameDecoder?: FrameDecoder;
    recognizer?: OcrRecognizer;
    analyzer?: VisualTransitionAnalyzer;
    maxWallMs?: number;
  } = {},
): Promise<VerifiedVisualTransitionAudit> {
  const state = projection as VisualTransitionProjection;
  const operation = state.visualTransitionOperations[operationId];
  if (!operation || operation.status !== "completed") throw new Error(`Visual-transition audit requires completed operation ${operationId}`);
  const output = operation.outputArtifactId ? state.artifacts[operation.outputArtifactId] : undefined;
  const receiptArtifact = operation.receiptArtifactId ? state.artifacts[operation.receiptArtifactId] : undefined;
  if (!output || output.origin.kind !== "visual_transition_observations" ||
      !receiptArtifact || receiptArtifact.origin.kind !== "visual_transition_receipt") {
    throw new Error(`Visual-transition audit operation ${operationId} has incomplete artifact lineage`);
  }
  const decoder = options.frameDecoder ?? new FfmpegFrameDecoder();
  const maximumWallMs = Math.min(options.maxWallMs ?? operation.limits.maxWallMs, operation.limits.maxWallMs);
  const deadlineAtMs = performance.now() + maximumWallMs;
  const remainingWallMs = () => Math.max(1, Math.floor(deadlineAtMs - performance.now()));
  const [observations, receipt] = await Promise.all([
    storedJson(artifacts, output, operation.limits.maxObservationBytes, (value) => validateVisualTransitionObservations(value)),
    storedJson(artifacts, receiptArtifact, operation.limits.maxReceiptBytes, (value) => validateVisualTransitionReceipt(value)),
  ]);
  const frames = await auditFrameSampling(state, artifacts, decoder, operation.frameSamplingOperationId, { maxWallMs: remainingWallMs() });
  const ocr = await auditOcr(state, artifacts, operation.ocrOperationId, {
    frameDecoder: decoder,
    recognizer: options.recognizer,
    maxWallMs: remainingWallMs(),
  });
  if (frames.frames.length !== ocr.observations.frames.length) throw new Error(`Visual-transition audit operation ${operationId} changed its U2/U5 frame count`);
  const frameIdentities = frames.frames.map((frame, index) => visualTransitionFrameIdentity(frame, ocr.observations.frames[index]));
  const expectedSource = {
    artifactId: operation.sourceArtifactId,
    contentId: state.artifacts[operation.sourceArtifactId]?.content.contentId,
    videoTrackId: operation.trackId,
    grantedRange: { startMs: operation.startMs, endMs: operation.endMs },
  };
  const expectedFrameSampling = {
    operationId: frames.receipt.operationId,
    manifestArtifactId: frames.manifestArtifact.id,
    manifestContentId: frames.manifestArtifact.content.contentId,
    receiptId: frames.receipt.receiptId,
    receiptArtifactId: frames.receiptArtifact.id,
    receiptContentId: frames.receiptArtifact.content.contentId,
  };
  const expectedOcr = {
    operationId: ocr.receipt.operationId,
    observationsArtifactId: ocr.observationsArtifact.id,
    observationsContentId: ocr.observationsArtifact.content.contentId,
    receiptId: ocr.receipt.receiptId,
    receiptArtifactId: ocr.receiptArtifact.id,
    receiptContentId: ocr.receiptArtifact.content.contentId,
  };
  if (
    observations.operationId !== operation.id || receipt.operationId !== operation.id || observations.runId !== state.runId ||
    receipt.receiptId !== operation.receiptId || receiptArtifact.content.contentId !== operation.receiptContentId ||
    receipt.request.frameSamplingOperationId !== operation.frameSamplingOperationId || receipt.request.ocrOperationId !== operation.ocrOperationId ||
    !same(observations.source, expectedSource) || !same(receipt.input.source, expectedSource) ||
    !same(observations.frameSampling, expectedFrameSampling) || !same(receipt.input.frameSampling, expectedFrameSampling) ||
    !same(observations.ocr, expectedOcr) || !same(receipt.input.ocr, expectedOcr) ||
    !same(observations.frames, frameIdentities) || !same(receipt.input.frames, frameIdentities)
  ) throw new Error(`Visual-transition audit operation ${operationId} changed source or cold U2/U5 lineage`);
  const analyzer = options.analyzer ?? new DeterministicRgbGridVisualTransitionAnalyzer();
  const rerun = analyzer.analyze({
    operationId,
    grantedRange: expectedSource.grantedRange,
    frames: frames.frames.map((frame, index) => ({ identity: frameIdentities[index], bytes: frame.bytes })),
  }, deadlineAtMs);
  if (
    !same(observations.intervals, rerun.intervals) || !same(observations.producer, rerun.producer) ||
    !same(receipt.producer, rerun.producer) || !same(observations.limits, operation.limits) || !same(receipt.limits, operation.limits) ||
    receipt.execution.sampledRgbValues !== rerun.sampledRgbValues ||
    !same(receipt.output.intervalIds, rerun.intervals.map((interval) => interval.intervalId)) ||
    !same(receipt.nonClaims, observations.nonClaims)
  ) throw new Error(`Visual-transition audit operation ${operationId} changed deterministic candidate output`);
  if (
    receipt.authorization.grantId !== operation.grantId || receipt.authorization.taskId !== operation.taskId ||
    receipt.authorization.agentId !== operation.agentId || receipt.authorization.executionId !== operation.executionId ||
    receipt.authorization.launchClaimId !== operation.launchClaimId ||
    receipt.output.artifactId !== output.id || !same(receipt.output.content, output.content) ||
    visualTransitionObservationsArtifactId(state.runId, operation.id, output.content.contentId) !== output.id ||
    visualTransitionReceiptArtifactId(state.runId, operation.id, receiptArtifact.content.contentId) !== receiptArtifact.id ||
    canonicalJsonContentId(observations) !== output.content.contentId || canonicalJsonContentId(receipt) !== receiptArtifact.content.contentId
  ) throw new Error(`Visual-transition audit operation ${operationId} changed authorization or content identities`);
  const upstreamArtifactIds = [
    operation.sourceArtifactId,
    frames.manifestArtifact.id,
    frames.receiptArtifact.id,
    ...frames.frames.map((frame) => frame.artifact.id),
    ocr.observationsArtifact.id,
    ocr.receiptArtifact.id,
  ];
  if (
    !same(output.sourceArtifactIds, upstreamArtifactIds) ||
    !same(receiptArtifact.sourceArtifactIds, [...upstreamArtifactIds, output.id]) ||
    output.origin.operationId !== operation.id || output.origin.receiptId !== receipt.receiptId ||
    output.origin.receiptContentId !== receiptArtifact.content.contentId ||
    output.origin.frameSamplingOperationId !== operation.frameSamplingOperationId || output.origin.ocrOperationId !== operation.ocrOperationId ||
    receiptArtifact.origin.operationId !== operation.id || receiptArtifact.origin.receiptId !== receipt.receiptId ||
    receiptArtifact.origin.observationsArtifactId !== output.id ||
    receiptArtifact.origin.frameSamplingOperationId !== operation.frameSamplingOperationId || receiptArtifact.origin.ocrOperationId !== operation.ocrOperationId
  ) throw new Error(`Visual-transition audit operation ${operationId} changed artifact provenance`);
  if (performance.now() >= deadlineAtMs) throw new Error(`Visual-transition audit operation ${operationId} exceeded its wall limit`);
  return { observations, observationsArtifact: output, receipt, receiptArtifact };
}
