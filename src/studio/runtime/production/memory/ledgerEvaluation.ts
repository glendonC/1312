import { memoryContentId } from "./contentIdentity.ts";
import type { MemoryDecision, MemoryProposal } from "./model.ts";
import { memoryInspectionFailure } from "./validation.ts";

export interface ProposalState {
  status: "pending" | "accepted" | "rejected" | "revoked";
  primary: MemoryDecision | null;
  revocation: MemoryDecision | null;
  supersededBy: string | null;
}

export interface EvaluatedMemoryLedger {
  states: Map<string, ProposalState>;
  heads: Map<string, MemoryProposal>;
}

export function memorySemanticKey(proposal: Pick<MemoryProposal, "namespace" | "kind" | "key">): string {
  return JSON.stringify([proposal.namespace, proposal.kind, proposal.key]);
}

export function uniqueMemoryItemsById<T>(
  values: readonly T[],
  id: (value: T) => string,
  path: string,
): Map<string, T> {
  const result = new Map<string, T>();
  for (const value of values) {
    const key = id(value);
    if (result.has(key)) memoryInspectionFailure(path, `repeats ${key}`);
    result.set(key, value);
  }
  return result;
}

export async function evaluateMemoryLedger(
  proposals: readonly MemoryProposal[],
  decisions: readonly MemoryDecision[],
): Promise<EvaluatedMemoryLedger> {
  const proposalById = uniqueMemoryItemsById(proposals, (item) => item.proposal_id, "proposals");
  const proposalContentIds = new Map(
    await Promise.all(proposals.map(async (item) => [item.proposal_id, await memoryContentId(item)] as const)),
  );
  const decisionsByProposal = new Map<string, MemoryDecision[]>();
  for (const decision of decisions) {
    const proposal = proposalById.get(decision.proposal_id);
    if (!proposal) {
      memoryInspectionFailure(`decision ${decision.decision_id}`, "references an unavailable proposal receipt");
    }
    if (decision.proposal_content_id !== proposalContentIds.get(proposal.proposal_id)) {
      memoryInspectionFailure(
        `decision ${decision.decision_id}.proposal_content_id`,
        "does not bind the selected proposal contents",
      );
    }
    if (decision.decided_by === proposal.proposed_by) {
      memoryInspectionFailure(`decision ${decision.decision_id}.decided_by`, "must differ from the proposer");
    }
    if (decision.action === "accept" && proposal.kind === "rule") {
      if (decision.benchmark_receipt === null) {
        memoryInspectionFailure(`decision ${decision.decision_id}.benchmark_receipt`, "must record a rule ablation pair");
      }
      if (decision.benchmark_receipt.pack_id !== proposal.review_requirements?.benchmark.pack_id) {
        memoryInspectionFailure(
          `decision ${decision.decision_id}.benchmark_receipt.pack_id`,
          "does not match the proposed rule requirement",
        );
      }
      if (decision.benchmark_receipt.rule_content_id !== await memoryContentId(proposal.value)) {
        memoryInspectionFailure(
          `decision ${decision.decision_id}.benchmark_receipt.rule_content_id`,
          "does not identify the proposed rule value",
        );
      }
    } else if (decision.benchmark_receipt !== null) {
      memoryInspectionFailure(
        `decision ${decision.decision_id}.benchmark_receipt`,
        "is only valid when accepting a behavioral rule",
      );
    }
    const list = decisionsByProposal.get(decision.proposal_id) ?? [];
    list.push(decision);
    decisionsByProposal.set(decision.proposal_id, list);
  }

  for (const proposal of proposals) {
    if (proposal.supersedes === null) continue;
    const prior = proposalById.get(proposal.supersedes);
    if (!prior) {
      memoryInspectionFailure(`proposal ${proposal.proposal_id}.supersedes`, "references an unavailable proposal receipt");
    }
    if (memorySemanticKey(prior) !== memorySemanticKey(proposal)) {
      memoryInspectionFailure(`proposal ${proposal.proposal_id}.supersedes`, "changes namespace, kind, or key");
    }
    const seen = new Set([proposal.proposal_id]);
    let cursor: MemoryProposal | undefined = prior;
    while (cursor) {
      if (seen.has(cursor.proposal_id)) {
        memoryInspectionFailure(`proposal ${proposal.proposal_id}.supersedes`, "forms a cycle");
      }
      seen.add(cursor.proposal_id);
      cursor = cursor.supersedes ? proposalById.get(cursor.supersedes) : undefined;
    }
  }

  const states = new Map<string, ProposalState>();
  for (const proposal of proposals) {
    const list = decisionsByProposal.get(proposal.proposal_id) ?? [];
    const primary = list.filter((item) => item.action === "accept" || item.action === "reject");
    const revocations = list.filter((item) => item.action === "revoke");
    if (primary.length > 1) memoryInspectionFailure(`proposal ${proposal.proposal_id}`, "has multiple primary decisions");
    if (revocations.length > 1) memoryInspectionFailure(`proposal ${proposal.proposal_id}`, "has multiple revocations");
    if (revocations.length > 0 && (primary.length !== 1 || primary[0].action !== "accept")) {
      memoryInspectionFailure(`proposal ${proposal.proposal_id}`, "was revoked without an acceptance receipt");
    }
    if (revocations.length > 0 && Date.parse(revocations[0].created_at) <= Date.parse(primary[0].created_at)) {
      memoryInspectionFailure(`proposal ${proposal.proposal_id}`, "was revoked before or at its acceptance time");
    }
    states.set(proposal.proposal_id, {
      status:
        primary.length === 0
          ? "pending"
          : primary[0].action === "reject"
            ? "rejected"
            : revocations.length > 0
              ? "revoked"
              : "accepted",
      primary: primary[0] ?? null,
      revocation: revocations[0] ?? null,
      supersededBy: null,
    });
  }

  for (const proposal of proposals) {
    if (proposal.supersedes === null || states.get(proposal.proposal_id)?.status !== "accepted") continue;
    const acceptedAt = states.get(proposal.proposal_id)?.primary?.created_at;
    const prior = states.get(proposal.supersedes);
    if (!acceptedAt || prior?.primary?.action !== "accept" || Date.parse(prior.primary.created_at) >= Date.parse(acceptedAt)) {
      memoryInspectionFailure(`proposal ${proposal.proposal_id}`, "was accepted without a preceding accepted head");
    }
    if (prior.revocation && Date.parse(prior.revocation.created_at) <= Date.parse(acceptedAt)) {
      memoryInspectionFailure(`proposal ${proposal.proposal_id}`, "was accepted after the prior head was revoked");
    }
    if (prior.status === "accepted") prior.supersededBy = proposal.proposal_id;
  }

  const heads = new Map<string, MemoryProposal>();
  for (const proposal of proposals) {
    const state = states.get(proposal.proposal_id);
    if (state?.status !== "accepted" || state.supersededBy !== null) continue;
    const key = memorySemanticKey(proposal);
    if (heads.has(key)) memoryInspectionFailure(`memory key ${proposal.key}`, "has multiple accepted heads");
    heads.set(key, proposal);
  }
  return { states, heads };
}
