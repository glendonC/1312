import type { RuntimeBudget } from "../model.ts";

/**
 * Shared allocation contract for the generalized owned-media root and its two
 * required initial coverage children. The root retains a full 180s post-child
 * closure window for disposition, authenticated reads, and synthesis.
 */
export const GENERALIZED_INITIAL_COVERAGE_BUDGET = Object.freeze({
  wallMs: 240_000,
  toolCalls: 2,
}) satisfies Readonly<RuntimeBudget>;

export const GENERALIZED_ROOT_BUDGET = Object.freeze({
  wallMs: 420_000,
  toolCalls: 20,
}) satisfies Readonly<RuntimeBudget>;

// Root + two required initial coverage children + the existing bounded optional
// 20s re-study and 60s research reservations. This is an allocation ceiling,
// not a claim that every path launches every reservation.
export const GENERALIZED_RUN_BUDGET = Object.freeze({
  wallMs: GENERALIZED_ROOT_BUDGET.wallMs + (2 * GENERALIZED_INITIAL_COVERAGE_BUDGET.wallMs) + 20_000 + 60_000,
  toolCalls: 32,
}) satisfies Readonly<RuntimeBudget>;

export const GENERALIZED_INITIAL_COVERAGE_BUDGET_JSON = JSON.stringify(
  GENERALIZED_INITIAL_COVERAGE_BUDGET,
);

export function isExactGeneralizedInitialCoverageBudget(budget: RuntimeBudget): boolean {
  return budget.wallMs === GENERALIZED_INITIAL_COVERAGE_BUDGET.wallMs &&
    budget.toolCalls === GENERALIZED_INITIAL_COVERAGE_BUDGET.toolCalls;
}
