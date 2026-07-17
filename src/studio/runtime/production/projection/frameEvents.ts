import { capabilityOperationExists, taskCapabilityCallCount } from "../capabilityUsage.ts";
import type { RuntimeProjection } from "../model.ts";
import type { RuntimeEvent } from "../protocol.ts";
import { frameSamplingRequestFingerprint } from "../validation/frames.ts";
import { invariant } from "./shared.ts";

function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function applyFrameEvent(next: RuntimeProjection, event: RuntimeEvent): boolean {
  if (event.type === "media.frames_sampling_started") {
    invariant(event.producer.kind === "frame_host", event, "frame sampling evidence must come from the frame host");
    const { request, scope } = event.data;
    const task = next.tasks[request.taskId];
    invariant(task?.status === "working" && task.ownerAgentId === request.agentId, event, `frame sample ${request.operationId} has no working owner`);
    invariant(!capabilityOperationExists(next, request.operationId), event, `frame sample ${request.operationId} is duplicated`);
    const grant = task.grants.find((candidate) => candidate.id === request.grantId);
    invariant(grant?.capability === "media.frames.sample" && grant.frameScope, event, `frame sample ${request.operationId} lacks its exact frame grant`);
    invariant(grant.mediaScope.length === 1 && same(grant.mediaScope[0], scope), event, `frame sample ${request.operationId} changed its scheduler scope`);
    invariant(same(grant.frameScope.limits, event.data.limits), event, `frame sample ${request.operationId} changed its limits`);
    const source = next.artifacts[scope.artifactId];
    const track = source?.tracks.find((candidate) => candidate.id === scope.trackId);
    invariant(
      source?.origin.kind === "ingest" && source.content.contentId === event.data.sourceContentId &&
        task.jobContext.source.artifactId === source.id && task.jobContext.source.contentId === source.content.contentId,
      event,
      `frame sample ${request.operationId} changed its immutable source`,
    );
    invariant(track?.kind === "video", event, `frame sample ${request.operationId} has no registered video track`);
    invariant(scope.endMs <= (source.durationMs ?? 0), event, `frame sample ${request.operationId} exceeds source duration`);
    invariant(
      request.requestedTimestampsMs.every((timestamp) => timestamp >= scope.startMs && timestamp < scope.endMs),
      event,
      `frame sample ${request.operationId} contains an out-of-range timestamp`,
    );
    const execution = next.executions[event.data.executionId];
    const launch = next.taskLaunches[task.id];
    invariant(
      execution?.status === "active" && execution.taskId === task.id && execution.agentId === request.agentId &&
        execution.launchClaimId === event.data.launchClaimId && launch?.id === event.data.launchClaimId &&
        launch.executionId === execution.id,
      event,
      `frame sample ${request.operationId} lost executor or launch lineage`,
    );
    const fingerprint = frameSamplingRequestFingerprint({
      sourceContentId: source.content.contentId,
      trackId: scope.trackId,
      startMs: scope.startMs,
      endMs: scope.endMs,
      requestedTimestampsMs: request.requestedTimestampsMs,
    });
    invariant(fingerprint === event.data.requestFingerprint, event, `frame sample ${request.operationId} changed its request fingerprint`);
    invariant(
      !Object.values(next.frameSamples).some((sample) => sample.taskId === task.id && sample.requestFingerprint === fingerprint),
      event,
      `frame sample ${request.operationId} repeats identical work`,
    );
    invariant(
      Object.values(next.frameSamples).filter((sample) => sample.grantId === grant.id).length < grant.frameScope.limits.maxCalls,
      event,
      `frame grant ${grant.id} exhausted its call budget`,
    );
    invariant(taskCapabilityCallCount(next, task.id) < task.budget.toolCalls, event, `task ${task.id} exhausted its tool-call budget`);
    next.frameSamples[request.operationId] = {
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
      requestedTimestampsMs: structuredClone(request.requestedTimestampsMs),
      requestFingerprint: fingerprint,
      limits: structuredClone(event.data.limits),
      status: "started",
      manifestArtifactId: null,
      receiptArtifactId: null,
      receiptId: null,
      receiptContentId: null,
      frameArtifactIds: [],
      failure: null,
    };
    return true;
  }

  if (event.type === "media.frames_sampling_completed") {
    invariant(event.producer.kind === "frame_host", event, "frame completion evidence must come from the frame host");
    const operation = next.frameSamples[event.data.operationId];
    invariant(operation?.status === "started", event, `frame sample ${event.data.operationId} is not active`);
    const task = next.tasks[operation.taskId];
    const source = next.artifacts[operation.sourceArtifactId];
    const manifest = next.artifacts[event.data.manifestArtifactId];
    const receiptArtifact = next.artifacts[event.data.receiptArtifactId];
    const frames = event.data.frameArtifactIds.map((id) => next.artifacts[id]);
    const receipt = event.data.receipt;
    invariant(task && source && manifest && receiptArtifact && frames.every(Boolean), event, `frame sample ${operation.id} has missing stored artifacts`);
    invariant(
      receipt.operationId === operation.id && receipt.authorization.grantId === operation.grantId &&
        receipt.authorization.taskId === operation.taskId && receipt.authorization.agentId === operation.agentId &&
        receipt.authorization.executionId === operation.executionId && receipt.authorization.launchClaimId === operation.launchClaimId,
      event,
      `frame sample ${operation.id} receipt changed authorization`,
    );
    invariant(
      receipt.source.artifactId === source.id && receipt.source.contentId === source.content.contentId &&
        receipt.source.videoTrack.id === operation.trackId &&
        receipt.source.grantedRange.startMs === operation.startMs && receipt.source.grantedRange.endMs === operation.endMs &&
        same(receipt.request.requestedTimestampsMs, operation.requestedTimestampsMs) && same(receipt.limits, operation.limits),
      event,
      `frame sample ${operation.id} receipt changed source, request, or limits`,
    );
    invariant(
      manifest.origin.kind === "frame_sample_manifest" && manifest.origin.operationId === operation.id &&
        manifest.origin.receiptId === receipt.receiptId && manifest.origin.receiptContentId === event.data.receiptContentId &&
        manifest.id === receipt.output.manifestArtifactId && manifest.content.contentId === receipt.output.manifestContentId &&
        manifest.content.bytes === receipt.output.manifestBytes,
      event,
      `frame sample ${operation.id} manifest changed identity`,
    );
    invariant(
      receiptArtifact.origin.kind === "frame_sampling_receipt" && receiptArtifact.origin.operationId === operation.id &&
        receiptArtifact.origin.receiptId === receipt.receiptId && receiptArtifact.origin.manifestArtifactId === manifest.id &&
        receiptArtifact.content.contentId === event.data.receiptContentId,
      event,
      `frame sample ${operation.id} receipt artifact changed identity`,
    );
    invariant(
      event.data.frameArtifactIds.length === receipt.output.frames.length &&
        receipt.output.frames.every((frame, index) => {
          const artifact = frames[index];
          return artifact?.origin.kind === "sampled_frame" && artifact.id === frame.artifactId &&
            artifact.content.contentId === frame.content.contentId && artifact.content.bytes === frame.content.bytes &&
            artifact.origin.operationId === operation.id && artifact.origin.frameId === frame.frameId &&
            artifact.origin.manifestArtifactId === manifest.id && artifact.origin.receiptId === receipt.receiptId &&
            artifact.origin.receiptContentId === event.data.receiptContentId;
        }),
      event,
      `frame sample ${operation.id} changed individual frame identities`,
    );
    operation.status = "completed";
    operation.manifestArtifactId = manifest.id;
    operation.receiptArtifactId = receiptArtifact.id;
    operation.receiptId = receipt.receiptId;
    operation.receiptContentId = event.data.receiptContentId;
    operation.frameArtifactIds = [...event.data.frameArtifactIds];
    return true;
  }

  if (event.type === "media.frames_sampling_failed") {
    invariant(event.producer.kind === "frame_host", event, "frame failure evidence must come from the frame host");
    const operation = next.frameSamples[event.data.operationId];
    invariant(operation?.status === "started", event, `frame sample ${event.data.operationId} is not active`);
    operation.status = "failed";
    operation.failure = event.data.reason;
    return true;
  }
  return false;
}
