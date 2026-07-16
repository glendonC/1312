import type { ExecutorSpanReceipt, ModelUsageReceipt } from "../model.ts";
import {
  exact,
  fail,
  integer,
  isoTimestamp,
  literal,
  nullableInteger,
  nullableString,
  object,
  oneOf,
  string,
  uniqueStrings,
} from "./primitives.ts";

export function validateExecutorSpanReceipt(
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
  const producerId = oneOf<string>(
    producer.id,
    new Set(["codex.exec", "studio.deterministic-test-executor"]),
    context,
    `${path}.producer.id`,
  );
  if (producerId === "studio.deterministic-test-executor") {
    literal(producer.version, "1", context, `${path}.producer.version`);
  } else {
    string(producer.version, context, `${path}.producer.version`);
  }
  literal(producer.sandbox, "read-only", context, `${path}.producer.sandbox`);
  if (producer.ephemeral !== true) fail(context, `${path}.producer.ephemeral`, "must be true");
  const startedAt = isoTimestamp(item.startedAt, context, `${path}.startedAt`);
  const endedAt = isoTimestamp(item.endedAt, context, `${path}.endedAt`);
  if (Date.parse(endedAt) < Date.parse(startedAt)) {
    fail(context, path, "cannot end before it starts");
  }
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
  if (outcome === "completed" && (exitCode !== 0 || failure !== null)) {
    fail(
      context,
      path,
      "completed spans require exit zero and no failure",
    );
  }
  if (outcome === "completed" && producerId === "codex.exec" && usage === null) {
    fail(context, path, "completed Codex spans require measured usage");
  }
  if (producerId === "studio.deterministic-test-executor" && usage !== null) {
    fail(context, path, "deterministic test spans cannot claim model usage");
  }
  if (outcome !== "completed" && (outputs.length !== 0 || failure === null)) {
    fail(context, path, "unsuccessful spans require a failure and cannot claim outputs");
  }
}

export function validateModelUsageReceipt(
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
  if (cached > input) {
    fail(context, `${path}.measured.cachedInputTokens`, "cannot exceed input tokens");
  }
  if (item.providerUnits !== null) {
    fail(context, `${path}.providerUnits`, "must remain null without a producer");
  }
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
