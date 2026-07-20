import {
  LEARNING_LENS_KINDS,
  LEARNING_TEMPERATURES,
  type LearningLensKind,
  type LearningPrepInteraction,
  type LearningTemperature,
} from "./presentation.ts";

export const LEARNING_LENS_LABELS: Record<LearningLensKind, string> = {
  word_order: "Word-order help",
  grammar_salience: "Grammar that stands out",
  situating: "Situating the scene",
  culture_reference: "Culture references",
  historical_reference: "Historical references",
};

const TEMPERATURE_LABELS: Record<LearningTemperature, string> = {
  low: "Low, at most one note per beat",
  medium: "Medium",
  high: "High",
};

const PREP_REASON_COPY: Record<string, string> = {
  production_prep_executor_unavailable: "No learning-prep executor is configured for this runtime host.",
  caption_authority_revoked: "Caption authority was revoked, so no new learning prep may be requested.",
  prep_interaction_unavailable: "Learning prep requires a connected local runtime host.",
  prep_request_failed: "The learning-prep request failed closed.",
  prep_retry_exhausted: "The fixed learning-prep retry ceiling is exhausted.",
  invalid_prep_binding: "The learning prep does not bind to this exact verified caption result.",
};

/**
 * The Customize learning face. Arming lenses and preparing are explicit learner actions; the armed
 * temperature only caps how much prepared help may surface and never invents availability.
 */
export default function LearningFineTuneFace({ interaction }: { interaction: LearningPrepInteraction }) {
  const { draft, prep, availability } = interaction;
  const recorded = interaction.sourceAuthority === "recorded_fixture";
  const busy = prep.state === "loading";
  const controlsDisabled = availability.state === "unavailable" || busy;
  const prepared = prep.state === "ready";
  const prepStateLabel = prep.state === "not_requested"
    ? "Not requested"
    : prep.state === "loading"
      ? "Preparing"
      : prep.state === "ready"
        ? prep.resultState === "unavailable" ? "Prepared, all help withheld" : "Prepared"
        : prep.state === "unavailable"
          ? "Unavailable"
          : "Failed closed";

  return (
    <section
      className="learning-fine-tune"
      aria-label="Customize learning"
      data-learning-prep-authority={interaction.sourceAuthority}
      data-learning-prep-state={prep.state}
      data-learning-prep-result-state={prepared ? prep.resultState : undefined}
      data-armed-lenses={draft.armedLenses.join(",")}
      data-temperature={draft.temperature}
    >
      <header className="learning-fine-tune-head">
        <div>
          <span>{recorded ? "Recorded learning overlay" : "Optional learning overlay"}</span>
          <h4>Customize learning</h4>
        </div>
        <b data-learning-prep-state-label="">{prepStateLabel}</b>
      </header>
      <details className="learning-fine-tune-about">
        <summary>About these notes</summary>
        <p className="learning-fine-tune-boundary" role="note">
          {recorded
            ? "This recorded demo uses run-bound design-fixture notes. They were not generated from your media, are not production output, and are not semantically verified."
            : "Watching stays first. Arming lenses prepares moments from this clip's verified captions; prepared notes are unreviewed caption-context inference, never verified culture or history, and moments without justified help stay silent."}
        </p>
      </details>

      <fieldset className="learning-fine-tune-lenses" disabled={controlsDisabled}>
        <legend>Armed lenses</legend>
        {LEARNING_LENS_KINDS.map((lens) => (
          <label key={lens} data-fine-tune-lens={lens}>
            <input
              type="checkbox"
              checked={draft.armedLenses.includes(lens)}
              onChange={() => interaction.onToggleLens(lens)}
            />
            <span>{LEARNING_LENS_LABELS[lens]}</span>
          </label>
        ))}
      </fieldset>
      <fieldset className="learning-fine-tune-temperature" disabled={controlsDisabled}>
        <legend>How often help may surface</legend>
        {LEARNING_TEMPERATURES.map((temperature) => (
          <label key={temperature} data-fine-tune-temperature={temperature}>
            <input
              type="radio"
              name="learning-fine-tune-temperature"
              checked={draft.temperature === temperature}
              onChange={() => interaction.onTemperature(temperature)}
            />
            <span>{TEMPERATURE_LABELS[temperature]}</span>
          </label>
        ))}
      </fieldset>

      <div className="learning-fine-tune-actions">
        <button
          type="button"
          data-fine-tune-action="prepare"
          disabled={controlsDisabled || draft.armedLenses.length === 0 || prepared}
          onClick={() => interaction.onPrepare()}
        >
          {busy ? "Preparing learning" : "Prepare learning for this clip"}
        </button>
        {prep.state === "failed" && prep.retry === "available" ? (
          <button type="button" data-fine-tune-action="retry" onClick={() => interaction.onRetry()}>
            Retry learning prep
          </button>
        ) : null}
      </div>

      {availability.state === "unavailable" ? (
        <p className="learning-fine-tune-unavailable" role="status" data-reason-code={availability.reasonCode}>
          {PREP_REASON_COPY[availability.reasonCode]}
          <code>{availability.reasonCode}</code>
        </p>
      ) : null}
      {prep.state === "unavailable" || prep.state === "failed" ? (
        <p className="learning-fine-tune-unavailable" role="status" data-reason-code={prep.reasonCode}>
          {PREP_REASON_COPY[prep.reasonCode] ?? prep.detail}
          <code>{prep.reasonCode}</code>
        </p>
      ) : null}

      {prepared ? (
        <div
          className="learning-fine-tune-summary"
          data-prep-artifact-id={prep.authority.artifactId ?? undefined}
          data-prep-fixture-id={prep.authority.fixtureId ?? undefined}
        >
          <p>
            {prep.resultState === "unavailable"
              ? "Every armed lens honestly abstained or withheld for this clip. Nothing will surface while watching."
              : `${prep.moments.filter((moment) => moment.availability === "available").length} prepared ${
                  prep.moments.filter((moment) => moment.availability === "available").length === 1 ? "moment" : "moments"
                } may surface while watching. Withheld and abstained help stays withheld.`}
            {" "}
            {prep.segmentation.mode === "beats"
              ? `${prep.segmentation.beats.length} ${prep.segmentation.beats.length === 1 ? "beat" : "beats"}.`
              : "No beats were warranted; the overlay follows each caption moment."}
          </p>
          <ul className="learning-fine-tune-lens-outcomes">
            {prep.lenses.map((lens) => (
              <li key={lens.lens} data-prep-lens={lens.lens} data-lens-state={lens.state}>
                <b>{LEARNING_LENS_LABELS[lens.lens]}</b>
                {lens.state === "surfaced"
                  ? <span>{lens.candidateCount} {lens.candidateCount === 1 ? "moment" : "moments"}</span>
                  : <span>abstained<code>{lens.reasonCode}</code></span>}
              </li>
            ))}
          </ul>
          <p className="learning-fine-tune-nonclaim">
            {recorded
              ? "Recorded design fixture, not runtime-generated and not reviewed. It demonstrates the shared result UI without claiming production authority."
              : "Host-receipted and not reviewed. External citations are empty; caption context is input, not culture or history authority. This prep is private and grants no export."}
          </p>
        </div>
      ) : null}
    </section>
  );
}
