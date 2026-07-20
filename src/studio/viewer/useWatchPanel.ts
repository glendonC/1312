import { useEffect, useId, useState } from "react";

/**
 * The watch room's one docked panel has a single selected content, chosen from the command bar.
 * "transcript" is the reading feed; the other modes swap into the same panel. There is never more
 * than one, so the room stays a video with one console, not a spread of separate surfaces.
 */
export type WatchPanelMode = "transcript" | "details" | "saved" | "tune";

/**
 * Which mode the docked panel is showing, or null when the panel is closed and the video has the
 * whole room. Closed is the DEFAULT: the watch room opens as a normal video with its captions on
 * the picture, and every panel, the transcript included, is a reveal from the command bar, never
 * an ambient sidebar. Selecting the mode already open closes the panel, so every bar option is a
 * toggle. The state is owned above the panel and the transcript, so switching modes never remounts
 * the viewer and pinned explanations, saved items, and playback survive it. It resets to closed
 * only when the learning source changes, i.e. a different run; never across the
 * arrival/report/watch faces of one result.
 */
export interface WatchPanelState {
  mode: WatchPanelMode | null;
  panelId: string;
  select: (mode: WatchPanelMode) => void;
  /** Open a mode without toggling, for a gesture (like Explain on the video) that needs it shown. */
  reveal: (mode: WatchPanelMode) => void;
  /** Close the panel and give the video the whole room. */
  close: () => void;
}

export function useWatchPanel(sourceKey: string): WatchPanelState {
  const [mode, setMode] = useState<WatchPanelMode | null>(null);
  const panelId = useId();

  useEffect(() => {
    setMode(null);
  }, [sourceKey]);

  return {
    mode,
    panelId,
    select: (next) => setMode((current) => (current === next ? null : next)),
    reveal: (next) => setMode(next),
    close: () => setMode(null),
  };
}
