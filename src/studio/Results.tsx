import { motion } from "motion/react";
import { useEffect, useRef, useState } from "react";

import { clock } from "./format";
import { Compress, Expand } from "./glyphs";
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
  const [viewerMode, setViewerMode] = useState<"study" | "theater">("study");
  const [fullscreen, setFullscreen] = useState(false);
  const [fullscreenAvailable, setFullscreenAvailable] = useState(false);
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

  const chooseViewerMode = async (mode: "study" | "theater") => {
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

  // The viewing modes live on the video's control bar, YouTube-style: two layout toggles and a real
  // full-screen icon at the right. They stay keyboard reachable (focus reveals the bar), not hover-only.
  const modeControls = (
    <div className="player-modes" role="group" aria-label="Viewing mode">
      <span className="player-modes-layout">
        <button
          type="button"
          aria-pressed={!fullscreen && viewerMode === "study"}
          onClick={() => void chooseViewerMode("study")}
        >
          Study
        </button>
        <button
          type="button"
          aria-pressed={!fullscreen && viewerMode === "theater"}
          onClick={() => void chooseViewerMode("theater")}
        >
          Theater
        </button>
      </span>
      <button
        type="button"
        className="player-fullscreen"
        aria-pressed={fullscreen}
        aria-label={fullscreen ? "Exit full screen" : "Full screen"}
        title={fullscreen ? "Exit full screen" : "Full screen"}
        disabled={!fullscreenAvailable}
        onClick={() => void toggleFullscreen()}
      >
        {fullscreen ? <Compress /> : <Expand />}
      </button>
    </div>
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
      >
        {viewerNotice && <p className="result-viewer-notice" role="status">{viewerNotice}</p>}
        <div className="result-main">
          <RecordedMediaPlayer bundle={bundle} surface="results" modeControls={modeControls} />
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
