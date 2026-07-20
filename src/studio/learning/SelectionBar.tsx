import { useEffect, useLayoutEffect, useRef, useState } from "react";

import "../../styles/studio/results.selection.css";
import { Bookmark, Captions, Info } from "../glyphs";
import type { PresentedText } from "./model";
import type { SpanTranslationState } from "./presentation";

/** Where a live text selection sits in the viewport, so the bar can float above (or below) it. */
export interface SelectionAnchor {
  left: number;
  top: number;
  bottom: number;
  width: number;
}

/**
 * The floating action bar a learner raises by selecting caption text — the natural "touch anything
 * to go deeper" gesture. It reads the meaning of the selection right where the eye already is, rather
 * than sending the reader to a side panel: Translate reveals the line's translation in place (and on
 * a live production run also requests one bounded host-receipted translation of the exact selected
 * span), Explain opens the full facet explanation, and Save keeps the word or phrase for study. The
 * bar tracks the live selection rectangle, so it stays pinned to the highlight while the transcript
 * scrolls, and it dismisses when the selection is cleared.
 */
export default function SelectionBar({
  anchor,
  canExplain,
  canSave,
  translation,
  targetLanguage,
  saved,
  canTranslateSpan,
  spanTranslation,
  onTranslate,
  onTranslateRetry,
  onExplain,
  onSave,
  onDismiss,
}: {
  anchor: SelectionAnchor;
  /** Explain is offered only where a facet explanation can be requested (prepared source, or live). */
  canExplain: boolean;
  /** Save is offered only where a session collection exists; production carries no saved item yet. */
  canSave: boolean;
  /** The selected line's translation, revealed in place by Translate. */
  translation: PresentedText;
  targetLanguage: string;
  saved: boolean;
  /** Only a live production run with a configured executor can translate the exact span; the
   *  recorded demo keeps its honest line-translation reveal and never calls a model. */
  canTranslateSpan: boolean;
  /** The host-receipted state for this exact span, owned above the bar; null before any request. */
  spanTranslation: SpanTranslationState | null;
  onTranslate: () => void;
  onTranslateRetry: () => void;
  onExplain: () => void;
  onSave: () => void;
  onDismiss: () => void;
}) {
  const barRef = useRef<HTMLDivElement>(null);
  const [showTranslation, setShowTranslation] = useState(false);
  const [live, setLive] = useState<SelectionAnchor>(anchor);
  const [pos, setPos] = useState<{ left: number; top: number; placement: "above" | "below" }>({
    left: anchor.left,
    top: anchor.top,
    placement: "above",
  });

  // Track the live selection rectangle so the bar rides the highlight through inner scrolls; if the
  // selection is gone (collapsed or cleared), hand dismissal back to the owner.
  useEffect(() => {
    const update = () => {
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
        onDismiss();
        return;
      }
      const rect = selection.getRangeAt(0).getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) return;
      setLive({ left: rect.left, top: rect.top, bottom: rect.bottom, width: rect.width });
    };
    // Capture-phase scroll catches the transcript's own scroller, not just the window.
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [onDismiss]);

  // Place the bar centered on the selection, above it when there is room and below it when the
  // selection sits near the top, clamped to stay fully on screen. Runs before paint, so no jump.
  useLayoutEffect(() => {
    const element = barRef.current;
    if (!element) return;
    const rect = element.getBoundingClientRect();
    const margin = 8;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    let left = live.left + live.width / 2 - rect.width / 2;
    left = Math.max(margin, Math.min(left, viewportWidth - rect.width - margin));
    const aboveTop = live.top - rect.height - margin;
    const placeAbove = aboveTop >= margin;
    let top = placeAbove ? aboveTop : live.bottom + margin;
    top = Math.max(margin, Math.min(top, viewportHeight - rect.height - margin));
    setPos({ left, top, placement: placeAbove ? "above" : "below" });
  }, [live, showTranslation, spanTranslation]);

  const toggleTranslation = () => {
    const opening = !showTranslation;
    setShowTranslation(opening);
    // One explicit request per selection: reopening reads the kept state, and failed attempts
    // retry only through the explicit Retry control.
    if (opening && canTranslateSpan && spanTranslation === null) onTranslate();
  };

  return (
    <div
      ref={barRef}
      className="selection-bar"
      role="toolbar"
      aria-label="Selection actions"
      data-placement={pos.placement}
      style={{ left: `${pos.left}px`, top: `${pos.top}px` }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div className="selection-bar-row">
        <button
          type="button"
          className="selection-bar-btn"
          aria-pressed={showTranslation}
          title={canTranslateSpan
            ? "Translate the selected text and show this line's translation"
            : "Show this line's recorded translation"}
          onClick={toggleTranslation}
        >
          <span className="selection-bar-icon" aria-hidden="true"><Captions /></span>
          Translate
        </button>
        {canExplain && (
          <button type="button" className="selection-bar-btn" onClick={onExplain}>
            <span className="selection-bar-icon" aria-hidden="true"><Info /></span>
            Explain
          </button>
        )}
        {canSave && (
          <button
            type="button"
            className="selection-bar-btn"
            data-saved={saved ? "true" : undefined}
            disabled={saved}
            onClick={onSave}
          >
            <span className="selection-bar-icon" aria-hidden="true"><Bookmark filled={saved} /></span>
            {saved ? "Saved" : "Save"}
          </button>
        )}
      </div>
      {showTranslation && canTranslateSpan && (
        // The span readout is host-receipted model output for the exact selection, and every
        // missing state stays visible: unavailable, declined, and exhausted are said, never blank.
        <p
          className="selection-bar-translation"
          role="status"
          data-span-translation-state={spanTranslation?.state ?? "loading"}
        >
          <span className="selection-bar-translation-kind">This selection</span>
          <SpanTranslationReadout state={spanTranslation} onRetry={onTranslateRetry} />
        </p>
      )}
      {showTranslation && (
        // What is shown here is the line's translation, and it says so: the span readout above is
        // the only word-level claim, and it exists only as a receipted production artifact.
        <p className="selection-bar-translation">
          <span className="selection-bar-translation-kind">This line</span>
          <span lang={targetLanguage}>
            {translation.state === "available"
              ? translation.text
              : "No translation is available for this line."}
          </span>
        </p>
      )}
    </div>
  );
}

function SpanTranslationReadout({
  state,
  onRetry,
}: {
  state: SpanTranslationState | null;
  onRetry: () => void;
}) {
  if (state === null || state.state === "loading") {
    return <span className="selection-bar-waiting">Translating the selection</span>;
  }
  if (state.state === "translated") {
    return (
      <span
        lang={state.translation.language}
        title="Model translation of the selected text. Not reviewed."
      >
        {state.translation.text}
      </span>
    );
  }
  if (state.state === "withheld") {
    return (
      <span className="selection-bar-waiting">
        {state.reasonCode === "generator_abstained"
          ? "The model declined this span."
          : "The caption context is not enough for this span."}
      </span>
    );
  }
  if (state.state === "unavailable") {
    return <span className="selection-bar-waiting">Word translation is not available on this run.</span>;
  }
  return (
    <>
      <span className="selection-bar-waiting">
        {state.reasonCode === "translation_retry_exhausted"
          ? "Translation retries are used up for this selection."
          : state.reasonCode === "invalid_translation_binding"
            ? "The selection changed before the translation returned."
            : "The translation attempt failed."}
      </span>
      {state.retry === "available" && (
        <button type="button" className="selection-bar-retry" onClick={onRetry}>
          Retry translation
        </button>
      )}
    </>
  );
}
