/**
 * Pulls a real clip into a run folder, and refuses to pull one it has no right to.
 *
 * The product's whole claim is that it studies REAL media, so the demo has to be real media.
 * But a demo is published, and publishing someone else's video is not a technicality — it is
 * the difference between a clip we can stand behind and one we cannot. So the licence check
 * is code, not a promise: this script reads the licence off the source and exits non-zero on
 * anything it is not allowed to redistribute. There is no flag to skip it.
 *
 * What lands in the run folder:
 *   clip.mp4        the real 30-60s window, video and all, because the demo should show it
 *   clip.wav        16k mono, the track the recogniser actually reads
 *   waveform.json   peaks measured off that audio, so the waveform on screen is the signal
 *   source.json     provenance: url, channel, licence, the exact window, the attribution
 *
 * It does NOT write captions, traces or scores. Those have to come from a run that really
 * happened. Real media with invented captions over it would be a worse lie than the synthetic
 * fixture it replaces, because it would look true.
 *
 *   node scripts/ingest-clip.mjs --url <youtube url> --start 00:04:12 --end 00:04:52 --run run-006
 *
 * Requires yt-dlp and ffmpeg.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SR = 16000;
const PEAKS = 420;

/**
 * The only licences we may republish.
 *
 * YouTube reports a Creative Commons upload in this field; everything else — including every
 * ordinary "standard YouTube licence" video, and including anything YouTube Premium lets you
 * save for offline playback — grants no right to host a copy. Premium is a playback licence,
 * not a copyright licence, which is exactly the confusion this check exists to stop.
 */
const REDISTRIBUTABLE = /creative commons/i;

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1 || i === process.argv.length - 1) return fallback;
  return process.argv[i + 1];
}

function die(message) {
  console.error(`\n  ${message}\n`);
  process.exit(1);
}

const url = arg("url");
const start = arg("start");
const end = arg("end");
const run = arg("run");

if (!url || !start || !end || !run) {
  die("usage: node scripts/ingest-clip.mjs --url <url> --start 00:04:12 --end 00:04:52 --run run-006");
}

const RUN = `public/demo/runs/${run}`;

const yt = (args) => execFileSync("yt-dlp", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const ff = (args) => execFileSync("ffmpeg", ["-y", "-loglevel", "error", ...args]);

/* -------------------------------------------------- 1. may we even have this clip */

console.log(`\n  reading ${url}`);

let meta;
try {
  meta = JSON.parse(yt(["-J", "--no-warnings", url]));
} catch {
  die("could not read that video. Is the url right, and is the video public?");
}

const licence = meta.license ?? "(none reported)";
const channel = meta.channel ?? meta.uploader ?? "(unknown)";

console.log(`  title      ${meta.title}`);
console.log(`  channel    ${channel}`);
console.log(`  licence    ${licence}`);

if (!REDISTRIBUTABLE.test(licence)) {
  die(
    [
      `REFUSED: "${licence}" gives no right to republish this clip.`,
      "",
      "  The studio's demo is hosted, so the clip in it is redistributed. That needs the",
      "  copyright holder's permission, and only a Creative Commons upload carries one.",
      "  YouTube Premium does not: it licenses playback in the app, not a copy you can ship.",
      "",
      "  Two ways forward:",
      "    - find a Creative Commons video (YouTube: Filters > Features > Creative Commons)",
      "    - register media you own with scripts/ingest-owned-media.mjs (local by default)",
      "",
      "  For the BENCH, none of this applies: score a hard clip locally and publish the",
      "  numbers, the url and the timestamps. Evidence travels; the media does not have to.",
    ].join("\n"),
  );
}

console.log(`\n  licence allows redistribution with attribution. Pulling ${start} to ${end}.`);

/* -------------------------------------------------- 2. only the window, not the video */

const tmp = mkdtempSync(join(tmpdir(), "1321-ingest-"));
mkdirSync(RUN, { recursive: true });

try {
  // --download-sections fetches the window and nothing else, so we never hold a copy of the
  // whole video. Keyframes are forced at the cuts or the first second decodes as mush.
  yt([
    "--download-sections",
    `*${start}-${end}`,
    "--force-keyframes-at-cuts",
    "-f",
    "bv*[height<=720]+ba/b",
    "--merge-output-format",
    "mp4",
    "--no-warnings",
    "-o",
    join(tmp, "cut.%(ext)s"),
    url,
  ]);

  const cut = join(tmp, "cut.mp4");

  // The video the demo plays.
  ff(["-i", cut, "-c", "copy", `${RUN}/clip.mp4`]);

  // The track the recogniser reads. Mono 16k is what every ASR wants anyway.
  ff(["-i", cut, "-vn", "-ac", "1", "-ar", String(SR), `${RUN}/clip.wav`]);

  /* ------------------------------------------------ 3. the waveform is the real signal */

  const raw = join(tmp, "raw.pcm");
  ff(["-i", `${RUN}/clip.wav`, "-f", "s16le", "-ac", "1", "-ar", String(SR), raw]);

  const pcm = readFileSync(raw);
  const duration = Number((pcm.length / 2 / SR).toFixed(2));
  const bucket = Math.floor(pcm.length / 2 / PEAKS);
  const peaks = [];

  for (let i = 0; i < PEAKS; i += 1) {
    let peak = 0;
    for (let j = 0; j < bucket; j += 1) {
      const v = Math.abs(pcm.readInt16LE((i * bucket + j) * 2)) / 32768;
      if (v > peak) peak = v;
    }
    peaks.push(peak);
  }

  const ceiling = Math.max(...peaks) || 1;
  const norm = peaks.map((p) => Number(Math.min(1, p / ceiling).toFixed(3)));

  writeFileSync(
    `${RUN}/waveform.json`,
    `${JSON.stringify({ clip: run, duration, peaks: norm }, null, 2)}\n`,
  );

  /* ------------------------------------------------ 4. where it came from, on the record */

  const source = {
    kind: "youtube",
    label: meta.title,
    channel,
    url,
    video_id: meta.id,
    licence,
    window: { start, end },
    duration,
    attribution: `"${meta.title}" by ${channel}, used under ${licence}.`,
    note: "Real media. Redistributed under the uploader's Creative Commons licence, credited on screen. Captions, traces and scores for this clip come from a run that actually happened, or they do not exist.",
  };

  writeFileSync(`${RUN}/source.json`, `${JSON.stringify(source, null, 2)}\n`);

  console.log(`
  ${RUN}/clip.mp4        the window, video and audio
  ${RUN}/clip.wav        ${duration}s, ${SR}Hz mono, for the recogniser
  ${RUN}/waveform.json   ${norm.length} peaks measured off that audio
  ${RUN}/source.json     provenance and the attribution to print

  Next: run the pipeline over clip.wav. Nothing writes captions for this clip until a run does.
`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
