import { motion } from "motion/react";
import { useMemo } from "react";

import RecordedMediaPlayer from "./learning/RecordedMediaPlayer";
import { projectMomentMarkers } from "./learning/MomentsOverlay";
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
  const clipT = useStudio((s) => s.clipT);
  const setClipT = useStudio((s) => s.setClipT);

  if (!bundle) return null;

  return (
    <RecordedResult
      bundle={bundle}
      clipT={clipT}
      setClipT={setClipT}
    />
  );
}

function RecordedResult({
  bundle,
  clipT,
  setClipT,
}: {
  bundle: RunBundle;
  clipT: number;
  setClipT: (time: number) => void;
}) {
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
