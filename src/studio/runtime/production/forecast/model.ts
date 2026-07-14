export const FORECAST_SCHEMA = "studio.forecast.v1" as const;
export const FORECAST_ESTIMATOR = {
  id: "studio.forecast.deterministic-floor",
  version: "1",
} as const;

export type ForecastScenarioLabel = "baseline" | "expected" | "conservative";

export interface ForecastContentIdentity {
  algorithm: "sha256";
  digest: string;
  contentId: string;
  bytes: number;
}

export interface ForecastArtifactInput {
  artifactId: string;
  contentId: string;
  measuredDurationMs: number;
  durationMeasurement: {
    schema: "studio.media-probe.v1";
    producer: "scripts/probe-media.mjs";
    receiptContentId: string;
  };
}

export interface ForecastRangeInput {
  startMs: number;
  endMs: number;
}

export interface ForecastWorkPlanOperation {
  operationId: string;
  kind: string;
  range: ForecastRangeInput;
}

export interface ForecastWorkPlan {
  schema: "studio.forecast.work-plan.v1";
  planId: string;
  operations: ForecastWorkPlanOperation[];
}

export interface ForecastRequest {
  artifact: ForecastArtifactInput;
  range: ForecastRangeInput;
  workPlan: ForecastWorkPlan;
}

export interface ForecastWorkloadFloor {
  selectedMediaDurationMs: number;
  operationCount: number;
  requestedOperationMediaDurationMs: number;
  operations: Array<{
    operationId: string;
    kind: string;
    requestedMediaDurationMs: number;
  }>;
}

export interface ForecastCostUnavailable {
  amount: null;
  currency: null;
}

export interface ForecastBaselineScenario {
  label: "baseline";
  status: "floor_only";
  workload: ForecastWorkloadFloor;
  elapsedDurationMs: null;
  modelUsage: null;
  apiCost: ForecastCostUnavailable;
}

export interface ForecastUnavailableScenario {
  label: "expected" | "conservative";
  status: "unavailable";
  workload: null;
  elapsedDurationMs: null;
  modelUsage: null;
  apiCost: ForecastCostUnavailable;
}

export interface ForecastArtifact {
  schema: typeof FORECAST_SCHEMA;
  forecastId: string;
  content: ForecastContentIdentity;
  estimator: typeof FORECAST_ESTIMATOR;
  inputs: {
    artifact: ForecastArtifactInput;
    selectedRange: ForecastRangeInput & { durationMs: number };
    workPlan: ForecastWorkPlan;
  };
  scenarios: {
    baseline: ForecastBaselineScenario;
    expected: ForecastUnavailableScenario & { label: "expected" };
    conservative: ForecastUnavailableScenario & { label: "conservative" };
  };
  assumptions: Array<{
    code: string;
    statement: string;
  }>;
  uncertainty: Array<{
    code: string;
    affects: string[];
    statement: string;
  }>;
  calibration: {
    status: "unavailable";
    evidence: null;
    cohort: null;
  };
  pricing: {
    status: "unavailable";
    priceBookAdapter: null;
    priceBookSnapshot: null;
    currency: null;
  };
}

export interface ForecastFreezeRequest {
  runId: string;
  acceptedBy: string;
  runStartAt: string;
}

export interface FrozenForecastArtifact {
  schema: "studio.forecast-freeze.v1";
  freezeId: string;
  content: ForecastContentIdentity;
  producer: {
    id: "studio.forecast.freeze";
    version: "1";
  };
  forecast: {
    schema: typeof FORECAST_SCHEMA;
    forecastId: string;
    contentId: string;
  };
  acceptance: ForecastFreezeRequest;
  immutability: {
    forecast: "referenced_by_content_id";
    actuals: "not_embedded";
    evaluation: "separate_artifact";
  };
}
