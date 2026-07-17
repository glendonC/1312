import {
  assertFrameSampleRequest,
  assertMediaExtractRequest,
  assertMediaSeekRequest,
  assertSpeechTranscribeRequest,
} from "./assertions.ts";
import type {
  Capability,
  CapabilityGrant,
  EvidenceAssessmentRecord,
  EvidenceAssessmentRequest,
  EvidenceAssessmentScope,
  EvidenceDecisionRequest,
  EvidenceDecisionScope,
  EvidenceReadRecord,
  EvidenceReadRequest,
  EvidenceReadScope,
  FrameSampleRequest,
  FrameSamplingGrantScope,
  MediaExtractRequest,
  MediaScope,
  MediaSeekRequest,
  MediaTrackDescriptor,
  SpeechTranscribeRequest,
  RuntimeArtifact,
  RuntimeProjection,
} from "./model.ts";
import { assertEvidenceReadRequest } from "./validation/evidence.ts";
import { assertEvidenceAssessmentRequest, countAssessmentTokens } from "./validation/assessment.ts";
import { assertEvidenceDecisionRequest } from "./validation/decision.ts";
import { capabilityOperationExists, taskCapabilityCallCount } from "./capabilityUsage.ts";
import { frameSamplingRequestFingerprint } from "./validation/frames.ts";

export interface AuthorizedFrameSampling {
  request: FrameSampleRequest;
  grant: CapabilityGrant & { frameScope: FrameSamplingGrantScope };
  scope: MediaScope;
  artifact: RuntimeArtifact;
  track: MediaTrackDescriptor;
  executionId: string;
  launchClaimId: string;
  requestFingerprint: string;
}

export function authorizeFrameSampling(
  state: RuntimeProjection,
  requestValue: unknown,
): AuthorizedFrameSampling {
  assertFrameSampleRequest(requestValue);
  const request = requestValue;
  const task = state.tasks[request.taskId];
  if (!task || task.status !== "working" || task.ownerAgentId !== request.agentId) {
    throw new Error("Frame sampling requires a working task owned by the requesting agent");
  }
  if (capabilityOperationExists(state, request.operationId)) {
    throw new Error(`Frame sampling operation ${request.operationId} already exists`);
  }
  const grant = task.grants.find((candidate) => candidate.id === request.grantId);
  if (grant?.capability !== "media.frames.sample" || !grant.frameScope || grant.mediaScope.length !== 1) {
    throw new Error("Frame sampling requires its exact scheduler-issued frame grant");
  }
  const scope = grant.mediaScope[0];
  const artifact = state.artifacts[scope.artifactId];
  if (
    !artifact || artifact.runId !== state.runId || artifact.origin.kind !== "ingest" ||
    task.jobContext.source.artifactId !== artifact.id ||
    task.jobContext.source.contentId !== artifact.content.contentId
  ) {
    throw new Error("Frame sampling source changed from the immutable task context");
  }
  const track = artifact.tracks.find((candidate) => candidate.id === scope.trackId);
  if (!track || track.kind !== "video") throw new Error("Frame sampling requires one registered video track");
  if (
    artifact.durationMs === null ||
    scope.endMs > artifact.durationMs ||
    scope.endMs - scope.startMs > grant.frameScope.limits.maxDurationMs ||
    request.requestedTimestampsMs.some((timestamp) => timestamp < scope.startMs || timestamp >= scope.endMs)
  ) {
    throw new Error("Frame sampling request is outside its scheduler-granted source and video-track window");
  }
  if (taskCapabilityCallCount(state, task.id) >= task.budget.toolCalls) {
    throw new Error("Frame sampling exceeds the task tool-call budget");
  }
  if (Object.values(state.frameSamples).filter((sample) => sample.grantId === grant.id).length >= grant.frameScope.limits.maxCalls) {
    throw new Error("Frame sampling exceeds the grant call budget");
  }
  const requestFingerprint = frameSamplingRequestFingerprint({
    sourceContentId: artifact.content.contentId,
    trackId: scope.trackId,
    startMs: scope.startMs,
    endMs: scope.endMs,
    requestedTimestampsMs: request.requestedTimestampsMs,
  });
  if (Object.values(state.frameSamples).some((sample) =>
    sample.taskId === task.id && sample.requestFingerprint === requestFingerprint)) {
    throw new Error("Frame sampling rejects duplicate canonical work");
  }
  const executions = Object.values(state.executions).filter((execution) =>
    execution.taskId === task.id && execution.agentId === request.agentId && execution.status === "active");
  if (executions.length !== 1) throw new Error("Frame sampling requires one active task executor");
  const execution = executions[0];
  const launch = state.taskLaunches[task.id];
  if (!launch || launch.executionId !== execution.id || launch.agentId !== request.agentId) {
    throw new Error("Frame sampling executor lost its durable launch lineage");
  }
  return {
    request,
    grant: grant as CapabilityGrant & { frameScope: FrameSamplingGrantScope },
    scope,
    artifact,
    track,
    executionId: execution.id,
    launchClaimId: launch.id,
    requestFingerprint,
  };
}

export interface AuthorizedSpeechTranscribe {
  request: SpeechTranscribeRequest;
  grant: CapabilityGrant;
  artifact: RuntimeArtifact;
  track: MediaTrackDescriptor;
  executionId: string;
  launchClaimId: string;
}

export function authorizeSpeechTranscribe(
  state: RuntimeProjection,
  requestValue: unknown,
): AuthorizedSpeechTranscribe {
  assertSpeechTranscribeRequest(requestValue);
  const request = requestValue;
  const task = state.tasks[request.taskId];
  if (!task || task.status !== "working" || task.ownerAgentId !== request.agentId) {
    throw new Error("Speech transcription requires a working task owned by the requesting agent");
  }
  if (capabilityOperationExists(state, request.operationId)) {
    throw new Error(`Speech transcription operation ${request.operationId} already exists`);
  }
  const artifact = state.artifacts[request.artifactId];
  if (!artifact || artifact.runId !== state.runId || artifact.origin.kind !== "ingest") {
    throw new Error("Speech transcription input must be the registered owned source artifact");
  }
  if (
    task.jobContext.source.artifactId !== artifact.id ||
    task.jobContext.source.contentId !== artifact.content.contentId
  ) throw new Error("Speech transcription source changed from the immutable task context");
  const track = artifact.tracks.find((candidate) => candidate.id === request.trackId);
  if (!track || track.kind !== "audio") throw new Error("Speech transcription requires one registered audio track");
  if (request.endMs > (artifact.durationMs ?? 0)) throw new Error("Speech transcription exceeds the measured source duration");
  const grant = task.grants.find((candidate) =>
    candidate.capability === "speech.transcribe" &&
    candidate.mediaScope.some((scope) =>
      scope.artifactId === request.artifactId &&
      scope.trackId === request.trackId &&
      request.startMs >= scope.startMs &&
      request.endMs <= scope.endMs));
  if (!grant) throw new Error("Speech transcription is outside the task's authoritative capability grant");
  if (taskCapabilityCallCount(state, task.id) >= task.budget.toolCalls) {
    throw new Error("Speech transcription exceeds the task tool-call budget");
  }
  const executions = Object.values(state.executions).filter((execution) =>
    execution.taskId === task.id && execution.agentId === request.agentId && execution.status === "active");
  if (executions.length !== 1) throw new Error("Speech transcription requires one active task executor");
  const execution = executions[0];
  const launch = state.taskLaunches[task.id];
  if (!launch || launch.executionId !== execution.id || launch.agentId !== request.agentId) {
    throw new Error("Speech transcription executor lost its durable launch lineage");
  }
  return { request, grant, artifact, track, executionId: execution.id, launchClaimId: launch.id };
}

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
  if (capabilityOperationExists(state, request.operationId)) {
    throw new Error(`Media operation ${request.operationId} already exists`);
  }
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
  const priorCalls = taskCapabilityCallCount(state, task.id);
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
  if (capabilityOperationExists(state, request.operationId)) {
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
  if (
    artifact.sourceArtifactIds.length !== 1 ||
    artifact.sourceArtifactIds[0] !== scope.sourceArtifactId ||
    !task.mediaScope.some((mediaScope) =>
      mediaScope.artifactId === scope.sourceArtifactId &&
      mediaScope.startMs === scope.startMs &&
      mediaScope.endMs === scope.endMs)
  ) {
    throw new Error("Evidence read grant is no longer bound to the task's exact source window");
  }
  const priorCalls = taskCapabilityCallCount(state, task.id);
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

export interface AuthorizedEvidenceAssessment {
  request: EvidenceAssessmentRequest;
  grant: CapabilityGrant;
  scope: EvidenceAssessmentScope;
  reads: EvidenceReadRecord[];
  claimCount: number;
  citationCount: number;
  tokenCount: number;
}

export function authorizeEvidenceAssessment(
  state: RuntimeProjection,
  requestValue: unknown,
): AuthorizedEvidenceAssessment {
  assertEvidenceAssessmentRequest(requestValue);
  const request = requestValue;
  const task = state.tasks[request.taskId];
  if (!task || task.status !== "working" || task.ownerAgentId !== request.agentId) {
    throw new Error("Evidence assessment requires a working task owned by the requesting agent");
  }
  if (capabilityOperationExists(state, request.operationId)) {
    throw new Error(`Evidence assessment operation ${request.operationId} already exists`);
  }
  const grant = task.grants.find((candidate) =>
    candidate.capability === "analysis.evidence.assess" && candidate.assessmentScope !== null);
  const scope = grant?.assessmentScope;
  if (!grant || !scope) throw new Error("Evidence assessment is outside the task's authoritative grant");
  if (taskCapabilityCallCount(state, task.id) >= task.budget.toolCalls) {
    throw new Error("Evidence assessment exceeds the task tool-call budget");
  }
  const prior = Object.values(state.evidenceAssessments).filter(
    (operation) => operation.taskId === task.id && operation.grantId === grant.id,
  );
  if (prior.length >= scope.maxAssessments) {
    throw new Error("Evidence assessment exceeds the grant's assessment-count budget");
  }
  if (request.readReceipts.length > scope.maxReadReceipts) {
    throw new Error("Evidence assessment exceeds the grant's read-receipt budget");
  }
  const reads = request.readReceipts.map((identity) => {
    const read = Object.values(state.evidenceReads).find((candidate) =>
      candidate.status === "completed" &&
      candidate.taskId === task.id &&
      candidate.agentId === request.agentId &&
      candidate.receiptId === identity.receiptId &&
      candidate.receiptContentId === identity.receiptContentId);
    if (!read || !scope.evidenceArtifactIds.includes(read.artifactId)) {
      throw new Error("Evidence assessment input is not a completed, granted evidence-read receipt");
    }
    return read;
  });
  const claimCount = request.claims.length;
  const citationCount = request.claims.reduce(
    (total, claim) => total + claim.citations.reduce((subtotal, citation) => subtotal + citation.factIndexes.length, 0),
    0,
  );
  const tokenCount = countAssessmentTokens(request.claims);
  if (claimCount > scope.maxClaims || citationCount > scope.maxCitations || tokenCount > scope.maxTokens) {
    throw new Error("Evidence assessment exceeds the grant's claim, citation, or token budget");
  }
  return { request, grant, scope, reads, claimCount, citationCount, tokenCount };
}

export interface AuthorizedEvidenceDecision {
  request: EvidenceDecisionRequest;
  grant: CapabilityGrant;
  scope: EvidenceDecisionScope;
  assessments: EvidenceAssessmentRecord[];
}

export function authorizeEvidenceDecision(
  state: RuntimeProjection,
  requestValue: unknown,
): AuthorizedEvidenceDecision {
  assertEvidenceDecisionRequest(requestValue);
  const request = requestValue;
  const task = state.tasks[request.taskId];
  if (!task || task.status !== "working" || task.ownerAgentId !== request.agentId) {
    throw new Error("Evidence decision requires a working task owned by the requesting agent");
  }
  if (capabilityOperationExists(state, request.operationId)) {
    throw new Error(`Evidence decision operation ${request.operationId} already exists`);
  }
  const grant = task.grants.find((candidate) =>
    candidate.capability === "analysis.evidence.decide" && candidate.decisionScope !== null);
  const scope = grant?.decisionScope;
  if (!grant || !scope) throw new Error("Evidence decision is outside the task's authoritative grant");
  if (taskCapabilityCallCount(state, task.id) >= task.budget.toolCalls) {
    throw new Error("Evidence decision exceeds the task tool-call budget");
  }
  const prior = Object.values(state.evidenceDecisions).filter(
    (operation) => operation.taskId === task.id && operation.grantId === grant.id,
  );
  if (prior.length >= scope.maxDecisions) {
    throw new Error("Evidence decision exceeds the grant's decision-count budget");
  }
  if (request.auditedAssessments.length > scope.maxAuditedAssessments) {
    throw new Error("Evidence decision exceeds the grant's audited-assessment budget");
  }
  const assessments = request.auditedAssessments.map((identity) => {
    const assessment = state.evidenceAssessments[identity.operationId];
    if (
      !assessment ||
      assessment.status !== "completed" ||
      assessment.taskId !== task.id ||
      assessment.agentId !== request.agentId ||
      assessment.artifactId !== identity.artifactId ||
      assessment.receiptId !== identity.receiptId ||
      assessment.receiptContentId !== identity.receiptContentId
    ) throw new Error("Evidence decision input is not a completed same-task assessment identity");
    return assessment;
  });
  return { request, grant, scope, assessments };
}

export function authorizeMediaExtract(state: RuntimeProjection, requestValue: unknown): AuthorizedMediaExtract {
  assertMediaExtractRequest(requestValue);
  return authorizeMediaRange(state, requestValue, "media.extract");
}

export function authorizeMediaSeek(state: RuntimeProjection, requestValue: unknown): AuthorizedMediaSeek {
  assertMediaSeekRequest(requestValue);
  return authorizeMediaRange(state, requestValue, "media.seek");
}
