import { aggregateObservability } from "./aggregate.ts";
import { canonicalJson, canonicalJsonLine, identifyUtf8 } from "./hash.ts";
import type {
  ObservabilitySourceReferences,
  RuntimeObservabilityIndex,
  Sha256Identity,
} from "./model.ts";

const TASK_STATUSES = new Set(["scheduled", "working", "reported", "completed", "failed", "withheld"]);
const AGENT_STATUSES = new Set(["registered", "working", "reporting", "retired"]);
const WORKER_KINDS = new Set(["orchestrator", "media", "analysis", "translation", "quality"]);
const OPERATION_STATUSES = new Set(["started", "completed", "failed"]);
const EXECUTION_STATUSES = new Set(["active", "completed", "failed", "timed_out"]);
const REPORT_STATUSES = new Set(["submitted", "accepted", "rejected"]);
const FAILURE_KINDS = new Set([
  "spawn_rejected",
  "task_failed",
  "media_operation_failed",
  "executor_failed",
  "executor_timed_out",
  "handoff_rejected",
]);

function fail(path: string, message: string): never {
  throw new Error(`Runtime observability index: ${path} ${message}`);
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

function array(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) fail(path, "must be an array");
  return value;
}

function string(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim().length === 0) fail(path, "must be a non-empty string");
  return value;
}

function nullableString(value: unknown, path: string): string | null {
  return value === null ? null : string(value, path);
}

function integer(value: unknown, path: string, minimum = 0): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) {
    fail(path, `must be a safe integer at least ${minimum}`);
  }
  return value as number;
}

function nullableInteger(value: unknown, path: string): number | null {
  return value === null ? null : integer(value, path);
}

function oneOf(value: unknown, allowed: Set<string>, path: string): string {
  const selected = string(value, path);
  if (!allowed.has(selected)) fail(path, `has unknown value ${selected}`);
  return selected;
}

function strings(value: unknown, path: string): string[] {
  const result = array(value, path).map((entry, index) => string(entry, `${path}[${index}]`));
  if (new Set(result).size !== result.length) fail(path, "must not contain duplicates");
  return result;
}

function contentIdentity(value: unknown, path: string): asserts value is Sha256Identity {
  const item = object(value, path);
  exact(item, ["algorithm", "digest", "contentId", "bytes"], path);
  if (item.algorithm !== "sha256") fail(`${path}.algorithm`, "must equal sha256");
  const digest = string(item.digest, `${path}.digest`);
  if (!/^[a-f0-9]{64}$/.test(digest)) fail(`${path}.digest`, "must be a lowercase SHA-256 digest");
  if (item.contentId !== `sha256:${digest}`) fail(`${path}.contentId`, "must match the digest");
  integer(item.bytes, `${path}.bytes`, 1);
}

function contentId(value: unknown, path: string): string {
  const id = string(value, path);
  if (!/^sha256:[a-f0-9]{64}$/.test(id)) fail(path, "must be a SHA-256 content id");
  return id;
}

function sourceReferences(value: unknown, path: string): asserts value is ObservabilitySourceReferences {
  const item = object(value, path);
  exact(item, ["eventIds", "receiptIds", "artifactIds"], path);
  if (strings(item.eventIds, `${path}.eventIds`).length === 0) {
    fail(`${path}.eventIds`, "must retain at least one source event");
  }
  strings(item.receiptIds, `${path}.receiptIds`);
  strings(item.artifactIds, `${path}.artifactIds`);
}

function validateSourceReferences(index: RuntimeObservabilityIndex): void {
  const eventIds = new Set(index.sources.events.map((source) => source.eventId));
  const receiptIds = new Set(index.sources.receipts.map((source) => source.receiptId));
  const artifactIds = new Set(index.sources.artifacts.map((source) => source.artifactId));
  const allRecords = [
    ...index.records.tasks,
    ...index.records.agents,
    ...index.records.operations,
    ...index.records.executions,
    ...index.records.handoffs,
    ...index.records.failures,
  ];
  for (const record of allRecords) {
    for (const id of record.sources.eventIds) if (!eventIds.has(id)) fail("records.sources.eventIds", `references unknown ${id}`);
    for (const id of record.sources.receiptIds) if (!receiptIds.has(id)) fail("records.sources.receiptIds", `references unknown ${id}`);
    for (const id of record.sources.artifactIds) if (!artifactIds.has(id)) fail("records.sources.artifactIds", `references unknown ${id}`);
  }
  for (const receipt of index.sources.receipts) {
    if (!eventIds.has(receipt.eventId)) fail("sources.receipts.eventId", `references unknown ${receipt.eventId}`);
  }
  for (const artifact of index.sources.artifacts) {
    if (!eventIds.has(artifact.eventId)) fail("sources.artifacts.eventId", `references unknown ${artifact.eventId}`);
    if (artifact.receiptId !== null && !receiptIds.has(artifact.receiptId)) {
      fail("sources.artifacts.receiptId", `references unknown ${artifact.receiptId}`);
    }
  }
}

export function assertRuntimeObservabilityIndex(
  value: unknown,
): asserts value is RuntimeObservabilityIndex {
  const item = object(value, "index");
  exact(
    item,
    ["schema", "indexId", "content", "producer", "sourceJournal", "sources", "records", "summary"],
    "index",
  );
  if (item.schema !== "studio.runtime.observability-index.v1") fail("index.schema", "is unsupported");
  const indexId = string(item.indexId, "index.indexId");
  contentIdentity(item.content, "index.content");
  if (indexId !== `observability:${item.content.digest}`) fail("index.indexId", "must match index content");

  const producer = object(item.producer, "index.producer");
  exact(producer, ["id", "version"], "index.producer");
  if (producer.id !== "studio.runtime.observability-indexer" || producer.version !== "1") {
    fail("index.producer", "is unsupported");
  }

  const journal = object(item.sourceJournal, "index.sourceJournal");
  exact(journal, ["schema", "runId", "content", "eventCount", "firstEventId", "lastEventId"], "index.sourceJournal");
  if (journal.schema !== "studio.runtime.event.v1") fail("index.sourceJournal.schema", "is unsupported");
  const runId = string(journal.runId, "index.sourceJournal.runId");
  contentIdentity(journal.content, "index.sourceJournal.content");
  const eventCount = integer(journal.eventCount, "index.sourceJournal.eventCount", 1);
  string(journal.firstEventId, "index.sourceJournal.firstEventId");
  string(journal.lastEventId, "index.sourceJournal.lastEventId");

  const sources = object(item.sources, "index.sources");
  exact(sources, ["events", "receipts", "artifacts"], "index.sources");
  const sourceEvents = array(sources.events, "index.sources.events");
  if (sourceEvents.length !== eventCount) fail("index.sources.events", "must match source event count");
  sourceEvents.forEach((entry, index) => {
    const source = object(entry, `index.sources.events[${index}]`);
    exact(source, ["eventId", "seq", "type", "producerKind", "contentId"], `index.sources.events[${index}]`);
    const eventId = string(source.eventId, `index.sources.events[${index}].eventId`);
    const seq = integer(source.seq, `index.sources.events[${index}].seq`, 1);
    if (seq !== index + 1 || eventId !== `event:${runId}:${seq}`) {
      fail(`index.sources.events[${index}]`, "is not the ordered run event identity");
    }
    string(source.type, `index.sources.events[${index}].type`);
    string(source.producerKind, `index.sources.events[${index}].producerKind`);
    contentId(source.contentId, `index.sources.events[${index}].contentId`);
  });
  if (
    (sourceEvents[0] as { eventId: string }).eventId !== journal.firstEventId ||
    (sourceEvents.at(-1) as { eventId: string }).eventId !== journal.lastEventId
  ) {
    fail("index.sourceJournal", "event bounds do not match the source registry");
  }

  const receiptSources = array(sources.receipts, "index.sources.receipts");
  receiptSources.forEach((entry, index) => {
    const source = object(entry, `index.sources.receipts[${index}]`);
    exact(
      source,
      ["receiptId", "kind", "eventId", "contentId", "storage", "rawReceiptContentId"],
      `index.sources.receipts[${index}]`,
    );
    string(source.receiptId, `index.sources.receipts[${index}].receiptId`);
    oneOf(source.kind, new Set(["media_operation", "semantic_media_evidence", "evidence_assessment", "evidence_decision", "study_planning_decision", "owned_media_study", "study_readiness", "publish_review_intake", "publish_review_decision", "publish_review_revocation", "caption_production", "caption_quality_control", "root_output_disposition", "parent_artifact_disposition", "parent_admission", "parent_artifact_read", "executor_span", "model_usage"]), `index.sources.receipts[${index}].kind`);
    string(source.eventId, `index.sources.receipts[${index}].eventId`);
    contentId(source.contentId, `index.sources.receipts[${index}].contentId`);
    oneOf(source.storage, new Set(["artifact_store", "embedded_event"]), `index.sources.receipts[${index}].storage`);
    if (source.rawReceiptContentId !== null) contentId(source.rawReceiptContentId, `index.sources.receipts[${index}].rawReceiptContentId`);
  });

  const artifactSources = array(sources.artifacts, "index.sources.artifacts");
  artifactSources.forEach((entry, index) => {
    const source = object(entry, `index.sources.artifacts[${index}]`);
    exact(source, ["artifactId", "kind", "eventId", "contentId", "receiptId"], `index.sources.artifacts[${index}]`);
    string(source.artifactId, `index.sources.artifacts[${index}].artifactId`);
    string(source.kind, `index.sources.artifacts[${index}].kind`);
    string(source.eventId, `index.sources.artifacts[${index}].eventId`);
    contentId(source.contentId, `index.sources.artifacts[${index}].contentId`);
    nullableString(source.receiptId, `index.sources.artifacts[${index}].receiptId`);
  });

  const records = object(item.records, "index.records");
  exact(records, ["tasks", "agents", "operations", "executions", "handoffs", "failures"], "index.records");
  const common = (record: Record<string, unknown>, path: string): void => {
    if (record.runId !== runId) fail(`${path}.runId`, "must match the journal run");
    sourceReferences(record.sources, `${path}.sources`);
  };

  array(records.tasks, "index.records.tasks").forEach((entry, index) => {
    const path = `index.records.tasks[${index}]`;
    const record = object(entry, path);
    exact(record, ["runId", "taskId", "assignedAgentId", "parentTaskId", "depth", "workerKind", "status", "sources"], path);
    string(record.taskId, `${path}.taskId`);
    string(record.assignedAgentId, `${path}.assignedAgentId`);
    nullableString(record.parentTaskId, `${path}.parentTaskId`);
    integer(record.depth, `${path}.depth`);
    oneOf(record.workerKind, WORKER_KINDS, `${path}.workerKind`);
    oneOf(record.status, TASK_STATUSES, `${path}.status`);
    common(record, path);
  });

  array(records.agents, "index.records.agents").forEach((entry, index) => {
    const path = `index.records.agents[${index}]`;
    const record = object(entry, path);
    exact(record, ["runId", "agentId", "taskId", "parentAgentId", "kind", "status", "sources"], path);
    string(record.agentId, `${path}.agentId`);
    string(record.taskId, `${path}.taskId`);
    nullableString(record.parentAgentId, `${path}.parentAgentId`);
    oneOf(record.kind, WORKER_KINDS, `${path}.kind`);
    oneOf(record.status, AGENT_STATUSES, `${path}.status`);
    common(record, path);
  });

  array(records.operations, "index.records.operations").forEach((entry, index) => {
    const path = `index.records.operations[${index}]`;
    const record = object(entry, path);
    exact(
      record,
      ["runId", "operationId", "taskId", "agentId", "capability", "status", "artifactId", "trackId", "startMs", "endMs", "requestedDurationMs", "outputArtifactId", "receiptId", "sources"],
      path,
    );
    string(record.operationId, `${path}.operationId`);
    string(record.taskId, `${path}.taskId`);
    string(record.agentId, `${path}.agentId`);
    oneOf(record.capability, new Set(["media.extract", "media.seek"]), `${path}.capability`);
    const status = oneOf(record.status, OPERATION_STATUSES, `${path}.status`);
    string(record.artifactId, `${path}.artifactId`);
    string(record.trackId, `${path}.trackId`);
    const start = integer(record.startMs, `${path}.startMs`);
    const end = integer(record.endMs, `${path}.endMs`, 1);
    if (end <= start || record.requestedDurationMs !== end - start) fail(path, "has an invalid measured request range");
    const output = nullableString(record.outputArtifactId, `${path}.outputArtifactId`);
    const receipt = nullableString(record.receiptId, `${path}.receiptId`);
    if ((status === "completed") !== (output !== null && receipt !== null)) fail(path, "completion must match output and receipt identities");
    common(record, path);
  });

  array(records.executions, "index.records.executions").forEach((entry, index) => {
    const path = `index.records.executions[${index}]`;
    const record = object(entry, path);
    exact(
      record,
      ["runId", "executionId", "taskId", "agentId", "status", "startedAt", "endedAt", "activeDurationMs", "model", "tokens", "providerUnits", "billing", "sources"],
      path,
    );
    string(record.executionId, `${path}.executionId`);
    string(record.taskId, `${path}.taskId`);
    string(record.agentId, `${path}.agentId`);
    const status = oneOf(record.status, EXECUTION_STATUSES, `${path}.status`);
    const startedAt = string(record.startedAt, `${path}.startedAt`);
    if (!Number.isFinite(Date.parse(startedAt))) fail(`${path}.startedAt`, "must be an ISO timestamp");
    const endedAt = nullableString(record.endedAt, `${path}.endedAt`);
    if (endedAt !== null && !Number.isFinite(Date.parse(endedAt))) fail(`${path}.endedAt`, "must be an ISO timestamp");
    const active = nullableInteger(record.activeDurationMs, `${path}.activeDurationMs`);
    if ((status === "active") !== (endedAt === null && active === null)) fail(path, "active status must match span availability");
    nullableString(record.model, `${path}.model`);
    if (record.tokens !== null) {
      const tokens = object(record.tokens, `${path}.tokens`);
      exact(tokens, ["inputTokens", "cachedInputTokens", "outputTokens", "reasoningOutputTokens"], `${path}.tokens`);
      const input = integer(tokens.inputTokens, `${path}.tokens.inputTokens`);
      const cached = integer(tokens.cachedInputTokens, `${path}.tokens.cachedInputTokens`);
      integer(tokens.outputTokens, `${path}.tokens.outputTokens`);
      integer(tokens.reasoningOutputTokens, `${path}.tokens.reasoningOutputTokens`);
      if (cached > input) fail(`${path}.tokens.cachedInputTokens`, "cannot exceed input tokens");
    }
    if (record.providerUnits !== null) fail(`${path}.providerUnits`, "must remain null without a producer");
    const billing = object(record.billing, `${path}.billing`);
    exact(billing, ["amount", "currency"], `${path}.billing`);
    if (billing.amount !== null || billing.currency !== null) fail(`${path}.billing`, "must remain null without a producer");
    common(record, path);
  });

  array(records.handoffs, "index.records.handoffs").forEach((entry, index) => {
    const path = `index.records.handoffs[${index}]`;
    const record = object(entry, path);
    exact(record, ["runId", "reportId", "taskId", "agentId", "parentTaskId", "parentAgentId", "status", "outputArtifactIds", "sources"], path);
    string(record.reportId, `${path}.reportId`);
    string(record.taskId, `${path}.taskId`);
    string(record.agentId, `${path}.agentId`);
    string(record.parentTaskId, `${path}.parentTaskId`);
    string(record.parentAgentId, `${path}.parentAgentId`);
    oneOf(record.status, REPORT_STATUSES, `${path}.status`);
    if (strings(record.outputArtifactIds, `${path}.outputArtifactIds`).length === 0) fail(`${path}.outputArtifactIds`, "must not be empty");
    common(record, path);
  });

  array(records.failures, "index.records.failures").forEach((entry, index) => {
    const path = `index.records.failures[${index}]`;
    const record = object(entry, path);
    exact(record, ["runId", "failureId", "kind", "taskId", "agentId", "entityId", "sources"], path);
    string(record.failureId, `${path}.failureId`);
    oneOf(record.kind, FAILURE_KINDS, `${path}.kind`);
    nullableString(record.taskId, `${path}.taskId`);
    nullableString(record.agentId, `${path}.agentId`);
    string(record.entityId, `${path}.entityId`);
    common(record, path);
  });

  const typed = value as RuntimeObservabilityIndex;
  const expectedSummary = aggregateObservability(typed.records);
  if (canonicalJson(item.summary) !== canonicalJson(expectedSummary)) {
    fail("index.summary", "does not equal the aggregation of indexed measured facts");
  }
  validateSourceReferences(typed);
}

export async function validateRuntimeObservabilityIndex(
  value: unknown,
): Promise<RuntimeObservabilityIndex> {
  assertRuntimeObservabilityIndex(value);
  const { indexId: _indexId, content: _content, ...body } = value;
  const measured = await identifyUtf8(canonicalJsonLine(body));
  if (measured.contentId !== value.content.contentId || measured.bytes !== value.content.bytes) {
    fail("index.content", "does not match the canonical index body");
  }
  return value;
}
