import { capabilityOperationExists, taskCapabilityCallCount } from "../capabilityUsage.ts";
import type { RuntimeProjection } from "../model.ts";
import type { VisualTransitionOperationRecord } from "../model/visualTransitions.ts";
import type { RuntimeEvent } from "../protocol.ts";
import { visualTransitionRequestFingerprint } from "../validation/visualTransitions.ts";
import { invariant } from "./shared.ts";

type VisualTransitionProjection = RuntimeProjection & {
  visualTransitionOperations: Record<string, VisualTransitionOperationRecord>;
};

function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function applyVisualTransitionEvent(projection: RuntimeProjection, event: RuntimeEvent): boolean {
  const next = projection as VisualTransitionProjection;
  if (event.type === "media.visual_transitions_started") {
    invariant(event.producer.kind === "visual_transition_host", event, "Visual-transition evidence must come from its bounded host");
    const { request, scope } = event.data;
    const task = next.tasks[request.taskId];
    invariant(task?.status === "working" && task.ownerAgentId === request.agentId, event, `Visual-transition ${request.operationId} has no working owner`);
    invariant(!capabilityOperationExists(next, request.operationId) && !next.visualTransitionOperations[request.operationId], event, `Visual-transition ${request.operationId} is duplicated`);
    const grant = task.grants.find((candidate) => candidate.id === request.grantId);
    invariant(grant?.capability === "media.visual-transitions.analyze" && grant.visualTransitionScope, event, `Visual-transition ${request.operationId} lacks its exact grant`);
    invariant(grant.mediaScope.length === 1 && same(grant.mediaScope[0], scope), event, `Visual-transition ${request.operationId} changed scheduler scope`);
    invariant(same(grant.visualTransitionScope.limits, event.data.limits), event, `Visual-transition ${request.operationId} changed limits`);
    const source = next.artifacts[scope.artifactId];
    const track = source?.tracks.find((candidate) => candidate.id === scope.trackId);
    invariant(
      source?.origin.kind === "ingest" && source.content.contentId === event.data.sourceContentId &&
        task.jobContext.source.artifactId === source.id && task.jobContext.source.contentId === source.content.contentId,
      event,
      `Visual-transition ${request.operationId} changed immutable source`,
    );
    invariant(track?.kind === "video", event, `Visual-transition ${request.operationId} has no registered video track`);
    const frameOperation = next.frameSamples[request.frameSamplingOperationId];
    const ocrOperation = next.ocrOperations[request.ocrOperationId];
    invariant(
      frameOperation?.status === "completed" && ocrOperation?.status === "completed" &&
        frameOperation.taskId === task.id && ocrOperation.taskId === task.id &&
        frameOperation.agentId === request.agentId && ocrOperation.agentId === request.agentId &&
        ocrOperation.frameSamplingOperationId === frameOperation.id &&
        frameOperation.sourceArtifactId === scope.artifactId && ocrOperation.sourceArtifactId === scope.artifactId &&
        frameOperation.trackId === scope.trackId && ocrOperation.trackId === scope.trackId &&
        frameOperation.startMs === scope.startMs && ocrOperation.startMs === scope.startMs &&
        frameOperation.endMs === scope.endMs && ocrOperation.endMs === scope.endMs &&
        frameOperation.frameArtifactIds.length >= grant.visualTransitionScope.limits.minFrames &&
        frameOperation.frameArtifactIds.length <= grant.visualTransitionScope.limits.maxFrames,
      event,
      `Visual-transition ${request.operationId} lost exact completed same-task U2/U5 inputs`,
    );
    const frames = frameOperation.frameArtifactIds.map((artifactId) => {
      const artifact = next.artifacts[artifactId];
      invariant(artifact?.origin.kind === "sampled_frame" && artifact.origin.operationId === frameOperation.id, event, `Visual-transition ${request.operationId} lost frame ${artifactId}`);
      return { frameId: artifact.origin.frameId, contentId: artifact.content.contentId };
    });
    const fingerprint = visualTransitionRequestFingerprint({
      sourceContentId: source.content.contentId,
      trackId: scope.trackId,
      startMs: scope.startMs,
      endMs: scope.endMs,
      frameSamplingOperationId: frameOperation.id,
      ocrOperationId: ocrOperation.id,
      frameIds: frames.map((frame) => frame.frameId),
      frameContentIds: frames.map((frame) => frame.contentId),
    });
    invariant(fingerprint === event.data.requestFingerprint, event, `Visual-transition ${request.operationId} changed request fingerprint`);
    invariant(!Object.values(next.visualTransitionOperations).some((entry) => entry.taskId === task.id && entry.requestFingerprint === fingerprint), event, `Visual-transition ${request.operationId} repeats identical work`);
    invariant(Object.values(next.visualTransitionOperations).filter((entry) => entry.grantId === grant.id).length < grant.visualTransitionScope.limits.maxCalls, event, `Visual-transition grant ${grant.id} exhausted its call budget`);
    invariant(taskCapabilityCallCount(next, task.id) < task.budget.toolCalls, event, `task ${task.id} exhausted its tool-call budget`);
    const execution = next.executions[event.data.executionId];
    const launch = next.taskLaunches[task.id];
    invariant(
      execution?.status === "active" && execution.taskId === task.id && execution.agentId === request.agentId &&
        execution.launchClaimId === event.data.launchClaimId && launch?.id === event.data.launchClaimId &&
        launch.executionId === execution.id && frameOperation.executionId === execution.id && ocrOperation.executionId === execution.id &&
        frameOperation.launchClaimId === launch.id && ocrOperation.launchClaimId === launch.id,
      event,
      `Visual-transition ${request.operationId} lost same-executor launch lineage`,
    );
    next.visualTransitionOperations[request.operationId] = {
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
      frameSamplingOperationId: frameOperation.id,
      ocrOperationId: ocrOperation.id,
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
  if (event.type === "media.visual_transitions_completed") {
    invariant(event.producer.kind === "visual_transition_host", event, "Visual-transition completion must come from its bounded host");
    const operation = next.visualTransitionOperations[event.data.operationId];
    invariant(operation?.status === "started", event, `Visual-transition ${event.data.operationId} is not active`);
    const output = next.artifacts[event.data.outputArtifactId];
    const receiptArtifact = next.artifacts[event.data.receiptArtifactId];
    const receipt = event.data.receipt;
    invariant(output?.origin.kind === "visual_transition_observations" && receiptArtifact?.origin.kind === "visual_transition_receipt", event, `Visual-transition ${operation.id} has missing stored artifacts`);
    invariant(
      receipt.operationId === operation.id && receipt.authorization.grantId === operation.grantId &&
        receipt.authorization.taskId === operation.taskId && receipt.authorization.agentId === operation.agentId &&
        receipt.authorization.executionId === operation.executionId && receipt.authorization.launchClaimId === operation.launchClaimId &&
        receipt.request.frameSamplingOperationId === operation.frameSamplingOperationId && receipt.request.ocrOperationId === operation.ocrOperationId,
      event,
      `Visual-transition ${operation.id} receipt changed authorization or U2/U5 inputs`,
    );
    invariant(
      receipt.output.artifactId === output.id && same(receipt.output.content, output.content) &&
        output.origin.operationId === operation.id && output.origin.receiptId === receipt.receiptId &&
        output.origin.receiptContentId === event.data.receiptContentId &&
        output.origin.frameSamplingOperationId === operation.frameSamplingOperationId && output.origin.ocrOperationId === operation.ocrOperationId,
      event,
      `Visual-transition ${operation.id} observations changed identity`,
    );
    invariant(
      receiptArtifact.content.contentId === event.data.receiptContentId && receiptArtifact.origin.operationId === operation.id &&
        receiptArtifact.origin.receiptId === receipt.receiptId && receiptArtifact.origin.observationsArtifactId === output.id &&
        receiptArtifact.origin.frameSamplingOperationId === operation.frameSamplingOperationId && receiptArtifact.origin.ocrOperationId === operation.ocrOperationId,
      event,
      `Visual-transition ${operation.id} receipt artifact changed identity`,
    );
    operation.status = "completed";
    operation.outputArtifactId = output.id;
    operation.receiptArtifactId = receiptArtifact.id;
    operation.receiptId = receipt.receiptId;
    operation.receiptContentId = event.data.receiptContentId;
    return true;
  }
  if (event.type === "media.visual_transitions_failed") {
    invariant(event.producer.kind === "visual_transition_host", event, "Visual-transition failure must come from its bounded host");
    const operation = next.visualTransitionOperations[event.data.operationId];
    invariant(operation?.status === "started", event, `Visual-transition ${event.data.operationId} is not active`);
    operation.status = "failed";
    operation.failure = event.data.reason;
    return true;
  }
  return false;
}
