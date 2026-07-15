import { assertRuntimeEvent } from "../assertions.ts";
import type { RuntimeArtifact, RuntimeProjection } from "../model.ts";
import type { RuntimeEvent } from "../protocol.ts";
import { projectRuntimeEvents } from "../projection.ts";
import { aggregateObservability } from "./aggregate.ts";
import { assertRuntimeObservabilityIndex } from "./validation.ts";
import { canonicalJsonLine, identifyUtf8 } from "./hash.ts";
import type {
  IndexedFailure,
  ObservabilityArtifactSource,
  ObservabilityReceiptSource,
  ObservabilitySourceReferences,
  RuntimeObservabilityIndex,
} from "./model.ts";

export const MAX_OBSERVABILITY_JOURNAL_BYTES = 5 * 1024 * 1024;

function append(map: Map<string, string[]>, key: string | null, eventId: string): void {
  if (key === null) return;
  const existing = map.get(key) ?? [];
  if (!existing.includes(eventId)) existing.push(eventId);
  map.set(key, existing);
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function receiptValue(event: RuntimeEvent): {
  kind: ObservabilityReceiptSource["kind"];
  receipt: { receiptId: string };
  rawReceiptContentId: string | null;
} | null {
  if (event.type === "media.operation_completed") {
    return { kind: "media_operation", receipt: event.data.receipt, rawReceiptContentId: null };
  }
  if (event.type === "executor.finished") {
    return { kind: "executor_span", receipt: event.data.receipt, rawReceiptContentId: null };
  }
  if (event.type === "model.usage_recorded") {
    return {
      kind: "model_usage",
      receipt: event.data.receipt,
      rawReceiptContentId: event.data.receipt.rawReceipt.contentId,
    };
  }
  return null;
}

function receiptArtifactLinks(state: RuntimeProjection, receiptId: string): RuntimeArtifact[] {
  return Object.values(state.artifacts).filter((artifact) => {
    const origin = artifact.origin;
    return origin.kind !== "ingest" && origin.kind !== "preflight_evidence" && origin.receiptId === receiptId;
  });
}

function refs(
  eventIds: readonly string[],
  receiptIds: readonly string[] = [],
  artifactIds: readonly string[] = [],
): ObservabilitySourceReferences {
  return {
    eventIds: sortedUnique(eventIds),
    receiptIds: sortedUnique(receiptIds),
    artifactIds: sortedUnique(artifactIds),
  };
}

export function parseProductionRuntimeJournal(rawJournal: string): RuntimeEvent[] {
  const bytes = new TextEncoder().encode(rawJournal).byteLength;
  if (bytes === 0) throw new Error("Production observability journal is empty");
  if (bytes > MAX_OBSERVABILITY_JOURNAL_BYTES) {
    throw new Error("Production observability journal exceeds the 5 MB indexing limit");
  }

  const withoutFinalNewline = rawJournal.endsWith("\n") ? rawJournal.slice(0, -1) : rawJournal;
  if (withoutFinalNewline.length === 0) throw new Error("Production observability journal is empty");
  const events = withoutFinalNewline.split("\n").map((line, index) => {
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch (cause) {
      throw new Error(`Production observability journal line ${index + 1} is not valid JSON`, {
        cause,
      });
    }
    assertRuntimeEvent(value, `Production observability journal line ${index + 1}`);
    return value;
  });
  const runId = events[0].runId;
  projectRuntimeEvents(runId, events);
  for (let index = 1; index < events.length; index += 1) {
    if (Date.parse(events[index].recordedAt) < Date.parse(events[index - 1].recordedAt)) {
      throw new Error(
        `Production observability journal event ${events[index].eventId} predates its predecessor`,
      );
    }
  }
  return events;
}

/** Build one immutable, content-addressed snapshot from a validated production NDJSON journal. */
export async function buildRuntimeObservabilityIndex(
  rawJournal: string,
): Promise<RuntimeObservabilityIndex> {
  const events = parseProductionRuntimeJournal(rawJournal);
  const runId = events[0].runId;
  const state = projectRuntimeEvents(runId, events);
  const sourceJournalContent = await identifyUtf8(rawJournal);
  const eventSources = await Promise.all(
    events.map(async (event) => ({
      eventId: event.eventId,
      seq: event.seq,
      type: event.type,
      producerKind: event.producer.kind,
      contentId: (await identifyUtf8(canonicalJsonLine(event))).contentId,
    })),
  );

  const receiptSources: ObservabilityReceiptSource[] = [];
  for (const event of events) {
    const candidate = receiptValue(event);
    if (!candidate) continue;
    const content = await identifyUtf8(canonicalJsonLine(candidate.receipt));
    const linkedArtifacts = receiptArtifactLinks(state, candidate.receipt.receiptId);
    for (const artifact of linkedArtifacts) {
      const origin = artifact.origin;
      if (
        origin.kind === "ingest" ||
        origin.kind === "preflight_evidence" ||
        origin.receiptContentId !== content.contentId
      ) {
        throw new Error(
          `Observability receipt ${candidate.receipt.receiptId} does not match its artifact-store content link`,
        );
      }
    }
    receiptSources.push({
      receiptId: candidate.receipt.receiptId,
      kind: candidate.kind,
      eventId: event.eventId,
      contentId: content.contentId,
      storage: linkedArtifacts.length > 0 ? "artifact_store" : "embedded_event",
      rawReceiptContentId: candidate.rawReceiptContentId,
    });
  }

  const artifactSources: ObservabilityArtifactSource[] = events.flatMap((event) => {
    if (event.type !== "artifact.recorded") return [];
    const artifact = event.data.artifact;
    return [
      {
        artifactId: artifact.id,
        kind: artifact.kind,
        eventId: event.eventId,
        contentId: artifact.content.contentId,
        receiptId:
          artifact.origin.kind === "ingest" || artifact.origin.kind === "preflight_evidence"
            ? null
            : artifact.origin.receiptId,
      },
    ];
  });

  const taskEvents = new Map<string, string[]>();
  const agentEvents = new Map<string, string[]>();
  const operationEvents = new Map<string, string[]>();
  const executionEvents = new Map<string, string[]>();
  const reportEvents = new Map<string, string[]>();
  const operationArtifacts = new Map<string, string[]>();
  const executionArtifacts = new Map<string, string[]>();
  const executionReceipts = new Map<string, string[]>();
  const failures: IndexedFailure[] = [];

  for (const event of events) {
    if (event.type === "task.created") {
      append(taskEvents, event.data.task.id, event.eventId);
      append(agentEvents, event.data.task.assignedAgentId, event.eventId);
    } else if (event.type === "spawn.requested") {
      append(taskEvents, event.data.requestedByTaskId, event.eventId);
      append(agentEvents, event.data.requestedByAgentId, event.eventId);
    } else if (event.type === "spawn.decided") {
      append(taskEvents, event.data.taskId, event.eventId);
      append(agentEvents, event.data.agentId, event.eventId);
      if (!event.data.accepted) {
        const request = state.spawnRequests[event.data.requestId];
        failures.push({
          runId,
          failureId: `failure:${event.eventId}`,
          kind: "spawn_rejected",
          taskId: request?.requestedByTaskId ?? null,
          agentId: request?.requestedByAgentId ?? null,
          entityId: event.data.requestId,
          sources: refs([event.eventId]),
        });
      }
    } else if (event.type === "agent.registered") {
      append(taskEvents, event.data.agent.taskId, event.eventId);
      append(agentEvents, event.data.agent.id, event.eventId);
    } else if (event.type === "task.transitioned") {
      append(taskEvents, event.data.taskId, event.eventId);
      append(agentEvents, event.data.agentId, event.eventId);
      if (event.data.status === "failed") {
        failures.push({
          runId,
          failureId: `failure:${event.eventId}`,
          kind: "task_failed",
          taskId: event.data.taskId,
          agentId: event.data.agentId,
          entityId: event.data.taskId,
          sources: refs([event.eventId]),
        });
      }
    } else if (event.type === "media.operation_started") {
      const request = event.data.request;
      append(operationEvents, request.operationId, event.eventId);
      append(taskEvents, request.taskId, event.eventId);
      append(agentEvents, request.agentId, event.eventId);
    } else if (event.type === "media.operation_completed") {
      const operation = state.operations[event.data.operationId];
      append(operationEvents, event.data.operationId, event.eventId);
      append(taskEvents, operation?.taskId ?? null, event.eventId);
      append(agentEvents, operation?.agentId ?? null, event.eventId);
    } else if (event.type === "media.operation_failed") {
      const operation = state.operations[event.data.operationId];
      append(operationEvents, event.data.operationId, event.eventId);
      append(taskEvents, operation?.taskId ?? null, event.eventId);
      append(agentEvents, operation?.agentId ?? null, event.eventId);
      failures.push({
        runId,
        failureId: `failure:${event.eventId}`,
        kind: "media_operation_failed",
        taskId: operation?.taskId ?? null,
        agentId: operation?.agentId ?? null,
        entityId: event.data.operationId,
        sources: refs([event.eventId]),
      });
    } else if (event.type === "executor.started") {
      append(executionEvents, event.data.executionId, event.eventId);
      append(taskEvents, event.data.taskId, event.eventId);
      append(agentEvents, event.data.agentId, event.eventId);
    } else if (event.type === "model.usage_recorded") {
      const receipt = event.data.receipt;
      append(executionEvents, receipt.executionId, event.eventId);
      append(executionReceipts, receipt.executionId, receipt.receiptId);
      append(taskEvents, receipt.taskId, event.eventId);
      append(agentEvents, receipt.agentId, event.eventId);
    } else if (event.type === "executor.finished") {
      const receipt = event.data.receipt;
      append(executionEvents, receipt.executionId, event.eventId);
      append(executionReceipts, receipt.executionId, receipt.receiptId);
      append(taskEvents, receipt.taskId, event.eventId);
      append(agentEvents, receipt.agentId, event.eventId);
      if (receipt.outcome !== "completed") {
        failures.push({
          runId,
          failureId: `failure:${event.eventId}`,
          kind: receipt.outcome === "timed_out" ? "executor_timed_out" : "executor_failed",
          taskId: receipt.taskId,
          agentId: receipt.agentId,
          entityId: receipt.executionId,
          sources: refs([event.eventId], [receipt.receiptId]),
        });
      }
    } else if (event.type === "report.submitted") {
      const report = event.data.report;
      append(reportEvents, report.id, event.eventId);
      append(taskEvents, report.taskId, event.eventId);
      append(taskEvents, report.parentTaskId, event.eventId);
      append(agentEvents, report.agentId, event.eventId);
      append(agentEvents, report.parentAgentId, event.eventId);
    } else if (event.type === "report.decided") {
      const report = state.reports[event.data.reportId];
      append(reportEvents, event.data.reportId, event.eventId);
      append(taskEvents, report?.taskId ?? null, event.eventId);
      append(taskEvents, event.data.decidedByTaskId, event.eventId);
      append(agentEvents, report?.agentId ?? null, event.eventId);
      append(agentEvents, event.data.decidedByAgentId, event.eventId);
      if (!event.data.accepted) {
        failures.push({
          runId,
          failureId: `failure:${event.eventId}`,
          kind: "handoff_rejected",
          taskId: report?.taskId ?? null,
          agentId: report?.agentId ?? null,
          entityId: event.data.reportId,
          sources: refs([event.eventId]),
        });
      }
    } else if (event.type === "artifact.recorded") {
      const artifact = event.data.artifact;
      if (artifact.origin.kind === "media_operation" || artifact.origin.kind === "media_observation") {
        append(operationEvents, artifact.origin.operationId, event.eventId);
        append(operationArtifacts, artifact.origin.operationId, artifact.id);
      } else if (artifact.origin.kind === "worker_output") {
        append(executionEvents, artifact.origin.executionId, event.eventId);
        append(executionArtifacts, artifact.origin.executionId, artifact.id);
      }
      append(taskEvents, artifact.producerTaskId, event.eventId);
      append(agentEvents, artifact.producerAgentId, event.eventId);
    }
  }

  const records: RuntimeObservabilityIndex["records"] = {
    tasks: Object.values(state.tasks)
      .map((task) => ({
        runId,
        taskId: task.id,
        assignedAgentId: task.assignedAgentId,
        parentTaskId: task.parentTaskId,
        depth: task.depth,
        workerKind: task.workerKind,
        status: task.status,
        sources: refs(taskEvents.get(task.id) ?? []),
      }))
      .sort((left, right) => left.taskId.localeCompare(right.taskId)),
    agents: Object.values(state.agents)
      .map((agent) => ({
        runId,
        agentId: agent.id,
        taskId: agent.taskId,
        parentAgentId: agent.parentAgentId,
        kind: agent.kind,
        status: agent.status,
        sources: refs(agentEvents.get(agent.id) ?? []),
      }))
      .sort((left, right) => left.agentId.localeCompare(right.agentId)),
    operations: Object.values(state.operations)
      .map((operation) => ({
        runId,
        operationId: operation.id,
        taskId: operation.taskId,
        agentId: operation.agentId,
        capability: operation.capability,
        status: operation.status,
        artifactId: operation.artifactId,
        trackId: operation.trackId,
        startMs: operation.startMs,
        endMs: operation.endMs,
        requestedDurationMs: operation.endMs - operation.startMs,
        outputArtifactId: operation.outputArtifactId,
        receiptId: operation.receiptId,
        sources: refs(
          operationEvents.get(operation.id) ?? [],
          operation.receiptId ? [operation.receiptId] : [],
          operationArtifacts.get(operation.id) ?? [],
        ),
      }))
      .sort((left, right) => left.operationId.localeCompare(right.operationId)),
    executions: Object.values(state.executions)
      .map((execution) => {
        const usage = execution.modelUsageReceiptId
          ? state.modelUsage[execution.modelUsageReceiptId]
          : null;
        return {
          runId,
          executionId: execution.id,
          taskId: execution.taskId,
          agentId: execution.agentId,
          status: execution.status,
          startedAt: execution.startedAt,
          endedAt: execution.receipt?.endedAt ?? null,
          activeDurationMs: execution.receipt?.monotonicDurationMs ?? null,
          model: usage?.model ?? null,
          tokens: usage ? { ...usage.measured } : null,
          providerUnits: null,
          billing: { amount: null, currency: null },
          sources: refs(
            executionEvents.get(execution.id) ?? [],
            executionReceipts.get(execution.id) ?? [],
            executionArtifacts.get(execution.id) ?? [],
          ),
        };
      })
      .sort((left, right) => left.executionId.localeCompare(right.executionId)),
    handoffs: Object.values(state.reports)
      .map((report) => ({
        runId,
        reportId: report.id,
        taskId: report.taskId,
        agentId: report.agentId,
        parentTaskId: report.parentTaskId,
        parentAgentId: report.parentAgentId,
        status: report.status,
        outputArtifactIds: [...report.outputArtifactIds].sort(),
        sources: refs(reportEvents.get(report.id) ?? [], [], report.outputArtifactIds),
      }))
      .sort((left, right) => left.reportId.localeCompare(right.reportId)),
    failures: failures.sort((left, right) => left.failureId.localeCompare(right.failureId)),
  };

  const body = {
    schema: "studio.runtime.observability-index.v1" as const,
    producer: { id: "studio.runtime.observability-indexer" as const, version: "1" as const },
    sourceJournal: {
      schema: "studio.runtime.event.v1" as const,
      runId,
      content: sourceJournalContent,
      eventCount: events.length,
      firstEventId: events[0].eventId,
      lastEventId: events.at(-1)!.eventId,
    },
    sources: {
      events: eventSources,
      receipts: receiptSources.sort((left, right) => left.eventId.localeCompare(right.eventId)),
      artifacts: artifactSources.sort((left, right) => left.artifactId.localeCompare(right.artifactId)),
    },
    records,
    summary: aggregateObservability(records),
  };
  const content = await identifyUtf8(canonicalJsonLine(body));
  const index: RuntimeObservabilityIndex = {
    schema: body.schema,
    indexId: `observability:${content.digest}`,
    content,
    producer: body.producer,
    sourceJournal: body.sourceJournal,
    sources: body.sources,
    records: body.records,
    summary: body.summary,
  };
  assertRuntimeObservabilityIndex(index);
  return index;
}
