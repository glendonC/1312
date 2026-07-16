import type {
  RuntimeProjection,
  TaskRecord,
  TaskStatus,
} from "../model.ts";
import type { RuntimeEvent } from "../protocol.ts";
import { invariant, sameGrants } from "./shared.ts";

const TRANSITIONS: Record<TaskStatus, readonly TaskStatus[]> = {
  scheduled: ["working", "failed", "withheld"],
  working: ["reported", "completed", "failed", "withheld"],
  reported: ["completed", "failed", "withheld"],
  completed: [],
  failed: [],
  withheld: [],
};

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


export function applyTaskEvent(next: RuntimeProjection, event: RuntimeEvent): boolean {
  if (event.type === "task.created") {
    invariant(event.producer.kind === "scheduler", event, "task creation must come from the scheduler");
    const task = event.data.task;
    validateTaskReferences(next, event, task);
    if (task.parentTaskId !== null) {
      const request = Object.values(next.spawnRequests).find((candidate) => candidate.taskId === task.id);
      invariant(request?.accepted === true && request.agentId === task.assignedAgentId, event, `task ${task.id} has no accepted spawn decision`);
    }
    next.tasks[task.id] = task;
    return true;
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
    return true;
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
    return true;
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
    return true;
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
    return true;
  }

  return false;
}
