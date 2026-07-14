import { motion } from "motion/react";

import AgentMark from "./AgentMark";
import { ORCHESTRATOR_IDENTITY } from "./agentIdentity";
import Preflight from "./preflight/Preflight";
import SourceEntry from "./SourceEntry";
import { useStudio } from "./store";

/** The orchestrator's invitation, before any runtime or evidence state exists. */
function StudioWelcome() {
  return (
    <section className="studio-welcome" aria-labelledby="studio-welcome-title">
      <div className="welcome-orchestrator-anchor" aria-hidden="true">
        <motion.div
          className="welcome-orchestrator-core"
          initial={{ opacity: 0, scale: 0.72 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        >
          <AgentMark identity={ORCHESTRATOR_IDENTITY} status="idle" />
          <span className="node-name">orchestrator</span>
        </motion.div>
      </div>

      <motion.div
        className="welcome-message"
        initial={{ opacity: 0, y: 10, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.42, delay: 0.2, ease: [0.22, 1, 0.36, 1] }}
      >
        <span className="welcome-kicker">Studio</span>
        <h1 id="studio-welcome-title">Bring me a piece of real-world media.</h1>
        <p>
          I’ll organize the investigation and show how each finding connects back to its source.
        </p>
      </motion.div>

      <motion.div
        className="welcome-source"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, delay: 0.36, ease: [0.22, 1, 0.36, 1] }}
      >
        <SourceEntry />
      </motion.div>
    </section>
  );
}

export default function InputAct() {
  const loadStatus = useStudio((state) => state.loadStatus);
  const error = useStudio((state) => state.error);
  const outcome = useStudio((state) => state.outcome);
  const retry = useStudio((state) => state.retry);
  const start = useStudio((state) => state.start);
  const preflightStatus = useStudio((state) => state.preflight.status);

  return (
    <motion.section
      className="act act-input"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.4 }}
    >
      <div className="canvas" aria-hidden="true" />

      {preflightStatus !== "idle" && <Preflight />}

      {preflightStatus === "idle" && loadStatus === "ready" && !outcome && <StudioWelcome />}

      {preflightStatus === "idle" && loadStatus === "loading" && (
        <div className="input-status" role="status" aria-live="polite">
          <span className="input-status-kicker">Recorded evidence</span>
          <p>Loading the run bundle…</p>
        </div>
      )}

      {preflightStatus === "idle" && loadStatus === "failed" && (
        <div className="input-status" role="alert">
          <span className="input-status-kicker">Run unavailable</span>
          <p>The recorded evidence could not be loaded. Nothing has been replayed.</p>
          {error && <code>{error}</code>}
          <button type="button" className="ghost" onClick={() => void retry()}>
            Retry loading
          </button>
        </div>
      )}

      {preflightStatus === "idle" && outcome?.kind === "cancelled" && loadStatus === "ready" && (
        <div className="input-status" role="status" aria-live="polite">
          <span className="input-status-kicker">Cancelled</span>
          <p>{outcome.reason} No completed result is being shown.</p>
          <button type="button" className="ghost" onClick={start}>
            Restart the replay
          </button>
        </div>
      )}
    </motion.section>
  );
}
