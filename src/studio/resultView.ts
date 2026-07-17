/**
 * Recorded Results view model (UI-only).
 *
 * The single, tested place that decides which supporting surfaces a recorded RunBundle Results
 * composition is entitled to show. It reads only fields that already exist on the bundle and the
 * confirmed request depth — it invents no producer fact, persists nothing, and never joins the
 * recorded contract to the owned-production contract.
 *
 * This is the first seam from docs/local/STUDIO_RESULTS_OPTIONS.md (accepted Phase 1). It lifts the
 * four predicates that used to live inline in Results.tsx so the branch logic is named and
 * unit-testable. The richer multi-authority `ResultModule[]` vocabulary and the owned-path selector
 * are deliberately deferred to the later shared-shell slice; nothing here is rendered as a module
 * list yet, so no speculative scaffolding is introduced.
 */

import type { OutputDepth } from "./preflight/model";
import type { PathScore, View } from "./types";

/**
 * The narrow slice of a recorded run this view model reads. `RunBundle` satisfies it structurally,
 * so callers pass the whole bundle; tests can build a minimal honest fixture without a full bundle.
 */
export interface RecordedResultSource {
  run: { id: string };
  captions: { cues: ReadonlyArray<{ baseline?: unknown }> };
  score: { status: string; paths: Record<string, PathScore | undefined> };
}

export interface RecordedResultView {
  /** This run's path score, or undefined when the run declared none. */
  prep: PathScore | undefined;
  /** The cold comparison path score, or undefined when no cold path was recorded. */
  cold: PathScore | undefined;
  /** Evidence depth was requested: scores, comparison, evidence index, and raw may show. */
  showEvidence: boolean;
  /** A Cold/Diff comparison is entitled to appear: evidence depth AND compatible evidence on both paths. */
  hasComparison: boolean;
  /** A real gold measurement exists on both paths: scores read as measured, not unscored. */
  accuracyMeasured: boolean;
  /** Which caption views the result bar may offer, in canonical order. */
  availableViewIds: readonly View[];
}

const COMPARISON_VIEW_IDS: readonly View[] = ["prepped", "baseline", "diff"];
const PREPPED_ONLY_VIEW_IDS: readonly View[] = ["prepped"];

/**
 * Project a recorded run + requested depth into the decisions the Results composition consumes.
 * Pure. `null`/absent stays `null`/absent — a missing score never becomes a zero or a shown module.
 */
export function recordedResultView(
  source: RecordedResultSource,
  outputDepth: OutputDepth,
): RecordedResultView {
  const prep = source.score.paths[source.run.id];
  const cold = source.score.paths["cold"];
  const showEvidence = outputDepth === "evidence";
  const hasComparison =
    showEvidence && Boolean(cold && source.captions.cues.some((cue) => cue.baseline));
  const accuracyMeasured = Boolean(
    source.score.status !== "unscored" && prep?.hard_line != null && cold?.hard_line != null,
  );
  return {
    prep,
    cold,
    showEvidence,
    hasComparison,
    accuracyMeasured,
    availableViewIds: hasComparison ? COMPARISON_VIEW_IDS : PREPPED_ONLY_VIEW_IDS,
  };
}

/**
 * The result-bar note for the active view. Pure function of the active view and the two evidence
 * predicates, so the withheld/unscored honesty copy is asserted once, not scattered in JSX.
 */
export function resultNote(
  activeView: View,
  showEvidence: boolean,
  accuracyMeasured: boolean,
): string {
  if (activeView === "prepped") {
    return showEvidence
      ? "What 1321 will stand behind. Lines it cannot are withheld, not guessed."
      : "Caption result only. Withheld lines remain visible because absence is part of the result.";
  }
  if (activeView === "baseline") {
    return accuracyMeasured
      ? "One-shot ASR into MT. No glossary and no gates. Accuracy is measured against this fixture's reference."
      : "Recorded comparison output. Accuracy is unscored because this clip has no reference.";
  }
  return accuracyMeasured
    ? "Same audio and measured reference, with comparison differences marked."
    : "Same audio and two recorded outputs. Differences are visible, but neither is marked right or wrong.";
}
