import { canonicalSha256 } from "../artifactStore.ts";
import type {
  AgentRecoveryPolicyContract,
  ExecutorFailureCode,
  ExecutorFailureRetryability,
  RuntimeBudget,
} from "../model.ts";

export const RETRYABLE_INITIAL_COVERAGE_FAILURES = Object.freeze([
  "process_failed",
  "executor_timed_out",
  "required_tool_omitted",
  "invalid_structured_output",
  "provider_transport_failed",
] satisfies ExecutorFailureCode[]);

function policyId(body: Omit<AgentRecoveryPolicyContract, "schema" | "policyId">): string {
  return `agent-recovery-policy:${canonicalSha256(body)}`;
}

export function createAgentRecoveryPolicy(input: {
  baselineBudget: RuntimeBudget;
  recoveryContingency: RuntimeBudget;
  replacementBudget: RuntimeBudget;
  maxReplacementsPerRun?: 2;
}): AgentRecoveryPolicyContract {
  const body = {
    scope: "generalized_initial_coverage" as const,
    maxAttemptsPerWork: 2 as const,
    maxReplacementsPerRun: input.maxReplacementsPerRun ?? 2,
    baselineBudget: { ...input.baselineBudget },
    recoveryContingency: { ...input.recoveryContingency },
    replacementBudget: { ...input.replacementBudget },
    retryableFailureCodes: [...RETRYABLE_INITIAL_COVERAGE_FAILURES],
    nonClaims: {
      success: "not_predicted" as const,
      quality: "not_assessed" as const,
      cost: "allocation_ceiling_only" as const,
    },
  };
  return {
    schema: "studio.agent-recovery-policy.v1",
    policyId: policyId(body),
    ...body,
  };
}

export function failureRetryability(
  policy: AgentRecoveryPolicyContract,
  code: ExecutorFailureCode,
): ExecutorFailureRetryability {
  return policy.retryableFailureCodes.includes(code) ? "replaceable" : "terminal";
}

export function validateAgentRecoveryPolicyIdentity(policy: AgentRecoveryPolicyContract): boolean {
  const exactKeys = (value: unknown, keys: readonly string[]): boolean =>
    value !== null && typeof value === "object" && !Array.isArray(value) &&
    JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
  const budget = (value: unknown): value is RuntimeBudget => exactKeys(value, ["wallMs", "toolCalls"]) &&
    Number.isSafeInteger((value as RuntimeBudget).wallMs) && (value as RuntimeBudget).wallMs > 0 &&
    Number.isSafeInteger((value as RuntimeBudget).toolCalls) && (value as RuntimeBudget).toolCalls > 0;
  if (!exactKeys(policy, [
    "schema", "policyId", "scope", "maxAttemptsPerWork", "maxReplacementsPerRun",
    "baselineBudget", "recoveryContingency", "replacementBudget", "retryableFailureCodes", "nonClaims",
  ]) || !budget(policy.baselineBudget) || !budget(policy.recoveryContingency) || !budget(policy.replacementBudget) ||
    !exactKeys(policy.nonClaims, ["success", "quality", "cost"]) ||
    JSON.stringify(policy.retryableFailureCodes) !== JSON.stringify(RETRYABLE_INITIAL_COVERAGE_FAILURES)) return false;
  const { schema: _schema, policyId: _policyId, ...body } = policy;
  return policy.schema === "studio.agent-recovery-policy.v1" &&
    policy.policyId === policyId(body) &&
    policy.scope === "generalized_initial_coverage" &&
    policy.maxAttemptsPerWork === 2 &&
    policy.maxReplacementsPerRun === 2 &&
    policy.recoveryContingency.wallMs === policy.maxReplacementsPerRun * policy.replacementBudget.wallMs &&
    policy.recoveryContingency.toolCalls === policy.maxReplacementsPerRun * policy.replacementBudget.toolCalls &&
    policy.nonClaims.success === "not_predicted" && policy.nonClaims.quality === "not_assessed" &&
    policy.nonClaims.cost === "allocation_ceiling_only";
}
