// Plain-English section copy for the Benchmarks page.
// Left rail mirrors the Method page: title + lede + one muted secondary line.
// House style: no em dashes.

import captureReceipt from "../../../bench/runs/run-007/capture.json";
import freezeReceipt from "../../../bench/packs/hard-ko-v1/freeze.json";
import labelsReceipt from "../../../bench/reviews/labels/run-007.json";
import scoreReceipt from "../../../bench/scores/run-007/score.json";

export interface SectionCopy {
  id: string;
  /** optional scope line above the title, so a first-time reader knows what is being measured */
  eyebrow?: string;
  title: string;
  /** plain-language lede under the title */
  lede: string;
  /** one short muted follow-on line */
  secondary: string;
}

const prepped = scoreReceipt.systems["1321-prepped"].headline;
const cold = scoreReceipt.systems["1321-cold"].headline;
const controlCount = freezeReceipt.clips.filter((clip) => clip.role === "control").length;
const reviewerCount = labelsReceipt.reviewers.length;

export const sectionCopy: Record<string, SectionCopy> = {
  overview: {
    id: "overview",
    eyebrow: `Korean to English, one frozen clip, ${prepped.critical_meaning.total} moments that had to survive translation`,
    title: "Does preparation help?",
    lede: `On this clip, no. We ran the same system twice on the same Korean audio, once with prepared context and once cold, then had ${reviewerCount} blinded reviewers judge every moment where the meaning had to carry.`,
    secondary: `Publishing a result that runs against our own system is the point of the benchmark. ${controlCount} of ${freezeReceipt.clips.length} clips remain unscored, so this is one measured point and not a full test-set result.`,
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
    lede: `Without preparation the system preserved ${cold.critical_meaning.passes} of ${cold.critical_meaning.total} moments, against ${prepped.critical_meaning.passes} for prepared. Prepared declined to answer ${prepped.critical_outcomes.withheld} times, which is more than the ${cold.critical_meaning.passes - prepped.critical_meaning.passes} moment gap between them.`,
    secondary: `Of the moments each system did answer, the cold run was wrong ${cold.critical_outcomes.wrong} times and the prepared run ${prepped.critical_outcomes.wrong}. Every decline counts as meaning not preserved.`,
  },
  methods: {
    id: "methods",
    title: "Method",
    lede: `Two blinded reviewers judged ${prepped.critical_meaning.total} moments that were chosen and frozen before any system ran.`,
    secondary: "Answering right, answering wrong, holding back, and missing a line stay separate outcomes. No model graded the output.",
  },
  receipts: {
    id: "receipts",
    title: "Audit",
    lede: "Four required evidence checks are complete. Three comparison checks are still pending.",
    secondary: "Only verified score data is shown; pending comparisons are excluded.",
  },
};
