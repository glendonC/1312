import { motion } from "motion/react";

import { useStudio } from "./store";

/** A blank canvas. Everything the user can do lives in the dock. */
export default function InputAct() {
  const loadStatus = useStudio((state) => state.loadStatus);
  const error = useStudio((state) => state.error);
  const outcome = useStudio((state) => state.outcome);
  const retry = useStudio((state) => state.retry);
  const start = useStudio((state) => state.start);

  return (
    <motion.section
      className="act act-input"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.4 }}
    >
      <div className="canvas" aria-hidden="true" />

      {loadStatus === "loading" && (
        <div className="input-status" role="status" aria-live="polite">
          <span className="input-status-kicker">Recorded evidence</span>
          <p>Loading the run bundle…</p>
        </div>
      )}

      {loadStatus === "failed" && (
        <div className="input-status" role="alert">
          <span className="input-status-kicker">Run unavailable</span>
          <p>The recorded evidence could not be loaded. Nothing has been replayed.</p>
          {error && <code>{error}</code>}
          <button type="button" className="ghost" onClick={() => void retry()}>
            Retry loading
          </button>
        </div>
      )}

      {outcome?.kind === "cancelled" && loadStatus === "ready" && (
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
