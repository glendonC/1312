import { AnimatePresence, motion } from "motion/react";
import { useEffect, useLayoutEffect, useRef, useState, type SyntheticEvent } from "react";

import { Arrow } from "./glyphs";
import { useStudio } from "./store";

const SPRING = { type: "spring", stiffness: 280, damping: 32, mass: 0.7 } as const;

interface SourceEntryProps {
  open: boolean;
  url: string;
  focusRequest: number;
  setOpen: (open: boolean) => void;
  setUrl: (url: string) => void;
  submitSource: (url: string) => void;
}

/**
 * Source entry belongs to the welcome sequence, not the run dock. It deliberately reuses
 * the dock's field, review, and action atoms so the source keeps one visual language while
 * the two surfaces remain free to evolve around different jobs.
 *
 * The visible copy names the job (input a source), not the evidence class: live-local
 * authority stays machine-readable here (data-source-authority). Submitting only carries the
 * URL into the local ingest setup; the range bounds, the local-processing confirmation, and
 * the host's own re-validation all still stand between this field and any downloaded bytes.
 */
export default function SourceEntry({
  open,
  url,
  focusRequest,
  setOpen,
  setUrl,
  submitSource,
}: SourceEntryProps) {
  const dismissPreflight = useStudio((state) => state.dismissPreflight);

  const [fieldOverflow, setFieldOverflow] = useState({ left: false, right: false });
  const field = useRef<HTMLInputElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const control = useRef<HTMLDivElement>(null);
  const [controlWidth, setControlWidth] = useState(0);

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
    if (!open) return;
    const frame = window.requestAnimationFrame(() => {
      const input = field.current;
      if (!input) return;
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [focusRequest, open]);

  useLayoutEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(syncFieldOverflow);
    return () => window.cancelAnimationFrame(frame);
  }, [controlWidth, open, url]);

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
      className="source-entry studio-bottom-bar-shell"
      data-lifecycle-mode="source"
      data-source-authority="live-local"
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
            className="dock-bar"
            onSubmit={submit}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18, delay: 0.06 }}
            layout
          >
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
                placeholder="Paste a YouTube link"
                aria-label="YouTube link"
                value={url}
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

            <motion.span
              className="dock-go-reveal"
              initial={{ opacity: 0, x: 10, scale: 0.72 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              transition={{
                duration: 0.2,
                delay: 0.26,
                ease: [0.22, 1, 0.36, 1],
              }}
            >
              <button type="submit" className="dock-go" aria-label="Set up local processing for this link">
                <Arrow />
              </button>
            </motion.span>
          </motion.form>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
