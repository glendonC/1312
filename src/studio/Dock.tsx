/**
 * The dock is the run control surface, and it never leaves while work is active.
 *
 * It shows the status verb and holds the stop. Finished it offers another run. Hiding it
 * mid-run would strand the user with no way to stop what they started. Source setup belongs
 * to SourceEntry, where the welcome sequence can grow without changing the run controls.
 *
 * The run's progress travels the pill's own outline (DockTrace), measured from the dock's
 * real box rather than guessed.
 *
 * Pause rides above the bar on its own small pane of the same glass. It sits outside the
 * dock rather than inside it because it outlives the dock's shape: fold the bar into the
 * capsule and the hold is still one click away, which is the whole point of being able to
 * hold a run instead of killing it. On a screen too narrow for the rail, the hold moves
 * into the bar and takes the left seat, opposite the stop — see dock.css.
 */

import { AnimatePresence, motion } from "motion/react";
import { useLayoutEffect, useRef, useState } from "react";

import DockTrace from "./DockTrace";
import { Chevron, Cross, Hold } from "./glyphs";
import { useBundle, useComplete, usePaused, useProgress, useStudio } from "./store";

const SPRING = { type: "spring", stiffness: 280, damping: 32, mass: 0.7 } as const;

export default function Dock() {
  const complete = useComplete();
  const bundle = useBundle();
  const paused = usePaused();
  const start = useStudio((s) => s.start);
  const reset = useStudio((s) => s.reset);
  const cancelRun = useStudio((s) => s.cancel);
  const togglePause = useStudio((s) => s.togglePause);
  const pausePending = useStudio((s) => s.pausePending);
  const { phase, done } = useProgress();

  const [mini, setMini] = useState(false);

  const dock = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });

  useLayoutEffect(() => {
    const el = dock.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const r = entry.contentRect;
      setBox({ w: r.width, h: r.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  function clear(): void {
    setMini(false);
    if (running) cancelRun();
    else reset();
  }

  const running = !complete;
  const percent = Math.round(done * 100);

  /*
   * The verb is the run's pulse, so a held run must not have one. The shimmer sweeps only
   * while the clock is running; paused, the word stops moving and says what it is.
   */
  const verb = !running ? (
    <span className="dock-done">Done</span>
  ) : pausePending ? (
    <span className="dock-held">Pause requested</span>
  ) : paused ? (
    <span className="dock-held">Paused</span>
  ) : (
    <span className="text-shimmer">{phase}…</span>
  );


  return (
    <div className="dock-well">
      <AnimatePresence>
        {running && (
          <motion.div
            className="rail"
            key="rail"
            data-paused={paused}
            data-pending={pausePending}
            initial={{ opacity: 0, y: 8, scale: 0.94 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.94 }}
            transition={SPRING}
          >
            <button
              type="button"
              className="rail-btn"
              onClick={togglePause}
              aria-pressed={paused}
              disabled={pausePending}
              title={paused ? "Resume the run" : "Hold the run"}
            >
              <Hold paused={paused} />
              <span>{paused ? "Resume" : "Pause"}</span>
              <kbd>space</kbd>
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      <motion.div
        className="dock"
        ref={dock}
        layout
        transition={SPRING}
        data-running={running}
        data-paused={paused}
      >
        <DockTrace box={box} done={done} />

        <AnimatePresence mode="popLayout" initial={false}>
          {mini ? (
            /*
             * Folded. The run does not pause because you stopped looking at the controls,
             * so the capsule keeps reporting: the verb, the percentage, and the same border
             * trace. Clicking anywhere on it brings the bar back.
             */
            <motion.button
              key="mini"
              type="button"
              className="dock-mini"
              onClick={() => setMini(false)}
              aria-label="Expand the dock"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18, delay: 0.06 }}
              layout
            >
              <span className="dock-status dock-status-mini" aria-live="polite">
                {verb}
              </span>

              <span className="dock-pct">{percent}%</span>

              <Chevron up />
            </motion.button>
          ) : (
            <motion.div
              key="run"
              className="dock-bar dock-bar-run"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              layout
            >
              {/*
               * Narrow screens have no room for the rail above, so the hold comes into the
               * bar as its own circle and takes the left seat. The stop keeps the right seat
               * it holds at every width — the one irreversible control on this screen does
               * not move house because the window got smaller.
               */}
              <button
                type="button"
                className="dock-hold"
                onClick={togglePause}
                aria-pressed={paused}
                disabled={pausePending}
                aria-label={paused ? "Resume the run" : "Hold the run"}
                title={paused ? "Resume" : "Pause"}
              >
                <Hold paused={paused} />
              </button>

              <button
                type="button"
                className="dock-fold"
                onClick={() => setMini(true)}
                aria-label="Minimize the dock"
                title="Minimize"
              >
                <Chevron />
              </button>

              <span className="dock-status" aria-live="polite">
                {verb}
              </span>

              <span className="dock-clip">{bundle?.run.clip.id}</span>

              <span className="dock-gap" aria-hidden="true" />

              <span className="dock-pct">{percent}%</span>

              {complete && (
                <button type="button" className="dock-demo" onClick={start}>
                  Run again
                </button>
              )}

              <button
                type="button"
                className="dock-x"
                data-running={running}
                onClick={clear}
                aria-label={running ? "Stop the run" : "Clear"}
                title={running ? "Stop the run" : "Clear"}
              >
                <Cross />
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}
