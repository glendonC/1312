/**
 * A worker's workspace.
 *
 * Each role works in a different medium, so each gets a different environment: segment
 * lives in the waveform, context in the glossary, translate in a draft, qc in its gates.
 * This is the one renderer for all four, at two scales — the `cell` on a swarm node and
 * the `panel` in the opened drawer — so the miniature on the graph can never drift from
 * the thing it is a miniature of. Same fold, same fields, two densities.
 *
 * Every pixel is projected from that worker's own traces. A worker that has not drafted
 * anything yet says so; it does not show a plausible draft.
 */

import { motion } from "motion/react";

import { clock, pct } from "./format";
import type { AgentView } from "./replay";
import { useBundle } from "./store";
import type { RunBundle } from "./transport";

/** cell = the squircle on a swarm node. panel = the drawer. */
export type Scale = "cell" | "panel";

/** How much of a worker's history each scale has room to hold, newest last. */
const KEEP: Record<Scale, { marks: number; gloss: number; gates: number; peak: number }> = {
  cell: { marks: 3, gloss: 2, gates: 2, peak: 5 },
  panel: { marks: 6, gloss: 4, gates: 3, peak: 2 },
};

export default function Workspace({ agent, scale }: { agent: AgentView; scale: Scale }) {
  const bundle = useBundle();
  if (!bundle) return null;

  const keep = KEEP[scale];

  return (
    <div className="env" data-scale={scale} data-role={agent.role}>
      {agent.role === "segment" && <Segment agent={agent} bundle={bundle} keep={keep} />}
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
}: {
  agent: AgentView;
  bundle: RunBundle;
  keep: Keep;
}) {
  const duration = bundle.run.clip.duration;
  const peaks = bundle.wave.peaks.filter((_, i) => i % keep.peak === 0);

  return (
    <>
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

/** What this worker has looked up. Cross-run memory, arriving one term at a time. */
function Context({ agent, keep }: { agent: AgentView; keep: Keep }) {
  if (agent.gloss.length === 0) return <p className="env-empty">nothing looked up yet</p>;

  return (
    <>
      {agent.gloss.slice(-keep.gloss).map((g, i) => (
        <div className="env-row" key={`${g.term}-${i}`}>
          <b>{g.term}</b>
          <span>{g.gloss}</span>
        </div>
      ))}
    </>
  );
}

/**
 * The draft, and how much the worker believes it.
 *
 * The window is on the card because translate-01 and translate-02 do the same kind of
 * work on different halves of the clip, and a card that did not say which half would make
 * the mitosis unreadable.
 */
function Translate({ agent }: { agent: AgentView }) {
  const conf = agent.draft?.conf ?? 0;

  return (
    <>
      {agent.window && (
        <span className="env-win">
          {clock(agent.window[0])}–{clock(agent.window[1])}
        </span>
      )}

      {agent.draft ? (
        <>
          <p className="env-src">{agent.draft.source}</p>
          <p className="env-tgt">{agent.draft.target}</p>
        </>
      ) : (
        <p className="env-empty">no draft yet</p>
      )}

      <div className="env-conf">
        <span className="env-conf-track">
          <motion.span
            className="env-conf-fill"
            animate={{ width: pct(conf) }}
            transition={{ duration: 0.4 }}
          />
        </span>
        <span className="env-conf-val">{agent.draft ? conf.toFixed(2) : "—"}</span>
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
