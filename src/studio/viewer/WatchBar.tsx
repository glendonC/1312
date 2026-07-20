import { forwardRef, useImperativeHandle, useRef } from "react";

import { Bookmark, Captions, Info, Sliders } from "../glyphs";
import type { LearningPrepInteraction } from "../learning/presentation.ts";
import type { WatchPanelMode, WatchPanelState } from "./useWatchPanel";

/**
 * The watch room's one control surface: the glass command capsule on the stage baseline. It wears
 * the studio's shared bottom-bar silhouette (the pill used by the input, run, and pause bars), so
 * the study room reads as the same instrument the run was launched from. Every option is a mode of
 * the single docked panel — selecting one docks that content, selecting it again closes the panel
 * and gives the video the whole room. There is no second toolbar and no scattered disclosure; this
 * bar is the only place a finished run is commanded from.
 */
export interface WatchBarHandle {
  focus: (mode: WatchPanelMode) => void;
}

interface WatchBarOption {
  mode: WatchPanelMode;
  label: string;
  icon: React.ReactNode;
}

const WatchBar = forwardRef<WatchBarHandle, {
  panel: WatchPanelState;
  /** Saved is a prototype-only collection; production results carry no canonical saved item yet. */
  showSaved: boolean;
  savedCount: number;
  prepState: LearningPrepInteraction["prep"]["state"];
}>(function WatchBar({ panel, showSaved, savedCount, prepState }, ref) {
  const buttons = useRef(new Map<WatchPanelMode, HTMLButtonElement>());

  useImperativeHandle(ref, () => ({
    focus: (mode) => buttons.current.get(mode)?.focus(),
  }), []);

  const withCount = (label: string, count: number) => (count > 0 ? `${label} (${count})` : label);
  const options: WatchBarOption[] = [
    { mode: "transcript", label: "Transcript", icon: <Captions /> },
    // Source and Coverage are one thing to a viewer (what this run is and how much of it got
    // captioned), so they read as one Details tab in the room's plain-language voice.
    { mode: "details", label: "Details", icon: <Info /> },
    ...(showSaved
      ? [{ mode: "saved" as const, label: withCount("Saved", savedCount), icon: <Bookmark filled={savedCount > 0} /> }]
      : []),
    // Notes is the prep engine in plain words: prepared context notes, marked on transcript lines.
    { mode: "tune", label: "Notes", icon: <Sliders /> },
  ];

  return (
    <nav className="watch-bar" aria-label="Watch commands">
      {options.map((option) => (
        <button
          key={option.mode}
          type="button"
          ref={(node) => {
            if (node) buttons.current.set(option.mode, node);
            else buttons.current.delete(option.mode);
          }}
          className="watch-bar-option"
          data-watch-option={option.mode}
          data-learning-prep-state={option.mode === "tune" ? prepState : undefined}
          aria-pressed={panel.mode === option.mode}
          aria-controls={panel.panelId}
          onClick={() => panel.select(option.mode)}
        >
          <span className="watch-bar-icon" aria-hidden="true">{option.icon}</span>
          <span className="watch-bar-label">{option.label}</span>
        </button>
      ))}
    </nav>
  );
});

export default WatchBar;
