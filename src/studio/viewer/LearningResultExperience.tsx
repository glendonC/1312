import type { ReactNode } from "react";

import "../../styles/studio/results.learning-prep.css";
import LearningResults from "../learning/LearningResults";
import MomentsOverlay from "../learning/MomentsOverlay";
import type {
  LearningPlayback,
  LearningPrepInteraction,
  LearningPresentation,
  ProductionLearningInteraction,
} from "../learning/presentation.ts";
import ResultViewerShell, {
  type ResultAuthority,
  type ViewerModeSlots,
} from "./ResultViewerShell";

/**
 * The complete result presentation shared by recorded and production authority: one viewer shell,
 * one media-overlay seat, and one learning workspace that carries the fine-tune face behind its
 * Tune disclosure. Authority-specific code supplies media, playback, and projections only; it
 * cannot silently drop pieces of the product UI.
 */
export default function LearningResultExperience({
  authority,
  chrome,
  frame,
  media,
  presentation,
  playback,
  learningInteraction,
  prepInteraction,
}: {
  authority: ResultAuthority;
  chrome?: ReactNode;
  /** Passed through to ResultViewerShell: "workbench" when the composing surface owns the framing. */
  frame?: "standard" | "workbench";
  media: (slots: ViewerModeSlots) => ReactNode;
  presentation: LearningPresentation;
  playback: LearningPlayback;
  learningInteraction?: ProductionLearningInteraction;
  prepInteraction: LearningPrepInteraction;
}) {
  return (
    <ResultViewerShell
      authority={authority}
      chrome={chrome}
      frame={frame}
      media={(slots) => (
        <div className="learning-player-frame">
          {media(slots)}
          <MomentsOverlay prep={prepInteraction.prep} playback={playback} />
        </div>
      )}
      learning={(
        <LearningResults
          presentation={presentation}
          playback={playback}
          productionInteraction={learningInteraction}
          prepInteraction={prepInteraction}
        />
      )}
    />
  );
}
