import { motion } from "motion/react";
import { useEffect, useRef, useState } from "react";

import { clock, rate, signed } from "./format";
import RecordedEvidence from "./evidence/RecordedEvidence";
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
  const outputDepth = useStudio((s) => s.outputDepth);

  if (!bundle) return null;

  const { run, captions, score } = bundle;
  const prep = score.paths[run.id];
  const cold = score.paths["cold"];
  const showEvidence = outputDepth === "evidence";
  const hasComparison = showEvidence && Boolean(cold && captions.cues.some((cue) => cue.baseline));
  const accuracyMeasured = Boolean(
    score.status !== "unscored" && prep?.hard_line != null && cold?.hard_line != null,
  );
  const views = hasComparison ? VIEWS : VIEWS.filter((candidate) => candidate.id === "prepped");
  const activeView = hasComparison ? view : "prepped";

  const note =
    activeView === "prepped"
      ? showEvidence
        ? "What 1321 will stand behind. Lines it cannot are withheld, not guessed."
        : "Caption result only. Withheld lines remain visible because absence is part of the result."
      : activeView === "baseline"
        ? accuracyMeasured
          ? "One-shot ASR into MT. No glossary and no gates. Accuracy is measured against this fixture's reference."
          : "Recorded comparison output. Accuracy is unscored because this clip has no reference."
        : accuracyMeasured
          ? "Same audio and measured reference, with comparison differences marked."
          : "Same audio and two recorded outputs. Differences are visible, but neither is marked right or wrong.";

  return (
    <motion.div
      className="results"
      data-accuracy={accuracyMeasured ? "measured" : "unscored"}
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1], delay: 0.15 }}
    >
      <Player />

      <div className="result-bar">
        <div className="seg" role="group" aria-label="Caption view">
          {views.map((v) => (
            <button
              key={v.id}
              type="button"
              className={`seg-btn${activeView === v.id ? " is-on" : ""}`}
              onClick={() => setView(v.id)}
            >
              {v.label}
            </button>
          ))}
        </div>
        <span className="result-note">{note}</span>
      </div>

      <div className="cues">
        {captions.cues.length === 0 ? (
          <p className="cues-empty">No caption cues were recorded. No transcript or result is implied.</p>
        ) : (
          captions.cues.map((cue) => (
            <CueRow key={cue.id} cue={cue} view={activeView} target={run.pair.target} />
          ))
        )}
      </div>

      {showEvidence && <div className="scores">
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
          good={prep?.hard_line != null}
        />
        <Score
          value={prep?.hallucinated == null ? "—" : String(prep.hallucinated)}
          label="fabrications"
          sub={
            cold?.hallucinated == null
              ? "entity gate · not gold-verified"
              : `cold made ${cold.hallucinated} on the same audio`
          }
          good={prep?.hallucinated != null}
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
          sub={coverageNote(prep?.withheld ?? null, cold?.coverage ?? null)}
        />
        <Score
          value={time(prep?.time_to_usable_s ?? null)}
          label="time to first usable line"
          sub={timingNote(prep?.time_to_complete_s ?? null, cold?.time_to_usable_s ?? null)}
        />
      </div>}

      {showEvidence && <RecordedEvidence />}

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

      {showEvidence && <details className="raw">
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
          {run.artifacts.length > 0 ? (
            <p className="raw-links">
              {run.artifacts.map((artifact) => (
                <a key={artifact} href={`/demo/runs/${run.id}/${artifact}`}>
                  {artifact}
                </a>
              ))}
              <a href={`/demo/packs/${run.pack}.json`}>{run.pack}.json</a>
            </p>
          ) : (
            <p className="raw-empty">No artifact links were declared by this run.</p>
          )}
        </div>
      </details>}
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

function time(value: number | null): string {
  return value === null ? "—" : clock(value);
}

function coverageNote(withheld: number | null, coldCoverage: number | null): string {
  const withheldText = withheld === null ? "withheld count unavailable" : `${withheld} withheld, each with a reason`;
  if (coldCoverage === null) return `${withheldText} · comparison coverage unavailable`;
  return coldCoverage < 1
    ? `${withheldText} · cold ${rate(coldCoverage)}, but its gaps are lines it never heard`
    : `${withheldText} · cold ${rate(coldCoverage)} and never refuses anything`;
}

function timingNote(completed: number | null, coldUsable: number | null): string {
  const coldText = coldUsable === null ? "comparison timing unavailable" : `cold answered at ${clock(coldUsable)}`;
  return completed === null ? coldText : `every line by ${clock(completed)} · ${coldText}`;
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
  const tgt = cue.targets.find((target) => target.lang === bundle?.run.pair.target);

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
  const raf = useRef(0);
  const [mediaFailed, setMediaFailed] = useState(false);

  const duration = bundle?.run.clip.duration ?? 0;
  const media = bundle?.run.clip.media;
  const src = media ? `/demo/runs/${bundle?.run.id}/${media}` : null;
  const picture = Boolean(media && HAS_PICTURE.test(media));

  useEffect(() => setMediaFailed(false), [src]);

  // The store owns clip time. Push external seeks into the media element.
  useEffect(() => {
    const el = mediaRef.current;
    if (!el) return;
    if (Math.abs(el.currentTime - clipT) > 0.3) el.currentTime = clipT;
  }, [clipT]);

  useEffect(() => {
    const el = mediaRef.current;

    if (!playing || !src || mediaFailed) {
      el?.pause();
      cancelAnimationFrame(raf.current);
      if (playing && (!src || mediaFailed)) setPlaying(false);
      return;
    }

    if (el) void el.play().catch(() => setPlaying(false));

    let last = performance.now();
    const tick = (now: number): void => {
      const dt = (now - last) / 1000;
      last = now;

      const next = el?.currentTime ?? useStudio.getState().clipT + dt;
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
  }, [playing, duration, mediaFailed, setClipT, setPlaying, src]);

  if (!bundle) return null;

  const { peaks } = bundle.wave;
  const { music, silence, source, title } = bundle.run.clip;

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
              onError={() => {
                setMediaFailed(true);
                setPlaying(false);
              }}
            />
            <Burned />
          </figure>
        ) : (
          <audio
            ref={attach}
            src={src}
            preload="auto"
            onError={() => {
              setMediaFailed(true);
              setPlaying(false);
            }}
          />
        ))}

      {!src && <p className="media-empty">No playable media artifact was recorded for this run.</p>}
      {mediaFailed && <p className="media-empty">The recorded media could not be loaded. Captions remain inspectable.</p>}

      <div className="transport">
        <button
          type="button"
          className="play"
          onClick={() => setPlaying(!playing)}
          disabled={!src || mediaFailed}
          aria-label={playing ? "Pause" : "Play"}
        >
          {playing ? "❚❚" : "▶"}
        </button>

        {peaks.length > 0 && duration > 0 ? (
        <div className="wave">
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
          <input
            type="range"
            className="wave-hit"
            min={0}
            max={duration}
            step={0.1}
            value={clipT}
            onChange={(event) => setClipT(event.currentTarget.valueAsNumber)}
            aria-label="Seek through clip"
            aria-valuetext={`${clock(clipT)} of ${clock(duration)}`}
          />
        </div>
        ) : (
          <p className="wave-empty">No waveform samples were recorded.</p>
        )}

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
