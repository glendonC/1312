import { diagnosticMetrics } from "./diagnostic";
import { headlineMetrics } from "./headline";
import { omittedMetrics } from "./omitted";
import { researchMetrics } from "./research";

export const metricGroups = [
  {
    id: "headline",
    label: "Headline outcomes",
    note: "The handful of numbers that can decide a comparison, once the answer key is locked.",
    metrics: headlineMetrics,
  },
  {
    id: "diagnostic",
    label: "Diagnostic metrics",
    note: "Standard metrics that locate where it broke. They support the headline; they don’t replace it.",
    metrics: diagnosticMetrics,
  },
  {
    id: "research-only",
    label: "Research-only methods",
    note: "Real methods that need more data than Build Week can gather. Held back, not hidden.",
    metrics: researchMetrics,
  },
  {
    id: "omit",
    label: "Deliberately left out",
    note: "Tempting numbers we won’t show, because they’d mislead more than inform.",
    metrics: omittedMetrics,
  },
] as const;
