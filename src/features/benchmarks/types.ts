/** Static copy and metric definitions for the public benchmark surface. */
export type MetricPriority = "headline" | "diagnostic" | "research-only" | "omit";
export type EvaluationMode = "automated" | "human" | "hybrid";
export type SupportState = "missing" | "planned" | "sample-only" | "ready";

export interface ReferenceLink {
  label: string;
  url: string;
}

export interface MetricDefinition {
  id: string;
  label: string;
  priority: MetricPriority;
  question: string;
  layer: string;
  evaluation: EvaluationMode;
  requiredData: string;
  support: SupportState;
  field: string;
  limitation: string;
  reference?: ReferenceLink;
}

export interface AnnotationRequirement {
  id: string;
  label: string;
  purpose: string;
  requiredFields: string;
  futurePath: string;
  status: "missing" | "partial-demo";
}
