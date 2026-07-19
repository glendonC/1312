import { useEffect, useRef, useState, type ReactNode } from "react";

// Direct import so Vite invalidates shell styles on every surface that composes the viewer.
import "../../styles/studio/results.viewer.css";
import { CinemaView, Compress, Expand, PanelDock, PanelNarrower, PanelOverlay, PanelWider, SplitView } from "../glyphs";

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
  media,
  mediaMeta,
  learning,
}: {
  authority: ResultAuthority;
  /** Optional right side of the shell bar: title and disclosure panels for surfaces without header chrome. */
  chrome?: ReactNode;
  media: (slots: ViewerModeSlots) => ReactNode;
  /** The wired under-video strip (coverage, attribution, verified range). Hidden in full screen. */
  mediaMeta?: ReactNode;
  learning: ReactNode;
}) {
  const viewerRef = useRef<HTMLElement>(null);
  const [viewerMode, setViewerMode] = useState<"split" | "cinema">("split");
  const [fullscreen, setFullscreen] = useState(false);
  const [fullscreenAvailable, setFullscreenAvailable] = useState(false);
  // Where the Learning panel sits once the viewer is full screen, and how wide it reads. Both are
  // sticky for the session so the choice survives leaving and re-entering full screen.
  const [panelPlacement, setPanelPlacement] = useState<"docked" | "overlay">("docked");
  const [panelSize, setPanelSize] = useState<"s" | "m" | "l">("m");
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

  const PANEL_SIZES = ["s", "m", "l"] as const;
  const stepPanelSize = (direction: -1 | 1) => {
    const index = PANEL_SIZES.indexOf(panelSize);
    const next = PANEL_SIZES[Math.min(PANEL_SIZES.length - 1, Math.max(0, index + direction))];
    if (next !== panelSize) setPanelSize(next);
  };
  // The learning panel is only a side panel in Split and in full screen; Cinema stacks it below the
  // video, where a width control has nothing to act on, so the width stepper is hidden there.
  const panelHasWidth = fullscreen || viewerMode === "split";

  // The viewing modes live on the video's control bar, YouTube-style, as one coherent icon control:
  // each glyph depicts the layout it selects (Split and Cinema divide the frame; Full screen is the
  // universal expand). No orphan control, no words sitting on the picture. Every button carries an
  // aria-label and a hover/focus tooltip, so the meaning is one pointer-hover or one screen reader away
  // and keyboard reachable (focus reveals the bar). In full screen a second pair chooses where the
  // Learning panel sits: Docked beside the video, or Overlay floating on it.
  const modeControls = (
    <div className="player-modes">
      <span className="player-modes-seg" role="group" aria-label="Viewing mode">
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
  // transport bar: how wide the Learning panel reads (Split and full screen), and where it sits once
  // full screen (Docked beside the video, or Overlay floating on it).
  const panelControls = (
    <>
      {panelHasWidth && (
        <>
          <span className="pcap-div" aria-hidden="true" />
          <span className="pcap-group pcap-panel" role="group" aria-label="Panel width">
            <button
              type="button"
              className="pcap-btn"
              aria-label="Narrower panel"
              disabled={panelSize === "s"}
              onClick={() => stepPanelSize(-1)}
            >
              <PanelNarrower />
              <span className="pm-tip" aria-hidden="true">Narrower panel</span>
            </button>
            <button
              type="button"
              className="pcap-btn"
              aria-label="Wider panel"
              disabled={panelSize === "l"}
              onClick={() => stepPanelSize(1)}
            >
              <PanelWider />
              <span className="pm-tip" aria-hidden="true">Wider panel</span>
            </button>
          </span>
        </>
      )}
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
              aria-label="Overlay"
              aria-pressed={panelPlacement === "overlay"}
              onClick={() => setPanelPlacement("overlay")}
            >
              <PanelOverlay />
              <span className="pm-tip" aria-hidden="true">Overlay</span>
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
      data-view-mode={fullscreen ? "fullscreen" : viewerMode}
      data-fs-panel={fullscreen ? panelPlacement : undefined}
      data-panel-size={panelSize}
    >
      <div className="result-shell-bar">
        <AuthorityBadge authority={authority} />
        {chrome && <div className="result-shell-chrome">{chrome}</div>}
      </div>
      {viewerNotice && <p className="result-viewer-notice" role="status">{viewerNotice}</p>}
      <div className="result-main">
        <div className="result-media-col">
          {media({ modeControls, panelControls })}
          {mediaMeta}
        </div>
        {learning}
      </div>
    </section>
  );
}
