import { useEffect, useRef, useState, type ReactNode } from "react";

// Direct import so Vite invalidates shell styles on every surface that composes the viewer.
import "../../styles/studio/results.viewer.css";
import { CinemaView, Compress, Expand, PanelDock, PanelFloat, SplitView } from "../glyphs";

/**
 * Which authority stands behind what is playing. This is presentation of an already-established
 * fact, never a claim: the recorded demo replays immutable fixtures, and a production clip is the
 * learner's own verified private artifact. The badge is the one always-on label that keeps the two
 * from being mistaken for each other inside an otherwise identical viewer.
 */
export type ResultAuthority = "recorded_demo" | "production_clip";

const AUTHORITY_LABELS: Record<ResultAuthority, string> = {
  recorded_demo: "Recorded demo",
  production_clip: "Your clip",
};

export function AuthorityBadge({ authority }: { authority: ResultAuthority }) {
  return (
    <p className="result-authority-badge" data-result-authority={authority}>
      {AUTHORITY_LABELS[authority]}
    </p>
  );
}

export interface ViewerModeSlots {
  /** The Split / Cinema / Full screen cluster, rendered by the player onto the video surface. */
  modeControls: ReactNode;
  /** Learning-panel width and full-screen placement, rendered into the player's settings pill. */
  panelControls: ReactNode;
}

/**
 * The one watch shell: media and transcript in the Split / Cinema / Full screen composition, with
 * the learning panel's width and full-screen placement as sticky session choices. The shell owns
 * only viewing-mode presentation state; everything with authority — the media element, playback
 * clock, captions, learning data — arrives through slots from a surface that owns its facts. The
 * recorded demo and verified production results both render through here, so the product has one
 * watch experience with two clearly-badged authorities.
 */
export default function ResultViewerShell({
  authority,
  chrome,
  frame = "standard",
  media,
  learning,
  stageConsole,
}: {
  authority: ResultAuthority;
  /** Optional right side of the shell bar: title and disclosure panels for surfaces without header chrome. */
  chrome?: ReactNode;
  /**
   * "standard" carries the always-on authority bar above the composition. "workbench" is for a
   * surface that already frames the viewer with its own identity and evidence facts (the result
   * workspace's focus-panel hero): the bar is omitted, the authority stays machine-readable on
   * the region, and the composing surface owns stating the evidence class in visible text.
   */
  frame?: "standard" | "workbench";
  media: (slots: ViewerModeSlots) => ReactNode;
  learning: ReactNode;
  /**
   * The watch room's command bar, placed as a direct child of the composition rather than inside the
   * media column, so it is anchored on the room and never rides the transform that slides the clip
   * aside for the panel. Omitted (undefined) outside the workbench watch room.
   */
  stageConsole?: ReactNode;
}) {
  const viewerRef = useRef<HTMLElement>(null);
  const [viewerMode, setViewerMode] = useState<"split" | "cinema">("split");
  const [fullscreen, setFullscreen] = useState(false);
  const [fullscreenAvailable, setFullscreenAvailable] = useState(false);
  // Where the Learning panel sits once the viewer is full screen. Sticky for the session so the
  // choice survives leaving and re-entering full screen.
  const [panelPlacement, setPanelPlacement] = useState<"docked" | "float">("docked");
  const [viewerNotice, setViewerNotice] = useState<string | null>(null);

  useEffect(() => {
    const syncFullscreen = () => setFullscreen(document.fullscreenElement === viewerRef.current);
    setFullscreenAvailable(document.fullscreenEnabled && typeof viewerRef.current?.requestFullscreen === "function");
    document.addEventListener("fullscreenchange", syncFullscreen);
    return () => document.removeEventListener("fullscreenchange", syncFullscreen);
  }, []);

  const chooseViewerMode = async (mode: "split" | "cinema") => {
    try {
      if (document.fullscreenElement === viewerRef.current) await document.exitFullscreen();
      setViewerMode(mode);
      setViewerNotice(null);
    } catch {
      setViewerNotice("The viewing mode could not be changed.");
    }
  };

  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement === viewerRef.current) {
        await document.exitFullscreen();
      } else if (viewerRef.current && fullscreenAvailable) {
        await viewerRef.current.requestFullscreen();
      }
      setViewerNotice(null);
    } catch {
      setViewerNotice("Full screen is unavailable in this browser.");
    }
  };

  // The viewing modes live on the video's control bar, YouTube-style, as one coherent icon control:
  // each glyph depicts the layout it selects (Split and Cinema divide the frame; Full screen is the
  // universal expand). No orphan control, no words sitting on the picture. Every button carries an
  // aria-label and a hover/focus tooltip, so the meaning is one pointer-hover or one screen reader away
  // and keyboard reachable (focus reveals the bar). In full screen a second pair chooses where the
  // Learning panel sits: Docked beside the video, or Float hovering over it. The workbench frame
  // renders no Split/Cinema choice at all — its composing workspace owns the layout (the watch
  // face is the stage) and browser Full screen is the one mode control it keeps.
  const modeControls = (
    <div className="player-modes">
      <span className="player-modes-seg" role="group" aria-label="Viewing mode">
        {frame === "standard" && (
          <>
            <button
              type="button"
              className="pm-btn pm-view"
              aria-label="Split"
              aria-pressed={!fullscreen && viewerMode === "split"}
              onClick={() => void chooseViewerMode("split")}
            >
              <SplitView />
              <span className="pm-tip" aria-hidden="true">Split</span>
            </button>
            <button
              type="button"
              className="pm-btn pm-view"
              aria-label="Cinema"
              aria-pressed={!fullscreen && viewerMode === "cinema"}
              onClick={() => void chooseViewerMode("cinema")}
            >
              <CinemaView />
              <span className="pm-tip" aria-hidden="true">Cinema</span>
            </button>
          </>
        )}
        <button
          type="button"
          className="pm-btn pm-fs"
          aria-label="Full screen"
          aria-pressed={fullscreen}
          disabled={!fullscreenAvailable}
          onClick={() => void toggleFullscreen()}
        >
          {fullscreen ? <Compress /> : <Expand />}
          <span className="pm-tip" aria-hidden="true">Full screen</span>
        </button>
      </span>
    </div>
  );

  // The panel-facing settings live in the top-right pill next to the caption controls, not on the
  // transport bar: where the Learning panel sits once full screen (Docked beside the video, or
  // Float hovering over it). There is deliberately no width control; the panel is sized by the room.
  const panelControls = (
    <>
      {fullscreen && (
        <>
          <span className="pcap-div" aria-hidden="true" />
          <span className="pcap-group pcap-panel" role="group" aria-label="Panel placement">
            <button
              type="button"
              className="pcap-btn"
              aria-label="Docked"
              aria-pressed={panelPlacement === "docked"}
              onClick={() => setPanelPlacement("docked")}
            >
              <PanelDock />
              <span className="pm-tip" aria-hidden="true">Docked</span>
            </button>
            <button
              type="button"
              className="pcap-btn"
              aria-label="Float"
              aria-pressed={panelPlacement === "float"}
              onClick={() => setPanelPlacement("float")}
            >
              <PanelFloat />
              <span className="pm-tip" aria-hidden="true">Float</span>
            </button>
          </span>
        </>
      )}
    </>
  );

  return (
    <section
      className="result-viewer"
      ref={viewerRef}
      aria-label="Learning viewer"
      data-result-authority={authority}
      data-shell-frame={frame}
      data-view-mode={fullscreen ? "fullscreen" : viewerMode}
      data-fs-panel={fullscreen ? panelPlacement : undefined}
    >
      {frame === "standard" && (
        <div className="result-shell-bar">
          <AuthorityBadge authority={authority} />
          {chrome && <div className="result-shell-chrome">{chrome}</div>}
        </div>
      )}
      {viewerNotice && <p className="result-viewer-notice" role="status">{viewerNotice}</p>}
      <div className="result-main">
        <div className="result-media-col">
          {media({ modeControls, panelControls })}
        </div>
        {learning}
        {stageConsole}
      </div>
    </section>
  );
}
