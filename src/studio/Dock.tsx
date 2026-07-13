/**
 * The dock is the one control surface, and it never leaves.
 *
 * Collapsed it offers a source. Running it shows the status verb and holds the stop.
 * Finished it offers another run. Hiding it mid-run would strand the user with no way
 * to stop what they started.
 *
 * The run's progress is drawn as a stroke that travels the pill's own outline. It is
 * measured, not guessed: the border path is rebuilt from the dock's real box, so the
 * trace stays exactly on the edge at any width the layout spring lands on.
 */

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from "react";

import { useBundle, useComplete, useProgress, useStage, useStudio } from "./store";

const ALLOWED_HOSTS = ["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"];

const SPRING = { type: "spring", stiffness: 280, damping: 32, mass: 0.7 } as const;

/** Perimeter of a pill: the two straight runs plus the two round caps. */
function perimeterOf(w: number, h: number): number {
  return 2 * Math.max(0, w - h) + Math.PI * h;
}

function Chevron({ up = false }: { up?: boolean }) {
  return (
    <svg
      className="chevron"
      viewBox="0 0 16 16"
      width="14"
      height="14"
      aria-hidden="true"
      style={up ? { transform: "rotate(180deg)" } : undefined}
    >
      <path
        d="M4 6.5 8 10.5l4-4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function Dock() {
  const stage = useStage();
  const complete = useComplete();
  const bundle = useBundle();
  const start = useStudio((s) => s.start);
  const reset = useStudio((s) => s.reset);
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

  // The dock clips to its padding box, so the 2px stroke is centred 2px in: any closer
  // to the edge and the border shaves half the trace off.
  const w = Math.max(0, box.w - 4);
  const h = Math.max(0, box.h - 4);
  const perimeter = perimeterOf(w, h);

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

      <motion.div className="dock" ref={dock} layout transition={SPRING} data-running={running}>
        {/* the run's progress, drawn around the dock's own outline */}
        {stage === "run" && perimeter > 0 && (
          <svg className="dock-trace" width={box.w} height={box.h} aria-hidden="true">
            <rect
              className="dock-trace-bed"
              x={2}
              y={2}
              width={w}
              height={h}
              rx={h / 2}
              ry={h / 2}
            />
            <motion.rect
              className="dock-trace-run"
              x={2}
              y={2}
              width={w}
              height={h}
              rx={h / 2}
              ry={h / 2}
              strokeDasharray={perimeter}
              initial={{ strokeDashoffset: perimeter }}
              animate={{ strokeDashoffset: perimeter * (1 - done) }}
              transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
            />
          </svg>
        )}

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
                {running ? (
                  <span className="shimmer">{phase}…</span>
                ) : (
                  <span className="dock-done">Done</span>
                )}
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
                {running ? (
                  <span className="shimmer">{phase}…</span>
                ) : (
                  <span className="dock-done">Done</span>
                )}
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
                <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
                  <path
                    d="M4.4 4.4l7.2 7.2M11.6 4.4l-7.2 7.2"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                  />
                </svg>
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
                <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
                  <path
                    d="M2.6 8h10.2M8.6 3.4 13.4 8l-4.8 4.6"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
            </motion.form>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}
