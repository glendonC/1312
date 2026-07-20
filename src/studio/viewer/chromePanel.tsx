import { useEffect, useRef, useState, type ReactNode } from "react";

// Direct import so Vite invalidates panel styles on every surface that composes this control,
// including surfaces that never mount the header ResultsChrome.
import "../../styles/studio/results.chrome.css";
import { Chevron } from "../glyphs";

/**
 * A glass disclosure control: a labelled trigger that opens one dialog panel and closes on
 * outside pointer, blur, or Escape. It is the one presentation for "details on demand" next to a
 * result — the result workspace's Source / Coverage panels and the production Run details all
 * use it, so disclosure reads the same on every watch surface.
 */
export default function ChromePanel({
  label,
  icon,
  panelLabel,
  className,
  children,
}: {
  label: string;
  icon: ReactNode;
  panelLabel: string;
  className?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    panel.current?.focus();
    const closeOutside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [open]);

  const close = (): void => {
    setOpen(false);
    trigger.current?.focus();
  };

  return (
    <div
      className="result-chrome-control"
      ref={root}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <button
        ref={trigger}
        type="button"
        className="result-chrome-trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="result-chrome-icon" aria-hidden="true">{icon}</span>
        <span className="result-chrome-label">{label}</span>
        <span className="result-chrome-caret" aria-hidden="true"><Chevron /></span>
      </button>
      <div
        className={`result-chrome-panel${className ? ` ${className}` : ""}`}
        ref={panel}
        role="dialog"
        aria-label={panelLabel}
        tabIndex={-1}
        hidden={!open}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            close();
          }
        }}
      >
        {children}
      </div>
    </div>
  );
}
