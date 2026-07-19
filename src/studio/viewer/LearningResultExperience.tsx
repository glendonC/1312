import type { ReactNode } from "react";

import "../../styles/studio/results.learning-prep.css";
import LearningFineTuneFace from "../learning/LearningFineTuneFace";
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
 * one media-overlay seat, one learning workspace, and one fine-tune face. Authority-specific code
 * supplies media, playback, and projections only; it cannot silently drop pieces of the product UI.
 */
export default function LearningResultExperience({
  authority,
  chrome,
  media,
  mediaMeta,
  presentation,
  playback,
  learningInteraction,
  prepInteraction,
}: {
  authority: ResultAuthority;
  chrome?: ReactNode;
  media: (slots: ViewerModeSlots) => ReactNode;
  mediaMeta?: ReactNode;
  presentation: LearningPresentation;
  playback: LearningPlayback;
  learningInteraction?: ProductionLearningInteraction;
  prepInteraction: LearningPrepInteraction;
}) {
  return (
    <>
      <ResultViewerShell
        authority={authority}
        chrome={chrome}
        media={(slots) => (
          <div className="learning-player-frame">
            {media(slots)}
            <MomentsOverlay prep={prepInteraction.prep} playback={playback} />
          </div>
        )}
        mediaMeta={mediaMeta}
        learning={(
          <LearningResults
            presentation={presentation}
            playback={playback}
            productionInteraction={learningInteraction}
          />
        )}
      />
      <LearningFineTuneFace interaction={prepInteraction} />
    </>
  );
}
