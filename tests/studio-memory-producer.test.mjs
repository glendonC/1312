import assert from "node:assert/strict";
import test from "node:test";

import { contentIdForJson } from "../scripts/lib/immutable-receipts.mjs";
import * as memoryReview from "../scripts/lib/memory-review.mjs";

const EVIDENCE = {
  path: "runs/memory-producer/evidence.json",
  content_id: `sha256:${"e".repeat(64)}`,
  bytes: 64,
};

function identified(prefix, idKey, body) {
  return { [idKey]: `${prefix}:${contentIdForJson(body)}`, ...body };
}

function proposal({ key, value, proposer, createdAt, supersedes = null }) {
  return identified("memory-proposal", "proposal_id", {
    schema: memoryReview.MEMORY_SCHEMAS.proposal,
    namespace: "language/ko/glossary",
    kind: "glossary",
    key,
    value,
    proposed_by: proposer,
    created_at: createdAt,
    source: { run_id: "run:memory-producer" },
    evidence: [EVIDENCE],
    supersedes,
    review_requirements: null,
  });
}

function decision({ proposal: selected, action, reviewer, createdAt }) {
  return identified("memory-decision", "decision_id", {
    schema: memoryReview.MEMORY_SCHEMAS.decision,
    proposal_id: selected.proposal_id,
    proposal_content_id: contentIdForJson(selected),
    action,
    decided_by: reviewer,
    reason: `${action} is supported by the selected producer fixture.`,
    created_at: createdAt,
    benchmark_receipt: null,
  });
}

test("memory review producer preserves its exact public export surface", () => {
  assert.deepEqual(Object.keys(memoryReview).sort(), [
    "MEMORY_SCHEMAS",
    "acceptedHead",
    "evaluateLedger",
    "loadLedger",
    "materializeMemory",
    "recordDecision",
    "recordLegacySnapshot",
    "recordProposal",
    "validateDecision",
    "validateProposal",
    "validateRunProposalManifest",
  ]);
});

test("memory review producer keeps proposal and decision contracts closed", () => {
  const selected = proposal({
    key: "파인만",
    value: { gloss: "Feynman", language: "ko" },
    proposer: "producer:first",
    createdAt: "2026-07-15T10:00:00.000Z",
  });
  assert.equal(memoryReview.validateProposal(selected), selected);
  assert.throws(
    () => memoryReview.validateProposal({ ...selected, approved: true }),
    { message: "memory proposal shape is not closed; extra: approved" },
  );

  const acceptance = decision({
    proposal: selected,
    action: "accept",
    reviewer: "reviewer:first",
    createdAt: "2026-07-15T10:01:00.000Z",
  });
  assert.equal(memoryReview.validateDecision(acceptance), acceptance);
  assert.throws(
    () => memoryReview.validateDecision({ ...acceptance, confidence: 1 }),
    { message: "memory decision shape is not closed; extra: confidence" },
  );
});

test("memory review ledger independently derives supersession rollback", () => {
  const first = proposal({
    key: "파인만",
    value: { gloss: "Feynman", language: "ko" },
    proposer: "producer:first",
    createdAt: "2026-07-15T10:00:00.000Z",
  });
  const firstAcceptance = decision({
    proposal: first,
    action: "accept",
    reviewer: "reviewer:first",
    createdAt: "2026-07-15T10:01:00.000Z",
  });
  const replacement = proposal({
    key: "파인만",
    value: { gloss: "Richard Feynman", language: "ko" },
    proposer: "producer:replacement",
    createdAt: "2026-07-15T10:02:00.000Z",
    supersedes: first.proposal_id,
  });
  const replacementAcceptance = decision({
    proposal: replacement,
    action: "accept",
    reviewer: "reviewer:replacement",
    createdAt: "2026-07-15T10:03:00.000Z",
  });
  const revocation = decision({
    proposal: replacement,
    action: "revoke",
    reviewer: "reviewer:rollback",
    createdAt: "2026-07-15T10:04:00.000Z",
  });
  const ledger = {
    proposals: [first, replacement],
    decisions: [firstAcceptance, replacementAcceptance, revocation],
  };
  const evaluated = memoryReview.evaluateLedger(ledger);

  assert.equal(evaluated.states.get(replacement.proposal_id).status, "revoked");
  assert.equal(
    memoryReview.acceptedHead(ledger, {
      namespace: first.namespace,
      kind: first.kind,
      key: first.key,
    }).proposal_id,
    first.proposal_id,
  );
});

test("run proposal manifests stay bound to immutable proposals", () => {
  const selected = proposal({
    key: "검증",
    value: { gloss: "verification", language: "ko" },
    proposer: "producer:manifest",
    createdAt: "2026-07-15T11:00:00.000Z",
  });
  const body = {
    schema: memoryReview.MEMORY_SCHEMAS.runProposalManifest,
    run: "run:memory-producer",
    clip: "clip:memory-producer",
    status: "pending_review",
    proposals: [
      {
        proposal_id: selected.proposal_id,
        proposal_content_id: contentIdForJson(selected),
        namespace: selected.namespace,
        kind: selected.kind,
        key: selected.key,
        status: "pending_review",
      },
    ],
  };
  const manifest = identified("memory-proposal-manifest", "manifest_id", body);
  assert.equal(
    memoryReview.validateRunProposalManifest(manifest, {
      runId: body.run,
      clipId: body.clip,
      proposals: [selected],
    }),
    manifest,
  );

  const changed = structuredClone(manifest);
  changed.proposals[0].proposal_content_id = `sha256:${"0".repeat(64)}`;
  assert.throws(
    () => memoryReview.validateRunProposalManifest(changed, { proposals: [selected] }),
    { message: "run proposal manifest item 0 does not match its immutable proposal" },
  );
});
