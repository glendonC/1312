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
    publishReviewIntakes: {},
    publishReviewDecisions: {},
    publishReviewRevocations: {},
    captionProductions: {},
    captionQualityControls: {},
    executions: {},
    modelUsage: {},
    reports: {},
    rootOutputDispositions: {},
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
    } else if (artifact.origin.kind === "root_output_disposition") {
      const report = next.reports[artifact.origin.reportId];
      const expectedStatus = artifact.origin.outcome === "promoted_to_root" ? "accepted" : "rejected";
      invariant(report?.status === expectedStatus, event, `artifact ${artifact.id} has no matching root report decision`);
      invariant(
        report.parentTaskId === artifact.producerTaskId &&
          report.parentAgentId === artifact.producerAgentId &&
          report.outputArtifactIds.includes(artifact.origin.inputArtifactId) &&
          artifact.sourceArtifactIds.length === 1 &&
          artifact.sourceArtifactIds[0] === artifact.origin.inputArtifactId,
        event,
        `artifact ${artifact.id} changed its root disposition lineage`,
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
    } else if (artifact.origin.kind === "publish_review_intake") {
      const intake = next.publishReviewIntakes[artifact.origin.intakeId];
      invariant(intake?.status === "started", event, `artifact ${artifact.id} has no active publish-review intake`);
      invariant(
        artifact.producerTaskId === null && artifact.producerAgentId === null,
        event,
        `artifact ${artifact.id} incorrectly claims a task producer`,
      );
      invariant(
        artifact.origin.decisionOperationId === intake.decisionOperationId &&
          artifact.origin.decisionArtifactId === intake.decisionArtifactId &&
          artifact.origin.decisionReceiptId === intake.decisionReceiptId &&
          artifact.origin.decisionReceiptContentId === intake.decisionReceiptContentId &&
          JSON.stringify(artifact.sourceArtifactIds) === JSON.stringify([intake.decisionArtifactId]),
        event,
        `artifact ${artifact.id} changed its verified decision input`,
      );
    } else if (artifact.origin.kind === "publish_review_decision") {
      const review = next.publishReviewDecisions[artifact.origin.reviewId];
      invariant(review?.status === "started", event, `artifact ${artifact.id} has no active publish-review decision`);
      invariant(
        artifact.producerTaskId === null && artifact.producerAgentId === null,
        event,
        `artifact ${artifact.id} incorrectly claims a task producer`,
      );
      invariant(
        artifact.origin.intakeId === review.intakeId &&
          artifact.origin.intakeArtifactId === review.intakeArtifactId &&
          artifact.origin.intakeReceiptId === review.intakeReceiptId &&
          artifact.origin.intakeReceiptContentId === review.intakeReceiptContentId &&
          JSON.stringify(artifact.sourceArtifactIds) === JSON.stringify([review.intakeArtifactId]),
        event,
        `artifact ${artifact.id} changed its verified intake input`,
      );
    } else if (artifact.origin.kind === "publish_review_revocation") {
      const revocation = next.publishReviewRevocations[artifact.origin.revocationId];
      invariant(revocation?.status === "started", event, `artifact ${artifact.id} has no active publish-review revocation`);
      invariant(
        artifact.producerTaskId === null && artifact.producerAgentId === null,
        event,
        `artifact ${artifact.id} incorrectly claims a task producer`,
      );
      invariant(
        artifact.origin.reviewId === revocation.reviewId &&
          artifact.origin.approvalArtifactId === revocation.approvalArtifactId &&
          artifact.origin.approvalReceiptId === revocation.approvalReceiptId &&
          artifact.origin.approvalReceiptContentId === revocation.approvalReceiptContentId &&
          JSON.stringify(artifact.sourceArtifactIds) === JSON.stringify([revocation.approvalArtifactId]),
        event,
        `artifact ${artifact.id} changed its verified approval input`,
      );
    } else if (artifact.origin.kind === "caption_production_output") {
      const job = next.captionProductions[artifact.origin.jobId];
      invariant(job?.status === "started", event, `artifact ${artifact.id} has no active caption production`);
      invariant(
        artifact.producerTaskId === null && artifact.producerAgentId === null &&
          artifact.origin.approvalReviewId === job.approvalReviewId &&
          artifact.origin.approvalArtifactId === job.approvalArtifactId &&
          artifact.origin.sourceArtifactId === job.sourceArtifactId &&
          artifact.origin.acceptedChildArtifactId === job.acceptedChildOutput.artifactId &&
          artifact.origin.rootPromotionArtifactId === job.rootPromotion.artifactId &&
          artifact.content.contentId !== artifact.origin.receiptContentId &&
          JSON.stringify(artifact.sourceArtifactIds) === JSON.stringify([
            job.sourceArtifactId,
            job.acceptedChildOutput.artifactId,
            job.rootPromotion.artifactId,
            job.approvalArtifactId,
          ]),
        event,
        `artifact ${artifact.id} changed its caption source or approval authority`,
      );
    } else if (artifact.origin.kind === "caption_production_receipt") {
      const job = next.captionProductions[artifact.origin.jobId];
      const caption = next.artifacts[artifact.origin.captionArtifactId];
      invariant(job?.status === "started", event, `artifact ${artifact.id} has no active caption production`);
      invariant(
        artifact.producerTaskId === null && artifact.producerAgentId === null &&
          caption?.origin.kind === "caption_production_output" &&
          caption.origin.jobId === job.id &&
          caption.content.contentId === artifact.origin.captionContentId &&
          artifact.origin.approvalReviewId === job.approvalReviewId &&
          artifact.origin.approvalArtifactId === job.approvalArtifactId &&
          artifact.origin.rootPromotionArtifactId === job.rootPromotion.artifactId &&
          JSON.stringify(artifact.sourceArtifactIds) === JSON.stringify([
            caption.id,
            job.rootPromotion.artifactId,
            job.approvalArtifactId,
          ]),
        event,
        `artifact ${artifact.id} changed its caption output or approval authority`,
      );
    } else if (artifact.origin.kind === "caption_quality_control") {
      const job = next.captionProductions[artifact.origin.jobId];
      const caption = next.artifacts[artifact.origin.captionArtifactId];
      invariant(job?.status === "completed", event, `artifact ${artifact.id} has no completed caption candidate`);
      invariant(
        artifact.producerTaskId === null && artifact.producerAgentId === null &&
          caption?.origin.kind === "caption_production_output" &&
          caption.id === job.captionArtifactId &&
          caption.content.contentId === artifact.origin.captionContentId &&
          artifact.origin.captionContentId === job.captionContentId &&
          artifact.content.contentId === artifact.origin.receiptContentId &&
          JSON.stringify(artifact.sourceArtifactIds) === JSON.stringify([
            caption.id,
            job.rootPromotion.artifactId,
          ]),
        event,
        `artifact ${artifact.id} changed its caption candidate or current-run promotion lineage`,
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
      observation: null,
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
        artifact.kind === "media-audio-activity-observation" &&
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
    operation.observation = receipt.capability === "media.seek"
      ? structuredClone(receipt.observation)
      : null;
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
      artifact.sourceArtifactIds.length === 1 &&
        artifact.sourceArtifactIds[0] === scope.sourceArtifactId &&
        event.data.sourceArtifactId === scope.sourceArtifactId &&
        event.data.startMs === scope.startMs &&
        event.data.endMs === scope.endMs &&
        task.mediaScope.some((mediaScope) =>
          mediaScope.artifactId === scope.sourceArtifactId &&
          mediaScope.startMs === scope.startMs &&
          mediaScope.endMs === scope.endMs),
      event,
      `evidence read ${request.operationId} changed its exact source window`,
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
      sourceArtifactId: event.data.sourceArtifactId,
      startMs: event.data.startMs,
      endMs: event.data.endMs,
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
        receipt.authorization.sourceArtifactId === operation.sourceArtifactId &&
        receipt.authorization.startMs === operation.startMs &&
        receipt.authorization.endMs === operation.endMs &&
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

  if (event.type === "publish.review.intake_started") {
    invariant(
      event.producer.kind === "publish_review_intake_host",
      event,
      "publish-review intake must come from the intake host",
    );
    const decision = next.evidenceDecisions[event.data.decision.operationId];
    invariant(
      decision?.status === "completed" &&
        decision.artifactId === event.data.decision.artifactId &&
        decision.receiptId === event.data.decision.receiptId &&
        decision.receiptContentId === event.data.decision.receiptContentId,
      event,
      `publish-review intake ${event.data.intakeId} has no completed exact decision identity`,
    );
    invariant(!next.publishReviewIntakes[event.data.intakeId], event, `publish-review intake ${event.data.intakeId} is duplicated`);
    invariant(
      !Object.values(next.publishReviewIntakes).some((intake) =>
        intake.decisionOperationId === event.data.decision.operationId),
      event,
      `decision ${event.data.decision.operationId} already has publish-review intake lineage`,
    );
    next.publishReviewIntakes[event.data.intakeId] = {
      id: event.data.intakeId,
      decisionOperationId: event.data.decision.operationId,
      decisionArtifactId: event.data.decision.artifactId,
      decisionReceiptId: event.data.decision.receiptId,
      decisionReceiptContentId: event.data.decision.receiptContentId,
      status: "started",
      artifactId: null,
      receiptId: null,
      receiptContentId: null,
      outcome: null,
      reasonCodes: [],
      failure: null,
    };
    return next;
  }

  if (event.type === "publish.review.intake_completed") {
    invariant(
      event.producer.kind === "publish_review_intake_host",
      event,
      "publish-review intake completion must come from the intake host",
    );
    const intake = next.publishReviewIntakes[event.data.intakeId];
    invariant(intake?.status === "started", event, `publish-review intake ${event.data.intakeId} is not active`);
    const artifact = next.artifacts[event.data.outputArtifactId];
    const receipt = event.data.receipt;
    invariant(
      artifact?.origin.kind === "publish_review_intake" &&
        artifact.origin.intakeId === intake.id &&
        artifact.origin.receiptId === receipt.receiptId &&
        artifact.origin.receiptContentId === event.data.receiptContentId &&
        artifact.content.contentId === event.data.receiptContentId,
      event,
      `publish-review intake ${intake.id} has no content-addressed receipt artifact`,
    );
    invariant(
      receipt.intakeId === intake.id &&
        receipt.input.decision.operationId === intake.decisionOperationId &&
        receipt.input.decision.artifactId === intake.decisionArtifactId &&
        receipt.input.decision.receiptId === intake.decisionReceiptId &&
        receipt.input.decision.receiptContentId === intake.decisionReceiptContentId,
      event,
      `publish-review intake ${intake.id} receipt changed its verified decision identity`,
    );
    const decision = next.evidenceDecisions[intake.decisionOperationId];
    invariant(
      (decision.outcome === "proceed_to_publish_review" && receipt.result.outcome === "queued") ||
        (decision.outcome === "withheld" && receipt.result.outcome === "rejected"),
      event,
      `publish-review intake ${intake.id} outcome does not follow the decision outcome`,
    );
    invariant(
      JSON.stringify(receipt.result.reasonCodes) === JSON.stringify(decision.reasonCodes),
      event,
      `publish-review intake ${intake.id} changed the decision reason codes`,
    );
    intake.status = "completed";
    intake.artifactId = artifact.id;
    intake.receiptId = receipt.receiptId;
    intake.receiptContentId = event.data.receiptContentId;
    intake.outcome = receipt.result.outcome;
    intake.reasonCodes = [...receipt.result.reasonCodes];
    return next;
  }

  if (event.type === "publish.review.intake_failed") {
    invariant(
      event.producer.kind === "publish_review_intake_host",
      event,
      "publish-review intake failure must come from the intake host",
    );
    const intake = next.publishReviewIntakes[event.data.intakeId];
    invariant(intake?.status === "started", event, `publish-review intake ${event.data.intakeId} is not active`);
    intake.status = "failed";
    intake.failure = event.data.reason;
    return next;
  }

  if (event.type === "publish.review.decision_started") {
    invariant(event.producer.kind === "publish_review_host", event, "publish-review decisions must come from the review host");
    const request = event.data.request;
    const intake = next.publishReviewIntakes[request.intake.intakeId];
    invariant(
      intake?.status === "completed" &&
        intake.outcome === "queued" &&
        intake.artifactId === request.intake.artifactId &&
        intake.receiptId === request.intake.receiptId &&
        intake.receiptContentId === request.intake.receiptContentId,
      event,
      `publish-review decision ${event.data.reviewId} has no completed exact queued intake identity`,
    );
    invariant(!next.publishReviewDecisions[event.data.reviewId], event, `publish-review decision ${event.data.reviewId} is duplicated`);
    invariant(
      !Object.values(next.publishReviewDecisions).some((review) => review.intakeId === intake.id),
      event,
      `queued intake ${intake.id} already has immutable review lineage`,
    );
    next.publishReviewDecisions[event.data.reviewId] = {
      id: event.data.reviewId,
      intakeId: intake.id,
      intakeArtifactId: request.intake.artifactId,
      intakeReceiptId: request.intake.receiptId,
      intakeReceiptContentId: request.intake.receiptContentId,
      reviewerId: request.reviewer.id,
      reviewerLabel: event.data.reviewerLabel,
      status: "started",
      artifactId: null,
      receiptId: null,
      receiptContentId: null,
      outcome: null,
      reasonCodes: [],
      note: null,
      failure: null,
    };
    return next;
  }

  if (event.type === "publish.review.decision_completed") {
    invariant(event.producer.kind === "publish_review_host", event, "publish-review completion must come from the review host");
    const review = next.publishReviewDecisions[event.data.reviewId];
    invariant(review?.status === "started", event, `publish-review decision ${event.data.reviewId} is not active`);
    const artifact = next.artifacts[event.data.outputArtifactId];
    const receipt = event.data.receipt;
    invariant(
      artifact?.origin.kind === "publish_review_decision" &&
        artifact.origin.reviewId === review.id &&
        artifact.origin.receiptId === receipt.receiptId &&
        artifact.origin.receiptContentId === event.data.receiptContentId &&
        artifact.content.contentId === event.data.receiptContentId,
      event,
      `publish-review decision ${review.id} has no content-addressed receipt artifact`,
    );
    invariant(
      receipt.reviewId === review.id &&
        receipt.input.intake.intakeId === review.intakeId &&
        receipt.input.intake.artifactId === review.intakeArtifactId &&
        receipt.input.intake.receiptId === review.intakeReceiptId &&
        receipt.input.intake.receiptContentId === review.intakeReceiptContentId &&
        receipt.reviewer.id === review.reviewerId &&
        receipt.reviewer.label === review.reviewerLabel,
      event,
      `publish-review decision ${review.id} receipt changed its intake or reviewer identity`,
    );
    review.status = "completed";
    review.artifactId = artifact.id;
    review.receiptId = receipt.receiptId;
    review.receiptContentId = event.data.receiptContentId;
    review.outcome = receipt.decision.outcome;
    review.reasonCodes = [...receipt.decision.reasonCodes];
    review.note = receipt.decision.note;
    return next;
  }

  if (event.type === "publish.review.decision_failed") {
    invariant(event.producer.kind === "publish_review_host", event, "publish-review failure must come from the review host");
    const review = next.publishReviewDecisions[event.data.reviewId];
    invariant(review?.status === "started", event, `publish-review decision ${event.data.reviewId} is not active`);
    review.status = "failed";
    review.failure = event.data.reason;
    return next;
  }

  if (event.type === "publish.review.revocation_started") {
    invariant(event.producer.kind === "publish_review_host", event, "publish-review revocations must come from the review host");
    const request = event.data.request;
    const approval = next.publishReviewDecisions[request.approval.reviewId];
    invariant(
      approval?.status === "completed" &&
        approval.outcome === "approve_for_caption_production" &&
        approval.artifactId === request.approval.artifactId &&
        approval.receiptId === request.approval.receiptId &&
        approval.receiptContentId === request.approval.receiptContentId,
      event,
      `publish-review revocation ${event.data.revocationId} has no completed exact approval identity`,
    );
    invariant(!next.publishReviewRevocations[event.data.revocationId], event, `publish-review revocation ${event.data.revocationId} is duplicated`);
    invariant(
      !Object.values(next.publishReviewRevocations).some((revocation) => revocation.reviewId === approval.id),
      event,
      `approval ${approval.id} already has immutable revocation lineage`,
    );
    next.publishReviewRevocations[event.data.revocationId] = {
      id: event.data.revocationId,
      reviewId: approval.id,
      approvalArtifactId: request.approval.artifactId,
      approvalReceiptId: request.approval.receiptId,
      approvalReceiptContentId: request.approval.receiptContentId,
      reviewerId: request.reviewer.id,
      reviewerLabel: event.data.reviewerLabel,
      status: "started",
      artifactId: null,
      receiptId: null,
      receiptContentId: null,
      reasonCodes: [],
      note: null,
      failure: null,
    };
    return next;
  }

  if (event.type === "publish.review.revocation_completed") {
    invariant(event.producer.kind === "publish_review_host", event, "publish-review revocation completion must come from the review host");
    const revocation = next.publishReviewRevocations[event.data.revocationId];
    invariant(revocation?.status === "started", event, `publish-review revocation ${event.data.revocationId} is not active`);
    const artifact = next.artifacts[event.data.outputArtifactId];
    const receipt = event.data.receipt;
    invariant(
      artifact?.origin.kind === "publish_review_revocation" &&
        artifact.origin.revocationId === revocation.id &&
        artifact.origin.receiptId === receipt.receiptId &&
        artifact.origin.receiptContentId === event.data.receiptContentId &&
        artifact.content.contentId === event.data.receiptContentId,
      event,
      `publish-review revocation ${revocation.id} has no content-addressed receipt artifact`,
    );
    invariant(
      receipt.revocationId === revocation.id &&
        receipt.input.approval.reviewId === revocation.reviewId &&
        receipt.input.approval.artifactId === revocation.approvalArtifactId &&
        receipt.input.approval.receiptId === revocation.approvalReceiptId &&
        receipt.input.approval.receiptContentId === revocation.approvalReceiptContentId &&
        receipt.reviewer.id === revocation.reviewerId &&
        receipt.reviewer.label === revocation.reviewerLabel &&
        receipt.result.state === "approval_revoked",
      event,
      `publish-review revocation ${revocation.id} receipt changed its approval or reviewer identity`,
    );
    revocation.status = "completed";
    revocation.artifactId = artifact.id;
    revocation.receiptId = receipt.receiptId;
    revocation.receiptContentId = event.data.receiptContentId;
    revocation.reasonCodes = [...receipt.revocation.reasonCodes];
    revocation.note = receipt.revocation.note;
    return next;
  }

  if (event.type === "publish.review.revocation_failed") {
    invariant(event.producer.kind === "publish_review_host", event, "publish-review revocation failure must come from the review host");
    const revocation = next.publishReviewRevocations[event.data.revocationId];
    invariant(revocation?.status === "started", event, `publish-review revocation ${event.data.revocationId} is not active`);
    revocation.status = "failed";
    revocation.failure = event.data.reason;
    return next;
  }

  if (event.type === "caption.production_started") {
    invariant(event.producer.kind === "caption_production_host", event, "caption production must come from the caption host");
    const request = event.data.request;
    const approval = next.publishReviewDecisions[request.approval.reviewId];
    invariant(
      approval?.status === "completed" &&
        approval.outcome === "approve_for_caption_production" &&
        approval.artifactId === request.approval.artifactId &&
        approval.receiptId === request.approval.receiptId &&
        approval.receiptContentId === request.approval.receiptContentId,
      event,
      `caption production ${event.data.jobId} has no exact completed approval`,
    );
    invariant(
      !Object.values(next.publishReviewRevocations).some((revocation) =>
        revocation.reviewId === approval.id && revocation.status !== "failed"),
      event,
      `caption production ${event.data.jobId} cannot start from a revoked or revoking approval`,
    );
    invariant(!next.captionProductions[event.data.jobId], event, `caption production ${event.data.jobId} is duplicated`);
    invariant(
      !Object.values(next.captionProductions).some((job) => job.approvalReviewId === approval.id),
      event,
      `approval ${approval.id} already has caption-production lineage`,
    );
    const source = next.artifacts[event.data.input.sourceArtifactId];
    const childOutput = next.artifacts[event.data.input.acceptedChildOutput.artifactId];
    const promotion = next.rootOutputDispositions[event.data.input.rootPromotion.dispositionId];
    const promotionArtifact = next.artifacts[event.data.input.rootPromotion.artifactId];
    invariant(
      source?.origin.kind === "ingest" && source.content.contentId === event.data.input.sourceContentId,
      event,
      `caption production ${event.data.jobId} has no exact runtime source artifact`,
    );
    invariant(
      childOutput?.origin.kind === "worker_output" &&
        childOutput.content.contentId === event.data.input.acceptedChildOutput.contentId &&
        promotion?.outcome === "promoted_to_root" &&
        promotion.inputArtifactId === childOutput.id &&
        promotion.outputArtifactId === promotionArtifact?.id &&
        promotion.receiptId === event.data.input.rootPromotion.receiptId &&
        promotion.receiptContentId === event.data.input.rootPromotion.receiptContentId &&
        promotionArtifact?.origin.kind === "root_output_disposition" &&
        promotionArtifact.content.contentId === event.data.input.rootPromotion.contentId,
      event,
      `caption production ${event.data.jobId} has no exact accepted current-run child promotion`,
    );
    next.captionProductions[event.data.jobId] = {
      id: event.data.jobId,
      approvalReviewId: approval.id,
      approvalArtifactId: request.approval.artifactId,
      approvalReceiptId: request.approval.receiptId,
      approvalReceiptContentId: request.approval.receiptContentId,
      sourceArtifactId: source.id,
      sourceContentId: source.content.contentId,
      analysisRequestId: event.data.input.analysisRequestId,
      range: structuredClone(event.data.input.range),
      acceptedChildOutput: structuredClone(event.data.input.acceptedChildOutput),
      rootPromotion: structuredClone(event.data.input.rootPromotion),
      limits: structuredClone(event.data.limits),
      executor: structuredClone(event.data.executor),
      status: "started",
      captionArtifactId: null,
      captionContentId: null,
      receiptArtifactId: null,
      receiptId: null,
      receiptContentId: null,
      resultStatus: null,
      lineCount: null,
      sourceAvailableCount: null,
      targetAvailableCount: null,
      withheldCount: null,
      unavailableCount: null,
      failure: null,
    };
    return next;
  }

  if (event.type === "caption.production_completed") {
    invariant(event.producer.kind === "caption_production_host", event, "caption completion must come from the caption host");
    const job = next.captionProductions[event.data.jobId];
    invariant(job?.status === "started", event, `caption production ${event.data.jobId} is not active`);
    const captionArtifact = next.artifacts[event.data.captionArtifactId];
    const receiptArtifact = next.artifacts[event.data.receiptArtifactId];
    const receipt = event.data.receipt;
    invariant(
      captionArtifact?.origin.kind === "caption_production_output" &&
        captionArtifact.origin.jobId === job.id &&
        captionArtifact.content.contentId === event.data.captionContentId &&
        receiptArtifact?.origin.kind === "caption_production_receipt" &&
        receiptArtifact.origin.jobId === job.id &&
        receiptArtifact.origin.captionArtifactId === captionArtifact.id &&
        receiptArtifact.content.contentId === event.data.receiptContentId,
      event,
      `caption production ${job.id} has no exact output and receipt artifacts`,
    );
    invariant(
      receipt.jobId === job.id &&
        receipt.authority.approval.reviewId === job.approvalReviewId &&
        receipt.authority.approval.artifactId === job.approvalArtifactId &&
        receipt.authority.approval.receiptId === job.approvalReceiptId &&
        receipt.authority.approval.receiptContentId === job.approvalReceiptContentId &&
        receipt.input.sourceArtifactId === job.sourceArtifactId &&
        receipt.input.sourceContentId === job.sourceContentId &&
        receipt.input.analysisRequestId === job.analysisRequestId &&
        JSON.stringify(receipt.input.range) === JSON.stringify(job.range) &&
        JSON.stringify(receipt.input.acceptedChildOutput) === JSON.stringify(job.acceptedChildOutput) &&
        JSON.stringify(receipt.input.rootPromotion) === JSON.stringify(job.rootPromotion) &&
        JSON.stringify(receipt.limits) === JSON.stringify(job.limits) &&
        JSON.stringify(receipt.producer.executor) === JSON.stringify(job.executor) &&
        receipt.result.captionArtifactId === captionArtifact.id &&
        receipt.result.captionContentId === captionArtifact.content.contentId,
      event,
      `caption production ${job.id} receipt changed its authority, input, or executor`,
    );
    job.status = "completed";
    job.captionArtifactId = captionArtifact.id;
    job.captionContentId = captionArtifact.content.contentId;
    job.receiptArtifactId = receiptArtifact.id;
    job.receiptId = receipt.receiptId;
    job.receiptContentId = receiptArtifact.content.contentId;
    job.resultStatus = receipt.result.status;
    job.lineCount = receipt.result.lineCount;
    job.sourceAvailableCount = receipt.result.sourceAvailableCount;
    job.targetAvailableCount = receipt.result.targetAvailableCount;
    job.withheldCount = receipt.result.withheldCount;
    job.unavailableCount = receipt.result.unavailableCount;
    return next;
  }

  if (event.type === "caption.production_failed") {
    invariant(event.producer.kind === "caption_production_host", event, "caption failure must come from the caption host");
    const job = next.captionProductions[event.data.jobId];
    invariant(job?.status === "started", event, `caption production ${event.data.jobId} is not active`);
    job.status = "failed";
    job.failure = event.data.reason;
    return next;
  }

  if (event.type === "caption.quality_control_decided") {
    invariant(event.producer.kind === "caption_quality_control_host", event, "caption QC decisions must come from the independent QC host");
    const receipt = event.data.receipt;
    const job = next.captionProductions[receipt.input.jobId];
    const artifact = next.artifacts[event.data.outputArtifactId];
    invariant(job?.status === "completed", event, `caption QC ${event.data.qcId} has no completed candidate`);
    invariant(
      !next.captionQualityControls[event.data.qcId] &&
        !Object.values(next.captionQualityControls).some((qc) => qc.jobId === receipt.input.jobId),
      event,
      `caption QC ${event.data.qcId} is duplicated`,
    );
    invariant(
      receipt.qcId === event.data.qcId &&
        receipt.input.captionArtifactId === job.captionArtifactId &&
        receipt.input.captionContentId === job.captionContentId &&
        receipt.input.captionReceiptId === job.receiptId &&
        receipt.input.captionReceiptContentId === job.receiptContentId &&
        JSON.stringify(receipt.lineage.candidateInput.acceptedChildOutput) === JSON.stringify(job.acceptedChildOutput) &&
        JSON.stringify(receipt.lineage.candidateInput.rootPromotion) === JSON.stringify(job.rootPromotion) &&
        JSON.stringify(receipt.lineage.executor) === JSON.stringify(job.executor),
      event,
      `caption QC ${event.data.qcId} changed its candidate or current-run lineage`,
    );
    invariant(
      artifact?.origin.kind === "caption_quality_control" &&
        artifact.origin.qcId === receipt.qcId &&
        artifact.origin.jobId === receipt.input.jobId &&
        artifact.origin.captionArtifactId === receipt.input.captionArtifactId &&
        artifact.origin.captionContentId === receipt.input.captionContentId &&
        artifact.origin.receiptId === receipt.receiptId &&
        artifact.origin.receiptContentId === event.data.receiptContentId &&
        artifact.origin.outcome === receipt.decision.outcome &&
        artifact.content.contentId === event.data.receiptContentId,
      event,
      `caption QC ${event.data.qcId} has no exact receipt artifact`,
    );
    next.captionQualityControls[receipt.qcId] = {
      id: receipt.qcId,
      jobId: receipt.input.jobId,
      captionArtifactId: receipt.input.captionArtifactId,
      captionContentId: receipt.input.captionContentId,
      captionReceiptId: receipt.input.captionReceiptId,
      captionReceiptContentId: receipt.input.captionReceiptContentId,
      outputArtifactId: artifact.id,
      receiptId: receipt.receiptId,
      receiptContentId: artifact.content.contentId,
      outcome: receipt.decision.outcome,
      reasonCodes: [...receipt.decision.reasonCodes],
    };
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

  if (event.type === "root.output_disposition_recorded") {
    invariant(event.producer.kind === "handoff_host", event, "root output dispositions must come from the handoff host");
    const receipt = event.data.receipt;
    const artifact = next.artifacts[event.data.outputArtifactId];
    const report = next.reports[receipt.report.reportId];
    const input = next.artifacts[receipt.input.artifactId];
    const spawn = next.spawnRequests[receipt.delegation.spawnRequestId];
    const child = next.tasks[receipt.delegation.childTaskId];
    const expectedStatus = receipt.decision.outcome === "promoted_to_root" ? "accepted" : "rejected";
    invariant(!next.rootOutputDispositions[event.data.dispositionId], event, `root disposition ${event.data.dispositionId} is duplicated`);
    invariant(
      receipt.dispositionId === event.data.dispositionId,
      event,
      `root disposition ${event.data.dispositionId} changed identity`,
    );
    invariant(report?.status === expectedStatus, event, `root disposition ${receipt.dispositionId} has no matching report decision`);
    invariant(
      report.decisionReason === receipt.report.decisionReason &&
        report.taskId === receipt.delegation.childTaskId &&
        report.agentId === receipt.delegation.childAgentId &&
        report.parentTaskId === receipt.authority.rootTaskId &&
        report.parentAgentId === receipt.authority.rootAgentId &&
        report.outputArtifactIds.includes(receipt.input.artifactId),
      event,
      `root disposition ${receipt.dispositionId} changed report lineage`,
    );
    invariant(
      spawn?.accepted === true &&
        spawn.requestedByTaskId === receipt.authority.rootTaskId &&
        spawn.requestedByAgentId === receipt.authority.rootAgentId &&
        spawn.taskId === receipt.delegation.childTaskId &&
        spawn.agentId === receipt.delegation.childAgentId &&
        child?.workerKind === receipt.delegation.workerKind &&
        JSON.stringify(child.mediaScope) === JSON.stringify(receipt.delegation.mediaScope) &&
        sameGrants(child.grants, receipt.delegation.grants),
      event,
      `root disposition ${receipt.dispositionId} changed spawn, scope, or grant lineage`,
    );
    invariant(
      input?.origin.kind === "worker_output" &&
        input.id === receipt.input.artifactId &&
        input.content.contentId === receipt.input.contentId &&
        input.kind === receipt.input.kind &&
        input.producerTaskId === receipt.input.producerTaskId &&
        input.producerAgentId === receipt.input.producerAgentId &&
        input.origin.executionId === receipt.input.executionId &&
        input.origin.receiptId === receipt.input.executorReceiptId &&
        input.origin.receiptContentId === receipt.input.executorReceiptContentId,
      event,
      `root disposition ${receipt.dispositionId} changed child output identity`,
    );
    invariant(
      artifact?.origin.kind === "root_output_disposition" &&
        artifact.origin.dispositionId === receipt.dispositionId &&
        artifact.origin.reportId === receipt.report.reportId &&
        artifact.origin.inputArtifactId === receipt.input.artifactId &&
        artifact.origin.outcome === receipt.decision.outcome &&
        artifact.origin.receiptId === receipt.receiptId &&
        artifact.origin.receiptContentId === event.data.receiptContentId &&
        artifact.content.contentId === event.data.receiptContentId &&
        artifact.producerTaskId === receipt.authority.rootTaskId &&
        artifact.producerAgentId === receipt.authority.rootAgentId,
      event,
      `root disposition ${receipt.dispositionId} is not bound to its root-owned receipt artifact`,
    );
    next.rootOutputDispositions[receipt.dispositionId] = {
      id: receipt.dispositionId,
      reportId: receipt.report.reportId,
      spawnRequestId: receipt.delegation.spawnRequestId,
      rootTaskId: receipt.authority.rootTaskId,
      rootAgentId: receipt.authority.rootAgentId,
      childTaskId: receipt.delegation.childTaskId,
      childAgentId: receipt.delegation.childAgentId,
      inputArtifactId: receipt.input.artifactId,
      outputArtifactId: artifact.id,
      outcome: receipt.decision.outcome,
      receiptId: receipt.receiptId,
      receiptContentId: event.data.receiptContentId,
    };
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
