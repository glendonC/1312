import { useEffect, useRef, useState, type KeyboardEvent } from "react";

import type { Layout } from "./layout";
import { useLayout, useStudio } from "./store";

const LAYOUTS: { id: Layout; label: string; hint: string }[] = [
  { id: "radial", label: "Ring", hint: "The orchestrator holds the centre" },
  { id: "down", label: "Down", hint: "Grow the tree downward" },
  { id: "right", label: "Right", hint: "Grow the tree rightward" },
];

function LayoutGlyph({ layout }: { layout: Layout }) {
  if (layout === "radial") {
    return (
      <svg viewBox="0 0 20 20" width="17" height="17" aria-hidden="true">
        <circle cx="10" cy="10" r="6.1" />
        <circle className="layout-glyph-core" cx="10" cy="10" r="1.25" />
      </svg>
    );
  }

  if (layout === "down") {
    return (
      <svg viewBox="0 0 20 20" width="17" height="17" aria-hidden="true">
        <path d="M10 3.25v12.5M5.75 11.5 10 15.75l4.25-4.25" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 20 20" width="17" height="17" aria-hidden="true">
      <path d="M3.25 10h12.5M11.5 5.75 15.75 10l-4.25 4.25" />
    </svg>
  );
}

export default function LayoutControl() {
  const layout = useLayout();
  const setLayout = useStudio((state) => state.setLayout);
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const options = useRef<Array<HTMLButtonElement | null>>([]);
  const active = LAYOUTS.find((option) => option.id === layout) ?? LAYOUTS[0];

  useEffect(() => {
    if (!open) return undefined;

    options.current[LAYOUTS.findIndex((option) => option.id === layout)]?.focus();

    const closeOutside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [layout, open]);

  function choose(next: Layout): void {
    setLayout(next);
    setOpen(false);
    trigger.current?.focus();
  }

  function move(event: KeyboardEvent<HTMLButtonElement>, index: number): void {
    const forward = event.key === "ArrowRight" || event.key === "ArrowDown";
    const backward = event.key === "ArrowLeft" || event.key === "ArrowUp";
    let next = index;

    if (forward) next = (index + 1) % LAYOUTS.length;
    else if (backward) next = (index - 1 + LAYOUTS.length) % LAYOUTS.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = LAYOUTS.length - 1;
    else if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      trigger.current?.focus();
      return;
    } else return;

    event.preventDefault();
    setLayout(LAYOUTS[next].id);
    options.current[next]?.focus();
  }

  return (
    <div
      className="dock-layout"
      ref={root}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <button
        ref={trigger}
        type="button"
        className="dock-layout-trigger"
        aria-label={`Change swarm layout. Current layout: ${active.label}`}
        aria-haspopup="menu"
        aria-expanded={open}
        title={`Layout: ${active.label}`}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (!open && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        <LayoutGlyph layout={layout} />
      </button>

      <div className="dock-layout-menu" role="menu" aria-label="Swarm layout" hidden={!open}>
        {LAYOUTS.map((option, index) => (
          <button
            key={option.id}
            ref={(element) => {
              options.current[index] = element;
            }}
            type="button"
            className="dock-layout-option"
            role="menuitemradio"
            aria-checked={layout === option.id}
            title={option.hint}
            onClick={() => choose(option.id)}
            onKeyDown={(event) => move(event, index)}
          >
            <span className="dock-layout-option-icon">
              <LayoutGlyph layout={option.id} />
            </span>
            <span>{option.label}</span>
            <span className="dock-layout-check" aria-hidden="true" />
          </button>
        ))}
      </div>
    </div>
  );
}
