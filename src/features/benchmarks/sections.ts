// Plain-English section copy for the Benchmarks page.
// Left rail mirrors the Method page: title + lede + one muted secondary line.
// House style: no em dashes.

import captureReceipt from "../../../bench/runs/run-007/capture.json";
import freezeReceipt from "../../../bench/packs/hard-ko-v1/freeze.json";
import scoreReceipt from "../../../bench/scores/run-007/score.json";

export interface SectionCopy {
  id: string;
  title: string;
  /** plain-language lede under the title */
  lede: string;
  /** one short muted follow-on line */
  secondary: string;
}

const prepped = scoreReceipt.systems["1321-prepped"].headline;
const cold = scoreReceipt.systems["1321-cold"].headline;
const controlCount = freezeReceipt.clips.filter((clip) => clip.role === "control").length;

export const sectionCopy: Record<string, SectionCopy> = {
  overview: {
    id: "overview",
    title: "Benchmark",
    lede: "Prepared 1321 was compared with the same system without preparation on one Korean-to-English clip.",
    secondary: `Without preparation, the system preserved ${cold.critical_meaning.passes} of ${cold.critical_meaning.total} critical units; prepared 1321 preserved ${prepped.critical_meaning.passes}. Two control clips have not been scored.`,
  },
  evidence: {
    id: "evidence",
    title: "Coverage",
    lede: `The test set contains ${freezeReceipt.clips.length} clips. One has system outputs, human review, and scores.`,
    secondary: `The other ${controlCount} clips are excluded from results until they complete the same process.`,
  },
  pack: {
    id: "pack",
    title: "Test set",
    lede: `The test set contains ${freezeReceipt.clips.length} Korean clips: ${controlCount} controls and one ${captureReceipt.clip.duration_s}-second real-media clip.`,
    secondary: "Only the real-media clip has been scored. The controls do not contribute to the result yet.",
  },
  compare: {
    id: "compare",
    title: "Comparison",
    lede: "Prepared 1321 and the no-preparation baseline used the same source clip and the same 13 critical units.",
    secondary: "Control clips, the public baseline, and repeat runs are not included because they have not been scored.",
  },
  results: {
    id: "results",
    title: "Results",
    lede: `Without preparation, the system preserved ${cold.critical_meaning.passes} of ${cold.critical_meaning.total} critical units, versus ${prepped.critical_meaning.passes} of ${prepped.critical_meaning.total} for prepared 1321.`,
    secondary: `Prepared withheld ${prepped.critical_outcomes.withheld} units. Withheld units count as not preserved.`,
  },
  methods: {
    id: "methods",
    title: "Method",
    lede: `Two blinded reviewers judged ${prepped.critical_meaning.total} critical units defined before scoring.`,
    secondary: "Correct, wrong, withheld, and missing remain separate. No model graded the output.",
  },
  receipts: {
    id: "receipts",
    title: "Audit",
    lede: "Four required evidence checks are complete. Three comparison checks are still pending.",
    secondary: "Only verified score data is shown; pending comparisons are excluded.",
  },
};
