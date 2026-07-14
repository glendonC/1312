import {
  MEMORY_REVIEW_SCHEMAS,
  type ConsumeMemoryRequest,
  type ConsumedMemorySnapshot,
  type MemoryBenchmarkReceipt,
  type MemoryConsumptionReceipt,
  type MemoryDecision,
  type MemoryDecisionAction,
  type MemoryFileReceipt,
  type MemoryKind,
  type MemoryLegacySnapshot,
  type MemoryMaterialization,
  type MemoryMaterializationEntry,
  type MemoryProposal,
  type MemoryReviewArtifact,
  type MemoryReviewInspection,
  type MemoryReviewTransition,
} from "./model.ts";

const MEMORY_KINDS = new Set<MemoryKind>(["glossary", "correction", "rule"]);
const DECISION_ACTIONS = new Set<MemoryDecisionAction>(["accept", "reject", "revoke"]);

function fail(path: string, message: string): never {
  throw new Error(`memory inspection: ${path} ${message}`);
}

function object(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail(path, "must be an object");
  }
  return value as Record<string, unknown>;
}

function exact(item: Record<string, unknown>, keys: readonly string[], path: string): void {
  const allowed = new Set(keys);
  for (const key of Object.keys(item)) {
    if (!allowed.has(key)) fail(`${path}.${key}`, "is not allowed");
  }
  for (const key of keys) {
    if (!(key in item)) fail(`${path}.${key}`, "is required");
  }
}

function text(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    fail(path, "must be a non-empty string");
  }
  return value;
}

function literal<T extends string>(value: unknown, expected: T, path: string): T {
  if (value !== expected) fail(path, `must equal ${expected}`);
  return expected;
}

function nullable<T>(value: unknown, parse: (candidate: unknown) => T): T | null {
  return value === null ? null : parse(value);
}

function integer(value: unknown, path: string, minimum = 0): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) {
    fail(path, `must be a safe integer at least ${minimum}`);
  }
  return value as number;
}

function signedInteger(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value)) fail(path, "must be a safe integer");
  return value as number;
}

function finiteNumber(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) fail(path, "must be a finite number");
  return value;
}

function contentId(value: unknown, path: string): string {
  const id = text(value, path);
  if (!/^sha256:[a-f0-9]{64}$/.test(id)) fail(path, "must be a lowercase SHA-256 content id");
  return id;
}

function receiptId(value: unknown, prefix: string, path: string): string {
  const id = text(value, path);
  if (!id.startsWith(`${prefix}:`)) fail(path, `must be a ${prefix} receipt id`);
  contentId(id.slice(prefix.length + 1), path);
  return id;
}

function isoTimestamp(value: unknown, path: string): string {
  const timestamp = text(value, path);
  const parsed = new Date(timestamp);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== timestamp) {
    fail(path, "must be an exact ISO-8601 UTC timestamp");
  }
  return timestamp;
}

function namespace(value: unknown, path: string): string {
  const result = text(value, path);
  if (!/^[a-z0-9][a-z0-9._/-]*$/.test(result) || result.includes("..") || result.endsWith("/")) {
    fail(path, "must be a lowercase path-like identifier without traversal");
  }
  return result;
}

function memoryKind(value: unknown, path: string): MemoryKind {
  if (!MEMORY_KINDS.has(value as MemoryKind)) fail(path, "is not a registered memory kind");
  return value as MemoryKind;
}

function decisionAction(value: unknown, path: string): MemoryDecisionAction {
  if (!DECISION_ACTIONS.has(value as MemoryDecisionAction)) fail(path, "is not a registered decision action");
  return value as MemoryDecisionAction;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail("canonical content", "contains a non-finite number");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    const item = value as Record<string, unknown>;
    return `{${Object.keys(item)
      .sort((left, right) => left.localeCompare(right))
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(item[key])}`)
      .join(",")}}`;
  }
  fail("canonical content", `contains unsupported ${typeof value}`);
}

export async function memoryContentId(value: unknown): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) fail("content identity", "requires Web Crypto SHA-256 support");
  const digest = await subtle.digest("SHA-256", new TextEncoder().encode(canonicalJson(value)));
  const hex = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `sha256:${hex}`;
}

function fileReceipt(value: unknown, path: string, generatedAt = false): MemoryFileReceipt & { generated_at?: string } {
  const item = object(value, path);
  exact(item, generatedAt ? ["path", "content_id", "bytes", "generated_at"] : ["path", "content_id", "bytes"], path);
  const receipt: MemoryFileReceipt & { generated_at?: string } = {
    path: text(item.path, `${path}.path`),
    content_id: contentId(item.content_id, `${path}.content_id`),
    bytes: integer(item.bytes, `${path}.bytes`, 1),
  };
  if (generatedAt) receipt.generated_at = text(item.generated_at, `${path}.generated_at`);
  return receipt;
}

function benchmarkReceipt(value: unknown, path: string): MemoryBenchmarkReceipt {
  const item = object(value, path);
  exact(item, ["pack_id", "rule_content_id", "with_rule", "without_rule", "delta"], path);
  const withRule = fileReceipt(item.with_rule, `${path}.with_rule`, true);
  const withoutRule = fileReceipt(item.without_rule, `${path}.without_rule`, true);
  if (withRule.content_id === withoutRule.content_id) {
    fail(path, "must record distinct with-rule and without-rule ablation reports");
  }
  const delta = object(item.delta, `${path}.delta`);
  exact(delta, ["critical_meaning_rate", "catastrophic_count"], `${path}.delta`);
  return {
    pack_id: text(item.pack_id, `${path}.pack_id`),
    rule_content_id: contentId(item.rule_content_id, `${path}.rule_content_id`),
    with_rule: withRule as MemoryBenchmarkReceipt["with_rule"],
    without_rule: withoutRule as MemoryBenchmarkReceipt["without_rule"],
    delta: {
      critical_meaning_rate: finiteNumber(delta.critical_meaning_rate, `${path}.delta.critical_meaning_rate`),
      catastrophic_count: signedInteger(delta.catastrophic_count, `${path}.delta.catastrophic_count`),
    },
  };
}

async function proposal(value: unknown, path: string): Promise<MemoryProposal> {
  const item = object(value, path);
  exact(
    item,
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
    path,
  );
  literal(item.schema, MEMORY_REVIEW_SCHEMAS.proposal, `${path}.schema`);
  if (!Array.isArray(item.evidence) || item.evidence.length === 0) {
    fail(`${path}.evidence`, "must contain at least one evidence receipt");
  }
  canonicalJson(item.value);
  if (item.source !== null) canonicalJson(item.source);
  const kind = memoryKind(item.kind, `${path}.kind`);
  let requirements: MemoryProposal["review_requirements"] = null;
  if (kind === "rule") {
    const review = object(item.review_requirements, `${path}.review_requirements`);
    exact(review, ["benchmark"], `${path}.review_requirements`);
    const benchmark = object(review.benchmark, `${path}.review_requirements.benchmark`);
    exact(benchmark, ["pack_id"], `${path}.review_requirements.benchmark`);
    requirements = { benchmark: { pack_id: text(benchmark.pack_id, `${path}.review_requirements.benchmark.pack_id`) } };
  } else if (item.review_requirements !== null) {
    fail(`${path}.review_requirements`, "must be null outside behavioral rule proposals");
  }
  const parsed: MemoryProposal = {
    proposal_id: receiptId(item.proposal_id, "memory-proposal", `${path}.proposal_id`),
    schema: MEMORY_REVIEW_SCHEMAS.proposal,
    namespace: namespace(item.namespace, `${path}.namespace`),
    kind,
    key: text(item.key, `${path}.key`),
    value: item.value,
    proposed_by: text(item.proposed_by, `${path}.proposed_by`),
    created_at: isoTimestamp(item.created_at, `${path}.created_at`),
    source: item.source,
    evidence: item.evidence.map((receipt, index) => fileReceipt(receipt, `${path}.evidence[${index}]`)),
    supersedes: nullable(item.supersedes, (candidate) => receiptId(candidate, "memory-proposal", `${path}.supersedes`)),
    review_requirements: requirements,
  };
  const { proposal_id: _proposalId, ...body } = parsed;
  if (parsed.proposal_id !== `memory-proposal:${await memoryContentId(body)}`) {
    fail(`${path}.proposal_id`, "does not match the canonical proposal contents");
  }
  return parsed;
}

async function decision(value: unknown, path: string): Promise<MemoryDecision> {
  const item = object(value, path);
  exact(
    item,
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
    path,
  );
  literal(item.schema, MEMORY_REVIEW_SCHEMAS.decision, `${path}.schema`);
  const parsed: MemoryDecision = {
    decision_id: receiptId(item.decision_id, "memory-decision", `${path}.decision_id`),
    schema: MEMORY_REVIEW_SCHEMAS.decision,
    proposal_id: receiptId(item.proposal_id, "memory-proposal", `${path}.proposal_id`),
    proposal_content_id: contentId(item.proposal_content_id, `${path}.proposal_content_id`),
    action: decisionAction(item.action, `${path}.action`),
    decided_by: text(item.decided_by, `${path}.decided_by`),
    reason: text(item.reason, `${path}.reason`),
    created_at: isoTimestamp(item.created_at, `${path}.created_at`),
    benchmark_receipt: nullable(item.benchmark_receipt, (candidate) => benchmarkReceipt(candidate, `${path}.benchmark_receipt`)),
  };
  const { decision_id: _decisionId, ...body } = parsed;
  if (parsed.decision_id !== `memory-decision:${await memoryContentId(body)}`) {
    fail(`${path}.decision_id`, "does not match the canonical decision contents");
  }
  return parsed;
}

async function legacySnapshot(value: unknown, path: string): Promise<MemoryLegacySnapshot> {
  const item = object(value, path);
  exact(item, ["schema", "snapshot_id", "namespace", "status", "created_at", "source", "entry_count", "note"], path);
  const parsed: MemoryLegacySnapshot = {
    schema: literal(item.schema, MEMORY_REVIEW_SCHEMAS.legacy, `${path}.schema`),
    snapshot_id: receiptId(item.snapshot_id, "memory-legacy", `${path}.snapshot_id`),
    namespace: namespace(item.namespace, `${path}.namespace`),
    status: literal(item.status, "legacy_unreviewed", `${path}.status`),
    created_at: isoTimestamp(item.created_at, `${path}.created_at`),
    source: fileReceipt(item.source, `${path}.source`),
    entry_count: item.entry_count === null ? null : integer(item.entry_count, `${path}.entry_count`),
    note: text(item.note, `${path}.note`),
  };
  const identity = {
    namespace: parsed.namespace,
    status: parsed.status,
    source_content_id: parsed.source.content_id,
  };
  if (parsed.snapshot_id !== `memory-legacy:${await memoryContentId(identity)}`) {
    fail(`${path}.snapshot_id`, "does not match the legacy source receipt");
  }
  return parsed;
}

function materializationEntry(value: unknown, path: string): MemoryMaterializationEntry {
  const item = object(value, path);
  exact(
    item,
    ["namespace", "kind", "key", "value", "proposal_id", "proposal_content_id", "decision_id", "evidence"],
    path,
  );
  if (!Array.isArray(item.evidence) || item.evidence.length === 0) fail(`${path}.evidence`, "must not be empty");
  canonicalJson(item.value);
  return {
    namespace: namespace(item.namespace, `${path}.namespace`),
    kind: memoryKind(item.kind, `${path}.kind`),
    key: text(item.key, `${path}.key`),
    value: item.value,
    proposal_id: receiptId(item.proposal_id, "memory-proposal", `${path}.proposal_id`),
    proposal_content_id: contentId(item.proposal_content_id, `${path}.proposal_content_id`),
    decision_id: receiptId(item.decision_id, "memory-decision", `${path}.decision_id`),
    evidence: item.evidence.map((receipt, index) => fileReceipt(receipt, `${path}.evidence[${index}]`)),
  };
}

async function materialization(value: unknown, path: string): Promise<MemoryMaterialization> {
  const item = object(value, path);
  exact(
    item,
    ["materialization_id", "schema", "created_at", "entries", "proposal_receipts", "decision_receipts", "legacy_inputs"],
    path,
  );
  literal(item.schema, MEMORY_REVIEW_SCHEMAS.materialization, `${path}.schema`);
  if (!Array.isArray(item.entries)) fail(`${path}.entries`, "must be an array");
  if (!Array.isArray(item.proposal_receipts)) fail(`${path}.proposal_receipts`, "must be an array");
  if (!Array.isArray(item.decision_receipts)) fail(`${path}.decision_receipts`, "must be an array");
  if (!Array.isArray(item.legacy_inputs)) fail(`${path}.legacy_inputs`, "must be an array");
  const parsed: MemoryMaterialization = {
    materialization_id: receiptId(item.materialization_id, "memory-materialization", `${path}.materialization_id`),
    schema: MEMORY_REVIEW_SCHEMAS.materialization,
    created_at: isoTimestamp(item.created_at, `${path}.created_at`),
    entries: item.entries.map((entry, index) => materializationEntry(entry, `${path}.entries[${index}]`)),
    proposal_receipts: item.proposal_receipts.map((value, index) => {
      const receipt = object(value, `${path}.proposal_receipts[${index}]`);
      exact(receipt, ["id", "content_id", "status", "superseded_by"], `${path}.proposal_receipts[${index}]`);
      const status = receipt.status;
      if (!["pending", "accepted", "rejected", "revoked"].includes(status as string)) {
        fail(`${path}.proposal_receipts[${index}].status`, "is not a recorded ledger status");
      }
      return {
        id: receiptId(receipt.id, "memory-proposal", `${path}.proposal_receipts[${index}].id`),
        content_id: contentId(receipt.content_id, `${path}.proposal_receipts[${index}].content_id`),
        status: status as MemoryMaterialization["proposal_receipts"][number]["status"],
        superseded_by: nullable(receipt.superseded_by, (candidate) =>
          receiptId(candidate, "memory-proposal", `${path}.proposal_receipts[${index}].superseded_by`),
        ),
      };
    }),
    decision_receipts: item.decision_receipts.map((value, index) => {
      const receipt = object(value, `${path}.decision_receipts[${index}]`);
      exact(receipt, ["id", "content_id"], `${path}.decision_receipts[${index}]`);
      return {
        id: receiptId(receipt.id, "memory-decision", `${path}.decision_receipts[${index}].id`),
        content_id: contentId(receipt.content_id, `${path}.decision_receipts[${index}].content_id`),
      };
    }),
    legacy_inputs: item.legacy_inputs.map((value, index) => {
      const input = object(value, `${path}.legacy_inputs[${index}]`);
      exact(input, ["snapshot_id", "namespace", "status", "source"], `${path}.legacy_inputs[${index}]`);
      return {
        snapshot_id: receiptId(input.snapshot_id, "memory-legacy", `${path}.legacy_inputs[${index}].snapshot_id`),
        namespace: namespace(input.namespace, `${path}.legacy_inputs[${index}].namespace`),
        status: literal(input.status, "legacy_unreviewed", `${path}.legacy_inputs[${index}].status`),
        source: fileReceipt(input.source, `${path}.legacy_inputs[${index}].source`),
      };
    }),
  };
  const { materialization_id: _materializationId, ...body } = parsed;
  if (parsed.materialization_id !== `memory-materialization:${await memoryContentId(body)}`) {
    fail(`${path}.materialization_id`, "does not match the canonical accepted snapshot contents");
  }
  return parsed;
}

async function consumption(value: unknown, path: string): Promise<MemoryConsumptionReceipt> {
  const item = object(value, path);
  exact(item, ["consumption_id", "schema", "run_id", "consumed_at", "snapshot", "policy"], path);
  const snapshot = object(item.snapshot, `${path}.snapshot`);
  exact(
    snapshot,
    ["materialization_id", "snapshot_content_id", "materialization_receipt_content_id", "entry_count"],
    `${path}.snapshot`,
  );
  const policy = object(item.policy, `${path}.policy`);
  exact(policy, ["promotion", "legacy_unreviewed", "unavailable"], `${path}.policy`);
  const parsed: MemoryConsumptionReceipt = {
    consumption_id: receiptId(item.consumption_id, "memory-consumption", `${path}.consumption_id`),
    schema: literal(item.schema, MEMORY_REVIEW_SCHEMAS.consumption, `${path}.schema`),
    run_id: text(item.run_id, `${path}.run_id`),
    consumed_at: isoTimestamp(item.consumed_at, `${path}.consumed_at`),
    snapshot: {
      materialization_id: receiptId(snapshot.materialization_id, "memory-materialization", `${path}.snapshot.materialization_id`),
      snapshot_content_id: contentId(snapshot.snapshot_content_id, `${path}.snapshot.snapshot_content_id`),
      materialization_receipt_content_id: contentId(
        snapshot.materialization_receipt_content_id,
        `${path}.snapshot.materialization_receipt_content_id`,
      ),
      entry_count: integer(snapshot.entry_count, `${path}.snapshot.entry_count`),
    },
    policy: {
      promotion: literal(policy.promotion, "reviewed_materialization_only", `${path}.policy.promotion`),
      legacy_unreviewed: literal(policy.legacy_unreviewed, "excluded", `${path}.policy.legacy_unreviewed`),
      unavailable: literal(policy.unavailable, "fail_closed", `${path}.policy.unavailable`),
    },
  };
  const { consumption_id: _consumptionId, ...body } = parsed;
  if (parsed.consumption_id !== `memory-consumption:${await memoryContentId(body)}`) {
    fail(`${path}.consumption_id`, "does not match the canonical run binding contents");
  }
  return parsed;
}

interface ProposalState {
  status: "pending" | "accepted" | "rejected" | "revoked";
  primary: MemoryDecision | null;
  revocation: MemoryDecision | null;
  supersededBy: string | null;
}

interface EvaluatedLedger {
  states: Map<string, ProposalState>;
  heads: Map<string, MemoryProposal>;
}

function semanticKey(proposal: Pick<MemoryProposal, "namespace" | "kind" | "key">): string {
  return JSON.stringify([proposal.namespace, proposal.kind, proposal.key]);
}

function uniqueById<T>(values: readonly T[], id: (value: T) => string, path: string): Map<string, T> {
  const result = new Map<string, T>();
  for (const value of values) {
    const key = id(value);
    if (result.has(key)) fail(path, `repeats ${key}`);
    result.set(key, value);
  }
  return result;
}

async function evaluateLedger(proposals: readonly MemoryProposal[], decisions: readonly MemoryDecision[]): Promise<EvaluatedLedger> {
  const proposalById = uniqueById(proposals, (item) => item.proposal_id, "proposals");
  const proposalContentIds = new Map(
    await Promise.all(proposals.map(async (item) => [item.proposal_id, await memoryContentId(item)] as const)),
  );
  const decisionsByProposal = new Map<string, MemoryDecision[]>();
  for (const decision of decisions) {
    const proposal = proposalById.get(decision.proposal_id);
    if (!proposal) fail(`decision ${decision.decision_id}`, "references an unavailable proposal receipt");
    if (decision.proposal_content_id !== proposalContentIds.get(proposal.proposal_id)) {
      fail(`decision ${decision.decision_id}.proposal_content_id`, "does not bind the selected proposal contents");
    }
    if (decision.decided_by === proposal.proposed_by) {
      fail(`decision ${decision.decision_id}.decided_by`, "must differ from the proposer");
    }
    if (decision.action === "accept" && proposal.kind === "rule") {
      if (decision.benchmark_receipt === null) {
        fail(`decision ${decision.decision_id}.benchmark_receipt`, "must record a rule ablation pair");
      }
      if (decision.benchmark_receipt.pack_id !== proposal.review_requirements?.benchmark.pack_id) {
        fail(`decision ${decision.decision_id}.benchmark_receipt.pack_id`, "does not match the proposed rule requirement");
      }
      if (decision.benchmark_receipt.rule_content_id !== await memoryContentId(proposal.value)) {
        fail(`decision ${decision.decision_id}.benchmark_receipt.rule_content_id`, "does not identify the proposed rule value");
      }
    } else if (decision.benchmark_receipt !== null) {
      fail(`decision ${decision.decision_id}.benchmark_receipt`, "is only valid when accepting a behavioral rule");
    }
    const list = decisionsByProposal.get(decision.proposal_id) ?? [];
    list.push(decision);
    decisionsByProposal.set(decision.proposal_id, list);
  }

  for (const proposal of proposals) {
    if (proposal.supersedes === null) continue;
    const prior = proposalById.get(proposal.supersedes);
    if (!prior) fail(`proposal ${proposal.proposal_id}.supersedes`, "references an unavailable proposal receipt");
    if (semanticKey(prior) !== semanticKey(proposal)) {
      fail(`proposal ${proposal.proposal_id}.supersedes`, "changes namespace, kind, or key");
    }
    const seen = new Set([proposal.proposal_id]);
    let cursor: MemoryProposal | undefined = prior;
    while (cursor) {
      if (seen.has(cursor.proposal_id)) fail(`proposal ${proposal.proposal_id}.supersedes`, "forms a cycle");
      seen.add(cursor.proposal_id);
      cursor = cursor.supersedes ? proposalById.get(cursor.supersedes) : undefined;
    }
  }

  const states = new Map<string, ProposalState>();
  for (const proposal of proposals) {
    const list = decisionsByProposal.get(proposal.proposal_id) ?? [];
    const primary = list.filter((item) => item.action === "accept" || item.action === "reject");
    const revocations = list.filter((item) => item.action === "revoke");
    if (primary.length > 1) fail(`proposal ${proposal.proposal_id}`, "has multiple primary decisions");
    if (revocations.length > 1) fail(`proposal ${proposal.proposal_id}`, "has multiple revocations");
    if (revocations.length > 0 && (primary.length !== 1 || primary[0].action !== "accept")) {
      fail(`proposal ${proposal.proposal_id}`, "was revoked without an acceptance receipt");
    }
    if (revocations.length > 0 && Date.parse(revocations[0].created_at) <= Date.parse(primary[0].created_at)) {
      fail(`proposal ${proposal.proposal_id}`, "was revoked before or at its acceptance time");
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
      fail(`proposal ${proposal.proposal_id}`, "was accepted without a preceding accepted head");
    }
    if (prior.revocation && Date.parse(prior.revocation.created_at) <= Date.parse(acceptedAt)) {
      fail(`proposal ${proposal.proposal_id}`, "was accepted after the prior head was revoked");
    }
    if (prior.status === "accepted") prior.supersededBy = proposal.proposal_id;
  }

  const heads = new Map<string, MemoryProposal>();
  for (const proposal of proposals) {
    const state = states.get(proposal.proposal_id);
    if (state?.status !== "accepted" || state.supersededBy !== null) continue;
    const key = semanticKey(proposal);
    if (heads.has(key)) fail(`memory key ${proposal.key}`, "has multiple accepted heads");
    heads.set(key, proposal);
  }
  return { states, heads };
}

async function validateMaterializationLinks(
  snapshot: MemoryMaterialization,
  proposals: Map<string, MemoryProposal>,
  decisions: Map<string, MemoryDecision>,
  legacy: Map<string, MemoryLegacySnapshot>,
): Promise<void> {
  const proposalRefs = uniqueById(snapshot.proposal_receipts, (item) => item.id, `materialization ${snapshot.materialization_id}.proposal_receipts`);
  const decisionRefs = uniqueById(snapshot.decision_receipts, (item) => item.id, `materialization ${snapshot.materialization_id}.decision_receipts`);
  const selectedProposals: MemoryProposal[] = [];
  const selectedDecisions: MemoryDecision[] = [];
  for (const reference of proposalRefs.values()) {
    const proposal = proposals.get(reference.id);
    if (!proposal) fail(`materialization ${snapshot.materialization_id}`, `references unavailable proposal ${reference.id}`);
    if (Date.parse(proposal.created_at) > Date.parse(snapshot.created_at)) {
      fail(`materialization ${snapshot.materialization_id}`, `predates proposal ${reference.id}`);
    }
    if (reference.content_id !== await memoryContentId(proposal)) {
      fail(`materialization ${snapshot.materialization_id}`, `records the wrong content id for ${reference.id}`);
    }
    selectedProposals.push(proposal);
  }
  for (const reference of decisionRefs.values()) {
    const decision = decisions.get(reference.id);
    if (!decision) fail(`materialization ${snapshot.materialization_id}`, `references unavailable decision ${reference.id}`);
    if (Date.parse(decision.created_at) > Date.parse(snapshot.created_at)) {
      fail(`materialization ${snapshot.materialization_id}`, `predates decision ${reference.id}`);
    }
    if (!proposalRefs.has(decision.proposal_id)) {
      fail(`materialization ${snapshot.materialization_id}`, `omits proposal ${decision.proposal_id} used by ${reference.id}`);
    }
    if (reference.content_id !== await memoryContentId(decision)) {
      fail(`materialization ${snapshot.materialization_id}`, `records the wrong content id for ${reference.id}`);
    }
    selectedDecisions.push(decision);
  }
  const evaluated = await evaluateLedger(selectedProposals, selectedDecisions);
  for (const reference of proposalRefs.values()) {
    const state = evaluated.states.get(reference.id);
    if (state?.status !== reference.status || state.supersededBy !== reference.superseded_by) {
      fail(`materialization ${snapshot.materialization_id}`, `misstates review status for ${reference.id}`);
    }
  }

  const expectedEntries = [...evaluated.heads.values()]
    .sort((left, right) => semanticKey(left).localeCompare(semanticKey(right)))
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
  if (canonicalJson(snapshot.entries) !== canonicalJson(expectedEntries)) {
    fail(`materialization ${snapshot.materialization_id}.entries`, "do not equal the accepted heads proven by its receipts");
  }

  const legacyIds = new Set<string>();
  for (const input of snapshot.legacy_inputs) {
    if (legacyIds.has(input.snapshot_id)) fail(`materialization ${snapshot.materialization_id}.legacy_inputs`, `repeats ${input.snapshot_id}`);
    legacyIds.add(input.snapshot_id);
    const selected = legacy.get(input.snapshot_id);
    if (!selected) fail(`materialization ${snapshot.materialization_id}`, `references unavailable legacy snapshot ${input.snapshot_id}`);
    if (Date.parse(selected.created_at) > Date.parse(snapshot.created_at)) {
      fail(`materialization ${snapshot.materialization_id}`, `predates legacy snapshot ${input.snapshot_id}`);
    }
    if (
      selected.namespace !== input.namespace ||
      selected.status !== input.status ||
      canonicalJson(selected.source) !== canonicalJson(input.source)
    ) {
      fail(`materialization ${snapshot.materialization_id}`, `misstates legacy snapshot ${input.snapshot_id}`);
    }
  }
}

async function parseArtifact(value: unknown, index: number): Promise<MemoryReviewArtifact> {
  const item = object(value, `artifacts[${index}]`);
  switch (item.schema) {
    case MEMORY_REVIEW_SCHEMAS.proposal:
      return proposal(value, `artifacts[${index}]`);
    case MEMORY_REVIEW_SCHEMAS.decision:
      return decision(value, `artifacts[${index}]`);
    case MEMORY_REVIEW_SCHEMAS.legacy:
      return legacySnapshot(value, `artifacts[${index}]`);
    case MEMORY_REVIEW_SCHEMAS.materialization:
      return materialization(value, `artifacts[${index}]`);
    case MEMORY_REVIEW_SCHEMAS.consumption:
      return consumption(value, `artifacts[${index}]`);
    default:
      fail(`artifacts[${index}].schema`, "is not an inspectable memory review receipt");
  }
}

function materializationSnapshotContentId(snapshot: MemoryMaterialization): string {
  return snapshot.materialization_id.slice("memory-materialization:".length);
}

export async function inspectMemoryReviewArtifacts(values: readonly unknown[]): Promise<MemoryReviewInspection> {
  if (values.length === 0) fail("artifacts", "must contain at least one selected receipt");
  const artifacts: MemoryReviewArtifact[] = [];
  for (const [index, value] of values.entries()) artifacts.push(await parseArtifact(value, index));
  const proposals = artifacts.filter((item): item is MemoryProposal => item.schema === MEMORY_REVIEW_SCHEMAS.proposal);
  const decisions = artifacts.filter((item): item is MemoryDecision => item.schema === MEMORY_REVIEW_SCHEMAS.decision);
  const legacy = artifacts.filter((item): item is MemoryLegacySnapshot => item.schema === MEMORY_REVIEW_SCHEMAS.legacy);
  const materializations = artifacts.filter((item): item is MemoryMaterialization => item.schema === MEMORY_REVIEW_SCHEMAS.materialization);
  const consumptions = artifacts.filter((item): item is MemoryConsumptionReceipt => item.schema === MEMORY_REVIEW_SCHEMAS.consumption);
  const proposalById = uniqueById(proposals, (item) => item.proposal_id, "proposals");
  const decisionById = uniqueById(decisions, (item) => item.decision_id, "decisions");
  const legacyById = uniqueById(legacy, (item) => item.snapshot_id, "legacy snapshots");
  uniqueById(materializations, (item) => item.materialization_id, "materializations");
  uniqueById(consumptions, (item) => item.consumption_id, "consumptions");
  const evaluated = await evaluateLedger(proposals, decisions);

  for (const snapshot of materializations) {
    await validateMaterializationLinks(snapshot, proposalById, decisionById, legacyById);
  }
  const materializationById = new Map(materializations.map((item) => [item.materialization_id, item]));
  const consumptionRuns = new Set<string>();
  for (const receipt of consumptions) {
    if (consumptionRuns.has(receipt.run_id)) fail("consumptions", `bind run ${receipt.run_id} more than once`);
    consumptionRuns.add(receipt.run_id);
    const snapshot = materializationById.get(receipt.snapshot.materialization_id);
    if (!snapshot) fail(`consumption ${receipt.consumption_id}`, "references an unavailable materialization receipt");
    if (receipt.snapshot.snapshot_content_id !== materializationSnapshotContentId(snapshot)) {
      fail(`consumption ${receipt.consumption_id}.snapshot.snapshot_content_id`, "does not match the accepted snapshot");
    }
    if (receipt.snapshot.materialization_receipt_content_id !== await memoryContentId(snapshot)) {
      fail(`consumption ${receipt.consumption_id}.snapshot.materialization_receipt_content_id`, "does not bind the selected materialization receipt");
    }
    if (receipt.snapshot.entry_count !== snapshot.entries.length) {
      fail(`consumption ${receipt.consumption_id}.snapshot.entry_count`, "does not match the accepted snapshot");
    }
  }

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
      const atRevocation = await evaluateLedger(
        proposals.filter((candidate) => Date.parse(candidate.created_at) <= cutoff),
        decisions.filter((candidate) => Date.parse(candidate.created_at) <= cutoff),
      );
      transitions.push({
        type: "revocation",
        proposalId: proposal.proposal_id,
        decisionId: state.revocation.decision_id,
        createdAt: state.revocation.created_at,
        priorProposalId: proposal.supersedes,
        restoredProposalId: atRevocation.heads.get(semanticKey(proposal))?.proposal_id ?? null,
      });
    }
  }
  transitions.sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.decisionId.localeCompare(right.decisionId));

  return {
    schema: "studio.memory.review-inspection.v1",
    scope: "operator_selected_receipts",
    completeness: "not_repository_discovery",
    proposals: await Promise.all(
      proposals
        .slice()
        .sort((left, right) => left.created_at.localeCompare(right.created_at) || left.proposal_id.localeCompare(right.proposal_id))
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
    decisions: decisions.slice().sort((left, right) => left.created_at.localeCompare(right.created_at) || left.decision_id.localeCompare(right.decision_id)),
    transitions,
    materializations: await Promise.all(
      materializations
        .slice()
        .sort((left, right) => left.created_at.localeCompare(right.created_at) || left.materialization_id.localeCompare(right.materialization_id))
        .map(async (item) => ({
          materializationId: item.materialization_id,
          snapshotContentId: materializationSnapshotContentId(item),
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
        .sort((left, right) => left.consumed_at.localeCompare(right.consumed_at) || left.consumption_id.localeCompare(right.consumption_id))
        .map(async (item) => ({
          consumptionId: item.consumption_id,
          receiptContentId: await memoryContentId(item),
          runId: item.run_id,
          consumedAt: item.consumed_at,
          snapshot: structuredClone(item.snapshot),
        })),
    ),
    legacyInputs: legacy.slice().sort((left, right) => left.created_at.localeCompare(right.created_at) || left.snapshot_id.localeCompare(right.snapshot_id)),
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

/**
 * The only boundary in this slice that returns accepted cross-run values. It validates the
 * complete selected receipt chain and waits for the exact run/snapshot binding to be durably
 * recorded before exposing entries. No production run calls this yet, so current consumption is
 * honestly unavailable rather than inferred from a materialization's existence.
 */
export async function consumeAcceptedMemorySnapshotForRun(
  artifacts: readonly unknown[],
  requestValue: ConsumeMemoryRequest,
  record: (receipt: MemoryConsumptionReceipt) => Promise<void>,
): Promise<ConsumedMemorySnapshot> {
  if (typeof record !== "function") fail("consumption recorder", "is required");
  const request = object(requestValue, "consumption request");
  exact(request, ["runId", "materializationId", "consumedAt"], "consumption request");
  const runId = text(request.runId, "consumption request.runId");
  const materializationId = receiptId(
    request.materializationId,
    "memory-materialization",
    "consumption request.materializationId",
  );
  const consumedAt = isoTimestamp(request.consumedAt, "consumption request.consumedAt");
  const inspection = await inspectMemoryReviewArtifacts(artifacts);
  if (inspection.consumptions.some((item) => item.runId === runId)) {
    fail("consumption request.runId", "already has a selected memory consumption receipt");
  }
  const snapshot = inspection.materializations.find((item) => item.materializationId === materializationId);
  if (!snapshot) fail("consumption request.materializationId", "is not a validated selected materialization");
  const body = {
    schema: MEMORY_REVIEW_SCHEMAS.consumption,
    run_id: runId,
    consumed_at: consumedAt,
    snapshot: {
      materialization_id: snapshot.materializationId,
      snapshot_content_id: snapshot.snapshotContentId,
      materialization_receipt_content_id: snapshot.receiptContentId,
      entry_count: snapshot.entries.length,
    },
    policy: {
      promotion: "reviewed_materialization_only" as const,
      legacy_unreviewed: "excluded" as const,
      unavailable: "fail_closed" as const,
    },
  };
  const receipt: MemoryConsumptionReceipt = {
    consumption_id: `memory-consumption:${await memoryContentId(body)}`,
    ...body,
  };
  await record(structuredClone(receipt));
  return { receipt, entries: structuredClone(snapshot.entries) };
}
