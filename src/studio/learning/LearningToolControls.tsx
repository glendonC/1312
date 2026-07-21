import { useEffect, useRef } from "react";

import { Bookmark, Dismiss, Sliders } from "../glyphs";
import LearningFineTuneFace from "./LearningFineTuneFace";
import { momentClock } from "./momentContent";
import type { LearningFacetKind, LearningPrepInteraction, SessionSavedSelection } from "./presentation.ts";
import type { LearningTools } from "./useLearningTools";

/**
 * The plain name each kept-language category wears in the saved list. The color that goes with each
 * lives in CSS, keyed by the facet kind, so the pills read as one system with the speaker legend and
 * the transcript's lens marks rather than a second palette.
 */
const SAVED_FACET_LABELS: Record<LearningFacetKind, string> = {
  grammar: "Grammar",
  meaning: "Meaning",
  word: "Word",
  phrase: "Phrase",
  translation_choice: "Translation",
};

/**
 * The two study-tool disclosures, Saved and Notes. They render once, in the standard viewer's
 * transcript bar (the watch room commands the same tools from its own bar instead), and read
 * their state from the tools the experience owns.
 */
export function LearningToolToggles({
  tools,
  prepState,
  showSaved,
}: {
  tools: LearningTools;
  prepState: LearningPrepInteraction["prep"]["state"];
  /** Saved is a prototype-only collection; production results have no canonical saved item yet. */
  showSaved: boolean;
}) {
  return (
    <>
      {showSaved && (
        <button
          type="button"
          className="learning-saved-toggle"
          aria-expanded={tools.savedOpen}
          aria-controls={tools.savedId}
          onClick={tools.toggleSaved}
        >
          <Bookmark filled={tools.saved.length > 0} />
          <span>Saved{tools.saved.length > 0 ? ` (${tools.saved.length})` : ""}</span>
        </button>
      )}
      {/* The whole Notes face sits behind this one control, so the result stays the dominant
          surface and preparing notes is disclosure, not a second dashboard. */}
      <button
        type="button"
        className="learning-saved-toggle learning-tune-toggle"
        aria-expanded={tools.tuneOpen}
        aria-controls={tools.tuneId}
        data-learning-prep-state={prepState}
        onClick={tools.toggleTune}
      >
        <Sliders />
        <span>Notes</span>
      </button>
    </>
  );
}

/** Whichever tool disclosure is open, rendered next to the controls that opened it. */
export function LearningToolDrawers({
  tools,
  prepInteraction,
  showSaved,
}: {
  tools: LearningTools;
  prepInteraction: LearningPrepInteraction;
  showSaved: boolean;
}) {
  return (
    <>
      {showSaved && tools.savedOpen && (
        <SavedDrawer
          id={tools.savedId}
          saved={tools.saved}
          onRemove={tools.remove}
          onClose={tools.closeSaved}
        />
      )}
      {tools.tuneOpen && (
        <TuneDrawer id={tools.tuneId} interaction={prepInteraction} onClose={tools.closeTune} />
      )}
    </>
  );
}

function TuneDrawer({
  id,
  interaction,
  onClose,
}: {
  id: string;
  interaction: LearningPrepInteraction;
  onClose: () => void;
}) {
  const drawerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    drawerRef.current?.focus();
  }, []);

  // Like Saved, tuning opens beside the control that asked for it rather than replacing the
  // reading surface, so the transcript position is never lost and the face keeps its own region
  // identity and state attributes.
  return (
    <div
      id={id}
      className="learning-tune"
      ref={drawerRef}
      tabIndex={-1}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          onClose();
        }
      }}
    >
      <div className="learning-tune-head">
        <button
          type="button"
          className="learning-saved-close"
          aria-label="Close notes"
          onClick={onClose}
        >
          Close
        </button>
      </div>
      <LearningFineTuneFace interaction={interaction} />
    </div>
  );
}

function SavedDrawer({
  id,
  saved,
  onRemove,
  onClose,
}: {
  id: string;
  saved: SessionSavedSelection[];
  onRemove: (itemId: string) => void;
  onClose: () => void;
}) {
  const drawerRef = useRef<HTMLElement>(null);

  useEffect(() => {
    drawerRef.current?.focus();
  }, []);

  // Saved language is a session-only collection, not a co-equal view, so it stays behind one
  // control and never takes the reading surface away.
  return (
    <section
      id={id}
      className="learning-saved"
      ref={drawerRef}
      tabIndex={-1}
      aria-labelledby="learning-saved-title"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          onClose();
        }
      }}
    >
      <header className="learning-saved-head">
        <div className="learning-saved-head-lead">
          <h3 id="learning-saved-title">Saved</h3>
          <SavedScopeBadge />
        </div>
        <button type="button" className="learning-saved-close" aria-label="Close saved" onClick={onClose}>
          Close
        </button>
      </header>
      <SavedList saved={saved} onRemove={onRemove} />
    </section>
  );
}

/**
 * The kept-language list itself, without any surrounding disclosure chrome. The standard viewer's
 * SavedDrawer wraps it behind its own header; the watch room docks it as one panel mode under the
 * panel's shared header. One list, so a saved item reads the same wherever it is shown.
 */
export function SavedList({
  saved,
  onRemove,
}: {
  saved: SessionSavedSelection[];
  onRemove: (itemId: string) => void;
}) {
  return (
    <>
      {saved.length === 0 ? (
        <p className="learning-saved-empty">Select a prepared word or sentence, then choose Save.</p>
      ) : (
        <ul className="learning-saved-list">
          {saved.map((item) => (
            <li key={item.id} className="learning-saved-card">
              <div className="learning-saved-card-body">
                <b className="learning-saved-term" lang={item.sourceLanguage}>{item.selection.text}</b>
                {item.target.state === "available" && (
                  <p className="learning-saved-gloss" lang={item.targetLanguage}>{item.target.text}</p>
                )}
                <div className="learning-saved-card-meta">
                  <span className="learning-saved-time">
                    {momentClock(item.startMs)}–{momentClock(item.endMs)}
                  </span>
                  <SavedFacets facetKinds={item.facetKinds} />
                </div>
              </div>
              <button
                type="button"
                className="learning-saved-remove"
                aria-label={`Remove ${item.selection.text}`}
                onClick={() => onRemove(item.id)}
              >
                <Dismiss />
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

/**
 * The one required honesty disclosure the saved collection carries: it lives only for this result
 * session. It rides in the header beside the title as a compact muted badge, never as a row in the
 * list, and the full sentence stays reachable to a screen reader (and on hover) so nothing is lost by
 * shrinking it. Shared, so the standard drawer and the watch-room panel show the same promise.
 */
export function SavedScopeBadge() {
  return (
    <span className="learning-saved-scope-pill" title="Nothing is saved after this result session ends.">
      Session only
      <span className="learning-saved-scope-full">. Nothing is saved after this result session ends.</span>
    </span>
  );
}

/**
 * The category pills for one saved item: one colored squircle per facet kind so a learner scans the
 * list by what help each keep carries. A raw vocabulary keep has no prepared facets, so it wears a
 * single neutral "Kept" pill instead of nothing.
 */
function SavedFacets({ facetKinds }: { facetKinds: LearningFacetKind[] }) {
  if (facetKinds.length === 0) {
    return (
      <span className="learning-saved-facets">
        <span className="learning-saved-facet" data-facet="kept">Kept</span>
      </span>
    );
  }
  return (
    <span className="learning-saved-facets">
      {facetKinds.map((kind) => (
        <span key={kind} className="learning-saved-facet" data-facet={kind}>
          {SAVED_FACET_LABELS[kind]}
        </span>
      ))}
    </span>
  );
}
