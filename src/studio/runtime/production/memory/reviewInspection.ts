import { memoryContentId } from "./contentIdentity.ts";
import {
  evaluateMemoryLedger,
  memorySemanticKey,
  type ProposalState,
  uniqueMemoryItemsById,
} from "./ledgerEvaluation.ts";
import {
  memoryMaterializationSnapshotContentId,
  validateMemoryConsumptionLinks,
  validateMemoryMaterializationLinks,
} from "./materialization.ts";
import {
  MEMORY_REVIEW_SCHEMAS,
  type MemoryConsumptionReceipt,
  type MemoryDecision,
  type MemoryLegacySnapshot,
  type MemoryMaterialization,
  type MemoryProposal,
  type MemoryReviewArtifact,
  type MemoryReviewInspection,
  type MemoryReviewTransition,
} from "./model.ts";
import { memoryInspectionFailure, parseMemoryReviewArtifact } from "./validation.ts";

export async function inspectMemoryReviewArtifacts(values: readonly unknown[]): Promise<MemoryReviewInspection> {
  if (values.length === 0) memoryInspectionFailure("artifacts", "must contain at least one selected receipt");
  const artifacts: MemoryReviewArtifact[] = [];
  for (const [index, value] of values.entries()) artifacts.push(await parseMemoryReviewArtifact(value, index));
  const proposals = artifacts.filter((item): item is MemoryProposal => item.schema === MEMORY_REVIEW_SCHEMAS.proposal);
  const decisions = artifacts.filter((item): item is MemoryDecision => item.schema === MEMORY_REVIEW_SCHEMAS.decision);
  const legacy = artifacts.filter((item): item is MemoryLegacySnapshot => item.schema === MEMORY_REVIEW_SCHEMAS.legacy);
  const materializations = artifacts.filter(
    (item): item is MemoryMaterialization => item.schema === MEMORY_REVIEW_SCHEMAS.materialization,
  );
  const consumptions = artifacts.filter(
    (item): item is MemoryConsumptionReceipt => item.schema === MEMORY_REVIEW_SCHEMAS.consumption,
  );
  const proposalById = uniqueMemoryItemsById(proposals, (item) => item.proposal_id, "proposals");
  const decisionById = uniqueMemoryItemsById(decisions, (item) => item.decision_id, "decisions");
  const legacyById = uniqueMemoryItemsById(legacy, (item) => item.snapshot_id, "legacy snapshots");
  uniqueMemoryItemsById(materializations, (item) => item.materialization_id, "materializations");
  uniqueMemoryItemsById(consumptions, (item) => item.consumption_id, "consumptions");
  const evaluated = await evaluateMemoryLedger(proposals, decisions);

  for (const snapshot of materializations) {
    await validateMemoryMaterializationLinks(snapshot, proposalById, decisionById, legacyById);
  }
  await validateMemoryConsumptionLinks(consumptions, materializations);

  const transitions: MemoryReviewTransition[] = [];
  for (const proposal of proposals) {
    const state = evaluated.states.get(proposal.proposal_id);
    if (proposal.supersedes && state?.primary?.action === "accept") {
      transitions.push({
        type: "supersession",
        proposalId: proposal.proposal_id,
        decisionId: state.primary.decision_id,
        createdAt: state.primary.created_at,
        priorProposalId: proposal.supersedes,
        restoredProposalId: null,
      });
    }
    if (state?.revocation) {
      const cutoff = Date.parse(state.revocation.created_at);
      const atRevocation = await evaluateMemoryLedger(
        proposals.filter((candidate) => Date.parse(candidate.created_at) <= cutoff),
        decisions.filter((candidate) => Date.parse(candidate.created_at) <= cutoff),
      );
      transitions.push({
        type: "revocation",
        proposalId: proposal.proposal_id,
        decisionId: state.revocation.decision_id,
        createdAt: state.revocation.created_at,
        priorProposalId: proposal.supersedes,
        restoredProposalId: atRevocation.heads.get(memorySemanticKey(proposal))?.proposal_id ?? null,
      });
    }
  }
  transitions.sort(
    (left, right) => left.createdAt.localeCompare(right.createdAt) || left.decisionId.localeCompare(right.decisionId),
  );

  return {
    schema: "studio.memory.review-inspection.v1",
    scope: "operator_selected_receipts",
    completeness: "not_repository_discovery",
    proposals: await Promise.all(
      proposals
        .slice()
        .sort(
          (left, right) =>
            left.created_at.localeCompare(right.created_at) || left.proposal_id.localeCompare(right.proposal_id),
        )
        .map(async (item) => {
          const state = evaluated.states.get(item.proposal_id) as ProposalState;
          return {
            proposalId: item.proposal_id,
            proposalContentId: await memoryContentId(item),
            namespace: item.namespace,
            kind: item.kind,
            key: item.key,
            value: item.value,
            proposedBy: item.proposed_by,
            createdAt: item.created_at,
            source: item.source,
            evidence: item.evidence,
            status: state.status === "accepted" && state.supersededBy ? "superseded" : state.status,
            supersedes: item.supersedes,
            supersededBy: state.supersededBy,
            primaryDecision: state.primary,
            revocation: state.revocation,
          };
        }),
    ),
    decisions: decisions
      .slice()
      .sort(
        (left, right) =>
          left.created_at.localeCompare(right.created_at) || left.decision_id.localeCompare(right.decision_id),
      ),
    transitions,
    materializations: await Promise.all(
      materializations
        .slice()
        .sort(
          (left, right) =>
            left.created_at.localeCompare(right.created_at) ||
            left.materialization_id.localeCompare(right.materialization_id),
        )
        .map(async (item) => ({
          materializationId: item.materialization_id,
          snapshotContentId: memoryMaterializationSnapshotContentId(item),
          receiptContentId: await memoryContentId(item),
          createdAt: item.created_at,
          entries: structuredClone(item.entries),
          proposalReceiptIds: item.proposal_receipts.map((receipt) => receipt.id),
          decisionReceiptIds: item.decision_receipts.map((receipt) => receipt.id),
          legacyInputs: structuredClone(item.legacy_inputs),
        })),
    ),
    consumptions: await Promise.all(
      consumptions
        .slice()
        .sort(
          (left, right) =>
            left.consumed_at.localeCompare(right.consumed_at) ||
            left.consumption_id.localeCompare(right.consumption_id),
        )
        .map(async (item) => ({
          consumptionId: item.consumption_id,
          receiptContentId: await memoryContentId(item),
          runId: item.run_id,
          consumedAt: item.consumed_at,
          snapshot: structuredClone(item.snapshot),
        })),
    ),
    legacyInputs: legacy
      .slice()
      .sort(
        (left, right) => left.created_at.localeCompare(right.created_at) || left.snapshot_id.localeCompare(right.snapshot_id),
      ),
    counts: {
      proposals: proposals.length,
      decisions: decisions.length,
      revocations: decisions.filter((item) => item.action === "revoke").length,
      materializations: materializations.length,
      consumptions: consumptions.length,
      legacyUnreviewed: legacy.length,
    },
  };
}
