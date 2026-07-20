import type {
  AvailableLearningPrepMoment,
  LearningLensKind,
  LearningPrepProjection,
} from "./presentation.ts";

/**
 * The prepared help that actually exists. Withheld and abstained moments are counted nowhere and
 * shown nowhere, exactly as they stay silent on the timeline and in the overlay.
 */
export function availableMoments(prep: LearningPrepProjection): AvailableLearningPrepMoment[] {
  if (prep.state !== "ready") return [];
  return prep.moments.filter(
    (moment): moment is AvailableLearningPrepMoment => moment.availability === "available",
  );
}

/** One name per prepared lens, shared by every surface that has to say what a note is. Plain
 *  words a viewer already knows; "situating" is internal vocabulary and reads as Context. */
export const LEARNING_LENS_LABELS: Record<LearningLensKind, string> = {
  word_order: "Word order",
  grammar_salience: "Grammar",
  situating: "Context",
  culture_reference: "Culture",
  historical_reference: "History",
};

/**
 * The prepared note itself, rendered from the lens-shaped content union. The tappable marks in the
 * transcript and the on-video note marks are two placements of one projection, so neither can
 * drift into a private copy of what a lens says.
 */
export function MomentBody({ moment }: { moment: AvailableLearningPrepMoment }) {
  if (moment.lens === "word_order") {
    return (
      <p>
        <b lang="ko">{moment.content.sourcePhrase}</b>
        <b lang="en">{moment.content.targetPhrase}</b>
        {moment.content.note}
      </p>
    );
  }
  if (moment.lens === "grammar_salience") {
    return <p><b>{moment.content.construction}</b>{moment.content.note}</p>;
  }
  if (moment.lens === "situating") {
    return <p>{moment.content.situation}</p>;
  }
  return <p><b>{moment.content.referent}</b>{moment.content.note}</p>;
}

/** m:ss.t, the clock the transcript and the saved collection already read in. */
export function momentClock(milliseconds: number): string {
  const safe = Math.max(0, Math.trunc(milliseconds));
  const totalSeconds = Math.floor(safe / 1_000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const tenths = Math.floor((safe % 1_000) / 100);
  return `${minutes}:${String(seconds).padStart(2, "0")}.${tenths}`;
}
