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
import { useEffect, useLayoutEffect, useRef, useState, type SyntheticEvent } from "react";

import DockTrace from "./DockTrace";
import { Arrow, Chevron, Cross, Edit, Hold, LinkSource, YouTube } from "./glyphs";
import { useBundle, useComplete, usePaused, useProgress, useStage, useStudio } from "./store";

const SPRING = { type: "spring", stiffness: 280, damping: 32, mass: 0.7 } as const;
const YOUTUBE_HOSTS = new Set(["youtube.com", "m.youtube.com", "youtu.be"]);

type SourcePresentation = {
  kind: "youtube" | "web";
  displayUrl: string;
  compactUrl?: string;
  accessibleName: string;
};

function presentSource(raw: string): SourcePresentation | null {
  let source: URL;

  try {
    source = new URL(raw.trim());
  } catch {
    return null;
  }

  if (source.protocol !== "https:" && source.protocol !== "http:") return null;

  const host = source.hostname.toLowerCase().replace(/^www\./, "");
  const pathParts = source.pathname.split("/").filter(Boolean);

  if (YOUTUBE_HOSTS.has(host)) {
    const videoId = host === "youtu.be"
      ? pathParts[0]
      : source.searchParams.get("v")
        ?? (["embed", "live", "shorts"].includes(pathParts[0] ?? "") ? pathParts[1] : undefined);

    if (videoId) {
      return {
        kind: "youtube",
        displayUrl: `youtube.com/watch?v=${videoId}`,
        compactUrl: `youtu.be/${videoId}`,
        accessibleName: `YouTube video link ${videoId}`,
      };
    }
  }

  let path = source.pathname;
  try {
    path = decodeURI(path);
  } catch {
    // Keep the encoded path when a valid URL contains an incomplete escape sequence.
  }
  path = path.replace(/\/$/, "");
  const identifier = path || "Home";

  return {
    kind: "web",
    displayUrl: `${host}${identifier === "Home" ? "" : identifier}`,
    accessibleName: `Web source ${host} ${identifier}`,
  };
}

export default function Dock() {
  const stage = useStage();
  const complete = useComplete();
  const bundle = useBundle();
  const paused = usePaused();
  const start = useStudio((s) => s.start);
  const openRecordedPreflight = useStudio((s) => s.openRecordedPreflight);
  const submitSource = useStudio((s) => s.submitSource);
  const dismissPreflight = useStudio((s) => s.dismissPreflight);
  const reset = useStudio((s) => s.reset);
  const cancelRun = useStudio((s) => s.cancel);
  const togglePause = useStudio((s) => s.togglePause);
  const pausePending = useStudio((s) => s.pausePending);
  const { phase, done } = useProgress();

  const [open, setOpen] = useState(false);
  const [mini, setMini] = useState(false);
  const [url, setUrl] = useState("");
  const [editingSource, setEditingSource] = useState(true);
  const [fieldOverflow, setFieldOverflow] = useState({ left: false, right: false });
  const [sourceOverflow, setSourceOverflow] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  const sourceUrl = useRef<HTMLSpanElement>(null);

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

  const sourcePresentation = presentSource(url);
  const reviewingSource = sourcePresentation !== null && !editingSource;

  function syncFieldOverflow(): void {
    const input = field.current;
    if (!input) return;

    const maxScroll = Math.max(0, input.scrollWidth - input.clientWidth);
    const next = {
      left: input.scrollLeft > 1,
      right: input.scrollLeft < maxScroll - 1,
    };

    setFieldOverflow((current) =>
      current.left === next.left && current.right === next.right ? current : next,
    );
  }

  useEffect(() => {
    if (!open || !editingSource) return;
    field.current?.focus();
  }, [editingSource, open]);

  useLayoutEffect(() => {
    if (!open || !editingSource) return;
    const frame = window.requestAnimationFrame(syncFieldOverflow);
    return () => window.cancelAnimationFrame(frame);
  }, [box.w, editingSource, open, url]);

  useLayoutEffect(() => {
    if (!reviewingSource) {
      setSourceOverflow(false);
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      const source = sourceUrl.current;
      setSourceOverflow(Boolean(source && source.scrollWidth > source.clientWidth + 1));
    });
    return () => window.cancelAnimationFrame(frame);
  }, [box.w, reviewingSource, url]);

  function submit(e: SyntheticEvent<HTMLFormElement>): void {
    e.preventDefault();
    const raw = url.trim();
    if (!raw) return;
    submitSource(raw);
    setOpen(false);
  }

  function clear(): void {
    setOpen(false);
    setMini(false);
    setUrl("");
    setEditingSource(true);
    setFieldOverflow({ left: false, right: false });
    if (running) cancelRun();
    else {
      dismissPreflight();
      reset();
    }
  }

  const running = stage === "run" && !complete;
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
          ) : !open ? (
            <motion.button
              key="closed"
              type="button"
              className="dock-fab"
              onClick={() => {
                setEditingSource(true);
                setOpen(true);
              }}
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
              className={`dock-bar${reviewingSource ? " dock-bar-source" : ""}`}
              onSubmit={submit}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18, delay: 0.06 }}
              layout
            >
              {reviewingSource ? (
                <>
                  <button
                    type="button"
                    className="dock-source-edit"
                    aria-label={`Edit source: ${sourcePresentation.accessibleName}`}
                    onClick={() => setEditingSource(true)}
                  >
                    <Edit />
                  </button>

                  <div className="dock-source" title={url}>
                    <span className="dock-source-glyph" data-kind={sourcePresentation.kind}>
                      {sourcePresentation.kind === "youtube" ? <YouTube /> : <LinkSource />}
                    </span>
                    <span
                      ref={sourceUrl}
                      className="dock-source-url"
                      data-overflow={sourceOverflow}
                    >
                      <span
                        className={`dock-source-url-full${sourcePresentation.compactUrl ? " has-compact" : ""}`}
                      >
                        {sourcePresentation.displayUrl}
                      </span>
                      {sourcePresentation.compactUrl && (
                        <span className="dock-source-url-compact">{sourcePresentation.compactUrl}</span>
                      )}
                    </span>
                  </div>
                </>
              ) : (
                <span
                  className="dock-field-shell"
                  data-overflow-left={fieldOverflow.left}
                  data-overflow-right={fieldOverflow.right}
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
                    onBlur={() => {
                      if (sourcePresentation) {
                        window.requestAnimationFrame(() => setEditingSource(false));
                      }
                    }}
                    onChange={(e) => {
                      setUrl(e.target.value);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") setOpen(false);
                      window.requestAnimationFrame(syncFieldOverflow);
                    }}
                    onScroll={syncFieldOverflow}
                    onSelect={syncFieldOverflow}
                  />
                </span>
              )}

              {!reviewingSource && (
                <>
                  <span className="dock-sep" aria-hidden="true" />

                  <button
                    type="button"
                    className="dock-demo"
                    onClick={() => {
                      setOpen(false);
                      openRecordedPreflight();
                    }}
                    disabled={!bundle}
                    title={bundle?.run.clip.title_target}
                  >
                    Demo clip
                  </button>
                </>
              )}

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
