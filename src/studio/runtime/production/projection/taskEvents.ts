import type {
  RuntimeProjection,
  TaskRecord,
  TaskStatus,
} from "../model.ts";
import type { RuntimeEvent } from "../protocol.ts";
import { attenuateTaskJobContext } from "../jobContext.ts";
import { taskHasActiveCapability } from "../capabilityUsage.ts";
import { invariant, sameGrants } from "./shared.ts";

const TRANSITIONS: Record<TaskStatus, readonly TaskStatus[]> = {
  scheduled: ["working", "failed", "withheld", "interrupted"],
  working: ["waiting_for_children", "reported", "completed", "failed", "withheld", "interrupted"],
  waiting_for_children: ["working", "failed", "withheld", "interrupted"],
  reported: ["completed", "failed", "withheld", "interrupted"],
  completed: [],
  failed: [],
  withheld: [],
  interrupted: [],
};

function validateTaskReferences(next: RuntimeProjection, event: RuntimeEvent, task: TaskRecord): void {
  invariant(task.runId === next.runId, event, `task ${task.id} belongs to another run`);
  invariant(task.terminalReason === null, event, `new task ${task.id} has a terminal reason`);
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
    const source = next.artifacts[task.jobContext.source.artifactId];
    invariant(
      source?.origin.kind === "ingest" && source.content.contentId === task.jobContext.source.contentId,
      event,
      `root task ${task.id} job context changed its source identity`,
    );
  } else {
    const parent = next.tasks[task.parentTaskId];
    invariant(parent, event, `task ${task.id} references unknown parent ${task.parentTaskId}`);
    invariant(task.parentAgentId === parent.ownerAgentId, event, `task ${task.id} parent agent changed`);
    invariant(task.depth === parent.depth + 1, event, `task ${task.id} depth is not derived from its parent`);
    const expectedContext = attenuateTaskJobContext(parent.jobContext, task.mediaScope, task.inputArtifactIds);
    invariant(
      JSON.stringify(task.jobContext) === JSON.stringify(expectedContext),
      event,
      `task ${task.id} job context was not scheduler-attenuated from its parent`,
    );
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
    if (event.data.authoredByExecutionId !== null && event.data.toolCallId !== null) {
      const execution = next.executions[event.data.authoredByExecutionId];
      const call = next.orchestratorToolCalls[event.data.toolCallId];
      invariant(
        execution?.status === "active" && execution.taskId === event.data.requestedByTaskId &&
          execution.agentId === event.data.requestedByAgentId,
        event,
        `spawn request ${event.data.requestId} has no active model executor`,
      );
      invariant(
        (call?.tool === "task_spawn_request" || call?.tool === "study_restudy_request") && call.executionId === execution.id && call.taskId === execution.taskId &&
          call.spawnRequestId === null,
        event,
        `spawn request ${event.data.requestId} has no matching tool call`,
      );
      call.spawnRequestId = event.data.requestId;
    }
    next.spawnRequests[event.data.requestId] = {
      id: event.data.requestId,
      requestedByTaskId: event.data.requestedByTaskId,
      requestedByAgentId: event.data.requestedByAgentId,
      input: event.data.input,
      accepted: null,
      rejection: null,
      taskId: null,
      agentId: null,
      authoredByExecutionId: event.data.authoredByExecutionId,
      toolCallId: event.data.toolCallId,
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

  if (event.type === "task.launch_claimed") {
    invariant(event.producer.kind === "launcher", event, "task launch claims must come from the launcher");
    const claim = event.data.claim;
    const task = next.tasks[claim.taskId];
    invariant(task?.status === "scheduled" && task.ownerAgentId === null, event, `launch ${claim.id} has no scheduled task`);
    invariant(task.assignedAgentId === claim.agentId, event, `launch ${claim.id} changed task ownership`);
    invariant(!next.taskLaunches[task.id], event, `task ${task.id} already has a launch claim`);
    invariant(!Object.values(next.taskLaunches).some((candidate) => candidate.id === claim.id), event, `launch ${claim.id} is duplicated`);
    if (task.parentTaskId === null) invariant(claim.requestId === "root-task", event, `root launch ${claim.id} changed request identity`);
    else {
      const request = next.spawnRequests[claim.requestId];
      invariant(request?.accepted === true && request.taskId === task.id && request.agentId === task.assignedAgentId, event, `launch ${claim.id} has no accepted spawn decision`);
    }
    next.taskLaunches[task.id] = claim;
    return true;
  }

  if (event.type === "orchestrator.tool_called") {
    invariant(event.producer.kind === "launcher", event, "orchestrator tool evidence must come from the launcher");
    const execution = next.executions[event.data.executionId];
    const task = next.tasks[event.data.taskId];
    const capability = {
      task_spawn_request: "task.spawn.request",
      task_reports_wait: "task.reports.wait",
      report_disposition: "report.disposition",
      artifact_read: "artifact.read",
      study_planning_decision: "study.plan",
      study_restudy_request: "study.restudy",
      study_synthesize: "study.synthesize",
    }[event.data.tool];
    invariant(execution?.status === "active" && execution.taskId === task?.id, event, `tool call ${event.data.callId} has no active root executor`);
    invariant(task.ownerAgentId === execution.agentId && task.workerKind === "orchestrator", event, `tool call ${event.data.callId} changed orchestrator ownership`);
    invariant(task.grants.some((grant) => grant.capability === capability), event, `tool call ${event.data.callId} lacks its exact grant`);
    invariant(!next.orchestratorToolCalls[event.data.callId], event, `tool call ${event.data.callId} is duplicated`);
    next.orchestratorToolCalls[event.data.callId] = {
      id: event.data.callId,
      executionId: execution.id,
      taskId: task.id,
      tool: event.data.tool,
      spawnRequestId: null,
    };
    return true;
  }

  if (event.type === "reports.wait_started") {
    invariant(event.producer.kind === "launcher", event, "report wait evidence must come from the launcher");
    const task = next.tasks[event.data.parentTaskId];
    const call = next.orchestratorToolCalls[event.data.waitId];
    invariant(task?.status === "waiting_for_children", event, `wait ${event.data.waitId} has no waiting parent`);
    invariant(call?.tool === "task_reports_wait" && call.executionId === event.data.executionId && call.taskId === task.id, event, `wait ${event.data.waitId} has no matching tool call`);
    invariant(!next.reportWaits[event.data.waitId], event, `wait ${event.data.waitId} is duplicated`);
    next.reportWaits[event.data.waitId] = {
      id: event.data.waitId,
      executionId: event.data.executionId,
      parentTaskId: task.id,
      status: "waiting",
      result: null,
      failure: null,
      children: [],
    };
    return true;
  }

  if (event.type === "reports.wait_returned") {
    invariant(event.producer.kind === "launcher", event, "report wait results must come from the launcher");
    const wait = next.reportWaits[event.data.waitId];
    invariant(wait?.status === "waiting", event, `wait ${event.data.waitId} is not active`);
    const parent = next.tasks[wait.parentTaskId];
    invariant(parent?.status === "waiting_for_children", event, `wait ${event.data.waitId} parent is not waiting`);
    for (const childIdentity of event.data.children) {
      const child = next.tasks[childIdentity.taskId];
      const report = childIdentity.reportId ? next.reports[childIdentity.reportId] : null;
      invariant(child?.parentTaskId === parent.id, event, `wait ${wait.id} returned a non-child task`);
      invariant(child.status === childIdentity.status, event, `wait ${wait.id} changed child terminal state`);
      invariant(
        (report === null && childIdentity.artifactIds.length === 0) ||
          (report?.taskId === child.id && JSON.stringify(report.outputArtifactIds) === JSON.stringify(childIdentity.artifactIds)),
        event,
        `wait ${wait.id} changed report or artifact identities`,
      );
      invariant(child.terminalReason === (childIdentity.failure?.reason ?? null), event, `wait ${wait.id} changed child failure reason`);
    }
    wait.status = "returned";
    wait.result = event.data.result;
    wait.failure = event.data.failure;
    wait.children = structuredClone(event.data.children);
    return true;
  }

  if (event.type === "orchestrator.decision_recorded") {
    invariant(event.producer.kind === "launcher", event, "orchestrator decisions must come from the launcher");
    const decision = event.data.decision;
    const execution = next.executions[decision.executionId];
    invariant(execution?.status === "active" && execution.taskId === decision.taskId, event, `orchestrator decision has no active executor`);
    invariant(!next.orchestratorDecisions[decision.executionId], event, `execution ${decision.executionId} decided twice`);
    const calls = Object.values(next.orchestratorToolCalls).filter((call) => call.executionId === execution.id);
    invariant((decision.outcome === "no_request") === (calls.filter((call) => call.tool === "task_spawn_request").length === 0), event, `orchestrator decision ${decision.outcome} disagrees with its spawn calls`);
    next.orchestratorDecisions[decision.executionId] = decision;
    return true;
  }

  if (event.type === "runtime.interrupted") {
    invariant(event.producer.kind === "recovery_host", event, "runtime interruption evidence must come from recovery");
    for (const executionId of event.data.executionIds) {
      const execution = next.executions[executionId];
      invariant(execution?.status === "active", event, `interrupted execution ${executionId} is not active`);
      execution.status = "interrupted";
    }
    for (const taskId of event.data.taskIds) {
      const task = next.tasks[taskId];
      invariant(task && TRANSITIONS[task.status].includes("interrupted"), event, `task ${taskId} cannot be interrupted`);
      task.status = "interrupted";
      task.terminalReason = event.data.reason;
      if (task.ownerAgentId) next.agents[task.ownerAgentId].status = "retired";
    }
    return true;
  }

  if (event.type === "agent.registered") {
    invariant(event.producer.kind === "registry", event, "agent registration must come from the registry");
    const agent = event.data.agent;
    const task = next.tasks[agent.taskId];
    const launch = next.taskLaunches[agent.taskId];
    invariant(task, event, `agent ${agent.id} references unknown task ${agent.taskId}`);
    invariant(task.assignedAgentId === agent.id && task.ownerAgentId === null, event, `task ${task.id} cannot register agent ${agent.id}`);
    invariant(!next.agents[agent.id], event, `agent ${agent.id} is duplicated`);
    invariant(launch?.agentId === agent.id, event, `agent ${agent.id} has no durable task launch claim`);
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
    const requiresReason = event.data.status === "failed" || event.data.status === "withheld" || event.data.status === "interrupted";
    invariant(requiresReason ? Boolean(event.data.reason?.trim()) : event.data.reason === null, event, `task ${task.id} transition reason is inconsistent`);
    const activeOperation = taskHasActiveCapability(next, task.id);
    invariant(
      !activeOperation || event.data.status === "working",
      event,
      `task ${task.id} has an active capability operation`,
    );
    const activeExecution = Object.values(next.executions).some(
      (execution) => execution.taskId === task.id && execution.status === "active",
    );
    invariant(!activeExecution || event.data.status === "working" || event.data.status === "waiting_for_children", event, `task ${task.id} has an active executor`);
    task.status = event.data.status;
    task.terminalReason = event.data.reason;
    const agent = next.agents[event.data.agentId];
    if (event.data.status === "working" || event.data.status === "waiting_for_children") agent.status = "working";
    else if (event.data.status === "reported") agent.status = "reporting";
    else agent.status = "retired";
    return true;
  }

  return false;
}
