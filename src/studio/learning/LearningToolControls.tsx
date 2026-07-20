import { useEffect, useRef } from "react";

import { Bookmark, Sliders } from "../glyphs";
import LearningFineTuneFace from "./LearningFineTuneFace";
import { momentClock } from "./momentContent";
import type { LearningPrepInteraction, SessionSavedSelection } from "./presentation.ts";
import type { LearningTools } from "./useLearningTools";

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
        <div>
          <span>This session only</span>
          <h3 id="learning-saved-title">Saved</h3>
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
      <p className="learning-saved-note">Only language you explicitly keep appears here. Nothing is saved after this result session ends.</p>
      {saved.length === 0 ? (
        <p className="learning-saved-empty">Select a prepared word or sentence, then choose Save.</p>
      ) : (
        <ul>
          {saved.map((item) => (
            <li key={item.id}>
              <div>
                <b lang={item.sourceLanguage}>{item.selection.text}</b>
                <span>{momentClock(item.startMs)} to {momentClock(item.endMs)}</span>
                {item.target.state === "available" && <p lang={item.targetLanguage}>{item.target.text}</p>}
              </div>
              <button type="button" onClick={() => onRemove(item.id)}>Remove</button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
