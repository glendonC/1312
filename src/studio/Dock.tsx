/** The run's global controls: a reversible pause and an explicit stop. */

import { AnimatePresence, motion } from "motion/react";
import { useLayoutEffect, useRef, useState } from "react";

import DockTrace from "./DockTrace";
import { Hold, Replay } from "./glyphs";
import LayoutControl from "./LayoutControl";
import { useComplete, usePaused, useProgress, useStudio } from "./store";

const SPRING = { type: "spring", stiffness: 280, damping: 32, mass: 0.7 } as const;

export default function Dock() {
  const complete = useComplete();
  const paused = usePaused();
  const start = useStudio((state) => state.start);
  const reset = useStudio((state) => state.reset);
  const cancelRun = useStudio((state) => state.cancel);
  const togglePause = useStudio((state) => state.togglePause);
  const pausePending = useStudio((state) => state.pausePending);
  const outcome = useStudio((state) => state.outcome);
  const { phase, done } = useProgress();

  const dock = useRef<HTMLDivElement>(null);
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

  function clear(): void {
    if (running) cancelRun();
    else reset();
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

      <LayoutControl />
    </div>
  );
}
