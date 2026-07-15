/**
 * One worker, opened up: what it is doing right now, and everything it has ever done.
 *
 * The canvas keeps the agent legible as an identity. This drawer is where its workspace and
 * history become readable. The history is the event log filtered by agent, not separate UI
 * state, so opening a worker cannot change what it has done.
 */

import { AnimatePresence, motion } from "motion/react";

import { clock } from "./format";
import { useAgent, useAgentHistory, useStudio } from "./store";
import Workspace from "./Workspace";

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
            agent && <Workspace agent={agent} scale="panel" />
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
