import type { RuntimeProjection } from "../model.ts";
import type { RuntimeEvent } from "../protocol.ts";
import { invariant } from "./shared.ts";

export function applyExecutionMediaEvent(next: RuntimeProjection, event: RuntimeEvent): boolean {
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
    return true;
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
    return true;
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
    return true;
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
    return true;
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
    return true;
  }

  if (event.type === "media.operation_failed") {
  invariant(event.producer.kind === "media_host", event, "media failure evidence must come from the media host");
  const operation = next.operations[event.data.operationId];
  invariant(operation?.status === "started", event, `operation ${event.data.operationId} is not active`);
  operation.status = "failed";
  operation.failure = event.data.reason;
    return true;
  }
  return false;
}
