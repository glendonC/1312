import { AnimatePresence, motion } from "motion/react";

import AgentMark from "./AgentMark";
import { ORCHESTRATOR_IDENTITY } from "./agentIdentity";
import { Play } from "./glyphs";
import Preflight from "./preflight/Preflight";
import SourceEntry from "./SourceEntry";
import { useBundle, useStudio } from "./store";

/** The orchestrator's invitation, before any runtime or evidence state exists. */
function StudioWelcome() {
  return (
    <section className="studio-welcome" aria-labelledby="studio-welcome-title">
      <div className="welcome-lockup">
        <div className="welcome-orchestrator-anchor" aria-hidden="true">
          <motion.div
            className="welcome-orchestrator-core"
            initial={{ opacity: 0, scale: 0.72 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
          >
            <AgentMark identity={ORCHESTRATOR_IDENTITY} status="idle" />
          </motion.div>
        </div>

        <div className="welcome-content">
          <motion.div
            className="welcome-panel"
            initial={{ opacity: 0, y: -6, scaleY: 0.42 }}
            animate={{ opacity: 1, y: 0, scaleY: 1 }}
            transition={{ duration: 0.48, delay: 0.14, ease: [0.22, 1, 0.36, 1] }}
          >
            <motion.h1
              id="studio-welcome-title"
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.26, delay: 0.38, ease: "easeOut" }}
            >
              Welcome to Studio. Add a source when you’re ready. We’ll take it from there, so you
              can sit back and watch it come together.
            </motion.h1>
          </motion.div>
        </div>
      </div>
    </section>
  );
}

function StudioSourceDock() {
  const preflight = useStudio((state) => state.preflight);
  const notice =
    preflight.status !== "idle" && preflight.provenance.kind === "client_validation"
      ? preflight.message
      : null;
  const tone = preflight.status === "invalid_source" ? "deny" : "neutral";

  return (
    <div className="studio-source-dock">
      <AnimatePresence mode="wait">
        {notice && (
          <motion.p
            key={notice}
            className="source-check-note"
            data-tone={tone}
            role="alert"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 3 }}
            transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
          >
            {notice}
          </motion.p>
        )}
      </AnimatePresence>

      <motion.div
        className="source-dock-actions"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.32, delay: 0.48, ease: [0.22, 1, 0.36, 1] }}
      >
        <SourceEntry />
      </motion.div>
    </div>
  );
}

function StudioDemoControl() {
  const bundle = useBundle();
  const openRecordedPreflight = useStudio((state) => state.openRecordedPreflight);

  return (
    <motion.button
      type="button"
      className="studio-demo-control"
      onClick={openRecordedPreflight}
      disabled={!bundle}
      title="Run Demo"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.24, delay: 0.5, ease: [0.22, 1, 0.36, 1] }}
    >
      <span>Run Demo</span>
      <Play />
    </motion.button>
  );
}

export default function InputAct() {
  const loadStatus = useStudio((state) => state.loadStatus);
  const error = useStudio((state) => state.error);
  const retry = useStudio((state) => state.retry);
  const preflightStatus = useStudio((state) => state.preflight.status);
  const clientSourceCheck = useStudio(
    (state) =>
      state.preflight.status !== "idle" &&
      state.preflight.provenance.kind === "client_validation",
  );

  return (
    <motion.section
      className="act act-input"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.4 }}
    >
      <div className="canvas" aria-hidden="true" />

      {preflightStatus !== "idle" && !clientSourceCheck && <Preflight />}

      {(preflightStatus === "idle" || clientSourceCheck) && loadStatus === "ready" && (
        <>
          <StudioWelcome />
          <StudioSourceDock />
          <StudioDemoControl />
        </>
      )}

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
    </motion.section>
  );
}
