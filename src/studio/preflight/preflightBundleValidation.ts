import type {
  PreflightArtifact,
  PreflightBundle,
  PreflightSourceBinding,
} from "./contracts";

const SHA256 = /^[a-f0-9]{64}$/;
const ARTIFACT_ID = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

function fail(context: string, path: string, message: string): never {
  throw new Error(`${context}: ${path} ${message}`);
}

function record(value: unknown, context: string, path: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail(context, path, "must be an object");
  }
  return value as Record<string, unknown>;
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  context: string,
  path: string,
): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    fail(context, path, `must contain exactly ${wanted.join(", ")}`);
  }
}

function list(value: unknown, context: string, path: string): unknown[] {
  if (!Array.isArray(value)) fail(context, path, "must be an array");
  return value;
}

function text(value: unknown, context: string, path: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    fail(context, path, "must be a non-empty string");
  }
  return value;
}

function exact(value: unknown, expected: string, context: string, path: string): void {
  if (text(value, context, path) !== expected) fail(context, path, `must equal ${expected}`);
}

function positiveInteger(value: unknown, context: string, path: string): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    fail(context, path, "must be a positive safe integer");
  }
  return value as number;
}

function contentId(value: unknown, context: string, path: string): string {
  const id = text(value, context, path);
  if (!id.startsWith("sha256:") || !SHA256.test(id.slice("sha256:".length))) {
    fail(context, path, "must be a sha256:<lowercase digest> content id");
  }
  return id;
}

function artifactId(value: unknown, context: string, path: string): string {
  const id = text(value, context, path);
  if (!ARTIFACT_ID.test(id)) fail(context, path, "must be a lowercase kebab-case artifact id");
  return id;
}

function relativeArtifactPath(value: unknown, context: string, path: string): string {
  const candidate = text(value, context, path);
  if (candidate.startsWith("/") || candidate.startsWith("\\") || candidate.split(/[\\/]/).includes("..")) {
    fail(context, path, "must stay inside the preflight directory");
  }
  return candidate;
}

function artifact(value: unknown, context: string, path: string): PreflightArtifact {
  const item = record(value, context, path);
  exactKeys(
    item,
    ["artifact_id", "kind", "class", "path", "content", "producer", "source_content_ids"],
    context,
    path,
  );
  artifactId(item.artifact_id, context, `${path}.artifact_id`);
  const kind = text(item.kind, context, `${path}.kind`);
  if (kind !== "raw_media" && kind !== "source_receipt" && kind !== "media_probe_receipt") {
    fail(context, `${path}.kind`, `has no registered artifact kind ${kind}`);
  }
  const artifactClass = text(item.class, context, `${path}.class`);
  if (artifactClass !== "raw" && artifactClass !== "receipt") {
    fail(context, `${path}.class`, `has no registered artifact class ${artifactClass}`);
  }
  if ((kind === "raw_media") !== (artifactClass === "raw")) {
    fail(context, `${path}.class`, `does not match artifact kind ${kind}`);
  }
  relativeArtifactPath(item.path, context, `${path}.path`);
  const content = record(item.content, context, `${path}.content`);
  exactKeys(content, ["id", "hash", "bytes"], context, `${path}.content`);
  const id = contentId(content.id, context, `${path}.content.id`);
  const hash = record(content.hash, context, `${path}.content.hash`);
  exactKeys(hash, ["algorithm", "digest"], context, `${path}.content.hash`);
  exact(hash.algorithm, "sha256", context, `${path}.content.hash.algorithm`);
  const digest = text(hash.digest, context, `${path}.content.hash.digest`);
  if (!SHA256.test(digest)) fail(context, `${path}.content.hash.digest`, "must be a lowercase SHA-256 digest");
  if (id !== `sha256:${digest}`) fail(context, `${path}.content.id`, "does not match its digest");
  positiveInteger(content.bytes, context, `${path}.content.bytes`);
  text(item.producer, context, `${path}.producer`);
  const sources = list(item.source_content_ids, context, `${path}.source_content_ids`).map((entry, index) =>
    contentId(entry, context, `${path}.source_content_ids[${index}]`),
  );
  if (new Set(sources).size !== sources.length) {
    fail(context, `${path}.source_content_ids`, "must not contain duplicate content ids");
  }
  return value as PreflightArtifact;
}

function oneArtifact(
  artifacts: Map<string, PreflightArtifact>,
  id: unknown,
  kind: PreflightArtifact["kind"],
  context: string,
  path: string,
): PreflightArtifact {
  const reference = artifactId(id, context, path);
  const found = artifacts.get(reference);
  if (!found) fail(context, path, `references missing artifact ${reference}`);
  if (found.kind !== kind) fail(context, path, `must reference a ${kind} artifact`);
  return found;
}

function exactSources(
  artifactValue: PreflightArtifact,
  expected: readonly string[],
  context: string,
  path: string,
): void {
  if (
    artifactValue.source_content_ids.length !== expected.length ||
    artifactValue.source_content_ids.some((id, index) => id !== expected[index])
  ) {
    fail(context, path, `must contain exactly ${expected.join(", ") || "no source content ids"}`);
  }
}

/**
 * Validate an immutable preflight index against normalized facts from its source adapter.
 * Artifact bytes are hashed separately by the CLI and production build.
 */
export function assertPreflightBundle(
  value: unknown,
  binding: PreflightSourceBinding,
  context = "Studio preflight bundle",
): asserts value is PreflightBundle {
  const bundle = record(value, context, "bundle");
  exactKeys(bundle, ["schema", "producer", "preflight_id", "source", "artifacts", "findings", "note"], context, "bundle");
  exact(bundle.schema, "studio.preflight-bundle.v1", context, "bundle.schema");
  exact(bundle.producer, "scripts/preflight-owned-media.mjs", context, "bundle.producer");
  exact(bundle.preflight_id, `preflight:${binding.raw.contentId}`, context, "bundle.preflight_id");
  text(bundle.note, context, "bundle.note");

  const entries = list(bundle.artifacts, context, "bundle.artifacts").map((entry, index) =>
    artifact(entry, context, `bundle.artifacts[${index}]`),
  );
  if (entries.length !== 3) fail(context, "bundle.artifacts", "must contain the exact raw, source, and media-probe artifacts");
  const artifacts = new Map(entries.map((entry) => [entry.artifact_id, entry]));
  if (artifacts.size !== entries.length) fail(context, "bundle.artifacts", "must not contain duplicate artifact ids");
  if (new Set(entries.map((entry) => entry.path)).size !== entries.length) {
    fail(context, "bundle.artifacts", "must not contain duplicate artifact paths");
  }

  const source = record(bundle.source, context, "bundle.source");
  exactKeys(source, ["receipt_id", "receipt_artifact_id", "raw_artifact_id"], context, "bundle.source");
  exact(source.receipt_id, binding.receiptId, context, "bundle.source.receipt_id");
  const raw = oneArtifact(artifacts, source.raw_artifact_id, "raw_media", context, "bundle.source.raw_artifact_id");
  const receipt = oneArtifact(
    artifacts,
    source.receipt_artifact_id,
    "source_receipt",
    context,
    "bundle.source.receipt_artifact_id",
  );
  if (raw.path !== binding.raw.path) fail(context, "bundle.source.raw_artifact_id", "does not reference the receipted raw path");
  if (raw.content.id !== binding.raw.contentId || raw.content.bytes !== binding.raw.bytes) {
    fail(context, "bundle.source.raw_artifact_id", "does not match the receipted raw content");
  }
  if (raw.producer !== binding.raw.producer) fail(context, "bundle.source.raw_artifact_id", "has the wrong raw producer");
  exactSources(raw, [], context, "bundle.source.raw_artifact_id.source_content_ids");
  if (receipt.path !== binding.receiptPath || receipt.producer !== binding.receiptProducer) {
    fail(context, "bundle.source.receipt_artifact_id", "does not match the registered source receipt producer");
  }
  exactSources(receipt, [binding.raw.contentId], context, "bundle.source.receipt_artifact_id.source_content_ids");

  const findings = record(bundle.findings, context, "bundle.findings");
  exactKeys(
    findings,
    ["container_tracks", "speech_activity", "language_ranges", "acoustic_ranges", "speaker_overlap", "complexity"],
    context,
    "bundle.findings",
  );
  const probe = oneArtifact(
    artifacts,
    findings.container_tracks,
    "media_probe_receipt",
    context,
    "bundle.findings.container_tracks",
  );
  if (
    probe.path !== binding.mediaProbe.path ||
    probe.producer !== binding.mediaProbe.producer ||
    probe.content.id !== binding.mediaProbe.contentId
  ) {
    fail(context, "bundle.findings.container_tracks", "does not match the registered media-probe receipt");
  }
  exactSources(probe, [binding.raw.contentId], context, "bundle.findings.container_tracks.source_content_ids");

  for (const key of ["speech_activity", "language_ranges", "acoustic_ranges", "speaker_overlap", "complexity"] as const) {
    if (findings[key] !== null) {
      fail(context, `bundle.findings.${key}`, "has no registered deterministic producer");
    }
  }
}
