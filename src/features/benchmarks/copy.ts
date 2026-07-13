import type { EvaluationMode, MetricPriority, SupportState } from "./types";

export const benchmarkCopy = {
  name: "Hard-KO Clip Pack v1",
  hypothesis:
    "On the same frozen Korean media, a prepared 1321 workflow should preserve more critical meaning than the same stack run cold and a dated YouTube auto-translation capture.",
  evidenceBoundary:
    "This page currently describes the protocol and data contract. It does not contain benchmark results.",
  demoBoundary:
    "The scored Studio replay is a synthetic, planted-error interface fixture. It is not a clip, run, or score in this pack.",
  publicationRule:
    "No ranks, deltas, or performance claims until real clips, frozen gold, raw system outputs, and reviewer labels exist.",
} as const;

export const supportLabels: Record<SupportState, string> = {
  missing: "Missing",
  planned: "Planned",
  "sample-only": "Sample shape",
  ready: "Ready",
};

export const evaluationLabels: Record<EvaluationMode, string> = {
  automated: "Automated",
  human: "Human",
  hybrid: "Hybrid",
};

export const priorityLabels: Record<MetricPriority, string> = {
  headline: "Headline",
  diagnostic: "Diagnostic",
  "research-only": "Research only",
  omit: "Omit",
};
