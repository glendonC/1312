import { readFile, readdir } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";

import Ajv2020 from "ajv/dist/2020.js";

import {
  validateFreezeReceipt,
  validatePack,
  validateScoreReceipt,
} from "./bench-gold.mjs";
import {
  contentIdForJson,
  digestFromContentId,
  fileReceipt,
  writeImmutableJson,
} from "./immutable-receipts.mjs";

export const MEMORY_SCHEMAS = Object.freeze({
  proposal: "studio.memory.proposal.v1",
  decision: "studio.memory.decision.v1",
  legacy: "studio.memory.legacy-snapshot.v1",
  materialization: "studio.memory.materialization.v1",
  runProposalManifest: "studio.memory.run-proposals.v1",
});

const KINDS = new Set(["glossary", "correction", "rule"]);
const ACTIONS = new Set(["accept", "reject", "revoke"]);

function requiredText(value, context) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${context} must be a non-empty string`);
  return value.trim();
}

function namespace(value) {
  const result = requiredText(value, "memory namespace");
  if (!/^[a-z0-9][a-z0-9._/-]*$/.test(result) || result.includes("..") || result.endsWith("/")) {
    throw new Error("memory namespace must be a lowercase path-like identifier without traversal");
  }
  return result;
}

function createdAt(value = new Date().toISOString()) {
  const result = requiredText(value, "created_at");
  if (Number.isNaN(Date.parse(result)) || new Date(result).toISOString() !== result) {
    throw new Error("created_at must be an exact ISO-8601 UTC timestamp");
  }
  return result;
}

function kind(value) {
  if (!KINDS.has(value)) throw new Error(`memory kind ${String(value)} is not registered`);
  return value;
}

function action(value) {
  if (!ACTIONS.has(value)) throw new Error(`memory decision ${String(value)} is not registered`);
  return value;
}

function ensureJsonValue(value, context) {
  if (value === undefined) throw new Error(`${context} is required`);
  contentIdForJson(value);
  return value;
}

function exactKeys(value, allowed, context) {
  const extras = Object.keys(value).filter((key) => !allowed.includes(key));
  const missing = allowed.filter((key) => !(key in value));
  if (extras.length > 0 || missing.length > 0) {
    throw new Error(
      `${context} shape is not closed${extras.length ? `; extra: ${extras.join(", ")}` : ""}${missing.length ? `; missing: ${missing.join(", ")}` : ""}`,
    );
  }
}

function receiptId(prefix, body) {
  return `${prefix}:${contentIdForJson(body)}`;
}

function digestFromReceiptId(id, prefix) {
  const expected = `${prefix}:`;
  if (typeof id !== "string" || !id.startsWith(expected)) {
    throw new Error(`${prefix} receipt id is invalid`);
  }
  return digestFromContentId(id.slice(expected.length), `${prefix} receipt id`);
}

function recordPath(store, collection, id, prefix) {
  return join(store, collection, `${digestFromReceiptId(id, prefix)}.json`);
}

async function readJson(path, context = path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    throw new Error(`${context} is not readable JSON`, { cause: error });
  }
}

async function jsonFiles(path) {
  try {
    return (await readdir(path, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => join(path, entry.name))
      .sort((left, right) => left.localeCompare(right));
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

function resolveFile(path, workspaceRoot) {
  return isAbsolute(path) ? path : resolve(workspaceRoot, path);
}

async function verifyFileReceipt(receipt, workspaceRoot, context) {
  if (!receipt || typeof receipt !== "object") throw new Error(`${context} must be a file receipt`);
  const path = requiredText(receipt.path, `${context}.path`);
  const expected = await fileReceipt(resolveFile(path, workspaceRoot), path);
  if (receipt.content_id !== expected.content_id || receipt.bytes !== expected.bytes) {
    throw new Error(`${context} no longer matches its recorded bytes`);
  }
  return expected;
}

function proposalBody(proposal) {
  const {
    proposal_id: _proposalId,
    ...body
  } = proposal;
  return body;
}

function decisionBody(decision) {
  const {
    decision_id: _decisionId,
    ...body
  } = decision;
  return body;
}

export function validateProposal(proposal) {
  if (!proposal || typeof proposal !== "object" || Array.isArray(proposal)) {
    throw new Error("memory proposal must be an object");
  }
  if (proposal.schema !== MEMORY_SCHEMAS.proposal) throw new Error("memory proposal schema is not registered");
  exactKeys(
    proposal,
    [
      "proposal_id",
      "schema",
      "namespace",
      "kind",
      "key",
      "value",
      "proposed_by",
      "created_at",
      "source",
      "evidence",
      "supersedes",
      "review_requirements",
    ],
    "memory proposal",
  );
  digestFromReceiptId(proposal.proposal_id, "memory-proposal");
  namespace(proposal.namespace);
  kind(proposal.kind);
  requiredText(proposal.key, "memory proposal key");
  requiredText(proposal.proposed_by, "memory proposer");
  createdAt(proposal.created_at);
  ensureJsonValue(proposal.value, "memory proposal value");
  if (!Array.isArray(proposal.evidence) || proposal.evidence.length === 0) {
    throw new Error("memory proposal requires at least one evidence artifact");
  }
  const evidenceKeys = new Set();
  for (const [index, evidence] of proposal.evidence.entries()) {
    if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) {
      throw new Error(`memory proposal evidence ${index} must be an object`);
    }
    exactKeys(evidence, ["path", "content_id", "bytes"], `memory proposal evidence ${index}`);
    requiredText(evidence?.path, `memory proposal evidence ${index} path`);
    digestFromContentId(evidence?.content_id, `memory proposal evidence ${index} content id`);
    if (!Number.isInteger(evidence?.bytes) || evidence.bytes <= 0) {
      throw new Error(`memory proposal evidence ${index} bytes must be a positive integer`);
    }
    const key = `${evidence.path}\0${evidence.content_id}`;
    if (evidenceKeys.has(key)) throw new Error("memory proposal repeats an evidence artifact");
    evidenceKeys.add(key);
  }
  if (proposal.supersedes !== null) digestFromReceiptId(proposal.supersedes, "memory-proposal");
  if (proposal.source !== null) ensureJsonValue(proposal.source, "memory proposal source");
  if (proposal.kind === "rule") {
    exactKeys(proposal.review_requirements, ["benchmark"], "rule review requirements");
    exactKeys(proposal.review_requirements.benchmark, ["pack_id"], "rule benchmark requirement");
    requiredText(proposal.review_requirements?.benchmark?.pack_id, "rule benchmark pack id");
  } else if (proposal.review_requirements !== null) {
    throw new Error("only behavioral rules may carry benchmark review requirements");
  }
  if (receiptId("memory-proposal", proposalBody(proposal)) !== proposal.proposal_id) {
    throw new Error("memory proposal id does not match its canonical contents");
  }
  return proposal;
}

export function validateDecision(decision) {
  if (!decision || typeof decision !== "object" || Array.isArray(decision)) {
    throw new Error("memory decision must be an object");
  }
  if (decision.schema !== MEMORY_SCHEMAS.decision) throw new Error("memory decision schema is not registered");
  exactKeys(
    decision,
    [
      "decision_id",
      "schema",
      "proposal_id",
      "proposal_content_id",
      "action",
      "decided_by",
      "reason",
      "created_at",
      "benchmark_receipt",
    ],
    "memory decision",
  );
  digestFromReceiptId(decision.decision_id, "memory-decision");
  digestFromReceiptId(decision.proposal_id, "memory-proposal");
  digestFromContentId(decision.proposal_content_id, "decision proposal content id");
  action(decision.action);
  requiredText(decision.decided_by, "memory decider");
  requiredText(decision.reason, "memory decision reason");
  createdAt(decision.created_at);
  if (decision.benchmark_receipt !== null) {
    // One scored report used to satisfy this gate on its own, which made the first scored
    // report a skeleton key: it could accept unlimited unrelated rules, each technically
    // "receipt-backed". Acceptance now requires an ABLATION PAIR — two scored reports on the
    // identical frozen pack whose subject configs provably differ by exactly the proposed rule
    // — with the measured delta recorded here, where a reviewer and a rollback can see it.
    const bench = decision.benchmark_receipt;
    exactKeys(
      bench,
      ["pack_id", "rule_content_id", "with_rule", "without_rule", "delta"],
      "benchmark receipt",
    );
    requiredText(bench.pack_id, "benchmark receipt pack id");
    digestFromContentId(bench.rule_content_id, "benchmark receipt rule content id");
    for (const side of ["with_rule", "without_rule"]) {
      exactKeys(bench[side], ["path", "content_id", "bytes", "generated_at"], `benchmark receipt ${side}`);
      requiredText(bench[side].path, `benchmark receipt ${side} path`);
      digestFromContentId(bench[side].content_id, `benchmark receipt ${side} content id`);
      if (!Number.isInteger(bench[side].bytes) || bench[side].bytes <= 0) {
        throw new Error(`benchmark receipt ${side} bytes are invalid`);
      }
      requiredText(bench[side].generated_at, `benchmark receipt ${side} generated_at`);
    }
    if (bench.with_rule.content_id === bench.without_rule.content_id) {
      throw new Error("benchmark receipt ablation reports must be distinct; one report cannot be its own control");
    }
    exactKeys(bench.delta, ["critical_meaning_rate", "catastrophic_count"], "benchmark receipt delta");
    if (typeof bench.delta.critical_meaning_rate !== "number" || !Number.isFinite(bench.delta.critical_meaning_rate)) {
      throw new Error("benchmark receipt delta meaning rate must be a finite number");
    }
    if (!Number.isInteger(bench.delta.catastrophic_count)) {
      throw new Error("benchmark receipt delta catastrophic count must be an integer");
    }
  }
  if (receiptId("memory-decision", decisionBody(decision)) !== decision.decision_id) {
    throw new Error("memory decision id does not match its canonical contents");
  }
  return decision;
}

export function validateRunProposalManifest(manifest, { runId = null, clipId = null, proposals = null } = {}) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    throw new Error("run proposal manifest must be an object");
  }
  exactKeys(
    manifest,
    ["manifest_id", "schema", "run", "clip", "status", "proposals"],
    "run proposal manifest",
  );
  if (manifest.schema !== MEMORY_SCHEMAS.runProposalManifest || manifest.status !== "pending_review") {
    throw new Error("run proposal manifest schema or status is not registered");
  }
  requiredText(manifest.run, "run proposal manifest run");
  requiredText(manifest.clip, "run proposal manifest clip");
  if (runId !== null && manifest.run !== runId) throw new Error("run proposal manifest run identity changed");
  if (clipId !== null && manifest.clip !== clipId) throw new Error("run proposal manifest clip identity changed");
  if (!Array.isArray(manifest.proposals)) throw new Error("run proposal manifest proposals must be an array");
  const ledger = proposals === null
    ? null
    : new Map(proposals.map((proposal) => [proposal.proposal_id, validateProposal(proposal)]));
  const ids = new Set();
  for (const [index, item] of manifest.proposals.entries()) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error(`run proposal manifest item ${index} must be an object`);
    }
    exactKeys(
      item,
      ["proposal_id", "proposal_content_id", "namespace", "kind", "key", "status"],
      `run proposal manifest item ${index}`,
    );
    digestFromReceiptId(item.proposal_id, "memory-proposal");
    digestFromContentId(item.proposal_content_id, `run proposal manifest item ${index} content id`);
    namespace(item.namespace);
    kind(item.kind);
    requiredText(item.key, `run proposal manifest item ${index} key`);
    if (item.status !== "pending_review") throw new Error("run proposal manifest item is not pending review");
    if (ids.has(item.proposal_id)) throw new Error("run proposal manifest repeats a proposal id");
    ids.add(item.proposal_id);
    if (ledger !== null) {
      const proposal = ledger.get(item.proposal_id);
      if (
        !proposal ||
        contentIdForJson(proposal) !== item.proposal_content_id ||
        proposal.namespace !== item.namespace ||
        proposal.kind !== item.kind ||
        proposal.key !== item.key
      ) {
        throw new Error(`run proposal manifest item ${index} does not match its immutable proposal`);
      }
    }
  }
  const { manifest_id: _manifestId, ...body } = manifest;
  if (receiptId("memory-proposal-manifest", body) !== manifest.manifest_id) {
    throw new Error("run proposal manifest id does not match its canonical contents");
  }
  return manifest;
}

async function loadProposalFile(path, workspaceRoot, verifyEvidence = true) {
  const proposal = validateProposal(await readJson(path, `memory proposal ${path}`));
  if (verifyEvidence) {
    for (const [index, evidence] of proposal.evidence.entries()) {
      await verifyFileReceipt(evidence, workspaceRoot, `proposal ${proposal.proposal_id} evidence ${index}`);
    }
  }
  return proposal;
}

async function loadDecisionFile(path, workspaceRoot, verifyEvidence) {
  const decision = validateDecision(await readJson(path, `memory decision ${path}`));
  if (verifyEvidence && decision.benchmark_receipt !== null) {
    for (const side of ["with_rule", "without_rule"]) {
      await verifyFileReceipt(
        decision.benchmark_receipt[side],
        workspaceRoot,
        `decision ${decision.decision_id} benchmark ${side} receipt`,
      );
    }
  }
  return decision;
}

export async function loadLedger({ store, workspaceRoot = process.cwd(), verifyEvidence = true }) {
  const proposals = await Promise.all(
    (await jsonFiles(join(store, "proposals"))).map((path) => loadProposalFile(path, workspaceRoot, verifyEvidence)),
  );
  const decisions = await Promise.all(
    (await jsonFiles(join(store, "decisions"))).map((path) =>
      loadDecisionFile(path, workspaceRoot, verifyEvidence),
    ),
  );
  const byProposal = new Map(proposals.map((proposal) => [proposal.proposal_id, proposal]));
  if (byProposal.size !== proposals.length) throw new Error("memory ledger repeats a proposal id");

  for (const proposal of proposals) {
    if (proposal.supersedes === null) continue;
    const prior = byProposal.get(proposal.supersedes);
    if (!prior) throw new Error(`proposal ${proposal.proposal_id} supersedes an unknown proposal`);
    if (
      prior.namespace !== proposal.namespace ||
      prior.kind !== proposal.kind ||
      prior.key !== proposal.key
    ) {
      throw new Error(`proposal ${proposal.proposal_id} changes the semantic key it supersedes`);
    }
    const seen = new Set([proposal.proposal_id]);
    let cursor = prior;
    while (cursor) {
      if (seen.has(cursor.proposal_id)) throw new Error("memory proposal supersession contains a cycle");
      seen.add(cursor.proposal_id);
      cursor = cursor.supersedes ? byProposal.get(cursor.supersedes) : null;
    }
  }

  const decisionIds = new Set();
  for (const decision of decisions) {
    if (decisionIds.has(decision.decision_id)) throw new Error("memory ledger repeats a decision id");
    decisionIds.add(decision.decision_id);
    const proposal = byProposal.get(decision.proposal_id);
    if (!proposal) throw new Error(`decision ${decision.decision_id} references an unknown proposal`);
    if (decision.proposal_content_id !== contentIdForJson(proposal)) {
      throw new Error(`decision ${decision.decision_id} does not bind the current proposal bytes`);
    }
    if (decision.decided_by === proposal.proposed_by) {
      throw new Error(`proposal ${proposal.proposal_id} was reviewed by its proposer`);
    }
    if (decision.action === "accept" && proposal.kind === "rule") {
      if (decision.benchmark_receipt === null) {
        throw new Error(`accepted rule ${proposal.proposal_id} has no scored benchmark receipt`);
      }
      if (decision.benchmark_receipt.pack_id !== proposal.review_requirements.benchmark.pack_id) {
        throw new Error(`accepted rule ${proposal.proposal_id} carries the wrong benchmark pack`);
      }
      if (decision.benchmark_receipt.rule_content_id !== contentIdForJson(proposal.value)) {
        throw new Error(
          `accepted rule ${proposal.proposal_id} benchmark receipt was measured for a different rule value`,
        );
      }
      if (verifyEvidence) {
        const verified = await ablationBenchReceipts({
          withPath: decision.benchmark_receipt.with_rule.path,
          withoutPath: decision.benchmark_receipt.without_rule.path,
          packId: proposal.review_requirements.benchmark.pack_id,
          ruleContentId: decision.benchmark_receipt.rule_content_id,
          workspaceRoot,
        });
        for (const side of ["with_rule", "without_rule"]) {
          if (
            verified[side].content_id !== decision.benchmark_receipt[side].content_id ||
            verified[side].bytes !== decision.benchmark_receipt[side].bytes
          ) {
            throw new Error(`accepted rule ${proposal.proposal_id} benchmark receipt changed`);
          }
        }
        if (
          Math.abs(verified.delta.critical_meaning_rate - decision.benchmark_receipt.delta.critical_meaning_rate) >= 1e-9 ||
          verified.delta.catastrophic_count !== decision.benchmark_receipt.delta.catastrophic_count
        ) {
          throw new Error(`accepted rule ${proposal.proposal_id} records a delta its reports do not support`);
        }
      }
    } else if (decision.benchmark_receipt !== null) {
      throw new Error(`decision ${decision.decision_id} carries an unauthorized benchmark receipt`);
    }
  }

  return { proposals, decisions };
}

function semanticKey(proposal) {
  return JSON.stringify([proposal.namespace, proposal.kind, proposal.key]);
}

export function evaluateLedger({ proposals, decisions }) {
  const decisionsByProposal = new Map();
  for (const decision of decisions) {
    const list = decisionsByProposal.get(decision.proposal_id) ?? [];
    list.push(decision);
    decisionsByProposal.set(decision.proposal_id, list);
  }

  const states = new Map();
  for (const proposal of proposals) {
    const list = decisionsByProposal.get(proposal.proposal_id) ?? [];
    const primary = list.filter((decision) => decision.action === "accept" || decision.action === "reject");
    const revocations = list.filter((decision) => decision.action === "revoke");
    if (primary.length > 1) throw new Error(`proposal ${proposal.proposal_id} has multiple primary decisions`);
    if (revocations.length > 1) throw new Error(`proposal ${proposal.proposal_id} was revoked more than once`);
    if (revocations.length > 0 && (primary.length !== 1 || primary[0].action !== "accept")) {
      throw new Error(`proposal ${proposal.proposal_id} was revoked without an acceptance`);
    }
    if (revocations.length > 0 && Date.parse(revocations[0].created_at) <= Date.parse(primary[0].created_at)) {
      throw new Error(`proposal ${proposal.proposal_id} was revoked before it was accepted`);
    }
    const status =
      primary.length === 0
        ? "pending"
        : primary[0].action === "reject"
          ? "rejected"
          : revocations.length > 0
            ? "revoked"
            : "accepted";
    states.set(proposal.proposal_id, {
      status,
      primary: primary[0] ?? null,
      revocation: revocations[0] ?? null,
      superseded_by: null,
    });
  }

  for (const proposal of proposals) {
    if (!proposal.supersedes || states.get(proposal.proposal_id)?.status !== "accepted") continue;
    const prior = states.get(proposal.supersedes);
    if (prior?.status === "accepted") prior.superseded_by = proposal.proposal_id;
  }

  const heads = new Map();
  for (const proposal of proposals) {
    const state = states.get(proposal.proposal_id);
    if (state.status !== "accepted" || state.superseded_by !== null) continue;
    const key = semanticKey(proposal);
    if (heads.has(key)) throw new Error(`memory key ${proposal.key} has multiple accepted heads`);
    heads.set(key, proposal);
  }
  return { states, heads };
}

/** Return the one accepted head for an exact semantic key, if review has produced one. */
export function acceptedHead(ledger, { namespace: namespaceValue, kind: kindValue, key }) {
  return evaluateLedger(ledger).heads.get(
    JSON.stringify([
      namespace(namespaceValue),
      kind(kindValue),
      requiredText(key, "memory proposal key"),
    ]),
  ) ?? null;
}

export async function recordProposal({
  store,
  namespace: namespaceValue,
  kind: kindValue,
  key,
  value,
  proposedBy,
  evidencePaths,
  supersedes = null,
  source = null,
  benchmarkPackId = null,
  createdAt: at,
  workspaceRoot = process.cwd(),
}) {
  if (!Array.isArray(evidencePaths) || evidencePaths.length === 0) {
    throw new Error("a memory proposal cannot be recorded without evidence files");
  }
  const evidence = [];
  for (const path of evidencePaths) {
    const recorded = requiredText(path, "evidence path");
    evidence.push(await fileReceipt(resolveFile(recorded, workspaceRoot), recorded));
  }
  const body = {
    schema: MEMORY_SCHEMAS.proposal,
    namespace: namespace(namespaceValue),
    kind: kind(kindValue),
    key: requiredText(key, "memory proposal key"),
    value: ensureJsonValue(value, "memory proposal value"),
    proposed_by: requiredText(proposedBy, "memory proposer"),
    created_at: createdAt(at),
    source: source === null ? null : ensureJsonValue(source, "memory proposal source"),
    evidence,
    supersedes,
    review_requirements:
      kindValue === "rule"
        ? { benchmark: { pack_id: requiredText(benchmarkPackId, "rule benchmark pack id") } }
        : null,
  };
  const proposal = validateProposal({ proposal_id: receiptId("memory-proposal", body), ...body });
  const current = await loadLedger({ store, workspaceRoot });
  if (proposal.supersedes !== null) {
    const prior = current.proposals.find((candidate) => candidate.proposal_id === proposal.supersedes);
    if (!prior) throw new Error("a replacement proposal must name an existing proposal");
    if (semanticKey(prior) !== semanticKey(proposal)) {
      throw new Error("a replacement proposal must preserve namespace, kind, and key");
    }
  }
  const path = recordPath(store, "proposals", proposal.proposal_id, "memory-proposal");
  await writeImmutableJson(path, proposal);
  return { proposal, path };
}

let benchValidatorPromise;

async function scoredBenchReceipt(path, expectedPackId, workspaceRoot) {
  const recordedPath = requiredText(path, "benchmark report path");
  const absolute = resolveFile(recordedPath, workspaceRoot);
  const report = await readJson(absolute, `benchmark report ${recordedPath}`);
  if (!benchValidatorPromise) {
    benchValidatorPromise = (async () => {
      const schema = await readJson(new URL("../../bench/schemas/report.schema.json", import.meta.url));
      const ajv = new Ajv2020({ allErrors: true, strict: true });
      ajv.addFormat("date", /^\d{4}-\d{2}-\d{2}$/);
      ajv.addFormat("date-time", /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/);
      return ajv.compile(schema);
    })();
  }
  const validate = await benchValidatorPromise;
  if (!validate(report)) throw new Error(`benchmark report does not satisfy its schema: ${validate.errors?.[0]?.message}`);
  if (report.status !== "scored" || report.pack_id !== expectedPackId || report.pack?.frozen !== true) {
    throw new Error(`behavioral rule requires scored frozen benchmark pack ${expectedPackId}`);
  }
  if (!report.pack.clips.every((clip) => clip.status === "frozen" && Object.values(clip.annotations).every(Boolean))) {
    throw new Error("behavioral rule benchmark is not fully frozen and reviewed");
  }
  if (!report.systems.every((system) => system.status === "scored") || !report.results.every((result) => result.status === "scored")) {
    throw new Error("behavioral rule benchmark has incomplete systems or results");
  }
  for (const result of report.results) {
    const meaning = result.headline.critical_meaning;
    const outcomes = result.headline.critical_outcomes;
    const catastrophic = result.headline.catastrophic;
    const latency = result.headline.latency;
    if (
      [meaning.passes, meaning.total, meaning.rate].some((value) => value === null) ||
      [outcomes.correct, outcomes.wrong, outcomes.withheld, outcomes.missing, outcomes.total].some(
        (value) => value === null,
      ) ||
      [catastrophic.count, catastrophic.denominator, latency.first_usable_s, latency.complete_s].some(
        (value) => value === null,
      ) ||
      !Object.values(result.artifacts).every((value) => typeof value === "string" && value.length > 0)
    ) {
      throw new Error("behavioral rule benchmark lacks scored outcomes or evidence artifacts");
    }
  }

  // A "scored" report is only as real as the conveyor artifacts beneath it, so every number in
  // it is bound to bytes another check re-derives: the pack's actual freeze receipt must exist
  // and predate the report, and each result must link the immutable bench/scores/ receipt whose
  // headline it repeats. A hand-authored scored report — the obvious way to counterfeit an
  // ablation pair — dies here.
  if (report.systems.filter((system) => system.role === "subject").length !== 1) {
    throw new Error("behavioral rule benchmark must contain exactly one subject system");
  }
  const packDir = resolveFile(join("bench/packs", report.pack_id), workspaceRoot);
  const pack = validatePack(await readJson(join(packDir, "pack.json"), `benchmark pack ${report.pack_id}`));
  if (pack.pack_id !== report.pack_id || !pack.frozen || pack.freeze_receipt === null) {
    throw new Error(`behavioral rule benchmark pack ${report.pack_id} is not frozen on disk`);
  }
  const freezePath = join(packDir, pack.freeze_receipt);
  const freeze = validateFreezeReceipt(await readJson(freezePath, `freeze receipt ${report.pack_id}`));
  if (freeze.pack_id !== report.pack_id) throw new Error("benchmark pack freeze receipt names a different pack");
  if (Date.parse(report.generated_at) < Date.parse(freeze.frozen_at)) {
    throw new Error("behavioral rule benchmark report predates its pack freeze");
  }
  const freezeFile = await fileReceipt(freezePath, pack.freeze_receipt);
  const frozenClipIds = new Set(freeze.clips.map((clip) => clip.clip_id));
  const rateEqual = (left, right) =>
    (left === null) === (right === null) && (left === null || Math.abs(left - right) < 1e-9);
  for (const result of report.results) {
    const expectedScore = `bench/scores/${result.run_id}/score.json`;
    if (result.artifacts.score !== expectedScore) {
      throw new Error(`benchmark result ${result.system_id} must link its score receipt at ${expectedScore}`);
    }
    const scoreReceipt = validateScoreReceipt(
      await readJson(resolveFile(expectedScore, workspaceRoot), `score receipt ${expectedScore}`),
    );
    if (scoreReceipt.pack_id !== report.pack_id || scoreReceipt.run !== result.run_id) {
      throw new Error(`score receipt ${expectedScore} names a different pack or run`);
    }
    if (!frozenClipIds.has(scoreReceipt.clip_id)) {
      throw new Error(`score receipt ${expectedScore} scores a clip the pack freeze does not contain`);
    }
    if (scoreReceipt.preregistration.frozen_at !== freeze.frozen_at) {
      throw new Error(`score receipt ${expectedScore} was scored against a different freeze`);
    }
    if (
      scoreReceipt.bindings.freeze.content_id !== freezeFile.content_id ||
      scoreReceipt.bindings.freeze.bytes !== freezeFile.bytes
    ) {
      throw new Error(`score receipt ${expectedScore} does not bind the pack's actual freeze receipt bytes`);
    }
    const scored = scoreReceipt.systems[result.system_id];
    if (!scored) throw new Error(`score receipt ${expectedScore} does not score system ${result.system_id}`);
    const h = scored.headline;
    const r = result.headline;
    const matches =
      h.critical_meaning.passes === r.critical_meaning.passes &&
      h.critical_meaning.total === r.critical_meaning.total &&
      rateEqual(h.critical_meaning.rate, r.critical_meaning.rate) &&
      h.critical_outcomes.correct === r.critical_outcomes.correct &&
      h.critical_outcomes.wrong === r.critical_outcomes.wrong &&
      h.critical_outcomes.withheld === r.critical_outcomes.withheld &&
      h.critical_outcomes.missing === r.critical_outcomes.missing &&
      h.critical_outcomes.total === r.critical_outcomes.total &&
      h.catastrophic.count === r.catastrophic.count &&
      h.catastrophic.denominator === r.catastrophic.denominator &&
      rateEqual(h.catastrophic.rate, r.catastrophic.rate) &&
      h.latency.first_usable_s === r.latency.first_usable_s &&
      h.latency.complete_s === r.latency.complete_s;
    if (!matches) {
      throw new Error(
        `benchmark result ${result.system_id} headline does not match its score receipt ${expectedScore}`,
      );
    }
  }

  const receipt = await fileReceipt(absolute, recordedPath);
  return {
    receipt: {
      path: receipt.path,
      content_id: receipt.content_id,
      bytes: receipt.bytes,
      generated_at: report.generated_at,
    },
    report,
  };
}

function subjectResult(report, context) {
  const subjects = report.systems.filter((system) => system.role === "subject");
  if (subjects.length !== 1) throw new Error(`${context} must contain exactly one subject system`);
  const result = report.results.find((candidate) => candidate.system_id === subjects[0].id);
  if (!result) throw new Error(`${context} subject system has no result`);
  return { system: subjects[0], result };
}

function configRules(result, context) {
  const rules = result.config?.rules;
  if (!Array.isArray(rules) || rules.some((rule) => typeof rule !== "string" || !rule.trim())) {
    throw new Error(
      `${context} subject config must carry a rules array of content ids; a config that does not declare its rules cannot prove an ablation`,
    );
  }
  const set = new Set(rules);
  if (set.size !== rules.length) throw new Error(`${context} subject config repeats a rule`);
  return set;
}

/**
 * The ablation pair a rule acceptance must present: two scored reports on the identical frozen
 * pack whose subject configs are the same rule set except for exactly the proposed rule, so the
 * recorded delta is attributable to that rule and nothing else the configs admit to. One scored
 * report can no longer accept anything.
 */
async function ablationBenchReceipts({ withPath, withoutPath, packId, ruleContentId, workspaceRoot }) {
  digestFromContentId(ruleContentId, "ablation rule content id");
  const withRule = await scoredBenchReceipt(withPath, packId, workspaceRoot);
  const withoutRule = await scoredBenchReceipt(withoutPath, packId, workspaceRoot);

  if (withRule.receipt.content_id === withoutRule.receipt.content_id) {
    throw new Error("rule ablation requires two distinct scored reports; one report cannot be its own control");
  }
  if (contentIdForJson(withRule.report.pack) !== contentIdForJson(withoutRule.report.pack)) {
    throw new Error("rule ablation reports were scored against different pack contents; the comparison proves nothing");
  }

  const withSubject = subjectResult(withRule.report, "with-rule benchmark");
  const withoutSubject = subjectResult(withoutRule.report, "without-rule benchmark");
  if (withSubject.system.id !== withoutSubject.system.id) {
    throw new Error("rule ablation reports score different subject systems");
  }

  const withRules = configRules(withSubject.result, "with-rule benchmark");
  const withoutRules = configRules(withoutSubject.result, "without-rule benchmark");
  if (!withRules.has(ruleContentId)) {
    throw new Error("with-rule benchmark subject config does not include the proposed rule");
  }
  if (withoutRules.has(ruleContentId)) {
    throw new Error("without-rule benchmark subject config includes the proposed rule; it is not a control");
  }
  if (withRules.size !== withoutRules.size + 1 || ![...withoutRules].every((rule) => withRules.has(rule))) {
    throw new Error("rule ablation configs differ by more than the proposed rule");
  }
  const stripped = (result) => {
    const { rules: _rules, ...rest } = result.config;
    return rest;
  };
  if (contentIdForJson(stripped(withSubject.result)) !== contentIdForJson(stripped(withoutSubject.result))) {
    throw new Error("rule ablation subject configs differ beyond their rules; the delta is not attributable to the rule");
  }

  const withHeadline = withSubject.result.headline;
  const withoutHeadline = withoutSubject.result.headline;
  return {
    pack_id: packId,
    rule_content_id: ruleContentId,
    with_rule: withRule.receipt,
    without_rule: withoutRule.receipt,
    delta: {
      critical_meaning_rate: withHeadline.critical_meaning.rate - withoutHeadline.critical_meaning.rate,
      catastrophic_count: withHeadline.catastrophic.count - withoutHeadline.catastrophic.count,
    },
  };
}

export async function recordDecision({
  store,
  proposalId,
  action: actionValue,
  decidedBy,
  reason,
  benchReports = null,
  createdAt: at,
  workspaceRoot = process.cwd(),
}) {
  const ledger = await loadLedger({ store, workspaceRoot });
  const proposal = ledger.proposals.find((candidate) => candidate.proposal_id === proposalId);
  if (!proposal) throw new Error(`memory proposal ${proposalId} does not exist`);
  const nextAction = action(actionValue);
  const actor = requiredText(decidedBy, "memory decider");
  if (actor === proposal.proposed_by) throw new Error("a memory proposer cannot decide its own proposal");
  const explanation = requiredText(reason, "memory decision reason");
  const evaluated = evaluateLedger(ledger);
  const state = evaluated.states.get(proposal.proposal_id);

  if (nextAction === "revoke") {
    if (state.status !== "accepted") throw new Error("only an accepted, non-revoked proposal can be revoked");
    if (benchReports !== null) throw new Error("revocation does not accept a benchmark receipt");
  } else if (state.status !== "pending") {
    throw new Error(`proposal ${proposal.proposal_id} already has a primary decision`);
  }

  if (nextAction === "accept" && proposal.supersedes !== null) {
    const prior = evaluated.states.get(proposal.supersedes);
    if (prior?.status !== "accepted" || prior.superseded_by !== null) {
      throw new Error("a replacement may only supersede the currently accepted head");
    }
  }
  if (nextAction === "accept" && proposal.supersedes === null) {
    const currentHead = evaluated.heads.get(semanticKey(proposal));
    if (currentHead) throw new Error("an accepted memory key must be replaced through explicit supersession");
  }

  let benchmarkReceipt = null;
  if (nextAction === "accept" && proposal.kind === "rule") {
    if (benchReports === null) {
      throw new Error("behavioral rule acceptance requires a scored benchmark ablation pair");
    }
    if (
      typeof benchReports !== "object" ||
      Array.isArray(benchReports) ||
      !benchReports.withRule ||
      !benchReports.withoutRule
    ) {
      throw new Error(
        "behavioral rule acceptance requires both ablation reports: one scored with the rule and one scored without it; a single report is a skeleton key and no longer opens this gate",
      );
    }
    benchmarkReceipt = await ablationBenchReceipts({
      withPath: benchReports.withRule,
      withoutPath: benchReports.withoutRule,
      packId: proposal.review_requirements.benchmark.pack_id,
      ruleContentId: contentIdForJson(proposal.value),
      workspaceRoot,
    });
  } else if (benchReports !== null) {
    throw new Error("benchmark receipts are only valid when accepting a behavioral rule");
  }

  const body = {
    schema: MEMORY_SCHEMAS.decision,
    proposal_id: proposal.proposal_id,
    proposal_content_id: contentIdForJson(proposal),
    action: nextAction,
    decided_by: actor,
    reason: explanation,
    created_at: createdAt(at),
    benchmark_receipt: benchmarkReceipt,
  };
  const decision = validateDecision({ decision_id: receiptId("memory-decision", body), ...body });
  const path = recordPath(store, "decisions", decision.decision_id, "memory-decision");
  await writeImmutableJson(path, decision);
  return { decision, path };
}

export async function recordLegacySnapshot({
  store,
  sourcePath,
  namespace: namespaceValue,
  createdAt: at,
  workspaceRoot = process.cwd(),
}) {
  const recordedPath = requiredText(sourcePath, "legacy memory path");
  const absolute = resolveFile(recordedPath, workspaceRoot);
  const source = await fileReceipt(absolute, recordedPath);
  const payload = await readJson(absolute, `legacy memory ${recordedPath}`);
  const entryCount = Array.isArray(payload.entries) ? payload.entries.length : null;
  const identity = {
    namespace: namespace(namespaceValue),
    status: "legacy_unreviewed",
    source_content_id: source.content_id,
  };
  const snapshotId = receiptId("memory-legacy", identity);
  const path = recordPath(store, "legacy", snapshotId, "memory-legacy");
  let existing = null;
  try {
    existing = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error?.code !== "ENOENT") throw new Error(`legacy snapshot ${path} is not readable JSON`, { cause: error });
  }
  if (existing !== null) {
    if (
      existing.schema !== MEMORY_SCHEMAS.legacy ||
      existing.snapshot_id !== snapshotId ||
      existing.namespace !== identity.namespace ||
      existing.status !== identity.status ||
      existing.source?.content_id !== source.content_id ||
      existing.source?.bytes !== source.bytes ||
      existing.source?.path !== source.path
    ) {
      throw new Error(`legacy snapshot ${path} conflicts with the immutable source receipt`);
    }
    createdAt(existing.created_at);
    return { snapshot: existing, path };
  }
  const snapshot = {
    schema: MEMORY_SCHEMAS.legacy,
    snapshot_id: snapshotId,
    namespace: identity.namespace,
    status: identity.status,
    created_at: createdAt(at),
    source,
    entry_count: entryCount,
    note: "Imported only as legacy, unreviewed input. No entry is accepted or promoted by this receipt.",
  };
  await writeImmutableJson(path, snapshot);
  return { snapshot, path };
}

async function loadLegacy(store, workspaceRoot) {
  const snapshots = [];
  for (const path of await jsonFiles(join(store, "legacy"))) {
    const snapshot = await readJson(path, `legacy memory snapshot ${path}`);
    if (snapshot?.schema !== MEMORY_SCHEMAS.legacy || snapshot.status !== "legacy_unreviewed") {
      throw new Error(`legacy memory snapshot ${path} has an invalid schema or status`);
    }
    exactKeys(
      snapshot,
      ["schema", "snapshot_id", "namespace", "status", "created_at", "source", "entry_count", "note"],
      "legacy memory snapshot",
    );
    exactKeys(snapshot.source, ["path", "content_id", "bytes"], "legacy memory source");
    digestFromReceiptId(snapshot.snapshot_id, "memory-legacy");
    namespace(snapshot.namespace);
    createdAt(snapshot.created_at);
    await verifyFileReceipt(snapshot.source, workspaceRoot, `legacy snapshot ${snapshot.snapshot_id} source`);
    const expected = receiptId("memory-legacy", {
      namespace: snapshot.namespace,
      status: snapshot.status,
      source_content_id: snapshot.source.content_id,
    });
    if (snapshot.snapshot_id !== expected) throw new Error("legacy snapshot id does not match its source");
    snapshots.push(snapshot);
  }
  return snapshots;
}

export async function materializeMemory({
  store,
  createdAt: at,
  workspaceRoot = process.cwd(),
}) {
  const ledger = await loadLedger({ store, workspaceRoot });
  const legacy = await loadLegacy(store, workspaceRoot);
  const evaluated = evaluateLedger(ledger);
  const entries = [...evaluated.heads.values()]
    .sort((left, right) => semanticKey(left).localeCompare(semanticKey(right)))
    .map((proposal) => {
      const state = evaluated.states.get(proposal.proposal_id);
      return {
        namespace: proposal.namespace,
        kind: proposal.kind,
        key: proposal.key,
        value: proposal.value,
        proposal_id: proposal.proposal_id,
        proposal_content_id: contentIdForJson(proposal),
        decision_id: state.primary.decision_id,
        evidence: proposal.evidence,
      };
    });
  const body = {
    schema: MEMORY_SCHEMAS.materialization,
    created_at: createdAt(at),
    entries,
    proposal_receipts: ledger.proposals.map((proposal) => ({
      id: proposal.proposal_id,
      content_id: contentIdForJson(proposal),
      status: evaluated.states.get(proposal.proposal_id).status,
      superseded_by: evaluated.states.get(proposal.proposal_id).superseded_by,
    })),
    decision_receipts: ledger.decisions.map((decision) => ({
      id: decision.decision_id,
      content_id: contentIdForJson(decision),
    })),
    legacy_inputs: legacy.map((snapshot) => ({
      snapshot_id: snapshot.snapshot_id,
      namespace: snapshot.namespace,
      status: snapshot.status,
      source: snapshot.source,
    })),
  };
  const materialization = {
    materialization_id: receiptId("memory-materialization", body),
    ...body,
  };
  const path = recordPath(
    store,
    "materializations",
    materialization.materialization_id,
    "memory-materialization",
  );
  await writeImmutableJson(path, materialization);
  return { materialization, path };
}
