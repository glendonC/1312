/**
 * Writes deterministic container and track facts for media already ingested into a run.
 * It does not classify speech, language, music, speakers, overlap, or complexity.
 *
 *   node scripts/probe-media.mjs --run run-006
 *
 * Producer: ffprobe over run.clip.media. Output: media-probe.json beside the run.
 */

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function arg(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 || index === process.argv.length - 1 ? null : process.argv[index + 1];
}

function fail(message) {
  console.error(`media probe: ${message}`);
  process.exit(1);
}

const runId = arg("run");
if (!runId || !/^[a-z0-9-]+$/i.test(runId)) fail("provide --run <recorded-run-id>");

const directory = join(ROOT, "public", "demo", "runs", runId);
const run = JSON.parse(readFileSync(join(directory, "run.json"), "utf8"));
const media = run.clip?.media;
if (typeof media !== "string" || media.length === 0) fail(`${runId} declares no media artifact`);

let raw;
try {
  raw = JSON.parse(
    execFileSync(
      "ffprobe",
      [
        "-v",
        "error",
        "-show_entries",
        "format=duration,format_name:stream=index,codec_type,codec_name,width,height,channels,sample_rate",
        "-of",
        "json",
        join(directory, media),
      ],
      { encoding: "utf8" },
    ),
  );
} catch (error) {
  fail(error instanceof Error ? error.message : "ffprobe failed");
}

const duration = Number(raw.format?.duration);
if (!Number.isFinite(duration) || duration <= 0) fail("ffprobe returned no finite duration");

const tracks = (raw.streams ?? []).map((stream) => {
  const base = {
    index: Number(stream.index),
    type: String(stream.codec_type),
    codec: String(stream.codec_name),
  };
  if (base.type === "video") {
    return { ...base, width: Number(stream.width), height: Number(stream.height) };
  }
  if (base.type === "audio") {
    return { ...base, sample_rate: Number(stream.sample_rate), channels: Number(stream.channels) };
  }
  return base;
});

if (tracks.length === 0) fail("ffprobe returned no media tracks");

const receipt = {
  schema: "studio.media-probe.v1",
  producer: "scripts/probe-media.mjs",
  run: run.id,
  media,
  duration: Number(duration.toFixed(3)),
  container: String(raw.format?.format_name ?? "")
    .split(",")
    .filter(Boolean),
  tracks,
};

writeFileSync(join(directory, "media-probe.json"), `${JSON.stringify(receipt, null, 2)}\n`);
console.log(`media probe wrote ${runId}/media-probe.json with ${tracks.length} track(s)`);
