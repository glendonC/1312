import { execFile } from "node:child_process";
import { access, chmod, copyFile, readFile, realpath } from "node:fs/promises";
import { constants } from "node:fs";
import { arch, platform } from "node:os";
import { delimiter, isAbsolute, join, resolve } from "node:path";
import { performance } from "node:perf_hooks";

import { identifyFile } from "../artifactStore.ts";
import {
  FRAME_SAMPLING_LIMITS,
  type FrameDecoderExecutableIdentity,
  type FrameDecoderLineage,
  type FramePresentationTimestamp,
  type FrameVideoTrackProbe,
  type MediaTrackDescriptor,
} from "../model.ts";
import { FRAME_TRANSFORMATION } from "../validation/frames.ts";
import {
  FrameDecoderFailure,
  type DecodedFrame,
  type FrameDecodeResult,
  type FrameDecoder,
} from "./decoder.ts";
import { inspectRgbPng } from "./png.ts";

interface CommandResult {
  stdout: string;
  stderr: string;
}

interface ProbeStream {
  index?: number;
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  duration?: string;
  start_pts?: number | string;
  time_base?: string;
  sample_aspect_ratio?: string;
  disposition?: { attached_pic?: number };
  side_data_list?: Array<{ rotation?: number | string }>;
}

function remainingMs(deadlineAtMs: number): number {
  const remaining = Math.floor(deadlineAtMs - performance.now());
  if (remaining <= 0) throw new FrameDecoderFailure("decoder_timeout", "Frame decoder exceeded its wall-time grant");
  return remaining;
}

function command(file: string, args: readonly string[], deadlineAtMs: number): Promise<CommandResult> {
  return new Promise((resolveCommand, rejectCommand) => {
    execFile(
      file,
      [...args],
      {
        timeout: remainingMs(deadlineAtMs),
        maxBuffer: 2 * 1024 * 1024,
        encoding: "utf8",
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        if (!error) {
          resolveCommand({ stdout, stderr });
          return;
        }
        const candidate = error as NodeJS.ErrnoException & { killed?: boolean };
        rejectCommand(new FrameDecoderFailure(
          candidate.code === "ETIMEDOUT" || candidate.killed ? "decoder_timeout" : "decoder_failed",
          candidate.code === "ETIMEDOUT" || candidate.killed
            ? "Frame decoder exceeded its wall-time grant"
            : "Frame decoder process failed",
          { cause: error },
        ));
      },
    );
  });
}

async function executablePath(configured: string): Promise<string> {
  const candidates = isAbsolute(configured) || configured.includes("/") || configured.includes("\\")
    ? [resolve(configured)]
    : (process.env.PATH ?? "")
        .split(delimiter)
        .filter(Boolean)
        .flatMap((directory) => process.platform === "win32"
          ? [join(directory, configured), join(directory, `${configured}.exe`)]
          : [join(directory, configured)]);
  for (const candidate of candidates) {
    try {
      await access(candidate, constants.X_OK);
      return realpath(candidate);
    } catch {
      // Search the next explicit PATH entry.
    }
  }
  throw new FrameDecoderFailure("decoder_failed", `Registered decoder executable ${configured} is unavailable`);
}

async function executableIdentity(path: string, deadlineAtMs: number): Promise<FrameDecoderExecutableIdentity> {
  const [{ stdout }, binary] = await Promise.all([
    command(path, ["-version"], deadlineAtMs),
    identifyFile(path),
  ]);
  const version = stdout.split("\n")[0]?.trim();
  if (!version) throw new FrameDecoderFailure("decoder_failed", "Decoder executable reported no version lineage");
  return { version, binary };
}

function rational(value: string | undefined): { numerator: number; denominator: number } {
  const match = /^(\d+)\/(\d+)$/.exec(value ?? "");
  const numerator = Number(match?.[1]);
  const denominator = Number(match?.[2]);
  if (!Number.isSafeInteger(numerator) || numerator <= 0 || !Number.isSafeInteger(denominator) || denominator <= 0) {
    throw new FrameDecoderFailure("video_track_unavailable", "Video track has no usable integer time base");
  }
  return { numerator, denominator };
}

function integer(value: number | string | undefined, label: string): number {
  const parsed = typeof value === "string" && /^-?\d+$/.test(value) ? Number(value) : value;
  if (!Number.isSafeInteger(parsed)) {
    throw new FrameDecoderFailure("video_track_unavailable", `Video track has no usable ${label}`);
  }
  return parsed as number;
}

function measuredDurationMs(value: string | undefined): number | null {
  if (value === undefined) return null;
  const measured = Number(value);
  if (!Number.isFinite(measured) || measured <= 0) return null;
  const milliseconds = Math.round(measured * 1_000);
  return Number.isSafeInteger(milliseconds) && milliseconds > 0 ? milliseconds : null;
}

function tickAtOrAfter(milliseconds: number, startPts: number, timeBase: { numerator: number; denominator: number }): number {
  const scaled = BigInt(milliseconds) * BigInt(timeBase.denominator);
  const unit = 1_000n * BigInt(timeBase.numerator);
  const relative = (scaled + unit - 1n) / unit;
  const tick = BigInt(startPts) + relative;
  const result = Number(tick);
  if (!Number.isSafeInteger(result)) throw new FrameDecoderFailure("decoder_failed", "Requested timestamp exceeds safe decoder PTS bounds");
  return result;
}

function presentationTimestamp(
  pts: number,
  startPts: number,
  timeBase: { numerator: number; denominator: number },
): FramePresentationTimestamp {
  const microseconds = Math.round(((pts - startPts) * timeBase.numerator * 1_000_000) / timeBase.denominator);
  if (!Number.isSafeInteger(microseconds) || microseconds < 0) {
    throw new FrameDecoderFailure("decoder_failed", "Decoder returned an unsafe presentation timestamp");
  }
  return { pts, sourceStartPts: startPts, timeBase: { ...timeBase }, microseconds };
}

function framehash(stdout: string): { pts: number; timeBase: { numerator: number; denominator: number } } {
  const timeBases = [...stdout.matchAll(/^#tb 0:\s*(\d+)\/(\d+)\s*$/gm)];
  const rows = stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^0\s*,/.test(line));
  if (timeBases.length !== 1 || rows.length !== 1) {
    throw new FrameDecoderFailure("frame_unavailable", "Decoder did not close the request with exactly one frame PTS");
  }
  const fields = rows[0].split(",").map((field) => field.trim());
  const pts = Number(fields[2]);
  if (fields.length !== 6 || fields[0] !== "0" || !/^-?\d+$/.test(fields[2]) || !Number.isSafeInteger(pts)) {
    throw new FrameDecoderFailure("decoder_failed", "Decoder returned an invalid framehash row");
  }
  return {
    pts,
    timeBase: { numerator: Number(timeBases[0][1]), denominator: Number(timeBases[0][2]) },
  };
}

async function pngDimensions(path: string): Promise<{ width: number; height: number }> {
  return inspectRgbPng(await readFile(path));
}

function seconds(milliseconds: number): string {
  return (milliseconds / 1_000).toFixed(6);
}

export class FfmpegFrameDecoder implements FrameDecoder {
  private readonly ffmpeg: string;
  private readonly ffprobe: string;

  constructor(options: { ffmpeg?: string; ffprobe?: string } = {}) {
    this.ffmpeg = options.ffmpeg ?? "ffmpeg";
    this.ffprobe = options.ffprobe ?? "ffprobe";
  }

  async currentLineage(deadlineAtMs: number): Promise<FrameDecoderLineage> {
    const [ffmpegPath, ffprobePath] = await Promise.all([
      executablePath(this.ffmpeg),
      executablePath(this.ffprobe),
    ]);
    const [ffmpeg, ffprobe] = await Promise.all([
      executableIdentity(ffmpegPath, deadlineAtMs),
      executableIdentity(ffprobePath, deadlineAtMs),
    ]);
    return {
      schema: "studio.frame-decoder-lineage.v1",
      adapter: { id: "ffmpeg-frame-decoder", version: "1" },
      ffmpeg,
      ffprobe,
      platform: { os: platform(), arch: arch() },
      transformation: structuredClone(FRAME_TRANSFORMATION),
    };
  }

  async verifyLineage(deadlineAtMs: number): Promise<{
    lineage: FrameDecoderLineage;
    decoderProcesses: number;
  }> {
    return { lineage: await this.currentLineage(deadlineAtMs), decoderProcesses: 2 };
  }

  private async probe(
    ffprobePath: string,
    sourcePath: string,
    registeredTrack: MediaTrackDescriptor,
    deadlineAtMs: number,
  ): Promise<FrameVideoTrackProbe> {
    const { stdout } = await command(ffprobePath, [
      "-v", "error",
      "-show_entries",
      "stream=index,codec_type,codec_name,duration,start_pts,time_base,width,height,sample_aspect_ratio:stream_disposition=attached_pic:stream_side_data=rotation",
      "-of", "json",
      sourcePath,
    ], deadlineAtMs);
    let streams: ProbeStream[];
    try {
      const parsed = JSON.parse(stdout) as { streams?: ProbeStream[] };
      streams = parsed.streams ?? [];
    } catch (cause) {
      throw new FrameDecoderFailure("decoder_failed", "ffprobe returned invalid JSON", { cause });
    }
    const stream = streams.find((candidate) => candidate.index === registeredTrack.index);
    if (
      !stream || stream.codec_type !== "video" || stream.codec_name !== registeredTrack.codec ||
      stream.disposition?.attached_pic === 1
    ) {
      throw new FrameDecoderFailure("video_track_unavailable", "Registered video track does not match the decoded source");
    }
    const width = integer(stream.width, "width");
    const height = integer(stream.height, "height");
    if (width <= 0 || height <= 0) {
      throw new FrameDecoderFailure("video_track_unavailable", "Registered video track has no positive dimensions");
    }
    if (
      width > FRAME_SAMPLING_LIMITS.maxInputEdgePx ||
      height > FRAME_SAMPLING_LIMITS.maxInputEdgePx ||
      width * height > FRAME_SAMPLING_LIMITS.maxInputPixels
    ) {
      throw new FrameDecoderFailure("decoded_frame_oversized", "Video track exceeds input dimension limits");
    }
    const rotations = (stream.side_data_list ?? [])
      .filter((entry) => entry.rotation !== undefined)
      .map((entry) => integer(entry.rotation, "display rotation"));
    if (rotations.length > 1) {
      throw new FrameDecoderFailure("video_track_unavailable", "Video track has ambiguous display-matrix rotation");
    }
    if (!/^\d+:\d+$/.test(stream.sample_aspect_ratio ?? "")) {
      throw new FrameDecoderFailure("video_track_unavailable", "Video track has no measured sample aspect ratio");
    }
    return {
      id: registeredTrack.id,
      index: registeredTrack.index,
      codec: registeredTrack.codec,
      width,
      height,
      durationMs: measuredDurationMs(stream.duration),
      startPts: integer(stream.start_pts, "start PTS"),
      timeBase: rational(stream.time_base),
      sourceSampleAspectRatio: stream.sample_aspect_ratio!,
      displayMatrix: {
        present: rotations.length === 1,
        rotationDegrees: rotations[0] ?? null,
      },
    };
  }

  private async decodeOne(input: {
    ffmpegPath: string;
    sourcePath: string;
    videoTrack: FrameVideoTrackProbe;
    requestedTimestampMs: number;
    grantedEndMs: number;
    outputPath: string;
    deadlineAtMs: number;
  }): Promise<DecodedFrame> {
    const { videoTrack } = input;
    const lowerPts = tickAtOrAfter(input.requestedTimestampMs, videoTrack.startPts, videoTrack.timeBase);
    const upperPts = tickAtOrAfter(input.grantedEndMs, videoTrack.startPts, videoTrack.timeBase);
    const filter = [
      `[0:${videoTrack.index}]select='gte(pts,${lowerPts})*lt(pts,${upperPts})',select='eq(n,0)',split=2[selected_png][selected_pts]`,
      `[selected_png]scale=w='min(${FRAME_SAMPLING_LIMITS.maxOutputWidthPx},iw)':h='min(${FRAME_SAMPLING_LIMITS.maxOutputHeightPx},ih)':force_original_aspect_ratio=decrease:force_divisible_by=2:reset_sar=1:flags=lanczos+accurate_rnd+full_chroma_int,format=rgb24[png]`,
    ].join(";");
    const { stdout } = await command(input.ffmpegPath, [
      "-nostdin", "-hide_banner", "-loglevel", "error",
      "-copyts", "-accurate_seek",
      "-ss", seconds(input.requestedTimestampMs),
      "-t", seconds(input.grantedEndMs - input.requestedTimestampMs),
      "-autorotate",
      "-i", input.sourcePath,
      "-filter_complex", filter,
      "-map", "[png]", "-frames:v", "1",
      "-c:v", "png", "-pred", "mixed", "-compression_level", "6", "-flags:v", "+bitexact",
      "-map_metadata", "-1", "-f", "image2", "-update", "1", input.outputPath,
      "-map", "[selected_pts]", "-frames:v", "1", "-c:v", "rawvideo", "-pix_fmt", "yuv420p",
      "-enc_time_base:v", "demux", "-f", "framehash", "pipe:1",
    ], input.deadlineAtMs);
    const closed = framehash(stdout);
    if (
      closed.timeBase.numerator !== videoTrack.timeBase.numerator ||
      closed.timeBase.denominator !== videoTrack.timeBase.denominator
    ) {
      throw new FrameDecoderFailure("decoder_failed", "Framehash time base changed from the probed video track");
    }
    const actualPresentationTimestamp = presentationTimestamp(closed.pts, videoTrack.startPts, videoTrack.timeBase);
    if (
      actualPresentationTimestamp.microseconds < input.requestedTimestampMs * 1_000 ||
      actualPresentationTimestamp.microseconds >= input.grantedEndMs * 1_000
    ) {
      throw new FrameDecoderFailure("frame_unavailable", "Decoder returned a frame outside the authorized presentation window");
    }
    const dimensions = await pngDimensions(input.outputPath);
    return {
      path: input.outputPath,
      requestedTimestampMs: input.requestedTimestampMs,
      actualPresentationTimestamp,
      ...dimensions,
    };
  }

  async sample(input: {
    sourcePath: string;
    registeredTrack: MediaTrackDescriptor;
    grantedRange: { startMs: number; endMs: number };
    requestedTimestampsMs: number[];
    outputDirectory: string;
    deadlineAtMs: number;
  }): Promise<FrameDecodeResult> {
    const [installedFfmpegPath, installedFfprobePath] = await Promise.all([
      executablePath(this.ffmpeg),
      executablePath(this.ffprobe),
    ]);
    const ffmpegPath = join(input.outputDirectory, "decoder-ffmpeg");
    const ffprobePath = join(input.outputDirectory, "decoder-ffprobe");
    await Promise.all([
      copyFile(installedFfmpegPath, ffmpegPath),
      copyFile(installedFfprobePath, ffprobePath),
    ]);
    await Promise.all([chmod(ffmpegPath, 0o500), chmod(ffprobePath, 0o500)]);
    const [ffmpeg, ffprobe] = await Promise.all([
      executableIdentity(ffmpegPath, input.deadlineAtMs),
      executableIdentity(ffprobePath, input.deadlineAtMs),
    ]);
    const lineage: FrameDecoderLineage = {
      schema: "studio.frame-decoder-lineage.v1",
      adapter: { id: "ffmpeg-frame-decoder", version: "1" },
      ffmpeg,
      ffprobe,
      platform: { os: platform(), arch: arch() },
      transformation: structuredClone(FRAME_TRANSFORMATION),
    };
    const videoTrack = await this.probe(
      ffprobePath,
      input.sourcePath,
      input.registeredTrack,
      input.deadlineAtMs,
    );
    const frames: DecodedFrame[] = [];
    for (const [index, requestedTimestampMs] of input.requestedTimestampsMs.entries()) {
      frames.push(await this.decodeOne({
        ffmpegPath,
        sourcePath: input.sourcePath,
        videoTrack,
        requestedTimestampMs,
        grantedEndMs: input.grantedRange.endMs,
        outputPath: join(input.outputDirectory, `frame-${String(index).padStart(3, "0")}.png`),
        deadlineAtMs: input.deadlineAtMs,
      }));
    }
    const [ffmpegAfter, ffprobeAfter] = await Promise.all([
      identifyFile(ffmpegPath),
      identifyFile(ffprobePath),
    ]);
    if (
      ffmpegAfter.contentId !== lineage.ffmpeg.binary.contentId ||
      ffmpegAfter.bytes !== lineage.ffmpeg.binary.bytes ||
      ffprobeAfter.contentId !== lineage.ffprobe.binary.contentId ||
      ffprobeAfter.bytes !== lineage.ffprobe.binary.bytes
    ) {
      throw new FrameDecoderFailure("decoder_failed", "Private decoder executable snapshot changed during frame decoding");
    }
    return { lineage, videoTrack, frames, decoderProcesses: frames.length + 3 };
  }
}
