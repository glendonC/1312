import type { RuntimeProjection } from "../model.ts";
import type {
  ProductionStudioEvidenceArtifactView,
  ProductionStudioEvidenceAssessmentArtifactView,
  ProductionStudioEvidenceAssessmentView,
  ProductionStudioEvidenceDecisionArtifactView,
  ProductionStudioEvidenceDecisionView,
  ProductionStudioEvidenceReadView,
} from "./model.ts";

export function projectEvidenceReads(state: RuntimeProjection) {
  const evidenceReads = Object.values(state.evidenceReads)
    .map((operation): ProductionStudioEvidenceReadView => ({
      operationId: operation.id,
      capability: "evidence.read",
      status: operation.status,
      taskId: operation.taskId,
      agentId: operation.agentId,
      grantId: operation.grantId,
      inputArtifactId: operation.artifactId,
      evidenceKind: operation.evidenceKind,
      sourceArtifactId: operation.sourceArtifactId,
      startMs: operation.startMs,
      endMs: operation.endMs,
      maxBytes: operation.maxBytes,
      maxItems: operation.maxItems,
      receiptId: operation.receiptId,
      receiptContentId: operation.receiptContentId,
      returnedItems: operation.returnedItems,
      returnedFactBytes: operation.returnedFactBytes,
      truncated: operation.truncated,
      failure: operation.failure,
    }))
    .sort((left, right) => left.operationId.localeCompare(right.operationId));
  return evidenceReads;
}


export function projectEvidenceAssessments(state: RuntimeProjection) {
  const evidenceAssessments = Object.values(state.evidenceAssessments)
    .map((operation): ProductionStudioEvidenceAssessmentView => ({
      operationId: operation.id,
      capability: "analysis.evidence.assess",
      status: operation.status,
      taskId: operation.taskId,
      agentId: operation.agentId,
      grantId: operation.grantId,
      readReceiptIds: [...operation.readReceiptIds],
      readReceiptContentIds: [...operation.readReceiptContentIds],
      maxReadReceipts: operation.maxReadReceipts,
      maxClaims: operation.maxClaims,
      maxCitations: operation.maxCitations,
      maxTokens: operation.maxTokens,
      outputArtifactId: operation.artifactId,
      receiptId: operation.receiptId,
      receiptContentId: operation.receiptContentId,
      claimCount: operation.claimCount,
      citationCount: operation.citationCount,
      tokenCount: operation.tokenCount,
      failure: operation.failure,
    }))
    .sort((left, right) => left.operationId.localeCompare(right.operationId));
  return evidenceAssessments;
}


export function projectEvidenceDecisions(state: RuntimeProjection) {
  const evidenceDecisions = Object.values(state.evidenceDecisions)
    .map((operation): ProductionStudioEvidenceDecisionView => ({
      operationId: operation.id,
      capability: "analysis.evidence.decide",
      status: operation.status,
      taskId: operation.taskId,
      agentId: operation.agentId,
      grantId: operation.grantId,
      assessmentOperationIds: [...operation.assessmentOperationIds],
      assessmentArtifactIds: [...operation.assessmentArtifactIds],
      assessmentReceiptIds: [...operation.assessmentReceiptIds],
      assessmentReceiptContentIds: [...operation.assessmentReceiptContentIds],
      maxAuditedAssessments: operation.maxAuditedAssessments,
      outputArtifactId: operation.artifactId,
      receiptId: operation.receiptId,
      receiptContentId: operation.receiptContentId,
      outcome: operation.outcome,
      reasonCodes: [...operation.reasonCodes],
      auditedClaimCount: operation.auditedClaimCount,
      failure: operation.failure,
    }))
    .sort((left, right) => left.operationId.localeCompare(right.operationId));
  return evidenceDecisions;
}


export function projectEvidenceArtifacts(state: RuntimeProjection) {
  const evidenceArtifacts = Object.values(state.artifacts)
    .filter((artifact) => artifact.origin.kind === "preflight_evidence")
    .map((artifact): ProductionStudioEvidenceArtifactView => {
      if (artifact.origin.kind !== "preflight_evidence") {
        throw new Error(`Production Studio projection: evidence artifact ${artifact.id} changed origin`);
      }
      if (artifact.producerTaskId !== null || artifact.producerAgentId !== null || artifact.mediaClass !== "non_media") {
        throw new Error(`Production Studio projection: evidence artifact ${artifact.id} claims a runtime producer`);
      }
      return {
        artifactId: artifact.id,
        kind: artifact.kind,
        evidenceKind: artifact.origin.evidenceKind,
        receiptSchema: artifact.origin.receiptSchema,
        producerId: artifact.origin.producerId,
        contentId: artifact.content.contentId,
        bytes: artifact.content.bytes,
        sourceArtifactIds: [...artifact.sourceArtifactIds],
        preflightId: artifact.origin.preflightId,
        preflightContentId: artifact.origin.preflightContentId,
      };
    })
    .sort((left, right) => left.artifactId.localeCompare(right.artifactId));
  return evidenceArtifacts;
}


export function projectAssessmentArtifacts(state: RuntimeProjection) {
  const assessmentArtifacts = Object.values(state.artifacts)
    .filter((artifact) => {
      if (artifact.origin.kind !== "evidence_assessment") return false;
      const assessment = state.evidenceAssessments[artifact.origin.operationId];
      return assessment?.status === "completed" && assessment.artifactId === artifact.id;
    })
    .map((artifact): ProductionStudioEvidenceAssessmentArtifactView => {
      if (artifact.origin.kind !== "evidence_assessment") {
        throw new Error(`Production Studio projection: assessment artifact ${artifact.id} changed origin`);
      }
      if (
        artifact.kind !== "evidence-assessment-receipt" ||
        artifact.producerTaskId === null ||
        artifact.producerAgentId === null ||
        artifact.mediaClass !== "non_media"
      ) throw new Error(`Production Studio projection: assessment artifact ${artifact.id} is invalid`);
      return {
        artifactId: artifact.id,
        kind: artifact.kind,
        contentId: artifact.content.contentId,
        bytes: artifact.content.bytes,
        producerTaskId: artifact.producerTaskId,
        producerAgentId: artifact.producerAgentId,
        operationId: artifact.origin.operationId,
        receiptId: artifact.origin.receiptId,
        receiptContentId: artifact.origin.receiptContentId,
        readReceiptIds: [...artifact.origin.readReceiptIds],
        readReceiptContentIds: [...artifact.origin.readReceiptContentIds],
      };
    })
    .sort((left, right) => left.artifactId.localeCompare(right.artifactId));
  return assessmentArtifacts;
}


export function projectDecisionArtifacts(state: RuntimeProjection) {
  const decisionArtifacts = Object.values(state.artifacts)
    .filter((artifact) => {
      if (artifact.origin.kind !== "evidence_decision") return false;
      const decision = state.evidenceDecisions[artifact.origin.operationId];
      return decision?.status === "completed" && decision.artifactId === artifact.id;
    })
    .map((artifact): ProductionStudioEvidenceDecisionArtifactView => {
      if (artifact.origin.kind !== "evidence_decision") {
        throw new Error(`Production Studio projection: decision artifact ${artifact.id} changed origin`);
      }
      if (
        artifact.kind !== "evidence-decision-receipt" ||
        artifact.producerTaskId === null ||
        artifact.producerAgentId === null ||
        artifact.mediaClass !== "non_media"
      ) throw new Error(`Production Studio projection: decision artifact ${artifact.id} is invalid`);
      return {
        artifactId: artifact.id,
        kind: artifact.kind,
        contentId: artifact.content.contentId,
        bytes: artifact.content.bytes,
        producerTaskId: artifact.producerTaskId,
        producerAgentId: artifact.producerAgentId,
        operationId: artifact.origin.operationId,
        receiptId: artifact.origin.receiptId,
        receiptContentId: artifact.origin.receiptContentId,
        assessmentOperationIds: [...artifact.origin.assessmentOperationIds],
        assessmentArtifactIds: [...artifact.origin.assessmentArtifactIds],
        assessmentReceiptIds: [...artifact.origin.assessmentReceiptIds],
        assessmentReceiptContentIds: [...artifact.origin.assessmentReceiptContentIds],
      };
    })
    .sort((left, right) => left.artifactId.localeCompare(right.artifactId));
  return decisionArtifacts;
}
