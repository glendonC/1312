import { motion } from "motion/react";
import { useEffect, useRef, useState } from "react";

import { clock } from "./format";
import RecordedEvidence from "./evidence/RecordedEvidence";
import { RECORDED_RESULTS_ID } from "./resultAccess";
import { useBundle, useStudio } from "./store";
import type { Cue } from "./types";

/**
 * The result of a run: the media you can watch, and the timed Korean→English transcript it will
 * stand behind. Lines it cannot stand behind are shown as labelled gaps — withheld with a reason,
 * or silence — never a guess. Coverage, receipts, and raw files sit under progressive disclosure.
 *
 * Deliberately absent: accuracy scores, cold/diff comparison, timing, and agent/worker counts.
 * None of those are produced for a real request — they belong to the benchmark lane, not here.
 */
export default function Results() {
  const bundle = useBundle();
  const reset = useStudio((s) => s.reset);
  const outputDepth = useStudio((s) => s.outputDepth);
  const previewSession = useStudio((s) => s.previewSession);

  if (!bundle) return null;

  const { run, captions } = bundle;
  const target = run.pair.target;
  const showEvidence = outputDepth === "evidence";

  // Real per-line accounting, straight from the recorded cues. A refusal and a silence are
  // different facts and are counted as different things; neither is an error.
  const counts = { captioned: 0, withheld: 0, silent: 0 };
  for (const cue of captions.cues) {
    if (cue.silence) {
      counts.silent += 1;
      continue;
    }
    const tgt = cue.targets.find((t) => t.lang === target);
    if (tgt?.withheld) counts.withheld += 1;
    else if (tgt?.text) counts.captioned += 1;
  }

  const licence = run.clip.source.licence;

  return (
    <motion.div
      id={RECORDED_RESULTS_ID}
      className="results"
      role="region"
      aria-label="Result"
      tabIndex={-1}
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1], delay: 0.15 }}
    >
      {previewSession?.preparation.status === "ready" && (
        <SubmittedSourceResultBoundary
          previewSession={previewSession}
          recordedRunId={run.id}
          recordedTitle={run.clip.title}
        />
      )}

      <header className="result-head">
        <span className="result-kicker">Result</span>
        <h2>{run.clip.title}</h2>
        <p className="result-request">
          <b>{run.pair.source.toUpperCase()} → {target.toUpperCase()}</b>
          <span aria-hidden="true">·</span>
          {clock(0)}–{clock(run.clip.duration)}
          <span aria-hidden="true">·</span>
          recorded evidence
        </p>
      </header>

      <div className="result-main">
        <Player />

        <div className="cues" aria-label="Korean to English transcript">
          {captions.cues.length === 0 ? (
            <p className="cues-empty">No caption cues were recorded. No transcript or result is implied.</p>
          ) : (
            captions.cues.map((cue) => <CueRow key={cue.id} cue={cue} target={target} />)
          )}
        </div>
      </div>

      <div className="result-completeness">
        <div className="result-completeness-cell">
          <b>Coverage</b>
          <span>{counts.captioned} captioned · {counts.withheld} withheld · {counts.silent} silent</span>
          <small>of {captions.cues.length} lines in range</small>
        </div>
        <div className="result-completeness-cell">
          <b>Withheld</b>
          <span>refusals with a reason</span>
          <small>shown, not errors — and not a translation-quality score</small>
        </div>
        <div className="result-completeness-cell">
          <b>Source</b>
          <span>{run.clip.source.label}</span>
          <small>{licence ? `${licence} · recorded` : "recorded evidence"}</small>
        </div>
      </div>

      {showEvidence && (
        <details className="result-provenance">
          <summary>Evidence &amp; run files</summary>
          <RecordedEvidence />
          {run.artifacts.length > 0 ? (
            <p className="result-provenance-links">
              {run.artifacts.map((artifact) => (
                <a key={artifact} href={`/demo/runs/${run.id}/${artifact}`}>
                  {artifact}
                </a>
              ))}
              <a href={`/demo/packs/${run.pack}.json`}>{run.pack}.json</a>
            </p>
          ) : (
            <p className="result-provenance-empty">No artifact links were declared by this run.</p>
          )}
        </details>
      )}

      <footer className="result-foot">
        <button type="button" className="ghost" onClick={reset}>
          Run again
        </button>
      </footer>
    </motion.div>
  );
}

function SubmittedSourceResultBoundary({
  previewSession,
  recordedRunId,
  recordedTitle,
}: {
  previewSession: NonNullable<ReturnType<typeof useStudio.getState>["previewSession"]>;
  recordedRunId: string;
  recordedTitle: string;
}) {
  if (!previewSession.resolution || previewSession.preparation.status !== "ready") return null;
  const { resolution } = previewSession;
  const request = previewSession.preparation.request;
  const sourceLanguage = request.language.source.mode === "automatic"
    ? "Automatic requested · detection never started"
    : `${request.language.source.language} · user declared`;
  return (
    <section
      className="submitted-results-boundary"
      aria-labelledby="submitted-results-title"
      data-submitted-preparation-request-id={request.requestId}
    >
      <header>
        <span>Submitted source outcome</span>
        <h2 id="submitted-results-title">No submitted-source artifact exists</h2>
        <p>
          Studio preserved the request for <b>{resolution.source.label}</b>, but the submitted URL was not downloaded,
          registered, analyzed, captioned, or translated.
        </p>
      </header>
      <dl>
        <div><dt>Selected range</dt><dd>{clock(request.range.startMs / 1_000)}–{clock(request.range.endMs / 1_000)}</dd></div>
        <div><dt>Source language</dt><dd>{sourceLanguage}</dd></div>
        <div><dt>Requested target</dt><dd>{request.language.target}</dd></div>
        <div><dt>Artifact status</dt><dd>Unavailable · no runtime receipt</dd></div>
      </dl>
      <p className="submitted-results-identity">
        <span>Preparation identity</span>
        <code>{request.requestId}</code>
      </p>
      <p className="submitted-results-demo-boundary" role="note">
        <b>Recorded demo Results below</b>
        The player, captions, and evidence below belong only to {recordedRunId}: {recordedTitle}.
      </p>
    </section>
  );
}

function CueRow({ cue, target }: { cue: Cue; target: string }) {
  const clipT = useStudio((s) => s.clipT);
  const setClipT = useStudio((s) => s.setClipT);

  const active = clipT >= cue.t_start && clipT < cue.t_end;
  const tgt = cue.targets.find((t) => t.lang === target);

  return (
    <button
      type="button"
      className={`cue${active ? " is-active" : ""}`}
      data-withheld={tgt?.withheld ? "true" : undefined}
      data-silence={cue.silence ? "true" : undefined}
      onClick={() => setClipT(cue.t_start)}
    >
      <span className="cue-t">{clock(cue.t_start, true)}</span>
      <span className="cue-body">
        {cue.silence ? (
          <span className="cue-silence">
            {(cue.t_end - cue.t_start).toFixed(1)}s of silence · no caption emitted
          </span>
        ) : (
          <>
            <span className="cue-src">{cue.source.text}</span>

            {tgt?.withheld ? (
              <span className="cue-withheld">
                <span className="cue-withheld-mark">withheld</span>
                {tgt.withheld.reason}
              </span>
            ) : (
              tgt?.text && <span className="cue-tgt">{tgt.text}</span>
            )}
          </>
        )}
      </span>
    </button>
  );
}

/** Media with a picture gets a screen. Media without one is just a transport. */
const HAS_PICTURE = /\.(mp4|webm|mov|m4v)$/i;

/**
 * The caption on the picture, at this instant of the clip. Where it will not put a line, the
 * screen says so — withheld, with the reason — instead of showing a guess.
 */
function Burned() {
  const bundle = useBundle();
  const clipT = useStudio((s) => s.clipT);

  const cue = bundle?.captions.cues.find((c) => clipT >= c.t_start && clipT < c.t_end);
  if (!cue || cue.silence) return null;

  const tgt = cue.targets.find((target) => target.lang === bundle?.run.pair.target);

  if (tgt?.withheld) {
    return (
      <figcaption className="burn" data-path="withheld">
        <span className="burn-mark">withheld</span>
        {tgt.withheld.reason}
      </figcaption>
    );
  }

  if (!tgt?.text) return null;

  return (
    <figcaption className="burn" data-path="prepped">
      {tgt.text}
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
