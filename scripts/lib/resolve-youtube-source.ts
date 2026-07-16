import { execFile as execFileCallback } from "node:child_process";
import { createHash } from "node:crypto";
import { promisify } from "node:util";

import { canonicalJsonLine } from "../../src/studio/runtime/production/observability/hash.ts";

const execFile = promisify(execFileCallback);
const YOUTUBE_HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"]);
const MAXIMUM_URL_LENGTH = 2_048;
const MAXIMUM_METADATA_BYTES = 16 * 1024 * 1024;
const RESOLUTION_TIMEOUT_MS = 20_000;

export type SourceResolutionErrorCode =
  | "invalid_source"
  | "unsupported_source"
  | "resolver_unavailable"
  | "source_inaccessible"
  | "invalid_resolver_output";

export class SourceResolutionError extends Error {
  readonly code: SourceResolutionErrorCode;
  readonly httpStatus: number;

  constructor(code: SourceResolutionErrorCode, message: string, httpStatus: number, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "SourceResolutionError";
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

export interface RemoteSourceResolutionReceipt {
  schema: "studio.remote-source-resolution.v1";
  resolutionId: string;
  content: {
    algorithm: "sha256";
    digest: string;
    contentId: string;
    bytes: number;
  };
  producer: {
    id: "studio.youtube-metadata-resolver";
    version: "1";
    tool: { id: "yt-dlp"; version: string };
  };
  resolvedAt: string;
  request: { url: string };
  source: {
    kind: "youtube";
    canonicalUrl: string;
    externalId: string;
    label: string;
    creator: string | null;
    durationMs: number;
    durationMeasurement: {
      kind: "provider_metadata";
      field: "duration";
      producer: "yt-dlp";
    };
  };
}

interface CommandResult {
  stdout: string;
  stderr: string;
}

export type SourceResolutionCommand = (
  executable: string,
  args: string[],
) => Promise<CommandResult>;

async function defaultCommand(executable: string, args: string[]): Promise<CommandResult> {
  try {
    const result = await execFile(executable, args, {
      encoding: "utf8",
      maxBuffer: MAXIMUM_METADATA_BYTES,
      timeout: RESOLUTION_TIMEOUT_MS,
      windowsHide: true,
    });
    return { stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    const detail = error as NodeJS.ErrnoException & { killed?: boolean; signal?: string };
    if (detail.code === "ENOENT") {
      throw new SourceResolutionError(
        "resolver_unavailable",
        "The local YouTube metadata resolver is not installed.",
        503,
        error,
      );
    }
    throw new SourceResolutionError(
      "source_inaccessible",
      detail.killed || detail.signal
        ? "YouTube metadata resolution timed out."
        : "YouTube did not return readable metadata for this video.",
      422,
      error,
    );
  }
}

function submittedUrl(raw: string): URL {
  if (typeof raw !== "string" || raw.length === 0 || raw.trim() !== raw || raw.length > MAXIMUM_URL_LENGTH) {
    throw new SourceResolutionError("invalid_source", "Enter one complete YouTube URL.", 400);
  }
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch (error) {
    throw new SourceResolutionError("invalid_source", "Enter one complete YouTube URL.", 400, error);
  }
  if (
    parsed.protocol !== "https:"
    || parsed.username
    || parsed.password
    || parsed.port
    || !YOUTUBE_HOSTS.has(parsed.hostname.toLowerCase())
  ) {
    throw new SourceResolutionError(
      "unsupported_source",
      "Only public HTTPS YouTube video URLs are supported by this resolver.",
      400,
    );
  }
  return parsed;
}

function requiredText(value: unknown, field: string, maximum = 320): string {
  if (typeof value !== "string" || value.length === 0 || value.trim() !== value || value.length > maximum) {
    throw new SourceResolutionError("invalid_resolver_output", `YouTube metadata field ${field} is invalid.`, 502);
  }
  return value;
}

function optionalText(value: unknown, field: string): string | null {
  if (value === null || value === undefined || value === "") return null;
  return requiredText(value, field);
}

function metadataDurationMs(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new SourceResolutionError(
      "invalid_resolver_output",
      "YouTube returned no finite video duration.",
      502,
    );
  }
  const durationMs = Math.round(value * 1_000);
  if (!Number.isSafeInteger(durationMs) || durationMs < 1) {
    throw new SourceResolutionError("invalid_resolver_output", "YouTube video duration is invalid.", 502);
  }
  return durationMs;
}

export async function resolveYouTubeSource(
  raw: string,
  options: {
    command?: SourceResolutionCommand;
    now?: () => Date;
  } = {},
): Promise<RemoteSourceResolutionReceipt> {
  const requested = submittedUrl(raw);
  const command = options.command ?? defaultCommand;
  const versionResult = await command("yt-dlp", ["--version"]);
  const toolVersion = requiredText(versionResult.stdout.trim(), "tool.version", 80);
  const metadataResult = await command("yt-dlp", [
    "--dump-single-json",
    "--skip-download",
    "--no-playlist",
    "--no-warnings",
    requested.toString(),
  ]);

  let metadata: Record<string, unknown>;
  try {
    const parsed = JSON.parse(metadataResult.stdout) as unknown;
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
    metadata = parsed as Record<string, unknown>;
  } catch (error) {
    throw new SourceResolutionError(
      "invalid_resolver_output",
      "YouTube metadata was not valid JSON.",
      502,
      error,
    );
  }

  const externalId = requiredText(metadata.id, "id", 80);
  if (!/^[A-Za-z0-9_-]+$/.test(externalId)) {
    throw new SourceResolutionError("invalid_resolver_output", "YouTube returned an invalid video identity.", 502);
  }
  const resolvedAt = (options.now?.() ?? new Date()).toISOString();
  const producer = {
    id: "studio.youtube-metadata-resolver" as const,
    version: "1" as const,
    tool: { id: "yt-dlp" as const, version: toolVersion },
  };
  const payload = {
    schema: "studio.remote-source-resolution.v1" as const,
    producer,
    resolvedAt,
    request: { url: requested.toString() },
    source: {
      kind: "youtube" as const,
      canonicalUrl: `https://www.youtube.com/watch?v=${externalId}`,
      externalId,
      label: requiredText(metadata.title, "title"),
      creator: optionalText(metadata.channel ?? metadata.uploader, "creator"),
      durationMs: metadataDurationMs(metadata.duration),
      durationMeasurement: {
        kind: "provider_metadata" as const,
        field: "duration" as const,
        producer: "yt-dlp" as const,
      },
    },
  };
  const bytes = Buffer.from(canonicalJsonLine(payload), "utf8");
  const digest = createHash("sha256").update(bytes).digest("hex");
  return {
    ...payload,
    resolutionId: `source-resolution:${digest}`,
    content: {
      algorithm: "sha256",
      digest,
      contentId: `sha256:${digest}`,
      bytes: bytes.byteLength,
    },
  };
}
