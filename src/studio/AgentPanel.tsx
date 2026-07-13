/**
 * One worker, opened up: what it is doing right now, and everything it has ever done.
 *
 * The history is not stored anywhere special — it is the event log filtered by agent.
 * That is the payoff of making agent state a projection instead of component state.
 */

import { AnimatePresence, motion } from "motion/react";

import { clock, pct } from "./format";
import type { AgentView } from "./replay";
import { useAgent, useAgentHistory, useBundle, useStudio } from "./store";

export default function AgentPanel() {
  const selected = useStudio((s) => s.selected);
  const select = useStudio((s) => s.select);
  const agent = useAgent(selected ?? "");
  const history = useAgentHistory(selected);
  const orchestrator = useStudio((s) => s.state.orchestrator);
  const emitted = useStudio((s) => s.state.emitted);

  const isOrchestrator = selected === "orchestrator";
  const log = isOrchestrator ? emitted.filter((t) => t.agent === "orchestrator") : history;

  return (
    <AnimatePresence>
      {selected && (
        <motion.aside
          className="drawer"
          initial={{ opacity: 0, x: 24 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: 24 }}
          transition={{ type: "spring", stiffness: 260, damping: 30 }}
        >
          <header className="drawer-head">
            <span
              className="drawer-dot"
              data-status={isOrchestrator ? orchestrator.status : (agent?.status ?? "spawning")}
            />
            <h2>{selected}</h2>
            <span className="drawer-status">
              {isOrchestrator ? orchestrator.status : (agent?.status ?? "—")}
            </span>
            <button type="button" className="drawer-close" onClick={() => select(null)} aria-label="Close">
              ×
            </button>
          </header>

          {isOrchestrator ? (
            <p className="drawer-note">{orchestrator.note}</p>
          ) : (
            agent && <Env agent={agent} />
          )}

          <h3 className="drawer-sub">
            History · {log.length} action{log.length === 1 ? "" : "s"}
          </h3>

          <div className="drawer-log">
            {log.map((t, i) => (
              <div className="log-row" key={i} data-level={t.level}>
                <span className="log-t">{clock(t.t, true)}</span>
                <span className="log-action">{t.action}</span>
                <span className="log-target">{t.target}</span>
                <span className="log-detail">{t.detail}</span>
              </div>
            ))}
            {log.length === 0 && <p className="drawer-note">Nothing yet.</p>}
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}

/** Each role works in a different medium, so each gets a different environment. */
function Env({ agent }: { agent: AgentView }) {
  const bundle = useBundle();
  if (!bundle) return null;

  const duration = bundle.run.clip.duration;

  if (agent.role === "segment") {
    const peaks = bundle.wave.peaks.filter((_, i) => i % 2 === 0);
    return (
      <div className="env">
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
        <div className="env-marks">
          {agent.marks.map((m, i) => (
            <span className="mark" key={`${m.label}-${i}`} data-hard={m.hard}>
              {m.label}
            </span>
          ))}
        </div>
      </div>
    );
  }

  if (agent.role === "context") {
    return (
      <div className="env">
        {agent.gloss.map((g, i) => (
          <div className="env-row" key={`${g.term}-${i}`}>
            <b>{g.term}</b>
            <span>{g.gloss}</span>
          </div>
        ))}
        {agent.gloss.length === 0 && <p className="drawer-note">Nothing looked up yet.</p>}
      </div>
    );
  }

  if (agent.role === "translate") {
    return (
      <div className="env">
        <p className="env-src">{agent.draft?.source ?? "—"}</p>
        <p className="env-tgt">{agent.draft?.target ?? "—"}</p>
        <div className="env-conf">
          <span className="env-conf-track">
            <motion.span
              className="env-conf-fill"
              animate={{ width: pct(agent.draft?.conf ?? 0) }}
              transition={{ duration: 0.4 }}
            />
          </span>
          <span className="env-conf-val">{agent.draft ? agent.draft.conf.toFixed(2) : "—"}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="env">
      {agent.gates.map((g, i) => (
        <div className="env-gate" key={`${g.name}-${i}`} data-fail={g.fail}>
          <span className="env-gate-name">
            {g.name} <i data-scope={g.scope}>{g.scope === "universal" ? "univ" : bundle.run.pair.source}</i>
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
      {agent.stamp && (
        <motion.span
          className="stamp"
          data-kind={agent.stamp.kind}
          initial={{ opacity: 0, scale: 0.85 }}
          animate={{ opacity: 1, scale: 1 }}
        >
          {agent.stamp.text}
        </motion.span>
      )}
      {agent.gates.length === 0 && <p className="drawer-note">No gate has fired yet.</p>}
    </div>
  );
}
