import assert from "node:assert/strict";
import test from "node:test";

import {
  recordedResultView,
  resultNote,
  type RecordedResultSource,
} from "../src/studio/resultView.ts";
import type { PathScore } from "../src/studio/types.ts";

function pathScore(over: Partial<PathScore> = {}): PathScore {
  return {
    label: "path",
    points: null,
    hard_line: null,
    coverage: null,
    time_to_usable_s: null,
    withheld: null,
    hallucinated: null,
    ...over,
  };
}

function source(over: {
  runId?: string;
  status?: string;
  paths?: Record<string, Partial<PathScore>>;
  baselines?: boolean[];
} = {}): RecordedResultSource {
  const runId = over.runId ?? "run-006";
  const paths: Record<string, PathScore | undefined> = {};
  for (const [key, value] of Object.entries(over.paths ?? {})) paths[key] = pathScore(value);
  const cues = (over.baselines ?? []).map((hasBaseline) =>
    hasBaseline ? { baseline: { path: "cold" } } : {},
  );
  return { run: { id: runId }, captions: { cues }, score: { status: over.status ?? "scored", paths } };
}

test("evidence depth with cold + baseline + gold shows comparison, measured, all views", () => {
  const view = recordedResultView(
    source({
      status: "scored",
      paths: { "run-006": { hard_line: 0.8 }, cold: { hard_line: 0.5 } },
      baselines: [true, false],
    }),
    "evidence",
  );
  assert.equal(view.showEvidence, true);
  assert.equal(view.hasComparison, true);
  assert.equal(view.accuracyMeasured, true);
  assert.deepEqual([...view.availableViewIds], ["prepped", "baseline", "diff"]);
  assert.equal(view.prep?.hard_line, 0.8);
  assert.equal(view.cold?.hard_line, 0.5);
});

test("captions depth hides evidence and comparison even with cold + baseline present", () => {
  const view = recordedResultView(
    source({ paths: { "run-006": { hard_line: 0.8 }, cold: { hard_line: 0.5 } }, baselines: [true] }),
    "captions",
  );
  assert.equal(view.showEvidence, false);
  assert.equal(view.hasComparison, false);
  assert.deepEqual([...view.availableViewIds], ["prepped"]);
});

test("no cold path means no comparison", () => {
  const view = recordedResultView(
    source({ paths: { "run-006": { hard_line: 0.8 } }, baselines: [true] }),
    "evidence",
  );
  assert.equal(view.hasComparison, false);
  assert.equal(view.cold, undefined);
  assert.deepEqual([...view.availableViewIds], ["prepped"]);
});

test("cold path but no cue with a baseline means no comparison", () => {
  const view = recordedResultView(
    source({
      paths: { "run-006": { hard_line: 0.8 }, cold: { hard_line: 0.5 } },
      baselines: [false, false],
    }),
    "evidence",
  );
  assert.equal(view.hasComparison, false);
});

test("unscored status is not measured even with hard lines present", () => {
  const view = recordedResultView(
    source({
      status: "unscored",
      paths: { "run-006": { hard_line: 0.8 }, cold: { hard_line: 0.5 } },
      baselines: [true],
    }),
    "evidence",
  );
  assert.equal(view.accuracyMeasured, false);
});

test("null hard line is not a zero: absent gold is not measured", () => {
  const view = recordedResultView(
    source({
      status: "scored",
      paths: { "run-006": { hard_line: null }, cold: { hard_line: 0.5 } },
      baselines: [true],
    }),
    "evidence",
  );
  assert.equal(view.accuracyMeasured, false);
  // The score is absent, not zero — the view exposes the null, never a coerced 0.
  assert.equal(view.prep?.hard_line, null);
});

test("resultNote covers every branch verbatim", () => {
  assert.equal(
    resultNote("prepped", true, true),
    "What 1321 will stand behind. Lines it cannot are withheld, not guessed.",
  );
  assert.equal(
    resultNote("prepped", false, true),
    "Caption result only. Withheld lines remain visible because absence is part of the result.",
  );
  assert.equal(
    resultNote("baseline", true, true),
    "One-shot ASR into MT. No glossary and no gates. Accuracy is measured against this fixture's reference.",
  );
  assert.equal(
    resultNote("baseline", true, false),
    "Recorded comparison output. Accuracy is unscored because this clip has no reference.",
  );
  assert.equal(
    resultNote("diff", true, true),
    "Same audio and measured reference, with comparison differences marked.",
  );
  assert.equal(
    resultNote("diff", true, false),
    "Same audio and two recorded outputs. Differences are visible, but neither is marked right or wrong.",
  );
});
