/**
 * A worker's workspace.
 *
 * Each role works in a different medium, so each gets a different environment: segment
 * lives in the waveform, context in the glossary, translate in a draft, qc in its gates.
 * This is the one renderer for all four, at two scales: `cell` for a compact view and
 * `focus` for expanded inspection. Same fold, same fields, two densities.
 *
 * Every pixel is projected from that worker's own traces. A worker that has not drafted
 * anything yet says so; it does not show a plausible draft.
 */

import { motion } from "motion/react";
import { useEffect, useRef, useState } from "react";

import { clock, pct } from "./format";
import type { AgentView } from "./replay";
import { useBundle, useStudio } from "./store";
import type { RunBundle } from "./transport";

/** cell = a compact workspace. focus = the expanded inspection plane. */
export type Scale = "cell" | "focus";

/** How much of a worker's history each scale has room to hold, newest last. */
const KEEP: Record<Scale, { marks: number; gloss: number; gates: number; peak: number }> = {
  cell: { marks: 3, gloss: 2, gates: 2, peak: 5 },
  focus: { marks: 8, gloss: 12, gates: 6, peak: 2 },
};

export default function Workspace({ agent, scale }: { agent: AgentView; scale: Scale }) {
  const bundle = useBundle();
  if (!bundle) return null;

  const keep = KEEP[scale];

  return (
    <div className="env" data-scale={scale} data-role={agent.role}>
      {agent.role === "segment" && (
        <Segment agent={agent} bundle={bundle} keep={keep} scale={scale} />
      )}
      {agent.role === "context" && <Context agent={agent} keep={keep} />}
      {agent.role === "translate" && <Translate agent={agent} />}
      {agent.role === "qc" && <Gates agent={agent} bundle={bundle} keep={keep} />}
    </div>
  );
}

type Keep = (typeof KEEP)[Scale];

/** The clip's own waveform, with this worker's playhead on it and the lines it flagged. */
function Segment({
  agent,
  bundle,
  keep,
  scale,
}: {
  agent: AgentView;
  bundle: RunBundle;
  keep: Keep;
  scale: Scale;
}) {
  const duration = bundle.run.clip.duration;
  const peaks = bundle.wave.peaks.filter((_, i) => i % keep.peak === 0);

  return (
    <>
      {scale === "focus" && <RecordedMedia bundle={bundle} agentPlayhead={agent.playhead} />}

      <div className="env-wave">
        <svg viewBox={`0 0 ${peaks.length * 4} 100`} preserveAspectRatio="none" aria-hidden="true">
          {peaks.map((p, i) => {
            const h = Math.max(2, p * 84);
            return <rect key={i} x={i * 4} y={(100 - h) / 2} width={2.4} height={h} rx={0.8} />;
          })}
        </svg>
        {agent.playhead !== null && (
          <motion.div
            className="env-head"
            animate={{ left: `${(agent.playhead / duration) * 100}%` }}
            transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
          />
        )}
      </div>

      {agent.marks.length > 0 ? (
        <div className="env-marks">
          {agent.marks.slice(-keep.marks).map((m, i) => (
            <span className="mark" key={`${m.label}-${i}`} data-hard={m.hard}>
              {m.label}
            </span>
          ))}
        </div>
      ) : (
        <p className="env-empty">
          {agent.playhead === null ? "not scrubbing yet" : `at ${clock(agent.playhead)}`}
        </p>
      )}
    </>
  );
}

const HAS_PICTURE = /\.(?:mp4|webm|mov|m4v)$/i;

/**
 * A viewer for the media artifact in this run, not a reconstruction of an agent tool.
 *
 * The inspection cursor belongs to the person opening focus mode. The separate marker below
 * remains the agent's recorded playhead, so scrubbing the clip cannot rewrite what the worker did.
 */
function RecordedMedia({
  bundle,
  agentPlayhead,
}: {
  bundle: RunBundle;
  agentPlayhead: number | null;
}) {
  const clipT = useStudio((state) => state.clipT);
  const setClipT = useStudio((state) => state.setClipT);
  const setGlobalPlaying = useStudio((state) => state.setPlaying);
  const mediaRef = useRef<HTMLMediaElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [failed, setFailed] = useState(false);
  const duration = bundle.run.clip.duration;
  const media = bundle.run.clip.media;
  const src = media ? `/demo/runs/${bundle.run.id}/${media}` : null;
  const picture = Boolean(media && HAS_PICTURE.test(media));
  const cue = bundle.captions.cues.find(
    (candidate) => clipT >= candidate.t_start && clipT < candidate.t_end,
  );

  useEffect(() => {
    const element = mediaRef.current;
    if (!element || Math.abs(element.currentTime - clipT) <= 0.25) return;
    element.currentTime = clipT;
  }, [clipT]);

  useEffect(() => {
    setGlobalPlaying(false);
    return () => {
      mediaRef.current?.pause();
    };
  }, [setGlobalPlaying]);

  const seek = (next: number) => {
    setClipT(Math.max(0, Math.min(duration, next)));
  };

  const toggle = () => {
    const element = mediaRef.current;
    if (!element || failed) return;
    if (element.paused) {
      void element.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
    } else {
      element.pause();
      setPlaying(false);
    }
  };

  return (
    <section className="env-media" aria-label="Recorded clip inspection">
      <div className="env-media-frame">
        {src && picture && (
          <video
            ref={(element) => {
              mediaRef.current = element;
            }}
            src={src}
            preload="metadata"
            playsInline
            onClick={toggle}
            onTimeUpdate={(event) => setClipT(event.currentTarget.currentTime)}
            onPause={() => setPlaying(false)}
            onEnded={() => setPlaying(false)}
            onError={() => {
              setFailed(true);
              setPlaying(false);
            }}
            aria-label="Recorded source video"
          />
        )}

        {src && !picture && (
          <audio
            ref={(element) => {
              mediaRef.current = element;
            }}
            src={src}
            preload="metadata"
            onTimeUpdate={(event) => setClipT(event.currentTarget.currentTime)}
            onPause={() => setPlaying(false)}
            onEnded={() => setPlaying(false)}
            onError={() => {
              setFailed(true);
              setPlaying(false);
            }}
          />
        )}

        {(!src || failed) && (
          <p className="env-media-unavailable">
            {failed ? "The recorded media could not be loaded." : "No playable media was recorded."}
          </p>
        )}

        {cue && (
          <div className="env-media-caption" aria-live="polite">
            <span>Recorded transcript</span>
            <p lang={bundle.run.pair.source}>{cue.source.text}</p>
          </div>
        )}
      </div>

      <div className="env-media-transport">
        <button
          type="button"
          onClick={() => seek(clipT - 5)}
          disabled={!src || failed}
          aria-label="Back 5 seconds"
        >
          −5
        </button>
        <button
          type="button"
          className="env-media-play"
          onClick={toggle}
          disabled={!src || failed}
          aria-label={playing ? "Pause recorded clip" : "Play recorded clip"}
        >
          {playing ? "Pause" : "Play"}
        </button>
        <button
          type="button"
          onClick={() => seek(clipT + 5)}
          disabled={!src || failed}
          aria-label="Forward 5 seconds"
        >
          +5
        </button>
        <input
          type="range"
          min={0}
          max={duration}
          step={0.1}
          value={clipT}
          onChange={(event) => seek(event.currentTarget.valueAsNumber)}
          disabled={!src || failed}
          aria-label="Inspect recorded clip"
          aria-valuetext={`${clock(clipT)} of ${clock(duration)}`}
        />
        <time>{clock(clipT)} / {clock(duration)}</time>
      </div>

      <p className="env-media-boundary">
        Inspection cursor {clock(clipT)}
        <span aria-hidden="true"> / </span>
        Agent playhead {agentPlayhead === null ? "not recorded yet" : clock(agentPlayhead)}
      </p>
    </section>
  );
}

/** What this worker has looked up. Cross-run memory, arriving one term at a time. */
function Context({ agent, keep }: { agent: AgentView; keep: Keep }) {
  if (agent.gloss.length === 0) {
    return (
      <div className="env-context-empty">
        <p className="env-empty">Nothing resolved yet.</p>
        <p>No browser session was recorded for this run.</p>
      </div>
    );
  }

  return (
    <>
      <div className="env-context-list">
        {agent.gloss.slice(-keep.gloss).map((g, i) => (
          <div className="env-row" key={`${g.term}-${i}`}>
            <b>{g.term}</b>
            <span>{g.gloss}</span>
          </div>
        ))}
      </div>
      <p className="env-context-boundary">
        These terms came from transcript resolution. No browser session or visited pages were recorded.
      </p>
    </>
  );
}

/**
 * The draft, and how far a SECOND recogniser backs up the Korean it was translated from.
 *
 * The bar is not confidence. No model here is asked how sure it is — they return no logprobs,
 * and a model's estimate of its own correctness is the wrong-fluent failure this instrument
 * exists to catch, printed next to the caption as if it were evidence. So the number is
 * agreement between two independent recognisers that heard the same audio, which is a
 * measurement, and the label says "agreement" so it can never be read as the other thing.
 *
 * It is null when the second recogniser said nothing about the window at all — it drops
 * backchannels, so a clearly-spoken "네" gets no token against it. That is an absence of
 * evidence, and it renders as words rather than as an empty bar: a bar at zero would read as
 * "no confidence", which is a finding, and we did not make one.
 *
 * The window is on the card because translate-01 and translate-02 do the same kind of work on
 * different halves of the clip, and a card that did not say which half would make the mitosis
 * unreadable.
 */
function Translate({ agent }: { agent: AgentView }) {
  const bundle = useBundle();
  const draft = agent.draft;
  const cue = draft
    ? bundle?.captions.cues.find((candidate) => candidate.source.text === draft.source)
    : undefined;
  const agreementRecorded = Boolean(cue?.corroboration);
  const agreement = agreementRecorded ? (draft?.conf ?? null) : null;

  return (
    <>
      {agent.window && (
        <span className="env-win">
          {clock(agent.window[0])}–{clock(agent.window[1])}
        </span>
      )}

      {draft ? (
        <>
          <p className="env-src">{draft.source}</p>
          <p className="env-tgt">{draft.target}</p>
        </>
      ) : (
        <p className="env-empty">no draft yet</p>
      )}

      <div
        className="env-conf"
        title="Agreement between two independent recognisers on this window. Not a model's confidence in itself."
      >
        <span className="env-conf-key">agreement</span>

        {agreement === null ? (
          <span className="env-conf-none">
            {draft ? (agreementRecorded ? "not corroborated" : "not measured") : "—"}
          </span>
        ) : (
          <>
            <span className="env-conf-track">
              <motion.span
                className="env-conf-fill"
                animate={{ width: pct(agreement) }}
                transition={{ duration: 0.4 }}
              />
            </span>
            <span className="env-conf-val">{agreement.toFixed(2)}</span>
          </>
        )}
      </div>
    </>
  );
}

/** The gates this worker has fired, and the stamp it put on the line. */
function Gates({ agent, bundle, keep }: { agent: AgentView; bundle: RunBundle; keep: Keep }) {
  if (agent.gates.length === 0 && !agent.stamp) {
    return <p className="env-empty">no gate has fired yet</p>;
  }

  return (
    <>
      {agent.gates.slice(-keep.gates).map((g, i) => (
        <div className="env-gate" key={`${g.name}-${i}`} data-fail={g.fail}>
          <span className="env-gate-name">
            {g.name}{" "}
            <i data-scope={g.scope}>{g.scope === "universal" ? "univ" : bundle.run.pair.source}</i>
          </span>
          <span className="env-gate-val">
            {g.value.toFixed(2)} / {g.limit.toFixed(2)}
          </span>
          <span className="env-gate-track">
            <motion.span
              className="env-gate-fill"
              animate={{ width: pct(Math.min(1, g.value)) }}
              transition={{ duration: 0.4 }}
            />
          </span>
        </div>
      ))}

      {agent.stamp && <Stamp kind={agent.stamp.kind} text={agent.stamp.text} />}
    </>
  );
}

function Stamp({ kind, text }: { kind: string; text: string }) {
  return (
    <motion.span
      className="stamp"
      data-kind={kind}
      initial={{ opacity: 0, scale: 0.85 }}
      animate={{ opacity: 1, scale: 1 }}
    >
      {text}
    </motion.span>
  );
}
