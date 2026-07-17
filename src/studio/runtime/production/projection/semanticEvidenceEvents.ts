import type { RuntimeProjection } from "../model.ts";
import type { RuntimeEvent } from "../protocol.ts";
import { capabilityOperationExists, taskCapabilityCallCount } from "../capabilityUsage.ts";
import { invariant } from "./shared.ts";

export function applySemanticEvidenceEvent(next: RuntimeProjection, event: RuntimeEvent): boolean {
  if (event.type === "semantic.evidence_started") {
    invariant(event.producer.kind === "semantic_evidence_host", event, "semantic evidence must come from its capability host");
    const request = event.data.request;
    const task = next.tasks[request.taskId];
    const source = next.artifacts[request.artifactId];
    const execution = next.executions[event.data.executionId];
    invariant(task?.status === "working" && task.ownerAgentId === request.agentId, event, `semantic operation ${request.operationId} has no working task owner`);
    invariant(
      execution?.status === "active" && execution.taskId === task.id && execution.agentId === request.agentId && execution.launchClaimId === event.data.launchClaimId,
      event,
      `semantic operation ${request.operationId} has no active executor lineage`,
    );
    invariant(
      !capabilityOperationExists(next, request.operationId),
      event,
      `semantic operation ${request.operationId} is duplicated`,
    );
    const grant = task.grants.find((candidate) => candidate.id === event.data.grantId);
    invariant(grant?.capability === "speech.transcribe", event, `semantic operation ${request.operationId} lacks its speech.transcribe grant`);
    invariant(
      source?.origin.kind === "ingest" &&
        source.content.contentId === event.data.sourceContentId &&
        task.jobContext.source.artifactId === source.id &&
        task.jobContext.source.contentId === source.content.contentId,
      event,
      `semantic operation ${request.operationId} changed its owned source`,
    );
    invariant(
      source.tracks.some((track) => track.id === request.trackId && track.kind === "audio"),
      event,
      `semantic operation ${request.operationId} has no registered audio track`,
    );
    invariant(request.endMs <= (source.durationMs ?? 0), event, `semantic operation ${request.operationId} exceeds source duration`);
    invariant(
      grant.mediaScope.some((scope) =>
        scope.artifactId === request.artifactId &&
        scope.trackId === request.trackId &&
        request.startMs >= scope.startMs &&
        request.endMs <= scope.endMs),
      event,
      `semantic operation ${request.operationId} exceeds its granted range`,
    );
    invariant(taskCapabilityCallCount(next, task.id) < task.budget.toolCalls, event, `task ${task.id} exhausted its tool-call budget`);
    next.semanticEvidence[request.operationId] = {
      id: request.operationId,
      capability: "speech.transcribe",
      taskId: task.id,
      agentId: request.agentId,
      executionId: execution.id,
      launchClaimId: execution.launchClaimId,
      grantId: grant.id,
      sourceArtifactId: source.id,
      sourceContentId: source.content.contentId,
      trackId: request.trackId,
      startMs: request.startMs,
      endMs: request.endMs,
      status: "started",
      producer: structuredClone(event.data.producer),
      limits: structuredClone(event.data.limits),
      outputArtifactId: null,
      outputContentId: null,
      receiptId: null,
      receiptContentId: null,
      returnedRange: null,
      observationCount: null,
      availability: null,
      failure: null,
    };
    return true;
  }

  if (event.type === "semantic.evidence_completed") {
    invariant(event.producer.kind === "semantic_evidence_host", event, "semantic completion must come from its capability host");
    const operation = next.semanticEvidence[event.data.operationId];
    const artifact = next.artifacts[event.data.outputArtifactId];
    const receipt = event.data.receipt;
    invariant(operation?.status === "started", event, `semantic operation ${event.data.operationId} is not active`);
    invariant(
      artifact?.origin.kind === "semantic_media_evidence" &&
        artifact.origin.operationId === operation.id &&
        artifact.origin.receiptId === receipt.receiptId &&
        artifact.origin.receiptContentId === event.data.receiptContentId &&
        artifact.origin.availabilityId === receipt.availability.id &&
        artifact.content.contentId === event.data.outputContentId,
      event,
      `semantic operation ${operation.id} has no exact stored artifact and receipt`,
    );
    invariant(
      receipt.operationId === operation.id && receipt.capability === "speech.transcribe" &&
        receipt.authorization.taskId === operation.taskId &&
        receipt.authorization.agentId === operation.agentId &&
        receipt.authorization.grantId === operation.grantId &&
        receipt.authorization.executionId === operation.executionId &&
        receipt.authorization.launchClaimId === operation.launchClaimId,
      event,
      `semantic operation ${operation.id} changed authorization lineage`,
    );
    invariant(
      receipt.source.artifactId === operation.sourceArtifactId &&
        receipt.source.contentId === operation.sourceContentId &&
        receipt.source.trackId === operation.trackId &&
        receipt.request.startMs === operation.startMs &&
        receipt.request.endMs === operation.endMs,
      event,
      `semantic operation ${operation.id} changed source or requested range`,
    );
    invariant(
      JSON.stringify(receipt.producer) === JSON.stringify(operation.producer) &&
        JSON.stringify(receipt.limits) === JSON.stringify(operation.limits),
      event,
      `semantic operation ${operation.id} changed producer or limits`,
    );
    invariant(
      receipt.output.artifactId === artifact.id &&
        receipt.output.contentId === artifact.content.contentId &&
        receipt.output.bytes === artifact.content.bytes &&
        receipt.output.schema === artifact.kind,
      event,
      `semantic operation ${operation.id} changed output content`,
    );
    operation.status = "completed";
    operation.outputArtifactId = artifact.id;
    operation.outputContentId = artifact.content.contentId;
    operation.receiptId = receipt.receiptId;
    operation.receiptContentId = event.data.receiptContentId;
    operation.returnedRange = structuredClone(receipt.returnedRange);
    operation.observationCount = receipt.observations.length;
    operation.availability = structuredClone(receipt.availability);
    return true;
  }

  if (event.type === "semantic.evidence_failed") {
    invariant(event.producer.kind === "semantic_evidence_host", event, "semantic failure must come from its capability host");
    const operation = next.semanticEvidence[event.data.operationId];
    invariant(operation?.status === "started", event, `semantic operation ${event.data.operationId} is not active`);
    operation.status = "failed";
    operation.failure = event.data.reason;
    return true;
  }
  return false;
}
