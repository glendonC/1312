import type {
  CapabilityGrant,
  MediaScope,
  RuntimeArtifact,
  RuntimeBudget,
  RuntimeContractFixture,
  SpawnRejection,
  SpawnRequestedEvent,
  TaskDefinition,
  TaskStatus,
} from "./contracts";

function invariant(condition: unknown, fixture: RuntimeContractFixture, message: string): asserts condition {
  if (!condition) throw new Error(`Runtime contract fixture ${fixture.id}: ${message}`);
}

function validBudget(budget: RuntimeBudget): boolean {
  return (
    Number.isInteger(budget.wallMs) &&
    budget.wallMs > 0 &&
    Number.isInteger(budget.toolCalls) &&
    budget.toolCalls > 0 &&
    Number.isInteger(budget.tokens) &&
    budget.tokens > 0
  );
}

function sumBudget(tasks: Iterable<TaskDefinition>): RuntimeBudget {
  const total = { wallMs: 0, toolCalls: 0, tokens: 0 };
  for (const task of tasks) {
    total.wallMs += task.budget.wallMs;
    total.toolCalls += task.budget.toolCalls;
    total.tokens += task.budget.tokens;
  }
  return total;
}

function active(status: TaskStatus): boolean {
  return status === "scheduled" || status === "working" || status === "reported";
}

function scopeContains(parent: MediaScope, child: MediaScope): boolean {
  return (
    parent.artifactId === child.artifactId &&
    (parent.trackId === null || parent.trackId === child.trackId) &&
    child.range[0] >= parent.range[0] &&
    child.range[1] <= parent.range[1]
  );
}

function validScope(scope: MediaScope): boolean {
  return (
    scope.artifactId.length > 0 &&
    Number.isFinite(scope.range[0]) &&
    Number.isFinite(scope.range[1]) &&
    scope.range[0] >= 0 &&
    scope.range[1] > scope.range[0]
  );
}

function sameGrants(left: CapabilityGrant[], right: CapabilityGrant[]): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function validateTask(fixture: RuntimeContractFixture, task: TaskDefinition): void {
  invariant(task.id.length > 0, fixture, "task id is required");
  invariant(task.runId.length > 0, fixture, `${task.id} runId is required`);
  invariant(task.dedupeKey.length > 0, fixture, `${task.id} dedupeKey is required`);
  invariant(task.objective.trim().length > 0, fixture, `${task.id} objective is required`);
  invariant(Number.isInteger(task.depth) && task.depth >= 0, fixture, `${task.id} depth must be a non-negative integer`);
  invariant(validBudget(task.budget), fixture, `${task.id} budget must be finite positive integers`);
  invariant(task.mediaScope.every(validScope), fixture, `${task.id} has an invalid media scope`);
  invariant(new Set(task.requiredCapabilities).size === task.requiredCapabilities.length, fixture, `${task.id} repeats a capability`);
  invariant(new Set(task.dependencies).size === task.dependencies.length, fixture, `${task.id} repeats a dependency`);
  invariant(new Set(task.requiredOutputs.map((output) => output.name)).size === task.requiredOutputs.length, fixture, `${task.id} repeats an output name`);
}

function spawnViolation(
  fixture: RuntimeContractFixture,
  request: SpawnRequestedEvent,
  tasks: Map<string, TaskDefinition>,
): SpawnRejection | null {
  const task = request.task;
  const parent = tasks.get(request.requestedByTaskId);
  if (!parent || parent.ownerAgentId !== request.requestedByAgentId || task.ownerAgentId !== null) {
    return "duplicate_owner";
  }
  if (task.parentTaskId !== parent.id || task.parentAgentId !== parent.ownerAgentId || task.depth !== parent.depth + 1) {
    return "max_depth";
  }
  if (task.depth > fixture.limits.maxDepth) return "max_depth";
  if (
    !task.mediaScope.every((scope) => parent.mediaScope.some((allowed) => scopeContains(allowed, scope))) ||
    !task.inputArtifacts.every((artifactId) => parent.inputArtifacts.includes(artifactId)) ||
    !task.dependencies.every((dependency) => tasks.has(dependency))
  ) {
    return "least_privilege";
  }
  if (task.requiredOutputs.length === 0 || !task.requiredOutputs.some((output) => output.required)) {
    return "missing_output_contract";
  }
  const activeWorkers = [...tasks.values()].filter((candidate) => active(candidate.status)).length;
  if (activeWorkers >= fixture.limits.maxActiveWorkers) return "max_active_workers";
  if ([...tasks.values()].some((candidate) => active(candidate.status) && candidate.dedupeKey === task.dedupeKey)) {
    return "duplicate_owner";
  }
  const allocated = sumBudget(tasks.values());
  if (
    allocated.wallMs + task.budget.wallMs > fixture.limits.runBudget.wallMs ||
    allocated.toolCalls + task.budget.toolCalls > fixture.limits.runBudget.toolCalls ||
    allocated.tokens + task.budget.tokens > fixture.limits.runBudget.tokens
  ) {
    return "run_budget";
  }
  return null;
}

function validateGrants(
  fixture: RuntimeContractFixture,
  task: TaskDefinition,
  grants: CapabilityGrant[],
): void {
  invariant(grants.length === task.requiredCapabilities.length, fixture, `${task.id} grant count is not least privilege`);
  invariant(new Set(grants.map((grant) => grant.capability)).size === grants.length, fixture, `${task.id} repeats a grant`);
  for (const grant of grants) {
    invariant(task.requiredCapabilities.includes(grant.capability), fixture, `${task.id} was granted unrequested ${grant.capability}`);
    invariant(grant.mediaScope.every(validScope), fixture, `${task.id} has an invalid grant scope`);
    invariant(
      grant.mediaScope.every((scope) => task.mediaScope.some((allowed) => scopeContains(allowed, scope))),
      fixture,
      `${task.id} grant exceeds its media scope`,
    );
    if (grant.capability.startsWith("media.")) {
      invariant(grant.mediaScope.length > 0, fixture, `${task.id} media grant ${grant.capability} has no scope`);
    } else {
      invariant(grant.mediaScope.length === 0, fixture, `${task.id} non-media grant ${grant.capability} carries media scope`);
    }
  }
}

function validateArtifact(
  fixture: RuntimeContractFixture,
  artifact: RuntimeArtifact,
  tasks: Map<string, TaskDefinition>,
  artifacts: Map<string, RuntimeArtifact>,
): void {
  const task = tasks.get(artifact.producerTaskId);
  invariant(task, fixture, `${artifact.id} references an unknown producer task`);
  invariant(task.ownerAgentId === artifact.producerAgentId, fixture, `${artifact.id} producer does not own its task`);
  invariant(artifact.id.length > 0 && artifact.kind.length > 0 && artifact.receiptId.length > 0, fixture, "artifact identity and receipt are required");
  invariant(!artifacts.has(artifact.id), fixture, `artifact ${artifact.id} is duplicated`);
  if (artifact.mediaClass === "derived") {
    invariant(artifact.sourceArtifactIds.length > 0, fixture, `${artifact.id} derived media has no lineage`);
  }
  for (const sourceId of artifact.sourceArtifactIds) {
    invariant(artifacts.has(sourceId), fixture, `${artifact.id} references missing source artifact ${sourceId}`);
    invariant(
      task.inputArtifacts.includes(sourceId) || artifacts.get(sourceId)?.producerTaskId === task.id,
      fixture,
      `${artifact.id} uses an artifact outside its task inputs`,
    );
  }
}

const TASK_TRANSITIONS: Record<TaskStatus, readonly TaskStatus[]> = {
  defined: ["scheduled", "failed", "withheld"],
  scheduled: ["working", "failed", "withheld"],
  working: ["reported", "completed", "failed", "withheld"],
  reported: ["completed", "failed", "withheld"],
  completed: [],
  failed: [],
  withheld: [],
};

/** Validate an exact fixture without registering it as replay or live product evidence. */
export function validateRuntimeContractFixture(fixture: RuntimeContractFixture): void {
  invariant(fixture.fixtureOnly === true, fixture, "must be marked fixtureOnly");
  invariant(fixture.note.includes("not runtime evidence"), fixture, "must disclaim runtime evidence");
  invariant(Number.isInteger(fixture.limits.maxDepth) && fixture.limits.maxDepth >= 0, fixture, "maxDepth is invalid");
  invariant(Number.isInteger(fixture.limits.maxActiveWorkers) && fixture.limits.maxActiveWorkers > 0, fixture, "maxActiveWorkers is invalid");
  invariant(validBudget(fixture.limits.runBudget), fixture, "run budget is invalid");

  const tasks = new Map<string, TaskDefinition>();
  for (const task of fixture.seedTasks) {
    validateTask(fixture, task);
    invariant(!tasks.has(task.id), fixture, `seed task ${task.id} is duplicated`);
    tasks.set(task.id, structuredClone(task));
  }
  const artifacts = new Map<string, RuntimeArtifact>();
  for (const artifact of fixture.seedArtifacts) {
    validateArtifact(fixture, artifact, tasks, artifacts);
    artifacts.set(artifact.id, artifact);
  }

  const requests = new Map<string, SpawnRequestedEvent>();
  const decisions = new Map<string, boolean>();
  const acceptedGrants = new Map<string, CapabilityGrant[]>();
  const registeredTasks = new Set<string>();
  const reports = new Map<string, { parentTaskId: string; parentAgentId: string }>();
  const decidedReports = new Set<string>();
  const controls = new Set<string>();
  const acknowledgedControls = new Set<string>();
  const proposals = new Set<string>();
  const decidedProposals = new Set<string>();

  fixture.events.forEach((event, index) => {
    invariant(event.fixtureOnly === true, fixture, `event ${index + 1} is not fixture-only`);
    invariant(event.seq === index + 1, fixture, `event sequence expected ${index + 1}, received ${event.seq}`);

    if (event.type === "spawn_requested") {
      validateTask(fixture, event.task);
      invariant(
        tasks.get(event.requestedByTaskId)?.requiredCapabilities.includes("task.spawn.request"),
        fixture,
        `task ${event.requestedByTaskId} cannot request children`,
      );
      invariant(!requests.has(event.requestId), fixture, `spawn request ${event.requestId} is duplicated`);
      invariant(!tasks.has(event.task.id), fixture, `spawn task ${event.task.id} already exists`);
      requests.set(event.requestId, event);
      return;
    }

    if (event.type === "spawn_decided") {
      const request = requests.get(event.requestId);
      invariant(request, fixture, `spawn decision ${event.requestId} has no request`);
      invariant(!decisions.has(event.requestId), fixture, `spawn request ${event.requestId} was decided twice`);
      const violation = spawnViolation(fixture, request, tasks);
      if (event.accepted) {
        invariant(violation === null, fixture, `scheduler accepted ${event.requestId} despite ${violation}`);
        invariant(event.rejection === null, fixture, `accepted spawn ${event.requestId} has a rejection`);
        validateGrants(fixture, request.task, event.grants);
        tasks.set(request.task.id, { ...structuredClone(request.task), status: "scheduled" });
        acceptedGrants.set(request.task.id, event.grants);
      } else {
        invariant(event.rejection === violation, fixture, `spawn ${event.requestId} rejection does not match ${violation}`);
        invariant(event.grants.length === 0, fixture, `rejected spawn ${event.requestId} received grants`);
      }
      decisions.set(event.requestId, event.accepted);
      return;
    }

    if (event.type === "agent_registered") {
      const task = tasks.get(event.taskId);
      invariant(task, fixture, `agent ${event.agentId} references unknown task ${event.taskId}`);
      invariant(task.status === "scheduled" && task.ownerAgentId === null, fixture, `task ${event.taskId} cannot register an owner`);
      invariant(task.parentTaskId === event.parentTaskId && task.parentAgentId === event.parentAgentId, fixture, `agent ${event.agentId} parentage changed`);
      const grants = acceptedGrants.get(task.id);
      invariant(grants && sameGrants(grants, event.grants), fixture, `agent ${event.agentId} grants differ from scheduler decision`);
      task.ownerAgentId = event.agentId;
      registeredTasks.add(task.id);
      return;
    }

    if (event.type === "task_transition") {
      const task = tasks.get(event.taskId);
      invariant(task, fixture, `task transition references unknown ${event.taskId}`);
      invariant(task.ownerAgentId === event.agentId, fixture, `task ${event.taskId} transition came from another agent`);
      invariant(TASK_TRANSITIONS[task.status].includes(event.status), fixture, `illegal task transition ${task.status} -> ${event.status}`);
      task.status = event.status;
      return;
    }

    if (event.type === "artifact_recorded") {
      invariant(
        tasks.get(event.artifact.producerTaskId)?.requiredCapabilities.includes("artifact.write"),
        fixture,
        `task ${event.artifact.producerTaskId} cannot write artifacts`,
      );
      validateArtifact(fixture, event.artifact, tasks, artifacts);
      artifacts.set(event.artifact.id, event.artifact);
      return;
    }

    if (event.type === "report_submitted") {
      const task = tasks.get(event.taskId);
      invariant(task, fixture, `report ${event.reportId} references unknown task`);
      invariant(task.ownerAgentId === event.agentId && task.status === "working", fixture, `report ${event.reportId} has no working owner`);
      invariant(task.requiredCapabilities.includes("report.submit"), fixture, `task ${event.taskId} cannot submit reports`);
      invariant(task.parentTaskId === event.parentTaskId && task.parentAgentId === event.parentAgentId, fixture, `report ${event.reportId} parentage changed`);
      invariant(event.summary.trim().length > 0, fixture, `report ${event.reportId} has no summary`);
      invariant(event.outputArtifactIds.every((id) => artifacts.has(id)), fixture, `report ${event.reportId} references missing output`);
      invariant(
        event.outputArtifactIds.every((id) => artifacts.get(id)?.producerTaskId === task.id),
        fixture,
        `report ${event.reportId} includes output owned by another task`,
      );
      for (const output of task.requiredOutputs.filter((candidate) => candidate.required)) {
        invariant(
          event.outputArtifactIds.some((id) => artifacts.get(id)?.kind === output.artifactKind),
          fixture,
          `report ${event.reportId} did not satisfy ${output.name}`,
        );
      }
      invariant(!reports.has(event.reportId), fixture, `report ${event.reportId} is duplicated`);
      reports.set(event.reportId, { parentTaskId: event.parentTaskId, parentAgentId: event.parentAgentId });
      return;
    }

    if (event.type === "report_decided") {
      const report = reports.get(event.reportId);
      invariant(report, fixture, `report decision ${event.reportId} has no report`);
      invariant(report.parentTaskId === event.decidedByTaskId && report.parentAgentId === event.decidedByAgentId, fixture, `report ${event.reportId} was decided outside its parent`);
      invariant(event.reason.trim().length > 0, fixture, `report ${event.reportId} decision has no reason`);
      invariant(!decidedReports.has(event.reportId), fixture, `report ${event.reportId} was decided twice`);
      decidedReports.add(event.reportId);
      return;
    }

    if (event.type === "control_requested") {
      invariant(!controls.has(event.requestId), fixture, `control ${event.requestId} is duplicated`);
      controls.add(event.requestId);
      return;
    }

    if (event.type === "control_acknowledged") {
      invariant(controls.has(event.requestId), fixture, `control acknowledgement ${event.requestId} has no request`);
      invariant(!acknowledgedControls.has(event.requestId), fixture, `control ${event.requestId} was acknowledged twice`);
      invariant(event.reason.trim().length > 0, fixture, `control ${event.requestId} acknowledgement has no reason`);
      acknowledgedControls.add(event.requestId);
      return;
    }

    if (event.type === "memory_proposed") {
      const task = tasks.get(event.taskId);
      invariant(task?.ownerAgentId === event.agentId, fixture, `memory proposal ${event.proposalId} has no task owner`);
      invariant(task.requiredCapabilities.includes("memory.propose"), fixture, `task ${event.taskId} cannot propose memory`);
      invariant(event.evidenceArtifactIds.length > 0, fixture, `memory proposal ${event.proposalId} has no evidence`);
      invariant(event.evidenceArtifactIds.every((id) => artifacts.has(id)), fixture, `memory proposal ${event.proposalId} references missing evidence`);
      invariant(!proposals.has(event.proposalId), fixture, `memory proposal ${event.proposalId} is duplicated`);
      proposals.add(event.proposalId);
      return;
    }

    invariant(event.type === "memory_decided", fixture, "unknown runtime contract event");
    invariant(proposals.has(event.proposalId), fixture, `memory decision ${event.proposalId} has no proposal`);
    invariant(!decidedProposals.has(event.proposalId), fixture, `memory proposal ${event.proposalId} was decided twice`);
    invariant(event.reason.trim().length > 0, fixture, `memory decision ${event.proposalId} has no reason`);
    decidedProposals.add(event.proposalId);
  });

  for (const [requestId, accepted] of decisions) {
    if (!accepted) continue;
    const taskId = requests.get(requestId)?.task.id;
    invariant(taskId && registeredTasks.has(taskId), fixture, `accepted spawn ${requestId} was never registered`);
  }
  invariant(controls.size === acknowledgedControls.size, fixture, "a live control request lacks acknowledgement");
  invariant(reports.size === decidedReports.size, fixture, "a report lacks a parent decision");
  invariant(proposals.size === decidedProposals.size, fixture, "a memory proposal lacks a gate decision");
}
