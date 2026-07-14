/**
 * Run the owned/local ingest producer and seal its artifacts into an immutable standalone
 * preflight index. This producer adds no speech, language, acoustic, speaker, overlap, identity,
 * or complexity finding.
 *
 *   node scripts/preflight-owned-media.mjs \
 *     --file /path/to/media.mov --run local-001 --label "Interview excerpt" \
 *     --rights-holder "Example Studio" --rights-scope local --attest-rights
 *
 * All owned ingest arguments are forwarded unchanged. `preflight.json` is created with `wx` and
 * is never replaced. If source ingest succeeded but indexing was interrupted, pass
 * `--index-existing --run <id> [--directory <path>]` to seal those existing receipts.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { fingerprintFile } from "./lib/content-id.mjs";
import { normalizeSourceReceipt } from "./lib/source-receipts.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function arg(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 || index === process.argv.length - 1 ? null : process.argv[index + 1];
}

function flag(name) {
  return process.argv.includes(`--${name}`);
}

function fail(message) {
  console.error(`owned media preflight: ${message}`);
  process.exit(1);
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`${path} could not be read as JSON`, { cause: error });
  }
}

function relativePath(value, label) {
  if (
    typeof value !== "string" ||
    !value ||
    isAbsolute(value) ||
    value.split(/[\\/]/).includes("..")
  ) {
    throw new Error(`${label} must stay inside the preflight directory`);
  }
  return value;
}

function expect(value, expected, label) {
  if (value !== expected) throw new Error(`${label} must equal ${expected}`);
}

function content(contentId, bytes) {
  const digest = typeof contentId === "string" && contentId.startsWith("sha256:")
    ? contentId.slice("sha256:".length)
    : "";
  if (!/^[a-f0-9]{64}$/.test(digest) || !Number.isSafeInteger(bytes) || bytes <= 0) {
    throw new Error("artifact content identity must be a non-empty SHA-256 identified file");
  }
  return { id: contentId, hash: { algorithm: "sha256", digest }, bytes };
}

function validateProbeFacts(probe) {
  if (!Number.isFinite(probe.duration) || probe.duration <= 0) {
    throw new Error("mediaProbe.duration must be a positive finite measurement");
  }
  if (!Array.isArray(probe.container) || probe.container.length === 0 || probe.container.some((value) => typeof value !== "string" || !value)) {
    throw new Error("mediaProbe.container must contain measured formats");
  }
  if (!Array.isArray(probe.tracks) || probe.tracks.length === 0) {
    throw new Error("mediaProbe.tracks must contain measured tracks");
  }
  const indexes = new Set();
  for (const track of probe.tracks) {
    if (!Number.isSafeInteger(track?.index) || track.index < 0 || indexes.has(track.index)) {
      throw new Error("mediaProbe.tracks must contain unique non-negative indexes");
    }
    indexes.add(track.index);
    if (typeof track.type !== "string" || !track.type || typeof track.codec !== "string" || !track.codec) {
      throw new Error(`mediaProbe.tracks[${track.index}] must contain type and codec measurements`);
    }
    if (
      track.type === "audio" &&
      (!Number.isFinite(track.sample_rate) || track.sample_rate <= 0 || !Number.isFinite(track.channels) || track.channels <= 0)
    ) {
      throw new Error(`mediaProbe.tracks[${track.index}] has invalid audio measurements`);
    }
    if (
      track.type === "video" &&
      (!Number.isFinite(track.width) || track.width <= 0 || !Number.isFinite(track.height) || track.height <= 0)
    ) {
      throw new Error(`mediaProbe.tracks[${track.index}] has invalid video measurements`);
    }
  }
}

const runId = arg("run");
if (!runId || !/^[a-z0-9-]+$/i.test(runId)) fail("provide --run <preflight-id>");

const directory = arg("directory")
  ? resolve(arg("directory"))
  : join(ROOT, ".studio", "runs", runId);
const outputPath = join(directory, "preflight.json");
if (existsSync(outputPath)) fail(`${outputPath} already exists; refusing to replace the immutable index`);

if (!flag("index-existing")) {
  const forwarded = process.argv.slice(2);
  try {
    execFileSync(process.execPath, [join(ROOT, "scripts", "ingest-owned-media.mjs"), ...forwarded], {
      stdio: "inherit",
    });
  } catch {
    fail("owned ingest did not complete; no preflight index was written");
  }
}

try {
  const sourcePath = join(directory, "source.json");
  const probePath = join(directory, "media-probe.json");
  const source = readJson(sourcePath);
  const probe = readJson(probePath);

  normalizeSourceReceipt(source);
  expect(source.schema, "studio.ingest.owned-local.v1", "source.schema");
  expect(source.kind, "owned_local", "source.kind");
  expect(source.producer, "scripts/ingest-owned-media.mjs", "source.producer");
  expect(probe.schema, "studio.media-probe.v1", "mediaProbe.schema");
  expect(probe.producer, "scripts/probe-media.mjs", "mediaProbe.producer");
  expect(probe.run, runId, "mediaProbe.run");
  validateProbeFacts(probe);

  const rawMedia = relativePath(source.raw_media?.path, "source.raw_media.path");
  const rawPath = join(directory, rawMedia);
  const derived = source.derived_artifacts?.find(
    (artifact) => artifact.kind === "media_probe" && artifact.path === "media-probe.json",
  );
  if (!derived) throw new Error("source.derived_artifacts has no registered media-probe receipt");

  const [rawFingerprint, sourceFingerprint, probeFingerprint] = await Promise.all([
    fingerprintFile(rawPath),
    fingerprintFile(sourcePath),
    fingerprintFile(probePath),
  ]);

  expect(source.content?.id, rawFingerprint.contentId, "source.content.id");
  expect(source.content?.bytes, rawFingerprint.bytes, "source.content.bytes");
  expect(source.receipt_id, `owned-local:${rawFingerprint.digest}`, "source.receipt_id");
  expect(source.raw_media?.content_id, rawFingerprint.contentId, "source.raw_media.content_id");
  expect(source.raw_media?.bytes, rawFingerprint.bytes, "source.raw_media.bytes");
  expect(probe.media, rawMedia, "mediaProbe.media");
  expect(probe.input?.content_id, rawFingerprint.contentId, "mediaProbe.input.content_id");
  expect(probe.input?.bytes, rawFingerprint.bytes, "mediaProbe.input.bytes");
  expect(derived.producer, probe.producer, "source.derived_artifacts.media_probe.producer");
  expect(derived.content_hash, probeFingerprint.contentId, "source.derived_artifacts.media_probe.content_hash");
  if (
    !Array.isArray(derived.source_content_ids) ||
    derived.source_content_ids.length !== 1 ||
    derived.source_content_ids[0] !== rawFingerprint.contentId
  ) {
    throw new Error("source.derived_artifacts.media_probe.source_content_ids must name only the raw content id");
  }

  const bundle = {
    schema: "studio.preflight-bundle.v1",
    producer: "scripts/preflight-owned-media.mjs",
    preflight_id: `preflight:${rawFingerprint.contentId}`,
    source: {
      receipt_id: source.receipt_id,
      receipt_artifact_id: "source-receipt",
      raw_artifact_id: "raw-media",
    },
    artifacts: [
      {
        artifact_id: "raw-media",
        kind: "raw_media",
        class: "raw",
        path: rawMedia,
        content: content(rawFingerprint.contentId, rawFingerprint.bytes),
        producer: source.producer,
        source_content_ids: [],
      },
      {
        artifact_id: "source-receipt",
        kind: "source_receipt",
        class: "receipt",
        path: "source.json",
        content: content(sourceFingerprint.contentId, sourceFingerprint.bytes),
        producer: source.producer,
        source_content_ids: [rawFingerprint.contentId],
      },
      {
        artifact_id: "container-probe",
        kind: "media_probe_receipt",
        class: "receipt",
        path: "media-probe.json",
        content: content(probeFingerprint.contentId, probeFingerprint.bytes),
        producer: probe.producer,
        source_content_ids: [rawFingerprint.contentId],
      },
    ],
    findings: {
      container_tracks: "container-probe",
      speech_activity: null,
      language_ranges: null,
      acoustic_ranges: null,
      speaker_overlap: null,
      complexity: null,
    },
    note:
      "Standalone owned-media preflight index. Only explicit source rights, raw content identity, and ffprobe container/track findings are present; all detector findings are withheld.",
  };

  writeFileSync(outputPath, `${JSON.stringify(bundle, null, 2)}\n`, { flag: "wx" });
  console.log(`owned media preflight wrote ${relative(ROOT, outputPath) || outputPath}`);
} catch (error) {
  fail(error instanceof Error ? error.message : "could not seal preflight artifacts");
}
