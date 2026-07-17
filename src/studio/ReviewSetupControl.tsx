import { useBundle, useStudio } from "./store";

/** A sliders mark: the run's parameters, distinct from the layout mark opposite it. */
function ParametersGlyph() {
  return (
    <svg viewBox="0 0 20 20" width="17" height="17" aria-hidden="true">
      <path d="M3 6.5h11" />
      <circle cx="14" cy="6.5" r="2.2" />
      <path d="M3 13.5h4M9 13.5h8" />
      <circle cx="7" cy="13.5" r="2.2" />
    </svg>
  );
}

/**
 * The left counterpart to LayoutControl. Layout reshapes the canvas; this steps
 * back out of the run to the preparation steps. On the recorded demo the replay's
 * parameters are fixed, so it reviews the setup rather than promising a new run.
 */
export default function ReviewSetupControl() {
  const bundle = useBundle();
  const reset = useStudio((state) => state.reset);
  const openRecordedPreflight = useStudio((state) => state.openRecordedPreflight);

  if (!bundle) return null;

  function reviewSetup(): void {
    reset();
    openRecordedPreflight();
  }

  return (
    <div className="dock-parameters">
      <button
        type="button"
        className="dock-parameters-trigger"
        aria-label="Review setup — return to the preparation steps"
        title="Review setup"
        onClick={reviewSetup}
      >
        <ParametersGlyph />
      </button>
    </div>
  );
}
