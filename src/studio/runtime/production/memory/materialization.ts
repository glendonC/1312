import { canonicalMemoryJson, memoryContentId } from "./contentIdentity.ts";
import {
  evaluateMemoryLedger,
  memorySemanticKey,
  uniqueMemoryItemsById,
} from "./ledgerEvaluation.ts";
import type {
  MemoryConsumptionReceipt,
  MemoryDecision,
  MemoryLegacySnapshot,
  MemoryMaterialization,
  MemoryProposal,
} from "./model.ts";
import { memoryInspectionFailure } from "./validation.ts";

export function memoryMaterializationSnapshotContentId(snapshot: MemoryMaterialization): string {
  return snapshot.materialization_id.slice("memory-materialization:".length);
}

export async function validateMemoryMaterializationLinks(
  snapshot: MemoryMaterialization,
  proposals: Map<string, MemoryProposal>,
  decisions: Map<string, MemoryDecision>,
  legacy: Map<string, MemoryLegacySnapshot>,
): Promise<void> {
  const proposalRefs = uniqueMemoryItemsById(
    snapshot.proposal_receipts,
    (item) => item.id,
    `materialization ${snapshot.materialization_id}.proposal_receipts`,
  );
  const decisionRefs = uniqueMemoryItemsById(
    snapshot.decision_receipts,
    (item) => item.id,
    `materialization ${snapshot.materialization_id}.decision_receipts`,
  );
  const selectedProposals: MemoryProposal[] = [];
  const selectedDecisions: MemoryDecision[] = [];
  for (const reference of proposalRefs.values()) {
    const proposal = proposals.get(reference.id);
    if (!proposal) {
      memoryInspectionFailure(
        `materialization ${snapshot.materialization_id}`,
        `references unavailable proposal ${reference.id}`,
      );
    }
    if (Date.parse(proposal.created_at) > Date.parse(snapshot.created_at)) {
      memoryInspectionFailure(`materialization ${snapshot.materialization_id}`, `predates proposal ${reference.id}`);
    }
    if (reference.content_id !== await memoryContentId(proposal)) {
      memoryInspectionFailure(
        `materialization ${snapshot.materialization_id}`,
        `records the wrong content id for ${reference.id}`,
      );
    }
    selectedProposals.push(proposal);
  }
  for (const reference of decisionRefs.values()) {
    const decision = decisions.get(reference.id);
    if (!decision) {
      memoryInspectionFailure(
        `materialization ${snapshot.materialization_id}`,
        `references unavailable decision ${reference.id}`,
      );
    }
    if (Date.parse(decision.created_at) > Date.parse(snapshot.created_at)) {
      memoryInspectionFailure(`materialization ${snapshot.materialization_id}`, `predates decision ${reference.id}`);
    }
    if (!proposalRefs.has(decision.proposal_id)) {
      memoryInspectionFailure(
        `materialization ${snapshot.materialization_id}`,
        `omits proposal ${decision.proposal_id} used by ${reference.id}`,
      );
    }
    if (reference.content_id !== await memoryContentId(decision)) {
      memoryInspectionFailure(
        `materialization ${snapshot.materialization_id}`,
        `records the wrong content id for ${reference.id}`,
      );
    }
    selectedDecisions.push(decision);
  }
  const evaluated = await evaluateMemoryLedger(selectedProposals, selectedDecisions);
  for (const reference of proposalRefs.values()) {
    const state = evaluated.states.get(reference.id);
    if (state?.status !== reference.status || state.supersededBy !== reference.superseded_by) {
      memoryInspectionFailure(
        `materialization ${snapshot.materialization_id}`,
        `misstates review status for ${reference.id}`,
      );
    }
  }

  const expectedEntries = [...evaluated.heads.values()]
    .sort((left, right) => memorySemanticKey(left).localeCompare(memorySemanticKey(right)))
    .map((proposal) => {
      const state = evaluated.states.get(proposal.proposal_id);
      return {
        namespace: proposal.namespace,
        kind: proposal.kind,
        key: proposal.key,
        value: proposal.value,
        proposal_id: proposal.proposal_id,
        proposal_content_id: proposalRefs.get(proposal.proposal_id)?.content_id,
        decision_id: state?.primary?.decision_id,
        evidence: proposal.evidence,
      };
    });
  if (canonicalMemoryJson(snapshot.entries) !== canonicalMemoryJson(expectedEntries)) {
    memoryInspectionFailure(
      `materialization ${snapshot.materialization_id}.entries`,
      "do not equal the accepted heads proven by its receipts",
    );
  }

  const legacyIds = new Set<string>();
  for (const input of snapshot.legacy_inputs) {
    if (legacyIds.has(input.snapshot_id)) {
      memoryInspectionFailure(
        `materialization ${snapshot.materialization_id}.legacy_inputs`,
        `repeats ${input.snapshot_id}`,
      );
    }
    legacyIds.add(input.snapshot_id);
    const selected = legacy.get(input.snapshot_id);
    if (!selected) {
      memoryInspectionFailure(
        `materialization ${snapshot.materialization_id}`,
        `references unavailable legacy snapshot ${input.snapshot_id}`,
      );
    }
    if (Date.parse(selected.created_at) > Date.parse(snapshot.created_at)) {
      memoryInspectionFailure(
        `materialization ${snapshot.materialization_id}`,
        `predates legacy snapshot ${input.snapshot_id}`,
      );
    }
    if (
      selected.namespace !== input.namespace ||
      selected.status !== input.status ||
      canonicalMemoryJson(selected.source) !== canonicalMemoryJson(input.source)
    ) {
      memoryInspectionFailure(
        `materialization ${snapshot.materialization_id}`,
        `misstates legacy snapshot ${input.snapshot_id}`,
      );
    }
  }
}

export async function validateMemoryConsumptionLinks(
  consumptions: readonly MemoryConsumptionReceipt[],
  materializations: readonly MemoryMaterialization[],
): Promise<void> {
  const materializationById = new Map(materializations.map((item) => [item.materialization_id, item]));
  const consumptionRuns = new Set<string>();
  for (const receipt of consumptions) {
    if (consumptionRuns.has(receipt.run_id)) {
      memoryInspectionFailure("consumptions", `bind run ${receipt.run_id} more than once`);
    }
    consumptionRuns.add(receipt.run_id);
    const snapshot = materializationById.get(receipt.snapshot.materialization_id);
    if (!snapshot) {
      memoryInspectionFailure(
        `consumption ${receipt.consumption_id}`,
        "references an unavailable materialization receipt",
      );
    }
    if (receipt.snapshot.snapshot_content_id !== memoryMaterializationSnapshotContentId(snapshot)) {
      memoryInspectionFailure(
        `consumption ${receipt.consumption_id}.snapshot.snapshot_content_id`,
        "does not match the accepted snapshot",
      );
    }
    if (receipt.snapshot.materialization_receipt_content_id !== await memoryContentId(snapshot)) {
      memoryInspectionFailure(
        `consumption ${receipt.consumption_id}.snapshot.materialization_receipt_content_id`,
        "does not bind the selected materialization receipt",
      );
    }
    if (receipt.snapshot.entry_count !== snapshot.entries.length) {
      memoryInspectionFailure(
        `consumption ${receipt.consumption_id}.snapshot.entry_count`,
        "does not match the accepted snapshot",
      );
    }
  }
}
