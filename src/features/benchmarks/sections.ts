// Plain-English section copy for the Benchmarks page.
// Left rail mirrors the Method page: title + lede + one muted secondary line.
// House style: no em dashes.

import captureReceipt from "../../../bench/runs/run-007/capture.json";
import freezeReceipt from "../../../bench/packs/hard-ko-v1/freeze.json";
import labelsReceipt from "../../../bench/reviews/labels/run-007.json";
import scoreReceipt from "../../../bench/scores/run-007/score.json";
import { campaignFreeze, measuredPairs, requiredPairs } from "./campaign";

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
const reviewerCount = labelsReceipt.reviewers.length;

export const sectionCopy: Record<string, SectionCopy> = {
  overview: {
    id: "overview",
    title: "We test our own translations",
    lede: `We turn Korean video into English. To check that work we locked a set of clips, wrote the right answers down in advance, and had ${reviewerCount} reviewers grade the output without knowing which system produced it.`,
    secondary: `We publish the result even when it goes against us. On this clip our prepared build scored below a stripped-down version of itself, because it stayed silent on ${prepped.critical_outcomes.withheld} of ${prepped.critical_meaning.total} moments and silence counts as meaning lost.`,
  },
  evidence: {
    id: "evidence",
    title: "Coverage",
    lede: `The test set contains ${freezeReceipt.clips.length} clips. One has system outputs, human review, and scores.`,
    secondary: `The other ${controlCount} are held out, frozen and ready but never run, so they cannot flatter or hurt the result. They stay excluded until they complete every step.`,
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
  campaign: {
    id: "campaign",
    title: "We tried an idea and it failed",
    lede: `We had an idea for translating Korean family terms better. We wrote it down first so we could not move the goalposts, then ran ${campaignFreeze.clips.length} clips with it and without it. It lost every comparison we finished.`,
    secondary: `We also came up ${requiredPairs - measuredPairs} comparisons short of the ${requiredPairs} we promised ourselves, so the test never counted and the idea was never shipped. These clips were graded by us, not by the outside reviewers who graded the test above.`,
  },
  receipts: {
    id: "receipts",
    title: "Audit",
    lede: "The page checks itself every time it is built. Each line below is worked out from the saved evidence, not typed in by hand.",
    secondary: "If any one of them fails, the page does not build. That is why nothing here is outstanding. What we have not measured yet is on Coverage, not hidden in this list.",
  },
};
