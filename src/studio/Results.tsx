import { motion } from "motion/react";
import { useEffect, useRef, useState } from "react";

import { clock } from "./format";
import RecordedEvidence from "./evidence/RecordedEvidence";
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
  const outputDepth = useStudio((s) => s.outputDepth);
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

  const { run, captions } = bundle;
  const target = run.pair.target;
  const showEvidence = outputDepth === "evidence";
  const learningSource = projectRecordedLearningSource(bundle);
  const learningPresentation = projectPrototypeLearningPresentation(
    learningSource,
    learningPrototypeFixture,
  );

  // Real per-line accounting, straight from the recorded cues. A refusal and a silence are
  // different facts and are counted as different things; neither is an error.
  const counts = { captioned: 0, withheld: 0, silent: 0 };
  for (const cue of captions.cues) {
    if (cue.silence) {
      counts.silent += 1;
      continue;
    }
    const tgt = cue.targets.find((t) => t.lang === target);
    if (tgt?.withheld) counts.withheld += 1;
    else if (tgt?.text) counts.captioned += 1;
  }

  const licence = run.clip.source.licence;

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

      <header className="result-head">
        <span className="result-kicker">Result</span>
        <h2>{run.clip.title}</h2>
        <p className="result-request">
          <b className="result-pair">{run.pair.source.toUpperCase()} → {target.toUpperCase()}</b>
          <span className="result-tag">{clock(0)}–{clock(run.clip.duration)}</span>
          <span className="result-tag is-quiet">recorded evidence</span>
        </p>
      </header>

      <section
        className="result-viewer"
        ref={viewerRef}
        aria-label="Learning viewer"
        data-view-mode={fullscreen ? "fullscreen" : viewerMode}
      >
        <header className="result-viewer-toolbar">
          <div className="result-viewer-identity">
            <b>{run.clip.title}</b>
            <span>{run.pair.source.toUpperCase()} to {target.toUpperCase()}</span>
          </div>
          <div className="result-view-modes" role="group" aria-label="Viewing mode">
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
            <button
              type="button"
              aria-pressed={fullscreen}
              disabled={!fullscreenAvailable}
              onClick={() => void toggleFullscreen()}
            >
              {fullscreen ? "Exit full screen" : "Full screen"}
            </button>
          </div>
        </header>
        {viewerNotice && <p className="result-viewer-notice" role="status">{viewerNotice}</p>}
        <div className="result-main">
          <RecordedMediaPlayer bundle={bundle} surface="results" />
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

      <details className="result-details">
        <summary>
          <span>Run details</span>
          <span className="result-details-summary">
            <span>{counts.captioned} captioned</span>
            <span>{counts.withheld} withheld</span>
            <span>{counts.silent} silent</span>
          </span>
        </summary>
        <dl className="result-details-list">
          <div>
            <dt>Coverage</dt>
            <dd>
              <span>{counts.captioned} captioned, {counts.withheld} withheld, {counts.silent} silent</span>
              <small>of {captions.cues.length} lines in range</small>
            </dd>
          </div>
          <div>
            <dt>Withheld</dt>
            <dd>
              <span>Refusals with a recorded reason</span>
              <small>Shown as gaps, not errors or a translation-quality score</small>
            </dd>
          </div>
          <div>
            <dt>Source</dt>
            <dd>
              <span>{run.clip.source.label}</span>
              <small>{licence ?? "Recorded evidence"}</small>
            </dd>
          </div>
        </dl>
        {showEvidence && (
          <section className="result-provenance" aria-label="Evidence and run files">
            <RecordedEvidence />
            {run.artifacts.length > 0 ? (
              <p className="result-provenance-links">
                {run.artifacts.map((artifact) => (
                  <a key={artifact} href={`/demo/runs/${run.id}/${artifact}`}>
                    {artifact}
                  </a>
                ))}
                <a href={`/demo/packs/${run.pack}.json`}>{run.pack}.json</a>
              </p>
            ) : (
              <p className="result-provenance-empty">No artifact links were declared by this run.</p>
            )}
          </section>
        )}
      </details>
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
