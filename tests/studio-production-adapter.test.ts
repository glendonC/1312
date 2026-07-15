import assert from "node:assert/strict";
import test from "node:test";

import {
  ProductionStudioAdapter,
  projectProductionRuntimeJournal,
} from "../src/studio/runtime/production/studioProjection.ts";
import type { RuntimeProducerKind } from "../src/studio/runtime/production/protocol.ts";

const RUN_ID = "runtime:production-adapter-test";
const ROOT_TASK_ID = "task:root";
const ROOT_AGENT_ID = "agent:root";
const CHILD_TASK_ID = "task:child";
const CHILD_AGENT_ID = "agent:child";
const REPORT_GRANT_ID = "grant:report-child";
const OUTPUT_ARTIFACT_ID = "artifact:worker-output";

function event(
  seq: number,
  producerKind: RuntimeProducerKind,
  type: string,
  data: Record<string, unknown>,
): unknown {
  return {
    schema: "studio.runtime.event.v1",
    runId: RUN_ID,
    seq,
    eventId: `event:${RUN_ID}:${seq}`,
    recordedAt: `2026-07-15T12:00:${String(seq).padStart(2, "0")}.000Z`,
    producer: { kind: producerKind, id: `${producerKind}:test` },
    causationId: null,
    correlationId: null,
    type,
    data,
  };
}

const ROOT_GRANT = {
  id: "grant:spawn-root",
  capability: "task.spawn.request",
  taskId: ROOT_TASK_ID,
  agentId: ROOT_AGENT_ID,
  mediaScope: [],
};

const REPORT_GRANT = {
  id: REPORT_GRANT_ID,
  capability: "report.submit",
  taskId: CHILD_TASK_ID,
  agentId: CHILD_AGENT_ID,
  mediaScope: [],
};

const CHILD_INPUT = {
  workloadKey: "bounded-child",
  objective: "Return one bounded acknowledgement without making a media claim.",
  workerKind: "analysis",
  workerLabel: "bounded acknowledgement worker",
  mediaScope: [],
  inputArtifactIds: [],
  requiredOutputs: [{ name: "acknowledgement", artifactKind: "worker-ack", required: true }],
  requiredCapabilities: ["report.submit"],
  dependencies: [],
  budget: { wallMs: 1_000, toolCalls: 1 },
};

function productionJournal(): unknown[] {
  const startedAt = "2026-07-15T12:00:09.000Z";
  const digest = "a".repeat(64);
  return [
    event(1, "scheduler", "task.created", {
      task: {
        id: ROOT_TASK_ID,
        runId: RUN_ID,
        workloadKey: "root-proof",
        objective: "Coordinate the bounded local proof.",
        workerKind: "orchestrator",
        workerLabel: "local proof orchestrator",
        parentTaskId: null,
        parentAgentId: null,
        depth: 0,
        assignedAgentId: ROOT_AGENT_ID,
        ownerAgentId: null,
        mediaScope: [],
        inputArtifactIds: [],
        requiredOutputs: [],
        dependencies: [],
        budget: { wallMs: 2_000, toolCalls: 2 },
        grants: [ROOT_GRANT],
        status: "scheduled",
      },
    }),
    event(2, "registry", "agent.registered", {
      agent: {
        id: ROOT_AGENT_ID,
        taskId: ROOT_TASK_ID,
        parentTaskId: null,
        parentAgentId: null,
        kind: "orchestrator",
        label: "local proof orchestrator",
        grants: [ROOT_GRANT],
        status: "registered",
      },
    }),
    event(3, "scheduler", "task.transitioned", {
      taskId: ROOT_TASK_ID,
      agentId: ROOT_AGENT_ID,
      status: "working",
      reason: null,
    }),
    event(4, "scheduler", "spawn.requested", {
      requestId: "request:child",
      requestedByTaskId: ROOT_TASK_ID,
      requestedByAgentId: ROOT_AGENT_ID,
      input: CHILD_INPUT,
    }),
    event(5, "scheduler", "spawn.decided", {
      requestId: "request:child",
      accepted: true,
      rejection: null,
      taskId: CHILD_TASK_ID,
      agentId: CHILD_AGENT_ID,
      grants: [REPORT_GRANT],
    }),
    event(6, "scheduler", "task.created", {
      task: {
        id: CHILD_TASK_ID,
        runId: RUN_ID,
        workloadKey: CHILD_INPUT.workloadKey,
        objective: CHILD_INPUT.objective,
        workerKind: CHILD_INPUT.workerKind,
        workerLabel: CHILD_INPUT.workerLabel,
        parentTaskId: ROOT_TASK_ID,
        parentAgentId: ROOT_AGENT_ID,
        depth: 1,
        assignedAgentId: CHILD_AGENT_ID,
        ownerAgentId: null,
        mediaScope: [],
        inputArtifactIds: [],
        requiredOutputs: CHILD_INPUT.requiredOutputs,
        dependencies: [],
        budget: CHILD_INPUT.budget,
        grants: [REPORT_GRANT],
        status: "scheduled",
      },
    }),
    event(7, "registry", "agent.registered", {
      agent: {
        id: CHILD_AGENT_ID,
        taskId: CHILD_TASK_ID,
        parentTaskId: ROOT_TASK_ID,
        parentAgentId: ROOT_AGENT_ID,
        kind: "analysis",
        label: CHILD_INPUT.workerLabel,
        grants: [REPORT_GRANT],
        status: "registered",
      },
    }),
    event(8, "scheduler", "task.transitioned", {
      taskId: CHILD_TASK_ID,
      agentId: CHILD_AGENT_ID,
      status: "working",
      reason: null,
    }),
    event(9, "launcher", "executor.started", {
      executionId: "execution:child",
      taskId: CHILD_TASK_ID,
      agentId: CHILD_AGENT_ID,
      startedAt,
    }),
    event(10, "artifact_store", "artifact.recorded", {
      artifact: {
        schema: "studio.runtime.artifact.v1",
        id: OUTPUT_ARTIFACT_ID,
        runId: RUN_ID,
        kind: "worker-ack",
        mediaClass: "non_media",
        publication: "private",
        content: {
          algorithm: "sha256",
          digest,
          contentId: `sha256:${digest}`,
          bytes: 1,
        },
        storageKey: `objects/sha256/aa/${digest}`,
        durationMs: null,
        tracks: [],
        sourceArtifactIds: [],
        producerTaskId: CHILD_TASK_ID,
        producerAgentId: CHILD_AGENT_ID,
        origin: {
          kind: "worker_output",
          executionId: "execution:child",
          receiptId: "span:child",
          receiptContentId: `sha256:${"b".repeat(64)}`,
        },
      },
    }),
    event(11, "launcher", "executor.finished", {
      receipt: {
        schema: "studio.executor-span.receipt.v1",
        receiptId: "span:child",
        executionId: "execution:child",
        taskId: CHILD_TASK_ID,
        agentId: CHILD_AGENT_ID,
        phase: "active",
        producer: {
          id: "studio.deterministic-test-executor",
          version: "1",
          sandbox: "read-only",
          ephemeral: true,
        },
        startedAt,
        endedAt: "2026-07-15T12:00:11.000Z",
        monotonicDurationMs: 0,
        outcome: "completed",
        process: { exitCode: 0, signal: null },
        outputArtifactIds: [OUTPUT_ARTIFACT_ID],
        modelUsageReceiptId: null,
        failure: null,
      },
    }),
    event(12, "handoff_host", "report.submitted", {
      report: {
        id: "report:child",
        taskId: CHILD_TASK_ID,
        agentId: CHILD_AGENT_ID,
        parentTaskId: ROOT_TASK_ID,
        parentAgentId: ROOT_AGENT_ID,
        outputArtifactIds: [OUTPUT_ARTIFACT_ID],
        summary: "The bounded acknowledgement artifact was receipted.",
        status: "submitted",
        decisionReason: null,
      },
    }),
    event(13, "handoff_host", "report.decided", {
      reportId: "report:child",
      decidedByTaskId: ROOT_TASK_ID,
      decidedByAgentId: ROOT_AGENT_ID,
      accepted: true,
      reason: "The required acknowledgement artifact is present.",
    }),
  ];
}

test("production adapter projects spawn and output lineage with existing facts outside legacy topology", () => {
  const projection = projectProductionRuntimeJournal(productionJournal());

  assert.deepEqual(projection.source, {
    kind: "production_runtime_journal",
    recordedDemo: false,
  });
  assert.equal(projection.lastSeq, 13);
  assert.deepEqual(projection.counts, {
    tasks: 2,
    workers: 2,
    grants: 2,
    executions: 1,
    reports: 1,
    spawnRequests: 1,
    outputArtifacts: 1,
  });
  assert.deepEqual(
    projection.tasks.map((task) => ({ id: task.taskId, owner: task.ownerAgentId, status: task.status })),
    [
      { id: ROOT_TASK_ID, owner: ROOT_AGENT_ID, status: "working" },
      { id: CHILD_TASK_ID, owner: CHILD_AGENT_ID, status: "completed" },
    ],
  );
  assert.deepEqual(
    projection.workers.map((worker) => ({ id: worker.agentId, taskId: worker.taskId, status: worker.status })),
    [
      { id: ROOT_AGENT_ID, taskId: ROOT_TASK_ID, status: "working" },
      { id: CHILD_AGENT_ID, taskId: CHILD_TASK_ID, status: "retired" },
    ],
  );
  assert.deepEqual(
    projection.grants.find((grant) => grant.grantId === REPORT_GRANT_ID),
    {
      grantId: REPORT_GRANT_ID,
      taskId: CHILD_TASK_ID,
      agentId: CHILD_AGENT_ID,
      capability: "report.submit",
      mediaScope: [],
    },
  );
  assert.deepEqual(projection.reports, [{
    reportId: "report:child",
    taskId: CHILD_TASK_ID,
    agentId: CHILD_AGENT_ID,
    parentTaskId: ROOT_TASK_ID,
    parentAgentId: ROOT_AGENT_ID,
    outputArtifactIds: [OUTPUT_ARTIFACT_ID],
    summary: "The bounded acknowledgement artifact was receipted.",
    status: "accepted",
    decisionReason: "The required acknowledgement artifact is present.",
  }]);
  assert.deepEqual(projection.spawnRequests, [{
    requestId: "request:child",
    requestedByTaskId: ROOT_TASK_ID,
    requestedByAgentId: ROOT_AGENT_ID,
    workloadKey: CHILD_INPUT.workloadKey,
    objective: CHILD_INPUT.objective,
    workerKind: CHILD_INPUT.workerKind,
    workerLabel: CHILD_INPUT.workerLabel,
    mediaScope: [],
    inputArtifactIds: [],
    requiredOutputs: CHILD_INPUT.requiredOutputs,
    requiredCapabilities: ["report.submit"],
    dependencies: [],
    decision: "accepted",
    rejection: null,
    taskId: CHILD_TASK_ID,
    agentId: CHILD_AGENT_ID,
  }]);
  assert.deepEqual(projection.outputArtifacts, [{
    artifactId: OUTPUT_ARTIFACT_ID,
    kind: "worker-ack",
    mediaClass: "non_media",
    publication: "private",
    contentId: `sha256:${"a".repeat(64)}`,
    bytes: 1,
    durationMs: null,
    producerTaskId: CHILD_TASK_ID,
    producerAgentId: CHILD_AGENT_ID,
    sourceArtifactIds: [],
    origin: {
      kind: "worker_output",
      executionId: "execution:child",
      receiptId: "span:child",
      receiptContentId: `sha256:${"b".repeat(64)}`,
    },
    reportIds: ["report:child"],
  }]);
  assert.equal("agents" in projection, false);
  assert.equal("traces" in projection, false);
  assert.equal("bundle" in projection, false);
});

test("production adapter keeps pending and rejected spawn decisions explicit", () => {
  const journal = productionJournal();
  const adapter = new ProductionStudioAdapter(RUN_ID);
  const pending = adapter.appendBatch(journal.slice(0, 4));
  assert.equal(pending.spawnRequests[0].decision, "pending");
  assert.equal(pending.spawnRequests[0].rejection, null);
  assert.equal(pending.spawnRequests[0].taskId, null);
  assert.equal(pending.spawnRequests[0].agentId, null);

  const rejected = adapter.append(event(5, "scheduler", "spawn.decided", {
    requestId: "request:child",
    accepted: false,
    rejection: "max_active_workers",
    taskId: null,
    agentId: null,
    grants: [],
  }));
  assert.equal(rejected.spawnRequests[0].decision, "rejected");
  assert.equal(rejected.spawnRequests[0].rejection, "max_active_workers");
  assert.equal(rejected.spawnRequests[0].taskId, null);
  assert.equal(rejected.spawnRequests[0].agentId, null);
});

test("production adapter applies a poll batch atomically and keeps the last valid view on rejection", () => {
  const journal = productionJournal();
  const adapter = new ProductionStudioAdapter(RUN_ID);
  const accepted = adapter.appendBatch(journal.slice(0, 3));
  const malformed = structuredClone(journal[4]) as { seq: number; eventId: string };
  malformed.seq = 99;
  malformed.eventId = `event:${RUN_ID}:99`;

  assert.throws(
    () => adapter.appendBatch([journal[3], malformed]),
    /sequence expected 5, received 99/,
  );
  assert.deepEqual(adapter.view(), accepted);

  const duplicateGrantBatch = JSON.parse(
    JSON.stringify(journal.slice(3, 7)).replaceAll(REPORT_GRANT_ID, ROOT_GRANT.id),
  ) as unknown[];
  assert.throws(
    () => adapter.appendBatch(duplicateGrantBatch),
    /grant identities must be unique across tasks/,
  );
  assert.deepEqual(adapter.view(), accepted);
});
