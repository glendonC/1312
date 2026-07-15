import assert from "node:assert/strict";
import test from "node:test";

import * as memoryInspection from "../src/studio/runtime/production/memory/inspection.ts";
import {
  consumeAcceptedMemorySnapshotForRun,
  inspectMemoryReviewArtifacts,
  memoryContentId,
} from "../src/studio/runtime/production/memory/inspection.ts";
import { evaluateMemoryLedger } from "../src/studio/runtime/production/memory/ledgerEvaluation.ts";
import { validateMemoryMaterializationLinks } from "../src/studio/runtime/production/memory/materialization.ts";
import {
  MEMORY_REVIEW_SCHEMAS,
  type MemoryConsumptionReceipt,
  type MemoryDecision,
  type MemoryLegacySnapshot,
  type MemoryMaterialization,
  type MemoryProposal,
} from "../src/studio/runtime/production/memory/model.ts";

const EVIDENCE = {
  path: "runs/memory-test/evidence.json",
  content_id: `sha256:${"e".repeat(64)}`,
  bytes: 128,
};

async function identified<K extends string, T extends Record<string, unknown>>(
  prefix: string,
  idKey: K,
  body: T,
): Promise<T & Record<K, string>> {
  return { [idKey]: `${prefix}:${await memoryContentId(body)}`, ...body } as T & Record<K, string>;
}

async function makeProposal(input: {
  key: string;
  gloss: string;
  proposedBy: string;
  createdAt: string;
  supersedes?: string | null;
  kind?: "glossary" | "rule";
}): Promise<MemoryProposal> {
  const kind = input.kind ?? "glossary";
  const body: Omit<MemoryProposal, "proposal_id"> = {
    schema: MEMORY_REVIEW_SCHEMAS.proposal,
    namespace: kind === "rule" ? "behavior/translation/rules" : "language/ko/glossary",
    kind,
    key: input.key,
    value: kind === "rule" ? { instruction: input.gloss } : { gloss: input.gloss, language: "ko" },
    proposed_by: input.proposedBy,
    created_at: input.createdAt,
    source: { run_id: "run:memory-test", cue_ids: ["cue:1"] },
    evidence: [EVIDENCE],
    supersedes: input.supersedes ?? null,
    review_requirements: kind === "rule" ? { benchmark: { pack_id: "pack:memory-ablation" } } : null,
  };
  return identified("memory-proposal", "proposal_id", body);
}

async function makeDecision(input: {
  proposal: MemoryProposal;
  action: "accept" | "reject" | "revoke";
  reviewer: string;
  reason: string;
  createdAt: string;
  benchmark?: MemoryDecision["benchmark_receipt"];
}): Promise<MemoryDecision> {
  const body: Omit<MemoryDecision, "decision_id"> = {
    schema: MEMORY_REVIEW_SCHEMAS.decision,
    proposal_id: input.proposal.proposal_id,
    proposal_content_id: await memoryContentId(input.proposal),
    action: input.action,
    decided_by: input.reviewer,
    reason: input.reason,
    created_at: input.createdAt,
    benchmark_receipt: input.benchmark ?? null,
  };
  return identified("memory-decision", "decision_id", body);
}

async function makeLegacy(): Promise<MemoryLegacySnapshot> {
  const source = {
    path: "memory/glossary/ko.json",
    content_id: `sha256:${"7".repeat(64)}`,
    bytes: 512,
  };
  const identity = {
    namespace: "language/ko/glossary",
    status: "legacy_unreviewed" as const,
    source_content_id: source.content_id,
  };
  return {
    schema: MEMORY_REVIEW_SCHEMAS.legacy,
    snapshot_id: `memory-legacy:${await memoryContentId(identity)}`,
    namespace: identity.namespace,
    status: identity.status,
    created_at: "2026-07-14T10:00:00.000Z",
    source,
    entry_count: 4,
    note: "Legacy input remains unreviewed and is never an accepted entry.",
  };
}

function entry(proposal: MemoryProposal, acceptance: MemoryDecision) {
  return {
    namespace: proposal.namespace,
    kind: proposal.kind,
    key: proposal.key,
    value: proposal.value,
    proposal_id: proposal.proposal_id,
    proposal_content_id: acceptance.proposal_content_id,
    decision_id: acceptance.decision_id,
    evidence: proposal.evidence,
  };
}

async function makeMaterialization(input: {
  createdAt: string;
  proposals: Array<{ proposal: MemoryProposal; status: "pending" | "accepted" | "rejected" | "revoked"; supersededBy: string | null }>;
  decisions: MemoryDecision[];
  entries: ReturnType<typeof entry>[];
  legacy: MemoryLegacySnapshot;
}): Promise<MemoryMaterialization> {
  const body: Omit<MemoryMaterialization, "materialization_id"> = {
    schema: MEMORY_REVIEW_SCHEMAS.materialization,
    created_at: input.createdAt,
    entries: input.entries,
    proposal_receipts: await Promise.all(
      input.proposals.map(async ({ proposal, status, supersededBy }) => ({
        id: proposal.proposal_id,
        content_id: await memoryContentId(proposal),
        status,
        superseded_by: supersededBy,
      })),
    ),
    decision_receipts: await Promise.all(
      input.decisions.map(async (decision) => ({
        id: decision.decision_id,
        content_id: await memoryContentId(decision),
      })),
    ),
    legacy_inputs: [
      {
        snapshot_id: input.legacy.snapshot_id,
        namespace: input.legacy.namespace,
        status: input.legacy.status,
        source: input.legacy.source,
      },
    ],
  };
  return identified("memory-materialization", "materialization_id", body);
}

async function lifecycle() {
  const legacy = await makeLegacy();
  const first = await makeProposal({
    key: "파인만",
    gloss: "Feynman",
    proposedBy: "producer:first",
    createdAt: "2026-07-14T10:01:00.000Z",
  });
  const firstAcceptance = await makeDecision({
    proposal: first,
    action: "accept",
    reviewer: "reviewer:first",
    reason: "The selected evidence supports this spelling.",
    createdAt: "2026-07-14T10:02:00.000Z",
  });
  const firstSnapshot = await makeMaterialization({
    createdAt: "2026-07-14T10:03:00.000Z",
    proposals: [{ proposal: first, status: "accepted", supersededBy: null }],
    decisions: [firstAcceptance],
    entries: [entry(first, firstAcceptance)],
    legacy,
  });
  const replacement = await makeProposal({
    key: "파인만",
    gloss: "Richard Feynman",
    proposedBy: "producer:replacement",
    createdAt: "2026-07-14T10:04:00.000Z",
    supersedes: first.proposal_id,
  });
  const replacementAcceptance = await makeDecision({
    proposal: replacement,
    action: "accept",
    reviewer: "reviewer:replacement",
    reason: "The later evidence supports the expanded surface form.",
    createdAt: "2026-07-14T10:05:00.000Z",
  });
  const replacementSnapshot = await makeMaterialization({
    createdAt: "2026-07-14T10:06:00.000Z",
    proposals: [
      { proposal: first, status: "accepted", supersededBy: replacement.proposal_id },
      { proposal: replacement, status: "accepted", supersededBy: null },
    ],
    decisions: [firstAcceptance, replacementAcceptance],
    entries: [entry(replacement, replacementAcceptance)],
    legacy,
  });
  const revocation = await makeDecision({
    proposal: replacement,
    action: "revoke",
    reviewer: "reviewer:rollback",
    reason: "The expanded form is not supported outside the proposing run.",
    createdAt: "2026-07-14T10:07:00.000Z",
  });
  const rollbackSnapshot = await makeMaterialization({
    createdAt: "2026-07-14T10:08:00.000Z",
    proposals: [
      { proposal: first, status: "accepted", supersededBy: null },
      { proposal: replacement, status: "revoked", supersededBy: null },
    ],
    decisions: [firstAcceptance, replacementAcceptance, revocation],
    entries: [entry(first, firstAcceptance)],
    legacy,
  });
  return {
    legacy,
    first,
    firstAcceptance,
    firstSnapshot,
    replacement,
    replacementAcceptance,
    replacementSnapshot,
    revocation,
    rollbackSnapshot,
    artifacts: [
      legacy,
      first,
      firstAcceptance,
      firstSnapshot,
      replacement,
      replacementAcceptance,
      replacementSnapshot,
      revocation,
      rollbackSnapshot,
    ],
  };
}

test("memory inspection preserves its exact public export surface", () => {
  assert.deepEqual(Object.keys(memoryInspection).sort(), [
    "consumeAcceptedMemorySnapshotForRun",
    "inspectMemoryReviewArtifacts",
    "memoryContentId",
  ]);
});

test("memory inspection projects proposal, supersession, rollback, and materialization receipts", async () => {
  const fixture = await lifecycle();
  const inspection = await inspectMemoryReviewArtifacts(fixture.artifacts);

  assert.deepEqual(inspection.counts, {
    proposals: 2,
    decisions: 3,
    revocations: 1,
    materializations: 3,
    consumptions: 0,
    legacyUnreviewed: 1,
  });
  assert.equal(inspection.proposals.find((item) => item.proposalId === fixture.first.proposal_id)?.status, "accepted");
  assert.equal(inspection.proposals.find((item) => item.proposalId === fixture.replacement.proposal_id)?.status, "revoked");
  assert.deepEqual(
    inspection.transitions.map((transition) => ({
      type: transition.type,
      proposalId: transition.proposalId,
      priorProposalId: transition.priorProposalId,
      restoredProposalId: transition.restoredProposalId,
    })),
    [
      {
        type: "supersession",
        proposalId: fixture.replacement.proposal_id,
        priorProposalId: fixture.first.proposal_id,
        restoredProposalId: null,
      },
      {
        type: "revocation",
        proposalId: fixture.replacement.proposal_id,
        priorProposalId: fixture.first.proposal_id,
        restoredProposalId: fixture.first.proposal_id,
      },
    ],
  );
  const rollback = inspection.materializations.find(
    (item) => item.materializationId === fixture.rollbackSnapshot.materialization_id,
  );
  assert.equal(rollback?.snapshotContentId, fixture.rollbackSnapshot.materialization_id.replace("memory-materialization:", ""));
  assert.equal(rollback?.entries[0].proposal_id, fixture.first.proposal_id);
  assert.equal(rollback?.legacyInputs[0].status, "legacy_unreviewed");
});

test("run consumption records the exact accepted snapshot before exposing entries", async () => {
  const fixture = await lifecycle();
  const recorded: MemoryConsumptionReceipt[] = [];
  const consumed = await consumeAcceptedMemorySnapshotForRun(
    fixture.artifacts,
    {
      runId: "run:future-memory-consumer",
      materializationId: fixture.rollbackSnapshot.materialization_id,
      consumedAt: "2026-07-14T10:09:00.000Z",
    },
    async (receipt) => {
      recorded.push(receipt);
    },
  );

  assert.deepEqual(consumed.receipt, recorded[0]);
  assert.equal(consumed.entries[0].proposal_id, fixture.first.proposal_id);
  assert.equal(
    consumed.receipt.snapshot.snapshot_content_id,
    fixture.rollbackSnapshot.materialization_id.replace("memory-materialization:", ""),
  );
  assert.equal(consumed.receipt.snapshot.materialization_receipt_content_id, await memoryContentId(fixture.rollbackSnapshot));
  assert.deepEqual(consumed.receipt.policy, {
    promotion: "reviewed_materialization_only",
    legacy_unreviewed: "excluded",
    unavailable: "fail_closed",
  });

  const withConsumption = await inspectMemoryReviewArtifacts([...fixture.artifacts, consumed.receipt]);
  assert.equal(withConsumption.consumptions[0].runId, "run:future-memory-consumer");
  assert.equal(withConsumption.consumptions[0].snapshot.snapshot_content_id, consumed.receipt.snapshot.snapshot_content_id);
});

test("run consumption fails closed when receipt recording fails", async () => {
  const fixture = await lifecycle();
  await assert.rejects(
    () =>
      consumeAcceptedMemorySnapshotForRun(
        fixture.artifacts,
        {
          runId: "run:unrecorded-memory",
          materializationId: fixture.rollbackSnapshot.materialization_id,
          consumedAt: "2026-07-14T10:09:00.000Z",
        },
        async () => {
          throw new Error("receipt store unavailable");
        },
      ),
    /receipt store unavailable/,
  );
});

test("memory inspection rejects tampering, invented materializations, and legacy promotion", async () => {
  const fixture = await lifecycle();
  const tamperedProposal = structuredClone(fixture.first);
  (tamperedProposal.value as { gloss: string }).gloss = "Invented rewrite";
  await assert.rejects(
    () => inspectMemoryReviewArtifacts([tamperedProposal]),
    /proposal_id does not match the canonical proposal contents/,
  );

  const inventedBody = {
    schema: MEMORY_REVIEW_SCHEMAS.materialization,
    created_at: "2026-07-14T10:03:00.000Z",
    entries: [entry(fixture.first, fixture.firstAcceptance)],
    proposal_receipts: [],
    decision_receipts: [],
    legacy_inputs: [
      {
        snapshot_id: fixture.legacy.snapshot_id,
        namespace: fixture.legacy.namespace,
        status: fixture.legacy.status,
        source: fixture.legacy.source,
      },
    ],
  };
  const invented = await identified("memory-materialization", "materialization_id", inventedBody);
  await assert.rejects(
    () => inspectMemoryReviewArtifacts([fixture.legacy, invented]),
    /entries do not equal the accepted heads proven by its receipts/,
  );
});

test("accepted rules remain ablation-pair-bound in the inspection path", async () => {
  const rule = await makeProposal({
    key: "rule:preserve-hedges",
    gloss: "Preserve uncertainty markers.",
    proposedBy: "producer:rule",
    createdAt: "2026-07-14T11:00:00.000Z",
    kind: "rule",
  });
  const acceptanceWithoutAblation = await makeDecision({
    proposal: rule,
    action: "accept",
    reviewer: "reviewer:rule",
    reason: "This must not be enough on its own.",
    createdAt: "2026-07-14T11:01:00.000Z",
  });
  await assert.rejects(
    () => inspectMemoryReviewArtifacts([rule, acceptanceWithoutAblation]),
    /must record a rule ablation pair/,
  );
});

test("consumption receipts cannot substitute a different snapshot identity", async () => {
  const fixture = await lifecycle();
  const body = {
    schema: MEMORY_REVIEW_SCHEMAS.consumption,
    run_id: "run:mismatched-memory",
    consumed_at: "2026-07-14T10:09:00.000Z",
    snapshot: {
      materialization_id: fixture.rollbackSnapshot.materialization_id,
      snapshot_content_id: `sha256:${"0".repeat(64)}`,
      materialization_receipt_content_id: await memoryContentId(fixture.rollbackSnapshot),
      entry_count: fixture.rollbackSnapshot.entries.length,
    },
    policy: {
      promotion: "reviewed_materialization_only" as const,
      legacy_unreviewed: "excluded" as const,
      unavailable: "fail_closed" as const,
    },
  };
  const receipt = await identified("memory-consumption", "consumption_id", body);
  await assert.rejects(
    () => inspectMemoryReviewArtifacts([...fixture.artifacts, receipt]),
    /snapshot_content_id does not match the accepted snapshot/,
  );
});

test("memory receipt parsing remains closed before ledger evaluation", async () => {
  const fixture = await lifecycle();
  await assert.rejects(
    () => inspectMemoryReviewArtifacts([{ ...fixture.first, approved: true }]),
    { message: /^memory inspection: artifacts\[0\]\.approved is not allowed$/ },
  );
});

test("memory ledger decisions remain independent from their proposer", async () => {
  const proposal = await makeProposal({
    key: "독립 검토",
    gloss: "independent review",
    proposedBy: "reviewer:same-person",
    createdAt: "2026-07-14T12:00:00.000Z",
  });
  const decision = await makeDecision({
    proposal,
    action: "accept",
    reviewer: proposal.proposed_by,
    reason: "A proposer cannot approve their own cross-run memory.",
    createdAt: "2026-07-14T12:01:00.000Z",
  });

  await assert.rejects(
    () => inspectMemoryReviewArtifacts([proposal, decision]),
    {
      message:
        /^memory inspection: decision memory-decision:sha256:[a-f0-9]{64}\.decided_by must differ from the proposer$/,
    },
  );
});

test("materializations cannot misstate evaluated proposal status", async () => {
  const fixture = await lifecycle();
  const { materialization_id: _materializationId, ...body } = structuredClone(fixture.firstSnapshot);
  body.proposal_receipts[0].status = "rejected";
  const misstated = await identified("memory-materialization", "materialization_id", body);

  await assert.rejects(
    () => inspectMemoryReviewArtifacts([fixture.legacy, fixture.first, fixture.firstAcceptance, misstated]),
    {
      message:
        /^memory inspection: materialization memory-materialization:sha256:[a-f0-9]{64} misstates review status for memory-proposal:sha256:[a-f0-9]{64}$/,
    },
  );
});

test("ledger evaluation independently derives rollback heads", async () => {
  const fixture = await lifecycle();
  const evaluated = await evaluateMemoryLedger(
    [fixture.first, fixture.replacement],
    [fixture.firstAcceptance, fixture.replacementAcceptance, fixture.revocation],
  );

  assert.equal(evaluated.states.get(fixture.replacement.proposal_id)?.status, "revoked");
  assert.equal([...evaluated.heads.values()][0]?.proposal_id, fixture.first.proposal_id);
});

test("materialization verification independently validates receipt closure", async () => {
  const fixture = await lifecycle();
  await validateMemoryMaterializationLinks(
    fixture.rollbackSnapshot,
    new Map([
      [fixture.first.proposal_id, fixture.first],
      [fixture.replacement.proposal_id, fixture.replacement],
    ]),
    new Map([
      [fixture.firstAcceptance.decision_id, fixture.firstAcceptance],
      [fixture.replacementAcceptance.decision_id, fixture.replacementAcceptance],
      [fixture.revocation.decision_id, fixture.revocation],
    ]),
    new Map([[fixture.legacy.snapshot_id, fixture.legacy]]),
  );
});
