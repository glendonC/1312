import { ContentAddressedArtifactStore } from "../artifactStore.ts";
import { canonicalJson } from "../artifactStore/contentIdentity.ts";
import {
  buildResearchExhaustionReceiptArtifact,
  researchExhaustionReceiptArtifactId,
} from "../artifactStore/researchArtifacts.ts";
import type { RuntimeLedger } from "../journal.ts";
import type { PendingRuntimeEvent } from "../protocol.ts";
import {
  RESEARCH_LIMITS,
  type ResearchExecutionBinding,
  type ResearchExhaustionReceipt,
  type ResearchGrantView,
} from "../model/research.ts";
import {
  researchExhaustionReceiptId,
  validateResearchExhaustionReceipt,
} from "../validation/research.ts";
import { auditResearchSearch } from "./researchAudit.ts";

export interface VerifiedResearchExhaustion {
  receipt: ResearchExhaustionReceipt;
  receiptContentId: string;
  receiptArtifactId: string;
}

function same(left: unknown, right: unknown): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

/**
 * Host-owned terminal R1 cause. The caller supplies no task, grant, gap, operation, or reason: the
 * host derives the only registered cause from the bound executor and durable empty-search receipts.
 */
export class ResearchExhaustionHost {
  private readonly runId: string;
  private readonly view: ResearchGrantView;
  private readonly artifacts: ContentAddressedArtifactStore;
  private readonly ledger: RuntimeLedger;
  private readonly execution: ResearchExecutionBinding;

  constructor(
    runId: string,
    view: ResearchGrantView,
    artifacts: ContentAddressedArtifactStore,
    binding: { ledger: RuntimeLedger; execution: ResearchExecutionBinding },
  ) {
    this.runId = runId;
    this.view = structuredClone(view);
    this.artifacts = artifacts;
    this.ledger = binding.ledger;
    this.execution = structuredClone(binding.execution);
  }

  async record(): Promise<VerifiedResearchExhaustion> {
    if (this.runId !== this.ledger.runId) throw new Error("Research exhaustion host belongs to another run");
    const grants = this.view.grants.filter((grant) => grant.capability === "research.investigate");
    if (grants.length !== 1) throw new Error("Research exhaustion requires one exact research grant");
    const grant = grants[0];
    const state = this.ledger.state();
    const task = state.tasks[this.view.taskId];
    const currentGrant = task?.grants.find((candidate) => candidate.id === grant.id);
    const execution = state.executions[this.execution.executionId];
    const launch = task ? state.taskLaunches[task.id] : undefined;
    if (
      !task || task.status !== "working" || task.ownerAgentId !== this.view.agentId ||
      currentGrant?.capability !== "research.investigate" || !same(currentGrant.researchScope, grant.researchScope) ||
      execution?.status !== "active" || execution.taskId !== task.id || execution.agentId !== task.ownerAgentId ||
      execution.launchClaimId !== this.execution.launchClaimId || launch?.id !== this.execution.launchClaimId ||
      launch.executionId !== execution.id
    ) {
      throw new Error("Research exhaustion lost its working task, grant, or executor lineage");
    }
    if (Object.values(state.researchExhaustions).some((entry) => entry.grantId === grant.id)) {
      throw new Error("Research grant already has a terminal exhaustion cause");
    }
    const operations = Object.values(state.researchOperations)
      .filter((operation) => operation.grantId === grant.id)
      .sort((left, right) => left.id.localeCompare(right.id));
    if (
      operations.length !== RESEARCH_LIMITS.maxQueries ||
      operations.some((operation) =>
        operation.op !== "search" || operation.status !== "completed" || operation.searchResultCount !== 0 ||
        !operation.receiptArtifactId || !operation.receiptId || !operation.receiptContentId)
    ) {
      throw new Error("Research exhaustion requires the full query budget as completed empty searches");
    }
    for (const operation of operations) {
      const audited = await auditResearchSearch(this.artifacts, this.runId, operation.receiptContentId!);
      if (
        audited.receiptArtifactId !== operation.receiptArtifactId || audited.receipt.receiptId !== operation.receiptId ||
        audited.receipt.state !== "empty" || audited.receipt.results.length !== 0 ||
        !same(audited.receipt.authorization, {
          grantId: grant.id,
          taskId: task.id,
          agentId: task.ownerAgentId,
          executionId: execution.id,
          launchClaimId: launch.id,
        }) || !same(audited.receipt.gap, grant.researchScope.gap)
      ) {
        throw new Error("Research exhaustion search receipts changed empty-result grant lineage");
      }
    }
    const body: Omit<ResearchExhaustionReceipt, "receiptId"> = {
      schema: "studio.research-exhaustion.receipt.v1",
      runId: this.runId,
      authorization: {
        grantId: grant.id,
        taskId: task.id,
        agentId: task.ownerAgentId,
        executionId: execution.id,
        launchClaimId: launch.id,
      },
      gap: structuredClone(grant.researchScope.gap),
      reason: "query_budget_exhausted_without_results",
      operations: operations.map((operation) => ({
        operationId: operation.id,
        receiptArtifactId: operation.receiptArtifactId!,
        receiptId: operation.receiptId!,
        receiptContentId: operation.receiptContentId!,
      })),
      limits: structuredClone(grant.researchScope.limits),
      outcome: "r1_insufficient",
      nonClaims: {
        semanticInsufficiency: "not_assessed",
        sourceTruth: "not_assessed",
        entityMatch: "not_assessed",
        speechEvidenceAuthority: "not_granted",
        claimSupportAuthority: "not_granted",
        captionAuthority: "not_granted",
        r2Authorization: "cause_only",
      },
    };
    const receipt = validateResearchExhaustionReceipt({
      ...body,
      receiptId: researchExhaustionReceiptId(body),
    });
    const stored = await this.artifacts.storeJson(receipt);
    if (stored.content.bytes > RESEARCH_LIMITS.maxJsonArtifactBytes) {
      throw new Error("Research exhaustion receipt exceeds its byte ceiling");
    }
    const receiptArtifactId = researchExhaustionReceiptArtifactId(this.runId, receipt.receiptId, stored.content.contentId);
    const artifact = buildResearchExhaustionReceiptArtifact({
      runId: this.runId,
      taskId: task.id,
      agentId: task.ownerAgentId,
      receipt,
      sourceArtifactIds: receipt.operations.map((operation) => operation.receiptArtifactId),
      prepared: { artifactId: receiptArtifactId, content: stored.content, storageKey: stored.storageKey },
    });
    await this.ledger.transact(
      { producer: { kind: "research_host", id: "research-exhaustion-host" }, causationId: receipt.receiptId },
      () => ({ pending: [
        { type: "artifact.recorded", data: { artifact } },
        { type: "research.exhaustion_recorded", data: {
          outputArtifactId: artifact.id,
          receiptContentId: stored.content.contentId,
          receipt,
        } },
      ] satisfies PendingRuntimeEvent[], result: undefined }),
    );
    return { receipt, receiptContentId: stored.content.contentId, receiptArtifactId };
  }
}
