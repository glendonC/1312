import { capabilityOperationExists, taskCapabilityCallCount } from "../capabilityUsage.ts";
import type { RuntimeProjection } from "../model.ts";
import type { RuntimeEvent } from "../protocol.ts";
import { ocrRequestFingerprint } from "../validation/ocr.ts";
import { invariant } from "./shared.ts";

function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function applyOcrEvent(next: RuntimeProjection, event: RuntimeEvent): boolean {
  if (event.type === "media.frames_ocr_started") {
    invariant(event.producer.kind === "ocr_host", event, "OCR evidence must come from the OCR host");
    const { request, scope } = event.data;
    const task = next.tasks[request.taskId];
    invariant(task?.status === "working" && task.ownerAgentId === request.agentId, event, `OCR ${request.operationId} has no working owner`);
    invariant(!capabilityOperationExists(next, request.operationId), event, `OCR ${request.operationId} is duplicated`);
    const grant = task.grants.find((candidate) => candidate.id === request.grantId);
    invariant(grant?.capability === "media.frames.ocr" && grant.ocrScope, event, `OCR ${request.operationId} lacks its exact grant`);
    invariant(grant.mediaScope.length === 1 && same(grant.mediaScope[0], scope), event, `OCR ${request.operationId} changed scheduler scope`);
    invariant(same(grant.ocrScope.limits, event.data.limits), event, `OCR ${request.operationId} changed limits`);
    const source = next.artifacts[scope.artifactId];
    const track = source?.tracks.find((candidate) => candidate.id === scope.trackId);
    invariant(
      source?.origin.kind === "ingest" && source.content.contentId === event.data.sourceContentId &&
        task.jobContext.source.artifactId === source.id && task.jobContext.source.contentId === source.content.contentId,
      event,
      `OCR ${request.operationId} changed immutable source`,
    );
    invariant(track?.kind === "video", event, `OCR ${request.operationId} has no registered video track`);
    const frameOperation = next.frameSamples[request.frameSamplingOperationId];
    invariant(
      frameOperation?.status === "completed" && frameOperation.taskId === task.id && frameOperation.agentId === request.agentId &&
        frameOperation.executionId === event.data.executionId && frameOperation.launchClaimId === event.data.launchClaimId &&
        frameOperation.sourceArtifactId === scope.artifactId && frameOperation.trackId === scope.trackId &&
        frameOperation.startMs === scope.startMs && frameOperation.endMs === scope.endMs &&
        frameOperation.frameArtifactIds.length >= 1 && frameOperation.frameArtifactIds.length <= grant.ocrScope.limits.maxFrames,
      event,
      `OCR ${request.operationId} lost its exact completed U2 frame input`,
    );
    const frameIds = frameOperation.frameArtifactIds.map((artifactId) => {
      const artifact = next.artifacts[artifactId];
      invariant(artifact?.origin.kind === "sampled_frame", event, `OCR ${request.operationId} lost frame ${artifactId}`);
      return artifact.origin.frameId;
    });
    const fingerprint = ocrRequestFingerprint({
      sourceContentId: source.content.contentId,
      trackId: scope.trackId,
      startMs: scope.startMs,
      endMs: scope.endMs,
      frameSamplingOperationId: frameOperation.id,
      frameIds,
    });
    invariant(fingerprint === event.data.requestFingerprint, event, `OCR ${request.operationId} changed request fingerprint`);
    invariant(!Object.values(next.ocrOperations).some((entry) => entry.taskId === task.id && entry.requestFingerprint === fingerprint), event, `OCR ${request.operationId} repeats identical work`);
    invariant(Object.values(next.ocrOperations).filter((entry) => entry.grantId === grant.id).length < grant.ocrScope.limits.maxCalls, event, `OCR grant ${grant.id} exhausted its call budget`);
    invariant(taskCapabilityCallCount(next, task.id) < task.budget.toolCalls, event, `task ${task.id} exhausted its tool-call budget`);
    const execution = next.executions[event.data.executionId];
    const launch = next.taskLaunches[task.id];
    invariant(
      execution?.status === "active" && execution.taskId === task.id && execution.agentId === request.agentId &&
        execution.launchClaimId === event.data.launchClaimId && launch?.id === event.data.launchClaimId && launch.executionId === execution.id,
      event,
      `OCR ${request.operationId} lost executor or launch lineage`,
    );
    next.ocrOperations[request.operationId] = {
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
  if (event.type === "media.frames_ocr_completed") {
    invariant(event.producer.kind === "ocr_host", event, "OCR completion must come from the OCR host");
    const operation = next.ocrOperations[event.data.operationId];
    invariant(operation?.status === "started", event, `OCR ${event.data.operationId} is not active`);
    const output = next.artifacts[event.data.outputArtifactId];
    const receiptArtifact = next.artifacts[event.data.receiptArtifactId];
    const receipt = event.data.receipt;
    invariant(output?.origin.kind === "ocr_observations" && receiptArtifact?.origin.kind === "ocr_receipt", event, `OCR ${operation.id} has missing stored artifacts`);
    invariant(
      receipt.operationId === operation.id && receipt.authorization.grantId === operation.grantId &&
        receipt.authorization.taskId === operation.taskId && receipt.authorization.agentId === operation.agentId &&
        receipt.authorization.executionId === operation.executionId && receipt.authorization.launchClaimId === operation.launchClaimId &&
        receipt.request.frameSamplingOperationId === operation.frameSamplingOperationId,
      event,
      `OCR ${operation.id} receipt changed authorization or frame input`,
    );
    invariant(
      receipt.output.artifactId === output.id && receipt.output.contentId === output.content.contentId && receipt.output.bytes === output.content.bytes &&
        output.origin.operationId === operation.id && output.origin.receiptId === receipt.receiptId &&
        output.origin.receiptContentId === event.data.receiptContentId && output.origin.frameSamplingOperationId === operation.frameSamplingOperationId,
      event,
      `OCR ${operation.id} observations changed identity`,
    );
    invariant(
      receiptArtifact.content.contentId === event.data.receiptContentId && receiptArtifact.origin.operationId === operation.id &&
        receiptArtifact.origin.receiptId === receipt.receiptId && receiptArtifact.origin.observationsArtifactId === output.id &&
        receiptArtifact.origin.frameSamplingOperationId === operation.frameSamplingOperationId,
      event,
      `OCR ${operation.id} receipt artifact changed identity`,
    );
    operation.status = "completed";
    operation.outputArtifactId = output.id;
    operation.receiptArtifactId = receiptArtifact.id;
    operation.receiptId = receipt.receiptId;
    operation.receiptContentId = event.data.receiptContentId;
    return true;
  }
  if (event.type === "media.frames_ocr_failed") {
    invariant(event.producer.kind === "ocr_host", event, "OCR failure must come from the OCR host");
    const operation = next.ocrOperations[event.data.operationId];
    invariant(operation?.status === "started", event, `OCR ${event.data.operationId} is not active`);
    operation.status = "failed";
    operation.failure = event.data.reason;
    return true;
  }
  return false;
}
