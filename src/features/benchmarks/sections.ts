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
    title: "Benchmarks",
    lede: `The first hard-ko-v1 score is in. On ${scoreReceipt.run}'s one scored hard clip, cold preserved more critical meaning than prepared 1321.`,
    secondary: "This is a one-clip result, not a pack win. Correct, wrong, and withheld stay separate so caution cannot masquerade as quality.",
  },
  evidence: {
    id: "evidence",
    title: "Where the evidence stands",
    lede: `The pack is frozen. One hard clip has a bound capture, blinded human labels, and a score receipt; the ${controlCount} controls stop at frozen gold.`,
    secondary: "Every empty cell is a missing artifact, not work inferred from a neighboring receipt.",
  },
  pack: {
    id: "pack",
    title: "The clips we test on",
    lede: `hard-ko-v1 freezes ${freezeReceipt.clips.length} Korean clips: ${controlCount} local-eval controls and one ${captureReceipt.clip.duration_s}-second hard real-media clip.`,
    secondary: "Only the hard clip has been run and scored. Frozen gold for the controls is not evidence of system quality.",
  },
  compare: {
    id: "compare",
    title: "What we compare against",
    lede: "run-007 compares prepared 1321 with its cold internal control on the same hard clip and critical units.",
    secondary: "The local-eval controls and YouTube auto condition have no output or score receipt. They are not part of this result.",
  },
  results: {
    id: "results",
    title: "The first honest score",
    lede: `Cold leads critical meaning on ${scoreReceipt.run}: ${cold.critical_meaning.passes} of ${cold.critical_meaning.total} units preserved, versus ${prepped.critical_meaning.passes} of ${prepped.critical_meaning.total} for prepared 1321.`,
    secondary: `Prepared withheld ${prepped.critical_outcomes.withheld} units. Withholds avoid some guesses, but they receive no credit for preserving meaning.`,
  },
  methods: {
    id: "methods",
    title: "How we score it",
    lede: `Critical meaning is a human judgment over ${prepped.critical_meaning.total} pre-registered units. Mechanical routing keeps withheld and missing distinct from reviewed output.`,
    secondary: "No model graded this run. Diagnostics without receipts remain planned, not silently promoted into the score.",
  },
  receipts: {
    id: "receipts",
    title: "The audit trail",
    lede: "The score binds the frozen gold, exact capture bytes, and blinded label bytes used for run-007.",
    secondary: "The ledger also names what does not exist yet, so one valid receipt cannot imply a complete comparison series.",
  },
};
