import type { EvaluationMode, MetricPriority, SupportState } from "./types";

export const benchmarkCopy = {
  name: "Hard-KO Clip Pack v1",
  hypothesis:
    "On the same frozen Korean media, a prepared 1321 workflow should preserve more critical meaning than the same stack run cold and a dated YouTube auto-translation capture.",
  evidenceBoundary:
    "This page reports one scored clip. It is not a complete test-set result.",
  demoBoundary:
    "The Studio demo is separate from this benchmark and does not contribute to these scores.",
  publicationRule:
    "Only verified source, review, and score data supports the numbers shown. Control clips, the public baseline, and repeat runs remain pending.",
} as const;

export const supportLabels: Record<SupportState, string> = {
  missing: "Missing",
  planned: "Planned",
  "sample-only": "Example only",
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
