import type { ProductionAnalysisRequest } from "../model.ts";
import {
  RUNTIME_HOST_LIFECYCLE_STATES,
  type RuntimeHostCommandRecord,
  type RuntimeHostFailureReason,
  type RuntimeHostStartRequest,
} from "./model.ts";

const FAILURE_CODES = new Set<RuntimeHostFailureReason["code"]>([
  "initialization_failed",
  "executor_failed",
  "executor_interrupted",
  "host_stopped_before_start_receipt",
  "host_stopped_before_journal",
  "host_stopped_before_executor_launch",
  "executor_launch_unconfirmed",
  "nonterminal_journal_after_restart",
  "runtime_evidence_failed",
  "stored_content_inconsistent",
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

function exact(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[],
  context: string,
  path: string,
): void {
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) fail(context, `${path}.${key}`, "is not allowed");
  }
  for (const key of required) {
    if (!(key in value)) fail(context, `${path}.${key}`, "is required");
  }
}

function string(value: unknown, context: string, path: string, maximum = 256): string {
  if (typeof value !== "string" || value.length === 0 || value.trim() !== value) {
    fail(context, path, "must be a non-empty trimmed string");
  }
  if (value.length > maximum) fail(context, path, `must contain at most ${maximum} characters`);
  return value;
}

function identity(value: unknown, context: string, path: string): string {
  const result = string(value, context, path, 160);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(result)) {
    fail(context, path, "must be a stable identity without path characters");
  }
  return result;
}

function languageTag(value: unknown, context: string, path: string): string {
  const result = string(value, context, path, 64);
  if (!/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/.test(result)) {
    fail(context, path, "must be a BCP-47 language tag");
  }
  return result;
}

function integer(value: unknown, context: string, path: string, minimum = 0): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) {
    fail(context, path, `must be a safe integer greater than or equal to ${minimum}`);
  }
  return value as number;
}

function boolean(value: unknown, context: string, path: string): boolean {
  if (typeof value !== "boolean") fail(context, path, "must be a boolean");
  return value;
}

function nullableIdentity(value: unknown, context: string, path: string): string | null {
  return value === null ? null : identity(value, context, path);
}

function requestedSourceLanguage(value: unknown, context: string, path: string): RuntimeHostStartRequest["requestedSourceLanguage"] {
  const item = object(value, context, path);
  exact(item, ["mode", "languages", "reason"], [], context, path);
  const modes = new Set(["declared", "automatic", "mixed", "unknown", "withheld"]);
  const mode = string(item.mode, context, `${path}.mode`, 16);
  if (!modes.has(mode)) fail(context, `${path}.mode`, "has an unsupported value");
  if (!Array.isArray(item.languages)) fail(context, `${path}.languages`, "must be an array");
  const languages = item.languages.map((candidate, index) => languageTag(candidate, context, `${path}.languages[${index}]`));
  if (new Set(languages).size !== languages.length) fail(context, `${path}.languages`, "must not contain duplicates");
  const reason = item.reason === null ? null : string(item.reason, context, `${path}.reason`, 256);
  if (mode === "declared" && (languages.length !== 1 || reason !== null)) {
    fail(context, path, "declared mode requires exactly one language and a null reason");
  }
  if (mode === "mixed" && (languages.length < 2 || reason !== null)) {
    fail(context, path, "mixed mode requires at least two languages and a null reason");
  }
  if ((mode === "automatic" || mode === "unknown") && (languages.length !== 0 || reason !== null)) {
    fail(context, path, `${mode} mode requires no languages and a null reason`);
  }
  if (mode === "withheld" && (languages.length !== 0 || reason === null)) {
    fail(context, path, "withheld mode requires no languages and a reason");
  }
  return { mode, languages, reason } as RuntimeHostStartRequest["requestedSourceLanguage"];
}

function options(value: unknown, context: string, path: string): Partial<ProductionAnalysisRequest["options"]> {
  const item = object(value, context, path);
  exact(item, [], [
    "speechScope",
    "includeLyrics",
    "speaker",
    "honorifics",
    "translationStyle",
    "captionDensity",
    "slowAnalysis",
  ], context, path);
  const result: Partial<ProductionAnalysisRequest["options"]> = {};
  if (item.speechScope !== undefined) {
    if (item.speechScope !== "foreground" && item.speechScope !== "all") fail(context, `${path}.speechScope`, "is unsupported");
    result.speechScope = item.speechScope;
  }
  if (item.includeLyrics !== undefined) result.includeLyrics = boolean(item.includeLyrics, context, `${path}.includeLyrics`);
  if (item.speaker !== undefined) result.speaker = item.speaker === null ? null : identity(item.speaker, context, `${path}.speaker`);
  if (item.honorifics !== undefined) {
    if (item.honorifics !== "preserve" && item.honorifics !== "naturalize") fail(context, `${path}.honorifics`, "is unsupported");
    result.honorifics = item.honorifics;
  }
  if (item.translationStyle !== undefined) {
    if (item.translationStyle !== "literal" && item.translationStyle !== "natural") fail(context, `${path}.translationStyle`, "is unsupported");
    result.translationStyle = item.translationStyle;
  }
  if (item.captionDensity !== undefined) {
    if (!["compact", "balanced", "relaxed"].includes(item.captionDensity as string)) fail(context, `${path}.captionDensity`, "is unsupported");
    result.captionDensity = item.captionDensity as ProductionAnalysisRequest["options"]["captionDensity"];
  }
  if (item.slowAnalysis !== undefined) result.slowAnalysis = boolean(item.slowAnalysis, context, `${path}.slowAnalysis`);
  return result;
}

function materializationId(value: unknown, context: string, path: string): string | null {
  if (value === null) return null;
  const result = string(value, context, path, 120);
  if (!/^memory-materialization:sha256:[a-f0-9]{64}$/.test(result)) {
    fail(context, path, "must be a memory-materialization content identity or null");
  }
  return result;
}

export function parseRuntimeHostStartRequest(value: unknown): RuntimeHostStartRequest {
  const context = "Runtime start request";
  const item = object(value, context, "request");
  exact(item, [
    "sourceSessionId",
    "sourceRevisionId",
    "range",
    "requestedSourceLanguage",
    "targetLanguage",
    "selectedLanguagePackId",
    "outputDepth",
  ], ["options", "clientRequestId", "materializationId"], context, "request");
  const range = object(item.range, context, "request.range");
  exact(range, ["startMs", "endMs"], [], context, "request.range");
  const startMs = integer(range.startMs, context, "request.range.startMs");
  const endMs = integer(range.endMs, context, "request.range.endMs", 1);
  if (endMs <= startMs) fail(context, "request.range", "must be a non-empty half-open range");
  if (item.outputDepth !== "captions" && item.outputDepth !== "evidence") {
    fail(context, "request.outputDepth", "must be captions or evidence");
  }
  return {
    sourceSessionId: identity(item.sourceSessionId, context, "request.sourceSessionId"),
    sourceRevisionId: identity(item.sourceRevisionId, context, "request.sourceRevisionId"),
    range: { startMs, endMs },
    requestedSourceLanguage: requestedSourceLanguage(item.requestedSourceLanguage, context, "request.requestedSourceLanguage"),
    targetLanguage: languageTag(item.targetLanguage, context, "request.targetLanguage"),
    selectedLanguagePackId: nullableIdentity(item.selectedLanguagePackId, context, "request.selectedLanguagePackId"),
    outputDepth: item.outputDepth,
    ...(item.options === undefined ? {} : { options: options(item.options, context, "request.options") }),
    ...(item.clientRequestId === undefined ? {} : { clientRequestId: identity(item.clientRequestId, context, "request.clientRequestId") }),
    ...(item.materializationId === undefined
      ? {}
      : { materializationId: materializationId(item.materializationId, context, "request.materializationId") }),
  };
}

function timestamp(value: unknown, context: string, path: string): string {
  const result = string(value, context, path, 64);
  const parsed = new Date(result);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== result) fail(context, path, "must be an exact ISO timestamp");
  return result;
}

function contentId(value: unknown, context: string, path: string): string {
  const result = string(value, context, path, 80);
  if (!/^sha256:[a-f0-9]{64}$/.test(result)) fail(context, path, "must be a SHA-256 content identity");
  return result;
}

export function assertRuntimeHostCommandRecord(value: unknown): asserts value is RuntimeHostCommandRecord {
  const context = "Runtime host command";
  const item = object(value, context, "command");
  exact(item, [
    "schema", "producer", "commandId", "requestContentId", "sourceSessionId", "sourceRevisionId",
    "analysisRequestId", "runtimeId", "journalId", "acceptedAt", "lifecycle", "lastTransitionAt",
    "reason", "runStartReceiptContentId", "forecastContentId", "frozenForecastId", "journalHead",
  ], [], context, "command");
  if (item.schema !== "studio.local-runtime-command.v1") fail(context, "command.schema", "is unsupported");
  const producer = object(item.producer, context, "command.producer");
  exact(producer, ["id", "version"], [], context, "command.producer");
  if (producer.id !== "studio.local-runtime-host" || producer.version !== "1") fail(context, "command.producer", "is unsupported");
  identity(item.commandId, context, "command.commandId");
  contentId(item.requestContentId, context, "command.requestContentId");
  identity(item.sourceSessionId, context, "command.sourceSessionId");
  identity(item.sourceRevisionId, context, "command.sourceRevisionId");
  identity(item.analysisRequestId, context, "command.analysisRequestId");
  identity(item.runtimeId, context, "command.runtimeId");
  identity(item.journalId, context, "command.journalId");
  timestamp(item.acceptedAt, context, "command.acceptedAt");
  if (!(RUNTIME_HOST_LIFECYCLE_STATES as readonly unknown[]).includes(item.lifecycle)) fail(context, "command.lifecycle", "is unsupported");
  timestamp(item.lastTransitionAt, context, "command.lastTransitionAt");
  if (item.reason !== null) {
    const reason = object(item.reason, context, "command.reason");
    exact(reason, ["code", "message"], [], context, "command.reason");
    if (!FAILURE_CODES.has(reason.code as RuntimeHostFailureReason["code"])) fail(context, "command.reason.code", "is unsupported");
    string(reason.message, context, "command.reason.message", 256);
  }
  if (item.runStartReceiptContentId !== null) contentId(item.runStartReceiptContentId, context, "command.runStartReceiptContentId");
  if (item.forecastContentId !== null) contentId(item.forecastContentId, context, "command.forecastContentId");
  if (item.frozenForecastId !== null) identity(item.frozenForecastId, context, "command.frozenForecastId");
  integer(item.journalHead, context, "command.journalHead");
  const receiptFields = [item.runStartReceiptContentId, item.forecastContentId, item.frozenForecastId];
  if (receiptFields.some((field) => field === null) && !receiptFields.every((field) => field === null)) {
    fail(context, "command", "must record all receipt and forecast identities together");
  }
  if ((item.lifecycle === "failed" || item.lifecycle === "interrupted") !== (item.reason !== null)) {
    fail(context, "command.reason", "must be present exactly for failed or interrupted lifecycle states");
  }
}
