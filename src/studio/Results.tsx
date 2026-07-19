import { motion } from "motion/react";
import { useEffect, useRef, useState } from "react";

import { clock } from "./format";
import { CinemaView, Compress, Expand, PanelDock, PanelNarrower, PanelOverlay, PanelWider, SplitView } from "./glyphs";
import LearningResults from "./learning/LearningResults";
import RecordedMediaPlayer from "./learning/RecordedMediaPlayer";
import { projectPrototypeLearningPresentation } from "./learning/prototypeAdapter";
import { learningPrototypeFixture } from "./learning/prototypeFixture";
import { projectRecordedLearningSource } from "./learning/sourceAdapters";
import { RECORDED_RESULTS_ID } from "./resultAccess";
import { useBundle, useStudio } from "./store";

/**
 * The result of a run: the media you can watch, and the timed Korean→English transcript it will
 * stand behind. Lines it cannot stand behind are shown as labelled gaps — withheld with a reason,
 * or silence — never a guess. Coverage, receipts, and raw files sit under progressive disclosure.
 *
 * Deliberately absent: accuracy scores, cold/diff comparison, timing, and agent/worker counts.
 * None of those are produced for a real request — they belong to the benchmark lane, not here.
 */
export default function Results() {
  const bundle = useBundle();
  const previewSession = useStudio((s) => s.previewSession);
  const clipT = useStudio((s) => s.clipT);
  const setClipT = useStudio((s) => s.setClipT);
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
  }, [bundle]);

  if (!bundle) return null;

  const { run } = bundle;
  const learningSource = projectRecordedLearningSource(bundle);
  const learningPresentation = projectPrototypeLearningPresentation(
    learningSource,
    learningPrototypeFixture,
  );

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
    <motion.div
      id={RECORDED_RESULTS_ID}
      className="results"
      role="region"
      aria-label="Result"
      tabIndex={-1}
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1], delay: 0.15 }}
    >
      {previewSession?.preparation.status === "ready" && (
        <SubmittedSourceResultBoundary
          previewSession={previewSession}
          recordedRunId={run.id}
          recordedTitle={run.clip.title}
        />
      )}

      <section
        className="result-viewer"
        ref={viewerRef}
        aria-label="Learning viewer"
        data-view-mode={fullscreen ? "fullscreen" : viewerMode}
        data-fs-panel={fullscreen ? panelPlacement : undefined}
        data-panel-size={panelSize}
      >
        {viewerNotice && <p className="result-viewer-notice" role="status">{viewerNotice}</p>}
        <div className="result-main">
          <RecordedMediaPlayer bundle={bundle} surface="results" modeControls={modeControls} panelControls={panelControls} />
          <LearningResults
            presentation={learningPresentation}
            playback={{
              state: "available",
              authority: "recorded_fixture",
              currentTimeMs: clipT * 1_000,
              onSeek: (timeMs) => setClipT(timeMs / 1_000),
            }}
          />
        </div>
      </section>
    </motion.div>
  );
}

function SubmittedSourceResultBoundary({
  previewSession,
  recordedRunId,
  recordedTitle,
}: {
  previewSession: NonNullable<ReturnType<typeof useStudio.getState>["previewSession"]>;
  recordedRunId: string;
  recordedTitle: string;
}) {
  if (!previewSession.resolution || previewSession.preparation.status !== "ready") return null;
  const { resolution } = previewSession;
  const request = previewSession.preparation.request;
  const sourceLanguage = request.language.source.mode === "automatic"
    ? { value: "Automatic requested", note: "detection never started" }
    : { value: request.language.source.language, note: "user declared" };
  return (
    <section
      className="submitted-results-boundary"
      aria-labelledby="submitted-results-title"
      data-submitted-preparation-request-id={request.requestId}
    >
      <header>
        <span>Submitted source</span>
        <h2 id="submitted-results-title">Submitted source was not processed</h2>
        <p>
          No artifact exists for <b>{resolution.source.label}</b>. The viewer below shows only the recorded demo
          {` ${recordedRunId}`}: {recordedTitle}.
        </p>
      </header>
      <details>
        <summary>Submitted request details</summary>
        <dl>
          <div><dt>Selected range</dt><dd>{clock(request.range.startMs / 1_000)} to {clock(request.range.endMs / 1_000)}</dd></div>
          <div><dt>Source language</dt><dd className="dd-stacked"><span>{sourceLanguage.value}</span><small>{sourceLanguage.note}</small></dd></div>
          <div><dt>Requested target</dt><dd>{request.language.target}</dd></div>
          <div><dt>Artifact status</dt><dd className="dd-stacked"><span>Unavailable</span><small>no runtime receipt</small></dd></div>
        </dl>
        <p className="submitted-results-identity">
          <span>Preparation identity</span>
          <code>{request.requestId}</code>
        </p>
      </details>
    </section>
  );
}
