import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { canonicalSha256, ContentAddressedArtifactStore } from "./artifactStore.ts";
import { authorizeMediaExtract, authorizeMediaSeek } from "./authorization.ts";
import type {
  MediaExtractReceipt,
  MediaSeekObservationReceipt,
  MediaTrackDescriptor,
  RuntimeArtifact,
} from "./model.ts";
import type { RuntimeLedger } from "./journal.ts";
import type { PendingRuntimeEvent } from "./protocol.ts";

interface ExecResult {
  stdout: string;
  stderr: string;
}

function execute(file: string, args: readonly string[], timeoutMs: number): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    execFile(
      file,
      [...args],
      { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024, encoding: "utf8", windowsHide: true },
      (error, stdout, stderr) => {
        if (error) reject(error);
        else resolve({ stdout, stderr });
      },
    );
  });
}

function seconds(milliseconds: number): string {
  return (milliseconds / 1000).toFixed(3);
}

function safeFailure(error: unknown, operation: "range extraction" | "bounded seek observation"): string {
  const candidate = error as NodeJS.ErrnoException & { killed?: boolean };
  if (candidate?.code === "ETIMEDOUT") return `ffmpeg ${operation} timed out`;
  if (candidate?.killed) return `ffmpeg ${operation} was terminated`;
  return `ffmpeg ${operation} failed`;
}

function decodedDurationUs(stdout: string, maximumUs: number): number {
  const progress = new Map<string, string>();
  for (const line of stdout.trimEnd().split("\n")) {
    const separator = line.indexOf("=");
    if (separator > 0) progress.set(line.slice(0, separator), line.slice(separator + 1).trim());
  }
  if (progress.get("progress") !== "end") throw new Error("ffmpeg seek did not report bounded completion");
  const rawDuration = progress.get("out_time_us");
  if (!rawDuration || !/^\d+$/.test(rawDuration)) throw new Error("ffmpeg seek did not report decoded duration");
  const duration = Number(rawDuration);
  if (!Number.isSafeInteger(duration) || duration <= 0 || duration > maximumUs) {
    throw new Error("ffmpeg seek decoded outside the authorized duration");
  }
  return duration;
}

export class FfmpegCapabilityHost {
  private versionPromise: Promise<string> | null = null;
  private readonly ledger: RuntimeLedger;
  private readonly artifacts: ContentAddressedArtifactStore;
  private readonly options: {
    ffmpeg?: string;
    ffprobe?: string;
    timeoutMs?: number;
    temporaryRoot?: string;
  };

  constructor(
    ledger: RuntimeLedger,
    artifacts: ContentAddressedArtifactStore,
    options: {
      ffmpeg?: string;
      ffprobe?: string;
      timeoutMs?: number;
      temporaryRoot?: string;
    } = {},
  ) {
    this.ledger = ledger;
    this.artifacts = artifacts;
    this.options = options;
  }

  private async version(): Promise<string> {
    if (!this.versionPromise) {
      this.versionPromise = execute(this.options.ffmpeg ?? "ffmpeg", ["-version"], 5_000).then(({ stdout }) => {
        const first = stdout.split("\n")[0]?.trim();
        if (!first) throw new Error("ffmpeg did not report a version");
        return first;
      });
    }
    return this.versionPromise;
  }

  private async probe(path: string): Promise<{ durationMs: number; tracks: MediaTrackDescriptor[] }> {
    const { stdout } = await execute(
      this.options.ffprobe ?? "ffprobe",
      [
        "-v",
        "error",
        "-show_entries",
        "format=duration:stream=index,codec_type,codec_name,duration",
        "-of",
        "json",
        path,
      ],
      10_000,
    );
    const parsed = JSON.parse(stdout) as {
      format?: { duration?: string };
      streams?: Array<{ index?: number; codec_type?: string; codec_name?: string; duration?: string }>;
    };
    const durationMs = Math.round(Number(parsed.format?.duration) * 1000);
    if (!Number.isSafeInteger(durationMs) || durationMs <= 0) throw new Error("ffprobe returned no measured output duration");
    const tracks = (parsed.streams ?? []).map((stream) => {
      if (!Number.isSafeInteger(stream.index) || stream.index! < 0 || stream.codec_type !== "audio" || !stream.codec_name) {
        throw new Error("ffprobe returned an invalid extracted audio track");
      }
      const trackDuration = Number(stream.duration);
      return {
        id: `stream:${stream.index}`,
        index: stream.index!,
        kind: "audio" as const,
        codec: stream.codec_name,
        durationMs: Number.isFinite(trackDuration) && trackDuration > 0 ? Math.round(trackDuration * 1000) : null,
      };
    });
    if (tracks.length !== 1) throw new Error("ffmpeg extraction must produce exactly one audio track");
    return { durationMs, tracks };
  }

  async extract(requestValue: unknown): Promise<{ artifact: RuntimeArtifact; receipt: MediaExtractReceipt }> {
    const started = await this.ledger.transact(
      { producer: { kind: "media_host", id: "ffmpeg-capability-host" } },
      ({ state }) => {
        const authorization = authorizeMediaExtract(state, requestValue);
        return {
          pending: [
            {
              type: "media.operation_started",
              data: {
                capability: "media.extract",
                request: authorization.request,
                grantId: authorization.grant.id,
              },
            },
          ] satisfies PendingRuntimeEvent[],
          result: authorization,
        };
      },
    );
    const { request, grant, artifact: source, track } = started.result;
    const temporaryDirectory = await mkdtemp(join(this.options.temporaryRoot ?? tmpdir(), "studio-media-"));
    const outputPath = join(temporaryDirectory, "range.wav");

    try {
      const inputPath = await this.artifacts.resolveVerified(source);
      const timeoutMs = Math.min(this.options.timeoutMs ?? 30_000, this.ledger.state().tasks[request.taskId].budget.wallMs);
      await execute(
        this.options.ffmpeg ?? "ffmpeg",
        [
          "-nostdin",
          "-hide_banner",
          "-loglevel",
          "error",
          "-ss",
          seconds(request.startMs),
          "-t",
          seconds(request.endMs - request.startMs),
          "-i",
          inputPath,
          "-map",
          `0:${track.index}`,
          "-vn",
          "-c:a",
          "pcm_s16le",
          "-f",
          "wav",
          outputPath,
        ],
        timeoutMs,
      );
      const measured = await this.probe(outputPath);
      const prepared = await this.artifacts.prepareDerived(outputPath, {
        runId: this.ledger.runId,
        kind: "media-range-audio",
        operationId: request.operationId,
        publication: source.publication,
        durationMs: measured.durationMs,
        tracks: measured.tracks,
      });
      const receiptBody = {
        operationId: request.operationId,
        capability: "media.extract" as const,
        authorization: { grantId: grant.id, taskId: request.taskId, agentId: request.agentId },
        request: {
          artifactId: request.artifactId,
          trackId: request.trackId,
          startMs: request.startMs,
          endMs: request.endMs,
        },
        producer: { id: "ffmpeg.audio-range-extract" as const, version: await this.version() },
        input: { artifactId: source.id, contentId: source.content.contentId },
        output: {
          artifactId: prepared.artifactId,
          contentId: prepared.content.contentId,
          bytes: prepared.content.bytes,
          durationMs: measured.durationMs,
          trackId: measured.tracks[0].id,
        },
        sourceArtifactIds: [source.id],
      };
      const receipt: MediaExtractReceipt = {
        schema: "studio.media-operation.receipt.v1",
        receiptId: `receipt:${canonicalSha256(receiptBody)}`,
        ...receiptBody,
      };
      const storedReceipt = await this.artifacts.storeReceipt(receipt);
      const artifact = this.artifacts.buildDerivedArtifact({
        runId: this.ledger.runId,
        kind: "media-range-audio",
        operationId: request.operationId,
        receiptId: receipt.receiptId,
        receiptContentId: storedReceipt.content.contentId,
        publication: source.publication,
        durationMs: measured.durationMs,
        tracks: measured.tracks,
        sourceArtifactIds: [source.id],
        producerTaskId: request.taskId,
        producerAgentId: request.agentId,
        prepared,
      });
      await this.artifacts.record(this.ledger, artifact, request.operationId);
      await this.ledger.transact(
        { producer: { kind: "media_host", id: "ffmpeg-capability-host" }, causationId: request.operationId },
        () => ({
          pending: [
            {
              type: "media.operation_completed",
              data: { operationId: request.operationId, outputArtifactId: artifact.id, receipt },
            },
          ] satisfies PendingRuntimeEvent[],
          result: undefined,
        }),
      );
      return { artifact, receipt };
    } catch (error) {
      const state = this.ledger.state();
      if (state.operations[request.operationId]?.status === "started") {
        await this.ledger.transact(
          { producer: { kind: "media_host", id: "ffmpeg-capability-host" }, causationId: request.operationId },
          () => ({
            pending: [
              {
                type: "media.operation_failed",
                data: { operationId: request.operationId, reason: safeFailure(error, "range extraction") },
              },
            ] satisfies PendingRuntimeEvent[],
            result: undefined,
          }),
        );
      }
      throw error;
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  }

  async seek(requestValue: unknown): Promise<{ artifact: RuntimeArtifact; receipt: MediaSeekObservationReceipt }> {
    const started = await this.ledger.transact(
      { producer: { kind: "media_host", id: "ffmpeg-capability-host" } },
      ({ state }) => {
        const authorization = authorizeMediaSeek(state, requestValue);
        return {
          pending: [
            {
              type: "media.operation_started",
              data: {
                capability: "media.seek",
                request: authorization.request,
                grantId: authorization.grant.id,
              },
            },
          ] satisfies PendingRuntimeEvent[],
          result: authorization,
        };
      },
    );
    const { request, grant, artifact: source, track } = started.result;

    try {
      const inputPath = await this.artifacts.resolveVerified(source);
      const timeoutMs = Math.min(
        this.options.timeoutMs ?? 30_000,
        this.ledger.state().tasks[request.taskId].budget.wallMs,
      );
      const { stdout } = await execute(
        this.options.ffmpeg ?? "ffmpeg",
        [
          "-nostdin",
          "-hide_banner",
          "-loglevel",
          "error",
          "-ss",
          seconds(request.startMs),
          "-t",
          seconds(request.endMs - request.startMs),
          "-i",
          inputPath,
          "-map",
          `0:${track.index}`,
          "-f",
          "null",
          "-",
          "-progress",
          "pipe:1",
          "-nostats",
        ],
        timeoutMs,
      );
      const observedDurationUs = decodedDurationUs(stdout, (request.endMs - request.startMs) * 1_000);
      const receiptBody = {
        operationId: request.operationId,
        capability: "media.seek" as const,
        authorization: { grantId: grant.id, taskId: request.taskId, agentId: request.agentId },
        request: {
          artifactId: request.artifactId,
          trackId: request.trackId,
          startMs: request.startMs,
          endMs: request.endMs,
        },
        producer: { id: "ffmpeg.bounded-seek-observation" as const, version: await this.version() },
        input: { artifactId: source.id, contentId: source.content.contentId },
        observation: { status: "decoded" as const, decodedDurationUs: observedDurationUs },
        sourceArtifactIds: [source.id],
      };
      const receipt: MediaSeekObservationReceipt = {
        schema: "studio.media-operation.receipt.v1",
        receiptId: `receipt:${canonicalSha256(receiptBody)}`,
        ...receiptBody,
      };
      const storedReceipt = await this.artifacts.storeReceipt(receipt);
      const artifact = this.artifacts.buildObservationArtifact({
        runId: this.ledger.runId,
        operationId: request.operationId,
        receiptId: receipt.receiptId,
        sourceArtifactIds: [source.id],
        producerTaskId: request.taskId,
        producerAgentId: request.agentId,
        storedReceipt,
      });
      await this.artifacts.record(this.ledger, artifact, request.operationId);
      await this.ledger.transact(
        { producer: { kind: "media_host", id: "ffmpeg-capability-host" }, causationId: request.operationId },
        () => ({
          pending: [
            {
              type: "media.operation_completed",
              data: { operationId: request.operationId, outputArtifactId: artifact.id, receipt },
            },
          ] satisfies PendingRuntimeEvent[],
          result: undefined,
        }),
      );
      return { artifact, receipt };
    } catch (error) {
      const state = this.ledger.state();
      if (state.operations[request.operationId]?.status === "started") {
        await this.ledger.transact(
          { producer: { kind: "media_host", id: "ffmpeg-capability-host" }, causationId: request.operationId },
          () => ({
            pending: [
              {
                type: "media.operation_failed",
                data: { operationId: request.operationId, reason: safeFailure(error, "bounded seek observation") },
              },
            ] satisfies PendingRuntimeEvent[],
            result: undefined,
          }),
        );
      }
      throw error;
    }
  }
}
