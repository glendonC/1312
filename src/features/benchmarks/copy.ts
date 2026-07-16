import type { EvaluationMode, MetricPriority, SupportState } from "./types";

export const benchmarkCopy = {
  name: "Hard-KO Clip Pack v1",
  hypothesis:
    "On the same frozen Korean media, a prepared 1321 workflow should preserve more critical meaning than the same stack run cold and a dated YouTube auto-translation capture.",
  evidenceBoundary:
    "This page publishes one real scored hard clip from run-007. It is not a completed pack result.",
  demoBoundary:
    "The scored Studio replay is a synthetic, planted-error demo. It is not a clip, run, or score in this pack.",
  publicationRule:
    "Only the frozen clip, bound capture, blinded labels, and score receipt may support the numbers shown. Local controls, YouTube auto, and repeat runs remain missing.",
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
