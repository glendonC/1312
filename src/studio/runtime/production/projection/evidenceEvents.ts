import type { RuntimeProjection } from "../model.ts";
import type { RuntimeEvent } from "../protocol.ts";
import { countAssessmentTokens } from "../validation/assessment.ts";
import { invariant } from "./shared.ts";

export function applyEvidenceEvent(next: RuntimeProjection, event: RuntimeEvent): boolean {
  if (event.type === "evidence.read_started") {
    invariant(event.producer.kind === "evidence_host", event, "evidence read must come from the evidence host");
    const request = event.data.request;
    const task = next.tasks[request.taskId];
    invariant(
      task?.status === "working" && task.ownerAgentId === request.agentId,
      event,
      `evidence read ${request.operationId} has no working owner`,
    );
    invariant(
      !next.evidenceReads[request.operationId] &&
        !next.evidenceAssessments[request.operationId] &&
        !next.evidenceDecisions[request.operationId] &&
        !next.operations[request.operationId],
      event,
      `operation ${request.operationId} is duplicated`,
    );
    const grant = task.grants.find((candidate) => candidate.id === event.data.grantId);
    const scope = grant?.evidenceScope.find((candidate) =>
      candidate.artifactId === request.artifactId && candidate.evidenceKind === event.data.evidenceKind);
    invariant(grant?.capability === "evidence.read" && scope, event, `evidence read ${request.operationId} lacks its grant`);
    const artifact = next.artifacts[request.artifactId];
    invariant(
      artifact?.origin.kind === "preflight_evidence" && artifact.origin.evidenceKind === event.data.evidenceKind,
      event,
      `evidence read ${request.operationId} input is unavailable`,
    );
    invariant(
      artifact.sourceArtifactIds.length === 1 &&
        artifact.sourceArtifactIds[0] === scope.sourceArtifactId &&
        event.data.sourceArtifactId === scope.sourceArtifactId &&
        event.data.startMs === scope.startMs &&
        event.data.endMs === scope.endMs &&
        task.mediaScope.some((mediaScope) =>
          mediaScope.artifactId === scope.sourceArtifactId &&
          mediaScope.startMs === scope.startMs &&
          mediaScope.endMs === scope.endMs),
      event,
      `evidence read ${request.operationId} changed its exact source window`,
    );
    invariant(
      event.data.maxBytes > 0 && event.data.maxBytes <= scope.maxBytes &&
        event.data.maxItems > 0 && event.data.maxItems <= scope.maxItems,
      event,
      `evidence read ${request.operationId} exceeds its grant budget`,
    );
    const calls = [
      ...Object.values(next.operations),
      ...Object.values(next.evidenceReads),
      ...Object.values(next.evidenceAssessments),
      ...Object.values(next.evidenceDecisions),
    ].filter((operation) => operation.taskId === task.id).length;
    invariant(calls < task.budget.toolCalls, event, `task ${task.id} exhausted its tool-call budget`);
    next.evidenceReads[request.operationId] = {
      id: request.operationId,
      taskId: request.taskId,
      agentId: request.agentId,
      grantId: event.data.grantId,
      artifactId: request.artifactId,
      evidenceKind: event.data.evidenceKind,
      sourceArtifactId: event.data.sourceArtifactId,
      startMs: event.data.startMs,
      endMs: event.data.endMs,
      maxBytes: event.data.maxBytes,
      maxItems: event.data.maxItems,
      status: "started",
      receiptId: null,
      receiptContentId: null,
      returnedItems: null,
      returnedFactBytes: null,
      truncated: null,
      failure: null,
    };
    return true;
  }

  if (event.type === "evidence.read_completed") {
    invariant(event.producer.kind === "evidence_host", event, "evidence completion must come from the evidence host");
    const operation = next.evidenceReads[event.data.operationId];
    invariant(operation?.status === "started", event, `evidence read ${event.data.operationId} is not active`);
    const receipt = event.data.receipt;
    const artifact = next.artifacts[operation.artifactId];
    invariant(
      artifact?.origin.kind === "preflight_evidence",
      event,
      `evidence read ${operation.id} input artifact is unavailable`,
    );
    invariant(
      receipt.operationId === operation.id &&
        receipt.authorization.grantId === operation.grantId &&
        receipt.authorization.taskId === operation.taskId &&
        receipt.authorization.agentId === operation.agentId &&
        receipt.authorization.sourceArtifactId === operation.sourceArtifactId &&
        receipt.authorization.startMs === operation.startMs &&
        receipt.authorization.endMs === operation.endMs &&
        receipt.authorization.maxBytes === operation.maxBytes &&
        receipt.authorization.maxItems === operation.maxItems,
      event,
      `evidence read ${operation.id} receipt changed authorization`,
    );
    invariant(
      receipt.input.artifactId === artifact.id &&
        receipt.input.contentId === artifact.content.contentId &&
        receipt.input.bytes === artifact.content.bytes &&
        receipt.input.evidenceKind === artifact.origin.evidenceKind &&
        receipt.input.receiptSchema === artifact.origin.receiptSchema,
      event,
      `evidence read ${operation.id} receipt changed input identity`,
    );
    invariant(
      receipt.lineage.preflightId === artifact.origin.preflightId &&
        receipt.lineage.preflightContentId === artifact.origin.preflightContentId &&
        JSON.stringify(receipt.lineage.sourceArtifactIds) === JSON.stringify(artifact.sourceArtifactIds),
      event,
      `evidence read ${operation.id} receipt changed lineage`,
    );
    operation.status = "completed";
    operation.receiptId = receipt.receiptId;
    operation.receiptContentId = event.data.receiptContentId;
    operation.returnedItems = receipt.result.returnedItems;
    operation.returnedFactBytes = receipt.result.returnedFactBytes;
    operation.truncated = receipt.result.truncated;
    return true;
  }

  if (event.type === "evidence.read_failed") {
    invariant(event.producer.kind === "evidence_host", event, "evidence failure must come from the evidence host");
    const operation = next.evidenceReads[event.data.operationId];
    invariant(operation?.status === "started", event, `evidence read ${event.data.operationId} is not active`);
    operation.status = "failed";
    operation.failure = event.data.reason;
    return true;
  }

  if (event.type === "analysis.evidence.assessment_started") {
    invariant(event.producer.kind === "assessment_host", event, "evidence assessment must come from the assessment host");
    const request = event.data.request;
    const task = next.tasks[request.taskId];
    invariant(
      task?.status === "working" && task.ownerAgentId === request.agentId,
      event,
      `evidence assessment ${request.operationId} has no working owner`,
    );
    invariant(
      !next.evidenceAssessments[request.operationId] &&
        !next.evidenceDecisions[request.operationId] &&
        !next.evidenceReads[request.operationId] &&
        !next.operations[request.operationId],
      event,
      `operation ${request.operationId} is duplicated`,
    );
    const grant = task.grants.find((candidate) => candidate.id === event.data.grantId);
    const scope = grant?.assessmentScope;
    invariant(
      grant?.capability === "analysis.evidence.assess" && scope,
      event,
      `evidence assessment ${request.operationId} lacks its grant`,
    );
    invariant(
      event.data.maxReadReceipts === scope.maxReadReceipts &&
        event.data.maxClaims === scope.maxClaims &&
        event.data.maxCitations === scope.maxCitations &&
        event.data.maxTokens === scope.maxTokens,
      event,
      `evidence assessment ${request.operationId} changed its grant budgets`,
    );
    const priorAssessments = Object.values(next.evidenceAssessments).filter((operation) =>
      operation.taskId === task.id && operation.grantId === grant.id);
    invariant(
      priorAssessments.length < scope.maxAssessments,
      event,
      `evidence assessment ${request.operationId} exceeds its assessment-count budget`,
    );
    const citationCount = request.claims.reduce(
      (total, claim) => total + claim.citations.reduce(
        (subtotal, citation) => subtotal + citation.factIndexes.length,
        0,
      ),
      0,
    );
    invariant(
      request.readReceipts.length <= scope.maxReadReceipts &&
        request.claims.length <= scope.maxClaims &&
        citationCount <= scope.maxCitations &&
        countAssessmentTokens(request.claims) <= scope.maxTokens,
      event,
      `evidence assessment ${request.operationId} exceeds its content budgets`,
    );
    const reads = request.readReceipts.map((identity) => Object.values(next.evidenceReads).find((candidate) =>
      candidate.status === "completed" &&
      candidate.taskId === task.id &&
      candidate.agentId === request.agentId &&
      candidate.receiptId === identity.receiptId &&
      candidate.receiptContentId === identity.receiptContentId));
    invariant(
      reads.every((read) => read && scope.evidenceArtifactIds.includes(read.artifactId)),
      event,
      `evidence assessment ${request.operationId} references an unread or ungranted receipt`,
    );
    const calls = [
      ...Object.values(next.operations),
      ...Object.values(next.evidenceReads),
      ...Object.values(next.evidenceAssessments),
      ...Object.values(next.evidenceDecisions),
    ].filter((operation) => operation.taskId === task.id).length;
    invariant(calls < task.budget.toolCalls, event, `task ${task.id} exhausted its tool-call budget`);
    next.evidenceAssessments[request.operationId] = {
      id: request.operationId,
      taskId: request.taskId,
      agentId: request.agentId,
      grantId: event.data.grantId,
      readReceiptIds: request.readReceipts.map((receipt) => receipt.receiptId),
      readReceiptContentIds: request.readReceipts.map((receipt) => receipt.receiptContentId),
      maxReadReceipts: event.data.maxReadReceipts,
      maxClaims: event.data.maxClaims,
      maxCitations: event.data.maxCitations,
      maxTokens: event.data.maxTokens,
      status: "started",
      artifactId: null,
      receiptId: null,
      receiptContentId: null,
      claimCount: null,
      citationCount: null,
      tokenCount: null,
      failure: null,
    };
    return true;
  }

  if (event.type === "analysis.evidence.assessment_completed") {
    invariant(event.producer.kind === "assessment_host", event, "evidence assessment completion must come from the assessment host");
    const operation = next.evidenceAssessments[event.data.operationId];
    invariant(operation?.status === "started", event, `evidence assessment ${event.data.operationId} is not active`);
    const artifact = next.artifacts[event.data.outputArtifactId];
    const receipt = event.data.receipt;
    const scope = next.tasks[operation.taskId]?.grants.find((grant) =>
      grant.id === operation.grantId && grant.capability === "analysis.evidence.assess")?.assessmentScope;
    invariant(
      artifact?.origin.kind === "evidence_assessment" &&
        artifact.origin.operationId === operation.id &&
        artifact.origin.receiptId === receipt.receiptId &&
        artifact.origin.receiptContentId === event.data.receiptContentId &&
        artifact.content.contentId === event.data.receiptContentId,
      event,
      `evidence assessment ${operation.id} has no content-addressed receipt artifact`,
    );
    invariant(
      receipt.operationId === operation.id &&
        receipt.authorization.grantId === operation.grantId &&
        receipt.authorization.taskId === operation.taskId &&
        receipt.authorization.agentId === operation.agentId &&
        receipt.authorization.maxAssessments === scope?.maxAssessments &&
        receipt.authorization.maxReadReceipts === operation.maxReadReceipts &&
        receipt.authorization.maxClaims === operation.maxClaims &&
        receipt.authorization.maxCitations === operation.maxCitations &&
        receipt.authorization.maxTokens === operation.maxTokens,
      event,
      `evidence assessment ${operation.id} receipt changed authorization`,
    );
    invariant(
      JSON.stringify(receipt.inputs.map((input) => input.receiptId)) === JSON.stringify(operation.readReceiptIds) &&
        JSON.stringify(receipt.inputs.map((input) => input.receiptContentId)) === JSON.stringify(operation.readReceiptContentIds),
      event,
      `evidence assessment ${operation.id} receipt changed completed-read inputs`,
    );
    operation.status = "completed";
    operation.artifactId = artifact.id;
    operation.receiptId = receipt.receiptId;
    operation.receiptContentId = event.data.receiptContentId;
    operation.claimCount = receipt.result.claimCount;
    operation.citationCount = receipt.result.citationCount;
    operation.tokenCount = receipt.result.tokenCount;
    return true;
  }

  if (event.type === "analysis.evidence.assessment_failed") {
    invariant(event.producer.kind === "assessment_host", event, "evidence assessment failure must come from the assessment host");
    const operation = next.evidenceAssessments[event.data.operationId];
    invariant(operation?.status === "started", event, `evidence assessment ${event.data.operationId} is not active`);
    operation.status = "failed";
    operation.failure = event.data.reason;
    return true;
  }

  if (event.type === "analysis.evidence.decision_started") {
    invariant(event.producer.kind === "decision_host", event, "evidence decision must come from the decision host");
    const request = event.data.request;
    const task = next.tasks[request.taskId];
    invariant(
      task?.status === "working" && task.ownerAgentId === request.agentId,
      event,
      `evidence decision ${request.operationId} has no working owner`,
    );
    invariant(
      !next.evidenceDecisions[request.operationId] &&
        !next.evidenceAssessments[request.operationId] &&
        !next.evidenceReads[request.operationId] &&
        !next.operations[request.operationId],
      event,
      `operation ${request.operationId} is duplicated`,
    );
    const grant = task.grants.find((candidate) => candidate.id === event.data.grantId);
    const scope = grant?.decisionScope;
    invariant(
      grant?.capability === "analysis.evidence.decide" && scope,
      event,
      `evidence decision ${request.operationId} lacks its grant`,
    );
    invariant(
      event.data.maxAuditedAssessments === scope.maxAuditedAssessments &&
        request.auditedAssessments.length <= scope.maxAuditedAssessments,
      event,
      `evidence decision ${request.operationId} changed its grant budget`,
    );
    const prior = Object.values(next.evidenceDecisions).filter((operation) =>
      operation.taskId === task.id && operation.grantId === grant.id);
    invariant(
      prior.length < scope.maxDecisions,
      event,
      `evidence decision ${request.operationId} exceeds its decision-count budget`,
    );
    invariant(
      request.auditedAssessments.every((identity) => {
        const assessment = next.evidenceAssessments[identity.operationId];
        return assessment?.status === "completed" &&
          assessment.taskId === task.id &&
          assessment.agentId === request.agentId &&
          assessment.artifactId === identity.artifactId &&
          assessment.receiptId === identity.receiptId &&
          assessment.receiptContentId === identity.receiptContentId;
      }),
      event,
      `evidence decision ${request.operationId} references a non-completed assessment identity`,
    );
    const calls = [
      ...Object.values(next.operations),
      ...Object.values(next.evidenceReads),
      ...Object.values(next.evidenceAssessments),
      ...Object.values(next.evidenceDecisions),
    ].filter((operation) => operation.taskId === task.id).length;
    invariant(calls < task.budget.toolCalls, event, `task ${task.id} exhausted its tool-call budget`);
    next.evidenceDecisions[request.operationId] = {
      id: request.operationId,
      taskId: request.taskId,
      agentId: request.agentId,
      grantId: event.data.grantId,
      assessmentOperationIds: request.auditedAssessments.map((identity) => identity.operationId),
      assessmentArtifactIds: request.auditedAssessments.map((identity) => identity.artifactId),
      assessmentReceiptIds: request.auditedAssessments.map((identity) => identity.receiptId),
      assessmentReceiptContentIds: request.auditedAssessments.map((identity) => identity.receiptContentId),
      maxAuditedAssessments: event.data.maxAuditedAssessments,
      status: "started",
      artifactId: null,
      receiptId: null,
      receiptContentId: null,
      outcome: null,
      reasonCodes: [],
      auditedClaimCount: null,
      failure: null,
    };
    return true;
  }

  if (event.type === "analysis.evidence.decision_completed") {
    invariant(event.producer.kind === "decision_host", event, "evidence decision completion must come from the decision host");
    const operation = next.evidenceDecisions[event.data.operationId];
    invariant(operation?.status === "started", event, `evidence decision ${event.data.operationId} is not active`);
    const artifact = next.artifacts[event.data.outputArtifactId];
    const receipt = event.data.receipt;
    const scope = next.tasks[operation.taskId]?.grants.find((grant) =>
      grant.id === operation.grantId && grant.capability === "analysis.evidence.decide")?.decisionScope;
    invariant(
      artifact?.origin.kind === "evidence_decision" &&
        artifact.origin.operationId === operation.id &&
        artifact.origin.receiptId === receipt.receiptId &&
        artifact.origin.receiptContentId === event.data.receiptContentId &&
        artifact.content.contentId === event.data.receiptContentId,
      event,
      `evidence decision ${operation.id} has no content-addressed receipt artifact`,
    );
    invariant(
      receipt.operationId === operation.id &&
        receipt.authorization.grantId === operation.grantId &&
        receipt.authorization.taskId === operation.taskId &&
        receipt.authorization.agentId === operation.agentId &&
        receipt.authorization.maxDecisions === scope?.maxDecisions &&
        receipt.authorization.maxAuditedAssessments === operation.maxAuditedAssessments,
      event,
      `evidence decision ${operation.id} receipt changed authorization`,
    );
    invariant(
      JSON.stringify(receipt.inputs.map((input) => input.operationId)) === JSON.stringify(operation.assessmentOperationIds) &&
        JSON.stringify(receipt.inputs.map((input) => input.artifactId)) === JSON.stringify(operation.assessmentArtifactIds) &&
        JSON.stringify(receipt.inputs.map((input) => input.receiptId)) === JSON.stringify(operation.assessmentReceiptIds) &&
        JSON.stringify(receipt.inputs.map((input) => input.receiptContentId)) === JSON.stringify(operation.assessmentReceiptContentIds),
      event,
      `evidence decision ${operation.id} receipt changed audited assessment inputs`,
    );
    operation.status = "completed";
    operation.artifactId = artifact.id;
    operation.receiptId = receipt.receiptId;
    operation.receiptContentId = event.data.receiptContentId;
    operation.outcome = receipt.decision.outcome;
    operation.reasonCodes = [...receipt.decision.reasonCodes];
    operation.auditedClaimCount = receipt.result.auditedClaimCount;
    return true;
  }

  if (event.type === "analysis.evidence.decision_failed") {
    invariant(event.producer.kind === "decision_host", event, "evidence decision failure must come from the decision host");
    const operation = next.evidenceDecisions[event.data.operationId];
    invariant(operation?.status === "started", event, `evidence decision ${event.data.operationId} is not active`);
    operation.status = "failed";
    operation.failure = event.data.reason;
    return true;
  }

  return false;
}
