import { useEffect, useRef, useState, type ReactNode } from "react";

import "../../styles/studio/results.learning-prep.css";
import LearningResults, { CaptionModeControl } from "../learning/LearningResults";
import {
  availableMoments,
  LEARNING_LENS_LABELS,
  MomentBody,
} from "../learning/momentContent";
import { useViewerSession } from "../learning/viewerSession";
import type {
  LearningPlayback,
  LearningPrepInteraction,
  LearningPresentation,
  ProductionLearningInteraction,
} from "../learning/presentation.ts";
import { learningSourceKey, useLearningTools } from "../learning/useLearningTools";
import type { RunBundle } from "../transport";
import ResultViewerShell, {
  type ResultAuthority,
  type ViewerModeSlots,
} from "./ResultViewerShell";
import WatchBar, { type WatchBarHandle } from "./WatchBar";
import WatchPanel from "./WatchPanel";
import { useWatchPanel } from "./useWatchPanel";

/**
 * The complete result presentation shared by recorded and production authority: one viewer shell,
 * one media-overlay seat, and one learning experience. In the workbench frame the composing result
 * workspace turns this into the watch room: a normal video first, with the captions on the picture
 * and their control riding it, a single command bar on the stage baseline, and one docked panel
 * (closed by default) whose content that bar swaps between the transcript, Details, Saved, and
 * Notes. Authority-specific code supplies media, playback, and projections only; it cannot
 * silently drop pieces of the product UI.
 */
export default function LearningResultExperience({
  authority,
  bundle,
  chrome,
  frame = "standard",
  media,
  presentation,
  playback,
  learningInteraction,
  prepInteraction,
}: {
  authority: ResultAuthority;
  /** The completed run, for the watch room's stage facts and disclosures (workbench frame only). */
  bundle?: RunBundle;
  chrome?: ReactNode;
  /** Passed through to ResultViewerShell: "workbench" when the composing surface owns the framing. */
  frame?: "standard" | "workbench";
  media: (slots: ViewerModeSlots) => ReactNode;
  presentation: LearningPresentation;
  playback: LearningPlayback;
  learningInteraction?: ProductionLearningInteraction;
  prepInteraction: LearningPrepInteraction;
}) {
  // One owner of the result session's study tools (Saved) and of which mode the watch room's single
  // panel is showing, above both the transcript and the panel, so switching modes never remounts the
  // viewer and pinned explanations, saved items, and playback survive it.
  const tools = useLearningTools(presentation);
  const panel = useWatchPanel(learningSourceKey(presentation));
  const barRef = useRef<WatchBarHandle | null>(null);
  const captionMode = useViewerSession((state) => state.captionMode);
  const setCaptionMode = useViewerSession((state) => state.setCaptionMode);
  const clozeAmount = useViewerSession((state) => state.clozeAmount);
  const setClozeAmount = useViewerSession((state) => state.setClozeAmount);
  /** Whether the on-video note body is open. Marks never open themselves. */
  const [videoNotesOpen, setVideoNotesOpen] = useState(false);
  const showSaved = presentation.mode === "prototype";
  const inWorkbench = frame === "workbench";
  const prep = prepInteraction.prep;

  // The prepared notes whose caption window the playhead is inside right now. They show only as
  // one small plain mark on the video; the notes themselves open on tap and never pop on their
  // own, so playback rolling into the next window closes the reading, never opens one.
  const activeNotes = inWorkbench && playback.state === "available"
    ? availableMoments(prep).filter((note) =>
        playback.currentTimeMs >= note.startMs && playback.currentTimeMs < note.endMs)
    : [];
  const activeNoteKey = activeNotes.map((note) => `${note.lineId}:${note.lens}`).join("|");
  useEffect(() => {
    setVideoNotesOpen(false);
  }, [activeNoteKey]);

  const transcript = (
    <LearningResults
      presentation={presentation}
      playback={playback}
      productionInteraction={learningInteraction}
      prepInteraction={prepInteraction}
      tools={tools}
      showBar={!inWorkbench}
      speakers={bundle?.run.clip.speakers}
      onExplainRequested={inWorkbench ? () => panel.reveal("transcript") : undefined}
    />
  );

  return (
    <ResultViewerShell
      authority={authority}
      chrome={chrome}
      frame={frame}
      media={(slots) => (
        <div className="learning-player-frame">
          {media(slots)}
          {/* The captions read on the video, so their control rides the video too: one caption
              mode (both / one language / Listen) driving the burned-in line beneath it. */}
          {inWorkbench && bundle && (
            <div className="watch-caption-controls">
              <CaptionModeControl
                mode={captionMode}
                onMode={setCaptionMode}
                cloze={clozeAmount}
                onCloze={setClozeAmount}
                sourceLanguage={bundle.run.pair.source}
                targetLanguage={bundle.run.pair.target}
              />
            </div>
          )}
          {activeNotes.length > 0 && (
            <div className="watch-notes" data-note-lens={activeNotes[0].lens}>
              <button
                type="button"
                className="watch-note-mark"
                aria-expanded={videoNotesOpen}
                onClick={() => setVideoNotesOpen((open) => !open)}
              >
                {activeNotes.length === 1 ? "Note" : `${activeNotes.length} notes`}
              </button>
              {videoNotesOpen && activeNotes.map((note) => (
                <div
                  key={`${note.lineId}:${note.lens}`}
                  className="watch-note-body"
                  data-note-lens={note.lens}
                >
                  <span className="watch-note-kind">{LEARNING_LENS_LABELS[note.lens]}</span>
                  <MomentBody moment={note} />
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      stageConsole={
        // The watch stage's one control surface, anchored on the room's bottom edge rather than in
        // the media column, so it stays centered on the room while the clip slides aside for the
        // panel. Mounted in every workbench face so the viewer never remounts; CSS shows it only in
        // the watch room.
        inWorkbench && bundle ? (
          <div className="watch-console">
            {(presentation.mode === "prototype" || learningInteraction) && (
              <p className="watch-hint">
                {presentation.mode === "prototype"
                  ? "Select any words in the captions to translate, explain, or save them"
                  : "Select any words in the captions to translate or explain them"}
              </p>
            )}
            <WatchBar
              ref={barRef}
              panel={panel}
              showSaved={showSaved}
              savedCount={tools.saved.length}
              prepState={prep.state}
            />
          </div>
        ) : undefined
      }
      learning={
        inWorkbench && bundle ? (
          <WatchPanel
            panel={panel}
            bundle={bundle}
            transcript={transcript}
            tools={tools}
            prepInteraction={prepInteraction}
            showSaved={showSaved}
            barRef={barRef}
          />
        ) : (
          transcript
        )
      }
    />
  );
}
