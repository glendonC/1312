import { assertMediaExtractRequest, assertMediaSeekRequest } from "./assertions.ts";
import type {
  Capability,
  CapabilityGrant,
  EvidenceReadRequest,
  EvidenceReadScope,
  MediaExtractRequest,
  MediaSeekRequest,
  MediaTrackDescriptor,
  RuntimeArtifact,
  RuntimeProjection,
} from "./model.ts";
import { assertEvidenceReadRequest } from "./validation/evidence.ts";

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
  const priorCalls = [
    ...Object.values(state.operations),
    ...Object.values(state.evidenceReads),
  ].filter((operation) => operation.taskId === task.id).length;
  if (priorCalls >= task.budget.toolCalls) throw new Error(`${operation} exceeds the task tool-call budget`);
  return { request, grant, artifact, track };
}

export interface AuthorizedEvidenceRead {
  request: EvidenceReadRequest;
  grant: CapabilityGrant;
  scope: EvidenceReadScope;
  artifact: RuntimeArtifact;
  remainingBytes: number;
  remainingItems: number;
}

export function authorizeEvidenceRead(
  state: RuntimeProjection,
  requestValue: unknown,
): AuthorizedEvidenceRead {
  assertEvidenceReadRequest(requestValue);
  const request = requestValue;
  const task = state.tasks[request.taskId];
  if (!task || task.status !== "working" || task.ownerAgentId !== request.agentId) {
    throw new Error("Evidence read requires a working task owned by the requesting agent");
  }
  if (state.evidenceReads[request.operationId] || state.operations[request.operationId]) {
    throw new Error(`Evidence read operation ${request.operationId} already exists`);
  }
  const artifact = state.artifacts[request.artifactId];
  if (!artifact || artifact.runId !== state.runId || artifact.origin.kind !== "preflight_evidence") {
    throw new Error("Evidence read input is not registered producer evidence");
  }
  const evidenceKind = artifact.origin.evidenceKind;
  const grant = task.grants.find((candidate) =>
    candidate.capability === "evidence.read" &&
    candidate.evidenceScope.some((scope) =>
      scope.artifactId === artifact.id && scope.evidenceKind === evidenceKind));
  const scope = grant?.evidenceScope.find((candidate) =>
    candidate.artifactId === artifact.id && candidate.evidenceKind === evidenceKind);
  if (!grant || !scope) throw new Error("Evidence read is outside the task's authoritative artifact grant");
  const priorCalls = [
    ...Object.values(state.operations),
    ...Object.values(state.evidenceReads),
  ].filter((operation) => operation.taskId === task.id).length;
  if (priorCalls >= task.budget.toolCalls) throw new Error("Evidence read exceeds the task tool-call budget");
  const priorReads = Object.values(state.evidenceReads).filter(
    (operation) =>
      operation.taskId === task.id &&
      operation.grantId === grant.id &&
      operation.artifactId === artifact.id &&
      operation.status === "completed",
  );
  const usedBytes = priorReads.reduce((sum, operation) => sum + (operation.returnedFactBytes ?? 0), 0);
  const usedItems = priorReads.reduce((sum, operation) => sum + (operation.returnedItems ?? 0), 0);
  const remainingBytes = scope.maxBytes - usedBytes;
  const remainingItems = scope.maxItems - usedItems;
  if (remainingBytes <= 0 || remainingItems <= 0) {
    throw new Error("Evidence read exceeds the grant's byte or item budget");
  }
  return { request, grant, scope, artifact, remainingBytes, remainingItems };
}

export function authorizeMediaExtract(state: RuntimeProjection, requestValue: unknown): AuthorizedMediaExtract {
  assertMediaExtractRequest(requestValue);
  return authorizeMediaRange(state, requestValue, "media.extract");
}

export function authorizeMediaSeek(state: RuntimeProjection, requestValue: unknown): AuthorizedMediaSeek {
  assertMediaSeekRequest(requestValue);
  return authorizeMediaRange(state, requestValue, "media.seek");
}
