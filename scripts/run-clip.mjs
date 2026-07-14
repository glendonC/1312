/**
 * The orchestrator. It runs a real ko->en pipeline over a real clip and records what it did.
 *
 *   node scripts/run-clip.mjs --run run-006
 *
 * It does NOT author a run. It performs one, and every number that lands in the run folder is
 * something this process actually measured:
 *
 *   captions.json    source lines from a real recogniser, target lines from a real translator,
 *                    withheld lines withheld by a gate that really fired
 *   traces.json      one trace at the moment each real thing happened, t = real wall clock
 *   glossary.json    terms a real extraction pass resolved, each carrying its provenance
 *   corrections.json raw -> final pairs where a gate really sent a line back
 *   score.json       measurements of this run's own BEHAVIOUR (coverage, withheld, latency,
 *                    entity-gate hits). Accuracy is NOT in here: there is no gold for this
 *                    clip, so hard_line and points are null and status is "unscored". Gold
 *                    and scoring live in bench/ and are not this script's to invent.
 *
 * The one thing the pipeline cannot know
 * --------------------------------------
 * gpt-4o-transcribe-diarize returns no logprobs and no confidence field. So there is no
 * per-line ASR confidence to be had, and inventing one would be the exact failure this repo
 * exists to refuse. What we CAN measure is CROSS-RECOGNISER AGREEMENT: have a second,
 * independent recogniser hear the same audio and compare what the two of them wrote down.
 * That number is real, it is 0..1, and it is what the confidence gate reads. It is labelled
 * `asr_agreement` everywhere — on the card, in the gate, in the withheld reason — because it
 * is agreement between two systems, not a model's belief about itself.
 *
 * Both recognisers hear the WHOLE CLIP, and the comparison is made afterwards, window by
 * window, using the second one's word timestamps. The first draft of this script cut each cue
 * out and handed the slice over on its own, which is a different and much worse question: a
 * recogniser given 0.25 seconds of "네" with no context around it answers "Hey." or "没有。"
 * A disagreement produced that way is an artifact of the knife, not a fact about the audio,
 * and withholding a line over it would be blaming the clip for our own tooling.
 *
 * Timing
 * ------
 * `t` is seconds from run start on the real wall clock, stamped at the instant the trace is
 * emitted. The pipeline waits on API calls, so the recorded stream is lumpy, and it is left
 * lumpy: ReplayTransport has a speed control (the store runs it at 6x) and that is the honest
 * way to make a 90-second run watchable. Nothing here spaces, smooths or back-dates a t.
 *
 * Requires: ffmpeg, and OPENAI_API_KEY in .env.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { detectPhenomena, entityGate, PACK_GATES } from "./packs/ko-v3.mjs";
import { contentIdForJson } from "./lib/immutable-receipts.mjs";
import { acceptedHead, loadLedger, recordProposal } from "./lib/memory-review.mjs";
import { normalizeSourceReceipt } from "./lib/source-receipts.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/* ------------------------------------------------------------------ knobs */

/** Chosen before the run, never after. Tuning a limit to the result is scoring yourself. */
const AGREEMENT_MIN = 0.6; // universal.asr_agreement
const REPEAT_MAX = 3; // universal.repetition: >2 repeats is a decoder loop
const SPEAKER_FLOOR_S = 1.0; // universal.speaker_support: a real speaker holds the floor
const SILENCE_MIN_S = 0.6; // universal.silence: a gap this long is a gap
const WORKER_CUE_LIMIT = 8; // the mitosis rule, unchanged since run-004

const ASR = "gpt-4o-transcribe-diarize"; // the prepped recogniser
const ASR2 = "whisper-1"; // the second, independent recogniser — a different family, and it times words
const TRANSLATOR = "gpt-5"; // the prepped translator
const COLD = "gpt-4o"; // the cold foil: one-shot, no glossary, no gates

/* ------------------------------------------------------------------ setup */

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 || i === process.argv.length - 1 ? fallback : process.argv[i + 1];
}

const RUN = arg("run", "run-006");
const DIR = join(ROOT, "public/demo/runs", RUN);

function die(msg) {
  console.error(`\n  ${msg}\n`);
  process.exit(1);
}

const KEY = (readFileSync(join(ROOT, ".env"), "utf8").match(/^OPENAI_API_KEY=(.+)$/m) ?? [])[1]?.trim();
if (!KEY) die("no OPENAI_API_KEY in .env");

const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));
const source = normalizeSourceReceipt(readJson(join(DIR, "source.json")));
const wave = readJson(join(DIR, "waveform.json"));
const pack = readJson(join(ROOT, "public/demo/packs/ko-v3.json"));
const wav = join(DIR, "clip.wav");

/* --------------------------------------------------------------- the tape */

const T0 = Date.now();
const traces = [];

/** Seconds from run start, on the real clock. Two decimals is the resolution the UI reads. */
const now = () => Number(((Date.now() - T0) / 1000).toFixed(2));

/**
 * Append one trace at the moment the thing happened. This is the ONLY way anything is
 * recorded: the run folder is a fold of this stream, so a step that emits nothing did not
 * happen as far as the Studio is concerned — and a trace with no step behind it is a lie.
 */
function emit(agent, action, target, detail, extra = {}) {
  const trace = { t: now(), agent, action, target, detail, level: extra.level ?? "info" };
  if (typeof extra.clip_t === "number") trace.clip_t = Number(extra.clip_t.toFixed(2));
  if (extra.view) trace.view = extra.view;
  if (extra.effects) trace.effects = extra.effects;
  traces.push(trace);
  console.log(
    `  ${String(trace.t).padStart(6)}s  ${agent.padEnd(12)} ${action.padEnd(9)} ${target.padEnd(14)} ${detail}`,
  );
  return trace;
}

const agentFx = (id, status) => ({ type: "agent", id, status });
const cueFx = (id, state) => ({ type: "cue", id, state });

/* ------------------------------------------------------------------- http */

async function openai(path, body, { form = false, tries = 3 } = {}) {
  for (let i = 0; i < tries; i++) {
    const res = await fetch(`https://api.openai.com/v1/${path}`, {
      method: "POST",
      headers: form
        ? { Authorization: `Bearer ${KEY}` }
        : { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
      body: form ? body : JSON.stringify(body),
    });
    if (res.ok) return res.json();
    const text = await res.text();
    if (res.status < 500 && res.status !== 429) throw new Error(`${path} ${res.status}: ${text}`);
    if (i === tries - 1) throw new Error(`${path} ${res.status}: ${text}`);
    await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
  }
}

/**
 * `mode` is "diarize" (who spoke when) or "words" (what was said, and exactly when).
 *
 * Both recognisers get the WHOLE clip. That is not a convenience — it is the only way the
 * cross-check means anything. Cutting a 0.25s "네" out and asking a recogniser to name it in
 * isolation returns "Hey." or "没有。": handed no context, a model invents. A disagreement
 * manufactured that way says nothing about the audio and everything about the knife. So both
 * hear all 40 seconds, and the comparison is made afterwards, window by window, on the words.
 */
async function transcribe(file, model, mode) {
  const form = new FormData();
  form.append("file", new Blob([readFileSync(file)], { type: "audio/wav" }), "clip.wav");
  form.append("model", model);
  form.append("language", "ko");
  if (mode === "diarize") {
    form.append("response_format", "diarized_json");
    form.append("chunking_strategy", JSON.stringify({ type: "server_vad" }));
  } else {
    form.append("response_format", "verbose_json");
    form.append("timestamp_granularities[]", "word");
  }
  return openai("audio/transcriptions", form, { form: true });
}

/** gpt-5 is a reasoning model: no temperature, and completion tokens have their own field. */
async function chat(model, system, user, json = true) {
  const body = {
    model,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  };
  if (json) body.response_format = { type: "json_object" };
  if (model.startsWith("gpt-5")) body.max_completion_tokens = 4000;
  else {
    body.max_tokens = 4000;
    body.temperature = 0;
  }
  const res = await openai("chat/completions", body);
  const text = res.choices[0].message.content;
  return json ? JSON.parse(text) : text;
}

/* ------------------------------------------------------------------ audio */

/** RMS envelope straight off the PCM. Real signal, measured here, not asked of a model. */
function envelope(step = 0.1) {
  const buf = readFileSync(wav);
  let p = 12;
  while (p < buf.length - 8 && buf.toString("latin1", p, p + 4) !== "data") {
    p += 8 + buf.readUInt32LE(p + 4);
  }
  const data = buf.subarray(p + 8);
  const perWindow = Math.floor(16000 * step);
  const out = [];
  for (let w = 0; w * perWindow * 2 < data.length; w++) {
    let sum = 0;
    let n = 0;
    for (let i = w * perWindow; i < (w + 1) * perWindow && i * 2 + 1 < data.length; i++) {
      const s = data.readInt16LE(i * 2) / 32768;
      sum += s * s;
      n++;
    }
    out.push({ t: w * step, rms: n ? Math.sqrt(sum / n) : 0 });
  }
  return out;
}

/* ------------------------------------------------------- universal checks */

/**
 * Character-level agreement between two transcripts of the same window. 0..1, measured.
 *
 * Returns null when the second recogniser wrote NOTHING here. That is not a zero. Zero means
 * "the two of them heard different things", which is a finding about the audio; an empty
 * window means the checker had no opinion, which is a fact about the checker. whisper-1 drops
 * backchannels — its transcript of this clip contains no 네 at all — so a real, clearly-spoken
 * "네" comes back with no token against it. Scoring that as total disagreement would withhold
 * the word "yes" for a habit of our own tooling, which is the same error as asking a recogniser
 * to name a 0.25s cut in isolation, one level up.
 */
function agreement(a, b) {
  const norm = (s) => s.replace(/[\s.,!?…·"'~]/g, "");
  const x = norm(a);
  const y = norm(b);
  if (!y.length) return null; // the checker said nothing about this window
  if (!x.length) return 0;
  const prev = Array.from({ length: y.length + 1 }, (_, i) => i);
  for (let i = 1; i <= x.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= y.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (x[i - 1] === y[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return Number(Math.max(0, 1 - prev[y.length] / Math.max(x.length, y.length)).toFixed(3));
}

/** How an agreement reads on screen. A null is never allowed to print as a number. */
const says = (a) => (a === null ? "not corroborated" : a.toFixed(2));

/** universal.repetition — a line that says the same thing more than twice is a decoder loop. */
function repetition(text) {
  const parts = text.split(/[.!?·]\s*/).map((s) => s.trim().toLowerCase()).filter(Boolean);
  const counts = new Map();
  for (const p of parts) counts.set(p, (counts.get(p) ?? 0) + 1);
  const worst = Math.max(1, ...counts.values());
  return {
    name: "repetition",
    scope: "universal",
    gate_id: "universal.repetition",
    value: Number((1 - (worst - 1) / REPEAT_MAX).toFixed(3)),
    limit: Number((1 - (REPEAT_MAX - 1) / REPEAT_MAX).toFixed(3)),
    fail: worst >= REPEAT_MAX,
    repairable: false,
    reason: worst >= REPEAT_MAX ? `the line repeats itself ${worst}x — decoder loop` : `no phrase repeats ${REPEAT_MAX}x`,
  };
}

/* =================================================================== RUN == */

async function main() {
  /* -- orchestrator inspects the real inputs ------------------------------ */

  const bytes = readFileSync(wav).length;
  emit(
    "orchestrator",
    "inspect",
    RUN,
    `${source.selection.duration}s · ${source.rights.label} · 16k mono · ${(bytes / 1024).toFixed(0)} KB · ${wave.peaks.length} peaks`,
    { effects: [agentFx("orchestrator", "working")] },
  );

  emit("orchestrator", "spawn", "segment-01", "one recogniser call covers 40s · one segmenter", {
    effects: [agentFx("segment-01", "spawning")],
  });
  emit("segment-01", "open", "workspace", "isolated workspace · clip.wav", {
    effects: [agentFx("segment-01", "working")],
  });

  /* -- the real recogniser call ------------------------------------------ */

  emit("segment-01", "call", ASR, "diarized_json · server_vad · request open", { clip_t: 0 });
  const asrAt = Date.now();
  const asr = await transcribe(wav, ASR, "diarize");
  const asrTook = ((Date.now() - asrAt) / 1000).toFixed(1);

  const segs = asr.segments.filter((s) => s.text.trim());
  const labels = [...new Set(segs.map((s) => s.speaker))];
  emit(
    "segment-01",
    "return",
    ASR,
    `${segs.length} segments · ${labels.length} speaker labels (${labels.join(", ")}) · ${asrTook}s`,
    { clip_t: 0, view: { playhead: 0 } },
  );

  /* -- universal.speaker_support: is every label a real speaker? ---------- */

  const support = new Map();
  for (const s of segs) support.set(s.speaker, (support.get(s.speaker) ?? 0) + (s.end - s.start));

  const unconfirmed = labels.filter((l) => support.get(l) < SPEAKER_FLOOR_S);
  for (const l of unconfirmed) {
    const seg = segs.find((s) => s.speaker === l);
    emit(
      "segment-01",
      "diarize",
      `speaker ${l}`,
      `${segs.filter((s) => s.speaker === l).length} segment · ${support.get(l).toFixed(2)}s total support · under the ${SPEAKER_FLOOR_S.toFixed(1)}s floor · label kept, not believed`,
      {
        level: "warn",
        clip_t: seg.start,
        view: { playhead: seg.start, mark: { label: `${l}?`, hard: true } },
      },
    );
  }

  /* -- the local envelope, measured off the PCM --------------------------- */

  const env = envelope();
  const floor = 0.02;
  const quiet = env.filter((e) => e.rms < floor).length;
  emit(
    "segment-01",
    "scan",
    "clip.wav",
    `${env.length} × 100ms windows · peak ${Math.max(...env.map((e) => e.rms)).toFixed(3)} · ${quiet} under the ${floor} floor`,
    { clip_t: source.selection.duration, view: { playhead: source.selection.duration } },
  );

  /* -- cues: one per real speech segment. No merging, no invention. ------- */

  const cues = segs.map((s, i) => ({
    id: `c${String(i + 1).padStart(2, "0")}`,
    t_start: Number(s.start.toFixed(2)),
    t_end: Number(s.end.toFixed(2)),
    speakers: [s.speaker],
    source: { lang: "ko", text: s.text.trim() },
    targets: [{ lang: "en", text: null }],
    owner: null,
  }));

  /** Gaps between real speech segments. VAD-derived, not an energy floor — say so. */
  const silence = [];
  for (let i = 1; i < cues.length; i++) {
    const gap = cues[i].t_start - cues[i - 1].t_end;
    if (gap >= SILENCE_MIN_S) silence.push([cues[i - 1].t_end, cues[i].t_start]);
  }
  if (source.selection.duration - cues.at(-1).t_end >= SILENCE_MIN_S) {
    silence.push([Number(cues.at(-1).t_end.toFixed(2)), source.selection.duration]);
  }
  for (const [a, b] of silence) {
    emit("segment-01", "gap", a.toFixed(2), `${(b - a).toFixed(2)}s with no speech segment · no caption is owed here`, {
      clip_t: a,
      view: { playhead: a },
    });
  }

  /* -- the second recogniser: the same 40 seconds, heard by another model -- */
  /*    Its words are the cold path's source AND the agreement the gate reads. */

  emit("segment-01", "call", ASR2, `second recogniser · the whole clip · word timestamps · cross-check, not a rerun`);

  const secondAt = Date.now();
  const crosscheck = await transcribe(wav, ASR2, "words");
  const words = (crosscheck.words ?? []).map((w) => ({
    text: String(w.word ?? "").trim(),
    start: Number(w.start),
    end: Number(w.end),
  }));

  emit(
    "segment-01",
    "return",
    ASR2,
    `${words.length} words timed · ${((Date.now() - secondAt) / 1000).toFixed(1)}s · a different model heard the same audio`,
    { clip_t: 0 },
  );

  /**
   * What the second recogniser heard INSIDE a cue's window.
   *
   * A word belongs to the window its midpoint falls in, so a word straddling a boundary lands
   * on one side rather than being counted twice. Both models heard the full clip with full
   * context; the only thing being compared is what each of them puts in this window.
   */
  const heardIn = (a, b) =>
    words
      .filter((w) => (w.start + w.end) / 2 >= a && (w.start + w.end) / 2 < b)
      .map((w) => w.text)
      .join(" ")
      .trim();

  const marks = [];
  for (const cue of cues) {
    cue.cold_source = heardIn(cue.t_start, cue.t_end);
    cue.agreement = agreement(cue.source.text, cue.cold_source);

    emit(
      "segment-01",
      "verify",
      cue.id,
      cue.agreement === null
        ? `not corroborated · ${ASR2} timed no words in this window · it drops backchannels, so there is nothing to compare`
        : `agreement ${says(cue.agreement)} · ${ASR2} heard "${cue.cold_source}"`,
      {
        level: cue.agreement !== null && cue.agreement < AGREEMENT_MIN ? "warn" : "info",
        clip_t: cue.t_start,
        view: { playhead: cue.t_start },
      },
    );

    // The pack reads the line the moment it is verified. Detection, not judgement.
    const hits = detectPhenomena(cue.source.text);
    if (hits.length > 0) {
      cue.hard = true;
      cue.error_type = hits[0].error_type;
      cue.error_subtype = hits[0].id;
      marks.push(cue.id);
      emit("segment-01", "mark", cue.id, `${hits[0].label} · ${hits[0].id}`, {
        level: "warn",
        clip_t: cue.t_start,
        view: { playhead: cue.t_start, mark: { label: cue.id, hard: true } },
      });
    }
  }

  emit(
    "segment-01",
    "report",
    `${cues.length} cues`,
    `timed source lines · empty target slots · ${marks.length} hard candidates · ${unconfirmed.length} unconfirmed speaker`,
    { effects: [agentFx("segment-01", "reporting")] },
  );

  /* -- context: it had nothing to do until the transcript existed --------- */

  emit("orchestrator", "spawn", "context-01", "the glossary needs a transcript · spawning now there is one", {
    effects: [agentFx("context-01", "spawning")],
  });
  emit("context-01", "open", "workspace", `pack ${pack.id} · cast opens empty`, {
    effects: [agentFx("context-01", "working")],
  });
  emit("context-01", "call", TRANSLATOR, "term and entity resolution over the transcript");

  const transcript = cues.map((c) => `${c.id} [${c.speakers[0]}] ${c.source.text}`).join("\n");
  const resolved = await chat(
    TRANSLATOR,
    [
      "You resolve the terms a ko->en translator will need, from a Korean transcript.",
      `Return JSON {"entries":[{"term","gloss","kind","confirms_relation"}]}.`,
      `kind is one of: ${pack.entity_kinds.join(", ")}.`,
      // The gloss is pasted into a caption if the translator takes it literally, so it has to BE
      // English a caption can carry. An earlier version asked for a gloss that "starts with" the
      // surface form and got "brother-in-law (older sister's husband)", which is what then
      // appeared on screen. A dictionary note and a subtitle are not the same object.
      "gloss is ONLY the English surface form a subtitle would use: one to three words, no",
      "parentheses, no explanation, no alternatives. Write 'brother-in-law', never",
      "'brother-in-law (older sister's husband)'.",
      "Only terms that actually appear in the transcript. No invention. Empty list is a valid answer.",
      "Address forms (누나/오빠/형/언니/선배) get kind address_form. Set confirms_relation true ONLY if",
      "the transcript itself proves the speakers are really family by using a kinship-only word",
      "(친누나, 매형, 형수 — words that cannot be used to address a non-relative). The address form",
      "meaning 'older sister' is NOT proof of a sister: that is just what the word means.",
    ].join(" "),
    transcript,
  );

  const glossary = (resolved.entries ?? []).map((e) => ({
    term: e.term,
    lang: "ko",
    gloss: e.gloss,
    kind: pack.entity_kinds.includes(e.kind) ? e.kind : "term",
    ...(e.confirms_relation === true ? { confirms_relation: true } : {}),
    source: `${TRANSLATOR} · ${RUN} term resolution`,
  }));

  for (const g of glossary) {
    emit("context-01", "resolve", g.term, `${g.kind} · ${g.gloss}`, {
      view: { gloss: { term: g.term, gloss: g.gloss } },
    });
  }

  const cast = glossary.filter((g) => g.kind === "person");
  emit(
    "context-01",
    "report",
    "glossary",
    `${glossary.length} entries · cast closed at ${cast.length} names · ${pack.gates.length} gates from ${pack.id}`,
    { effects: [agentFx("context-01", "reporting")] },
  );
  emit("orchestrator", "merge", "context-01", "glossary and gates folded into the job context");
  emit("context-01", "retire", "context-01", "reported up · nothing left to do", {
    effects: [agentFx("context-01", "retired")],
  });
  emit("segment-01", "retire", "segment-01", "reported up · nothing left to do", {
    effects: [agentFx("segment-01", "retired")],
  });

  /* -- the cold foil, off in its own lane -------------------------------- */
  /*    Same audio, same windows, no glossary, no gates, one shot. It is a  */
  /*    foil for translation and honesty, NOT for segmentation: we hand it  */
  /*    our windows for free, and the note in score.json says so.           */

  const coldPromise = (async () => {
    const at = Date.now();
    const out = await chat(
      COLD,
      'Translate each Korean line to English. Return JSON {"lines":[{"id","en"}]}. Translate every line.',
      cues.map((c) => `${c.id} ${c.cold_source}`).join("\n"),
    );
    const by = new Map((out.lines ?? []).map((l) => [l.id, l.en]));
    for (const c of cues) {
      c.baseline = {
        path: "cold",
        source: { lang: "ko", text: c.cold_source },
        target: { lang: "en", text: by.get(c.id) ?? null },
      };
    }
    emit(
      "orchestrator",
      "baseline",
      "cold",
      `${ASR2} + one-shot ${COLD} · no glossary · no gates · ${((Date.now() - at) / 1000).toFixed(1)}s`,
    );
    return Number(((Date.now() - T0) / 1000).toFixed(2));
  })();

  /* -- translate + qc, spawned as a pair, then mitosis -------------------- */

  emit("orchestrator", "spawn", "translate-01", "translate and qc spawn as a pair · rule from run-004", {
    effects: [agentFx("translate-01", "spawning")],
  });
  emit("orchestrator", "spawn", "qc-01", "no translator ships without a gate", {
    effects: [agentFx("qc-01", "spawning")],
  });

  const split = Math.min(WORKER_CUE_LIMIT, cues.length);
  const first = cues.slice(0, split);
  const second = cues.slice(split);
  for (const c of first) c.owner = "translate-01";
  for (const c of second) c.owner = "translate-02";

  const w1 = [first[0].t_start, first.at(-1).t_end];
  const w2 = second.length ? [second[0].t_start, second.at(-1).t_end] : null;

  emit("translate-01", "open", "workspace", `cues ${first[0].id}–${first.at(-1).id}`, {
    effects: [agentFx("translate-01", "working")],
  });
  emit("qc-01", "open", "workspace", `${pack.gates.length} gates armed · fail closed`, {
    effects: [agentFx("qc-01", "working")],
  });

  if (second.length > 0) {
    emit(
      "orchestrator",
      "divide",
      "translate-01",
      `${cues.length} cues is over the ${WORKER_CUE_LIMIT}-cue worker limit · dividing`,
    );
    emit(
      "translate-01",
      "divide",
      "translate-02",
      `second half handed to a new worker · ${w2[0].toFixed(1)}–${w2[1].toFixed(1)}`,
      { effects: [agentFx("translate-02", "spawning")] },
    );
    emit("translate-02", "open", "workspace", `cues ${second[0].id}–${second.at(-1).id}`, {
      effects: [agentFx("translate-02", "working")],
    });
  }

  /* -- the loop: draft -> gate -> (repair) -> commit or withhold ---------- */

  const corrections = [];
  let committed = 0;
  let withheld = 0;
  let corrected = 0;
  let fabrications = 0;
  let qcGating = false;
  // Two different questions, and they were being answered with one number.
  //
  // `lastCommitAt` was assigned on every commit, so it ended up holding the time of the LAST
  // one and was then written to a field called time_to_usable_s. "Usable" is a claim about when
  // you could start working; "complete" is a claim about when we stopped. Reporting the second
  // under the name of the first is the kind of quiet mislabel this whole run exists to refuse.
  let firstCommitAt = null;
  let lastCommitAt = 0;

  const SYSTEM = [
    "You translate Korean conversation into natural English for subtitles.",
    "You are given a glossary, the full transcript for context, and one line to translate.",
    "Use the glossary's English surface form for a term when the term appears. The glossary is a",
    "reference, NOT text to reproduce: never copy an entry, a parenthetical or a note into the",
    "caption. A subtitle reads as speech, and nobody says 'brother-in-law (older sister's husband)'.",
    "Do not invent names, places or family relations the Korean line does not carry.",
    "Address forms are not kinship.",
    'Return JSON {"en": "...", "note": "one clause on anything you were unsure of"}.',
  ].join(" ");

  const gloss = glossary.map((g) => `${g.term} = ${g.gloss} (${g.kind})`).join("\n");

  async function translateOne(worker, cue) {
    const ask = async (repair) =>
      chat(
        TRANSLATOR,
        SYSTEM,
        [
          `GLOSSARY\n${gloss || "(empty)"}`,
          `TRANSCRIPT\n${transcript}`,
          `LINE ${cue.id} [${cue.speakers[0]}] ${cue.source.text}`,
          repair ? `QC SENT THIS BACK: ${repair}. Fix exactly that and return the line again.` : "",
        ].join("\n\n"),
      );

    const out = await ask(null);
    cue.draft = String(out.en ?? "").trim();

    emit(worker, "draft", cue.id, `${TRANSLATOR} · asr_agreement ${says(cue.agreement)}${out.note ? ` · ${out.note}` : ""}`, {
      level: cue.agreement !== null && cue.agreement < AGREEMENT_MIN ? "warn" : "info",
      clip_t: cue.t_start,
      view: { draft: { source: cue.source.text, target: cue.draft, conf: cue.agreement } },
      effects: [cueFx(cue.id, "drafted")],
    });

    /* ---- qc-01. The model did the language work; code decides what ships. */

    const readings = [];

    // universal.asr_agreement — the only honest confidence we have, and it is not repairable
    // by the translator: it is the SOURCE we do not trust, not the English.
    //
    // It ABSTAINS when there is nothing to compare. A gate that cannot see is not a gate that
    // has found something, and a run that withheld every line its checker happened to skip
    // would be reporting its own blind spots as the clip's ambiguity.
    if (cue.agreement !== null) {
      readings.push({
        name: "asr_agreement",
        scope: "universal",
        gate_id: "universal.asr_agreement",
        value: cue.agreement,
        limit: AGREEMENT_MIN,
        fail: cue.agreement < AGREEMENT_MIN,
        repairable: false,
        reason:
          cue.agreement < AGREEMENT_MIN
            ? `two recognisers agree only ${cue.agreement.toFixed(2)} on this window (< ${AGREEMENT_MIN})`
            : `two recognisers agree ${cue.agreement.toFixed(2)}`,
      });
    }
    readings.push(repetition(cue.draft));
    for (const gate of PACK_GATES) {
      const r = gate(cue, glossary);
      if (r) readings.push(r);
    }

    let failed = readings.find((r) => r.fail);
    let repaired = false;

    // A repairable failure goes back to the translator ONCE, with the reason. That is a real
    // second call, and the pair it produces is a real correction row.
    if (failed?.repairable) {
      qcGating = true;
      emit("qc-01", "gate", cue.id, `${failed.name} gate · ${failed.reason} · sending it back`, {
        level: "gate",
        clip_t: cue.t_start,
        view: {
          gate: { name: failed.name, scope: failed.scope, value: failed.value, limit: failed.limit, fail: true },
        },
        effects: [agentFx("qc-01", "gating")],
      });
      if (failed.gate_id === "ko.entity_support") fabrications += failed.invented.length;

      const raw = cue.draft;
      const fix = await ask(`${failed.gate_id} — ${failed.reason}`);
      cue.draft = String(fix.en ?? "").trim();

      emit(worker, "redraft", cue.id, `re-drafted against ${failed.gate_id}`, {
        clip_t: cue.t_start,
        view: { draft: { source: cue.source.text, target: cue.draft, conf: cue.agreement } },
      });

      const recheck = [repetition(cue.draft), ...PACK_GATES.map((g) => g(cue, glossary)).filter(Boolean)];
      failed = recheck.find((r) => r.fail);

      if (!failed) {
        corrected++;
        repaired = true;
        corrections.push(row(cue, raw, cue.draft, false));
      } else {
        corrections.push(row(cue, raw, null, true));
      }
    }

    if (failed) {
      withheld++;
      cue.targets[0].text = null;
      cue.targets[0].withheld = { gate: failed.name, reason: failed.reason };
      if (!failed.repairable) corrections.push(row(cue, cue.draft, null, true));

      emit("qc-01", "gate", cue.id, `withheld · ${failed.name} gate · ${failed.reason}`, {
        level: "gate",
        clip_t: cue.t_start,
        view: {
          gate: { name: failed.name, scope: failed.scope, value: failed.value, limit: failed.limit, fail: true },
          stamp: { kind: "withheld", text: "withheld" },
        },
        effects: [
          ...(qcGating ? [] : [agentFx("qc-01", "gating")]),
          cueFx(cue.id, "withheld"),
          { type: "score", coverage: Number((committed / cues.length).toFixed(2)), fabrications },
        ],
      });
      qcGating = true;
      return;
    }

    // Passed. Back to working — the transition table allows gating -> working, and pretending
    // qc stayed in the gate would be a lie about what it is doing.
    cue.targets[0].text = cue.draft;
    committed++;
    lastCommitAt = now();
    if (firstCommitAt === null) firstCommitAt = lastCommitAt;

    emit(
      "qc-01",
      "gate",
      cue.id,
      cue.agreement === null
        ? `${readings.length} gates clean · uncorroborated · committed on ${ASR} alone, and labelled so`
        : `${readings.length} gates clean · agreement ${says(cue.agreement)}`,
      {
        clip_t: cue.t_start,
        view: {
          // An abstaining gate paints no meter: a bar at zero would read as a failing score,
          // and a bar at one as a pass we never made.
          ...(cue.agreement === null
            ? {}
            : {
                gate: {
                  name: "asr_agreement",
                  scope: "universal",
                  value: cue.agreement,
                  limit: AGREEMENT_MIN,
                },
              }),
          ...(repaired ? { stamp: { kind: "corrected", text: "corrected" } } : {}),
        },
        effects: [
          ...(qcGating ? [agentFx("qc-01", "working")] : []),
          cueFx(cue.id, "committed"),
          { type: "score", coverage: Number((committed / cues.length).toFixed(2)), fabrications },
        ],
      },
    );
    qcGating = false;
  }

  function row(cue, raw, final, withhold) {
    return {
      source_video: source.sourceId ?? RUN,
      t_start: cue.t_start,
      t_end: cue.t_end,
      raw,
      final,
      error_type: cue.error_type ?? "other",
      ...(cue.error_subtype ? { error_subtype: cue.error_subtype } : {}),
      lang: "en",
      withhold,
      run: RUN,
      pack: pack.id,
    };
  }

  // translate-01 and translate-02 really do run at the same time. The traces interleave
  // because the API calls interleave, not because anything staggered them.
  await Promise.all([
    (async () => {
      for (const c of first) await translateOne("translate-01", c);
      emit("translate-01", "report", `${first[0].id}–${first.at(-1).id}`, `${first.length} cues drafted`, {
        effects: [agentFx("translate-01", "reporting")],
      });
    })(),
    (async () => {
      for (const c of second) await translateOne("translate-02", c);
      if (second.length > 0) {
        emit("translate-02", "report", `${second[0].id}–${second.at(-1).id}`, `${second.length} cues drafted`, {
          effects: [agentFx("translate-02", "reporting")],
        });
      }
    })(),
  ]);

  const coldAt = await coldPromise;

  emit(
    "qc-01",
    "report",
    `${cues.length} hard checks`,
    `${committed} committed · ${withheld} withheld · ${corrected} corrected · ${fabrications} entity-gate hits`,
    { effects: [agentFx("qc-01", "reporting")] },
  );
  for (const id of ["translate-01", ...(second.length ? ["translate-02"] : []), "qc-01"]) {
    emit(id, "retire", id, "reported up", { effects: [agentFx(id, "retired")] });
  }

  /* -- merge, and a score that refuses to score itself -------------------- */

  emit("orchestrator", "merge", `${cues.length} cues`, `${committed} committed · ${withheld} withheld`);

  const coverage = Number((committed / cues.length).toFixed(2));
  emit(
    "orchestrator",
    "score",
    RUN,
    `coverage ${coverage.toFixed(2)} · ${withheld} withheld · ${fabrications} entity-gate hits · hard lines UNSCORED: no gold for this clip`,
    { level: "gate", effects: [{ type: "score", coverage, fabrications }] },
  );

  const wall = now();
  emit("orchestrator", "done", RUN, `${traces.length + 1} actions · 5 workers · ${wall.toFixed(1)}s wall`);

  /* -- write the run folder ---------------------------------------------- */

  /*
   * Cold's coverage is MEASURED, not assumed.
   *
   * This was hardcoded to 1.00, on the reasoning that a path with no gates never withholds
   * anything. True, and irrelevant: cold still ends up with no caption on some windows, because
   * its recogniser never heard the line at all. Those are MISSES, not refusals, and the two look
   * identical in a coverage number while meaning opposite things — one path declined to guess and
   * said why, the other does not know the line exists. Asserting 1.00 handed cold a perfect score
   * on exactly the windows where it had failed hardest.
   */
  const coldEmitted = cues.filter((c) => Boolean(c.baseline?.target.text)).length;
  const coldCoverage = Number((coldEmitted / cues.length).toFixed(2));
  const coldMisses = cues.length - coldEmitted;

  const coldFabs = cues.reduce((n, c) => {
    const r = entityGate({ ...c, draft: c.baseline?.target.text ?? "" }, glossary);
    return n + (r?.invented?.length ?? 0);
  }, 0);

  const clip = {
    id: source.sourceId ?? RUN,
    title: source.title,
    title_target: source.title,
    lang: "ko",
    duration: source.selection.duration,
    speakers: labels.map((l) => ({
      id: l,
      label: unconfirmed.includes(l)
        ? `speaker ${l} · unconfirmed (${support.get(l).toFixed(2)}s support)`
        : `speaker ${l} · diarized`,
    })),
    music: [],
    silence,
    source: {
      kind: source.kind,
      label: source.creator ?? "Creator not recorded",
      ...(source.locator.url ? { url: source.locator.url } : {}),
      ...(source.rights.basis === "redistribution_licence" ? { licence: source.rights.label } : {}),
      note: `${source.note} Speaker labels are the recogniser's own, not ours: nobody is named in this window, so we do not know which voice is the host and a run that guessed would be inventing the one thing a viewer could check by watching. music[] is empty because no music detector ran, NOT because the clip is known to be clean. silence[] is derived from VAD segment boundaries (gaps ≥ ${SILENCE_MIN_S}s), not from an energy floor.`,
    },
    media: "clip.mp4",
  };

  const write = (name, obj) => writeFileSync(join(DIR, name), JSON.stringify(obj, null, 2) + "\n");

  write("run.json", {
    id: RUN,
    pair: { source: "ko", target: "en" },
    pack: pack.id,
    clip,
    wall_s: wall,
    recorded: new Date().toISOString().slice(0, 10),
    agents: [
      { id: "segment-01", role: "segment", label: "segment-01", parent: "orchestrator" },
      { id: "context-01", role: "context", label: "context-01", parent: "orchestrator" },
      { id: "translate-01", role: "translate", label: "translate-01", parent: "orchestrator", window: w1 },
      ...(w2
        ? [
            {
              id: "translate-02",
              role: "translate",
              label: "translate-02",
              parent: "orchestrator",
              divided_from: "translate-01",
              window: w2,
            },
          ]
        : []),
      { id: "qc-01", role: "qc", label: "qc-01", parent: "orchestrator" },
    ],
    artifacts: [
      "captions.json",
      "corrections.json",
      "glossary.json",
      "memory-proposals.json",
      "score.json",
      "traces.json",
    ],
    note: `A run that actually happened on ${new Date().toISOString().slice(0, 10)}, against rights-receipted media (${source.rights.label}). Source lines are ${ASR}; the confidence the gates read is cross-recogniser agreement with ${ASR2}, because ${ASR} returns no logprobs and a confidence we cannot measure is one we do not print.`,
  });

  write("captions.json", {
    run: RUN,
    clip: clip.id,
    pair: { source: "ko", target: "en" },
    cues: cues.map((c) => ({
      id: c.id,
      t_start: c.t_start,
      t_end: c.t_end,
      speakers: c.speakers,
      source: c.source,
      targets: c.targets,
      corroboration: { agreement: c.agreement, by: ASR2, heard: c.cold_source },
      ...(c.baseline ? { baseline: c.baseline } : {}),
      ...(c.hard ? { hard: true, error_type: c.error_type, error_subtype: c.error_subtype } : {}),
      owner: c.owner,
    })),
  });

  // traces are appended by concurrent workers, so the array is in emission order but not
  // strictly sorted. ReplayTransport walks it with a rising clock; sort by the real t.
  traces.sort((a, b) => a.t - b.t);
  write("traces.json", { run: RUN, clip: clip.id, wall_s: wall, traces });

  // A model-produced run glossary is evidence for a proposal, not cross-run truth. Earlier
  // runs merged these rows directly into memory/glossary/ko.json, allowing the producer to
  // approve its own output and overwriting prior values without a decision receipt. Preserve
  // that historical file as legacy input, but future runs stop here until a separate reviewer
  // records a reasoned decision through scripts/memory-review.mjs.
  write("glossary.json", {
    run: RUN,
    clip: clip.id,
    pack: pack.id,
    scope: "run",
    promoted_to: null,
    promotion: {
      status: "pending_review",
      proposal_kind: "glossary",
      proposal_manifest: "memory-proposals.json",
      note: "Run-scoped evidence only. No cross-run memory was changed by this run.",
    },
    // FALSE, and it has to be. A closed cast means we hold the show's real cast list and can
    // demote any name outside it. This is a podcast between two people who are never named in
    // the window: there is no cast to close. Declaring it closed would arm ko.cast_closed
    // against an empty list, and every proper noun in the English — Thailand, Chiang Mai —
    // would read as invented. The gate that CAN run here is entity support, not a closed cast.
    cast_closed: false,
    entries: glossary,
  });

  write("corrections.json", { run: RUN, clip: clip.id, pack: pack.id, rows: corrections });

  const uncorroborated = cues.filter((c) => c.agreement === null).length;

  write("score.json", {
    run: RUN,
    clip: clip.id,
    pair: { source: "ko", target: "en" },
    pack: pack.id,
    status: "unscored",
    rubric: {
      hard_lines: marks.length,
      criteria: ["entity", "meaning", "honesty"],
      points_max: marks.length * 3,
      note: `No gold exists for this clip, so NOTHING here is scored for accuracy: points and hard_line are null on every path, and so is delta_vs_cold — a run with nothing to be right against has not beaten the cold path by zero, it has not been compared to it at all. What IS real: coverage, withheld, the two latencies, and the gate hits — measurements of what this run DID, not of whether it was right. ${marks.length} lines were flagged hard because they carry a ko-v3 phenomenon, which is a detection in the source that any Korean reader can check, not a verdict on the English. Scoring against gold lives in bench/.`,
    },
    paths: {
      cold: {
        label: "Cold one-shot",
        points: null,
        hard_line: null,
        coverage: coldCoverage,
        // Cold answers in one call, so the first line it can stand behind and the last one
        // arrive together. First-usable and complete are the same instant for it, and that is
        // a real property of the shape of the path, not a rounding.
        time_to_usable_s: coldAt,
        time_to_complete_s: coldAt,
        withheld: 0,
        // Not "hallucinated". We ran a detector, and a detector firing is a detection, not a
        // verified fabrication — that needs gold. ${coldFabs} unsupported proper nouns is what
        // we can say, and we say it here rather than in a field named for a stronger claim.
        hallucinated: null,
        status: "unscored",
        note: `${ASR2} + one-shot ${COLD}, no glossary, no gates. It is handed the prepped path's windows for free, so it is a foil for translation, entities and honesty — NOT for segmentation. withheld is 0 because it has no gate and never refuses anything, but coverage is still ${coldCoverage.toFixed(2)}: it has no caption on ${coldMisses} window${coldMisses === 1 ? "" : "s"} because its recogniser never heard the line. Those are MISSES, not refusals, and a coverage number cannot tell them apart — which is why coverage is not a score. The entity gate found ${coldFabs} proper noun${coldFabs === 1 ? "" : "s"} in its English that trace to nothing in the Korean or the glossary; that is a detection, not a gold-verified error count, so hallucinated is null.`,
      },
      [RUN]: {
        label: "1321 · this run",
        points: null,
        hard_line: null,
        coverage,
        time_to_usable_s: firstCommitAt,
        time_to_complete_s: lastCommitAt,
        withheld,
        hallucinated: null,
        status: "unscored",
        note: `${committed} of ${cues.length} lines committed, ${withheld} withheld by a gate that fired, ${corrected} sent back to the translator and fixed, ${fabrications} entity-gate hit${fabrications === 1 ? "" : "s"}. ${uncorroborated} line${uncorroborated === 1 ? " was" : "s were"} committed uncorroborated: ${ASR2} timed no words in ${uncorroborated === 1 ? "that window" : "those windows"} — it drops backchannels — so there was nothing to cross-check, and an absence of evidence is not a disagreement. hard_line is null: this run cannot mark its own homework.`,
      },
    },
    trail: [],
    delta_vs_cold: null,
    per_line: [],
  });

  // Proposal recording happens only after the complete evidence artifacts exist, so each
  // immutable proposal can bind the exact glossary, captions, and trace bytes it asks a
  // different actor to review. Creating a proposal changes no materialized memory.
  const memoryStore = join(ROOT, "memory/review");
  const ledger = await loadLedger({ store: memoryStore, workspaceRoot: ROOT });
  const proposalReceipts = [];
  for (const entry of glossary) {
    const prior = acceptedHead(ledger, {
      namespace: "language/ko/glossary",
      kind: "glossary",
      key: entry.term,
    });
    const { proposal } = await recordProposal({
      store: memoryStore,
      namespace: "language/ko/glossary",
      kind: "glossary",
      key: entry.term,
      value: entry,
      proposedBy: "context-01",
      evidencePaths: [
        `public/demo/runs/${RUN}/glossary.json`,
        `public/demo/runs/${RUN}/captions.json`,
        `public/demo/runs/${RUN}/traces.json`,
      ],
      supersedes: prior?.proposal_id ?? null,
      source: { run_id: RUN, clip_id: clip.id, pack_id: pack.id, artifact: "glossary.json" },
      workspaceRoot: ROOT,
    });
    proposalReceipts.push({
      proposal_id: proposal.proposal_id,
      proposal_content_id: contentIdForJson(proposal),
      namespace: proposal.namespace,
      kind: proposal.kind,
      key: proposal.key,
      status: "pending_review",
    });
    ledger.proposals.push(proposal);
  }
  const proposalManifestBody = {
    schema: "studio.memory.run-proposals.v1",
    run: RUN,
    clip: clip.id,
    status: "pending_review",
    proposals: proposalReceipts,
  };
  write("memory-proposals.json", {
    manifest_id: `memory-proposal-manifest:${contentIdForJson(proposalManifestBody)}`,
    ...proposalManifestBody,
  });

  console.log(`\n  ${RUN}: ${traces.length} traces · ${wall.toFixed(1)}s wall · ${committed} committed · ${withheld} withheld\n`);
}

main().catch((err) => die(err.stack ?? String(err)));
