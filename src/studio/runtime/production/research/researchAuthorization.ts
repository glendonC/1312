import {
  RESEARCH_CAPABILITY,
  type ResearchCapabilityGrant,
  type ResearchGrantScope,
  type ResearchGrantView,
  type ResearchRequest,
  type ResearchSearchReceipt,
  type ResearchSnapshotRequest,
} from "../model/research.ts";
import {
  assertResearchRequest,
  researchRequestFingerprint,
  validateResearchGrantScope,
} from "../validation/research.ts";

export interface CompletedResearchSearch {
  operationId: string;
  grantId: string;
  receipt: ResearchSearchReceipt;
  receiptContentId: string;
  receiptArtifactId: string;
}

interface RegisteredResearchOperation {
  operationId: string;
  grantId: string;
  op: "search" | "document_snapshot";
  fingerprint: string;
  status: "started" | "completed" | "failed";
  search: CompletedResearchSearch | null;
}

/**
 * Host-instance operation ledger for the slice. The projection-backed registry (journal
 * events plus RuntimeProjection slice) is deferred hub wiring; this preserves the same
 * uniqueness, budget, and duplicate-work rules so that wiring is a relocation, not a redesign.
 */
export class ResearchOperationRegistry {
  private readonly operations = new Map<string, RegisteredResearchOperation>();

  exists(operationId: string): boolean {
    return this.operations.has(operationId);
  }

  /**
   * Failed operations still count. Every started operation may have already spent a provider
   * call or a real network fetch, so budgets and duplicate-work rejection charge all statuses,
   * matching the hub authorizers in authorization.ts. registry.fail() is bookkeeping, never a
   * refund; a failing request cannot be retried into unbounded egress.
   */
  fingerprintExists(fingerprint: string): boolean {
    for (const operation of this.operations.values()) {
      if (operation.fingerprint === fingerprint) return true;
    }
    return false;
  }

  countByGrant(grantId: string, op?: "search" | "document_snapshot"): number {
    let count = 0;
    for (const operation of this.operations.values()) {
      if (operation.grantId !== grantId) continue;
      if (op === undefined || operation.op === op) count += 1;
    }
    return count;
  }

  completedSearch(operationId: string): CompletedResearchSearch | null {
    const operation = this.operations.get(operationId);
    return operation?.op === "search" && operation.status === "completed" ? operation.search : null;
  }

  start(input: { operationId: string; grantId: string; op: "search" | "document_snapshot"; fingerprint: string }): void {
    if (this.operations.has(input.operationId)) {
      throw new Error(`Research operation ${input.operationId} already exists`);
    }
    this.operations.set(input.operationId, { ...input, status: "started", search: null });
  }

  completeSearch(operationId: string, search: CompletedResearchSearch): void {
    const operation = this.operations.get(operationId);
    if (!operation || operation.status !== "started" || operation.op !== "search") {
      throw new Error(`Research operation ${operationId} cannot complete as a search`);
    }
    this.operations.set(operationId, { ...operation, status: "completed", search });
  }

  completeSnapshot(operationId: string): void {
    const operation = this.operations.get(operationId);
    if (!operation || operation.status !== "started" || operation.op !== "document_snapshot") {
      throw new Error(`Research operation ${operationId} cannot complete as a snapshot`);
    }
    this.operations.set(operationId, { ...operation, status: "completed", search: null });
  }

  fail(operationId: string): void {
    const operation = this.operations.get(operationId);
    if (!operation || operation.status !== "started") return;
    this.operations.set(operationId, { ...operation, status: "failed", search: null });
  }
}

export interface AuthorizedResearch {
  request: ResearchRequest;
  grant: ResearchCapabilityGrant;
  scope: ResearchGrantScope;
  fingerprint: string;
  /** Present only for document_snapshot requests. */
  search: CompletedResearchSearch | null;
}

/**
 * Use-time authorization mirroring authorize* in authorization.ts: the grant is re-resolved
 * from the injected view on every call and every failure is a closed refusal.
 */
export function authorizeResearch(
  view: ResearchGrantView,
  registry: ResearchOperationRegistry,
  requestValue: unknown,
): AuthorizedResearch {
  assertResearchRequest(requestValue);
  const request = structuredClone(requestValue);
  if (request.taskId !== view.taskId || request.agentId !== view.agentId) {
    throw new Error("Research request identities escape the injected task view");
  }
  const grants = view.grants.filter((candidate) => candidate.id === request.grantId);
  if (grants.length !== 1 || grants[0].capability !== RESEARCH_CAPABILITY) {
    throw new Error("Research is outside the task's authoritative capability grant");
  }
  const grant = grants[0];
  const scope = validateResearchGrantScope(grant.researchScope, "Research grant scope", "researchScope");
  if (registry.exists(request.operationId)) {
    throw new Error(`Research operation ${request.operationId} already exists`);
  }
  if (registry.countByGrant(grant.id) >= scope.limits.maxCalls) {
    throw new Error("Research grant call budget is exhausted");
  }
  const fingerprint = researchRequestFingerprint({
    grantId: grant.id,
    op: request.op,
    query: request.op === "search" ? request.query : null,
    searchOperationId: request.op === "document_snapshot" ? request.searchOperationId : null,
    resultIndex: request.op === "document_snapshot" ? request.resultIndex : null,
  });
  if (registry.fingerprintExists(fingerprint)) {
    throw new Error("Research request duplicates already-charged work under the same grant");
  }
  let search: CompletedResearchSearch | null = null;
  if (request.op === "search") {
    if (registry.countByGrant(grant.id, "search") >= scope.limits.maxQueries) {
      throw new Error("Research grant query budget is exhausted");
    }
  } else {
    if (registry.countByGrant(grant.id, "document_snapshot") >= scope.limits.maxDocuments) {
      throw new Error("Research grant document budget is exhausted");
    }
    search = registry.completedSearch((request as ResearchSnapshotRequest).searchOperationId);
    if (!search || search.grantId !== grant.id) {
      throw new Error("Research snapshot requires a completed search under the same grant");
    }
    if (request.resultIndex >= search.receipt.results.length) {
      throw new Error("Research snapshot names a result outside the recorded search receipt");
    }
  }
  return { request, grant: structuredClone(grant), scope: structuredClone(scope), fingerprint, search };
}
