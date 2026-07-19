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
  // Allocation ceiling. The extra 240s preserves a sequential timeout/replacement window plus
  // the existing post-child closure window; it is not an elapsed-time or success forecast.
  wallMs: 660_000,
  toolCalls: 20,
}) satisfies Readonly<RuntimeBudget>;

// Root + two required initial coverage children + the existing optional 20s re-study and 60s
// research reservations. This baseline is an allocation ceiling, not a success or quality claim.
export const GENERALIZED_BASELINE_RUN_BUDGET = Object.freeze({
  wallMs: GENERALIZED_ROOT_BUDGET.wallMs + (2 * GENERALIZED_INITIAL_COVERAGE_BUDGET.wallMs) + 20_000 + 60_000,
  toolCalls: 32,
}) satisfies Readonly<RuntimeBudget>;

// Two independent one-replacement reservations. Ordinary spawn admission cannot consume this
// contingency, and each logical work identity still has a hard two-attempt ceiling.
export const GENERALIZED_RECOVERY_CONTINGENCY_BUDGET = Object.freeze({
  wallMs: 2 * GENERALIZED_INITIAL_COVERAGE_BUDGET.wallMs,
  toolCalls: 2 * GENERALIZED_INITIAL_COVERAGE_BUDGET.toolCalls,
}) satisfies Readonly<RuntimeBudget>;

export const GENERALIZED_RUN_BUDGET = Object.freeze({
  wallMs: GENERALIZED_BASELINE_RUN_BUDGET.wallMs + GENERALIZED_RECOVERY_CONTINGENCY_BUDGET.wallMs,
  toolCalls: GENERALIZED_BASELINE_RUN_BUDGET.toolCalls + GENERALIZED_RECOVERY_CONTINGENCY_BUDGET.toolCalls,
}) satisfies Readonly<RuntimeBudget>;

export const GENERALIZED_INITIAL_COVERAGE_BUDGET_JSON = JSON.stringify(
  GENERALIZED_INITIAL_COVERAGE_BUDGET,
);

export function isExactGeneralizedInitialCoverageBudget(budget: RuntimeBudget): boolean {
  return budget.wallMs === GENERALIZED_INITIAL_COVERAGE_BUDGET.wallMs &&
    budget.toolCalls === GENERALIZED_INITIAL_COVERAGE_BUDGET.toolCalls;
}
