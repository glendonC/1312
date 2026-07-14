/**
 * Writes deterministic container and track facts for media already ingested into a run or local
 * preflight directory. It does not classify speech, language, music, speakers, overlap, identity,
 * ownership, or complexity.
 *
 *   node scripts/probe-media.mjs --run run-006
 *   node scripts/probe-media.mjs --run local-001 --directory .studio/runs/local-001 --media raw.mp4
 *   node scripts/probe-media.mjs --run run-006 --replace   # explicit receipt refresh
 *
 * Producer: ffprobe over the exact hashed media bytes. Output: media-probe.json beside the media.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { fingerprintFile } from "./lib/content-id.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function arg(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 || index === process.argv.length - 1 ? null : process.argv[index + 1];
}

function flag(name) {
  return process.argv.includes(`--${name}`);
}

function fail(message) {
  console.error(`media probe: ${message}`);
  process.exit(1);
}

function finite(value) {
  if ((typeof value !== "number" && typeof value !== "string") || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

const runId = arg("run");
if (!runId || !/^[a-z0-9-]+$/i.test(runId)) fail("provide --run <recorded-run-id>");

const requestedDirectory = arg("directory");
const directory = requestedDirectory
  ? resolve(requestedDirectory)
  : join(ROOT, "public", "demo", "runs", runId);
const runPath = join(directory, "run.json");
const outputPath = join(directory, "media-probe.json");
if (existsSync(outputPath) && !flag("replace")) fail(`${outputPath} already exists; pass --replace to refresh it explicitly`);
const run = existsSync(runPath) ? JSON.parse(readFileSync(runPath, "utf8")) : null;
if (run && run.id !== runId) fail(`${runPath} does not declare run ${runId}`);

const requestedMedia = arg("media");
const media = requestedMedia ?? run?.clip?.media;
if (typeof media !== "string" || media.length === 0) {
  fail(`${runId} declares no media artifact; pass --media for a preflight-only directory`);
}
if (isAbsolute(media) || media.split(/[\\/]/).includes("..")) fail("media must be a relative path inside the run directory");
if (run?.clip?.media && requestedMedia && requestedMedia !== run.clip.media) {
  fail(`--media does not match ${runId} run.clip.media`);
}

const mediaPath = join(directory, media);
let fingerprint;
try {
  fingerprint = await fingerprintFile(mediaPath);
} catch (error) {
  fail(error instanceof Error ? error.message : "could not fingerprint media");
}

let raw;
try {
  raw = JSON.parse(
    execFileSync(
      "ffprobe",
      [
        "-v",
        "error",
        "-show_entries",
        "format=duration,format_name,format_long_name,size,bit_rate:stream=index,codec_type,codec_name,width,height,channels,sample_rate,duration",
        "-of",
        "json",
        mediaPath,
      ],
      { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
    ),
  );
} catch (error) {
  fail(error instanceof Error ? error.message : "ffprobe failed");
}

const duration = finite(raw.format?.duration);
if (duration === null || duration <= 0) fail("ffprobe returned no finite duration");

const container = String(raw.format?.format_name ?? "")
  .split(",")
  .filter(Boolean);
if (container.length === 0) fail("ffprobe returned no container format");

const tracks = (raw.streams ?? []).map((stream) => {
  const index = finite(stream.index);
  const type = typeof stream.codec_type === "string" ? stream.codec_type : "";
  const codec = typeof stream.codec_name === "string" ? stream.codec_name : "";
  if (index === null || !Number.isInteger(index) || index < 0 || !type || !codec) fail("ffprobe returned an invalid media track");

  const base = {
    index,
    type,
    codec,
    ...(finite(stream.duration) !== null ? { duration: Number(finite(stream.duration).toFixed(3)) } : {}),
  };
  if (type === "video") {
    const width = finite(stream.width);
    const height = finite(stream.height);
    if (width === null || width <= 0 || height === null || height <= 0) fail(`video track ${index} has invalid dimensions`);
    return { ...base, width, height };
  }
  if (type === "audio") {
    const sampleRate = finite(stream.sample_rate);
    const channels = finite(stream.channels);
    if (sampleRate === null || sampleRate <= 0 || channels === null || channels <= 0) {
      fail(`audio track ${index} has invalid sample metadata`);
    }
    return { ...base, sample_rate: sampleRate, channels };
  }
  return base;
});

if (tracks.length === 0) fail("ffprobe returned no media tracks");
if (new Set(tracks.map((track) => track.index)).size !== tracks.length) fail("ffprobe returned duplicate track indexes");

const declaredDuration = finite(run?.clip?.duration);
if (declaredDuration !== null && Math.abs(duration - declaredDuration) > 0.15) {
  fail(`ffprobe duration ${duration.toFixed(3)} does not match run.clip.duration ${declaredDuration}`);
}

const receipt = {
  schema: "studio.media-probe.v1",
  producer: "scripts/probe-media.mjs",
  run: runId,
  media,
  input: {
    content_id: fingerprint.contentId,
    hash: { algorithm: fingerprint.algorithm, digest: fingerprint.digest },
    bytes: fingerprint.bytes,
  },
  duration: Number(duration.toFixed(3)),
  container,
  container_long_name: String(raw.format?.format_long_name ?? ""),
  bit_rate: finite(raw.format?.bit_rate),
  tracks,
};

writeFileSync(outputPath, `${JSON.stringify(receipt, null, 2)}\n`, { flag: "w" });
console.log(`media probe wrote ${outputPath} with ${tracks.length} track(s)`);
