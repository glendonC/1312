/**
 * Builds the synthetic demo clip for ko-clip-01.
 *
 * The clip is scripted and voiced with macOS TTS. The cast is fictional and no real
 * person is involved. It exists so the eight ko->en failure modes in the build log have
 * known answers a judge can check by ear: a real 240ms pause inside c04, a real breath
 * splitting the contrast in c10, two speakers genuinely overlapping in c14, music at
 * negative speech SNR, and a tail that is real digital silence.
 *
 * The AUDIO is the source of truth. Speech is never stretched to fit a caption; the
 * timeline is laid out from measured speech durations, and the cue windows in
 * captions.json and run.json are rewritten from that layout. Captions cannot drift away
 * from the audio because they are derived from it.
 *
 * Anchors that are NOT free to move (they are published in the build log):
 *   c08          18.20 - 21.00   the homophone miss first logged in run-002
 *   music onset  30.00
 *   silent tail  44.60 - 47.20
 *
 *   node scripts/build-demo-clip.mjs
 *
 * Requires macOS `say` and `ffmpeg`.
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const RUN = "public/demo/runs/run-005";
const DURATION = 47.2;
const PEAKS = 420;
const SR = 16000;

const C08_AT = 18.2;
const C08_END = 21.0;
const MUSIC_AT = 30.0;
const MUSIC_END = 41.0;
const LAUGH_AT = 33.4;
const TAIL_AT = 44.6;

/** Voice names collide across languages, so the Korean voices must be fully qualified. */
const VOICE = { s1: "Rocko (Korean (South Korea))", s2: "Yuna" };
/** The host talks like a variety host. The guest does not. */
const RATE = { s1: 225, s2: 190 };

const GAP = 0.34;
/** The entire c04 hard line is this gap. Lose it and 네 + 다섯 becomes 네다섯. */
const PAUSE_C04 = 0.24;
/** A real breath. A VAD splits here, and the contrast gets cut in half. */
const BREATH_C10 = 0.25;
/** He is still talking when she cuts in. */
const OVERLAP_C14 = -0.5;

const TAKES = [
  { id: "c01", who: "s1", text: "자, 오늘 게스트 모셨습니다. 다은 씨." },
  { id: "c02", who: "s2", text: "안녕하세요, 다은입니다." },
  { id: "c03", who: "s1", text: "팀 나오고 첫 방송이시죠? 그때 멤버가 몇 명이었어요?" },
  { id: "c04", who: "s2", text: "네", part: "a" },
  { id: "c04", who: "s2", text: "다섯 명이요.", part: "b", gap: PAUSE_C04 },
  { id: "c05", who: "s1", text: "다섯 명. 그중에 끝까지 남은 사람은요?" },
  { id: "c06", who: "s2", text: "저랑 준호 오빠요." },

  { id: "c08", who: "s2", text: "근데 그때부터 사랑이 식은 거죠, 뭐.", at: C08_AT },
  { id: "c09", who: "s1", text: "그때 왜 해명 안 하셨어요?" },
  { id: "c10", who: "s2", text: "못 한 게 아니라", part: "a" },
  { id: "c10", who: "s2", text: "안 한 거예요.", part: "b", gap: BREATH_C10 },
  { id: "c11", who: "s2", text: "말하면 더 커지잖아요." },

  // She trails off under the music. Quiet on purpose: this is the withheld line.
  { id: "c12", who: "s2", text: "지금은, 뭐, 괜찮아요.", at: MUSIC_AT, gain: 0.4 },
  { id: "c13", who: "s1", text: "괜찮긴 뭐가 괜찮아요.", gain: 0.75 },
  { id: "c14", who: "s1", text: "그럼 다시 모이면", part: "a", gain: 0.85 },
  { id: "c14", who: "s2", text: "아니요, 그건 아니고요.", part: "b", gap: OVERLAP_C14, gain: 0.9 },
  { id: "c15", who: "s1", text: "알겠습니다. 마지막으로 한마디만." },
  { id: "c16", who: "s2", text: "기다려 주신 분들께 진심으로 감사합니다." },
];

const ff = (args) => execFileSync("ffmpeg", ["-y", "-loglevel", "error", ...args]);
const probe = (f) =>
  Number(
    execFileSync("ffprobe", [
      "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", f,
    ]).toString().trim(),
  );

const tmp = mkdtempSync(join(tmpdir(), "koclip-"));

try {
  // 1. Voice every take and measure what it naturally is.
  TAKES.forEach((take, i) => {
    const aiff = join(tmp, `${i}.aiff`);
    take.wav = join(tmp, `${i}.wav`);
    execFileSync("say", ["-v", VOICE[take.who], "-r", String(RATE[take.who]), "-o", aiff, take.text]);
    ff(["-i", aiff, "-ac", "1", "-ar", String(SR), take.wav]);
    take.dur = probe(take.wav);
  });

  // 2. Lay the timeline out from the measured speech, honouring the fixed anchors.
  //    A take with `at` is pinned. Everything else follows the one before it.
  let cursor = 0;
  for (const take of TAKES) {
    if (take.at !== undefined) cursor = take.at;
    else cursor += take.gap ?? GAP;
    take.start = cursor;
    cursor += take.dur;
  }

  // 3. The stretch before c08 is the only place speech can collide with an anchor.
  //    If it overruns, compress that stretch just enough to leave an honest beat of silence.
  const BEAT = 0.8;
  const pre = TAKES.filter((t) => t.start < C08_AT);
  const preEnd = Math.max(...pre.map((t) => t.start + t.dur));
  const budget = C08_AT - BEAT;

  if (preEnd > budget) {
    const squeeze = preEnd / budget;
    if (squeeze > 1.2) throw new Error(`pre-c08 speech needs ${squeeze.toFixed(2)}x; shorten a line`);

    let c = 0;
    for (const take of pre) {
      take.tempo = squeeze;
      take.dur /= squeeze;
      c += take === pre[0] ? 0 : (take.gap ?? GAP);
      take.start = c;
      c += take.dur;
    }
    console.log(`pre-c08 compressed ${squeeze.toFixed(3)}x to clear the ${BEAT}s beat`);
  }

  // c08 is published as 18.20 - 21.00, so it gets exactly that window.
  const c08 = TAKES.find((t) => t.id === "c08");
  if (c08.dur > C08_END - C08_AT) {
    c08.tempo = c08.dur / (C08_END - C08_AT);
    c08.dur = C08_END - C08_AT;
  }

  const lastEnd = Math.max(...TAKES.map((t) => t.start + t.dur));
  if (lastEnd > TAIL_AT) throw new Error(`speech runs to ${lastEnd.toFixed(2)}s, past the ${TAIL_AT}s tail`);

  // 4. Render.
  const inputs = [];
  const filters = [];

  TAKES.forEach((take, i) => {
    let src = take.wav;
    if (take.tempo) {
      const fitted = join(tmp, `f${i}.wav`);
      ff(["-i", src, "-filter:a", `atempo=${take.tempo.toFixed(4)}`, fitted]);
      src = fitted;
    }
    inputs.push("-i", src);
    const delay = Math.round(take.start * 1000);
    filters.push(`[${i}:a]adelay=${delay}|${delay},volume=${take.gain ?? 1}[s${i}]`);

    console.log(
      `${take.who} ${take.start.toFixed(2)}-${(take.start + take.dur).toFixed(2)}` +
        `${take.tempo ? ` x${take.tempo.toFixed(2)}` : "     "}  ${take.id}${take.part ?? ""}  ${take.text}`,
    );
  });

  const n = TAKES.length;
  const musicLen = MUSIC_END - MUSIC_AT;

  const filter = [
    ...filters,
    `sine=frequency=196:duration=${musicLen}[m0]`,
    `sine=frequency=294:duration=${musicLen}[m1]`,
    `sine=frequency=392:duration=${musicLen}[m2]`,
    `[m0][m1][m2]amix=inputs=3:normalize=0,tremolo=f=4:d=0.35,volume=0.11,` +
      `afade=t=in:st=0:d=1.2,afade=t=out:st=${musicLen - 2}:d=2,` +
      `adelay=${MUSIC_AT * 1000}|${MUSIC_AT * 1000}[music]`,
    `anoisesrc=d=0.9:c=pink:a=0.18,highpass=f=300,lowpass=f=3000,` +
      `afade=t=in:st=0:d=0.05,afade=t=out:st=0.35:d=0.5,` +
      `adelay=${LAUGH_AT * 1000}|${LAUGH_AT * 1000}[laugh]`,
    `${Array.from({ length: n }, (_, i) => `[s${i}]`).join("")}[music][laugh]` +
      `amix=inputs=${n + 2}:normalize=0,` +
      `atrim=0:${DURATION},apad=whole_dur=${DURATION},alimiter=limit=0.95[out]`,
  ].join(";");

  const wav = join(tmp, "clip.wav");
  ff([...inputs, "-filter_complex", filter, "-map", "[out]", "-ac", "1", "-ar", String(SR), wav]);
  ff(["-i", wav, "-c:a", "aac", "-b:a", "96k", `${RUN}/clip.m4a`]);

  // 5. Peaks come from the rendered audio, so the waveform on screen is the real signal.
  const raw = join(tmp, "raw.pcm");
  ff(["-i", wav, "-f", "s16le", "-ac", "1", "-ar", String(SR), raw]);

  const pcm = readFileSync(raw);
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
    `${JSON.stringify({ clip: "ko-clip-01", duration: DURATION, peaks: norm }, null, 2)}\n`,
  );

  // 6. Rewrite the cue windows from the layout. The captions follow the audio, never the reverse.
  const spans = new Map();
  for (const take of TAKES) {
    const span = spans.get(take.id) ?? { start: take.start, end: 0 };
    span.start = Math.min(span.start, take.start);
    span.end = Math.max(span.end, take.start + take.dur);
    spans.set(take.id, span);
  }

  const capsPath = `${RUN}/captions.json`;
  const caps = JSON.parse(readFileSync(capsPath, "utf8"));
  const round = (v) => Number(v.toFixed(2));

  caps.cues.forEach((cue, i) => {
    if (cue.silence) {
      cue.t_start = TAIL_AT;
      cue.t_end = DURATION;
      return;
    }
    const span = spans.get(cue.id);
    if (!span) throw new Error(`no audio for cue ${cue.id}`);

    cue.t_start = round(span.start);
    const next = caps.cues[i + 1];
    const nextStart = next && !next.silence ? spans.get(next.id).start : TAIL_AT;
    // A caption may linger a little past the speech, but never into the next line.
    cue.t_end = round(Math.min(span.end + 0.3, Math.max(nextStart - 0.05, span.end)));
  });

  const c08cue = caps.cues.find((c) => c.id === "c08");
  c08cue.t_start = C08_AT;
  c08cue.t_end = C08_END;

  writeFileSync(capsPath, `${JSON.stringify(caps, null, 2)}\n`);

  // The beat of silence is wherever the layout actually left it.
  const c06 = spans.get("c06");
  const runPath = `${RUN}/run.json`;
  const run = JSON.parse(readFileSync(runPath, "utf8"));
  run.clip.duration = DURATION;
  run.clip.music = [[MUSIC_AT, MUSIC_END]];
  run.clip.silence = [[round(c06.end + 0.05), C08_AT], [TAIL_AT, DURATION]];
  writeFileSync(runPath, `${JSON.stringify(run, null, 2)}\n`);

  const tail = norm.slice(Math.floor((TAIL_AT / DURATION) * PEAKS));
  const gap = spans.get("c04");
  console.log(`\nclip.m4a       ${probe(`${RUN}/clip.m4a`).toFixed(2)}s`);
  console.log(`waveform       ${norm.length} peaks from the rendered audio`);
  console.log(`c04 window     ${gap.start.toFixed(2)} - ${gap.end.toFixed(2)}`);
  console.log(`beat of quiet  ${(c06.end + 0.05).toFixed(2)} - ${C08_AT}`);
  console.log(`silent tail    max peak ${Math.max(...tail).toFixed(3)} (must be 0)`);
  console.log(`captions.json + run.json rewritten from the audio`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
