import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { promisify } from "node:util";

import {
  resolveYouTubeSource,
  type RemoteSourceResolutionReceipt,
} from "../../../../../scripts/lib/resolve-youtube-source.ts";
import type { MediaProbeReceipt, YouTubeLocalIngestReceipt } from "../../../types.ts";
import { identifyFile } from "../artifactStore.ts";
import { RuntimeHostError } from "./errors.ts";
import type {
  RuntimeHostSourceSummary,
  YouTubeLocalIngestFailure,
  YouTubeLocalIngestRequest,
  YouTubeLocalIngestState,
  YouTubeLocalIngestStatus,
} from "./model.ts";
import { RuntimeSourceRegistry } from "./sourceRegistry.ts";

const executeFile = promisify(execFile);
const YOUTUBE_HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"]);
export const DEFAULT_MAXIMUM_YOUTUBE_LOCAL_RANGE_MS = 120_000;

interface YouTubeLocalIngestJob {
  ingestId: string;
  runId: string;
  request: YouTubeLocalIngestRequest;
  sourceDirectory: string;
  status: YouTubeLocalIngestState;
  updatedAt: string;
  source: RuntimeHostSourceSummary | null;
  failure: YouTubeLocalIngestFailure | null;
}

export interface YouTubeLocalDownloadInput {
  canonicalUrl: string;
  startMs: number;
  endMs: number;
  outputPath: string;
}

export type YouTubeLocalDownloader = (input: YouTubeLocalDownloadInput) => Promise<void>;

export interface YouTubeLocalIngestServiceOptions {
  root: string;
  repositoryRoot: string;
  sources: RuntimeSourceRegistry;
  maximumRangeMs?: number;
  now?: () => Date;
  ingestId?: () => string;
  resolveSource?: typeof resolveYouTubeSource;
  download?: YouTubeLocalDownloader;
}

function exactObject(value: unknown, fields: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new RuntimeHostError("invalid_ingest_request", "YouTube-local ingest metadata must be an object.");
  }
  const item = value as Record<string, unknown>;
  const expected = new Set(fields);
  if (Object.keys(item).some((field) => !expected.has(field)) || fields.some((field) => !(field in item))) {
    throw new RuntimeHostError(
      "invalid_ingest_request",
      "YouTube-local ingest metadata contains missing or unsupported fields.",
    );
  }
  return item;
}

function youtubeUrl(value: unknown): string {
  if (typeof value !== "string" || !value || value.trim() !== value || value.length > 2_048) {
    throw new RuntimeHostError("invalid_ingest_request", "A complete HTTPS YouTube URL is required.");
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new RuntimeHostError("invalid_ingest_request", "A complete HTTPS YouTube URL is required.");
  }
  if (
    parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.port ||
    !YOUTUBE_HOSTS.has(parsed.hostname.toLowerCase())
  ) throw new RuntimeHostError("invalid_ingest_request", "Only HTTPS YouTube video URLs are supported.");
  return parsed.toString();
}

function parseRequest(value: unknown, maximumRangeMs: number): YouTubeLocalIngestRequest {
  const item = exactObject(value, ["url", "startMs", "endMs", "localProcessingConfirmed"]);
  if (item.localProcessingConfirmed !== true) {
    throw new RuntimeHostError(
      "invalid_rights_attestation",
      "Explicit local-processing-only confirmation is required before downloading YouTube bytes.",
    );
  }
  if (
    !Number.isSafeInteger(item.startMs) || !Number.isSafeInteger(item.endMs) ||
    (item.startMs as number) < 0 || (item.endMs as number) <= (item.startMs as number)
  ) throw new RuntimeHostError("invalid_ingest_request", "The YouTube range must be bounded in whole milliseconds.");
  if ((item.endMs as number) - (item.startMs as number) > maximumRangeMs) {
    throw new RuntimeHostError("ingest_range_too_large", "The YouTube range exceeds the host local-ingest limit.", 413);
  }
  return {
    url: youtubeUrl(item.url),
    startMs: item.startMs as number,
    endMs: item.endMs as number,
    localProcessingConfirmed: true,
  };
}

function contained(root: string, candidate: string): boolean {
  const inside = relative(root, candidate);
  return inside.length > 0 && !inside.startsWith("..") && !isAbsolute(inside);
}

function indexedContent(identity: Awaited<ReturnType<typeof identifyFile>>) {
  return {
    id: identity.contentId,
    hash: { algorithm: identity.algorithm, digest: identity.digest },
    bytes: identity.bytes,
  };
}

function seconds(milliseconds: number): string {
  return (milliseconds / 1_000).toFixed(3);
}

async function defaultDownload(input: YouTubeLocalDownloadInput): Promise<void> {
  await executeFile("yt-dlp", [
    "--no-playlist",
    "--no-warnings",
    "--no-progress",
    "--download-sections", `*${seconds(input.startMs)}-${seconds(input.endMs)}`,
    "--force-keyframes-at-cuts",
    "--format", "bv*+ba/b",
    "--merge-output-format", "mp4",
    "--remux-video", "mp4",
    "--output", input.outputPath,
    input.canonicalUrl,
  ], {
    timeout: 10 * 60_000,
    maxBuffer: 4 * 1024 * 1024,
    windowsHide: true,
  });
}

/** Private, host-owned YouTube range download, receipt sealing, and source registration. */
export class YouTubeLocalIngestService {
  readonly root: string;
  readonly maximumRangeMs: number;
  private readonly repositoryRoot: string;
  private readonly sources: RuntimeSourceRegistry;
  private readonly now: () => Date;
  private readonly ingestId: () => string;
  private readonly resolveSource: typeof resolveYouTubeSource;
  private readonly download: YouTubeLocalDownloader;
  private readonly jobs = new Map<string, YouTubeLocalIngestJob>();
  private processingTail: Promise<void> = Promise.resolve();

  private constructor(options: YouTubeLocalIngestServiceOptions, root: string) {
    this.root = root;
    this.repositoryRoot = resolve(options.repositoryRoot);
    this.sources = options.sources;
    this.maximumRangeMs = options.maximumRangeMs ?? DEFAULT_MAXIMUM_YOUTUBE_LOCAL_RANGE_MS;
    this.now = options.now ?? (() => new Date());
    this.ingestId = options.ingestId ?? (() => `youtube-ingest:${randomUUID()}`);
    this.resolveSource = options.resolveSource ?? resolveYouTubeSource;
    this.download = options.download ?? defaultDownload;
  }

  static async open(options: YouTubeLocalIngestServiceOptions): Promise<YouTubeLocalIngestService> {
    const maximumRangeMs = options.maximumRangeMs ?? DEFAULT_MAXIMUM_YOUTUBE_LOCAL_RANGE_MS;
    if (!Number.isSafeInteger(maximumRangeMs) || maximumRangeMs < 1) {
      throw new RuntimeHostError("invalid_ingest_limit", "The YouTube-local range limit is invalid.");
    }
    await mkdir(resolve(options.root), { recursive: true, mode: 0o700 });
    const root = await realpath(resolve(options.root));
    const service = new YouTubeLocalIngestService({ ...options, maximumRangeMs }, root);
    await service.registerSealedDirectories();
    return service;
  }

  private async registerSealedDirectories(): Promise<void> {
    const entries = await readdir(this.root, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const directory = join(this.root, entry.name);
      try {
        if (!(await stat(join(directory, "preflight.json"))).isFile()) continue;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw error;
      }
      await this.sources.registerDirectory(directory, { sourceRoot: this.root });
    }
  }

  create(value: unknown): YouTubeLocalIngestStatus {
    const request = parseRequest(value, this.maximumRangeMs);
    const ingestId = this.ingestId();
    if (!/^youtube-ingest:[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(ingestId) || this.jobs.has(ingestId)) {
      throw new RuntimeHostError("ingest_identity_failed", "The host could not allocate a unique ingest identity.", 500);
    }
    const suffix = ingestId.slice("youtube-ingest:".length);
    const sourceDirectory = join(this.root, suffix);
    if (!contained(this.root, sourceDirectory)) {
      throw new RuntimeHostError("ingest_identity_failed", "The host could not allocate private ingest storage.", 500);
    }
    const job: YouTubeLocalIngestJob = {
      ingestId,
      runId: `youtube-${suffix}`,
      request,
      sourceDirectory,
      status: "queued",
      updatedAt: this.now().toISOString(),
      source: null,
      failure: null,
    };
    this.jobs.set(ingestId, job);
    setImmediate(() => {
      const processing = this.processingTail.catch(() => undefined).then(() => this.process(job));
      this.processingTail = processing;
      void processing.catch(() => undefined);
    });
    return this.publicStatus(job);
  }

  status(ingestId: string): YouTubeLocalIngestStatus {
    const job = this.jobs.get(ingestId);
    if (!job) throw new RuntimeHostError("unknown_ingest", "The YouTube-local ingest job does not exist.", 404);
    return this.publicStatus(job);
  }

  private transition(job: YouTubeLocalIngestJob, status: YouTubeLocalIngestState): void {
    job.status = status;
    job.updatedAt = this.now().toISOString();
  }

  private fail(job: YouTubeLocalIngestJob, code: YouTubeLocalIngestFailure["code"], message: string): void {
    job.failure = { code, message };
    this.transition(job, "failed");
  }

  private async process(job: YouTubeLocalIngestJob): Promise<void> {
    let resolution: RemoteSourceResolutionReceipt;
    this.transition(job, "resolving");
    try {
      resolution = await this.resolveSource(job.request.url);
      if (job.request.endMs > resolution.source.durationMs) {
        throw new Error("requested range exceeds provider duration");
      }
    } catch {
      this.fail(job, "resolution_failed", "The YouTube URL could not be resolved to a bounded local source.");
      await rm(job.sourceDirectory, { recursive: true, force: true });
      return;
    }

    const rawRelative = "raw/youtube-local.mp4" as const;
    const rawPath = join(job.sourceDirectory, rawRelative);
    this.transition(job, "downloading");
    try {
      await mkdir(resolve(rawPath, ".."), { recursive: true, mode: 0o700 });
      await this.download({
        canonicalUrl: resolution.source.canonicalUrl,
        startMs: job.request.startMs,
        endMs: job.request.endMs,
        outputPath: rawPath,
      });
      const details = await stat(rawPath);
      if (!details.isFile() || details.size < 1) throw new Error("download did not produce a file");
      const realRaw = await realpath(rawPath);
      if (!contained(job.sourceDirectory, realRaw)) throw new Error("download escaped private storage");
    } catch {
      this.fail(job, "download_failed", "The bounded YouTube bytes could not be preserved in private local storage.");
      await rm(job.sourceDirectory, { recursive: true, force: true });
      return;
    }

    this.transition(job, "probing");
    try {
      await executeFile(process.execPath, [
        join(this.repositoryRoot, "scripts", "probe-media.mjs"),
        "--run", job.runId,
        "--directory", job.sourceDirectory,
        "--media", rawRelative,
      ], {
        cwd: this.repositoryRoot,
        timeout: 60_000,
        maxBuffer: 2 * 1024 * 1024,
      });
    } catch {
      this.fail(job, "probe_failed", "The downloaded YouTube bytes could not be measured as media.");
      await rm(job.sourceDirectory, { recursive: true, force: true });
      return;
    }

    this.transition(job, "sealing");
    try {
      const probePath = join(job.sourceDirectory, "media-probe.json");
      const probe = JSON.parse(await readFile(probePath, "utf8")) as MediaProbeReceipt;
      const [raw, probeContent] = await Promise.all([identifyFile(rawPath), identifyFile(probePath)]);
      if (
        probe.schema !== "studio.media-probe.v1" || probe.producer !== "scripts/probe-media.mjs" ||
        probe.run !== job.runId || probe.media !== rawRelative ||
        probe.input.content_id !== raw.contentId || probe.input.bytes !== raw.bytes ||
        !Number.isFinite(probe.duration) || probe.duration <= 0
      ) throw new Error("probe is not bound to downloaded bytes");
      const requestedDurationMs = job.request.endMs - job.request.startMs;
      if (Math.abs(Math.round(probe.duration * 1_000) - requestedDurationMs) > 1_500) {
        throw new Error("downloaded duration does not match requested range");
      }
      const assertedAt = this.now().toISOString();
      const receipt: YouTubeLocalIngestReceipt = {
        schema: "studio.ingest.youtube-local.v1",
        kind: "youtube_local",
        producer: "studio.youtube-local-ingest-host.v1",
        receipt_id: `youtube-local:${raw.digest}`,
        label: resolution.source.label,
        origin: {
          kind: "youtube",
          canonical_url: resolution.source.canonicalUrl,
          external_id: resolution.source.externalId,
          creator: resolution.source.creator,
        },
        resolution: {
          schema: resolution.schema,
          resolution_id: resolution.resolutionId,
          content_id: resolution.content.contentId,
          producer: resolution.producer.id,
          tool: resolution.producer.tool,
        },
        content: indexedContent(raw),
        rights: {
          basis: "operator_local_processing_confirmation",
          asserted_at: assertedAt,
          scope: "local_processing",
          redistribution_allowed: false,
          statement: "The operator confirmed this bounded YouTube selection for local processing only; redistribution is not authorized.",
        },
        selection: {
          provider_start_ms: job.request.startMs,
          provider_end_ms: job.request.endMs,
          local_start: 0,
          local_end: probe.duration,
          duration: probe.duration,
        },
        raw_media: {
          path: rawRelative,
          content_id: raw.contentId,
          bytes: raw.bytes,
          preservation: "provider_bounded_download",
        },
        derived_artifacts: [{
          kind: "media_probe",
          path: "media-probe.json",
          schema: probe.schema,
          producer: probe.producer,
          source_content_ids: [raw.contentId],
          content_hash: probeContent.contentId,
        }],
        note: "Provider metadata and bounded local bytes are separately receipted. No licence, language, identity, or acoustic fact is inferred, and the bytes are never eligible for public/demo publication.",
      };
      const sourcePath = join(job.sourceDirectory, "source.json");
      await writeFile(sourcePath, `${JSON.stringify(receipt, null, 2)}\n`, { flag: "wx", mode: 0o600 });
      const sourceContent = await identifyFile(sourcePath);
      const preflight = {
        schema: "studio.preflight-bundle.v1",
        producer: "studio.youtube-local-preflight.v1",
        preflight_id: `preflight:${raw.contentId}`,
        source: {
          receipt_id: receipt.receipt_id,
          receipt_artifact_id: "source-receipt",
          raw_artifact_id: "raw-media",
        },
        artifacts: [
          { artifact_id: "raw-media", kind: "raw_media", class: "raw", path: rawRelative, content: indexedContent(raw), producer: receipt.producer, source_content_ids: [] },
          { artifact_id: "source-receipt", kind: "source_receipt", class: "receipt", path: "source.json", content: indexedContent(sourceContent), producer: receipt.producer, source_content_ids: [raw.contentId] },
          { artifact_id: "container-probe", kind: "media_probe_receipt", class: "receipt", path: "media-probe.json", content: indexedContent(probeContent), producer: probe.producer, source_content_ids: [raw.contentId] },
        ],
        findings: {
          container_tracks: "container-probe",
          speech_activity: null,
          language_ranges: null,
          acoustic_ranges: null,
          speaker_overlap: null,
          complexity: null,
        },
        note: "Private YouTube-local source-only preflight. It records exact bytes and measured tracks; all detector findings are withheld.",
      } as const;
      await writeFile(join(job.sourceDirectory, "preflight.json"), `${JSON.stringify(preflight, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    } catch {
      this.fail(job, "seal_failed", "The YouTube-local bytes could not be sealed into a source-only preflight receipt.");
      await rm(job.sourceDirectory, { recursive: true, force: true });
      return;
    }

    try {
      job.source = await this.sources.registerDirectory(job.sourceDirectory, { sourceRoot: this.root });
      this.transition(job, "registered");
    } catch {
      this.fail(job, "registration_failed", "The sealed YouTube-local source did not pass host registration validation.");
      await rm(job.sourceDirectory, { recursive: true, force: true });
    }
  }

  private publicStatus(job: YouTubeLocalIngestJob): YouTubeLocalIngestStatus {
    return {
      schema: "studio.youtube-local-ingest.v1",
      ingestId: job.ingestId,
      status: job.status,
      updatedAt: job.updatedAt,
      source: job.source ? structuredClone(job.source) : null,
      failure: job.failure ? { ...job.failure } : null,
    };
  }
}
