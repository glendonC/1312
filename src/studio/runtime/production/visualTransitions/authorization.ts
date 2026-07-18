import { taskCapabilityCallCount, capabilityOperationExists } from "../capabilityUsage.ts";
import type { RuntimeArtifact } from "../model/artifacts.ts";
import type { OcrOperationRecord } from "../model/ocr.ts";
import type { RuntimeProjection } from "../model/projection.ts";
import type { CapabilityGrant, MediaScope } from "../model/tasks.ts";
import type {
  VisualTransitionGrantScope,
  VisualTransitionOperationRecord,
  VisualTransitionRequest,
} from "../model/visualTransitions.ts";
import {
  assertVisualTransitionRequest,
  visualTransitionRequestFingerprint,
} from "../validation/visualTransitions.ts";

type VisualTransitionProjection = RuntimeProjection & {
  visualTransitionOperations: Record<string, VisualTransitionOperationRecord>;
};

export interface AuthorizedVisualTransition {
  request: VisualTransitionRequest;
  grant: CapabilityGrant & { visualTransitionScope: VisualTransitionGrantScope };
  scope: MediaScope;
  artifact: RuntimeArtifact;
  frameOperation: RuntimeProjection["frameSamples"][string];
  ocrOperation: OcrOperationRecord;
  executionId: string;
  launchClaimId: string;
  requestFingerprint: string;
}

export function authorizeVisualTransition(
  projection: RuntimeProjection,
  requestValue: unknown,
): AuthorizedVisualTransition {
  assertVisualTransitionRequest(requestValue);
  const state = projection as VisualTransitionProjection;
  const request = requestValue;
  const task = state.tasks[request.taskId];
  if (!task || task.status !== "working" || task.ownerAgentId !== request.agentId) {
    throw new Error("Visual-transition analysis requires a working task owned by the requesting agent");
  }
  if (capabilityOperationExists(state, request.operationId) || state.visualTransitionOperations[request.operationId]) {
    throw new Error(`Visual-transition operation ${request.operationId} already exists`);
  }
  const grant = task.grants.find((candidate) => candidate.id === request.grantId);
  if (grant?.capability !== "media.visual-transitions.analyze" || !grant.visualTransitionScope || grant.mediaScope.length !== 1) {
    throw new Error("Visual-transition analysis requires its exact scheduler-issued grant");
  }
  const frameOperation = state.frameSamples[request.frameSamplingOperationId];
  const ocrOperation = state.ocrOperations[request.ocrOperationId];
  if (!frameOperation || frameOperation.status !== "completed" || !ocrOperation || ocrOperation.status !== "completed" ||
      frameOperation.taskId !== task.id || ocrOperation.taskId !== task.id ||
      frameOperation.agentId !== request.agentId || ocrOperation.agentId !== request.agentId ||
      ocrOperation.frameSamplingOperationId !== frameOperation.id ||
      frameOperation.frameArtifactIds.length < grant.visualTransitionScope.limits.minFrames ||
      frameOperation.frameArtifactIds.length > grant.visualTransitionScope.limits.maxFrames) {
    throw new Error("Visual-transition analysis requires exact completed same-task U2 and U5 operations");
  }
  const scope = grant.mediaScope[0];
  if (frameOperation.sourceArtifactId !== scope.artifactId || ocrOperation.sourceArtifactId !== scope.artifactId ||
      frameOperation.trackId !== scope.trackId || ocrOperation.trackId !== scope.trackId ||
      frameOperation.startMs !== scope.startMs || ocrOperation.startMs !== scope.startMs ||
      frameOperation.endMs !== scope.endMs || ocrOperation.endMs !== scope.endMs) {
    throw new Error("Visual-transition U2/U5 lineage changed from its scheduler-injected media scope");
  }
  const artifact = state.artifacts[scope.artifactId];
  if (!artifact || artifact.origin.kind !== "ingest" || artifact.runId !== state.runId ||
      task.jobContext.source.artifactId !== artifact.id || task.jobContext.source.contentId !== artifact.content.contentId ||
      !artifact.tracks.some((track) => track.id === scope.trackId && track.kind === "video")) {
    throw new Error("Visual-transition source changed from the immutable owned-video task context");
  }
  if (taskCapabilityCallCount(state, task.id) >= task.budget.toolCalls) {
    throw new Error("Visual-transition analysis exceeds the task tool-call budget");
  }
  if (Object.values(state.visualTransitionOperations).filter((operation) => operation.grantId === grant.id).length >= grant.visualTransitionScope.limits.maxCalls) {
    throw new Error("Visual-transition analysis exceeds the grant call budget");
  }
  const frames = frameOperation.frameArtifactIds.map((artifactId) => {
    const frame = state.artifacts[artifactId];
    if (!frame || frame.origin.kind !== "sampled_frame" || frame.origin.operationId !== frameOperation.id) {
      throw new Error("Visual-transition frame operation has incomplete projected U2 lineage");
    }
    return { frameId: frame.origin.frameId, contentId: frame.content.contentId };
  });
  const requestFingerprint = visualTransitionRequestFingerprint({
    sourceContentId: artifact.content.contentId,
    trackId: scope.trackId,
    startMs: scope.startMs,
    endMs: scope.endMs,
    frameSamplingOperationId: frameOperation.id,
    ocrOperationId: ocrOperation.id,
    frameIds: frames.map((frame) => frame.frameId),
    frameContentIds: frames.map((frame) => frame.contentId),
  });
  if (Object.values(state.visualTransitionOperations).some((operation) => operation.taskId === task.id && operation.requestFingerprint === requestFingerprint)) {
    throw new Error("Visual-transition analysis rejects duplicate canonical work");
  }
  const executions = Object.values(state.executions).filter((execution) =>
    execution.taskId === task.id && execution.agentId === request.agentId && execution.status === "active");
  if (executions.length !== 1) throw new Error("Visual-transition analysis requires one active task executor");
  const execution = executions[0];
  const launch = state.taskLaunches[task.id];
  if (!launch || launch.executionId !== execution.id || launch.agentId !== request.agentId ||
      frameOperation.executionId !== execution.id || ocrOperation.executionId !== execution.id ||
      frameOperation.launchClaimId !== launch.id || ocrOperation.launchClaimId !== launch.id) {
    throw new Error("Visual-transition U2/U5 inputs lost same-executor launch lineage");
  }
  return {
    request,
    grant: grant as CapabilityGrant & { visualTransitionScope: VisualTransitionGrantScope },
    scope,
    artifact,
    frameOperation,
    ocrOperation,
    executionId: execution.id,
    launchClaimId: launch.id,
    requestFingerprint,
  };
}
