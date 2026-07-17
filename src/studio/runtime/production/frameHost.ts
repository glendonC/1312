import { chmod, copyFile, mkdtemp, open, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";

import { ContentAddressedArtifactStore, identifyFile } from "./artifactStore.ts";
import { frameIdentity } from "./artifactStore/frameArtifacts.ts";
import { authorizeFrameSampling } from "./authorization.ts";
import type { FrameDecoder } from "./frames/decoder.ts";
import { FrameDecoderFailure } from "./frames/decoder.ts";
import { FfmpegFrameDecoder } from "./frames/ffmpegDecoder.ts";
import { inspectRgbPng } from "./frames/png.ts";
import type { VerifiedFrameSampling, VerifiedSampledFrame } from "./frameAudit.ts";
import type { RuntimeLedger } from "./journal.ts";
import {
  type FrameSampleManifest,
  type FrameSamplingFailureReason,
  type FrameSamplingReceipt,
  type SampledFrameIdentity,
} from "./model.ts";
import type { PendingRuntimeEvent } from "./protocol.ts";
import {
  FRAME_TRANSFORMATION,
  frameSamplingReceiptId,
  validateFrameSampleManifest,
  validateFrameSamplingReceipt,
  validateFrameVideoTrackProbe,
} from "./validation/frames.ts";

function ensureBefore(deadlineAtMs: number): void {
  if (performance.now() >= deadlineAtMs) {
    throw new FrameDecoderFailure("decoder_timeout", "Frame sampling exceeded its wall-time grant");
  }
}

function failureReason(error: unknown): FrameSamplingFailureReason {
  if (error instanceof FrameDecoderFailure) return error.reason;
  return "decoder_failed";
}

async function readBoundedFrame(path: string, maximumBytes: number): Promise<Buffer> {
  const handle = await open(path, "r");
  try {
    const bounded = Buffer.allocUnsafe(maximumBytes + 1);
    let offset = 0;
    while (offset < bounded.length) {
      const { bytesRead } = await handle.read(bounded, offset, bounded.length - offset, offset);
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    if (offset > maximumBytes) {
      throw new FrameDecoderFailure("decoded_frame_oversized", "Decoded PNG exceeds the per-frame byte limit");
    }
    return bounded.subarray(0, offset);
  } finally {
    await handle.close();
  }
}

function sameLineage(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export class BoundedFrameSamplingHost {
  private readonly ledger: RuntimeLedger;
  private readonly artifacts: ContentAddressedArtifactStore;
  private readonly decoder: FrameDecoder;
  private readonly temporaryRoot: string;

  constructor(
    ledger: RuntimeLedger,
    artifacts: ContentAddressedArtifactStore,
    options: {
      decoder?: FrameDecoder;
      ffmpeg?: string;
      ffprobe?: string;
      temporaryRoot?: string;
    } = {},
  ) {
    this.ledger = ledger;
    this.artifacts = artifacts;
    this.decoder = options.decoder ?? new FfmpegFrameDecoder({ ffmpeg: options.ffmpeg, ffprobe: options.ffprobe });
    this.temporaryRoot = options.temporaryRoot ?? tmpdir();
  }

  async sample(requestValue: unknown): Promise<VerifiedFrameSampling> {
    const start = performance.now();
    const started = await this.ledger.transact(
      { producer: { kind: "frame_host", id: "bounded-frame-sampling-host" } },
      ({ state }) => {
        const authorization = authorizeFrameSampling(state, requestValue);
        return {
          pending: [{
            type: "media.frames_sampling_started",
            data: {
              request: authorization.request,
              scope: authorization.scope,
              sourceContentId: authorization.artifact.content.contentId,
              executionId: authorization.executionId,
              launchClaimId: authorization.launchClaimId,
              requestFingerprint: authorization.requestFingerprint,
              limits: structuredClone(authorization.grant.frameScope.limits),
            },
          }] satisfies PendingRuntimeEvent[],
          result: authorization,
        };
      },
    );
    const { request, grant, scope, artifact: source, track, executionId, launchClaimId } = started.result;
    const maximumWallMs = Math.min(
      grant.frameScope.limits.maxWallMs,
      this.ledger.state().tasks[request.taskId].budget.wallMs,
    );
    const deadlineAtMs = start + maximumWallMs;
    let temporaryDirectory: string | null = null;

    try {
      temporaryDirectory = await mkdtemp(join(this.temporaryRoot, "studio-frames-"));
      ensureBefore(deadlineAtMs);
      let registeredSourcePath: string;
      try {
        registeredSourcePath = await this.artifacts.resolveVerified(source);
      } catch (cause) {
        throw new FrameDecoderFailure(
          "source_drift",
          cause instanceof Error ? cause.message : "Registered source failed content verification",
          { cause },
        );
      }
      const sourcePath = join(temporaryDirectory, "authorized-source.media");
      await copyFile(registeredSourcePath, sourcePath);
      await chmod(sourcePath, 0o400);
      const sealedSource = await identifyFile(sourcePath);
      if (sealedSource.contentId !== source.content.contentId || sealedSource.bytes !== source.content.bytes) {
        throw new FrameDecoderFailure("source_drift", "Registered source changed while its private decode snapshot was sealed");
      }
      const decoded = await this.decoder.sample({
        sourcePath,
        registeredTrack: track,
        grantedRange: { startMs: scope.startMs, endMs: scope.endMs },
        requestedTimestampsMs: request.requestedTimestampsMs,
        outputDirectory: temporaryDirectory,
        deadlineAtMs,
      });
      validateFrameVideoTrackProbe(decoded.videoTrack, "Frame decoder result", "videoTrack");
      if (
        decoded.videoTrack.id !== track.id ||
        decoded.videoTrack.index !== track.index ||
        decoded.videoTrack.codec !== track.codec
      ) {
        throw new FrameDecoderFailure("video_track_unavailable", "Decoder probe changed the registered video track identity");
      }
      if (decoded.frames.length !== request.requestedTimestampsMs.length) {
        throw new FrameDecoderFailure("frame_unavailable", "Decoder did not return every requested frame");
      }
      let totalFrameBytes = 0;
      let previousActualUs = -1;
      const validatedFrames: Array<{
        decoded: (typeof decoded.frames)[number];
        bytes: Buffer;
      }> = [];
      for (const [index, frame] of decoded.frames.entries()) {
        ensureBefore(deadlineAtMs);
        if (
          frame.requestedTimestampMs !== request.requestedTimestampsMs[index] ||
          frame.actualPresentationTimestamp.microseconds <= previousActualUs
        ) {
          throw new FrameDecoderFailure(
            frame.actualPresentationTimestamp.microseconds <= previousActualUs
              ? "duplicate_actual_frame"
              : "decoder_failed",
            "Decoder did not close the ordered frame request",
          );
        }
        previousActualUs = frame.actualPresentationTimestamp.microseconds;
        const bytes = await readBoundedFrame(frame.path, grant.frameScope.limits.maxFrameBytes);
        const dimensions = inspectRgbPng(bytes);
        if (dimensions.width !== frame.width || dimensions.height !== frame.height) {
          throw new FrameDecoderFailure("decoder_failed", "Decoded PNG dimensions changed before storage");
        }
        totalFrameBytes += bytes.length;
        if (totalFrameBytes > grant.frameScope.limits.maxTotalFrameBytes) {
          throw new FrameDecoderFailure("decoded_frame_oversized", "Decoded PNGs exceed the aggregate byte limit");
        }
        validatedFrames.push({ decoded: frame, bytes });
      }
      ensureBefore(deadlineAtMs);
      const [sourceAfterDecode, registeredSourceAfterDecode, decoderAfterDecode] = await Promise.all([
        identifyFile(sourcePath),
        identifyFile(registeredSourcePath),
        this.decoder.verifyLineage(deadlineAtMs),
      ]);
      if (
        sourceAfterDecode.contentId !== source.content.contentId ||
        sourceAfterDecode.bytes !== source.content.bytes ||
        registeredSourceAfterDecode.contentId !== source.content.contentId ||
        registeredSourceAfterDecode.bytes !== source.content.bytes
      ) {
        throw new FrameDecoderFailure("source_drift", "Registered source changed while frames were decoded");
      }
      if (!sameLineage(decoded.lineage, decoderAfterDecode.lineage)) {
        throw new FrameDecoderFailure("decoder_failed", "Decoder executable lineage changed while frames were decoded");
      }
      const decoderProcesses = decoded.decoderProcesses + decoderAfterDecode.decoderProcesses;
      const preparedFrames: Array<{
        prepared: Awaited<ReturnType<ContentAddressedArtifactStore["prepareSampledFrame"]>>;
        decoded: (typeof decoded.frames)[number];
      }> = [];
      for (const [index, frame] of validatedFrames.entries()) {
        ensureBefore(deadlineAtMs);
        preparedFrames.push({
          prepared: await this.artifacts.prepareSampledFrame(frame.decoded.path, {
            runId: this.ledger.runId,
            operationId: request.operationId,
            index,
          }),
          decoded: frame.decoded,
        });
      }
      const identities: SampledFrameIdentity[] = preparedFrames.map(({ prepared, decoded: frame }, index) => ({
        index,
        frameId: frameIdentity({
          sourceContentId: source.content.contentId,
          trackId: track.id,
          requestedTimestampMs: frame.requestedTimestampMs,
          actualPresentationTimestampUs: frame.actualPresentationTimestamp.microseconds,
          contentId: prepared.content.contentId,
        }),
        artifactId: prepared.artifactId,
        content: prepared.content,
        requestedTimestampMs: frame.requestedTimestampMs,
        actualPresentationTimestamp: structuredClone(frame.actualPresentationTimestamp),
        width: frame.width,
        height: frame.height,
        mimeType: "image/png",
        transformation: structuredClone(FRAME_TRANSFORMATION),
      }));
      if (new Set(identities.map((frame) => frame.actualPresentationTimestamp.microseconds)).size !== identities.length) {
        throw new FrameDecoderFailure("duplicate_actual_frame", "Decoder returned duplicate actual presentation timestamps");
      }
      const manifest: FrameSampleManifest = {
        schema: "studio.frame-sample-manifest.v1",
        operationId: request.operationId,
        runId: this.ledger.runId,
        source: { artifactId: source.id, contentId: source.content.contentId },
        videoTrack: decoded.videoTrack,
        grantedRange: { startMs: scope.startMs, endMs: scope.endMs },
        requestedTimestampsMs: [...request.requestedTimestampsMs],
        frames: identities,
      };
      validateFrameSampleManifest(manifest);
      const preparedManifest = await this.artifacts.prepareFrameManifest(this.ledger.runId, request.operationId, manifest);
      if (preparedManifest.content.bytes > grant.frameScope.limits.maxManifestBytes) {
        throw new FrameDecoderFailure("decoder_failed", "Frame manifest exceeds its byte limit");
      }
      const measuredBeforeReceiptMs = Math.ceil(performance.now() - start);
      if (measuredBeforeReceiptMs > maximumWallMs) {
        throw new FrameDecoderFailure("decoder_timeout", "Frame sampling exceeded its wall-time grant");
      }
      const receiptWithoutId: Omit<FrameSamplingReceipt, "receiptId"> = {
        schema: "studio.frame-sampling.receipt.v1",
        operationId: request.operationId,
        capability: "media.frames.sample",
        authorization: {
          grantId: grant.id,
          taskId: request.taskId,
          agentId: request.agentId,
          executionId,
          launchClaimId,
        },
        request: { requestedTimestampsMs: [...request.requestedTimestampsMs] },
        source: {
          artifactId: source.id,
          contentId: source.content.contentId,
          videoTrack: decoded.videoTrack,
          grantedRange: { startMs: scope.startMs, endMs: scope.endMs },
        },
        decoder: decoded.lineage,
        limits: structuredClone(grant.frameScope.limits),
        execution: {
          wallMs: maximumWallMs,
          measuredBeforeReceiptMs,
          wallAccounting: "full_grant_charged_before_atomic_completion",
          decoderProcesses,
          frameCount: identities.length,
          totalFrameBytes,
        },
        output: {
          manifestArtifactId: preparedManifest.artifactId,
          manifestContentId: preparedManifest.content.contentId,
          manifestBytes: preparedManifest.content.bytes,
          frames: identities,
        },
        nonClaims: {
          visualUnderstanding: "not_assessed",
          sceneUnderstanding: "not_assessed",
          rightFrameSelection: "not_assessed",
          ocr: "not_performed",
        },
      };
      const receipt: FrameSamplingReceipt = {
        ...receiptWithoutId,
        receiptId: frameSamplingReceiptId(receiptWithoutId),
      };
      validateFrameSamplingReceipt(receipt);
      const preparedReceipt = await this.artifacts.prepareFrameReceipt(this.ledger.runId, request.operationId, receipt);
      if (preparedReceipt.content.bytes > grant.frameScope.limits.maxReceiptBytes) {
        throw new FrameDecoderFailure("decoder_failed", "Frame receipt exceeds its byte limit");
      }
      ensureBefore(deadlineAtMs);
      const frameArtifacts = identities.map((identity, index) => this.artifacts.buildSampledFrameArtifact({
        runId: this.ledger.runId,
        sourceArtifactId: source.id,
        taskId: request.taskId,
        agentId: request.agentId,
        manifestArtifactId: preparedManifest.artifactId,
        receipt,
        receiptContentId: preparedReceipt.content.contentId,
        frame: identity,
        prepared: preparedFrames[index].prepared,
      }));
      const manifestArtifact = this.artifacts.buildFrameManifestArtifact({
        runId: this.ledger.runId,
        sourceArtifactId: source.id,
        frameArtifactIds: frameArtifacts.map((artifact) => artifact.id),
        taskId: request.taskId,
        agentId: request.agentId,
        receipt,
        receiptContentId: preparedReceipt.content.contentId,
        prepared: preparedManifest,
      });
      const receiptArtifact = this.artifacts.buildFrameReceiptArtifact({
        runId: this.ledger.runId,
        sourceArtifactId: source.id,
        frameArtifactIds: frameArtifacts.map((artifact) => artifact.id),
        manifestArtifactId: manifestArtifact.id,
        taskId: request.taskId,
        agentId: request.agentId,
        receipt,
        prepared: preparedReceipt,
      });
      await Promise.all([...frameArtifacts, manifestArtifact, receiptArtifact].map((artifact) =>
        this.artifacts.resolveVerified(artifact)));
      const verifiedFrames: VerifiedSampledFrame[] = [];
      for (const [index, artifact] of frameArtifacts.entries()) {
        const path = await this.artifacts.resolveVerified(artifact);
        const bytes = await readBoundedFrame(path, grant.frameScope.limits.maxFrameBytes);
        const dimensions = inspectRgbPng(bytes);
        if (
          dimensions.width !== identities[index].width || dimensions.height !== identities[index].height ||
          bytes.length !== identities[index].content.bytes
        ) {
          throw new Error("Stored frame changed before its atomic completion receipt");
        }
        verifiedFrames.push({ identity: identities[index], artifact, bytes });
      }
      ensureBefore(deadlineAtMs);
      await this.ledger.transact(
        {
          producer: { kind: "frame_host", id: "bounded-frame-sampling-host" },
          causationId: request.operationId,
        },
        () => ({
          pending: [
            ...frameArtifacts.map((artifact) => ({
              type: "artifact.recorded" as const,
              data: { artifact },
            })),
            { type: "artifact.recorded", data: { artifact: manifestArtifact } } as const,
            { type: "artifact.recorded", data: { artifact: receiptArtifact } } as const,
            {
              type: "media.frames_sampling_completed",
              data: {
                operationId: request.operationId,
                manifestArtifactId: manifestArtifact.id,
                receiptArtifactId: receiptArtifact.id,
                frameArtifactIds: frameArtifacts.map((artifact) => artifact.id),
                receiptContentId: receiptArtifact.content.contentId,
                receipt,
              },
            } as const,
          ] satisfies PendingRuntimeEvent[],
          result: undefined,
        }),
      );
      return { manifest, manifestArtifact, receipt, receiptArtifact, frames: verifiedFrames };
    } catch (error) {
      const state = this.ledger.state();
      if (state.frameSamples[request.operationId]?.status === "started") {
        await this.ledger.transact(
          {
            producer: { kind: "frame_host", id: "bounded-frame-sampling-host" },
            causationId: request.operationId,
          },
          () => ({
            pending: [{
              type: "media.frames_sampling_failed",
              data: { operationId: request.operationId, reason: failureReason(error) },
            }] satisfies PendingRuntimeEvent[],
            result: undefined,
          }),
        );
      }
      throw error;
    } finally {
      if (temporaryDirectory !== null) {
        await rm(temporaryDirectory, { recursive: true, force: true });
      }
    }
  }
}
