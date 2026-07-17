import { useEffect, useRef, useState, type KeyboardEvent } from "react";

import { formatSeconds, type OutputDepth } from "./preflight/model";
import { languageName } from "./preflight/preparationKit";
import { useBundle, useStudio } from "./store";

/** A sliders mark: the run's parameters, distinct from the layout mark opposite it. */
function ParametersGlyph() {
  return (
    <svg viewBox="0 0 20 20" width="17" height="17" aria-hidden="true">
      <path d="M3 6.5h11" />
      <circle cx="14" cy="6.5" r="2.2" />
      <path d="M3 13.5h4M9 13.5h8" />
      <circle cx="7" cy="13.5" r="2.2" />
    </svg>
  );
}

function outputLabel(depth: OutputDepth): string {
  return depth === "evidence" ? "Captions + evidence" : "Captions";
}

/**
 * The left counterpart to LayoutControl. Layout reshapes the canvas; this opens a
 * panel that reviews the run's bound parameters. On the recorded demo those
 * parameters are fixed, so the panel presents them read-only and only navigates on
 * an explicit action — it never promises the recorded run can be re-parametrized.
 * Opens and closes exactly like the layout menu: aria-haspopup, roving focus among
 * the actions, click-outside and Escape to close, focus returned to the trigger.
 */
export default function ReviewSetupControl() {
  const bundle = useBundle();
  const outputDepth = useStudio((state) => state.outputDepth);
  const reset = useStudio((state) => state.reset);
  const openRecordedPreflight = useStudio((state) => state.openRecordedPreflight);
  const start = useStudio((state) => state.start);

  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const actions = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    if (!open) return undefined;

    actions.current[0]?.focus();

    const closeOutside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [open]);

  if (!bundle) return null;

  function close(): void {
    setOpen(false);
    trigger.current?.focus();
  }

  function reviewSetup(): void {
    setOpen(false);
    reset();
    openRecordedPreflight();
  }

  function runAgain(): void {
    setOpen(false);
    start();
  }

  function move(event: KeyboardEvent<HTMLButtonElement>, index: number): void {
    const count = actions.current.length;
    const forward = event.key === "ArrowRight" || event.key === "ArrowDown";
    const backward = event.key === "ArrowLeft" || event.key === "ArrowUp";
    let next = index;

    if (forward) next = (index + 1) % count;
    else if (backward) next = (index - 1 + count) % count;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = count - 1;
    else if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    } else return;

    event.preventDefault();
    actions.current[next]?.focus();
  }

  const range = `${formatSeconds(0)}–${formatSeconds(bundle.run.clip.duration)}`;
  const language = `${languageName(bundle.run.pair.source)} → ${languageName(bundle.run.pair.target)}`;

  return (
    <div
      className="dock-parameters"
      ref={root}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <button
        ref={trigger}
        type="button"
        className="dock-parameters-trigger"
        aria-label="Review setup — the recorded replay's bound parameters"
        aria-haspopup="dialog"
        aria-expanded={open}
        title="Review setup"
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (!open && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        <ParametersGlyph />
      </button>

      <div className="dock-parameters-menu" role="dialog" aria-label="Review setup" hidden={!open}>
        <p className="dock-parameters-note">Recorded replay — these parameters are fixed.</p>

        <dl className="dock-parameters-summary">
          <div>
            <dt>Range</dt>
            <dd>
              {range}
              <small>recorded selection</small>
            </dd>
          </div>
          <div>
            <dt>Language</dt>
            <dd>{language}</dd>
          </div>
          <div>
            <dt>Output</dt>
            <dd>{outputLabel(outputDepth)}</dd>
          </div>
        </dl>

        <div className="dock-parameters-actions" role="group" aria-label="Setup actions">
          <button
            ref={(element) => {
              actions.current[0] = element;
            }}
            type="button"
            className="dock-parameters-primary"
            onClick={reviewSetup}
            onKeyDown={(event) => move(event, 0)}
          >
            Review setup
          </button>
          <button
            ref={(element) => {
              actions.current[1] = element;
            }}
            type="button"
            onClick={runAgain}
            onKeyDown={(event) => move(event, 1)}
          >
            Run again
          </button>
        </div>
      </div>
    </div>
  );
}
