import { useEffect, useRef, type ReactNode, type RefObject } from "react";

import "../../styles/studio/results.watch.css";
import LearningFineTuneFace from "../learning/LearningFineTuneFace";
import { SavedList, SavedScopeBadge } from "../learning/LearningToolControls";
import type { LearningPrepInteraction } from "../learning/presentation.ts";
import { useStudio } from "../store";
import type { RunBundle } from "../transport";
import type { LearningTools } from "../learning/useLearningTools";
import ResultBrief from "./ResultBrief";
import type { WatchBarHandle } from "./WatchBar";
import type { WatchPanelMode, WatchPanelState } from "./useWatchPanel";

/** The heading each docked mode wears, and the accessible name its own close button carries. */
const PANEL_HEADS: Record<Exclude<WatchPanelMode, "transcript">, { title: string; close: string }> = {
  details: { title: "Details", close: "Close details" },
  saved: { title: "Saved", close: "Close saved" },
  tune: { title: "Notes", close: "Close notes" },
};

/**
 * The watch room's one reusable side panel. The command bar selects which content docks here; every
 * finished-run disclosure that used to be its own surface (the transcript, the run Details, the
 * Saved collection, the Notes face) is a mode of this single panel, so the room is a video with one
 * console rather than a spread of drawers, rails, and dialogs. The panel opens only on command: the
 * room's default is the bare video with its captions, and closing any mode returns to that.
 *
 * The transcript stays mounted whenever the panel exists, hidden by CSS when it is not the shown
 * mode, so a pinned explanation and the reading position survive switching to Details or Notes and
 * back: the mounted-viewer invariant the whole result workspace is built on. The other modes are
 * cheap to mount on demand; their session truth (saved items, the prep draft) is owned above the
 * panel.
 */
export default function WatchPanel({
  panel,
  bundle,
  transcript,
  tools,
  prepInteraction,
  showSaved,
  barRef,
}: {
  panel: WatchPanelState;
  bundle: RunBundle;
  /** The always-mounted learning transcript, shown only in the transcript mode. */
  transcript: ReactNode;
  tools: LearningTools;
  prepInteraction: LearningPrepInteraction;
  showSaved: boolean;
  /** Closing a docked mode returns focus to the bar option that opened it. */
  barRef: RefObject<WatchBarHandle | null>;
}) {
  const showEvidence = useStudio((s) => s.outputDepth) === "evidence";
  const dockRef = useRef<HTMLDivElement>(null);
  const mode = panel.mode;
  const docked = mode && mode !== "transcript" ? mode : null;

  // A freshly docked mode takes focus so Escape closes it and a screen reader lands on it; the
  // transcript keeps its own focus (a pinned word, the reading position) and is never grabbed.
  useEffect(() => {
    if (docked) dockRef.current?.focus();
  }, [docked]);

  // Closing any mode gives the video the whole room back and returns focus to the bar option that
  // opened it, so the close gesture reads the same everywhere the panel appears.
  const closePanel = () => {
    const closing = mode;
    panel.close();
    if (closing) barRef.current?.focus(closing);
  };

  return (
    <div className="watch-panel" id={panel.panelId} data-watch-panel-mode={mode ?? "closed"}>
      {/* The transcript wears the same titled head as every docked mode, so one close gesture
          serves the whole panel. The feed itself stays mounted across modes; CSS shows it only in
          its own mode. */}
      {mode === "transcript" && (
        <header className="watch-panel-head">
          <h3 className="watch-panel-title">Transcript</h3>
          <button
            type="button"
            className="watch-panel-close"
            aria-label="Close transcript"
            onClick={closePanel}
          >
            Close
          </button>
        </header>
      )}
      <div className="watch-panel-transcript">{transcript}</div>

      {docked && (
        <div
          className="watch-panel-docked"
          ref={dockRef}
          tabIndex={-1}
          data-watch-panel-region={docked}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              closePanel();
            }
          }}
        >
          {docked === "tune" ? (
            // The face is its own "Learning notes" region, so it is not wrapped in a second
            // labelled region; the panel gives it the shared titled head for orientation, then the
            // prose face floats beneath with no card of its own.
            <>
              <header className="watch-panel-head">
                <h3 className="watch-panel-title">{PANEL_HEADS.tune.title}</h3>
                <button
                  type="button"
                  className="watch-panel-close"
                  aria-label={PANEL_HEADS.tune.close}
                  onClick={closePanel}
                >
                  Close
                </button>
              </header>
              <LearningFineTuneFace interaction={prepInteraction} />
            </>
          ) : (
            <section className="watch-panel-region" aria-label={REGION_LABELS[docked]}>
              <header className="watch-panel-head">
                <div className="watch-panel-head-lead">
                  <h3 className="watch-panel-title">{PANEL_HEADS[docked].title}</h3>
                  {docked === "saved" && <SavedScopeBadge />}
                </div>
                <button
                  type="button"
                  className="watch-panel-close"
                  aria-label={PANEL_HEADS[docked].close}
                  onClick={closePanel}
                >
                  Close
                </button>
              </header>
              {docked === "details" && <ResultBrief bundle={bundle} detailed showEvidence={showEvidence} />}
              {docked === "saved" && showSaved && <SavedList saved={tools.saved} onRemove={tools.remove} />}
            </section>
          )}
        </div>
      )}
    </div>
  );
}

/** The accessible name each docked region carries. */
const REGION_LABELS: Record<"details" | "saved", string> = {
  details: "Details",
  saved: "Saved",
};
