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
        <Score
          value={rate(prep?.coverage ?? null)}
          label="coverage"
          sub={`${prep?.withheld ?? 0} withheld · cold reads 1.00 because it never withholds`}
        />
        <Score
          value={clock(prep?.time_to_usable_s ?? 0)}
          label="time to usable"
          sub={`cold took ${clock(cold?.time_to_usable_s ?? 0)}`}
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

function Player() {
  const bundle = useBundle();
  const clipT = useStudio((s) => s.clipT);
  const setClipT = useStudio((s) => s.setClipT);
  const playing = useStudio((s) => s.playing);
  const setPlaying = useStudio((s) => s.setPlaying);

  const audioRef = useRef<HTMLAudioElement>(null);
  const waveRef = useRef<HTMLDivElement>(null);
  const raf = useRef(0);

  const duration = bundle?.run.clip.duration ?? 0;
  const media = bundle?.run.clip.media;
  const src = media ? `/demo/runs/${bundle?.run.id}/${media}` : null;

  // The store owns clip time. Push external seeks into the media element.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (Math.abs(audio.currentTime - clipT) > 0.3) audio.currentTime = clipT;
  }, [clipT]);

  useEffect(() => {
    const audio = audioRef.current;

    if (!playing) {
      audio?.pause();
      cancelAnimationFrame(raf.current);
      return;
    }

    if (audio) void audio.play().catch(() => setPlaying(false));

    let last = performance.now();
    const tick = (now: number): void => {
      const dt = (now - last) / 1000;
      last = now;

      const next = audio ? audio.currentTime : useStudio.getState().clipT + dt;
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
  const { music, silence } = bundle.run.clip;

  function seek(e: React.MouseEvent<HTMLButtonElement>): void {
    const box = waveRef.current?.getBoundingClientRect();
    if (!box) return;
    setClipT(((e.clientX - box.left) / box.width) * duration);
  }

  return (
    <div className="player">
      {src && <audio ref={audioRef} src={src} preload="auto" />}

      <button
        type="button"
        className="play"
        onClick={() => setPlaying(!playing)}
        aria-label={playing ? "Pause" : "Play"}
      >
        {playing ? "❚❚" : "▶"}
      </button>

      <div className="wave" ref={waveRef}>
        <svg className="wave-svg" viewBox="0 0 1000 100" preserveAspectRatio="none" aria-hidden="true">
          {peaks.map((p, i) => {
            const step = 1000 / peaks.length;
            const h = Math.max(2, p * 88);
            return (
              <rect
                key={i}
                x={i * step}
                y={(100 - h) / 2}
                width={step * 0.6}
                height={h}
                rx={0.6}
              />
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

        <div className="wave-head" style={{ left: `${(clipT / duration) * 100}%` }} aria-hidden="true" />
        <button type="button" className="wave-hit" onClick={seek} aria-label="Seek" />
      </div>

      <span className="player-time">
        {clock(clipT)} / {clock(duration)}
      </span>
    </div>
  );
}
