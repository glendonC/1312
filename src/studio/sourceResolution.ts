import { canonicalJsonLine, identifyUtf8 } from "./runtime/production/observability/hash.ts";

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

type SourceResolutionFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export class SourceResolutionClientError extends Error {
  readonly code: string;
  readonly httpStatus: number | null;

  constructor(message: string, code: string, httpStatus: number | null = null) {
    super(message);
    this.name = "SourceResolutionClientError";
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

function fail(message: string): never {
  throw new SourceResolutionClientError(message, "invalid_resolution_receipt");
}

function object(value: unknown, context: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail(`${context} is not an object.`);
  return value as Record<string, unknown>;
}

function exact(item: Record<string, unknown>, fields: readonly string[], context: string): void {
  const expected = new Set(fields);
  for (const key of Object.keys(item)) if (!expected.has(key)) fail(`${context}.${key} is not allowed.`);
  for (const field of fields) if (!(field in item)) fail(`${context}.${field} is required.`);
}

function text(value: unknown, context: string, maximum = 320): string {
  if (typeof value !== "string" || value.length === 0 || value.trim() !== value || value.length > maximum) {
    fail(`${context} is invalid.`);
  }
  return value;
}

function safeDuration(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) fail("Source resolution duration is invalid.");
  return value as number;
}

function validYouTubeUrl(value: unknown, context: string): string {
  const raw = text(value, context, 2_048);
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return fail(`${context} is not a URL.`);
  }
  if (url.protocol !== "https:" || !new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"]).has(url.hostname)) {
    fail(`${context} is not a supported YouTube URL.`);
  }
  return url.toString();
}

export async function validateRemoteSourceResolution(value: unknown): Promise<RemoteSourceResolutionReceipt> {
  const item = object(value, "Source resolution");
  exact(item, ["schema", "resolutionId", "content", "producer", "resolvedAt", "request", "source"], "Source resolution");
  if (item.schema !== "studio.remote-source-resolution.v1") fail("Source resolution schema is unsupported.");

  const producer = object(item.producer, "Source resolution producer");
  exact(producer, ["id", "version", "tool"], "Source resolution producer");
  if (producer.id !== "studio.youtube-metadata-resolver" || producer.version !== "1") {
    fail("Source resolution producer is unsupported.");
  }
  const tool = object(producer.tool, "Source resolution tool");
  exact(tool, ["id", "version"], "Source resolution tool");
  if (tool.id !== "yt-dlp") fail("Source resolution tool is unsupported.");
  const toolVersion = text(tool.version, "Source resolution tool version", 80);

  const request = object(item.request, "Source resolution request");
  exact(request, ["url"], "Source resolution request");
  const requestUrl = validYouTubeUrl(request.url, "Source resolution request URL");

  const source = object(item.source, "Resolved source");
  exact(source, [
    "kind",
    "canonicalUrl",
    "externalId",
    "label",
    "creator",
    "durationMs",
    "durationMeasurement",
  ], "Resolved source");
  if (source.kind !== "youtube") fail("Resolved source kind is unsupported.");
  const externalId = text(source.externalId, "Resolved source identity", 80);
  if (!/^[A-Za-z0-9_-]+$/.test(externalId)) fail("Resolved source identity is invalid.");
  const canonicalUrl = validYouTubeUrl(source.canonicalUrl, "Resolved source canonical URL");
  if (canonicalUrl !== `https://www.youtube.com/watch?v=${externalId}`) {
    fail("Resolved source canonical URL does not match its identity.");
  }
  const creator = source.creator === null ? null : text(source.creator, "Resolved source creator");
  const measurement = object(source.durationMeasurement, "Duration measurement");
  exact(measurement, ["kind", "field", "producer"], "Duration measurement");
  if (
    measurement.kind !== "provider_metadata"
    || measurement.field !== "duration"
    || measurement.producer !== "yt-dlp"
  ) fail("Duration measurement is unsupported.");

  const resolvedAt = text(item.resolvedAt, "Source resolution timestamp", 40);
  const parsedTimestamp = new Date(resolvedAt);
  if (!Number.isFinite(parsedTimestamp.getTime()) || parsedTimestamp.toISOString() !== resolvedAt) {
    fail("Source resolution timestamp is invalid.");
  }

  const payload = {
    schema: "studio.remote-source-resolution.v1" as const,
    producer: {
      id: "studio.youtube-metadata-resolver" as const,
      version: "1" as const,
      tool: { id: "yt-dlp" as const, version: toolVersion },
    },
    resolvedAt,
    request: { url: requestUrl },
    source: {
      kind: "youtube" as const,
      canonicalUrl,
      externalId,
      label: text(source.label, "Resolved source label"),
      creator,
      durationMs: safeDuration(source.durationMs),
      durationMeasurement: {
        kind: "provider_metadata" as const,
        field: "duration" as const,
        producer: "yt-dlp" as const,
      },
    },
  };
  const identity = await identifyUtf8(canonicalJsonLine(payload));
  const content = object(item.content, "Source resolution content");
  exact(content, ["algorithm", "digest", "contentId", "bytes"], "Source resolution content");
  if (
    content.algorithm !== identity.algorithm
    || content.digest !== identity.digest
    || content.contentId !== identity.contentId
    || content.bytes !== identity.bytes
    || item.resolutionId !== `source-resolution:${identity.digest}`
  ) fail("Source resolution content identity does not match its receipt.");

  return {
    ...payload,
    resolutionId: `source-resolution:${identity.digest}`,
    content: identity,
  };
}

export async function resolveRemoteSource(
  url: string,
  fetcher: SourceResolutionFetch = fetch,
): Promise<RemoteSourceResolutionReceipt> {
  let response: Response;
  try {
    response = await fetcher("/api/studio/source-resolutions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });
  } catch (error) {
    throw new SourceResolutionClientError(
      "The source metadata resolver could not be reached.",
      "resolver_unavailable",
      null,
    );
  }
  const body = await response.json().catch(() => null) as unknown;
  if (!response.ok) {
    const errorItem = body && typeof body === "object" && !Array.isArray(body)
      ? (body as { error?: unknown }).error
      : null;
    const detail = errorItem && typeof errorItem === "object" && !Array.isArray(errorItem)
      ? errorItem as { code?: unknown; message?: unknown }
      : null;
    throw new SourceResolutionClientError(
      typeof detail?.message === "string" ? detail.message : `Source resolution failed with HTTP ${response.status}.`,
      typeof detail?.code === "string" ? detail.code : "source_resolution_failed",
      response.status,
    );
  }
  return validateRemoteSourceResolution(body);
}
