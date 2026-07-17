import { assertRuntimeArtifact } from "../assertions.ts";
import type {
  ContentIdentity,
  EvidenceAssessmentReceipt,
  EvidenceDecisionReceipt,
  ExecutorSpanReceipt,
  MediaTrackDescriptor,
  ParentArtifactAdmissionReceipt,
  ParentArtifactDispositionReceipt,
  RootOutputDispositionReceipt,
  RuntimeArtifact,
  SemanticMediaEvidenceArtifact,
  WorkerOutputEnvelope,
} from "../model.ts";
import { canonicalSha256 } from "./contentIdentity.ts";

export function buildSemanticEvidenceArtifact(input: {
    runId: string;
    receiptId: string;
    receiptContentId: string;
    prepared: {
      artifactId: string;
      envelope: SemanticMediaEvidenceArtifact;
      content: ContentIdentity;
      storageKey: string;
    };
  }): RuntimeArtifact {
    const envelope = input.prepared.envelope;
    const artifact: RuntimeArtifact = {
      schema: "studio.runtime.artifact.v1",
      id: input.prepared.artifactId,
      runId: input.runId,
      kind: "studio.semantic-media-evidence.v1",
      mediaClass: "non_media",
      publication: "private",
      content: input.prepared.content,
      storageKey: input.prepared.storageKey,
      durationMs: null,
      tracks: [],
      sourceArtifactIds: [envelope.source.artifactId],
      producerTaskId: envelope.authorization.taskId,
      producerAgentId: envelope.authorization.agentId,
      origin: {
        kind: "semantic_media_evidence",
        operationId: envelope.operationId,
        receiptId: input.receiptId,
        receiptContentId: input.receiptContentId,
        availabilityId: envelope.availability.id,
      },
    };
    assertRuntimeArtifact(artifact);
    return artifact;
  }

export function buildWorkerOutputArtifact(input: {
    runId: string;
    receipt: ExecutorSpanReceipt;
    receiptContentId: string;
    prepared: {
      artifactId: string;
      envelope: WorkerOutputEnvelope;
      content: ContentIdentity;
      storageKey: string;
    };
  }): RuntimeArtifact {
    const { envelope } = input.prepared;
    if (
      envelope.executionId !== input.receipt.executionId ||
      envelope.taskId !== input.receipt.taskId ||
      envelope.agentId !== input.receipt.agentId ||
      !input.receipt.outputArtifactIds.includes(input.prepared.artifactId)
    ) {
      throw new Error("Worker output envelope does not match its executor receipt");
    }
    const artifact: RuntimeArtifact = {
      schema: "studio.runtime.artifact.v1",
      id: input.prepared.artifactId,
      runId: input.runId,
      kind: envelope.output.kind,
      mediaClass: "non_media",
      publication: "private",
      content: input.prepared.content,
      storageKey: input.prepared.storageKey,
      durationMs: null,
      tracks: [],
      sourceArtifactIds: [],
      producerTaskId: envelope.taskId,
      producerAgentId: envelope.agentId,
      origin: {
        kind: "worker_output",
        executionId: envelope.executionId,
        receiptId: input.receipt.receiptId,
        receiptContentId: input.receiptContentId,
      },
    };
    assertRuntimeArtifact(artifact);
    return artifact;
  }

export function buildParentAdmissionArtifact(input: {
    runId: string;
    receipt: ParentArtifactAdmissionReceipt;
    storedReceipt: { content: ContentIdentity; storageKey: string };
  }): RuntimeArtifact {
    const admitted = input.receipt.admitted[0];
    if (!admitted || input.receipt.admitted.length !== 1) throw new Error("Parent admission requires one exact study artifact");
    const artifact: RuntimeArtifact = {
      schema: "studio.runtime.artifact.v1",
      id: `artifact:${canonicalSha256({ runId: input.runId, admissionId: input.receipt.admissionId, kind: "parent-admission-receipt", contentId: input.storedReceipt.content.contentId })}`,
      runId: input.runId,
      kind: "parent-admission-receipt",
      mediaClass: "non_media",
      publication: "private",
      content: input.storedReceipt.content,
      storageKey: input.storedReceipt.storageKey,
      durationMs: null,
      tracks: [],
      sourceArtifactIds: [admitted.artifactId],
      producerTaskId: input.receipt.parent.taskId,
      producerAgentId: input.receipt.parent.agentId,
      origin: {
        kind: "parent_admission",
        admissionId: input.receipt.admissionId,
        dispositionId: input.receipt.dispositionId,
        reportId: input.receipt.reportId,
        inputArtifactId: admitted.artifactId,
        grantId: input.receipt.grant.id,
        receiptId: input.receipt.receiptId,
        receiptContentId: input.storedReceipt.content.contentId,
      },
    };
    assertRuntimeArtifact(artifact);
    return artifact;
  }

export function buildParentArtifactDispositionArtifact(input: {
    runId: string;
    receipt: ParentArtifactDispositionReceipt;
    storedReceipt: { content: ContentIdentity; storageKey: string };
  }): RuntimeArtifact {
    const artifact: RuntimeArtifact = {
      schema: "studio.runtime.artifact.v1",
      id: `artifact:${canonicalSha256({ runId: input.runId, dispositionId: input.receipt.dispositionId, kind: "parent-artifact-disposition-receipt", contentId: input.storedReceipt.content.contentId })}`,
      runId: input.runId,
      kind: input.receipt.decision.outcome === "accepted" ? "parent-accepted-artifact-receipt" : "parent-rejected-artifact-receipt",
      mediaClass: "non_media",
      publication: "private",
      content: input.storedReceipt.content,
      storageKey: input.storedReceipt.storageKey,
      durationMs: null,
      tracks: [],
      sourceArtifactIds: [input.receipt.output.artifactId],
      producerTaskId: input.receipt.parent.taskId,
      producerAgentId: input.receipt.parent.agentId,
      origin: {
        kind: "parent_artifact_disposition",
        dispositionId: input.receipt.dispositionId,
        reportId: input.receipt.report.reportId,
        inputArtifactId: input.receipt.output.artifactId,
        outcome: input.receipt.decision.outcome,
        receiptId: input.receipt.receiptId,
        receiptContentId: input.storedReceipt.content.contentId,
      },
    };
    assertRuntimeArtifact(artifact);
    return artifact;
  }

export function buildRootOutputDispositionArtifact(input: {
    runId: string;
    receipt: RootOutputDispositionReceipt;
    storedReceipt: { content: ContentIdentity; storageKey: string };
  }): RuntimeArtifact {
    const artifact: RuntimeArtifact = {
      schema: "studio.runtime.artifact.v1",
      id: `artifact:${canonicalSha256({
        runId: input.runId,
        dispositionId: input.receipt.dispositionId,
        kind: "root-output-disposition-receipt",
        contentId: input.storedReceipt.content.contentId,
      })}`,
      runId: input.runId,
      kind: input.receipt.decision.outcome === "promoted_to_root"
        ? "root-promoted-output-receipt"
        : "root-rejected-output-receipt",
      mediaClass: "non_media",
      publication: "private",
      content: input.storedReceipt.content,
      storageKey: input.storedReceipt.storageKey,
      durationMs: null,
      tracks: [],
      sourceArtifactIds: [input.receipt.input.artifactId],
      producerTaskId: input.receipt.authority.rootTaskId,
      producerAgentId: input.receipt.authority.rootAgentId,
      origin: {
        kind: "root_output_disposition",
        dispositionId: input.receipt.dispositionId,
        reportId: input.receipt.report.reportId,
        inputArtifactId: input.receipt.input.artifactId,
        outcome: input.receipt.decision.outcome,
        receiptId: input.receipt.receiptId,
        receiptContentId: input.storedReceipt.content.contentId,
      },
    };
    assertRuntimeArtifact(artifact);
    return artifact;
  }

export function buildDerivedArtifact(input: {
    runId: string;
    kind: string;
    operationId: string;
    receiptId: string;
    receiptContentId: string;
    publication: "private" | "public";
    durationMs: number;
    tracks: MediaTrackDescriptor[];
    sourceArtifactIds: string[];
    producerTaskId: string;
    producerAgentId: string;
    prepared: { artifactId: string; content: ContentIdentity; storageKey: string };
  }): RuntimeArtifact {
    const artifact: RuntimeArtifact = {
      schema: "studio.runtime.artifact.v1",
      id: input.prepared.artifactId,
      runId: input.runId,
      kind: input.kind,
      mediaClass: "derived",
      publication: input.publication,
      content: input.prepared.content,
      storageKey: input.prepared.storageKey,
      durationMs: input.durationMs,
      tracks: input.tracks,
      sourceArtifactIds: input.sourceArtifactIds,
      producerTaskId: input.producerTaskId,
      producerAgentId: input.producerAgentId,
      origin: {
        kind: "media_operation",
        operationId: input.operationId,
        receiptId: input.receiptId,
        receiptContentId: input.receiptContentId,
      },
    };
    assertRuntimeArtifact(artifact);
    return artifact;
  }

export function buildObservationArtifact(input: {
    runId: string;
    operationId: string;
    receiptId: string;
    sourceArtifactIds: string[];
    producerTaskId: string;
    producerAgentId: string;
    storedReceipt: { content: ContentIdentity; storageKey: string };
  }): RuntimeArtifact {
    const artifact: RuntimeArtifact = {
      schema: "studio.runtime.artifact.v1",
      id: `artifact:${canonicalSha256({
        runId: input.runId,
        operationId: input.operationId,
        kind: "media-audio-activity-observation",
        contentId: input.storedReceipt.content.contentId,
      })}`,
      runId: input.runId,
      kind: "media-audio-activity-observation",
      mediaClass: "non_media",
      publication: "private",
      content: input.storedReceipt.content,
      storageKey: input.storedReceipt.storageKey,
      durationMs: null,
      tracks: [],
      sourceArtifactIds: input.sourceArtifactIds,
      producerTaskId: input.producerTaskId,
      producerAgentId: input.producerAgentId,
      origin: {
        kind: "media_observation",
        operationId: input.operationId,
        receiptId: input.receiptId,
        receiptContentId: input.storedReceipt.content.contentId,
      },
    };
    assertRuntimeArtifact(artifact);
    return artifact;
  }

export function buildEvidenceAssessmentArtifact(input: {
    runId: string;
    receipt: EvidenceAssessmentReceipt;
    storedReceipt: { content: ContentIdentity; storageKey: string };
  }): RuntimeArtifact {
    const artifact: RuntimeArtifact = {
      schema: "studio.runtime.artifact.v1",
      id: `artifact:${canonicalSha256({
        runId: input.runId,
        operationId: input.receipt.operationId,
        kind: "evidence-assessment-receipt",
        contentId: input.storedReceipt.content.contentId,
      })}`,
      runId: input.runId,
      kind: "evidence-assessment-receipt",
      mediaClass: "non_media",
      publication: "private",
      content: input.storedReceipt.content,
      storageKey: input.storedReceipt.storageKey,
      durationMs: null,
      tracks: [],
      sourceArtifactIds: [],
      producerTaskId: input.receipt.authorization.taskId,
      producerAgentId: input.receipt.authorization.agentId,
      origin: {
        kind: "evidence_assessment",
        operationId: input.receipt.operationId,
        receiptId: input.receipt.receiptId,
        receiptContentId: input.storedReceipt.content.contentId,
        readReceiptIds: input.receipt.inputs.map((receipt) => receipt.receiptId),
        readReceiptContentIds: input.receipt.inputs.map((receipt) => receipt.receiptContentId),
      },
    };
    assertRuntimeArtifact(artifact);
    return artifact;
  }

export function buildEvidenceDecisionArtifact(input: {
    runId: string;
    receipt: EvidenceDecisionReceipt;
    storedReceipt: { content: ContentIdentity; storageKey: string };
  }): RuntimeArtifact {
    const artifact: RuntimeArtifact = {
      schema: "studio.runtime.artifact.v1",
      id: `artifact:${canonicalSha256({
        runId: input.runId,
        operationId: input.receipt.operationId,
        kind: "evidence-decision-receipt",
        contentId: input.storedReceipt.content.contentId,
      })}`,
      runId: input.runId,
      kind: "evidence-decision-receipt",
      mediaClass: "non_media",
      publication: "private",
      content: input.storedReceipt.content,
      storageKey: input.storedReceipt.storageKey,
      durationMs: null,
      tracks: [],
      sourceArtifactIds: input.receipt.inputs.map((assessment) => assessment.artifactId),
      producerTaskId: input.receipt.authorization.taskId,
      producerAgentId: input.receipt.authorization.agentId,
      origin: {
        kind: "evidence_decision",
        operationId: input.receipt.operationId,
        receiptId: input.receipt.receiptId,
        receiptContentId: input.storedReceipt.content.contentId,
        assessmentOperationIds: input.receipt.inputs.map((assessment) => assessment.operationId),
        assessmentArtifactIds: input.receipt.inputs.map((assessment) => assessment.artifactId),
        assessmentReceiptIds: input.receipt.inputs.map((assessment) => assessment.receiptId),
        assessmentReceiptContentIds: input.receipt.inputs.map((assessment) => assessment.receiptContentId),
      },
    };
    assertRuntimeArtifact(artifact);
    return artifact;
  }
