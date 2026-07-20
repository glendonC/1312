import {
  LEARNING_LENS_KINDS,
  type LearningLensKind,
  type LearningPrepInteraction,
  type LearningTemperature,
} from "./presentation.ts";

/** Short lens labels, shared with the prepared-outcome list. Plain words only. */
export const LEARNING_LENS_LABELS: Record<LearningLensKind, string> = {
  word_order: "Word order",
  grammar_salience: "Grammar",
  situating: "Context",
  culture_reference: "Culture",
  historical_reference: "History",
};

/** The same lenses read as sentence phrases, so the state prose flows like the brief. */
const LENS_PHRASES: Record<LearningLensKind, string> = {
  word_order: "word order",
  grammar_salience: "grammar that stands out",
  situating: "the context of the scene",
  culture_reference: "culture references",
  historical_reference: "historical references",
};

const PACE_PHRASES: Record<LearningTemperature, string> = {
  low: "only the clearest",
  medium: "the useful",
  high: "every justified",
};

/**
 * Depth is one dial, not a grid of checkboxes: each stop up the ramp adds the next lens and, past the
 * middle, lets prepared help surface more freely. Low is close reading (grammar); high is the full
 * cultural-historical context, generously. The armed lenses and pace stay the underlying levers, so
 * the wire contract is unchanged — the wheel just drives them together the way an effort control does.
 */
const LENS_RAMP: readonly LearningLensKind[] = [
  "grammar_salience",
  "word_order",
  "situating",
  "culture_reference",
  "historical_reference",
];

const DEPTH_STOPS: ReadonlyArray<{ label: string; temperature: LearningTemperature }> = [
  { label: "Light", temperature: "low" },
  { label: "Modest", temperature: "low" },
  { label: "Medium", temperature: "medium" },
  { label: "Deep", temperature: "medium" },
  { label: "Full", temperature: "high" },
];

const PREP_REASON_COPY: Record<string, string> = {
  production_prep_executor_unavailable: "No learning-prep executor is configured for this runtime host.",
  caption_authority_revoked: "Caption authority was revoked, so no new learning prep may be requested.",
  prep_interaction_unavailable: "Learning prep requires a connected local runtime host.",
  prep_request_failed: "The learning-prep request failed closed.",
  prep_retry_exhausted: "The fixed learning-prep retry ceiling is exhausted.",
  invalid_prep_binding: "The learning prep does not bind to this exact verified caption result.",
};

/** Depth 0..5 — how many lenses up the ramp are armed. */
function depthFromArmed(armed: readonly LearningLensKind[]): number {
  return Math.min(DEPTH_STOPS.length, armed.length);
}

/** Join lens phrases into a natural clause: "a", "a and b", "a, b, and c". */
function joinPhrases(kinds: readonly LearningLensKind[]): string {
  const phrases = kinds.map((kind) => LENS_PHRASES[kind]);
  if (phrases.length <= 1) return phrases[0] ?? "";
  if (phrases.length === 2) return `${phrases[0]} and ${phrases[1]}`;
  return `${phrases.slice(0, -1).join(", ")}, and ${phrases[phrases.length - 1]}`;
}

/**
 * The Notes face, spoken as prose in the same first-person voice as the result brief: one sentence
 * stating what will be prepared, one depth wheel that sets how far the notes go (from close grammar
 * reading to full cultural and historical context), and one Prepare action. The prepared notes then
 * appear as marks on their own transcript lines, so this face has a visible result, never a hidden
 * state. Arming and preparing stay explicit learner actions, and the armed pace only caps how much
 * prepared help may surface.
 */
export default function LearningFineTuneFace({ interaction }: { interaction: LearningPrepInteraction }) {
  const { draft, prep, availability } = interaction;
  const recorded = interaction.sourceAuthority === "recorded_fixture";
  const busy = prep.state === "loading";
  const controlsDisabled = availability.state === "unavailable" || busy;
  const prepared = prep.state === "ready";
  const armed = draft.armedLenses;
  const level = depthFromArmed(armed);
  const availableCount =
    prep.state === "ready" ? prep.moments.filter((moment) => moment.availability === "available").length : 0;

  // Set the wheel to a depth: reconcile the armed lenses to the ramp prefix and set the matching pace.
  const applyDepth = (target: number) => {
    const targetLenses = new Set(LENS_RAMP.slice(0, target));
    for (const lens of LEARNING_LENS_KINDS) {
      if (targetLenses.has(lens) !== armed.includes(lens)) interaction.onToggleLens(lens);
    }
    if (target > 0) {
      const temperature = DEPTH_STOPS[target - 1].temperature;
      if (draft.temperature !== temperature) interaction.onTemperature(temperature);
    }
  };

  const sentence = (() => {
    if (prep.state === "loading") {
      return `Preparing notes on ${armed.length > 0 ? joinPhrases(armed) : "this clip"} from its captions.`;
    }
    if (prep.state === "ready") {
      if (prep.resultState === "unavailable") {
        return `I looked for ${joinPhrases(armed)} in this clip and found nothing I could stand behind, so there are no notes. Nothing is guessed. Withheld and abstained help stays withheld.`;
      }
      return `I prepared ${availableCount} ${availableCount === 1 ? "note" : "notes"} on ${joinPhrases(armed)}. Each one is marked on its line in the transcript; tap a mark to read it. Withheld and abstained help stays withheld.`;
    }
    if (armed.length === 0) {
      return recorded
        ? "Right now this is just the video with its captions. Turn up the depth and I will prepare notes on the grammar, context, culture, and history behind what people say."
        : "Right now this is just the video with its captions. Turn up the depth and I will prepare notes on the grammar, context, culture, and history behind what people say, from this clip's verified captions.";
    }
    return recorded
      ? `Choose Prepare and I will write notes on ${joinPhrases(armed)}, keeping ${PACE_PHRASES[draft.temperature]} ones, from this demo's run-bound notes. They appear as marks on their transcript lines.`
      : `Choose Prepare and I will write notes on ${joinPhrases(armed)}, keeping ${PACE_PHRASES[draft.temperature]} ones, from this clip's verified captions. They appear as marks on their transcript lines.`;
  })();

  return (
    <section
      className="learning-tune-face"
      aria-label="Learning notes"
      data-learning-prep-authority={interaction.sourceAuthority}
      data-learning-prep-state={prep.state}
      data-learning-prep-result-state={prepared ? prep.resultState : undefined}
      data-armed-lenses={armed.join(",")}
      data-temperature={draft.temperature}
      data-fine-tune-depth={level}
    >
      <p className="learning-tune-sentence">{sentence}</p>

      {/* The depth wheel: one dial from close grammar reading to full cultural and historical
          context. Each stop up arms the next lens and lifts the pace; the sentence above always
          reflects it. */}
      <div className="learning-depth">
        <span className="learning-depth-lead">Depth</span>
        <div className="learning-depth-track" role="group" aria-label="Note depth">
          {DEPTH_STOPS.map((stop, index) => {
            const stopLevel = index + 1;
            return (
              <button
                key={stopLevel}
                type="button"
                className="learning-depth-stop"
                data-depth-level={stopLevel}
                data-active={stopLevel === level ? "true" : undefined}
                data-filled={stopLevel <= level ? "true" : undefined}
                aria-pressed={stopLevel === level}
                aria-label={`${stop.label} depth: notes on ${joinPhrases(LENS_RAMP.slice(0, stopLevel))}`}
                title={`${stop.label}: notes on ${joinPhrases(LENS_RAMP.slice(0, stopLevel))}`}
                disabled={controlsDisabled}
                onClick={() => applyDepth(stopLevel)}
              />
            );
          })}
        </div>
        <span className="learning-depth-label">{level === 0 ? "Off" : DEPTH_STOPS[level - 1].label}</span>
      </div>

      <div className="learning-tune-actions">
        <button
          type="button"
          className="learning-tune-prepare"
          data-fine-tune-action="prepare"
          disabled={controlsDisabled || armed.length === 0 || prepared}
          onClick={() => interaction.onPrepare()}
        >
          {busy ? "Preparing notes" : prepared ? "Notes prepared" : "Prepare notes for this clip"}
        </button>
        {prep.state === "failed" && prep.retry === "available" ? (
          <button
            type="button"
            className="learning-tune-retry"
            data-fine-tune-action="retry"
            onClick={() => interaction.onRetry()}
          >
            Try preparing again
          </button>
        ) : null}
      </div>

      <details className="learning-tune-about">
        <summary>About these notes</summary>
        <p role="note">
          {recorded
            ? "This recorded demo uses run-bound design-fixture notes. They were not generated from your media, are not production output, and are not semantically verified."
            : "Watching stays first. Preparing reads only this clip's verified captions; the notes are unreviewed caption-context inference, never verified culture or history, and lines without justified help stay silent."}
        </p>
      </details>

      {availability.state === "unavailable" ? (
        <p className="learning-tune-unavailable" role="status" data-reason-code={availability.reasonCode}>
          {PREP_REASON_COPY[availability.reasonCode]}
          <code>{availability.reasonCode}</code>
        </p>
      ) : null}
      {prep.state === "unavailable" || prep.state === "failed" ? (
        <p className="learning-tune-unavailable" role="status" data-reason-code={prep.reasonCode}>
          {PREP_REASON_COPY[prep.reasonCode] ?? prep.detail}
          <code>{prep.reasonCode}</code>
        </p>
      ) : null}

      {prepared ? (
        <div
          className="learning-tune-outcome"
          data-prep-artifact-id={prep.authority.artifactId ?? undefined}
          data-prep-fixture-id={prep.authority.fixtureId ?? undefined}
        >
          <ul className="learning-tune-lens-outcomes">
            {prep.lenses.map((lens) => (
              <li key={lens.lens} data-prep-lens={lens.lens} data-lens-state={lens.state}>
                <b>{LEARNING_LENS_LABELS[lens.lens]}</b>
                {lens.state === "surfaced" ? (
                  <span>{lens.candidateCount} {lens.candidateCount === 1 ? "note" : "notes"}</span>
                ) : (
                  <span>
                    abstained<code>{lens.reasonCode}</code>
                  </span>
                )}
              </li>
            ))}
          </ul>
          <p className="learning-tune-nonclaim">
            {recorded
              ? "Recorded design fixture, not runtime-generated and not reviewed. It demonstrates the shared result UI without claiming production authority."
              : "Host-receipted and not reviewed. External citations are empty; caption context is input, not culture or history authority. This prep is private and grants no export."}
          </p>
        </div>
      ) : null}
    </section>
  );
}
