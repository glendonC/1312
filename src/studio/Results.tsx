import { motion } from "motion/react";
import { useMemo } from "react";

import { clock } from "./format";
import { projectMomentMarkers } from "./learning/MomentsOverlay";
import RecordedMediaPlayer from "./learning/RecordedMediaPlayer";
import { projectPrototypeLearningPresentation } from "./learning/prototypeAdapter";
import { learningPrototypeFixture } from "./learning/prototypeFixture";
import { projectRecordedLearningSource } from "./learning/sourceAdapters";
import { useRecordedLearningPrep } from "./learning/useRecordedLearningPrep";
import { RECORDED_RESULTS_ID } from "./resultAccess";
import { useBundle, useStudio } from "./store";
import type { RunBundle } from "./transport";
import LearningResultExperience from "./viewer/LearningResultExperience";

/**
 * The result of a run: the media you can watch, and the timed Korean→English transcript it will
 * stand behind. Lines it cannot stand behind are shown as labelled gaps — withheld with a reason,
 * or silence — never a guess. Coverage, receipts, and raw files sit under progressive disclosure.
 *
 * The composition itself is the shared ResultViewerShell in its "workbench" frame: the result
 * workspace around it owns the framing (title in the environment head, evidence class in the
 * hero facts and the Source panel), so no authority bar renders above the viewer here. This
 * surface contributes the recorded authority itself: the replay-clock player and the
 * fixture-bound prototype learning presentation.
 *
 * Deliberately absent: accuracy scores, cold/diff comparison, timing, and agent/worker counts.
 * None of those are produced for a real request — they belong to the benchmark lane, not here.
 */
export default function Results() {
  const bundle = useBundle();
  const previewSession = useStudio((s) => s.previewSession);
  const clipT = useStudio((s) => s.clipT);
  const setClipT = useStudio((s) => s.setClipT);

  if (!bundle) return null;

  return (
    <RecordedResult
      bundle={bundle}
      previewSession={previewSession}
      clipT={clipT}
      setClipT={setClipT}
    />
  );
}

function RecordedResult({
  bundle,
  previewSession,
  clipT,
  setClipT,
}: {
  bundle: RunBundle;
  previewSession: ReturnType<typeof useStudio.getState>["previewSession"];
  clipT: number;
  setClipT: (time: number) => void;
}) {
  const { run } = bundle;
  const learningSource = useMemo(() => projectRecordedLearningSource(bundle), [bundle]);
  const learningPresentation = projectPrototypeLearningPresentation(
    learningSource,
    learningPrototypeFixture,
  );
  const prepInteraction = useRecordedLearningPrep(learningSource, learningPrototypeFixture);
  const momentMarkers = projectMomentMarkers(prepInteraction.prep);
  const playback = {
    state: "available" as const,
    authority: "recorded_fixture" as const,
    currentTimeMs: clipT * 1_000,
    onSeek: (timeMs: number) => setClipT(timeMs / 1_000),
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

      <LearningResultExperience
        authority="recorded_demo"
        frame="workbench"
        media={({ modeControls, panelControls }) => (
          <RecordedMediaPlayer
            bundle={bundle}
            surface="results"
            modeControls={modeControls}
            panelControls={panelControls}
            momentMarkers={momentMarkers}
          />
        )}
        presentation={learningPresentation}
        playback={playback}
        prepInteraction={prepInteraction}
      />
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
