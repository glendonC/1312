import { capabilityOperationExists, taskCapabilityCallCount } from "../capabilityUsage.ts";
import { SPEAKER_OVERLAP_PINNED_CONTENT_IDS, type RuntimeProjection } from "../model.ts";
import type { RuntimeEvent } from "../protocol.ts";
import { speakerOverlapRequestFingerprint } from "../validation/speakers.ts";
import { invariant } from "./shared.ts";

function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function applySpeakerOverlapEvent(next: RuntimeProjection, event: RuntimeEvent): boolean {
  if (event.type === "media.speakers_started") {
    invariant(event.producer.kind === "speaker_host", event, "Speaker/overlap evidence must come from its bounded host");
    const { request, scope } = event.data;
    const task = next.tasks[request.taskId];
    invariant(task?.status === "working" && task.ownerAgentId === request.agentId, event, `Speaker/overlap ${request.operationId} has no working owner`);
    invariant(!capabilityOperationExists(next, request.operationId), event, `Speaker/overlap ${request.operationId} is duplicated`);
    const grant = task.grants.find((candidate) => candidate.id === request.grantId);
    invariant(grant?.capability === "media.speakers.analyze" && grant.speakerScope, event, `Speaker/overlap ${request.operationId} lacks its exact grant`);
    invariant(grant.mediaScope.length === 1 && same(grant.mediaScope[0], scope), event, `Speaker/overlap ${request.operationId} changed scheduler scope`);
    invariant(same(grant.speakerScope.limits, event.data.limits), event, `Speaker/overlap ${request.operationId} changed limits`);
    const source = next.artifacts[scope.artifactId];
    const track = source?.tracks.find((candidate) => candidate.id === scope.trackId);
    invariant(
      source?.origin.kind === "ingest" && source.content.contentId === event.data.sourceContentId &&
        source.content.bytes <= grant.speakerScope.limits.maxSourceBytes &&
        task.jobContext.source.artifactId === source.id && task.jobContext.source.contentId === source.content.contentId,
      event,
      `Speaker/overlap ${request.operationId} changed immutable source`,
    );
    invariant(track?.kind === "audio" && scope.endMs <= (source.durationMs ?? 0) && scope.endMs - scope.startMs <= grant.speakerScope.limits.maxRangeMs, event, `Speaker/overlap ${request.operationId} has no bounded registered audio range`);
    const fingerprint = speakerOverlapRequestFingerprint({
      sourceContentId: source.content.contentId,
      trackId: scope.trackId,
      startMs: scope.startMs,
      endMs: scope.endMs,
      configurationContentIds: [...SPEAKER_OVERLAP_PINNED_CONTENT_IDS],
    });
    invariant(fingerprint === event.data.requestFingerprint, event, `Speaker/overlap ${request.operationId} changed request fingerprint`);
    invariant(!Object.values(next.speakerOverlapOperations).some((entry) => entry.taskId === task.id && entry.requestFingerprint === fingerprint), event, `Speaker/overlap ${request.operationId} repeats identical work`);
    invariant(Object.values(next.speakerOverlapOperations).filter((entry) => entry.grantId === grant.id).length < grant.speakerScope.limits.maxCalls, event, `Speaker/overlap grant ${grant.id} exhausted its call budget`);
    invariant(taskCapabilityCallCount(next, task.id) < task.budget.toolCalls, event, `task ${task.id} exhausted its tool-call budget`);
    const execution = next.executions[event.data.executionId];
    const launch = next.taskLaunches[task.id];
    invariant(
      execution?.status === "active" && execution.taskId === task.id && execution.agentId === request.agentId &&
        execution.launchClaimId === event.data.launchClaimId && launch?.id === event.data.launchClaimId && launch.executionId === execution.id,
      event,
      `Speaker/overlap ${request.operationId} lost executor or launch lineage`,
    );
    next.speakerOverlapOperations[request.operationId] = {
      id: request.operationId,
      taskId: task.id,
      agentId: request.agentId,
      grantId: grant.id,
      executionId: execution.id,
      launchClaimId: launch.id,
      sourceArtifactId: source.id,
      trackId: scope.trackId,
      startMs: scope.startMs,
      endMs: scope.endMs,
      requestFingerprint: fingerprint,
      limits: structuredClone(event.data.limits),
      status: "started",
      outputArtifactId: null,
      receiptArtifactId: null,
      receiptId: null,
      receiptContentId: null,
      failure: null,
    };
    return true;
  }
  if (event.type === "media.speakers_completed") {
    invariant(event.producer.kind === "speaker_host", event, "Speaker/overlap completion must come from its bounded host");
    const operation = next.speakerOverlapOperations[event.data.operationId];
    invariant(operation?.status === "started", event, `Speaker/overlap ${event.data.operationId} is not active`);
    const output = next.artifacts[event.data.outputArtifactId];
    const receiptArtifact = next.artifacts[event.data.receiptArtifactId];
    const receipt = event.data.receipt;
    invariant(output?.origin.kind === "speaker_overlap_observations" && receiptArtifact?.origin.kind === "speaker_overlap_receipt", event, `Speaker/overlap ${operation.id} has missing stored artifacts`);
    invariant(
      receipt.operationId === operation.id && receipt.authorization.grantId === operation.grantId &&
        receipt.authorization.taskId === operation.taskId && receipt.authorization.agentId === operation.agentId &&
        receipt.authorization.executionId === operation.executionId && receipt.authorization.launchClaimId === operation.launchClaimId,
      event,
      `Speaker/overlap ${operation.id} receipt changed authorization`,
    );
    invariant(
      receipt.output.artifactId === output.id && receipt.output.contentId === output.content.contentId && receipt.output.bytes === output.content.bytes &&
        output.origin.operationId === operation.id && output.origin.receiptId === receipt.receiptId &&
        output.origin.receiptContentId === event.data.receiptContentId && output.sourceArtifactIds.length === 1 && output.sourceArtifactIds[0] === operation.sourceArtifactId,
      event,
      `Speaker/overlap ${operation.id} observations changed identity`,
    );
    invariant(
      receiptArtifact.content.contentId === event.data.receiptContentId && receiptArtifact.origin.operationId === operation.id &&
        receiptArtifact.origin.receiptId === receipt.receiptId && receiptArtifact.origin.observationsArtifactId === output.id &&
        receiptArtifact.sourceArtifactIds.length === 2 && receiptArtifact.sourceArtifactIds[0] === operation.sourceArtifactId && receiptArtifact.sourceArtifactIds[1] === output.id,
      event,
      `Speaker/overlap ${operation.id} receipt artifact changed identity`,
    );
    operation.status = "completed";
    operation.outputArtifactId = output.id;
    operation.receiptArtifactId = receiptArtifact.id;
    operation.receiptId = receipt.receiptId;
    operation.receiptContentId = event.data.receiptContentId;
    return true;
  }
  if (event.type === "media.speakers_failed") {
    invariant(event.producer.kind === "speaker_host", event, "Speaker/overlap failure must come from its bounded host");
    const operation = next.speakerOverlapOperations[event.data.operationId];
    invariant(operation?.status === "started", event, `Speaker/overlap ${event.data.operationId} is not active`);
    operation.status = "failed";
    operation.failure = event.data.reason;
    return true;
  }
  return false;
}
