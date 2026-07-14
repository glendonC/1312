import {
  CAPABILITIES,
  type AgentRecord,
  type Capability,
  type CapabilityGrant,
  type ExecutorSpanReceipt,
  type MediaExtractRequest,
  type MediaOperationReceipt,
  type MediaScope,
  type ModelUsageReceipt,
  type ReportDecisionRequest,
  type ReportRecord,
  type ReportSubmitRequest,
  type RequiredOutput,
  type RuntimeArtifact,
  type RuntimeBudget,
  type RuntimeLimits,
  type SourceArtifactDescriptor,
  type SpawnRequestInput,
  type TaskRecord,
  type WorkerOutputEnvelope,
} from "./model.ts";
import type { RuntimeEvent } from "./protocol.ts";

const CAPABILITY_SET = new Set<string>(CAPABILITIES);
const TASK_STATUSES = new Set(["scheduled", "working", "reported", "completed", "failed", "withheld"]);
const AGENT_STATUSES = new Set(["registered", "working", "reporting", "retired"]);
const WORKER_KINDS = new Set(["orchestrator", "media", "analysis", "translation", "quality"]);
const TRACK_KINDS = new Set(["audio", "video", "subtitle", "data", "attachment"]);
const REJECTIONS = new Set([
  "requester_not_authorized",
  "max_depth",
  "max_active_workers",
  "run_budget",
  "duplicate_owner",
  "missing_output_contract",
  "dependency_unavailable",
  "scope_violation",
  "capability_not_grantable",
]);

function fail(context: string, path: string, message: string): never {
  throw new Error(`${context}: ${path} ${message}`);
}

function object(value: unknown, context: string, path: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail(context, path, "must be an object");
  }
  return value as Record<string, unknown>;
}

function exact(item: Record<string, unknown>, keys: readonly string[], context: string, path: string): void {
  const allowed = new Set(keys);
  for (const key of Object.keys(item)) {
    if (!allowed.has(key)) fail(context, `${path}.${key}`, "is not allowed");
  }
  for (const key of keys) {
    if (!(key in item)) fail(context, `${path}.${key}`, "is required");
  }
}

function array(value: unknown, context: string, path: string): unknown[] {
  if (!Array.isArray(value)) fail(context, path, "must be an array");
  return value;
}

function string(value: unknown, context: string, path: string): string {
  if (typeof value !== "string" || value.trim().length === 0) fail(context, path, "must be a non-empty string");
  return value;
}

function nullableString(value: unknown, context: string, path: string): string | null {
  return value === null ? null : string(value, context, path);
}

function isoTimestamp(value: unknown, context: string, path: string): string {
  const timestamp = string(value, context, path);
  if (!Number.isFinite(Date.parse(timestamp))) fail(context, path, "must be an ISO timestamp");
  return timestamp;
}

function integer(value: unknown, context: string, path: string, minimum = 0): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) {
    fail(context, path, `must be a safe integer at least ${minimum}`);
  }
  return value as number;
}

function nullableInteger(value: unknown, context: string, path: string, minimum = 0): number | null {
  return value === null ? null : integer(value, context, path, minimum);
}

function boolean(value: unknown, context: string, path: string): boolean {
  if (typeof value !== "boolean") fail(context, path, "must be a boolean");
  return value;
}

function literal<T extends string>(value: unknown, expected: T, context: string, path: string): T {
  if (value !== expected) fail(context, path, `must equal ${expected}`);
  return expected;
}

function oneOf<T extends string>(value: unknown, values: Set<string>, context: string, path: string): T {
  const selected = string(value, context, path);
  if (!values.has(selected)) fail(context, path, `has unknown value ${selected}`);
  return selected as T;
}

function uniqueStrings(value: unknown, context: string, path: string): string[] {
  const values = array(value, context, path).map((item, index) => string(item, context, `${path}[${index}]`));
  if (new Set(values).size !== values.length) fail(context, path, "must not contain duplicates");
  return values;
}

function hash(value: unknown, context: string, path: string): void {
  const item = object(value, context, path);
  exact(item, ["algorithm", "digest", "contentId", "bytes"], context, path);
  literal(item.algorithm, "sha256", context, `${path}.algorithm`);
  const digest = string(item.digest, context, `${path}.digest`);
  if (!/^[a-f0-9]{64}$/.test(digest)) fail(context, `${path}.digest`, "must be a lowercase SHA-256 digest");
  if (item.contentId !== `sha256:${digest}`) fail(context, `${path}.contentId`, "must match the digest");
  integer(item.bytes, context, `${path}.bytes`, 1);
}

function budget(value: unknown, context: string, path: string): asserts value is RuntimeBudget {
  const item = object(value, context, path);
  exact(item, ["wallMs", "toolCalls"], context, path);
  integer(item.wallMs, context, `${path}.wallMs`, 1);
  integer(item.toolCalls, context, `${path}.toolCalls`, 1);
}

function scope(value: unknown, context: string, path: string): asserts value is MediaScope {
  const item = object(value, context, path);
  exact(item, ["artifactId", "trackId", "startMs", "endMs"], context, path);
  string(item.artifactId, context, `${path}.artifactId`);
  string(item.trackId, context, `${path}.trackId`);
  const start = integer(item.startMs, context, `${path}.startMs`);
  const end = integer(item.endMs, context, `${path}.endMs`, 1);
  if (end <= start) fail(context, path, "must be a non-empty half-open range");
}

function scopes(value: unknown, context: string, path: string): MediaScope[] {
  const result = array(value, context, path);
  result.forEach((item, index) => scope(item, context, `${path}[${index}]`));
  const keys = result.map((item) => {
    const range = item as MediaScope;
    return `${range.artifactId}\u0000${range.trackId}\u0000${range.startMs}\u0000${range.endMs}`;
  });
  if (new Set(keys).size !== keys.length) fail(context, path, "must not repeat a scope");
  return result as MediaScope[];
}

function outputs(value: unknown, context: string, path: string): RequiredOutput[] {
  const result = array(value, context, path);
  result.forEach((entry, index) => {
    const item = object(entry, context, `${path}[${index}]`);
    exact(item, ["name", "artifactKind", "required"], context, `${path}[${index}]`);
    string(item.name, context, `${path}[${index}].name`);
    string(item.artifactKind, context, `${path}[${index}].artifactKind`);
    boolean(item.required, context, `${path}[${index}].required`);
  });
  const names = result.map((entry) => (entry as RequiredOutput).name);
  if (new Set(names).size !== names.length) fail(context, path, "must not repeat output names");
  return result as RequiredOutput[];
}

function capabilities(value: unknown, context: string, path: string): Capability[] {
  const values = uniqueStrings(value, context, path);
  values.forEach((entry, index) => oneOf<Capability>(entry, CAPABILITY_SET, context, `${path}[${index}]`));
  return values as Capability[];
}

function grant(value: unknown, context: string, path: string): asserts value is CapabilityGrant {
  const item = object(value, context, path);
  exact(item, ["id", "capability", "taskId", "agentId", "mediaScope"], context, path);
  string(item.id, context, `${path}.id`);
  const capability = oneOf<Capability>(item.capability, CAPABILITY_SET, context, `${path}.capability`);
  string(item.taskId, context, `${path}.taskId`);
  string(item.agentId, context, `${path}.agentId`);
  const mediaScope = scopes(item.mediaScope, context, `${path}.mediaScope`);
  if (capability.startsWith("media.") && mediaScope.length === 0) fail(context, path, "media grants require scope");
  if (!capability.startsWith("media.") && mediaScope.length !== 0) fail(context, path, "non-media grants cannot carry scope");
}

function grants(value: unknown, context: string, path: string): CapabilityGrant[] {
  const result = array(value, context, path);
  result.forEach((entry, index) => grant(entry, context, `${path}[${index}]`));
  const ids = result.map((entry) => (entry as CapabilityGrant).id);
  const names = result.map((entry) => (entry as CapabilityGrant).capability);
  if (new Set(ids).size !== ids.length) fail(context, path, "must not repeat grant ids");
  if (new Set(names).size !== names.length) fail(context, path, "must not repeat capabilities");
  return result as CapabilityGrant[];
}

function track(value: unknown, context: string, path: string): void {
  const item = object(value, context, path);
  exact(item, ["id", "index", "kind", "codec", "durationMs"], context, path);
  string(item.id, context, `${path}.id`);
  integer(item.index, context, `${path}.index`);
  oneOf(item.kind, TRACK_KINDS, context, `${path}.kind`);
  string(item.codec, context, `${path}.codec`);
  if (item.durationMs !== null) integer(item.durationMs, context, `${path}.durationMs`, 1);
}

function tracks(value: unknown, context: string, path: string): void {
  const result = array(value, context, path);
  result.forEach((entry, index) => track(entry, context, `${path}[${index}]`));
  const ids = result.map((entry) => (entry as { id: string }).id);
  const indexes = result.map((entry) => (entry as { index: number }).index);
  if (new Set(ids).size !== ids.length || new Set(indexes).size !== indexes.length) {
    fail(context, path, "must contain unique track ids and indexes");
  }
}

export function assertRuntimeLimits(value: unknown, context = "Runtime limits"): asserts value is RuntimeLimits {
  const item = object(value, context, "limits");
  exact(item, ["maxDepth", "maxActiveWorkers", "runBudget", "grantableCapabilities"], context, "limits");
  integer(item.maxDepth, context, "limits.maxDepth");
  integer(item.maxActiveWorkers, context, "limits.maxActiveWorkers", 1);
  budget(item.runBudget, context, "limits.runBudget");
  capabilities(item.grantableCapabilities, context, "limits.grantableCapabilities");
}

export function assertSpawnRequestInput(value: unknown, context = "Spawn request"): asserts value is SpawnRequestInput {
  const item = object(value, context, "input");
  exact(
    item,
    [
      "workloadKey",
      "objective",
      "workerKind",
      "workerLabel",
      "mediaScope",
      "inputArtifactIds",
      "requiredOutputs",
      "requiredCapabilities",
      "dependencies",
      "budget",
    ],
    context,
    "input",
  );
  string(item.workloadKey, context, "input.workloadKey");
  string(item.objective, context, "input.objective");
  oneOf(item.workerKind, WORKER_KINDS, context, "input.workerKind");
  string(item.workerLabel, context, "input.workerLabel");
  scopes(item.mediaScope, context, "input.mediaScope");
  uniqueStrings(item.inputArtifactIds, context, "input.inputArtifactIds");
  outputs(item.requiredOutputs, context, "input.requiredOutputs");
  capabilities(item.requiredCapabilities, context, "input.requiredCapabilities");
  uniqueStrings(item.dependencies, context, "input.dependencies");
  budget(item.budget, context, "input.budget");
}

export function assertSourceArtifactDescriptor(
  value: unknown,
  context = "Source artifact descriptor",
): asserts value is SourceArtifactDescriptor {
  const item = object(value, context, "source");
  exact(item, ["schema", "adapterId", "sourceReceiptRef", "publication", "path", "content", "durationMs", "tracks"], context, "source");
  literal(item.schema, "studio.source-artifact.v1", context, "source.schema");
  string(item.adapterId, context, "source.adapterId");
  string(item.sourceReceiptRef, context, "source.sourceReceiptRef");
  oneOf(item.publication, new Set(["private", "public"]), context, "source.publication");
  string(item.path, context, "source.path");
  hash(item.content, context, "source.content");
  const duration = integer(item.durationMs, context, "source.durationMs", 1);
  tracks(item.tracks, context, "source.tracks");
  for (const candidate of item.tracks as Array<{ durationMs: number | null }>) {
    if (candidate.durationMs !== null && candidate.durationMs > duration + 1) {
      fail(context, "source.tracks", "contains a duration beyond the source duration");
    }
  }
}

function artifact(value: unknown, context: string, path: string): asserts value is RuntimeArtifact {
  const item = object(value, context, path);
  exact(
    item,
    [
      "schema",
      "id",
      "runId",
      "kind",
      "mediaClass",
      "publication",
      "content",
      "storageKey",
      "durationMs",
      "tracks",
      "sourceArtifactIds",
      "producerTaskId",
      "producerAgentId",
      "origin",
    ],
    context,
    path,
  );
  literal(item.schema, "studio.runtime.artifact.v1", context, `${path}.schema`);
  string(item.id, context, `${path}.id`);
  string(item.runId, context, `${path}.runId`);
  string(item.kind, context, `${path}.kind`);
  const mediaClass = oneOf<string>(item.mediaClass, new Set(["raw", "derived", "non_media"]), context, `${path}.mediaClass`);
  oneOf(item.publication, new Set(["private", "public"]), context, `${path}.publication`);
  hash(item.content, context, `${path}.content`);
  const storageKey = string(item.storageKey, context, `${path}.storageKey`);
  if (storageKey.startsWith("/") || storageKey.split("/").includes("..")) fail(context, `${path}.storageKey`, "must be a relative contained key");
  if (item.durationMs !== null) integer(item.durationMs, context, `${path}.durationMs`, 1);
  tracks(item.tracks, context, `${path}.tracks`);
  const sources = uniqueStrings(item.sourceArtifactIds, context, `${path}.sourceArtifactIds`);
  const task = nullableString(item.producerTaskId, context, `${path}.producerTaskId`);
  const agent = nullableString(item.producerAgentId, context, `${path}.producerAgentId`);
  const origin = object(item.origin, context, `${path}.origin`);
  const kind = string(origin.kind, context, `${path}.origin.kind`);
  if (kind === "ingest") {
    exact(origin, ["kind", "adapterId", "sourceReceiptRef"], context, `${path}.origin`);
    string(origin.adapterId, context, `${path}.origin.adapterId`);
    string(origin.sourceReceiptRef, context, `${path}.origin.sourceReceiptRef`);
    if (mediaClass !== "raw" || sources.length !== 0 || task !== null || agent !== null) {
      fail(context, path, "ingest artifacts must be raw and cannot claim a task producer or lineage");
    }
  } else if (kind === "media_operation") {
    exact(origin, ["kind", "operationId", "receiptId", "receiptContentId"], context, `${path}.origin`);
    string(origin.operationId, context, `${path}.origin.operationId`);
    string(origin.receiptId, context, `${path}.origin.receiptId`);
    string(origin.receiptContentId, context, `${path}.origin.receiptContentId`);
    if (mediaClass !== "derived" || sources.length === 0 || task === null || agent === null) {
      fail(context, path, "media operation artifacts require derived lineage and a task producer");
    }
  } else if (kind === "worker_output") {
    exact(origin, ["kind", "executionId", "receiptId", "receiptContentId"], context, `${path}.origin`);
    string(origin.executionId, context, `${path}.origin.executionId`);
    string(origin.receiptId, context, `${path}.origin.receiptId`);
    string(origin.receiptContentId, context, `${path}.origin.receiptContentId`);
    if (mediaClass !== "non_media" || item.durationMs !== null || (item.tracks as unknown[]).length !== 0) {
      fail(context, path, "worker output artifacts must be non-media without duration or tracks");
    }
    if (sources.length !== 0 || task === null || agent === null) {
      fail(context, path, "worker output artifacts require a task producer and cannot claim media lineage");
    }
  } else {
    fail(context, `${path}.origin.kind`, `has unknown value ${kind}`);
  }
}

export function assertRuntimeArtifact(value: unknown, context = "Runtime artifact"): asserts value is RuntimeArtifact {
  artifact(value, context, "artifact");
}

export function assertWorkerOutputEnvelope(
  value: unknown,
  context = "Worker output",
): asserts value is WorkerOutputEnvelope {
  const item = object(value, context, "envelope");
  exact(item, ["schema", "executionId", "taskId", "agentId", "output"], context, "envelope");
  literal(item.schema, "studio.worker-output.v1", context, "envelope.schema");
  string(item.executionId, context, "envelope.executionId");
  string(item.taskId, context, "envelope.taskId");
  string(item.agentId, context, "envelope.agentId");
  const output = object(item.output, context, "envelope.output");
  exact(output, ["name", "kind", "content"], context, "envelope.output");
  string(output.name, context, "envelope.output.name");
  string(output.kind, context, "envelope.output.kind");
  string(output.content, context, "envelope.output.content");
}

function task(value: unknown, context: string, path: string): asserts value is TaskRecord {
  const item = object(value, context, path);
  exact(
    item,
    [
      "id",
      "runId",
      "workloadKey",
      "objective",
      "workerKind",
      "workerLabel",
      "parentTaskId",
      "parentAgentId",
      "depth",
      "assignedAgentId",
      "ownerAgentId",
      "mediaScope",
      "inputArtifactIds",
      "requiredOutputs",
      "dependencies",
      "budget",
      "grants",
      "status",
    ],
    context,
    path,
  );
  string(item.id, context, `${path}.id`);
  string(item.runId, context, `${path}.runId`);
  string(item.workloadKey, context, `${path}.workloadKey`);
  string(item.objective, context, `${path}.objective`);
  oneOf(item.workerKind, WORKER_KINDS, context, `${path}.workerKind`);
  string(item.workerLabel, context, `${path}.workerLabel`);
  nullableString(item.parentTaskId, context, `${path}.parentTaskId`);
  nullableString(item.parentAgentId, context, `${path}.parentAgentId`);
  integer(item.depth, context, `${path}.depth`);
  string(item.assignedAgentId, context, `${path}.assignedAgentId`);
  nullableString(item.ownerAgentId, context, `${path}.ownerAgentId`);
  scopes(item.mediaScope, context, `${path}.mediaScope`);
  uniqueStrings(item.inputArtifactIds, context, `${path}.inputArtifactIds`);
  outputs(item.requiredOutputs, context, `${path}.requiredOutputs`);
  uniqueStrings(item.dependencies, context, `${path}.dependencies`);
  budget(item.budget, context, `${path}.budget`);
  grants(item.grants, context, `${path}.grants`);
  oneOf(item.status, TASK_STATUSES, context, `${path}.status`);
}

function agent(value: unknown, context: string, path: string): asserts value is AgentRecord {
  const item = object(value, context, path);
  exact(item, ["id", "taskId", "parentTaskId", "parentAgentId", "kind", "label", "grants", "status"], context, path);
  string(item.id, context, `${path}.id`);
  string(item.taskId, context, `${path}.taskId`);
  nullableString(item.parentTaskId, context, `${path}.parentTaskId`);
  nullableString(item.parentAgentId, context, `${path}.parentAgentId`);
  oneOf(item.kind, WORKER_KINDS, context, `${path}.kind`);
  string(item.label, context, `${path}.label`);
  grants(item.grants, context, `${path}.grants`);
  oneOf(item.status, AGENT_STATUSES, context, `${path}.status`);
}

export function assertMediaExtractRequest(
  value: unknown,
  context = "Media extract request",
): asserts value is MediaExtractRequest {
  const item = object(value, context, "request");
  exact(item, ["operationId", "taskId", "agentId", "artifactId", "trackId", "startMs", "endMs"], context, "request");
  string(item.operationId, context, "request.operationId");
  string(item.taskId, context, "request.taskId");
  string(item.agentId, context, "request.agentId");
  string(item.artifactId, context, "request.artifactId");
  string(item.trackId, context, "request.trackId");
  const start = integer(item.startMs, context, "request.startMs");
  const end = integer(item.endMs, context, "request.endMs", 1);
  if (end <= start) fail(context, "request", "must be a non-empty half-open range");
}

function receipt(value: unknown, context: string, path: string): asserts value is MediaOperationReceipt {
  const item = object(value, context, path);
  exact(item, ["schema", "receiptId", "operationId", "capability", "authorization", "request", "producer", "input", "output", "sourceArtifactIds"], context, path);
  literal(item.schema, "studio.media-operation.receipt.v1", context, `${path}.schema`);
  string(item.receiptId, context, `${path}.receiptId`);
  string(item.operationId, context, `${path}.operationId`);
  literal(item.capability, "media.extract", context, `${path}.capability`);
  const authorization = object(item.authorization, context, `${path}.authorization`);
  exact(authorization, ["grantId", "taskId", "agentId"], context, `${path}.authorization`);
  string(authorization.grantId, context, `${path}.authorization.grantId`);
  string(authorization.taskId, context, `${path}.authorization.taskId`);
  string(authorization.agentId, context, `${path}.authorization.agentId`);
  const request = object(item.request, context, `${path}.request`);
  exact(request, ["artifactId", "trackId", "startMs", "endMs"], context, `${path}.request`);
  string(request.artifactId, context, `${path}.request.artifactId`);
  string(request.trackId, context, `${path}.request.trackId`);
  const start = integer(request.startMs, context, `${path}.request.startMs`);
  const end = integer(request.endMs, context, `${path}.request.endMs`, 1);
  if (end <= start) fail(context, `${path}.request`, "must be a non-empty range");
  const producer = object(item.producer, context, `${path}.producer`);
  exact(producer, ["id", "version"], context, `${path}.producer`);
  literal(producer.id, "ffmpeg.audio-range-extract", context, `${path}.producer.id`);
  string(producer.version, context, `${path}.producer.version`);
  const input = object(item.input, context, `${path}.input`);
  exact(input, ["artifactId", "contentId"], context, `${path}.input`);
  string(input.artifactId, context, `${path}.input.artifactId`);
  string(input.contentId, context, `${path}.input.contentId`);
  const output = object(item.output, context, `${path}.output`);
  exact(output, ["artifactId", "contentId", "bytes", "durationMs", "trackId"], context, `${path}.output`);
  string(output.artifactId, context, `${path}.output.artifactId`);
  string(output.contentId, context, `${path}.output.contentId`);
  integer(output.bytes, context, `${path}.output.bytes`, 1);
  integer(output.durationMs, context, `${path}.output.durationMs`, 1);
  string(output.trackId, context, `${path}.output.trackId`);
  const sources = uniqueStrings(item.sourceArtifactIds, context, `${path}.sourceArtifactIds`);
  if (sources.length === 0) fail(context, `${path}.sourceArtifactIds`, "must retain lineage");
}

function executorSpanReceipt(
  value: unknown,
  context: string,
  path: string,
): asserts value is ExecutorSpanReceipt {
  const item = object(value, context, path);
  exact(
    item,
    [
      "schema",
      "receiptId",
      "executionId",
      "taskId",
      "agentId",
      "phase",
      "producer",
      "startedAt",
      "endedAt",
      "monotonicDurationMs",
      "outcome",
      "process",
      "outputArtifactIds",
      "modelUsageReceiptId",
      "failure",
    ],
    context,
    path,
  );
  literal(item.schema, "studio.executor-span.receipt.v1", context, `${path}.schema`);
  string(item.receiptId, context, `${path}.receiptId`);
  string(item.executionId, context, `${path}.executionId`);
  string(item.taskId, context, `${path}.taskId`);
  string(item.agentId, context, `${path}.agentId`);
  literal(item.phase, "active", context, `${path}.phase`);
  const producer = object(item.producer, context, `${path}.producer`);
  exact(producer, ["id", "version", "sandbox", "ephemeral"], context, `${path}.producer`);
  literal(producer.id, "codex.exec", context, `${path}.producer.id`);
  string(producer.version, context, `${path}.producer.version`);
  literal(producer.sandbox, "read-only", context, `${path}.producer.sandbox`);
  if (producer.ephemeral !== true) fail(context, `${path}.producer.ephemeral`, "must be true");
  const startedAt = isoTimestamp(item.startedAt, context, `${path}.startedAt`);
  const endedAt = isoTimestamp(item.endedAt, context, `${path}.endedAt`);
  if (Date.parse(endedAt) < Date.parse(startedAt)) fail(context, path, "cannot end before it starts");
  integer(item.monotonicDurationMs, context, `${path}.monotonicDurationMs`);
  const outcome = oneOf<string>(
    item.outcome,
    new Set(["completed", "failed", "timed_out"]),
    context,
    `${path}.outcome`,
  );
  const process = object(item.process, context, `${path}.process`);
  exact(process, ["exitCode", "signal"], context, `${path}.process`);
  const exitCode = nullableInteger(process.exitCode, context, `${path}.process.exitCode`);
  nullableString(process.signal, context, `${path}.process.signal`);
  const outputs = uniqueStrings(item.outputArtifactIds, context, `${path}.outputArtifactIds`);
  const usage = nullableString(item.modelUsageReceiptId, context, `${path}.modelUsageReceiptId`);
  const failure = nullableString(item.failure, context, `${path}.failure`);
  if (outcome === "completed" && (exitCode !== 0 || outputs.length === 0 || usage === null || failure !== null)) {
    fail(context, path, "completed spans require exit zero, outputs, measured usage, and no failure");
  }
  if (outcome !== "completed" && (outputs.length !== 0 || failure === null)) {
    fail(context, path, "unsuccessful spans require a failure and cannot claim outputs");
  }
}

function modelUsageReceipt(
  value: unknown,
  context: string,
  path: string,
): asserts value is ModelUsageReceipt {
  const item = object(value, context, path);
  exact(
    item,
    [
      "schema",
      "receiptId",
      "executionId",
      "taskId",
      "agentId",
      "producer",
      "model",
      "measured",
      "providerUnits",
      "billing",
      "rawReceipt",
    ],
    context,
    path,
  );
  literal(item.schema, "studio.model-usage.receipt.v1", context, `${path}.schema`);
  string(item.receiptId, context, `${path}.receiptId`);
  string(item.executionId, context, `${path}.executionId`);
  string(item.taskId, context, `${path}.taskId`);
  string(item.agentId, context, `${path}.agentId`);
  const producer = object(item.producer, context, `${path}.producer`);
  exact(producer, ["id", "version"], context, `${path}.producer`);
  literal(producer.id, "codex.exec", context, `${path}.producer.id`);
  string(producer.version, context, `${path}.producer.version`);
  nullableString(item.model, context, `${path}.model`);
  const measured = object(item.measured, context, `${path}.measured`);
  exact(
    measured,
    ["inputTokens", "cachedInputTokens", "outputTokens", "reasoningOutputTokens"],
    context,
    `${path}.measured`,
  );
  const input = integer(measured.inputTokens, context, `${path}.measured.inputTokens`);
  const cached = integer(measured.cachedInputTokens, context, `${path}.measured.cachedInputTokens`);
  integer(measured.outputTokens, context, `${path}.measured.outputTokens`);
  integer(measured.reasoningOutputTokens, context, `${path}.measured.reasoningOutputTokens`);
  if (cached > input) fail(context, `${path}.measured.cachedInputTokens`, "cannot exceed input tokens");
  if (item.providerUnits !== null) fail(context, `${path}.providerUnits`, "must remain null without a producer");
  const billing = object(item.billing, context, `${path}.billing`);
  exact(billing, ["amount", "currency"], context, `${path}.billing`);
  if (billing.amount !== null || billing.currency !== null) {
    fail(context, `${path}.billing`, "must remain null without a billing producer");
  }
  const raw = object(item.rawReceipt, context, `${path}.rawReceipt`);
  exact(raw, ["source", "contentId", "storageKey"], context, `${path}.rawReceipt`);
  literal(raw.source, "codex.exec.turn.completed", context, `${path}.rawReceipt.source`);
  const contentId = string(raw.contentId, context, `${path}.rawReceipt.contentId`);
  if (!/^sha256:[a-f0-9]{64}$/.test(contentId)) {
    fail(context, `${path}.rawReceipt.contentId`, "must be a SHA-256 content id");
  }
  const storageKey = string(raw.storageKey, context, `${path}.rawReceipt.storageKey`);
  if (storageKey.startsWith("/") || storageKey.split("/").includes("..")) {
    fail(context, `${path}.rawReceipt.storageKey`, "must be a relative contained key");
  }
  const digest = contentId.slice("sha256:".length);
  if (storageKey !== `objects/sha256/${digest.slice(0, 2)}/${digest}`) {
    fail(context, `${path}.rawReceipt.storageKey`, "must match the raw receipt content id");
  }
}

function report(value: unknown, context: string, path: string): asserts value is ReportRecord {
  const item = object(value, context, path);
  exact(
    item,
    [
      "id",
      "taskId",
      "agentId",
      "parentTaskId",
      "parentAgentId",
      "outputArtifactIds",
      "summary",
      "status",
      "decisionReason",
    ],
    context,
    path,
  );
  string(item.id, context, `${path}.id`);
  string(item.taskId, context, `${path}.taskId`);
  string(item.agentId, context, `${path}.agentId`);
  string(item.parentTaskId, context, `${path}.parentTaskId`);
  string(item.parentAgentId, context, `${path}.parentAgentId`);
  const artifacts = uniqueStrings(item.outputArtifactIds, context, `${path}.outputArtifactIds`);
  if (artifacts.length === 0) fail(context, `${path}.outputArtifactIds`, "must contain an output artifact");
  string(item.summary, context, `${path}.summary`);
  const status = oneOf<string>(item.status, new Set(["submitted", "accepted", "rejected"]), context, `${path}.status`);
  const reason = nullableString(item.decisionReason, context, `${path}.decisionReason`);
  if ((status === "submitted") !== (reason === null)) fail(context, path, "decision reason must match report status");
}

export function assertReportSubmitRequest(
  value: unknown,
  context = "Report submission",
): asserts value is ReportSubmitRequest {
  const item = object(value, context, "request");
  exact(item, ["taskId", "agentId", "outputArtifactIds", "summary"], context, "request");
  string(item.taskId, context, "request.taskId");
  string(item.agentId, context, "request.agentId");
  const artifacts = uniqueStrings(item.outputArtifactIds, context, "request.outputArtifactIds");
  if (artifacts.length === 0) fail(context, "request.outputArtifactIds", "must contain an output artifact");
  string(item.summary, context, "request.summary");
}

export function assertReportDecisionRequest(
  value: unknown,
  context = "Report decision",
): asserts value is ReportDecisionRequest {
  const item = object(value, context, "request");
  exact(item, ["reportId", "decidedByTaskId", "decidedByAgentId", "accepted", "reason"], context, "request");
  string(item.reportId, context, "request.reportId");
  string(item.decidedByTaskId, context, "request.decidedByTaskId");
  string(item.decidedByAgentId, context, "request.decidedByAgentId");
  boolean(item.accepted, context, "request.accepted");
  string(item.reason, context, "request.reason");
}

export function assertRuntimeEvent(value: unknown, context = "Runtime event"): asserts value is RuntimeEvent {
  const item = object(value, context, "event");
  exact(item, ["schema", "runId", "seq", "eventId", "recordedAt", "producer", "causationId", "correlationId", "type", "data"], context, "event");
  literal(item.schema, "studio.runtime.event.v1", context, "event.schema");
  string(item.runId, context, "event.runId");
  integer(item.seq, context, "event.seq", 1);
  string(item.eventId, context, "event.eventId");
  isoTimestamp(item.recordedAt, context, "event.recordedAt");
  const producer = object(item.producer, context, "event.producer");
  exact(producer, ["kind", "id"], context, "event.producer");
  oneOf(
    producer.kind,
    new Set(["scheduler", "registry", "artifact_store", "media_host", "handoff_host", "launcher"]),
    context,
    "event.producer.kind",
  );
  string(producer.id, context, "event.producer.id");
  nullableString(item.causationId, context, "event.causationId");
  nullableString(item.correlationId, context, "event.correlationId");
  const type = string(item.type, context, "event.type");
  const data = object(item.data, context, "event.data");

  if (type === "artifact.recorded") {
    exact(data, ["artifact"], context, "event.data");
    artifact(data.artifact, context, "event.data.artifact");
  } else if (type === "task.created") {
    exact(data, ["task"], context, "event.data");
    task(data.task, context, "event.data.task");
  } else if (type === "spawn.requested") {
    exact(data, ["requestId", "requestedByTaskId", "requestedByAgentId", "input"], context, "event.data");
    string(data.requestId, context, "event.data.requestId");
    string(data.requestedByTaskId, context, "event.data.requestedByTaskId");
    string(data.requestedByAgentId, context, "event.data.requestedByAgentId");
    assertSpawnRequestInput(data.input, context);
  } else if (type === "spawn.decided") {
    exact(data, ["requestId", "accepted", "rejection", "taskId", "agentId", "grants"], context, "event.data");
    string(data.requestId, context, "event.data.requestId");
    const accepted = boolean(data.accepted, context, "event.data.accepted");
    const rejection = data.rejection === null ? null : oneOf<string>(data.rejection, REJECTIONS, context, "event.data.rejection");
    const taskId = nullableString(data.taskId, context, "event.data.taskId");
    const agentId = nullableString(data.agentId, context, "event.data.agentId");
    const acceptedGrants = grants(data.grants, context, "event.data.grants");
    if (accepted && (rejection !== null || taskId === null || agentId === null || acceptedGrants.length === 0)) {
      fail(context, "event.data", "accepted decisions require identities and grants without rejection");
    }
    if (!accepted && (rejection === null || taskId !== null || agentId !== null || acceptedGrants.length !== 0)) {
      fail(context, "event.data", "rejected decisions require only a rejection");
    }
  } else if (type === "agent.registered") {
    exact(data, ["agent"], context, "event.data");
    agent(data.agent, context, "event.data.agent");
  } else if (type === "task.transitioned") {
    exact(data, ["taskId", "agentId", "status", "reason"], context, "event.data");
    string(data.taskId, context, "event.data.taskId");
    string(data.agentId, context, "event.data.agentId");
    oneOf(data.status, TASK_STATUSES, context, "event.data.status");
    nullableString(data.reason, context, "event.data.reason");
  } else if (type === "executor.started") {
    exact(data, ["executionId", "taskId", "agentId", "startedAt"], context, "event.data");
    string(data.executionId, context, "event.data.executionId");
    string(data.taskId, context, "event.data.taskId");
    string(data.agentId, context, "event.data.agentId");
    isoTimestamp(data.startedAt, context, "event.data.startedAt");
  } else if (type === "model.usage_recorded") {
    exact(data, ["receipt"], context, "event.data");
    modelUsageReceipt(data.receipt, context, "event.data.receipt");
  } else if (type === "executor.finished") {
    exact(data, ["receipt"], context, "event.data");
    executorSpanReceipt(data.receipt, context, "event.data.receipt");
  } else if (type === "media.operation_started") {
    exact(data, ["request", "grantId"], context, "event.data");
    assertMediaExtractRequest(data.request, context);
    string(data.grantId, context, "event.data.grantId");
  } else if (type === "media.operation_completed") {
    exact(data, ["operationId", "outputArtifactId", "receipt"], context, "event.data");
    string(data.operationId, context, "event.data.operationId");
    string(data.outputArtifactId, context, "event.data.outputArtifactId");
    receipt(data.receipt, context, "event.data.receipt");
  } else if (type === "media.operation_failed") {
    exact(data, ["operationId", "reason"], context, "event.data");
    string(data.operationId, context, "event.data.operationId");
    string(data.reason, context, "event.data.reason");
  } else if (type === "report.submitted") {
    exact(data, ["report"], context, "event.data");
    report(data.report, context, "event.data.report");
  } else if (type === "report.decided") {
    exact(data, ["reportId", "decidedByTaskId", "decidedByAgentId", "accepted", "reason"], context, "event.data");
    string(data.reportId, context, "event.data.reportId");
    string(data.decidedByTaskId, context, "event.data.decidedByTaskId");
    string(data.decidedByAgentId, context, "event.data.decidedByAgentId");
    boolean(data.accepted, context, "event.data.accepted");
    string(data.reason, context, "event.data.reason");
  } else {
    fail(context, "event.type", `has unknown value ${type}`);
  }
}
