import { expectedTaskJobContextId } from "../jobContext.ts";
import type { TaskJobContext } from "../model.ts";
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
    "targetLanguage", "selectedLanguagePackId", "outputDepth", "detectorEvidence",
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
  if (contextIdValue !== expectedTaskJobContextId(item as unknown as TaskJobContext)) {
    fail(context, `${path}.contextId`, "does not match the immutable context body");
  }
}
