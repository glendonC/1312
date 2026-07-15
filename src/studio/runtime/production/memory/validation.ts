import { canonicalMemoryJson, memoryContentId } from "./contentIdentity.ts";
import {
  MEMORY_REVIEW_SCHEMAS,
  type ConsumeMemoryRequest,
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
} from "./model.ts";

const MEMORY_KINDS = new Set<MemoryKind>(["glossary", "correction", "rule"]);
const DECISION_ACTIONS = new Set<MemoryDecisionAction>(["accept", "reject", "revoke"]);

export function memoryInspectionFailure(path: string, message: string): never {
  throw new Error(`memory inspection: ${path} ${message}`);
}

function object(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    memoryInspectionFailure(path, "must be an object");
  }
  return value as Record<string, unknown>;
}

function exact(item: Record<string, unknown>, keys: readonly string[], path: string): void {
  const allowed = new Set(keys);
  for (const key of Object.keys(item)) {
    if (!allowed.has(key)) memoryInspectionFailure(`${path}.${key}`, "is not allowed");
  }
  for (const key of keys) {
    if (!(key in item)) memoryInspectionFailure(`${path}.${key}`, "is required");
  }
}

function text(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    memoryInspectionFailure(path, "must be a non-empty string");
  }
  return value;
}

function literal<T extends string>(value: unknown, expected: T, path: string): T {
  if (value !== expected) memoryInspectionFailure(path, `must equal ${expected}`);
  return expected;
}

function nullable<T>(value: unknown, parse: (candidate: unknown) => T): T | null {
  return value === null ? null : parse(value);
}

function integer(value: unknown, path: string, minimum = 0): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) {
    memoryInspectionFailure(path, `must be a safe integer at least ${minimum}`);
  }
  return value as number;
}

function signedInteger(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value)) memoryInspectionFailure(path, "must be a safe integer");
  return value as number;
}

function finiteNumber(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    memoryInspectionFailure(path, "must be a finite number");
  }
  return value;
}

function contentId(value: unknown, path: string): string {
  const id = text(value, path);
  if (!/^sha256:[a-f0-9]{64}$/.test(id)) {
    memoryInspectionFailure(path, "must be a lowercase SHA-256 content id");
  }
  return id;
}

function receiptId(value: unknown, prefix: string, path: string): string {
  const id = text(value, path);
  if (!id.startsWith(`${prefix}:`)) memoryInspectionFailure(path, `must be a ${prefix} receipt id`);
  contentId(id.slice(prefix.length + 1), path);
  return id;
}

function isoTimestamp(value: unknown, path: string): string {
  const timestamp = text(value, path);
  const parsed = new Date(timestamp);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== timestamp) {
    memoryInspectionFailure(path, "must be an exact ISO-8601 UTC timestamp");
  }
  return timestamp;
}

function namespace(value: unknown, path: string): string {
  const result = text(value, path);
  if (!/^[a-z0-9][a-z0-9._/-]*$/.test(result) || result.includes("..") || result.endsWith("/")) {
    memoryInspectionFailure(path, "must be a lowercase path-like identifier without traversal");
  }
  return result;
}

function memoryKind(value: unknown, path: string): MemoryKind {
  if (!MEMORY_KINDS.has(value as MemoryKind)) memoryInspectionFailure(path, "is not a registered memory kind");
  return value as MemoryKind;
}

function decisionAction(value: unknown, path: string): MemoryDecisionAction {
  if (!DECISION_ACTIONS.has(value as MemoryDecisionAction)) {
    memoryInspectionFailure(path, "is not a registered decision action");
  }
  return value as MemoryDecisionAction;
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
    memoryInspectionFailure(path, "must record distinct with-rule and without-rule ablation reports");
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
    memoryInspectionFailure(`${path}.evidence`, "must contain at least one evidence receipt");
  }
  canonicalMemoryJson(item.value);
  if (item.source !== null) canonicalMemoryJson(item.source);
  const kind = memoryKind(item.kind, `${path}.kind`);
  let requirements: MemoryProposal["review_requirements"] = null;
  if (kind === "rule") {
    const review = object(item.review_requirements, `${path}.review_requirements`);
    exact(review, ["benchmark"], `${path}.review_requirements`);
    const benchmark = object(review.benchmark, `${path}.review_requirements.benchmark`);
    exact(benchmark, ["pack_id"], `${path}.review_requirements.benchmark`);
    requirements = { benchmark: { pack_id: text(benchmark.pack_id, `${path}.review_requirements.benchmark.pack_id`) } };
  } else if (item.review_requirements !== null) {
    memoryInspectionFailure(`${path}.review_requirements`, "must be null outside behavioral rule proposals");
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
    memoryInspectionFailure(`${path}.proposal_id`, "does not match the canonical proposal contents");
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
    memoryInspectionFailure(`${path}.decision_id`, "does not match the canonical decision contents");
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
    memoryInspectionFailure(`${path}.snapshot_id`, "does not match the legacy source receipt");
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
  if (!Array.isArray(item.evidence) || item.evidence.length === 0) {
    memoryInspectionFailure(`${path}.evidence`, "must not be empty");
  }
  canonicalMemoryJson(item.value);
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
  if (!Array.isArray(item.entries)) memoryInspectionFailure(`${path}.entries`, "must be an array");
  if (!Array.isArray(item.proposal_receipts)) memoryInspectionFailure(`${path}.proposal_receipts`, "must be an array");
  if (!Array.isArray(item.decision_receipts)) memoryInspectionFailure(`${path}.decision_receipts`, "must be an array");
  if (!Array.isArray(item.legacy_inputs)) memoryInspectionFailure(`${path}.legacy_inputs`, "must be an array");
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
        memoryInspectionFailure(`${path}.proposal_receipts[${index}].status`, "is not a recorded ledger status");
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
    memoryInspectionFailure(`${path}.materialization_id`, "does not match the canonical accepted snapshot contents");
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
    memoryInspectionFailure(`${path}.consumption_id`, "does not match the canonical run binding contents");
  }
  return parsed;
}

export async function parseMemoryReviewArtifact(value: unknown, index: number): Promise<MemoryReviewArtifact> {
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
      memoryInspectionFailure(`artifacts[${index}].schema`, "is not an inspectable memory review receipt");
  }
}

export interface ParsedConsumeMemoryRequest {
  runId: string;
  materializationId: string;
  consumedAt: string;
}

export function parseConsumeMemoryRequest(value: ConsumeMemoryRequest): ParsedConsumeMemoryRequest {
  const request = object(value, "consumption request");
  exact(request, ["runId", "materializationId", "consumedAt"], "consumption request");
  return {
    runId: text(request.runId, "consumption request.runId"),
    materializationId: receiptId(
      request.materializationId,
      "memory-materialization",
      "consumption request.materializationId",
    ),
    consumedAt: isoTimestamp(request.consumedAt, "consumption request.consumedAt"),
  };
}
