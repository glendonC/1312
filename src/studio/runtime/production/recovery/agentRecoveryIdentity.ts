import { canonicalJsonContentId, canonicalSha256 } from "../canonicalIdentity.ts";
import type {
  AgentRecoveryAuthorizationReceipt,
  AgentRecoveryPolicyContract,
  AgentRecoveryTerminalReceipt,
  ExecutorFailureClassificationReceipt,
  RuntimeProjection,
  SpawnRequestInput,
  TaskRecord,
} from "../model.ts";

function receiptBody<T extends { schema: string; receiptId: string; contentId: string }>(
  value: T,
): Omit<T, "schema" | "receiptId" | "contentId"> {
  const body = structuredClone(value) as Record<string, unknown>;
  delete body.schema;
  delete body.receiptId;
  delete body.contentId;
  return body as Omit<T, "schema" | "receiptId" | "contentId">;
}

export function recoveryReceiptIdentity(prefix: string, body: unknown): {
  receiptId: string;
  contentId: string;
} {
  return {
    receiptId: `${prefix}:${canonicalSha256(body)}`,
    contentId: canonicalJsonContentId(body),
  };
}

export function validateFailureClassificationIdentity(
  receipt: ExecutorFailureClassificationReceipt,
): boolean {
  const identity = recoveryReceiptIdentity("executor-failure-classification", receiptBody(receipt));
  return receipt.schema === "studio.executor-failure-classification.receipt.v1" &&
    receipt.receiptId === identity.receiptId && receipt.contentId === identity.contentId;
}

export function validateRecoveryAuthorizationIdentity(
  receipt: AgentRecoveryAuthorizationReceipt,
): boolean {
  const identity = recoveryReceiptIdentity("agent-recovery-authorization", receiptBody(receipt));
  return receipt.schema === "studio.agent-recovery-authorization.receipt.v1" &&
    receipt.receiptId === identity.receiptId && receipt.contentId === identity.contentId;
}

export function validateRecoveryTerminalIdentity(receipt: AgentRecoveryTerminalReceipt): boolean {
  const identity = recoveryReceiptIdentity("agent-recovery-terminal", receiptBody(receipt));
  return receipt.schema === "studio.agent-recovery-terminal.receipt.v1" &&
    receipt.receiptId === identity.receiptId && receipt.contentId === identity.contentId;
}

export function recoveryAuthorityContract(
  task: TaskRecord,
  input: SpawnRequestInput,
): Record<string, unknown> {
  return {
    jobContext: {
      contextId: task.jobContext.contextId,
      source: task.jobContext.source,
      taskRange: task.jobContext.analysisRequest.taskRange,
      requestedSourceLanguagePolicy: task.jobContext.requestedSourceLanguagePolicy,
      targetLanguage: task.jobContext.targetLanguage,
      selectedLanguagePackId: task.jobContext.selectedLanguagePackId,
      outputDepth: task.jobContext.outputDepth,
      detectorEvidence: task.jobContext.detectorEvidence,
      reviewedMemory: task.jobContext.reviewedMemory,
    },
    objective: input.objective,
    workerKind: input.workerKind,
    workerLabel: input.workerLabel,
    mediaScope: input.mediaScope,
    inputArtifactIds: input.inputArtifactIds,
    requiredOutputs: input.requiredOutputs,
    requiredCapabilities: input.requiredCapabilities,
    dependencies: input.dependencies,
    budget: input.budget,
  };
}

export function recoveryContractFingerprint(task: TaskRecord, input: SpawnRequestInput): string {
  return `agent-work-contract:${canonicalSha256(recoveryAuthorityContract(task, input))}`;
}

/** Dedupe-only identity for equivalent ordinary spawn contracts; workload labels and set ordering grant no escape. */
export function recoveryEquivalentInputFingerprint(input: SpawnRequestInput): string {
  return `agent-recovery-equivalent-input:${canonicalSha256({
    objective: input.objective,
    workerKind: input.workerKind,
    workerLabel: input.workerLabel,
    mediaScope: [...input.mediaScope].sort((left, right) =>
      left.artifactId.localeCompare(right.artifactId) || left.trackId.localeCompare(right.trackId) ||
      left.startMs - right.startMs || left.endMs - right.endMs),
    inputArtifactIds: [...input.inputArtifactIds].sort(),
    requiredOutputs: [...input.requiredOutputs].sort((left, right) =>
      left.name.localeCompare(right.name) || left.artifactKind.localeCompare(right.artifactKind) ||
      Number(left.required) - Number(right.required)),
    requiredCapabilities: [...input.requiredCapabilities].sort(),
    dependencies: [...input.dependencies].sort(),
    budget: input.budget,
  })}`;
}

export function recoveryWorkId(input: {
  runId: string;
  parentTaskId: string;
  initialSpawnRequestId: string;
  contractFingerprint: string;
}): string {
  return `agent-work:${canonicalSha256(input)}`;
}

export function recoveryAttemptId(workId: string, ordinal: 0 | 1): string {
  return `agent-attempt:${canonicalSha256({ workId, ordinal })}`;
}

export function replacementWorkloadKey(workId: string): string {
  return `recovery:${workId}:attempt:1`;
}

export interface InitialCoverageRecoveryBasis {
  root: TaskRecord;
  rootExecution: RuntimeProjection["executions"][string];
  task: TaskRecord;
  request: RuntimeProjection["spawnRequests"][string];
  execution: RuntimeProjection["executions"][string];
  classification: ExecutorFailureClassificationReceipt;
  contractFingerprint: string;
  workId: string;
}

export function initialCoverageRecoveryBasis(
  state: RuntimeProjection,
  policy: AgentRecoveryPolicyContract,
  rootExecutionId: string,
  failedTaskId: string,
): InitialCoverageRecoveryBasis | null {
  const task = state.tasks[failedTaskId];
  const rootExecution = state.executions[rootExecutionId];
  const root = rootExecution ? state.tasks[rootExecution.taskId] : null;
  const request = Object.values(state.spawnRequests).find((entry) => entry.taskId === failedTaskId);
  const execution = Object.values(state.executions).find((entry) => entry.taskId === failedTaskId);
  const classification = execution
    ? Object.values(state.executorFailureClassifications).find((entry) => entry.executionId === execution.id)
    : null;
  const toolCall = request?.toolCallId ? state.orchestratorToolCalls[request.toolCallId] : null;
  const rootGeneralized = root?.requiredOutputs.some((output) =>
    output.required && (output.artifactKind === "studio.owned-media-study.v2" || output.artifactKind === "studio.owned-media-study.v3"));
  const exactOutput = task?.requiredOutputs.length === 1 &&
    task.requiredOutputs[0].required === true &&
    task.requiredOutputs[0].artifactKind === "studio.study-report.v2";
  const capabilities = new Set(request?.input.requiredCapabilities ?? []);
  const exactBudget = task?.budget.wallMs === policy.replacementBudget.wallMs &&
    task.budget.toolCalls === policy.replacementBudget.toolCalls;
  if (
    !task || !root || !request || !execution || !classification || !rootGeneralized ||
    root.parentTaskId !== null || rootExecution.status !== "active" ||
    task.parentTaskId !== root.id || task.parentAgentId !== root.ownerAgentId || task.status !== "failed" ||
    request.accepted !== true || request.authoredByExecutionId !== rootExecutionId ||
    toolCall?.tool !== "task_spawn_request" || toolCall.executionId !== rootExecutionId ||
    execution.receipt?.outcome === "completed" || execution.outputArtifactIds.length !== 0 ||
    classification.executorReceiptId !== execution.receipt?.receiptId ||
    classification.taskId !== task.id || classification.agentId !== task.assignedAgentId ||
    classification.retryability !== "replaceable" || !policy.retryableFailureCodes.includes(classification.code) ||
    !exactOutput || !exactBudget || !capabilities.has("speech.transcribe") || !capabilities.has("report.submit") ||
    Object.values(state.reports).some((report) => report.taskId === task.id) ||
    Object.values(state.generalizedParentArtifactAdmissions).some((admission) => admission.childTaskId === task.id) ||
    Object.values(state.rangePasses).some((pass) => pass.taskId === task.id)
  ) return null;
  const contractFingerprint = recoveryContractFingerprint(task, request.input);
  const workId = recoveryWorkId({
    runId: state.runId,
    parentTaskId: root.id,
    initialSpawnRequestId: request.id,
    contractFingerprint,
  });
  return { root, rootExecution, task, request, execution, classification, contractFingerprint, workId };
}

export function recoveryForTask(
  state: RuntimeProjection,
  taskId: string,
): { record: RuntimeProjection["agentRecoveries"][string]; ordinal: 0 | 1 } | null {
  for (const record of Object.values(state.agentRecoveries)) {
    if (record.authorization.failedAttempt.taskId === taskId) return { record, ordinal: 0 };
    if (record.authorization.replacement.taskId === taskId) return { record, ordinal: 1 };
  }
  return null;
}

export function assertRecoveryAdmissionAuthority(state: RuntimeProjection, taskId: string): string | null {
  const recovered = recoveryForTask(state, taskId);
  if (!recovered) return null;
  if (recovered.ordinal === 0) throw new Error("A superseded failed attempt cannot receive evidence authority");
  const terminal = recovered.record.terminal;
  if (!terminal || terminal.outcome !== "replacement_reported") {
    throw new Error("A replacement report requires a cold-valid reported recovery terminal receipt");
  }
  const report = Object.values(state.reports).find((entry) => entry.taskId === taskId);
  if (!report || terminal.replacementReportId !== report.id) {
    throw new Error("Recovery terminal authority changed its replacement report identity");
  }
  return recovered.record.workId;
}
