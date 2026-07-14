import { assertMediaExtractRequest, assertMediaSeekRequest } from "./assertions.ts";
import type {
  Capability,
  CapabilityGrant,
  MediaExtractRequest,
  MediaSeekRequest,
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

export interface AuthorizedMediaSeek {
  request: MediaSeekRequest;
  grant: CapabilityGrant;
  artifact: RuntimeArtifact;
  track: MediaTrackDescriptor;
}

function authorizeMediaRange<Request extends MediaExtractRequest | MediaSeekRequest>(
  state: RuntimeProjection,
  request: Request,
  capability: Extract<Capability, "media.extract" | "media.seek">,
): { request: Request; grant: CapabilityGrant; artifact: RuntimeArtifact; track: MediaTrackDescriptor } {
  const operation = capability === "media.extract" ? "Media extraction" : "Media seek";
  const task = state.tasks[request.taskId];
  if (!task || task.status !== "working" || task.ownerAgentId !== request.agentId) {
    throw new Error(`${operation} requires a working task owned by the requesting agent`);
  }
  if (state.operations[request.operationId]) throw new Error(`Media operation ${request.operationId} already exists`);
  const artifact = state.artifacts[request.artifactId];
  if (!artifact || artifact.runId !== state.runId) throw new Error(`${operation} input artifact is unavailable`);
  const track = artifact.tracks.find((candidate) => candidate.id === request.trackId);
  if (!track || track.kind !== "audio") throw new Error(`${operation} requires a registered audio track`);
  if (request.endMs > (artifact.durationMs ?? 0)) throw new Error(`${operation} exceeds the measured artifact duration`);
  const grant = task.grants.find(
    (candidate) =>
      candidate.capability === capability &&
      candidate.mediaScope.some(
        (scope) =>
          scope.artifactId === request.artifactId &&
          scope.trackId === request.trackId &&
          request.startMs >= scope.startMs &&
          request.endMs <= scope.endMs,
      ),
  );
  if (!grant) throw new Error(`${operation} is outside the task's authoritative capability grant`);
  const priorCalls = Object.values(state.operations).filter((operation) => operation.taskId === task.id).length;
  if (priorCalls >= task.budget.toolCalls) throw new Error(`${operation} exceeds the task tool-call budget`);
  return { request, grant, artifact, track };
}

export function authorizeMediaExtract(state: RuntimeProjection, requestValue: unknown): AuthorizedMediaExtract {
  assertMediaExtractRequest(requestValue);
  return authorizeMediaRange(state, requestValue, "media.extract");
}

export function authorizeMediaSeek(state: RuntimeProjection, requestValue: unknown): AuthorizedMediaSeek {
  assertMediaSeekRequest(requestValue);
  return authorizeMediaRange(state, requestValue, "media.seek");
}
