import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";

import { canonicalJsonContentId, ContentAddressedArtifactStore } from "./artifactStore.ts";
import { canonicalJson } from "./artifactStore/contentIdentity.ts";
import {
  frameArtifactId,
  frameIdentity,
  frameManifestArtifactId,
  frameReceiptArtifactId,
} from "./artifactStore/frameArtifacts.ts";
import type { FrameDecoder } from "./frames/decoder.ts";
import { inspectRgbPng } from "./frames/png.ts";
import type {
  FrameSampleManifest,
  FrameSamplingReceipt,
  RuntimeArtifact,
  RuntimeProjection,
  SampledFrameIdentity,
} from "./model.ts";
import { FRAME_SAMPLING_LIMITS } from "./model.ts";
import { validateFrameSampleManifest, validateFrameSamplingReceipt } from "./validation/frames.ts";

export interface VerifiedSampledFrame {
  identity: SampledFrameIdentity;
  artifact: RuntimeArtifact;
  bytes: Buffer;
}

export interface VerifiedFrameSampling {
  manifest: FrameSampleManifest;
  manifestArtifact: RuntimeArtifact;
  receipt: FrameSamplingReceipt;
  receiptArtifact: RuntimeArtifact;
  frames: VerifiedSampledFrame[];
}

function same(left: unknown, right: unknown): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

function requireAudit(condition: boolean, operationId: string, detail: string): void {
  if (!condition) throw new Error(`Frame audit operation ${operationId} ${detail}`);
}

function contentId(bytes: Buffer): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

async function jsonArtifact<T>(
  artifacts: ContentAddressedArtifactStore,
  artifact: RuntimeArtifact,
  maximumBytes: number,
  validate: (value: unknown) => T,
): Promise<T> {
  const path = await artifacts.resolveVerified(artifact);
  const bytes = await readFile(path);
  if (bytes.length > maximumBytes) throw new Error(`Frame audit artifact ${artifact.id} exceeds its byte limit`);
  let value: unknown;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch (cause) {
    throw new Error(`Frame audit artifact ${artifact.id} is not JSON`, { cause });
  }
  const result = validate(value);
  if (
    !bytes.equals(Buffer.from(`${canonicalJson(result)}\n`, "utf8")) ||
    canonicalJsonContentId(result) !== artifact.content.contentId
  ) {
    throw new Error(`Frame audit artifact ${artifact.id} is not canonical content`);
  }
  return result;
}

/**
 * Cold, deterministic audit. It trusts neither projected metadata nor filenames: source,
 * receipt, manifest, every PNG, and the currently installed decoder binaries are reopened.
 */
export async function auditFrameSampling(
  state: RuntimeProjection,
  artifacts: ContentAddressedArtifactStore,
  decoder: FrameDecoder,
  operationId: string,
  options: { maxWallMs?: number } = {},
): Promise<VerifiedFrameSampling> {
  const operation = state.frameSamples[operationId];
  if (!operation || operation.status !== "completed") {
    throw new Error(`Frame audit requires completed operation ${operationId}`);
  }
  const source = state.artifacts[operation.sourceArtifactId];
  const manifestArtifact = operation.manifestArtifactId
    ? state.artifacts[operation.manifestArtifactId]
    : undefined;
  const receiptArtifact = operation.receiptArtifactId
    ? state.artifacts[operation.receiptArtifactId]
    : undefined;
  if (
    !source || source.origin.kind !== "ingest" ||
    !manifestArtifact || manifestArtifact.origin.kind !== "frame_sample_manifest" ||
    !receiptArtifact || receiptArtifact.origin.kind !== "frame_sampling_receipt"
  ) {
    throw new Error(`Frame audit operation ${operationId} has incomplete artifact lineage`);
  }
  await artifacts.resolveVerified(source);
  const [manifest, receipt] = await Promise.all([
    jsonArtifact(
      artifacts,
      manifestArtifact,
      FRAME_SAMPLING_LIMITS.maxManifestBytes,
      (value) => validateFrameSampleManifest(value),
    ),
    jsonArtifact(
      artifacts,
      receiptArtifact,
      FRAME_SAMPLING_LIMITS.maxReceiptBytes,
      (value) => validateFrameSamplingReceipt(value),
    ),
  ]);
  requireAudit(manifest.operationId === operation.id && manifest.runId === state.runId, operationId, "changed manifest ownership");
  requireAudit(
    manifest.source.artifactId === source.id && manifest.source.contentId === source.content.contentId,
    operationId,
    "changed manifest source lineage",
  );
  requireAudit(same(manifest.requestedTimestampsMs, operation.requestedTimestampsMs), operationId, "changed requested timestamps");
  requireAudit(
    same(manifest.grantedRange, { startMs: operation.startMs, endMs: operation.endMs }),
    operationId,
    "changed granted range",
  );
  requireAudit(receipt.operationId === operation.id && receipt.receiptId === operation.receiptId, operationId, "changed receipt identity");
  requireAudit(receiptArtifact.content.contentId === operation.receiptContentId, operationId, "changed receipt content identity");
  requireAudit(
    receipt.source.artifactId === source.id && receipt.source.contentId === source.content.contentId,
    operationId,
    "changed receipt source lineage",
  );
  requireAudit(
    receipt.output.manifestArtifactId === manifestArtifact.id &&
      receipt.output.manifestContentId === manifestArtifact.content.contentId &&
      receipt.output.manifestBytes === manifestArtifact.content.bytes,
    operationId,
    "changed manifest output identity",
  );
  requireAudit(same(receipt.output.frames, manifest.frames), operationId, "changed manifest frame identities");
  if (
    frameManifestArtifactId(state.runId, operation.id, manifestArtifact.content.contentId) !== manifestArtifact.id ||
    frameReceiptArtifactId(state.runId, operation.id, receiptArtifact.content.contentId) !== receiptArtifact.id ||
    canonicalJsonContentId(receipt) !== receiptArtifact.content.contentId ||
    canonicalJsonContentId(manifest) !== manifestArtifact.content.contentId
  ) {
    throw new Error(`Frame audit operation ${operationId} has non-derivable metadata identities`);
  }
  const deadlineAtMs = performance.now() + Math.min(options.maxWallMs ?? 5_000, FRAME_SAMPLING_LIMITS.maxWallMs);
  const currentLineage = await decoder.currentLineage(deadlineAtMs);
  if (!same(currentLineage, receipt.decoder)) {
    throw new Error(`Frame audit operation ${operationId} decoder lineage drifted`);
  }
  if (
    operation.frameArtifactIds.length !== manifest.frames.length ||
    !same(operation.frameArtifactIds, manifest.frames.map((frame) => frame.artifactId))
  ) {
    throw new Error(`Frame audit operation ${operationId} changed its frame set`);
  }
  const verifiedFrames: VerifiedSampledFrame[] = [];
  for (const [index, identity] of manifest.frames.entries()) {
    const artifact = state.artifacts[identity.artifactId];
    if (
      !artifact || artifact.origin.kind !== "sampled_frame" ||
      artifact.origin.frameId !== identity.frameId ||
      artifact.origin.manifestArtifactId !== manifestArtifact.id ||
      artifact.origin.receiptId !== receipt.receiptId ||
      artifact.origin.receiptContentId !== receiptArtifact.content.contentId ||
      artifact.content.contentId !== identity.content.contentId ||
      artifact.content.bytes !== identity.content.bytes ||
      frameArtifactId(state.runId, operation.id, index, identity.content.contentId) !== artifact.id ||
      frameIdentity({
        sourceContentId: source.content.contentId,
        trackId: operation.trackId,
        requestedTimestampMs: identity.requestedTimestampMs,
        actualPresentationTimestampUs: identity.actualPresentationTimestamp.microseconds,
        contentId: identity.content.contentId,
      }) !== identity.frameId
    ) {
      throw new Error(`Frame audit operation ${operationId} frame ${index} changed identity or lineage`);
    }
    const path = await artifacts.resolveVerified(artifact);
    const bytes = await readFile(path);
    if (
      bytes.length !== identity.content.bytes ||
      contentId(bytes) !== identity.content.contentId ||
      bytes.length > FRAME_SAMPLING_LIMITS.maxFrameBytes
    ) {
      throw new Error(`Frame audit operation ${operationId} frame ${index} failed content verification`);
    }
    const dimensions = inspectRgbPng(bytes);
    if (dimensions.width !== identity.width || dimensions.height !== identity.height) {
      throw new Error(`Frame audit operation ${operationId} frame ${index} changed PNG dimensions`);
    }
    verifiedFrames.push({ identity, artifact, bytes });
  }
  return { manifest, manifestArtifact, receipt, receiptArtifact, frames: verifiedFrames };
}
