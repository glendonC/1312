import { assertRuntimeEvent } from "./assertions.ts";
import type { CapabilityGrant, RuntimeProjection, TaskRecord, TaskStatus } from "./model.ts";
import type { RuntimeEvent } from "./protocol.ts";
import { countAssessmentTokens } from "./validation/assessment.ts";

function invariant(condition: unknown, event: RuntimeEvent, message: string): asserts condition {
  if (!condition) throw new Error(`Runtime event ${event.eventId}: ${message}`);
}

function sameGrants(left: CapabilityGrant[], right: CapabilityGrant[]): boolean {
  const canonical = (grants: CapabilityGrant[]) =>
    [...grants]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((grant) => ({
        ...grant,
        mediaScope: [...grant.mediaScope],
        evidenceScope: [...grant.evidenceScope],
      }));
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
}

const TRANSITIONS: Record<TaskStatus, readonly TaskStatus[]> = {
  scheduled: ["working", "failed", "withheld"],
  working: ["reported", "completed", "failed", "withheld"],
  reported: ["completed", "failed", "withheld"],
  completed: [],
  failed: [],
  withheld: [],
};

export function initialRuntimeProjection(runId: string): RuntimeProjection {
  if (!runId.trim()) throw new Error("Runtime projection requires a run id");
  return {
    runId,
    lastSeq: 0,
    tasks: {},
    agents: {},
    artifacts: {},
    spawnRequests: {},
    operations: {},
    evidenceReads: {},
    evidenceAssessments: {},
    evidenceDecisions: {},
    executions: {},
    modelUsage: {},
    reports: {},
  };
}

function validateTaskReferences(next: RuntimeProjection, event: RuntimeEvent, task: TaskRecord): void {
  invariant(task.runId === next.runId, event, `task ${task.id} belongs to another run`);
  invariant(!next.tasks[task.id], event, `task ${task.id} is duplicated`);
  invariant(!Object.values(next.tasks).some((candidate) => candidate.assignedAgentId === task.assignedAgentId), event, `agent ${task.assignedAgentId} is already assigned`);
  invariant(task.inputArtifactIds.every((id) => Boolean(next.artifacts[id])), event, `task ${task.id} references an unknown input artifact`);
  invariant(task.dependencies.every((id) => next.tasks[id]?.status === "completed"), event, `task ${task.id} has an incomplete dependency`);
  for (const scope of task.mediaScope) {
    const artifact = next.artifacts[scope.artifactId];
    invariant(artifact, event, `task ${task.id} scope references unknown artifact ${scope.artifactId}`);
    invariant(artifact.tracks.some((track) => track.id === scope.trackId), event, `task ${task.id} scope references unknown track ${scope.trackId}`);
    invariant(scope.endMs <= (artifact.durationMs ?? 0), event, `task ${task.id} scope exceeds artifact duration`);
  }
  if (task.parentTaskId === null) {
    invariant(task.parentAgentId === null && task.depth === 0, event, `root task ${task.id} has invalid parentage`);
  } else {
    const parent = next.tasks[task.parentTaskId];
    invariant(parent, event, `task ${task.id} references unknown parent ${task.parentTaskId}`);
    invariant(task.parentAgentId === parent.ownerAgentId, event, `task ${task.id} parent agent changed`);
    invariant(task.depth === parent.depth + 1, event, `task ${task.id} depth is not derived from its parent`);
  }
  invariant(task.grants.every((grant) => grant.taskId === task.id && grant.agentId === task.assignedAgentId), event, `task ${task.id} has grants for another owner`);
}

/** Fold one asserted, ordered production event into an immutable normalized projection. */
export function applyRuntimeEvent(state: RuntimeProjection, candidate: unknown): RuntimeProjection {
  assertRuntimeEvent(candidate);
  const event = candidate;
  invariant(event.runId === state.runId, event, `run ${event.runId} does not match ${state.runId}`);
  invariant(event.seq === state.lastSeq + 1, event, `sequence expected ${state.lastSeq + 1}, received ${event.seq}`);
  invariant(event.eventId === `event:${event.runId}:${event.seq}`, event, "event identity does not match run and sequence");

  const next = structuredClone(state);
  next.lastSeq = event.seq;

  if (event.type === "artifact.recorded") {
    const artifact = event.data.artifact;
    invariant(event.producer.kind === "artifact_store", event, "artifact evidence must come from the artifact store");
    invariant(artifact.runId === next.runId, event, `artifact ${artifact.id} belongs to another run`);
    invariant(!next.artifacts[artifact.id], event, `artifact ${artifact.id} is duplicated`);
    invariant(artifact.sourceArtifactIds.every((id) => Boolean(next.artifacts[id])), event, `artifact ${artifact.id} has missing lineage`);
    if (artifact.origin.kind === "media_operation" || artifact.origin.kind === "media_observation") {
      const operation = next.operations[artifact.origin.operationId];
      invariant(operation?.status === "started", event, `artifact ${artifact.id} has no active media operation`);
      invariant(operation.taskId === artifact.producerTaskId && operation.agentId === artifact.producerAgentId, event, `artifact ${artifact.id} changed its operation producer`);
      invariant(artifact.sourceArtifactIds.includes(operation.artifactId), event, `artifact ${artifact.id} omits its operation input`);
      invariant(
        (operation.capability === "media.extract" && artifact.origin.kind === "media_operation") ||
          (operation.capability === "media.seek" && artifact.origin.kind === "media_observation"),
        event,
        `artifact ${artifact.id} has the wrong origin for ${operation.capability}`,
      );
    } else if (artifact.origin.kind === "worker_output") {
      const execution = next.executions[artifact.origin.executionId];
      invariant(execution?.status === "active", event, `artifact ${artifact.id} has no active worker execution`);
      invariant(
        execution.taskId === artifact.producerTaskId && execution.agentId === artifact.producerAgentId,
        event,
        `artifact ${artifact.id} changed its worker execution producer`,
      );
    } else if (artifact.origin.kind === "evidence_assessment") {
      const assessment = next.evidenceAssessments[artifact.origin.operationId];
      invariant(assessment?.status === "started", event, `artifact ${artifact.id} has no active evidence assessment`);
      invariant(
        assessment.taskId === artifact.producerTaskId && assessment.agentId === artifact.producerAgentId,
        event,
        `artifact ${artifact.id} changed its assessment producer`,
      );
      invariant(
        JSON.stringify(artifact.origin.readReceiptIds) === JSON.stringify(assessment.readReceiptIds) &&
          JSON.stringify(artifact.origin.readReceiptContentIds) === JSON.stringify(assessment.readReceiptContentIds),
        event,
        `artifact ${artifact.id} changed its assessment receipt inputs`,
      );
    } else if (artifact.origin.kind === "evidence_decision") {
      const decision = next.evidenceDecisions[artifact.origin.operationId];
      invariant(decision?.status === "started", event, `artifact ${artifact.id} has no active evidence decision`);
      invariant(
        decision.taskId === artifact.producerTaskId && decision.agentId === artifact.producerAgentId,
        event,
        `artifact ${artifact.id} changed its decision producer`,
      );
      invariant(
        JSON.stringify(artifact.origin.assessmentOperationIds) === JSON.stringify(decision.assessmentOperationIds) &&
          JSON.stringify(artifact.origin.assessmentArtifactIds) === JSON.stringify(decision.assessmentArtifactIds) &&
          JSON.stringify(artifact.origin.assessmentReceiptIds) === JSON.stringify(decision.assessmentReceiptIds) &&
          JSON.stringify(artifact.origin.assessmentReceiptContentIds) === JSON.stringify(decision.assessmentReceiptContentIds),
        event,
        `artifact ${artifact.id} changed its audited assessment inputs`,
      );
    }
    next.artifacts[artifact.id] = artifact;
    return next;
  }

  if (event.type === "task.created") {
    invariant(event.producer.kind === "scheduler", event, "task creation must come from the scheduler");
    const task = event.data.task;
    validateTaskReferences(next, event, task);
    if (task.parentTaskId !== null) {
      const request = Object.values(next.spawnRequests).find((candidate) => candidate.taskId === task.id);
      invariant(request?.accepted === true && request.agentId === task.assignedAgentId, event, `task ${task.id} has no accepted spawn decision`);
    }
    next.tasks[task.id] = task;
    return next;
  }

  if (event.type === "spawn.requested") {
    invariant(event.producer.kind === "scheduler", event, "normalized spawn requests must come from the scheduler");
    invariant(!next.spawnRequests[event.data.requestId], event, `spawn request ${event.data.requestId} is duplicated`);
    next.spawnRequests[event.data.requestId] = {
      id: event.data.requestId,
      requestedByTaskId: event.data.requestedByTaskId,
      requestedByAgentId: event.data.requestedByAgentId,
      input: event.data.input,
      accepted: null,
      rejection: null,
      taskId: null,
      agentId: null,
    };
    return next;
  }

  if (event.type === "spawn.decided") {
    invariant(event.producer.kind === "scheduler", event, "spawn decisions must come from the scheduler");
    const request = next.spawnRequests[event.data.requestId];
    invariant(request, event, `spawn decision ${event.data.requestId} has no request`);
    invariant(request.accepted === null, event, `spawn request ${event.data.requestId} was decided twice`);
    request.accepted = event.data.accepted;
    request.rejection = event.data.rejection;
    request.taskId = event.data.taskId;
    request.agentId = event.data.agentId;
    return next;
  }

  if (event.type === "agent.registered") {
    invariant(event.producer.kind === "registry", event, "agent registration must come from the registry");
    const agent = event.data.agent;
    const task = next.tasks[agent.taskId];
    invariant(task, event, `agent ${agent.id} references unknown task ${agent.taskId}`);
    invariant(task.assignedAgentId === agent.id && task.ownerAgentId === null, event, `task ${task.id} cannot register agent ${agent.id}`);
    invariant(!next.agents[agent.id], event, `agent ${agent.id} is duplicated`);
    invariant(agent.parentTaskId === task.parentTaskId && agent.parentAgentId === task.parentAgentId, event, `agent ${agent.id} parentage changed`);
    invariant(agent.kind === task.workerKind && agent.label === task.workerLabel, event, `agent ${agent.id} presentation changed`);
    invariant(sameGrants(agent.grants, task.grants), event, `agent ${agent.id} grants differ from the scheduler decision`);
    task.ownerAgentId = agent.id;
    next.agents[agent.id] = agent;
    return next;
  }

  if (event.type === "task.transitioned") {
    invariant(event.producer.kind === "scheduler", event, "task transitions must come from the scheduler");
    const task = next.tasks[event.data.taskId];
    invariant(task?.ownerAgentId === event.data.agentId, event, `task ${event.data.taskId} transition has no owner`);
    invariant(TRANSITIONS[task.status].includes(event.data.status), event, `illegal task transition ${task.status} -> ${event.data.status}`);
    const activeOperation = Object.values(next.operations).some(
      (operation) => operation.taskId === task.id && operation.status === "started",
    );
    const activeEvidenceRead = Object.values(next.evidenceReads).some(
      (operation) => operation.taskId === task.id && operation.status === "started",
    );
    const activeEvidenceAssessment = Object.values(next.evidenceAssessments).some(
      (operation) => operation.taskId === task.id && operation.status === "started",
    );
    const activeEvidenceDecision = Object.values(next.evidenceDecisions).some(
      (operation) => operation.taskId === task.id && operation.status === "started",
    );
    invariant(
      (!activeOperation && !activeEvidenceRead && !activeEvidenceAssessment && !activeEvidenceDecision) || event.data.status === "working",
      event,
      `task ${task.id} has an active capability operation`,
    );
    const activeExecution = Object.values(next.executions).some(
      (execution) => execution.taskId === task.id && execution.status === "active",
    );
    invariant(!activeExecution || event.data.status === "working", event, `task ${task.id} has an active executor`);
    task.status = event.data.status;
    const agent = next.agents[event.data.agentId];
    if (event.data.status === "working") agent.status = "working";
    else if (event.data.status === "reported") agent.status = "reporting";
    else agent.status = "retired";
    return next;
  }

  if (event.type === "executor.started") {
    invariant(event.producer.kind === "launcher", event, "executor start evidence must come from the launcher");
    const task = next.tasks[event.data.taskId];
    invariant(
      task?.status === "working" && task.ownerAgentId === event.data.agentId,
      event,
      `execution ${event.data.executionId} has no working owner`,
    );
    invariant(!next.executions[event.data.executionId], event, `execution ${event.data.executionId} is duplicated`);
    invariant(
      !Object.values(next.executions).some(
        (execution) => execution.taskId === task.id && execution.status === "active",
      ),
      event,
      `task ${task.id} already has an active executor`,
    );
    next.executions[event.data.executionId] = {
      id: event.data.executionId,
      taskId: task.id,
      agentId: event.data.agentId,
      startedAt: event.data.startedAt,
      status: "active",
      receipt: null,
      outputArtifactIds: [],
      modelUsageReceiptId: null,
    };
    return next;
  }

  if (event.type === "model.usage_recorded") {
    invariant(event.producer.kind === "launcher", event, "model usage evidence must come from the launcher");
    const receipt = event.data.receipt;
    const execution = next.executions[receipt.executionId];
    invariant(execution?.status === "active", event, `usage ${receipt.receiptId} has no active executor`);
    invariant(
      execution.taskId === receipt.taskId && execution.agentId === receipt.agentId,
      event,
      `usage ${receipt.receiptId} changed its executor owner`,
    );
    invariant(!next.modelUsage[receipt.receiptId], event, `usage receipt ${receipt.receiptId} is duplicated`);
    invariant(execution.modelUsageReceiptId === null, event, `execution ${execution.id} recorded usage twice`);
    next.modelUsage[receipt.receiptId] = receipt;
    execution.modelUsageReceiptId = receipt.receiptId;
    return next;
  }

  if (event.type === "executor.finished") {
    invariant(event.producer.kind === "launcher", event, "executor finish evidence must come from the launcher");
    const receipt = event.data.receipt;
    const execution = next.executions[receipt.executionId];
    invariant(execution?.status === "active", event, `execution ${receipt.executionId} is not active`);
    invariant(
      execution.taskId === receipt.taskId && execution.agentId === receipt.agentId,
      event,
      `execution ${receipt.executionId} changed owner`,
    );
    invariant(execution.startedAt === receipt.startedAt, event, `execution ${receipt.executionId} changed start time`);
    invariant(
      execution.modelUsageReceiptId === receipt.modelUsageReceiptId,
      event,
      `execution ${receipt.executionId} usage receipt changed`,
    );
    invariant(
      receipt.outputArtifactIds.every((id) => {
        const artifact = next.artifacts[id];
        return (
          artifact?.origin.kind === "worker_output" &&
          artifact.origin.executionId === execution.id &&
          artifact.origin.receiptId === receipt.receiptId
        );
      }),
      event,
      `execution ${receipt.executionId} contains an unreceipted output`,
    );
    execution.status = receipt.outcome;
    execution.receipt = receipt;
    execution.outputArtifactIds = [...receipt.outputArtifactIds];
    return next;
  }

  if (event.type === "media.operation_started") {
    invariant(event.producer.kind === "media_host", event, "media operation evidence must come from the media host");
    const request = event.data.request;
    const task = next.tasks[request.taskId];
    invariant(task?.status === "working" && task.ownerAgentId === request.agentId, event, `operation ${request.operationId} has no working owner`);
    invariant(
      !next.operations[request.operationId] &&
        !next.evidenceReads[request.operationId] &&
        !next.evidenceAssessments[request.operationId] &&
        !next.evidenceDecisions[request.operationId],
      event,
      `operation ${request.operationId} is duplicated`,
    );
    const grant = task.grants.find((candidate) => candidate.id === event.data.grantId);
    invariant(
      grant?.capability === event.data.capability,
      event,
      `operation ${request.operationId} lacks its ${event.data.capability} grant`,
    );
    const artifact = next.artifacts[request.artifactId];
    invariant(artifact, event, `operation ${request.operationId} input artifact is unavailable`);
    invariant(
      artifact.tracks.some((track) => track.id === request.trackId && track.kind === "audio"),
      event,
      `operation ${request.operationId} has no registered audio track`,
    );
    invariant(
      request.endMs <= (artifact.durationMs ?? 0),
      event,
      `operation ${request.operationId} exceeds artifact duration`,
    );
    invariant(
      grant.mediaScope.some(
        (scope) =>
          scope.artifactId === request.artifactId &&
          scope.trackId === request.trackId &&
          request.startMs >= scope.startMs &&
          request.endMs <= scope.endMs,
      ),
      event,
      `operation ${request.operationId} exceeds its grant scope`,
    );
    const calls = [
      ...Object.values(next.operations),
      ...Object.values(next.evidenceReads),
      ...Object.values(next.evidenceAssessments),
      ...Object.values(next.evidenceDecisions),
    ].filter((operation) => operation.taskId === task.id).length;
    invariant(calls < task.budget.toolCalls, event, `task ${task.id} exhausted its tool-call budget`);
    next.operations[request.operationId] = {
      id: request.operationId,
      capability: event.data.capability,
      taskId: request.taskId,
      agentId: request.agentId,
      grantId: event.data.grantId,
      artifactId: request.artifactId,
      trackId: request.trackId,
      startMs: request.startMs,
      endMs: request.endMs,
      status: "started",
      outputArtifactId: null,
      receiptId: null,
      failure: null,
    };
    return next;
  }

  if (event.type === "media.operation_completed") {
    invariant(event.producer.kind === "media_host", event, "media completion evidence must come from the media host");
    const operation = next.operations[event.data.operationId];
    const artifact = next.artifacts[event.data.outputArtifactId];
    invariant(operation?.status === "started", event, `operation ${event.data.operationId} is not active`);
    invariant(artifact, event, `operation ${event.data.operationId} output was not recorded`);
    const receipt = event.data.receipt;
    const source = next.artifacts[operation.artifactId];
    invariant(receipt.operationId === operation.id, event, `operation ${operation.id} receipt changed identity`);
    invariant(receipt.capability === operation.capability, event, `operation ${operation.id} receipt changed capability`);
    invariant(
      receipt.authorization.grantId === operation.grantId &&
        receipt.authorization.taskId === operation.taskId &&
        receipt.authorization.agentId === operation.agentId,
      event,
      `operation ${operation.id} receipt changed authorization`,
    );
    invariant(
      receipt.request.artifactId === operation.artifactId &&
        receipt.request.trackId === operation.trackId &&
        receipt.request.startMs === operation.startMs &&
        receipt.request.endMs === operation.endMs,
      event,
      `operation ${operation.id} receipt changed its authorized request`,
    );
    invariant(
      source &&
        receipt.input.artifactId === source.id &&
        receipt.input.contentId === source.content.contentId &&
        receipt.sourceArtifactIds.length === 1 &&
        receipt.sourceArtifactIds[0] === source.id,
      event,
      `operation ${operation.id} receipt changed its input lineage`,
    );
    if (receipt.capability === "media.extract") {
      invariant(receipt.output.artifactId === artifact.id, event, `operation ${operation.id} receipt names another artifact`);
      invariant(
        receipt.output.contentId === artifact.content.contentId && receipt.output.bytes === artifact.content.bytes,
        event,
        `operation ${operation.id} receipt changed its output content`,
      );
      invariant(
        artifact.origin.kind === "media_operation" && artifact.origin.receiptId === receipt.receiptId,
        event,
        `operation ${operation.id} artifact is not bound to its receipt`,
      );
    } else {
      invariant(
        artifact.kind === "media-seek-observation" &&
          artifact.origin.kind === "media_observation" &&
          artifact.origin.receiptId === receipt.receiptId &&
          artifact.origin.receiptContentId === artifact.content.contentId,
        event,
        `operation ${operation.id} observation artifact is not bound to its content-addressed receipt`,
      );
    }
    operation.status = "completed";
    operation.outputArtifactId = artifact.id;
    operation.receiptId = event.data.receipt.receiptId;
    return next;
  }

  if (event.type === "evidence.read_started") {
    invariant(event.producer.kind === "evidence_host", event, "evidence read must come from the evidence host");
    const request = event.data.request;
    const task = next.tasks[request.taskId];
    invariant(
      task?.status === "working" && task.ownerAgentId === request.agentId,
      event,
      `evidence read ${request.operationId} has no working owner`,
    );
    invariant(
      !next.evidenceReads[request.operationId] &&
        !next.evidenceAssessments[request.operationId] &&
        !next.evidenceDecisions[request.operationId] &&
        !next.operations[request.operationId],
      event,
      `operation ${request.operationId} is duplicated`,
    );
    const grant = task.grants.find((candidate) => candidate.id === event.data.grantId);
    const scope = grant?.evidenceScope.find((candidate) =>
      candidate.artifactId === request.artifactId && candidate.evidenceKind === event.data.evidenceKind);
    invariant(grant?.capability === "evidence.read" && scope, event, `evidence read ${request.operationId} lacks its grant`);
    const artifact = next.artifacts[request.artifactId];
    invariant(
      artifact?.origin.kind === "preflight_evidence" && artifact.origin.evidenceKind === event.data.evidenceKind,
      event,
      `evidence read ${request.operationId} input is unavailable`,
    );
    invariant(
      event.data.maxBytes > 0 && event.data.maxBytes <= scope.maxBytes &&
        event.data.maxItems > 0 && event.data.maxItems <= scope.maxItems,
      event,
      `evidence read ${request.operationId} exceeds its grant budget`,
    );
    const calls = [
      ...Object.values(next.operations),
      ...Object.values(next.evidenceReads),
      ...Object.values(next.evidenceAssessments),
      ...Object.values(next.evidenceDecisions),
    ].filter((operation) => operation.taskId === task.id).length;
    invariant(calls < task.budget.toolCalls, event, `task ${task.id} exhausted its tool-call budget`);
    next.evidenceReads[request.operationId] = {
      id: request.operationId,
      taskId: request.taskId,
      agentId: request.agentId,
      grantId: event.data.grantId,
      artifactId: request.artifactId,
      evidenceKind: event.data.evidenceKind,
      maxBytes: event.data.maxBytes,
      maxItems: event.data.maxItems,
      status: "started",
      receiptId: null,
      receiptContentId: null,
      returnedItems: null,
      returnedFactBytes: null,
      truncated: null,
      failure: null,
    };
    return next;
  }

  if (event.type === "evidence.read_completed") {
    invariant(event.producer.kind === "evidence_host", event, "evidence completion must come from the evidence host");
    const operation = next.evidenceReads[event.data.operationId];
    invariant(operation?.status === "started", event, `evidence read ${event.data.operationId} is not active`);
    const receipt = event.data.receipt;
    const artifact = next.artifacts[operation.artifactId];
    invariant(
      artifact?.origin.kind === "preflight_evidence",
      event,
      `evidence read ${operation.id} input artifact is unavailable`,
    );
    invariant(
      receipt.operationId === operation.id &&
        receipt.authorization.grantId === operation.grantId &&
        receipt.authorization.taskId === operation.taskId &&
        receipt.authorization.agentId === operation.agentId &&
        receipt.authorization.maxBytes === operation.maxBytes &&
        receipt.authorization.maxItems === operation.maxItems,
      event,
      `evidence read ${operation.id} receipt changed authorization`,
    );
    invariant(
      receipt.input.artifactId === artifact.id &&
        receipt.input.contentId === artifact.content.contentId &&
        receipt.input.bytes === artifact.content.bytes &&
        receipt.input.evidenceKind === artifact.origin.evidenceKind &&
        receipt.input.receiptSchema === artifact.origin.receiptSchema,
      event,
      `evidence read ${operation.id} receipt changed input identity`,
    );
    invariant(
      receipt.lineage.preflightId === artifact.origin.preflightId &&
        receipt.lineage.preflightContentId === artifact.origin.preflightContentId &&
        JSON.stringify(receipt.lineage.sourceArtifactIds) === JSON.stringify(artifact.sourceArtifactIds),
      event,
      `evidence read ${operation.id} receipt changed lineage`,
    );
    operation.status = "completed";
    operation.receiptId = receipt.receiptId;
    operation.receiptContentId = event.data.receiptContentId;
    operation.returnedItems = receipt.result.returnedItems;
    operation.returnedFactBytes = receipt.result.returnedFactBytes;
    operation.truncated = receipt.result.truncated;
    return next;
  }

  if (event.type === "evidence.read_failed") {
    invariant(event.producer.kind === "evidence_host", event, "evidence failure must come from the evidence host");
    const operation = next.evidenceReads[event.data.operationId];
    invariant(operation?.status === "started", event, `evidence read ${event.data.operationId} is not active`);
    operation.status = "failed";
    operation.failure = event.data.reason;
    return next;
  }

  if (event.type === "analysis.evidence.assessment_started") {
    invariant(event.producer.kind === "assessment_host", event, "evidence assessment must come from the assessment host");
    const request = event.data.request;
    const task = next.tasks[request.taskId];
    invariant(
      task?.status === "working" && task.ownerAgentId === request.agentId,
      event,
      `evidence assessment ${request.operationId} has no working owner`,
    );
    invariant(
      !next.evidenceAssessments[request.operationId] &&
        !next.evidenceDecisions[request.operationId] &&
        !next.evidenceReads[request.operationId] &&
        !next.operations[request.operationId],
      event,
      `operation ${request.operationId} is duplicated`,
    );
    const grant = task.grants.find((candidate) => candidate.id === event.data.grantId);
    const scope = grant?.assessmentScope;
    invariant(
      grant?.capability === "analysis.evidence.assess" && scope,
      event,
      `evidence assessment ${request.operationId} lacks its grant`,
    );
    invariant(
      event.data.maxReadReceipts === scope.maxReadReceipts &&
        event.data.maxClaims === scope.maxClaims &&
        event.data.maxCitations === scope.maxCitations &&
        event.data.maxTokens === scope.maxTokens,
      event,
      `evidence assessment ${request.operationId} changed its grant budgets`,
    );
    const priorAssessments = Object.values(next.evidenceAssessments).filter((operation) =>
      operation.taskId === task.id && operation.grantId === grant.id);
    invariant(
      priorAssessments.length < scope.maxAssessments,
      event,
      `evidence assessment ${request.operationId} exceeds its assessment-count budget`,
    );
    const citationCount = request.claims.reduce(
      (total, claim) => total + claim.citations.reduce(
        (subtotal, citation) => subtotal + citation.factIndexes.length,
        0,
      ),
      0,
    );
    invariant(
      request.readReceipts.length <= scope.maxReadReceipts &&
        request.claims.length <= scope.maxClaims &&
        citationCount <= scope.maxCitations &&
        countAssessmentTokens(request.claims) <= scope.maxTokens,
      event,
      `evidence assessment ${request.operationId} exceeds its content budgets`,
    );
    const reads = request.readReceipts.map((identity) => Object.values(next.evidenceReads).find((candidate) =>
      candidate.status === "completed" &&
      candidate.taskId === task.id &&
      candidate.agentId === request.agentId &&
      candidate.receiptId === identity.receiptId &&
      candidate.receiptContentId === identity.receiptContentId));
    invariant(
      reads.every((read) => read && scope.evidenceArtifactIds.includes(read.artifactId)),
      event,
      `evidence assessment ${request.operationId} references an unread or ungranted receipt`,
    );
    const calls = [
      ...Object.values(next.operations),
      ...Object.values(next.evidenceReads),
      ...Object.values(next.evidenceAssessments),
      ...Object.values(next.evidenceDecisions),
    ].filter((operation) => operation.taskId === task.id).length;
    invariant(calls < task.budget.toolCalls, event, `task ${task.id} exhausted its tool-call budget`);
    next.evidenceAssessments[request.operationId] = {
      id: request.operationId,
      taskId: request.taskId,
      agentId: request.agentId,
      grantId: event.data.grantId,
      readReceiptIds: request.readReceipts.map((receipt) => receipt.receiptId),
      readReceiptContentIds: request.readReceipts.map((receipt) => receipt.receiptContentId),
      maxReadReceipts: event.data.maxReadReceipts,
      maxClaims: event.data.maxClaims,
      maxCitations: event.data.maxCitations,
      maxTokens: event.data.maxTokens,
      status: "started",
      artifactId: null,
      receiptId: null,
      receiptContentId: null,
      claimCount: null,
      citationCount: null,
      tokenCount: null,
      failure: null,
    };
    return next;
  }

  if (event.type === "analysis.evidence.assessment_completed") {
    invariant(event.producer.kind === "assessment_host", event, "evidence assessment completion must come from the assessment host");
    const operation = next.evidenceAssessments[event.data.operationId];
    invariant(operation?.status === "started", event, `evidence assessment ${event.data.operationId} is not active`);
    const artifact = next.artifacts[event.data.outputArtifactId];
    const receipt = event.data.receipt;
    const scope = next.tasks[operation.taskId]?.grants.find((grant) =>
      grant.id === operation.grantId && grant.capability === "analysis.evidence.assess")?.assessmentScope;
    invariant(
      artifact?.origin.kind === "evidence_assessment" &&
        artifact.origin.operationId === operation.id &&
        artifact.origin.receiptId === receipt.receiptId &&
        artifact.origin.receiptContentId === event.data.receiptContentId &&
        artifact.content.contentId === event.data.receiptContentId,
      event,
      `evidence assessment ${operation.id} has no content-addressed receipt artifact`,
    );
    invariant(
      receipt.operationId === operation.id &&
        receipt.authorization.grantId === operation.grantId &&
        receipt.authorization.taskId === operation.taskId &&
        receipt.authorization.agentId === operation.agentId &&
        receipt.authorization.maxAssessments === scope?.maxAssessments &&
        receipt.authorization.maxReadReceipts === operation.maxReadReceipts &&
        receipt.authorization.maxClaims === operation.maxClaims &&
        receipt.authorization.maxCitations === operation.maxCitations &&
        receipt.authorization.maxTokens === operation.maxTokens,
      event,
      `evidence assessment ${operation.id} receipt changed authorization`,
    );
    invariant(
      JSON.stringify(receipt.inputs.map((input) => input.receiptId)) === JSON.stringify(operation.readReceiptIds) &&
        JSON.stringify(receipt.inputs.map((input) => input.receiptContentId)) === JSON.stringify(operation.readReceiptContentIds),
      event,
      `evidence assessment ${operation.id} receipt changed completed-read inputs`,
    );
    operation.status = "completed";
    operation.artifactId = artifact.id;
    operation.receiptId = receipt.receiptId;
    operation.receiptContentId = event.data.receiptContentId;
    operation.claimCount = receipt.result.claimCount;
    operation.citationCount = receipt.result.citationCount;
    operation.tokenCount = receipt.result.tokenCount;
    return next;
  }

  if (event.type === "analysis.evidence.assessment_failed") {
    invariant(event.producer.kind === "assessment_host", event, "evidence assessment failure must come from the assessment host");
    const operation = next.evidenceAssessments[event.data.operationId];
    invariant(operation?.status === "started", event, `evidence assessment ${event.data.operationId} is not active`);
    operation.status = "failed";
    operation.failure = event.data.reason;
    return next;
  }

  if (event.type === "analysis.evidence.decision_started") {
    invariant(event.producer.kind === "decision_host", event, "evidence decision must come from the decision host");
    const request = event.data.request;
    const task = next.tasks[request.taskId];
    invariant(
      task?.status === "working" && task.ownerAgentId === request.agentId,
      event,
      `evidence decision ${request.operationId} has no working owner`,
    );
    invariant(
      !next.evidenceDecisions[request.operationId] &&
        !next.evidenceAssessments[request.operationId] &&
        !next.evidenceReads[request.operationId] &&
        !next.operations[request.operationId],
      event,
      `operation ${request.operationId} is duplicated`,
    );
    const grant = task.grants.find((candidate) => candidate.id === event.data.grantId);
    const scope = grant?.decisionScope;
    invariant(
      grant?.capability === "analysis.evidence.decide" && scope,
      event,
      `evidence decision ${request.operationId} lacks its grant`,
    );
    invariant(
      event.data.maxAuditedAssessments === scope.maxAuditedAssessments &&
        request.auditedAssessments.length <= scope.maxAuditedAssessments,
      event,
      `evidence decision ${request.operationId} changed its grant budget`,
    );
    const prior = Object.values(next.evidenceDecisions).filter((operation) =>
      operation.taskId === task.id && operation.grantId === grant.id);
    invariant(
      prior.length < scope.maxDecisions,
      event,
      `evidence decision ${request.operationId} exceeds its decision-count budget`,
    );
    invariant(
      request.auditedAssessments.every((identity) => {
        const assessment = next.evidenceAssessments[identity.operationId];
        return assessment?.status === "completed" &&
          assessment.taskId === task.id &&
          assessment.agentId === request.agentId &&
          assessment.artifactId === identity.artifactId &&
          assessment.receiptId === identity.receiptId &&
          assessment.receiptContentId === identity.receiptContentId;
      }),
      event,
      `evidence decision ${request.operationId} references a non-completed assessment identity`,
    );
    const calls = [
      ...Object.values(next.operations),
      ...Object.values(next.evidenceReads),
      ...Object.values(next.evidenceAssessments),
      ...Object.values(next.evidenceDecisions),
    ].filter((operation) => operation.taskId === task.id).length;
    invariant(calls < task.budget.toolCalls, event, `task ${task.id} exhausted its tool-call budget`);
    next.evidenceDecisions[request.operationId] = {
      id: request.operationId,
      taskId: request.taskId,
      agentId: request.agentId,
      grantId: event.data.grantId,
      assessmentOperationIds: request.auditedAssessments.map((identity) => identity.operationId),
      assessmentArtifactIds: request.auditedAssessments.map((identity) => identity.artifactId),
      assessmentReceiptIds: request.auditedAssessments.map((identity) => identity.receiptId),
      assessmentReceiptContentIds: request.auditedAssessments.map((identity) => identity.receiptContentId),
      maxAuditedAssessments: event.data.maxAuditedAssessments,
      status: "started",
      artifactId: null,
      receiptId: null,
      receiptContentId: null,
      outcome: null,
      reasonCodes: [],
      auditedClaimCount: null,
      failure: null,
    };
    return next;
  }

  if (event.type === "analysis.evidence.decision_completed") {
    invariant(event.producer.kind === "decision_host", event, "evidence decision completion must come from the decision host");
    const operation = next.evidenceDecisions[event.data.operationId];
    invariant(operation?.status === "started", event, `evidence decision ${event.data.operationId} is not active`);
    const artifact = next.artifacts[event.data.outputArtifactId];
    const receipt = event.data.receipt;
    const scope = next.tasks[operation.taskId]?.grants.find((grant) =>
      grant.id === operation.grantId && grant.capability === "analysis.evidence.decide")?.decisionScope;
    invariant(
      artifact?.origin.kind === "evidence_decision" &&
        artifact.origin.operationId === operation.id &&
        artifact.origin.receiptId === receipt.receiptId &&
        artifact.origin.receiptContentId === event.data.receiptContentId &&
        artifact.content.contentId === event.data.receiptContentId,
      event,
      `evidence decision ${operation.id} has no content-addressed receipt artifact`,
    );
    invariant(
      receipt.operationId === operation.id &&
        receipt.authorization.grantId === operation.grantId &&
        receipt.authorization.taskId === operation.taskId &&
        receipt.authorization.agentId === operation.agentId &&
        receipt.authorization.maxDecisions === scope?.maxDecisions &&
        receipt.authorization.maxAuditedAssessments === operation.maxAuditedAssessments,
      event,
      `evidence decision ${operation.id} receipt changed authorization`,
    );
    invariant(
      JSON.stringify(receipt.inputs.map((input) => input.operationId)) === JSON.stringify(operation.assessmentOperationIds) &&
        JSON.stringify(receipt.inputs.map((input) => input.artifactId)) === JSON.stringify(operation.assessmentArtifactIds) &&
        JSON.stringify(receipt.inputs.map((input) => input.receiptId)) === JSON.stringify(operation.assessmentReceiptIds) &&
        JSON.stringify(receipt.inputs.map((input) => input.receiptContentId)) === JSON.stringify(operation.assessmentReceiptContentIds),
      event,
      `evidence decision ${operation.id} receipt changed audited assessment inputs`,
    );
    operation.status = "completed";
    operation.artifactId = artifact.id;
    operation.receiptId = receipt.receiptId;
    operation.receiptContentId = event.data.receiptContentId;
    operation.outcome = receipt.decision.outcome;
    operation.reasonCodes = [...receipt.decision.reasonCodes];
    operation.auditedClaimCount = receipt.result.auditedClaimCount;
    return next;
  }

  if (event.type === "analysis.evidence.decision_failed") {
    invariant(event.producer.kind === "decision_host", event, "evidence decision failure must come from the decision host");
    const operation = next.evidenceDecisions[event.data.operationId];
    invariant(operation?.status === "started", event, `evidence decision ${event.data.operationId} is not active`);
    operation.status = "failed";
    operation.failure = event.data.reason;
    return next;
  }

  if (event.type === "report.submitted") {
    invariant(event.producer.kind === "handoff_host", event, "reports must come from the handoff host");
    const report = event.data.report;
    const task = next.tasks[report.taskId];
    invariant(task?.status === "working" && task.ownerAgentId === report.agentId, event, `report ${report.id} has no working owner`);
    invariant(task.grants.some((grant) => grant.capability === "report.submit"), event, `task ${task.id} cannot submit reports`);
    invariant(
      !Object.values(next.executions).some(
        (execution) => execution.taskId === task.id && execution.status === "active",
      ),
      event,
      `task ${task.id} cannot report while its executor is active`,
    );
    invariant(task.parentTaskId === report.parentTaskId && task.parentAgentId === report.parentAgentId, event, `report ${report.id} parentage changed`);
    invariant(!next.reports[report.id], event, `report ${report.id} is duplicated`);
    invariant(report.status === "submitted" && report.decisionReason === null, event, `report ${report.id} has a premature decision`);
    invariant(report.outputArtifactIds.length > 0, event, `report ${report.id} has no output artifacts`);
    invariant(
      report.outputArtifactIds.every((id) => {
        const artifact = next.artifacts[id];
        return artifact?.producerTaskId === task.id && artifact.producerAgentId === report.agentId;
      }),
      event,
      `report ${report.id} contains an artifact owned by another task`,
    );
    for (const output of task.requiredOutputs.filter((candidate) => candidate.required)) {
      invariant(
        report.outputArtifactIds.some((id) => next.artifacts[id]?.kind === output.artifactKind),
        event,
        `report ${report.id} does not satisfy ${output.name}`,
      );
    }
    next.reports[report.id] = report;
    task.status = "reported";
    next.agents[report.agentId].status = "reporting";
    return next;
  }

  if (event.type === "report.decided") {
    invariant(event.producer.kind === "handoff_host", event, "report decisions must come from the handoff host");
    const report = next.reports[event.data.reportId];
    invariant(report?.status === "submitted", event, `report ${event.data.reportId} is not pending`);
    const parent = next.tasks[report.parentTaskId];
    const child = next.tasks[report.taskId];
    invariant(parent?.ownerAgentId === event.data.decidedByAgentId && parent.id === event.data.decidedByTaskId, event, `report ${report.id} was decided outside its parent`);
    invariant(child?.status === "reported", event, `report ${report.id} child is not reported`);
    report.status = event.data.accepted ? "accepted" : "rejected";
    report.decisionReason = event.data.reason;
    child.status = event.data.accepted ? "completed" : "working";
    next.agents[report.agentId].status = event.data.accepted ? "retired" : "working";
    return next;
  }

  invariant(event.type === "media.operation_failed", event, "unknown runtime event");
  invariant(event.producer.kind === "media_host", event, "media failure evidence must come from the media host");
  const operation = next.operations[event.data.operationId];
  invariant(operation?.status === "started", event, `operation ${event.data.operationId} is not active`);
  operation.status = "failed";
  operation.failure = event.data.reason;
  return next;
}

export function projectRuntimeEvents(runId: string, events: readonly unknown[]): RuntimeProjection {
  return events.reduce(applyRuntimeEvent, initialRuntimeProjection(runId));
}
