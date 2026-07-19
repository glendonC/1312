import { expectedTaskJobContextId } from "../jobContext.ts";
import type { ReviewedMemoryJobBinding, TaskJobContext } from "../model.ts";
import {
  array,
  boolean,
  contentId,
  exact,
  fail,
  integer,
  nullableString,
  object,
  oneOf,
  string,
} from "./primitives.ts";

const EVIDENCE_KINDS = new Set(["speech_activity", "language_ranges", "acoustic_ranges"]);
const MEMORY_KINDS = new Set(["glossary", "correction", "rule"]);

function reviewedMemoryBinding(
  value: unknown,
  context: string,
  path: string,
): ReviewedMemoryJobBinding {
  const item = object(value, context, path);
  exact(item, [
    "consumptionId",
    "materializationId",
    "snapshotContentId",
    "materializationReceiptContentId",
    "entryCount",
    "policy",
    "entries",
  ], context, path);
  const consumptionId = string(item.consumptionId, context, `${path}.consumptionId`);
  if (!/^memory-consumption:sha256:[a-f0-9]{64}$/.test(consumptionId)) {
    fail(context, `${path}.consumptionId`, "is malformed");
  }
  const materializationId = string(item.materializationId, context, `${path}.materializationId`);
  if (!/^memory-materialization:sha256:[a-f0-9]{64}$/.test(materializationId)) {
    fail(context, `${path}.materializationId`, "is malformed");
  }
  const snapshotContentId = string(item.snapshotContentId, context, `${path}.snapshotContentId`);
  if (snapshotContentId !== materializationId.slice("memory-materialization:".length)) {
    fail(context, `${path}.snapshotContentId`, "does not match the materialization snapshot identity");
  }
  const materializationReceiptContentId = contentId(
    item.materializationReceiptContentId,
    context,
    `${path}.materializationReceiptContentId`,
  );
  const entryCount = integer(item.entryCount, context, `${path}.entryCount`, 0);
  const policy = object(item.policy, context, `${path}.policy`);
  exact(policy, ["promotion", "legacy_unreviewed", "unavailable"], context, `${path}.policy`);
  oneOf(policy.promotion, new Set(["reviewed_materialization_only"]), context, `${path}.policy.promotion`);
  oneOf(policy.legacy_unreviewed, new Set(["excluded"]), context, `${path}.policy.legacy_unreviewed`);
  oneOf(policy.unavailable, new Set(["fail_closed"]), context, `${path}.policy.unavailable`);
  const entries = array(item.entries, context, `${path}.entries`);
  if (entries.length !== entryCount) fail(context, `${path}.entryCount`, "does not match entries length");
  const bindingEntries = entries.map((entry, index) => {
    const row = object(entry, context, `${path}.entries[${index}]`);
    exact(row, ["namespace", "kind", "key", "value", "proposalId", "decisionId"], context, `${path}.entries[${index}]`);
    return {
      namespace: string(row.namespace, context, `${path}.entries[${index}].namespace`),
      kind: oneOf<"glossary" | "correction" | "rule">(row.kind, MEMORY_KINDS, context, `${path}.entries[${index}].kind`),
      key: string(row.key, context, `${path}.entries[${index}].key`),
      value: structuredClone(row.value),
      proposalId: string(row.proposalId, context, `${path}.entries[${index}].proposalId`),
      decisionId: string(row.decisionId, context, `${path}.entries[${index}].decisionId`),
    };
  });
  return {
    consumptionId,
    materializationId,
    snapshotContentId,
    materializationReceiptContentId,
    entryCount,
    policy: {
      promotion: "reviewed_materialization_only",
      legacy_unreviewed: "excluded",
      unavailable: "fail_closed",
    },
    entries: bindingEntries,
  };
}

function languageTag(value: unknown, context: string, path: string): string {
  const result = string(value, context, path);
  if (!/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/.test(result)) {
    fail(context, path, "must be a BCP-47 language tag");
  }
  return result;
}

function range(value: unknown, context: string, path: string): { startMs: number; endMs: number } {
  const item = object(value, context, path);
  exact(item, ["startMs", "endMs"], context, path);
  const startMs = integer(item.startMs, context, `${path}.startMs`);
  const endMs = integer(item.endMs, context, `${path}.endMs`, 1);
  if (endMs <= startMs) fail(context, path, "must be a non-empty half-open range");
  return { startMs, endMs };
}

/** Browser-safe validation for the immutable task authority shared by host and client artifacts. */
export function assertTaskJobContext(
  value: unknown,
  context = "Task job context",
  path = "jobContext",
): asserts value is TaskJobContext {
  const item = object(value, context, path);
  exact(item, [
    "schema", "contextId", "source", "analysisRequest", "requestedSourceLanguagePolicy",
    "targetLanguage", "selectedLanguagePackId", "outputDepth", "detectorEvidence", "reviewedMemory",
  ], context, path);
  if (item.schema !== "studio.task-job-context.v1") fail(context, `${path}.schema`, "is unsupported");
  const contextIdValue = string(item.contextId, context, `${path}.contextId`);
  if (!/^job-context:[a-f0-9]{64}$/.test(contextIdValue)) fail(context, `${path}.contextId`, "is malformed");
  const source = object(item.source, context, `${path}.source`);
  exact(source, ["artifactId", "contentId"], context, `${path}.source`);
  string(source.artifactId, context, `${path}.source.artifactId`);
  contentId(source.contentId, context, `${path}.source.contentId`);
  const analysis = object(item.analysisRequest, context, `${path}.analysisRequest`);
  exact(analysis, ["requestId", "requestedRange", "taskRange", "options"], context, `${path}.analysisRequest`);
  string(analysis.requestId, context, `${path}.analysisRequest.requestId`);
  const requestedRange = range(analysis.requestedRange, context, `${path}.analysisRequest.requestedRange`);
  const taskRange = range(analysis.taskRange, context, `${path}.analysisRequest.taskRange`);
  if (taskRange.startMs < requestedRange.startMs || taskRange.endMs > requestedRange.endMs) {
    fail(context, `${path}.analysisRequest.taskRange`, "cannot broaden the requested range");
  }
  const options = object(analysis.options, context, `${path}.analysisRequest.options`);
  exact(options, ["speechScope", "includeLyrics", "speaker", "honorifics", "translationStyle", "captionDensity", "slowAnalysis"], context, `${path}.analysisRequest.options`);
  oneOf(options.speechScope, new Set(["foreground", "all"]), context, `${path}.analysisRequest.options.speechScope`);
  boolean(options.includeLyrics, context, `${path}.analysisRequest.options.includeLyrics`);
  nullableString(options.speaker, context, `${path}.analysisRequest.options.speaker`);
  oneOf(options.honorifics, new Set(["preserve", "naturalize"]), context, `${path}.analysisRequest.options.honorifics`);
  oneOf(options.translationStyle, new Set(["literal", "natural"]), context, `${path}.analysisRequest.options.translationStyle`);
  oneOf(options.captionDensity, new Set(["compact", "balanced", "relaxed"]), context, `${path}.analysisRequest.options.captionDensity`);
  boolean(options.slowAnalysis, context, `${path}.analysisRequest.options.slowAnalysis`);
  const requestedSource = object(item.requestedSourceLanguagePolicy, context, `${path}.requestedSourceLanguagePolicy`);
  exact(requestedSource, ["mode", "languages", "reason"], context, `${path}.requestedSourceLanguagePolicy`);
  const mode = oneOf<string>(requestedSource.mode, new Set(["declared", "automatic", "mixed", "unknown", "withheld"]), context, `${path}.requestedSourceLanguagePolicy.mode`);
  const languages = array(requestedSource.languages, context, `${path}.requestedSourceLanguagePolicy.languages`).map((entry, index) => languageTag(entry, context, `${path}.requestedSourceLanguagePolicy.languages[${index}]`));
  if (new Set(languages).size !== languages.length) fail(context, `${path}.requestedSourceLanguagePolicy.languages`, "must not repeat languages");
  const reason = requestedSource.reason === null ? null : string(requestedSource.reason, context, `${path}.requestedSourceLanguagePolicy.reason`);
  if (mode === "declared" && (languages.length !== 1 || reason !== null)) fail(context, `${path}.requestedSourceLanguagePolicy`, "declared mode is malformed");
  if (mode === "mixed" && (languages.length < 2 || reason !== null)) fail(context, `${path}.requestedSourceLanguagePolicy`, "mixed mode is malformed");
  if ((mode === "automatic" || mode === "unknown") && (languages.length !== 0 || reason !== null)) fail(context, `${path}.requestedSourceLanguagePolicy`, `${mode} mode is malformed`);
  if (mode === "withheld" && (languages.length !== 0 || reason === null)) fail(context, `${path}.requestedSourceLanguagePolicy`, "withheld mode is malformed");
  languageTag(item.targetLanguage, context, `${path}.targetLanguage`);
  nullableString(item.selectedLanguagePackId, context, `${path}.selectedLanguagePackId`);
  oneOf(item.outputDepth, new Set(["captions", "evidence"]), context, `${path}.outputDepth`);
  const evidence = array(item.detectorEvidence, context, `${path}.detectorEvidence`);
  const evidenceIds: string[] = [];
  for (const [index, entry] of evidence.entries()) {
    const evidenceItem = object(entry, context, `${path}.detectorEvidence[${index}]`);
    exact(evidenceItem, ["artifactId", "contentId", "evidenceKind"], context, `${path}.detectorEvidence[${index}]`);
    evidenceIds.push(string(evidenceItem.artifactId, context, `${path}.detectorEvidence[${index}].artifactId`));
    contentId(evidenceItem.contentId, context, `${path}.detectorEvidence[${index}].contentId`);
    oneOf(evidenceItem.evidenceKind, EVIDENCE_KINDS, context, `${path}.detectorEvidence[${index}].evidenceKind`);
  }
  if (new Set(evidenceIds).size !== evidenceIds.length) fail(context, `${path}.detectorEvidence`, "must not repeat artifacts");
  if (item.reviewedMemory !== null) {
    reviewedMemoryBinding(item.reviewedMemory, context, `${path}.reviewedMemory`);
  }
  if (contextIdValue !== expectedTaskJobContextId(item as unknown as TaskJobContext)) {
    fail(context, `${path}.contextId`, "does not match the immutable context body");
  }
}
