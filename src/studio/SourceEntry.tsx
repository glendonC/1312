import { AnimatePresence, motion } from "motion/react";
import { useEffect, useLayoutEffect, useRef, useState, type SyntheticEvent } from "react";

import { Arrow, Edit } from "./glyphs";
import { presentSource } from "./previewSession";
import SourceDisplay from "./SourceDisplay";
import { useStudio } from "./store";

const SPRING = { type: "spring", stiffness: 280, damping: 32, mass: 0.7 } as const;

/**
 * Source entry belongs to the welcome sequence, not the run dock. It deliberately reuses
 * the dock's field, review, and action atoms so the source keeps one visual language while
 * the two surfaces remain free to evolve around different jobs.
 */
export default function SourceEntry() {
  const submitSource = useStudio((state) => state.submitSource);
  const dismissPreflight = useStudio((state) => state.dismissPreflight);

  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [editingSource, setEditingSource] = useState(true);
  const [fieldOverflow, setFieldOverflow] = useState({ left: false, right: false });
  const field = useRef<HTMLInputElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const control = useRef<HTMLDivElement>(null);
  const [controlWidth, setControlWidth] = useState(0);

  const sourcePresentation = presentSource(url);
  const reviewingSource = sourcePresentation !== null && !editingSource;

  useLayoutEffect(() => {
    const element = control.current;
    if (!element) return;

    const observer = new ResizeObserver(([entry]) => setControlWidth(entry.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

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
  }, [controlWidth, editingSource, open, url]);

  function close(): void {
    setOpen(false);
    window.requestAnimationFrame(() => trigger.current?.focus());
  }

  function submit(event: SyntheticEvent<HTMLFormElement>): void {
    event.preventDefault();
    const raw = url.trim();
    if (!raw) return;
    submitSource(raw);
  }

  return (
    <motion.div
      className="source-entry"
      ref={control}
      layout
      transition={SPRING}
      aria-label="Source setup"
    >
      <AnimatePresence mode="popLayout" initial={false}>
        {!open ? (
          <motion.button
            ref={trigger}
            key="closed"
            type="button"
            className="dock-fab"
            onClick={() => {
              dismissPreflight();
              setEditingSource(true);
              setOpen(true);
            }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            layout
          >
            Input Source
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
                  className="dock-source-review"
                  aria-label={`Edit source: ${sourcePresentation.accessibleName}`}
                  onClick={() => setEditingSource(true)}
                >
                  <span className="dock-source-edit-mark" aria-hidden="true">
                    <Edit />
                  </span>
                  <SourceDisplay source={sourcePresentation} title={url} />
                </button>
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
                  onChange={(event) => {
                    dismissPreflight();
                    setUrl(event.target.value);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") close();
                    window.requestAnimationFrame(syncFieldOverflow);
                  }}
                  onScroll={syncFieldOverflow}
                  onSelect={syncFieldOverflow}
                />
              </span>
            )}

            <button type="submit" className="dock-go" aria-label="Launch investigation">
              <Arrow />
            </button>
          </motion.form>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
