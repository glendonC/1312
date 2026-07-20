/** The run's global controls: a reversible pause and an explicit stop. */

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import DockTrace from "./DockTrace";
import { Arrow, Hold, Replay } from "./glyphs";
import LayoutControl from "./LayoutControl";
import ReviewSetupControl from "./ReviewSetupControl";
import { focusResultTarget, RECORDED_RESULTS_ID } from "./resultAccess";
import { useComplete, usePaused, useProgress, useStudio } from "./store";

const SPRING = { type: "spring", stiffness: 280, damping: 32, mass: 0.7 } as const;

export default function Dock() {
  const complete = useComplete();
  const paused = usePaused();
  const start = useStudio((state) => state.start);
  const reset = useStudio((state) => state.reset);
  const cancelRun = useStudio((state) => state.cancel);
  const setResultView = useStudio((state) => state.setResultView);
  const togglePause = useStudio((state) => state.togglePause);
  const pausePending = useStudio((state) => state.pausePending);
  const outcome = useStudio((state) => state.outcome);
  const selectedAgent = useStudio((state) => state.selected);
  const selectAgent = useStudio((state) => state.select);
  const { phase, done } = useProgress();

  const dock = useRef<HTMLDivElement>(null);
  const resultFocusObserver = useRef<MutationObserver | null>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const cancelled = outcome?.kind === "cancelled";
  const failed = outcome?.kind === "failed";
  const running = !complete && !cancelled && !failed;
  const terminal = complete || cancelled || failed;
  const percent = Math.round(done * 100);

  useLayoutEffect(() => {
    const element = dock.current;
    if (!element) return undefined;

    const observer = new ResizeObserver(([entry]) => {
      const bounds = entry.contentRect;
      setBox({ w: bounds.width, h: bounds.height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => () => {
    resultFocusObserver.current?.disconnect();
  }, []);

  function clear(): void {
    if (running) cancelRun();
    else reset();
  }

  function openResults(): void {
    // The result workspace is hidden on the process graph, so opening it is the same switch the
    // golden Result orb makes; focus then follows so keyboard and screen-reader users land on it.
    setResultView("result");
    if (!selectedAgent) {
      focusResultTarget(RECORDED_RESULTS_ID);
      return;
    }

    const focusWhenAgentPanelCloses = () => {
      if (document.querySelector(".agent-focus")) return;
      resultFocusObserver.current?.disconnect();
      resultFocusObserver.current = null;
      focusResultTarget(RECORDED_RESULTS_ID);
    };
    resultFocusObserver.current?.disconnect();
    resultFocusObserver.current = new MutationObserver(focusWhenAgentPanelCloses);
    resultFocusObserver.current.observe(document.body, { childList: true, subtree: true });
    selectAgent(null);
    focusWhenAgentPanelCloses();
  }

  return (
    <div className="dock-well">
      <AnimatePresence initial={false}>
        {(running || terminal) && (
          <motion.div
            className="rail"
            data-paused={running ? paused : undefined}
            data-pending={running ? pausePending : undefined}
            data-terminal={terminal ? "true" : undefined}
            initial={{ opacity: 0, y: 7, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 7, scale: 0.96 }}
            transition={SPRING}
          >
            {running ? (
              <button
                type="button"
                className="rail-btn"
                onClick={togglePause}
                aria-label={paused ? "Resume" : "Pause"}
                aria-pressed={paused}
                disabled={pausePending}
              >
                <span className="rail-glyph">
                  <Hold paused={paused} />
                </span>
                <span>{pausePending ? "Pausing" : paused ? "Resume" : "Pause"}</span>
                <kbd aria-hidden="true">space</kbd>
              </button>
            ) : complete ? (
              <button
                type="button"
                className="rail-btn"
                onClick={openResults}
              >
                <span className="rail-glyph">
                  <Arrow />
                </span>
                <span>Open Results</span>
              </button>
            ) : (
              <button type="button" className="rail-btn" onClick={start}>
                <Replay />
                <span>Run again</span>
              </button>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      <motion.div
        className="dock studio-bottom-bar-shell"
        ref={dock}
        layout
        transition={SPRING}
        data-running={running}
        data-paused={paused}
        data-outcome={cancelled ? "cancelled" : failed ? "failed" : complete ? "complete" : "running"}
      >
        <DockTrace box={box} done={done} />

        <div className="dock-bar dock-bar-run">
          <div className="dock-state">
            {running && (
              <button
                type="button"
                className="dock-hold"
                onClick={togglePause}
                aria-label={paused ? "Resume" : "Pause"}
                aria-pressed={paused}
                disabled={pausePending}
              >
                <span className="dock-hold-glyph">
                  <Hold paused={paused} />
                </span>
              </button>
            )}

            <span className="dock-status" aria-live="polite">
              {cancelled ? (
                <span className="dock-cancelled">Cancelled</span>
              ) : failed ? (
                <span className="dock-failed">Failed</span>
              ) : running ? (
                pausePending ? (
                  <span className="dock-held">Pausing…</span>
                ) : paused ? (
                  <span className="dock-held">Paused</span>
                ) : (
                  <span className="text-shimmer">{phase}…</span>
                )
              ) : (
                <span className="dock-done">Done</span>
              )}
            </span>
          </div>

          <span className="dock-pct">{percent}%</span>

          <div className="dock-actions">
            <button
              type="button"
              className="dock-stop"
              data-running={running}
              onClick={clear}
            >
              {running ? "Stop" : "Clear"}
            </button>
          </div>
        </div>
      </motion.div>

      <ReviewSetupControl />
      <LayoutControl />
    </div>
  );
}
