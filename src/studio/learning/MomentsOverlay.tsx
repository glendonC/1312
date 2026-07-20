import type { PlayerProgressMarker } from "../viewer/playerChrome";
import type {
  LearningLensKind,
  LearningPlayback,
  LearningPrepProjection,
} from "./presentation.ts";

const OVERLAY_LENS_LABELS: Record<LearningLensKind, string> = {
  word_order: "Word order",
  grammar_salience: "Grammar",
  situating: "Situating",
  culture_reference: "Culture",
  historical_reference: "History",
};

/**
 * Where prepared help will surface, as timeline waypoints for the player's progress bar. Only
 * available moments become markers — withheld and abstained help stays invisible here exactly
 * as it stays silent in the overlay.
 */
export function projectMomentMarkers(prep: LearningPrepProjection): PlayerProgressMarker[] {
  if (prep.state !== "ready") return [];
  return prep.moments
    .filter((moment) => moment.availability === "available")
    .map((moment) => ({ start: moment.startMs / 1_000, kind: moment.lens }));
}

/**
 * The Moments overlay surfaces at most one prepared available note for the moment under the
 * playhead. Silence is its default state; it never pauses, gates, or invents content, and it is
 * distinct from the fullscreen learning-panel placement toggle that is also called Overlay.
 */
export default function MomentsOverlay({
  prep,
  playback,
}: {
  prep: LearningPrepProjection;
  playback: LearningPlayback;
}) {
  if (prep.state !== "ready" || playback.state !== "available") return null;
  const active = prep.moments.find((moment) =>
    moment.availability === "available" &&
    playback.currentTimeMs >= moment.startMs &&
    playback.currentTimeMs < moment.endMs);
  if (!active || active.availability !== "available") return null;

  return (
    <aside
      className="learning-moments-overlay"
      aria-label="Learning moments overlay"
      data-moments-overlay-state="active"
      data-moments-overlay-authority={active.dataClass}
      data-moments-lens={active.lens}
      data-moments-line-id={active.lineId}
    >
      <span className="learning-moments-lens">{OVERLAY_LENS_LABELS[active.lens]}</span>
      {active.lens === "word_order" ? (
        <p>
          <b lang="ko">{active.content.sourcePhrase}</b>
          <b lang="en">{active.content.targetPhrase}</b>
          {active.content.note}
        </p>
      ) : active.lens === "grammar_salience" ? (
        <p><b>{active.content.construction}</b>{active.content.note}</p>
      ) : active.lens === "situating" ? (
        <p>{active.content.situation}</p>
      ) : (
        <p><b>{active.content.referent}</b>{active.content.note}</p>
      )}
      <span className="learning-moments-review-state">
        {active.dataClass === "design_fixture" ? "recorded fixture · not reviewed" : "unreviewed note"}
      </span>
    </aside>
  );
}
