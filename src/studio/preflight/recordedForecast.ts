import { FORECAST_SCHEMA, type ForecastArtifact } from "../runtime/production/forecast/model.ts";

/**
 * UI-side consumption of a recorded run's optional `studio.forecast.v1` artifact.
 *
 * The runtime lane owns emitting the artifact and validating its content hash; the
 * one thing this side must never do is fabricate a work plan. So this module only
 * structurally guards the deterministic workload floor it will display and fails
 * closed to the honest "unavailable" line whenever anything is missing or
 * off-contract. It deliberately does not import the planner's hash validator, which
 * pulls in `node:crypto` and would break the browser bundle.
 */

export type RecordedForecastView =
  | {
      kind: "floor";
      operationCount: number;
      requestedOperationMediaDurationMs: number;
      selectedMediaDurationMs: number;
    }
  | { kind: "unavailable" };

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCount(value: unknown, minimum: number): value is number {
  return Number.isSafeInteger(value) && (value as number) >= minimum;
}

/**
 * Fail-closed structural read of a fetched `forecast.json`. Returns the artifact only
 * when the baseline workload floor it renders is well-formed; otherwise null. It never
 * trusts an off-contract shape enough to display it.
 */
export function readForecastArtifact(value: unknown): ForecastArtifact | null {
  if (!isObject(value) || value.schema !== FORECAST_SCHEMA) return null;
  if (!isObject(value.scenarios)) return null;
  const baseline = value.scenarios.baseline;
  if (!isObject(baseline) || baseline.status !== "floor_only") return null;
  const workload = baseline.workload;
  if (!isObject(workload)) return null;
  if (!isCount(workload.operationCount, 1)) return null;
  if (!isCount(workload.requestedOperationMediaDurationMs, 0)) return null;
  if (!isCount(workload.selectedMediaDurationMs, 0)) return null;
  return value as unknown as ForecastArtifact;
}

/** Projects a validated (or absent) forecast into the read-only view the stage renders. */
export function projectRecordedForecast(
  forecast: ForecastArtifact | null | undefined,
): RecordedForecastView {
  if (!forecast) return { kind: "unavailable" };
  const floor = forecast.scenarios.baseline.workload;
  return {
    kind: "floor",
    operationCount: floor.operationCount,
    requestedOperationMediaDurationMs: floor.requestedOperationMediaDurationMs,
    selectedMediaDurationMs: floor.selectedMediaDurationMs,
  };
}
