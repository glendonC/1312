import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import {
  canonicalJsonContentId,
  canonicalSha256,
  ContentAddressedArtifactStore,
} from "./artifactStore.ts";
import type {
  ExecutorSpanReceipt,
  RuntimeProjection,
  SemanticEvidenceCitationInput,
  StudyClaim,
  StudyReportArtifact,
  StudyReportSubmissionBinding,
} from "./model.ts";
import { reopenSemanticEvidence } from "./semanticEvidenceAudit.ts";
import { validateExecutorSpanReceipt } from "./validation/execution.ts";
import {
  deriveStudyReportCounts,
  validateCoveragePartition,
  validateStudyReportArtifact,
} from "./validation/studyReports.ts";

export async function readCanonicalStoredJson(
  artifacts: ContentAddressedArtifactStore,
  contentId: string,
  maximumBytes: number,
  context: string,
): Promise<unknown> {
  const bytes = await artifacts.receiptBytes(contentId);
  if (bytes.byteLength <= 0 || bytes.byteLength > maximumBytes) throw new Error(`${context} exceeds its bounded JSON contract`);
  const measured = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  if (measured !== contentId) throw new Error(`${context} changed content identity`);
  let value: unknown;
  try {
    value = JSON.parse(bytes.toString("utf8")) as unknown;
  } catch {
    throw new Error(`${context} is invalid JSON`);
  }
  if (canonicalJsonContentId(value) !== contentId) throw new Error(`${context} is not canonical JSON`);
  return value;
}

function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function spanIdentity(receipt: ExecutorSpanReceipt): string {
  const body = structuredClone(receipt) as unknown as Record<string, unknown>;
  delete body.schema;
  delete body.receiptId;
  return `span:${canonicalSha256(body)}`;
}

function observationKey(citation: SemanticEvidenceCitationInput["observations"][number]): string {
  return `${citation.observationId}\u0000${citation.startMs}\u0000${citation.endMs}`;
}

function validateClaimCitationCoverage(claim: StudyClaim): void {
  const observations = claim.citations
    .flatMap((citation) => citation.observations)
    .sort((left, right) => left.startMs - right.startMs || left.endMs - right.endMs || left.observationId.localeCompare(right.observationId));
  let cursor = claim.startMs;
  for (const observation of observations) {
    if (observation.startMs !== cursor || observation.endMs > claim.endMs) {
      throw new Error(`Study claim ${claim.claimId} citations do not exactly close its supported range`);
    }
    cursor = observation.endMs;
  }
  if (cursor !== claim.endMs) throw new Error(`Study claim ${claim.claimId} citations leave an unsupported gap`);
}

export interface VerifiedStudyReport {
  artifact: RuntimeProjection["artifacts"][string];
  envelope: StudyReportArtifact;
  executorReceipt: ExecutorSpanReceipt;
  submission: StudyReportSubmissionBinding;
  semanticOperationIds: string[];
}

/** Reopens study bytes, every cited semantic observation, source bytes, grant/executor lineage, and derives submission facts. */
export async function reopenStudyReport(
  state: RuntimeProjection,
  artifacts: ContentAddressedArtifactStore,
  artifactId: string,
): Promise<VerifiedStudyReport> {
  const artifact = state.artifacts[artifactId];
  if (!artifact || artifact.origin.kind !== "study_report" || artifact.kind !== "studio.study-report.v1") {
    throw new Error("Study report artifact is absent or has the wrong typed origin");
  }
  const task = artifact.producerTaskId ? state.tasks[artifact.producerTaskId] : null;
  const execution = state.executions[artifact.origin.executionId];
  if (
    !task || !task.parentTaskId || !task.parentAgentId ||
    task.assignedAgentId !== artifact.producerAgentId ||
    execution?.status !== "completed" || execution.taskId !== task.id || execution.agentId !== task.assignedAgentId ||
    execution.receipt?.receiptId !== artifact.origin.receiptId ||
    !execution.outputArtifactIds.includes(artifact.id) ||
    artifact.origin.jobContextId !== task.jobContext.contextId ||
    !task.grants.some((grant) => grant.capability === "report.submit")
  ) throw new Error(`Study report ${artifact.id} lost its task, parent, grant, or completed executor lineage`);

  const artifactPath = await artifacts.resolveVerified(artifact);
  const [artifactValue, executorValue] = await Promise.all([
    readFile(artifactPath).then((bytes) => {
      const measured = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
      if (measured !== artifact.content.contentId || canonicalJsonContentId(JSON.parse(bytes.toString("utf8"))) !== artifact.content.contentId) {
        throw new Error("Stored study report changed content identity or canonical encoding");
      }
      return JSON.parse(bytes.toString("utf8")) as unknown;
    }),
    readCanonicalStoredJson(artifacts, artifact.origin.receiptContentId, 256 * 1024, "Stored study executor receipt"),
  ]);
  const envelope = validateStudyReportArtifact(artifactValue);
  validateExecutorSpanReceipt(executorValue, "Study report audit", "executorReceipt");
  const executorReceipt = executorValue;
  const expectedArtifactId = `artifact:${canonicalSha256({
    runId: state.runId,
    taskId: envelope.task.taskId,
    outputSlot: envelope.outputSlot,
    kind: "studio.study-report.v1",
    contentId: artifact.content.contentId,
  })}`;
  if (
    artifact.id !== expectedArtifactId || artifact.runId !== state.runId || envelope.runId !== state.runId ||
    envelope.task.taskId !== task.id || envelope.task.agentId !== task.assignedAgentId ||
    envelope.task.jobContextId !== task.jobContext.contextId ||
    envelope.parent.taskId !== task.parentTaskId || envelope.parent.agentId !== task.parentAgentId ||
    envelope.assignment.source.artifactId !== task.jobContext.source.artifactId ||
    envelope.assignment.source.contentId !== task.jobContext.source.contentId ||
    !same(envelope.assignment.mediaScope, task.mediaScope) ||
    !task.requiredOutputs.some((slot) => slot.required && slot.name === envelope.outputSlot.name && slot.artifactKind === envelope.outputSlot.artifactKind) ||
    executorReceipt.receiptId !== spanIdentity(executorReceipt) ||
    executorReceipt.receiptId !== artifact.origin.receiptId ||
    executorReceipt.executionId !== execution.id || executorReceipt.taskId !== task.id ||
    executorReceipt.agentId !== task.assignedAgentId || executorReceipt.outcome !== "completed" ||
    !executorReceipt.outputArtifactIds.includes(artifact.id)
  ) throw new Error(`Study report ${artifact.id} changed its assignment, output slot, parent, or executor identity`);
  validateCoveragePartition(envelope.coverage, task.mediaScope);
  const claims = new Map(envelope.claims.map((claim) => [claim.claimId, claim]));
  for (const range of envelope.coverage.filter((entry) => entry.state === "supported")) {
    for (const claimId of range.claimIds) {
      const claim = claims.get(claimId);
      if (!claim || claim.artifactId !== range.artifactId || claim.trackId !== range.trackId ||
          claim.startMs !== range.startMs || claim.endMs !== range.endMs) {
        throw new Error(`Study supported range references claim ${claimId} with a different exact range`);
      }
      validateClaimCitationCoverage(claim);
    }
  }

  const semanticOperationIds = new Set<string>();
  const semanticArtifacts = new Map<string, string>();
  const authenticatedInputs = new Map<string, {
    input: SemanticEvidenceCitationInput;
    observationStates: Map<string, string>;
  }>();
  for (const input of envelope.semanticEvidenceInputs) {
    const verified = await reopenSemanticEvidence(state, artifacts, input.operationId);
    const authenticatedObservations = verified.envelope.observations.map((observation) => ({
      observationId: observation.observationId,
      startMs: observation.range.startMs,
      endMs: observation.range.endMs,
    }));
    if (
      verified.envelope.authorization.taskId !== task.id ||
      verified.envelope.authorization.agentId !== task.assignedAgentId ||
      verified.envelope.authorization.executionId !== execution.id ||
      input.artifactId !== verified.artifactId || input.contentId !== verified.artifactContentId ||
      input.receiptId !== verified.receiptId || input.receiptContentId !== verified.receiptContentId ||
      !same(input.observations, authenticatedObservations)
    ) throw new Error(`Study report ${artifact.id} has an unsupported or cross-run semantic evidence input`);
    semanticOperationIds.add(input.operationId);
    semanticArtifacts.set(input.artifactId, input.contentId);
    authenticatedInputs.set(input.operationId, {
      input,
      observationStates: new Map(verified.envelope.observations.map((observation) => [
        observationKey({ observationId: observation.observationId, startMs: observation.range.startMs, endMs: observation.range.endMs }),
        observation.state,
      ])),
    });
  }
  for (const claim of envelope.claims) {
    for (const citation of claim.citations) {
      const authenticated = authenticatedInputs.get(citation.operationId);
      if (
        !authenticated ||
        citation.artifactId !== authenticated.input.artifactId ||
        citation.contentId !== authenticated.input.contentId ||
        citation.receiptId !== authenticated.input.receiptId ||
        citation.receiptContentId !== authenticated.input.receiptContentId ||
        citation.observations.some((observation) => authenticated.observationStates.get(observationKey(observation)) !== "available")
      ) throw new Error(`Study claim ${claim.claimId} has an unsupported, unavailable, or cross-run semantic citation`);
    }
  }
  const expectedSources = [
    { artifactId: task.jobContext.source.artifactId, contentId: task.jobContext.source.contentId },
    ...[...semanticArtifacts.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([sourceArtifactId, contentId]) => ({ artifactId: sourceArtifactId, contentId })),
  ];
  if (!same(envelope.sourceArtifacts, expectedSources) || !same(artifact.sourceArtifactIds, expectedSources.map((source) => source.artifactId))) {
    throw new Error(`Study report ${artifact.id} changed or omitted its source artifact identities`);
  }
  for (const source of expectedSources) {
    const sourceArtifact = state.artifacts[source.artifactId];
    if (!sourceArtifact || sourceArtifact.content.contentId !== source.contentId) {
      throw new Error(`Study report ${artifact.id} has an absent source artifact`);
    }
    await artifacts.resolveVerified(sourceArtifact);
  }

  const submission: StudyReportSubmissionBinding = {
    schema: "studio.study-report-submission.v1",
    jobContextId: task.jobContext.contextId,
    outputSlot: structuredClone(envelope.outputSlot),
    coverage: structuredClone(envelope.coverage),
    claims: structuredClone(envelope.claims),
    counts: deriveStudyReportCounts(envelope),
    output: {
      artifactId: artifact.id,
      contentId: artifact.content.contentId,
      bytes: artifact.content.bytes,
      schema: "studio.study-report.v1",
    },
    sourceArtifacts: structuredClone(envelope.sourceArtifacts),
    executor: {
      executionId: execution.id,
      receiptId: artifact.origin.receiptId,
      receiptContentId: artifact.origin.receiptContentId,
    },
    parentEdge: {
      childTaskId: task.id,
      childAgentId: task.assignedAgentId,
      parentTaskId: task.parentTaskId,
      parentAgentId: task.parentAgentId,
    },
  };
  return {
    artifact: structuredClone(artifact),
    envelope: structuredClone(envelope),
    executorReceipt: structuredClone(executorReceipt),
    submission,
    semanticOperationIds: [...semanticOperationIds].sort(),
  };
}
