/**
 * The dock is the one control surface, and it never leaves.
 *
 * Collapsed it offers a source. Running it shows the status verb and holds the stop.
 * Finished it offers another run. Hiding it mid-run would strand the user with no way
 * to stop what they started.
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
import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from "react";

import DockTrace from "./DockTrace";
import { Arrow, Chevron, Cross, Hold } from "./glyphs";
import { useBundle, useComplete, usePaused, useProgress, useStage, useStudio } from "./store";

const ALLOWED_HOSTS = ["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"];

const SPRING = { type: "spring", stiffness: 280, damping: 32, mass: 0.7 } as const;

export default function Dock() {
  const stage = useStage();
  const complete = useComplete();
  const bundle = useBundle();
  const paused = usePaused();
  const start = useStudio((s) => s.start);
  const reset = useStudio((s) => s.reset);
  const togglePause = useStudio((s) => s.togglePause);
  const { phase, done } = useProgress();

  const [open, setOpen] = useState(false);
  const [mini, setMini] = useState(false);
  const [url, setUrl] = useState("");
  const [note, setNote] = useState<{ tone: "allow" | "deny"; text: string } | null>(null);
  const field = useRef<HTMLInputElement>(null);

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

  useEffect(() => {
    if (open) field.current?.focus();
  }, [open]);

  function submit(e: FormEvent): void {
    e.preventDefault();
    const raw = url.trim();
    if (!raw) return;

    let host: string;
    try {
      host = new URL(raw).hostname;
    } catch {
      setNote({ tone: "deny", text: "That is not a link." });
      return;
    }

    if (!ALLOWED_HOSTS.includes(host)) {
      setNote({ tone: "deny", text: `${host} is not on the allowlist. Public YouTube, or files you own.` });
      return;
    }

    setNote({
      tone: "allow",
      text: "Host allowed, but fetching is off in the hosted build. Run it locally, or take the demo clip.",
    });
  }

  function cancel(): void {
    setOpen(false);
    setMini(false);
    setUrl("");
    setNote(null);
    reset();
  }

  const running = stage === "run" && !complete;
  const percent = Math.round(done * 100);

  /*
   * The verb is the run's pulse, so a held run must not have one. The shimmer sweeps only
   * while the clock is running; paused, the word stops moving and says what it is.
   */
  const verb = !running ? (
    <span className="dock-done">Done</span>
  ) : paused ? (
    <span className="dock-held">Paused</span>
  ) : (
    <span className="shimmer">{phase}…</span>
  );


  return (
    <div className="dock-well">
      <AnimatePresence mode="wait">
        {note && stage === "input" && (
          <motion.p
            key={note.text}
            className="dock-note"
            data-tone={note.tone}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
          >
            {note.text}
          </motion.p>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {running && (
          <motion.div
            className="rail"
            key="rail"
            data-paused={paused}
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
              title={paused ? "Resume the run" : "Hold the run"}
            >
              <Hold paused={paused} />
              <span>{paused ? "Resume" : "Pause"}</span>
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
        {stage === "run" && <DockTrace box={box} done={done} />}

        <AnimatePresence mode="popLayout" initial={false}>
          {stage === "run" && mini ? (
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
          ) : stage === "run" ? (
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
                onClick={cancel}
                aria-label={running ? "Stop the run" : "Clear"}
                title={running ? "Stop the run" : "Clear"}
              >
                <Cross />
              </button>
            </motion.div>
          ) : !open ? (
            <motion.button
              key="closed"
              type="button"
              className="dock-fab"
              onClick={() => setOpen(true)}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              layout
            >
              Add a source
            </motion.button>
          ) : (
            <motion.form
              key="open"
              className="dock-bar"
              onSubmit={submit}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18, delay: 0.06 }}
              layout
            >
              <input
                ref={field}
                className="dock-field"
                type="text"
                inputMode="url"
                autoComplete="off"
                spellCheck={false}
                placeholder="Paste a link"
                aria-label="Clip link"
                value={url}
                onChange={(e) => {
                  setUrl(e.target.value);
                  setNote(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Escape") setOpen(false);
                }}
              />

              <span className="dock-sep" aria-hidden="true" />

              <button
                type="button"
                className="dock-demo"
                onClick={start}
                disabled={!bundle}
                title={bundle?.run.clip.title_target}
              >
                Demo clip
              </button>

              <button type="submit" className="dock-go" aria-label="Analyze">
                <Arrow />
              </button>
            </motion.form>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}
