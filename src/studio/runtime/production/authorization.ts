import { assertMediaExtractRequest } from "./assertions.ts";
import type {
  CapabilityGrant,
  MediaExtractRequest,
  MediaTrackDescriptor,
  RuntimeArtifact,
  RuntimeProjection,
} from "./model.ts";

export interface AuthorizedMediaExtract {
  request: MediaExtractRequest;
  grant: CapabilityGrant;
  artifact: RuntimeArtifact;
  track: MediaTrackDescriptor;
}

export function authorizeMediaExtract(state: RuntimeProjection, requestValue: unknown): AuthorizedMediaExtract {
  assertMediaExtractRequest(requestValue);
  const request = requestValue;
  const task = state.tasks[request.taskId];
  if (!task || task.status !== "working" || task.ownerAgentId !== request.agentId) {
    throw new Error("Media extraction requires a working task owned by the requesting agent");
  }
  if (state.operations[request.operationId]) throw new Error(`Media operation ${request.operationId} already exists`);
  const artifact = state.artifacts[request.artifactId];
  if (!artifact || artifact.runId !== state.runId) throw new Error("Media extraction input artifact is unavailable");
  const track = artifact.tracks.find((candidate) => candidate.id === request.trackId);
  if (!track || track.kind !== "audio") throw new Error("Media extraction requires a registered audio track");
  if (request.endMs > (artifact.durationMs ?? 0)) throw new Error("Media extraction exceeds the measured artifact duration");
  const grant = task.grants.find(
    (candidate) =>
      candidate.capability === "media.extract" &&
      candidate.mediaScope.some(
        (scope) =>
          scope.artifactId === request.artifactId &&
          scope.trackId === request.trackId &&
          request.startMs >= scope.startMs &&
          request.endMs <= scope.endMs,
      ),
  );
  if (!grant) throw new Error("Media extraction is outside the task's authoritative capability grant");
  const priorCalls = Object.values(state.operations).filter((operation) => operation.taskId === task.id).length;
  if (priorCalls >= task.budget.toolCalls) throw new Error("Media extraction exceeds the task tool-call budget");
  return { request, grant, artifact, track };
}
