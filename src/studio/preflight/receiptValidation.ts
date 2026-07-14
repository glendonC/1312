import type { IngestReceipt, MediaProbeReceipt, OwnedLocalIngestReceipt } from "../types";

const SHA256 = /^[a-f0-9]{64}$/;
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

export interface SourceReceiptContext {
  runId: string;
  duration: number;
  media: string | null;
  source: Record<string, unknown>;
}

function fail(context: string, path: string, message: string): never {
  throw new Error(`${context}: ${path} ${message}`);
}

function record(value: unknown, context: string, path: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail(context, path, "must be an object");
  return value as Record<string, unknown>;
}

function list(value: unknown, context: string, path: string): unknown[] {
  if (!Array.isArray(value)) fail(context, path, "must be an array");
  return value;
}

function text(value: unknown, context: string, path: string): string {
  if (typeof value !== "string" || value.trim().length === 0) fail(context, path, "must be a non-empty string");
  return value;
}

function finite(value: unknown, context: string, path: string, min = 0): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min) {
    fail(context, path, `must be finite and at least ${min}`);
  }
  return value;
}

function positiveInteger(value: unknown, context: string, path: string): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) fail(context, path, "must be a positive safe integer");
  return value as number;
}

function relativeArtifactPath(value: unknown, context: string, path: string): string {
  const candidate = text(value, context, path);
  if (candidate.startsWith("/") || candidate.startsWith("\\") || candidate.split(/[\\/]/).includes("..")) {
    fail(context, path, "must stay inside the run directory");
  }
  return candidate;
}

function sha256(value: unknown, context: string, path: string): string {
  const digest = text(value, context, path);
  if (!SHA256.test(digest)) fail(context, path, "must be a lowercase SHA-256 digest");
  return digest;
}

function contentId(value: unknown, context: string, path: string): string {
  const id = text(value, context, path);
  if (!id.startsWith("sha256:") || !SHA256.test(id.slice("sha256:".length))) {
    fail(context, path, "must be a sha256:<lowercase digest> content id");
  }
  return id;
}

function exact(value: unknown, expected: string, context: string, path: string): void {
  if (text(value, context, path) !== expected) fail(context, path, `must equal ${expected}`);
}

function closeDuration(value: unknown, expected: number, context: string, path: string): number {
  const duration = finite(value, context, path);
  if (Math.abs(duration - expected) > 0.15) fail(context, path, "does not match run.clip.duration");
  return duration;
}

function validateProbe(value: unknown, source: SourceReceiptContext, context: string): MediaProbeReceipt | null {
  if (value == null) return null;
  const probe = record(value, context, "mediaProbe");
  exact(probe.schema, "studio.media-probe.v1", context, "mediaProbe.schema");
  exact(probe.producer, "scripts/probe-media.mjs", context, "mediaProbe.producer");
  exact(probe.run, source.runId, context, "mediaProbe.run");
  const media = relativeArtifactPath(probe.media, context, "mediaProbe.media");
  if (media !== source.media) fail(context, "mediaProbe.media", "does not match run.clip.media");

  const input = record(probe.input, context, "mediaProbe.input");
  const id = contentId(input.content_id, context, "mediaProbe.input.content_id");
  const hash = record(input.hash, context, "mediaProbe.input.hash");
  exact(hash.algorithm, "sha256", context, "mediaProbe.input.hash.algorithm");
  const digest = sha256(hash.digest, context, "mediaProbe.input.hash.digest");
  if (id !== `sha256:${digest}`) fail(context, "mediaProbe.input.content_id", "does not match its digest");
  positiveInteger(input.bytes, context, "mediaProbe.input.bytes");

  closeDuration(probe.duration, source.duration, context, "mediaProbe.duration");
  const containers = list(probe.container, context, "mediaProbe.container");
  if (containers.length === 0) fail(context, "mediaProbe.container", "must not be empty");
  containers.forEach((entry, index) => text(entry, context, `mediaProbe.container[${index}]`));
  if (typeof probe.container_long_name !== "string") fail(context, "mediaProbe.container_long_name", "must be a string");
  if (probe.bit_rate !== null) finite(probe.bit_rate, context, "mediaProbe.bit_rate");

  const trackIndexes = new Set<number>();
  const tracks = list(probe.tracks, context, "mediaProbe.tracks");
  if (tracks.length === 0) fail(context, "mediaProbe.tracks", "must not be empty");
  tracks.forEach((entry, index) => {
    const track = record(entry, context, `mediaProbe.tracks[${index}]`);
    const trackIndex = finite(track.index, context, `mediaProbe.tracks[${index}].index`);
    if (!Number.isInteger(trackIndex)) fail(context, `mediaProbe.tracks[${index}].index`, "must be an integer");
    if (trackIndexes.has(trackIndex)) fail(context, `mediaProbe.tracks[${index}].index`, `duplicates ${trackIndex}`);
    trackIndexes.add(trackIndex);
    const trackType = text(track.type, context, `mediaProbe.tracks[${index}].type`);
    text(track.codec, context, `mediaProbe.tracks[${index}].codec`);
    if (track.duration !== undefined) finite(track.duration, context, `mediaProbe.tracks[${index}].duration`);
    if (trackType === "video") {
      finite(track.width, context, `mediaProbe.tracks[${index}].width`, 1);
      finite(track.height, context, `mediaProbe.tracks[${index}].height`, 1);
    }
    if (trackType === "audio") {
      finite(track.sample_rate, context, `mediaProbe.tracks[${index}].sample_rate`, 1);
      finite(track.channels, context, `mediaProbe.tracks[${index}].channels`, 1);
    }
  });

  return value as MediaProbeReceipt;
}

function validateOwnedLocal(
  receipt: Record<string, unknown>,
  probe: MediaProbeReceipt | null,
  source: SourceReceiptContext,
  context: string,
): OwnedLocalIngestReceipt {
  exact(receipt.schema, "studio.ingest.owned-local.v1", context, "ingestReceipt.schema");
  exact(receipt.producer, "scripts/ingest-owned-media.mjs", context, "ingestReceipt.producer");
  text(receipt.label, context, "ingestReceipt.label");

  const origin = record(receipt.origin, context, "ingestReceipt.origin");
  exact(origin.kind, "local_file", context, "ingestReceipt.origin.kind");
  const filename = text(origin.filename, context, "ingestReceipt.origin.filename");
  if (filename.includes("/") || filename.includes("\\")) {
    fail(context, "ingestReceipt.origin.filename", "must be a basename without local path disclosure");
  }
  exact(origin.path_disclosure, "basename_only", context, "ingestReceipt.origin.path_disclosure");

  const content = record(receipt.content, context, "ingestReceipt.content");
  const id = contentId(content.id, context, "ingestReceipt.content.id");
  const hash = record(content.hash, context, "ingestReceipt.content.hash");
  exact(hash.algorithm, "sha256", context, "ingestReceipt.content.hash.algorithm");
  const digest = sha256(hash.digest, context, "ingestReceipt.content.hash.digest");
  if (id !== `sha256:${digest}`) fail(context, "ingestReceipt.content.id", "does not match its digest");
  const bytes = positiveInteger(content.bytes, context, "ingestReceipt.content.bytes");
  if (receipt.receipt_id !== `owned-local:${digest}`) {
    fail(context, "ingestReceipt.receipt_id", "does not match the stable content digest");
  }

  const rights = record(receipt.rights, context, "ingestReceipt.rights");
  exact(rights.basis, "ownership_attestation", context, "ingestReceipt.rights.basis");
  const assertedBy = text(rights.asserted_by, context, "ingestReceipt.rights.asserted_by");
  const assertedAt = text(rights.asserted_at, context, "ingestReceipt.rights.asserted_at");
  if (!ISO_INSTANT.test(assertedAt) || !Number.isFinite(Date.parse(assertedAt))) {
    fail(context, "ingestReceipt.rights.asserted_at", "must be an ISO-8601 UTC instant");
  }
  const scope = text(rights.scope, context, "ingestReceipt.rights.scope");
  if (scope !== "local_processing" && scope !== "redistribution") {
    fail(context, "ingestReceipt.rights.scope", "must be local_processing or redistribution");
  }
  const statement = text(rights.statement, context, "ingestReceipt.rights.statement");
  if (!statement.includes(assertedBy) || !statement.includes("owns or controls")) {
    fail(context, "ingestReceipt.rights.statement", "must carry the explicit ownership attestation");
  }

  const selection = record(receipt.selection, context, "ingestReceipt.selection");
  const start = finite(selection.start, context, "ingestReceipt.selection.start");
  const end = finite(selection.end, context, "ingestReceipt.selection.end");
  const duration = closeDuration(selection.duration, source.duration, context, "ingestReceipt.selection.duration");
  if (start !== 0 || Math.abs(end - duration) > 0.001) {
    fail(context, "ingestReceipt.selection", "must cover the exact full local file");
  }

  const raw = record(receipt.raw_media, context, "ingestReceipt.raw_media");
  const rawPath = relativeArtifactPath(raw.path, context, "ingestReceipt.raw_media.path");
  if (rawPath !== source.media) fail(context, "ingestReceipt.raw_media.path", "does not match run.clip.media");
  if (contentId(raw.content_id, context, "ingestReceipt.raw_media.content_id") !== id) {
    fail(context, "ingestReceipt.raw_media.content_id", "does not match the source content id");
  }
  if (positiveInteger(raw.bytes, context, "ingestReceipt.raw_media.bytes") !== bytes) {
    fail(context, "ingestReceipt.raw_media.bytes", "does not match the source byte count");
  }
  const preservation = text(raw.preservation, context, "ingestReceipt.raw_media.preservation");
  if (preservation !== "byte_identical_copy" && preservation !== "adopted_existing_bytes") {
    fail(context, "ingestReceipt.raw_media.preservation", "has no registered preservation method");
  }

  if (!probe) fail(context, "mediaProbe", "is required for owned local media");
  if (probe.input.content_id !== id || probe.input.bytes !== bytes) {
    fail(context, "mediaProbe.input", "does not match the owned raw media receipt");
  }

  const derived = list(receipt.derived_artifacts, context, "ingestReceipt.derived_artifacts");
  if (derived.length !== 1) fail(context, "ingestReceipt.derived_artifacts", "must contain the exact media probe receipt");
  const artifact = record(derived[0], context, "ingestReceipt.derived_artifacts[0]");
  exact(artifact.kind, "media_probe", context, "ingestReceipt.derived_artifacts[0].kind");
  exact(artifact.path, "media-probe.json", context, "ingestReceipt.derived_artifacts[0].path");
  exact(artifact.schema, probe.schema, context, "ingestReceipt.derived_artifacts[0].schema");
  exact(artifact.producer, probe.producer, context, "ingestReceipt.derived_artifacts[0].producer");
  const inputs = list(artifact.source_content_ids, context, "ingestReceipt.derived_artifacts[0].source_content_ids");
  if (inputs.length !== 1 || contentId(inputs[0], context, "ingestReceipt.derived_artifacts[0].source_content_ids[0]") !== id) {
    fail(context, "ingestReceipt.derived_artifacts[0].source_content_ids", "must name only the raw source content id");
  }
  contentId(artifact.content_hash, context, "ingestReceipt.derived_artifacts[0].content_hash");
  text(receipt.note, context, "ingestReceipt.note");
  return receipt as unknown as OwnedLocalIngestReceipt;
}

/** Validate registered receipt variants and their cross-receipt provenance. */
export function assertSourceReceipts(
  ingestValue: unknown,
  probeValue: unknown,
  source: SourceReceiptContext,
  context: string,
): asserts ingestValue is IngestReceipt | null {
  const probe = validateProbe(probeValue, source, context);
  if (ingestValue == null) return;
  const receipt = record(ingestValue, context, "ingestReceipt");
  const kind = text(receipt.kind, context, "ingestReceipt.kind");

  if (kind === "youtube") {
    text(receipt.label, context, "ingestReceipt.label");
    text(receipt.channel, context, "ingestReceipt.channel");
    const url = text(receipt.url, context, "ingestReceipt.url");
    text(receipt.video_id, context, "ingestReceipt.video_id");
    const licence = text(receipt.licence, context, "ingestReceipt.licence");
    const window = record(receipt.window, context, "ingestReceipt.window");
    text(window.start, context, "ingestReceipt.window.start");
    text(window.end, context, "ingestReceipt.window.end");
    closeDuration(receipt.duration, source.duration, context, "ingestReceipt.duration");
    text(receipt.attribution, context, "ingestReceipt.attribution");
    text(receipt.note, context, "ingestReceipt.note");
    if (source.source.url !== url) fail(context, "ingestReceipt.url", "does not match run.clip.source.url");
    if (source.source.licence !== licence) {
      fail(context, "ingestReceipt.licence", "does not match run.clip.source.licence");
    }
    if (source.source.kind !== "youtube") fail(context, "run.clip.source.kind", "does not match the YouTube receipt");
    return;
  }

  if (kind === "owned_local") {
    if (source.source.kind !== "owned_local") fail(context, "run.clip.source.kind", "does not match the owned local receipt");
    validateOwnedLocal(receipt, probe, source, context);
    return;
  }

  fail(context, "ingestReceipt.kind", `has no registered producer for ${kind}`);
}
