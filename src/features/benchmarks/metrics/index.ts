import { diagnosticMetrics } from "./diagnostic";
import { headlineMetrics } from "./headline";
import { omittedMetrics } from "./omitted";
import { researchMetrics } from "./research";

export const metricGroups = [
  {
    id: "headline",
    label: "Headline outcomes",
    note: "The small set that can support product comparisons after gold freezes.",
    metrics: headlineMetrics,
  },
  {
    id: "diagnostic",
    label: "Diagnostic metrics",
    note: "Explain where the pipeline succeeds or fails; do not turn these into the marketing claim.",
    metrics: diagnosticMetrics,
  },
  {
    id: "research-only",
    label: "Research-only methods",
    note: "Valid methods whose annotation or product assumptions are outside the Build Week minimum.",
    metrics: researchMetrics,
  },
  {
    id: "omit",
    label: "Explicitly omitted",
    note: "Tempting numbers that would make the page less honest or less interpretable.",
    metrics: omittedMetrics,
  },
] as const;
