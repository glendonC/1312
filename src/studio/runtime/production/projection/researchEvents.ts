import { capabilityOperationExists, taskCapabilityCallCount } from "../capabilityUsage.ts";
import { researchExhaustionReceiptArtifactId } from "../artifactStore/researchArtifacts.ts";
import type { RestudiedResearchBasis, RuntimeProjection } from "../model.ts";
import type { RuntimeEvent } from "../protocol.ts";
import { currentRestudiedResearchBasis } from "../research/restudiedResearchBasis.ts";
import { researchRequestFingerprint } from "../validation/research.ts";
import { invariant } from "./shared.ts";

function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * Journal-backed relocation of the in-host ResearchOperationRegistry rules: uniqueness,
 * per-grant fingerprint dedup, call/query/document budgets that charge failed operations,
 * and snapshot-requires-completed-same-grant-search, all enforced in the fold.
 */
export function applyResearchEvent(next: RuntimeProjection, event: RuntimeEvent): boolean {
  if (event.type === "research.request_input_recorded") {
    invariant(event.producer.kind === "research_host", event, "Research request inputs must come from the bounded research host");
    const input = event.data.input;
    const root = next.tasks[input.basis.root.taskId];
    const execution = next.executions[input.basis.root.executionId];
    invariant(
      input.runId === next.runId && root?.parentTaskId === null && root.status === "working" &&
        root.assignedAgentId === input.basis.root.agentId && root.ownerAgentId === input.basis.root.agentId &&
        root.requiredOutputs.some((output) => output.required && output.artifactKind === "studio.owned-media-study.v3") &&
        root.grants.some((grant) => grant.capability === "study.research") &&
        execution?.status === "active" && execution.taskId === root.id && execution.agentId === root.ownerAgentId,
      event,
      `Research request input ${input.inputId} lacks its active granted v3 root`,
    );
    let currentBasis: RestudiedResearchBasis;
    try {
      currentBasis = currentRestudiedResearchBasis(next, input.basis.root);
    } catch (error) {
      invariant(false, event, error instanceof Error ? error.message : "Research request input lost its current basis");
    }
    invariant(same(currentBasis, input.basis), event, `Research request input ${input.inputId} is stale`);
    for (const trigger of input.triggers) {
      const source = next.artifacts[trigger.source.artifactId];
      invariant(
        trigger.basisId === input.basis.basisId && source?.content.contentId === trigger.source.contentId &&
          root.mediaScope.some((scope) => scope.artifactId === trigger.source.artifactId && scope.trackId === trigger.source.trackId &&
            trigger.source.startMs >= scope.startMs && trigger.source.endMs <= scope.endMs) &&
          trigger.evidence.state === "conflicting" && trigger.evidence.preservedStates.includes("conflicting"),
        event,
        `Research request trigger ${trigger.triggerId} escaped its source or conflicting basis`,
      );
    }
    invariant(!next.researchRequestInputs[input.inputId], event, `Research request input ${input.inputId} is duplicated`);
    next.researchRequestInputs[input.inputId] = structuredClone(input);
    return true;
  }
  if (event.type === "research.operation_started") {
    invariant(event.producer.kind === "research_host", event, "Research must come from its bounded host");
    const { request, gap } = event.data;
    const task = next.tasks[request.taskId];
    invariant(task?.status === "working" && task.ownerAgentId === request.agentId, event, `Research ${request.operationId} has no working owner`);
    invariant(!capabilityOperationExists(next, request.operationId), event, `Research ${request.operationId} is duplicated`);
    const grant = task.grants.find((candidate) => candidate.id === request.grantId);
    invariant(grant?.capability === "research.investigate" && grant.researchScope, event, `Research ${request.operationId} lacks its exact grant`);
    invariant(same(grant.researchScope.gap, gap), event, `Research ${request.operationId} changed its granted gap binding`);
    invariant(same(grant.researchScope.limits, event.data.limits), event, `Research ${request.operationId} changed limits`);
    invariant(same(grant.researchScope.allowedDomains, event.data.allowedDomains), event, `Research ${request.operationId} changed its domain allowlist`);
    const fingerprint = researchRequestFingerprint({
      grantId: grant.id,
      op: request.op,
      query: request.op === "search" ? request.query : null,
      searchOperationId: request.op === "document_snapshot" ? request.searchOperationId : null,
      resultIndex: request.op === "document_snapshot" ? request.resultIndex : null,
    });
    invariant(fingerprint === event.data.requestFingerprint, event, `Research ${request.operationId} changed request identity`);
    const grantOperations = Object.values(next.researchOperations).filter((entry) => entry.grantId === grant.id);
    invariant(!grantOperations.some((entry) => entry.requestFingerprint === fingerprint), event, `Research ${request.operationId} duplicates already-charged work`);
    invariant(grantOperations.length < grant.researchScope.limits.maxCalls, event, `Research grant ${grant.id} exhausted its call budget`);
    if (request.op === "search") {
      invariant(grantOperations.filter((entry) => entry.op === "search").length < grant.researchScope.limits.maxQueries, event, `Research grant ${grant.id} exhausted its query budget`);
    } else {
      invariant(grantOperations.filter((entry) => entry.op === "document_snapshot").length < grant.researchScope.limits.maxDocuments, event, `Research grant ${grant.id} exhausted its document budget`);
      const search = next.researchOperations[request.searchOperationId];
      invariant(
        search?.op === "search" && search.status === "completed" && search.grantId === grant.id &&
          request.resultIndex < (search.searchResultCount ?? 0),
        event,
        `Research ${request.operationId} names no completed same-grant search result`,
      );
    }
    invariant(taskCapabilityCallCount(next, task.id) < task.budget.toolCalls, event, `task ${task.id} exhausted its tool-call budget`);
    const execution = next.executions[event.data.executionId];
    const launch = next.taskLaunches[task.id];
    invariant(execution?.status === "active" && execution.taskId === task.id && execution.agentId === request.agentId && execution.launchClaimId === event.data.launchClaimId && launch?.id === event.data.launchClaimId && launch.executionId === execution.id, event, `Research ${request.operationId} lost executor lineage`);
    next.researchOperations[request.operationId] = {
      id: request.operationId, op: request.op, taskId: task.id, agentId: request.agentId, grantId: grant.id,
      executionId: execution.id, launchClaimId: launch.id, requestFingerprint: fingerprint,
      gap: structuredClone(gap), status: "started",
      query: request.op === "search" ? request.query : null,
      searchOperationId: request.op === "document_snapshot" ? request.searchOperationId : null,
      resultIndex: request.op === "document_snapshot" ? request.resultIndex : null,
      receiptArtifactId: null, receiptId: null, receiptContentId: null,
      documentArtifactId: null, extractionArtifactId: null, searchResultCount: null, failure: null,
    };
    return true;
  }
  if (event.type === "research.operation_completed") {
    invariant(event.producer.kind === "research_host", event, "Research completion must come from its bounded host");
    const operation = next.researchOperations[event.data.operationId];
    invariant(operation?.status === "started" && operation.op === event.data.op, event, `Research ${event.data.operationId} is not active as ${event.data.op}`);
    const task = next.tasks[operation.taskId];
    const grant = task?.grants.find((candidate) => candidate.id === operation.grantId);
    invariant(grant?.capability === "research.investigate" && grant.researchScope, event, `Research ${operation.id} lost its grant`);
    const receipt = event.data.receipt;
    invariant(receipt.runId === next.runId && receipt.operationId === operation.id, event, `Research ${operation.id} receipt changed identity`);
    invariant(
      receipt.authorization.grantId === operation.grantId && receipt.authorization.taskId === operation.taskId &&
        receipt.authorization.agentId === operation.agentId && "executionId" in receipt.authorization &&
        receipt.authorization.executionId === operation.executionId && receipt.authorization.launchClaimId === operation.launchClaimId,
      event,
      `Research ${operation.id} receipt changed authorization`,
    );
    invariant(same(receipt.gap, grant.researchScope.gap) && same(receipt.limits, grant.researchScope.limits) && same(receipt.allowedDomains, grant.researchScope.allowedDomains), event, `Research ${operation.id} receipt escaped its granted scope`);
    const receiptArtifact = next.artifacts[event.data.receiptArtifactId];
    if (event.data.op === "search") {
      invariant(receipt.schema === "studio.research-search.receipt.v1", event, `Research ${operation.id} completed with the wrong receipt kind`);
      invariant(receiptArtifact?.origin.kind === "research_search_receipt" && receiptArtifact.origin.operationId === operation.id && receiptArtifact.origin.receiptId === receipt.receiptId && receiptArtifact.content.contentId === event.data.receiptContentId, event, `Research ${operation.id} changed search receipt identity`);
      invariant(receipt.query === operation.query, event, `Research ${operation.id} changed its recorded query`);
      operation.searchResultCount = receipt.results.length;
    } else {
      invariant(receipt.schema === "studio.research-document-snapshot.receipt.v1", event, `Research ${operation.id} completed with the wrong receipt kind`);
      invariant(receiptArtifact?.origin.kind === "research_snapshot_receipt" && receiptArtifact.origin.operationId === operation.id && receiptArtifact.origin.receiptId === receipt.receiptId && receiptArtifact.content.contentId === event.data.receiptContentId, event, `Research ${operation.id} changed snapshot receipt identity`);
      const search = next.researchOperations[operation.searchOperationId ?? ""];
      invariant(
        search?.status === "completed" && receipt.search.operationId === operation.searchOperationId &&
          receipt.search.resultIndex === operation.resultIndex && receipt.search.receiptId === search.receiptId &&
          receipt.search.receiptContentId === search.receiptContentId,
        event,
        `Research ${operation.id} changed its search binding`,
      );
      const documentArtifact = next.artifacts[event.data.documentArtifactId ?? ""];
      const extractionArtifact = next.artifacts[event.data.extractionArtifactId ?? ""];
      invariant(
        documentArtifact?.origin.kind === "research_document_snapshot" && documentArtifact.origin.operationId === operation.id &&
          receipt.document.artifactId === documentArtifact.id && receipt.document.contentId === documentArtifact.content.contentId &&
          extractionArtifact?.origin.kind === "research_extraction" && extractionArtifact.origin.operationId === operation.id &&
          receipt.extraction.artifactId === extractionArtifact.id && receipt.extraction.contentId === extractionArtifact.content.contentId,
        event,
        `Research ${operation.id} changed document or extraction identity`,
      );
      operation.documentArtifactId = documentArtifact.id;
      operation.extractionArtifactId = extractionArtifact.id;
    }
    operation.status = "completed";
    operation.receiptArtifactId = event.data.receiptArtifactId;
    operation.receiptId = receipt.receiptId;
    operation.receiptContentId = event.data.receiptContentId;
    return true;
  }
  if (event.type === "research.operation_failed") {
    invariant(event.producer.kind === "research_host", event, "Research failure must come from its bounded host");
    const operation = next.researchOperations[event.data.operationId];
    invariant(operation?.status === "started", event, `Research ${event.data.operationId} is not active`);
    operation.status = "failed";
    operation.failure = event.data.reason;
    return true;
  }
  if (event.type === "research.exhaustion_recorded") {
    invariant(event.producer.kind === "research_host", event, "Research exhaustion must come from its bounded host");
    const receipt = event.data.receipt;
    invariant(!next.researchExhaustions[receipt.receiptId], event, `Research exhaustion ${receipt.receiptId} is duplicated`);
    invariant(
      !Object.values(next.researchExhaustions).some((entry) => entry.grantId === receipt.authorization.grantId),
      event,
      `Research grant ${receipt.authorization.grantId} already has an exhaustion cause`,
    );
    const task = next.tasks[receipt.authorization.taskId];
    const grant = task?.grants.find((candidate) => candidate.id === receipt.authorization.grantId);
    invariant(
      task?.status === "working" && task.ownerAgentId === receipt.authorization.agentId &&
        grant?.capability === "research.investigate" && grant.researchScope,
      event,
      `Research exhaustion ${receipt.receiptId} lacks its working task and grant`,
    );
    const execution = next.executions[receipt.authorization.executionId];
    const launch = next.taskLaunches[task.id];
    invariant(
      execution?.status === "active" && execution.taskId === task.id && execution.agentId === task.ownerAgentId &&
        execution.launchClaimId === receipt.authorization.launchClaimId && launch?.id === receipt.authorization.launchClaimId &&
        launch.executionId === execution.id,
      event,
      `Research exhaustion ${receipt.receiptId} lost executor lineage`,
    );
    invariant(
      receipt.runId === next.runId && same(receipt.gap, grant.researchScope.gap) &&
        same(receipt.limits, grant.researchScope.limits),
      event,
      `Research exhaustion ${receipt.receiptId} escaped its granted gap or limits`,
    );
    const operations = Object.values(next.researchOperations)
      .filter((operation) => operation.grantId === grant.id)
      .sort((left, right) => left.id.localeCompare(right.id));
    invariant(
      operations.length === grant.researchScope.limits.maxQueries &&
        operations.every((operation) => operation.op === "search" && operation.status === "completed" && operation.searchResultCount === 0),
      event,
      `Research exhaustion ${receipt.receiptId} does not prove the full empty query budget`,
    );
    invariant(
      same(receipt.operations, operations.map((operation) => ({
        operationId: operation.id,
        receiptArtifactId: operation.receiptArtifactId,
        receiptId: operation.receiptId,
        receiptContentId: operation.receiptContentId,
      }))),
      event,
      `Research exhaustion ${receipt.receiptId} changed its terminal operation identities`,
    );
    const artifact = next.artifacts[event.data.outputArtifactId];
    invariant(
      artifact?.origin.kind === "research_exhaustion_receipt" &&
        artifact.origin.receiptId === receipt.receiptId && artifact.origin.grantId === grant.id &&
        artifact.content.contentId === event.data.receiptContentId &&
        artifact.id === researchExhaustionReceiptArtifactId(next.runId, receipt.receiptId, event.data.receiptContentId) &&
        artifact.producerTaskId === task.id && artifact.producerAgentId === task.ownerAgentId &&
        same(artifact.sourceArtifactIds, receipt.operations.map((operation) => operation.receiptArtifactId)),
      event,
      `Research exhaustion ${receipt.receiptId} changed artifact or search lineage`,
    );
    next.researchExhaustions[receipt.receiptId] = {
      id: receipt.receiptId,
      taskId: task.id,
      agentId: task.ownerAgentId,
      grantId: grant.id,
      executionId: execution.id,
      launchClaimId: launch.id,
      gap: structuredClone(receipt.gap),
      reason: receipt.reason,
      operationIds: receipt.operations.map((operation) => operation.operationId),
      outputArtifactId: artifact.id,
      receiptContentId: event.data.receiptContentId,
    };
    return true;
  }
  return false;
}
