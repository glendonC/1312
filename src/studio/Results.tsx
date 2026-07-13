import { motion } from "motion/react";
import { useEffect, useRef } from "react";

import { clock, rate, signed } from "./format";
import { useBundle, useStudio } from "./store";
import type { Cue, View } from "./types";

const VIEWS: { id: View; label: string }[] = [
  { id: "prepped", label: "1321" },
  { id: "baseline", label: "Cold" },
  { id: "diff", label: "Diff" },
];

export default function Results() {
  const bundle = useBundle();
  const view = useStudio((s) => s.view);
  const setView = useStudio((s) => s.setView);
  const reset = useStudio((s) => s.reset);
  const emitted = useStudio((s) => s.state.emitted);

  if (!bundle) return null;

  const { run, captions, score } = bundle;
  const prep = score.paths[run.id];
  const cold = score.paths["cold"];

  const note =
    view === "prepped"
      ? "What 1321 will stand behind. Lines it cannot are withheld, not guessed."
      : view === "baseline"
        ? "One-shot ASR into MT. No glossary, no gates. Fluent, confident, wrong."
        : "Same audio, both paths. Cold in red.";

  return (
    <motion.div
      className="results"
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1], delay: 0.15 }}
    >
      <Player />

      <div className="result-bar">
        <div className="seg" role="group" aria-label="Caption view">
          {VIEWS.map((v) => (
            <button
              key={v.id}
              type="button"
              className={`seg-btn${view === v.id ? " is-on" : ""}`}
              onClick={() => setView(v.id)}
            >
              {v.label}
            </button>
          ))}
        </div>
        <span className="result-note">{note}</span>
      </div>

      <div className="cues">
        {captions.cues.map((cue) => (
          <CueRow key={cue.id} cue={cue} view={view} target={run.pair.target} />
        ))}
      </div>

      <div className="scores">
        {/* A null score is not a zero. An unscored run prints "—" and says why: there is no
            gold for this clip, so a delta against cold is not a number we are entitled to. */}
        <Score
          value={rate(prep?.hard_line ?? null)}
          label="hard lines"
          sub={
            prep?.hard_line == null
              ? "unscored · no gold for this clip"
              : score.delta_vs_cold == null
                ? `cold delta unavailable · cold ${rate(cold?.hard_line ?? null)}`
                : `${signed(score.delta_vs_cold)} vs cold ${rate(cold?.hard_line ?? null)}`
          }
          good
        />
        <Score
          value={prep?.hallucinated == null ? "—" : String(prep.hallucinated)}
          label="fabrications"
          sub={
            cold?.hallucinated == null
              ? "entity gate · not gold-verified"
              : `cold made ${cold.hallucinated} on the same audio`
          }
          good
        />
        {/*
          Coverage is not a score, and this line exists to stop it being read as one. Both paths
          can land on the same number for opposite reasons: our gaps are lines we refused and gave
          a reason for, cold's are lines its recogniser never heard. A refusal and a miss look
          identical in a ratio and are nothing alike.
        */}
        <Score
          value={rate(prep?.coverage ?? null)}
          label="coverage"
          sub={
            cold?.coverage != null && cold.coverage < 1
              ? `${prep?.withheld ?? 0} withheld, each with a reason · cold ${rate(cold.coverage)}, but its gaps are lines it never heard`
              : `${prep?.withheld ?? 0} withheld, each with a reason · cold ${rate(cold?.coverage ?? null)} and never refuses anything`
          }
        />
        <Score
          value={clock(prep?.time_to_usable_s ?? 0)}
          label="time to first usable line"
          sub={
            prep?.time_to_complete_s == null
              ? `cold took ${clock(cold?.time_to_usable_s ?? 0)}`
              : `every line by ${clock(prep.time_to_complete_s)} · cold answers in one call, at ${clock(cold?.time_to_usable_s ?? 0)}`
          }
        />
      </div>

      <footer className="result-foot">
        <p className="caveat">{score.rubric.note}</p>
        <div className="foot-actions">
          <button type="button" className="ghost" onClick={reset}>
            Run again
          </button>
          <a className="cta" href="/benchmarks/">
            See the full bench &rarr;
          </a>
        </div>
      </footer>

      <details className="raw">
        <summary>
          Raw run — {emitted.length} agent actions, {run.agents.length} workers,{" "}
          {clock(run.wall_s)} wall
        </summary>
        <div className="raw-body">
          <div className="raw-log">
            {emitted.map((t, i) => (
              <div className="raw-row" key={i} data-level={t.level}>
                <b>{clock(t.t, true)}</b>
                <b>{t.agent}</b>
                <i>{t.action}</i>
                <span>
                  {t.target} {t.detail ? `— ${t.detail}` : ""}
                </span>
              </div>
            ))}
          </div>
          <p className="raw-links">
            <a href={`/demo/runs/${run.id}/captions.json`}>captions.json</a>
            <a href={`/demo/runs/${run.id}/corrections.json`}>corrections.json</a>
            <a href={`/demo/runs/${run.id}/traces.json`}>traces.json</a>
            <a href={`/demo/runs/${run.id}/score.json`}>score.json</a>
            <a href={`/demo/packs/${run.pack}.json`}>{run.pack}.json</a>
          </p>
        </div>
      </details>
    </motion.div>
  );
}

function Score({
  value,
  label,
  sub,
  good,
}: {
  value: string;
  label: string;
  sub: string;
  good?: boolean;
}) {
  return (
    <div className="score">
      <motion.span
        className={`score-val${good ? " is-good" : ""}`}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      >
        {value}
      </motion.span>
      <span className="score-key">{label}</span>
      <span className="score-sub">{sub}</span>
    </div>
  );
}

function CueRow({ cue, view, target }: { cue: Cue; view: View; target: string }) {
  const clipT = useStudio((s) => s.clipT);
  const setClipT = useStudio((s) => s.setClipT);

  const active = clipT >= cue.t_start && clipT < cue.t_end;
  const tgt = cue.targets.find((t) => t.lang === target);
  const cold = cue.baseline;

  const tags: { kind: string; text: string }[] = [];
  if (cue.hard && cue.error_type) tags.push({ kind: "type", text: cue.error_type });
  if (view !== "baseline" && tgt?.withheld) tags.push({ kind: "withheld", text: "withheld" });
  if (view !== "baseline" && cue.regression) tags.push({ kind: "regression", text: "regression" });
  if (view !== "baseline" && cue.recovered && !tgt?.withheld) {
    tags.push({ kind: "fixed", text: "recovered" });
  }

  return (
    <button
      type="button"
      className={`cue${active ? " is-active" : ""}`}
      onClick={() => setClipT(cue.t_start)}
    >
      <span className="cue-t">{clock(cue.t_start, true)}</span>
      <span className="cue-body">
        {view === "baseline" ? (
          <>
            {cold?.source.text && <span className="cue-src">{cold.source.text}</span>}
            {cold?.target.text && <span className="cue-tgt">{cold.target.text}</span>}
            {cue.silence && (
              <span className="cue-withheld">
                No speech here at all. The cold path captioned it anyway.
              </span>
            )}
          </>
        ) : (
          <>
            {cue.silence ? (
              <span className="cue-silence">
                {(cue.t_end - cue.t_start).toFixed(1)}s of silence · no caption emitted
              </span>
            ) : (
              <span className="cue-src">{cue.source.text}</span>
            )}

            {tgt?.withheld ? (
              <span className="cue-withheld">
                Withheld · {tgt.withheld.gate} gate · {tgt.withheld.reason}
              </span>
            ) : (
              tgt?.text && <span className="cue-tgt">{tgt.text}</span>
            )}

            {/* Only the hard lines. Cold paraphrases the easy ones fine, and showing
                those in red would bury the eight that actually break. */}
            {view === "diff" && cue.hard && cold?.target.text && (
              <span className="cue-cold">{cold.target.text}</span>
            )}
          </>
        )}

        {tags.length > 0 && (
          <span className="cue-tags">
            {tags.map((t) => (
              <span className="tag" key={t.text} data-kind={t.kind}>
                {t.text}
              </span>
            ))}
          </span>
        )}
      </span>
    </button>
  );
}

/** Media with a picture gets a screen. Media without one is just a transport. */
const HAS_PICTURE = /\.(mp4|webm|mov|m4v)$/i;

/**
 * The caption on the picture, at this instant of the clip.
 *
 * Which is where the argument gets settled. Everything else in this view is a list you can
 * study at your leisure; this is the thing a viewer actually experiences, and it is the only
 * place the two paths can be compared the way an audience would meet them. On Cold, a line
 * arrives for every window, fluent and certain. On 1321, some windows say we are not putting
 * anything here and why — which looks like less, and is worth more, because the alternative was
 * never silence, it was a confident sentence nobody could check.
 */
function Burned() {
  const bundle = useBundle();
  const view = useStudio((s) => s.view);
  const clipT = useStudio((s) => s.clipT);

  const cue = bundle?.captions.cues.find((c) => clipT >= c.t_start && clipT < c.t_end);
  if (!cue) return null;

  const cold = cue.baseline?.target.text ?? null;
  const tgt = cue.targets[0];

  if (view === "baseline") {
    return cold ? (
      <figcaption className="burn" data-path="cold">
        {cold}
      </figcaption>
    ) : null;
  }

  if (tgt?.withheld) {
    return (
      <figcaption className="burn" data-path="withheld">
        <span className="burn-mark">withheld</span>
        {tgt.withheld.reason}
        {view === "diff" && cold && <span className="burn-cold">Cold said: {cold}</span>}
      </figcaption>
    );
  }

  if (!tgt?.text) return null;

  return (
    <figcaption className="burn" data-path="prepped">
      {tgt.text}
      {view === "diff" && cue.hard && cold && <span className="burn-cold">Cold said: {cold}</span>}
    </figcaption>
  );
}

function Player() {
  const bundle = useBundle();
  const clipT = useStudio((s) => s.clipT);
  const setClipT = useStudio((s) => s.setClipT);
  const playing = useStudio((s) => s.playing);
  const setPlaying = useStudio((s) => s.setPlaying);

  const mediaRef = useRef<HTMLMediaElement | null>(null);
  const waveRef = useRef<HTMLDivElement>(null);
  const raf = useRef(0);

  const duration = bundle?.run.clip.duration ?? 0;
  const media = bundle?.run.clip.media;
  const src = media ? `/demo/runs/${bundle?.run.id}/${media}` : null;
  const picture = Boolean(media && HAS_PICTURE.test(media));

  // The store owns clip time. Push external seeks into the media element.
  useEffect(() => {
    const el = mediaRef.current;
    if (!el) return;
    if (Math.abs(el.currentTime - clipT) > 0.3) el.currentTime = clipT;
  }, [clipT]);

  useEffect(() => {
    const el = mediaRef.current;

    if (!playing) {
      el?.pause();
      cancelAnimationFrame(raf.current);
      return;
    }

    if (el) void el.play().catch(() => setPlaying(false));

    let last = performance.now();
    const tick = (now: number): void => {
      const dt = (now - last) / 1000;
      last = now;

      const next = el ? el.currentTime : useStudio.getState().clipT + dt;
      if (next >= duration) {
        setClipT(duration);
        setPlaying(false);
        return;
      }
      setClipT(next);
      raf.current = requestAnimationFrame(tick);
    };

    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [playing, duration, setClipT, setPlaying]);

  if (!bundle) return null;

  const { peaks } = bundle.wave;
  const { music, silence, source, title } = bundle.run.clip;

  function seek(e: React.MouseEvent<HTMLButtonElement>): void {
    const box = waveRef.current?.getBoundingClientRect();
    if (!box) return;
    setClipT(((e.clientX - box.left) / box.width) * duration);
  }

  const attach = (el: HTMLMediaElement | null): void => {
    mediaRef.current = el;
  };

  return (
    <div className="player">
      {src &&
        (picture ? (
          /*
           * The clip plays with the captions burned on, because that is the product — not a
           * table of lines beside a waveform, but real footage a real person could watch, with
           * the English this run is prepared to put on screen. And where it is not prepared to
           * put any, the screen says so instead of showing a guess.
           */
          <figure className="screen">
            <video
              ref={attach}
              className="screen-video"
              src={src}
              preload="auto"
              playsInline
              onClick={() => setPlaying(!playing)}
            />
            <Burned />
          </figure>
        ) : (
          <audio ref={attach} src={src} preload="auto" />
        ))}

      <div className="transport">
        <button
          type="button"
          className="play"
          onClick={() => setPlaying(!playing)}
          aria-label={playing ? "Pause" : "Play"}
        >
          {playing ? "❚❚" : "▶"}
        </button>

        <div className="wave" ref={waveRef}>
          <svg
            className="wave-svg"
            viewBox="0 0 1000 100"
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            {peaks.map((p, i) => {
              const step = 1000 / peaks.length;
              const h = Math.max(2, p * 88);
              return (
                <rect key={i} x={i * step} y={(100 - h) / 2} width={step * 0.6} height={h} rx={0.6} />
              );
            })}
          </svg>

          <div className="wave-regions" aria-hidden="true">
            {music.map(([a, b], i) => (
              <div
                key={`m${i}`}
                className="wave-region"
                data-kind="music"
                style={{ left: `${(a / duration) * 100}%`, width: `${((b - a) / duration) * 100}%` }}
              />
            ))}
            {silence.map(([a, b], i) => (
              <div
                key={`s${i}`}
                className="wave-region"
                data-kind="silence"
                style={{ left: `${(a / duration) * 100}%`, width: `${((b - a) / duration) * 100}%` }}
              />
            ))}
          </div>

          <div
            className="wave-head"
            style={{ left: `${(clipT / duration) * 100}%` }}
            aria-hidden="true"
          />
          <button type="button" className="wave-hit" onClick={seek} aria-label="Seek" />
        </div>

        <span className="player-time">
          {clock(clipT)} / {clock(duration)}
        </span>
      </div>

      {/*
       * The credit is a term of the licence, not a courtesy. Creative Commons is the only reason
       * this footage may be hosted here at all, and it is granted on condition the work is
       * attributed — so the attribution travels with the clip, wherever the clip is shown.
       */}
      {source.licence && (
        <p className="credit">
          <span className="credit-title">{title}</span> by {source.label} ·{" "}
          {source.url ? (
            <a href={source.url} target="_blank" rel="noreferrer noopener">
              {source.licence}
            </a>
          ) : (
            source.licence
          )}
        </p>
      )}
    </div>
  );
}
