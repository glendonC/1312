import assert from "node:assert/strict";
import test from "node:test";

import {
  ProductionStudioAdapter,
  projectProductionRuntimeJournal,
} from "../src/studio/runtime/production/studioProjection.ts";
import type { RuntimeProducerKind } from "../src/studio/runtime/production/protocol.ts";
import { canonicalSha256 } from "../src/studio/runtime/production/artifactStore.ts";
import type { TaskJobContext } from "../src/studio/runtime/production/model.ts";

const RUN_ID = "runtime:production-adapter-test";
const ROOT_TASK_ID = "task:root";
const ROOT_AGENT_ID = "agent:root";
const CHILD_TASK_ID = "task:child";
const CHILD_AGENT_ID = "agent:child";
const REPORT_GRANT_ID = "grant:report-child";
const OUTPUT_ARTIFACT_ID = "artifact:worker-output";
const SOURCE_ARTIFACT_ID = "artifact:operation-source";
const OPERATION_ID = "operation:authorized-extract";
const OPERATION_OUTPUT_ARTIFACT_ID = "artifact:operation-output";
const OPERATION_GRANT_ID = "grant:extract-root";

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
  evidenceScope: [],
  assessmentScope: null,
  decisionScope: null,
};

const REPORT_GRANT = {
  id: REPORT_GRANT_ID,
  capability: "report.submit",
  taskId: CHILD_TASK_ID,
  agentId: CHILD_AGENT_ID,
  mediaScope: [],
  evidenceScope: [],
  assessmentScope: null,
  decisionScope: null,
};

const CHILD_INPUT = {
  workloadKey: "bounded-child",
  objective: "Return one bounded acknowledgement without making a media claim.",
  workerKind: "analysis",
  workerLabel: "bounded acknowledgement worker",
  mediaScope: [],
  inputArtifactIds: [SOURCE_ARTIFACT_ID],
  requiredOutputs: [{ name: "acknowledgement", artifactKind: "worker-ack", required: true }],
  requiredCapabilities: ["report.submit"],
  dependencies: [],
  budget: { wallMs: 1_000, toolCalls: 1 },
};

function jobContext(contentId: string, range: { startMs: number; endMs: number }): TaskJobContext {
  const body = {
    source: { artifactId: SOURCE_ARTIFACT_ID, contentId },
    analysisRequest: {
      requestId: "analysis-request:production-adapter",
      requestedRange: { ...range },
      taskRange: { ...range },
      options: {
        speechScope: "foreground" as const,
        includeLyrics: false,
        speaker: null,
        honorifics: "preserve" as const,
        translationStyle: "natural" as const,
        captionDensity: "balanced" as const,
        slowAnalysis: false,
      },
    },
    requestedSourceLanguagePolicy: { mode: "unknown" as const, languages: [] as [], reason: null },
    targetLanguage: "en",
    selectedLanguagePackId: null,
    outputDepth: "evidence" as const,
    detectorEvidence: [],
  };
  return { schema: "studio.task-job-context.v1", contextId: `job-context:${canonicalSha256(body)}`, ...body };
}

function productionJournal(): unknown[] {
  const startedAt = "2026-07-15T12:00:09.000Z";
  const digest = "a".repeat(64);
  const sourceDigest = "f".repeat(64);
  const context = jobContext(`sha256:${sourceDigest}`, { startMs: 0, endMs: 1_000 });
  return [
    event(1, "artifact_store", "artifact.recorded", {
      artifact: {
        schema: "studio.runtime.artifact.v1",
        id: SOURCE_ARTIFACT_ID,
        runId: RUN_ID,
        kind: "owned-source",
        mediaClass: "raw",
        publication: "private",
        content: { algorithm: "sha256", digest: sourceDigest, contentId: `sha256:${sourceDigest}`, bytes: 1 },
        storageKey: `objects/sha256/ff/${sourceDigest}`,
        durationMs: 1_000,
        tracks: [{ id: "stream:0", index: 0, kind: "audio", codec: "pcm_s16le", durationMs: 1_000 }],
        sourceArtifactIds: [],
        producerTaskId: null,
        producerAgentId: null,
        origin: { kind: "ingest", adapterId: "owned-local-source-adapter.v1", sourceReceiptRef: "receipt:owned" },
      },
    }),
    event(2, "scheduler", "task.created", {
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
        jobContext: context,
        mediaScope: [],
        inputArtifactIds: [SOURCE_ARTIFACT_ID],
        requiredOutputs: [],
        dependencies: [],
        budget: { wallMs: 2_000, toolCalls: 2 },
        grants: [ROOT_GRANT],
        status: "scheduled",
        terminalReason: null,
      },
    }),
    event(3, "launcher", "task.launch_claimed", {
      claim: {
        id: `launch:${ROOT_TASK_ID}`,
        requestId: "root-task",
        taskId: ROOT_TASK_ID,
        agentId: ROOT_AGENT_ID,
        executorKind: "deterministic_test",
        claimedAt: "2026-07-15T12:00:03.000Z",
        executionId: null,
      },
    }),
    event(4, "registry", "agent.registered", {
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
    event(5, "scheduler", "task.transitioned", {
      taskId: ROOT_TASK_ID,
      agentId: ROOT_AGENT_ID,
      status: "working",
      reason: null,
    }),
    event(6, "scheduler", "spawn.requested", {
      requestId: "request:child",
      requestedByTaskId: ROOT_TASK_ID,
      requestedByAgentId: ROOT_AGENT_ID,
      authoredByExecutionId: null,
      toolCallId: null,
      input: CHILD_INPUT,
    }),
    event(7, "scheduler", "spawn.decided", {
      requestId: "request:child",
      accepted: true,
      rejection: null,
      taskId: CHILD_TASK_ID,
      agentId: CHILD_AGENT_ID,
      grants: [REPORT_GRANT],
    }),
    event(8, "scheduler", "task.created", {
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
        jobContext: context,
        mediaScope: [],
        inputArtifactIds: [],
        requiredOutputs: CHILD_INPUT.requiredOutputs,
        dependencies: [],
        budget: CHILD_INPUT.budget,
        grants: [REPORT_GRANT],
        status: "scheduled",
        terminalReason: null,
      },
    }),
    event(9, "launcher", "task.launch_claimed", {
      claim: {
        id: `launch:${CHILD_TASK_ID}`,
        requestId: "request:child",
        taskId: CHILD_TASK_ID,
        agentId: CHILD_AGENT_ID,
        executorKind: "deterministic_test",
        claimedAt: "2026-07-15T12:00:09.000Z",
        executionId: null,
      },
    }),
    event(10, "registry", "agent.registered", {
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
    event(11, "scheduler", "task.transitioned", {
      taskId: CHILD_TASK_ID,
      agentId: CHILD_AGENT_ID,
      status: "working",
      reason: null,
    }),
    event(12, "launcher", "executor.started", {
      executionId: "execution:child",
      taskId: CHILD_TASK_ID,
      agentId: CHILD_AGENT_ID,
      launchClaimId: `launch:${CHILD_TASK_ID}`,
      startedAt,
    }),
    event(13, "artifact_store", "artifact.recorded", {
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
    event(14, "launcher", "executor.finished", {
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
    event(15, "handoff_host", "report.submitted", {
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
    event(16, "handoff_host", "report.decided", {
      reportId: "report:child",
      decidedByTaskId: ROOT_TASK_ID,
      decidedByAgentId: ROOT_AGENT_ID,
      accepted: true,
      reason: "The required acknowledgement artifact is present.",
    }),
  ];
}

function operationJournal(): unknown[] {
  const sourceDigest = "c".repeat(64);
  const outputDigest = "d".repeat(64);
  const receiptContentDigest = "e".repeat(64);
  const scope = [{ artifactId: SOURCE_ARTIFACT_ID, trackId: "stream:0", startMs: 1_000, endMs: 2_000 }];
  const context = jobContext(`sha256:${sourceDigest}`, { startMs: 1_000, endMs: 2_000 });
  const extractGrant = {
    id: OPERATION_GRANT_ID,
    capability: "media.extract",
    taskId: ROOT_TASK_ID,
    agentId: ROOT_AGENT_ID,
    mediaScope: scope,
    evidenceScope: [],
    assessmentScope: null,
    decisionScope: null,
  };
  return [
    event(1, "artifact_store", "artifact.recorded", {
      artifact: {
        schema: "studio.runtime.artifact.v1",
        id: SOURCE_ARTIFACT_ID,
        runId: RUN_ID,
        kind: "owned-source",
        mediaClass: "raw",
        publication: "private",
        content: {
          algorithm: "sha256",
          digest: sourceDigest,
          contentId: `sha256:${sourceDigest}`,
          bytes: 1_000,
        },
        storageKey: `objects/sha256/cc/${sourceDigest}`,
        durationMs: 5_000,
        tracks: [{ id: "stream:0", index: 0, kind: "audio", codec: "pcm_s16le", durationMs: 5_000 }],
        sourceArtifactIds: [],
        producerTaskId: null,
        producerAgentId: null,
        origin: {
          kind: "ingest",
          adapterId: "owned-local-source-adapter.v1",
          sourceReceiptRef: "receipt:owned-source",
        },
      },
    }),
    event(2, "scheduler", "task.created", {
      task: {
        id: ROOT_TASK_ID,
        runId: RUN_ID,
        workloadKey: "root-operation-proof",
        objective: "Exercise one already-authorized media operation.",
        workerKind: "media",
        workerLabel: "operation proof worker",
        parentTaskId: null,
        parentAgentId: null,
        depth: 0,
        assignedAgentId: ROOT_AGENT_ID,
        ownerAgentId: null,
        jobContext: context,
        mediaScope: scope,
        inputArtifactIds: [SOURCE_ARTIFACT_ID],
        requiredOutputs: [{ name: "audio range", artifactKind: "media-range-audio", required: true }],
        dependencies: [],
        budget: { wallMs: 2_000, toolCalls: 1 },
        grants: [extractGrant],
        status: "scheduled",
        terminalReason: null,
      },
    }),
    event(3, "launcher", "task.launch_claimed", {
      claim: {
        id: `launch:${ROOT_TASK_ID}`,
        requestId: "root-task",
        taskId: ROOT_TASK_ID,
        agentId: ROOT_AGENT_ID,
        executorKind: "deterministic_test",
        claimedAt: "2026-07-15T12:00:03.000Z",
        executionId: null,
      },
    }),
    event(4, "registry", "agent.registered", {
      agent: {
        id: ROOT_AGENT_ID,
        taskId: ROOT_TASK_ID,
        parentTaskId: null,
        parentAgentId: null,
        kind: "media",
        label: "operation proof worker",
        grants: [extractGrant],
        status: "registered",
      },
    }),
    event(5, "scheduler", "task.transitioned", {
      taskId: ROOT_TASK_ID,
      agentId: ROOT_AGENT_ID,
      status: "working",
      reason: null,
    }),
    event(6, "media_host", "media.operation_started", {
      capability: "media.extract",
      request: {
        operationId: OPERATION_ID,
        taskId: ROOT_TASK_ID,
        agentId: ROOT_AGENT_ID,
        artifactId: SOURCE_ARTIFACT_ID,
        trackId: "stream:0",
        startMs: 1_000,
        endMs: 2_000,
      },
      grantId: OPERATION_GRANT_ID,
    }),
    event(7, "artifact_store", "artifact.recorded", {
      artifact: {
        schema: "studio.runtime.artifact.v1",
        id: OPERATION_OUTPUT_ARTIFACT_ID,
        runId: RUN_ID,
        kind: "media-range-audio",
        mediaClass: "derived",
        publication: "private",
        content: {
          algorithm: "sha256",
          digest: outputDigest,
          contentId: `sha256:${outputDigest}`,
          bytes: 100,
        },
        storageKey: `objects/sha256/dd/${outputDigest}`,
        durationMs: 1_000,
        tracks: [{ id: "stream:0", index: 0, kind: "audio", codec: "pcm_s16le", durationMs: 1_000 }],
        sourceArtifactIds: [SOURCE_ARTIFACT_ID],
        producerTaskId: ROOT_TASK_ID,
        producerAgentId: ROOT_AGENT_ID,
        origin: {
          kind: "media_operation",
          operationId: OPERATION_ID,
          receiptId: "receipt:authorized-extract",
          receiptContentId: `sha256:${receiptContentDigest}`,
        },
      },
    }),
    event(8, "media_host", "media.operation_completed", {
      operationId: OPERATION_ID,
      outputArtifactId: OPERATION_OUTPUT_ARTIFACT_ID,
      receipt: {
        schema: "studio.media-operation.receipt.v1",
        receiptId: "receipt:authorized-extract",
        operationId: OPERATION_ID,
        capability: "media.extract",
        authorization: { grantId: OPERATION_GRANT_ID, taskId: ROOT_TASK_ID, agentId: ROOT_AGENT_ID },
        request: {
          artifactId: SOURCE_ARTIFACT_ID,
          trackId: "stream:0",
          startMs: 1_000,
          endMs: 2_000,
        },
        producer: { id: "ffmpeg.audio-range-extract", version: "test" },
        input: { artifactId: SOURCE_ARTIFACT_ID, contentId: `sha256:${sourceDigest}` },
        output: {
          artifactId: OPERATION_OUTPUT_ARTIFACT_ID,
          contentId: `sha256:${outputDigest}`,
          bytes: 100,
          durationMs: 1_000,
          trackId: "stream:0",
        },
        sourceArtifactIds: [SOURCE_ARTIFACT_ID],
      },
    }),
  ];
}

test("production adapter projects spawn and output lineage with existing facts outside legacy topology", () => {
  const projection = projectProductionRuntimeJournal(productionJournal());

  assert.deepEqual(projection.source, {
    kind: "production_runtime_journal",
    recordedDemo: false,
  });
  assert.equal(projection.lastSeq, 16);
  assert.deepEqual(projection.counts, {
    tasks: 2,
    workers: 2,
    grants: 2,
    executions: 1,
    reports: 1,
    spawnRequests: 1,
    taskLaunches: 2,
    reportWaits: 0,
    orchestratorDecisions: 0,
    rootOutputDispositions: 0,
    operations: 0,
    semanticEvidence: 0,
    evidenceReads: 0,
    evidenceAssessments: 0,
    evidenceDecisions: 0,
    publishReviewIntakes: 0,
    publishReviewDecisions: 0,
    publishReviewRevocations: 0,
    captionProductions: 0,
    captionQualityControls: 0,
    sourceArtifacts: 1,
    evidenceArtifacts: 0,
    assessmentArtifacts: 0,
    decisionArtifacts: 0,
    publishReviewIntakeArtifacts: 0,
    publishReviewDecisionArtifacts: 0,
    publishReviewRevocationArtifacts: 0,
    captionArtifacts: 0,
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
      evidenceScope: [],
      assessmentScope: null,
      decisionScope: null,
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
    inputArtifactIds: [SOURCE_ARTIFACT_ID],
    requiredOutputs: CHILD_INPUT.requiredOutputs,
    requiredCapabilities: ["report.submit"],
    dependencies: [],
    decision: "accepted",
    rejection: null,
    taskId: CHILD_TASK_ID,
    agentId: CHILD_AGENT_ID,
    authoredByExecutionId: null,
    toolCallId: null,
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

test("production adapter projects only validated media operation identities and honest terminal facts", () => {
  const completed = projectProductionRuntimeJournal(operationJournal());

  assert.equal(completed.counts.operations, 1);
  assert.equal(completed.counts.sourceArtifacts, 1);
  assert.deepEqual(completed.sourceArtifacts, [{
    artifactId: SOURCE_ARTIFACT_ID,
    kind: "owned-source",
    mediaClass: "raw",
    publication: "private",
    contentId: `sha256:${"c".repeat(64)}`,
    bytes: 1_000,
    durationMs: 5_000,
    trackCount: 1,
  }]);
  assert.deepEqual(completed.operations, [{
    operationId: OPERATION_ID,
    capability: "media.extract",
    status: "completed",
    taskId: ROOT_TASK_ID,
    agentId: ROOT_AGENT_ID,
    grantId: OPERATION_GRANT_ID,
    inputArtifactId: SOURCE_ARTIFACT_ID,
    trackId: "stream:0",
    startMs: 1_000,
    endMs: 2_000,
    requestedDurationMs: 1_000,
    outputArtifactId: OPERATION_OUTPUT_ARTIFACT_ID,
    receiptId: "receipt:authorized-extract",
    observation: null,
    failure: null,
  }]);

  const unavailableDuration = structuredClone(operationJournal()[0]) as {
    data: { artifact: { durationMs: number | null } };
  };
  unavailableDuration.data.artifact.durationMs = null;
  const sourceOnly = projectProductionRuntimeJournal([unavailableDuration]);
  assert.equal(sourceOnly.sourceArtifacts[0].durationMs, null);

  const adapter = new ProductionStudioAdapter(RUN_ID);
  const started = adapter.appendBatch(operationJournal().slice(0, 6));
  assert.deepEqual(
    {
      status: started.operations[0].status,
      outputArtifactId: started.operations[0].outputArtifactId,
      receiptId: started.operations[0].receiptId,
      failure: started.operations[0].failure,
    },
    { status: "started", outputArtifactId: null, receiptId: null, failure: null },
  );

  const failed = adapter.append(event(7, "media_host", "media.operation_failed", {
    operationId: OPERATION_ID,
    reason: "ffmpeg range extraction failed",
  }));
  assert.equal(failed.operations[0].status, "failed");
  assert.equal(failed.operations[0].failure, "ffmpeg range extraction failed");
  assert.equal(failed.operations[0].outputArtifactId, null);
  assert.equal(failed.operations[0].receiptId, null);
});

test("production adapter keeps pending and rejected spawn decisions explicit", () => {
  const journal = productionJournal();
  const adapter = new ProductionStudioAdapter(RUN_ID);
  const pending = adapter.appendBatch(journal.slice(0, 6));
  assert.equal(pending.spawnRequests[0].decision, "pending");
  assert.equal(pending.spawnRequests[0].rejection, null);
  assert.equal(pending.spawnRequests[0].taskId, null);
  assert.equal(pending.spawnRequests[0].agentId, null);

  const rejected = adapter.append(event(7, "scheduler", "spawn.decided", {
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
  const accepted = adapter.appendBatch(journal.slice(0, 5));
  const malformed = structuredClone(journal[6]) as { seq: number; eventId: string };
  malformed.seq = 99;
  malformed.eventId = `event:${RUN_ID}:99`;

  assert.throws(
    () => adapter.appendBatch([journal[5], malformed]),
    /sequence expected 7, received 99/,
  );
  assert.deepEqual(adapter.view(), accepted);

  const duplicateGrantBatch = JSON.parse(
    JSON.stringify(journal.slice(5, 8)).replaceAll(REPORT_GRANT_ID, ROOT_GRANT.id),
  ) as unknown[];
  assert.throws(
    () => adapter.appendBatch(duplicateGrantBatch),
    /grant identities must be unique across tasks/,
  );
  assert.deepEqual(adapter.view(), accepted);

  const sourceAdapter = new ProductionStudioAdapter(RUN_ID);
  const sourceThenGap = structuredClone(operationJournal().slice(0, 2)) as Array<{
    seq: number;
    eventId: string;
  }>;
  sourceThenGap[1].seq = 99;
  sourceThenGap[1].eventId = `event:${RUN_ID}:99`;
  assert.throws(
    () => sourceAdapter.appendBatch(sourceThenGap),
    /sequence expected 2, received 99/,
  );
  assert.equal(sourceAdapter.view().lastSeq, 0);
  assert.deepEqual(sourceAdapter.view().sourceArtifacts, []);
});
