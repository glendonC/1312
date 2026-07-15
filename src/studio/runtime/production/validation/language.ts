import type {
  LanguageJobContext,
  ProductionAnalysisRequest,
  ProductionSourceSession,
} from "../model.ts";
import {
  array,
  boolean,
  contentId,
  exact,
  fail,
  integer,
  literal,
  nullableString,
  object,
  oneOf,
  string,
  uniqueStrings,
} from "./primitives.ts";

function languageTag(value: unknown, context: string, path: string): string {
  const tag = string(value, context, path);
  if (!/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/.test(tag)) {
    fail(context, path, "must be a BCP-47 language tag");
  }
  return tag;
}

function languageContext(
  value: unknown,
  context: string,
  path: string,
): asserts value is LanguageJobContext {
  const item = object(value, context, path);
  exact(
    item,
    ["languagePair", "selectedLanguagePackId", "detectedLanguageEvidenceContentIds"],
    context,
    path,
  );
  const pair = object(item.languagePair, context, `${path}.languagePair`);
  exact(pair, ["requestedSource", "targetLanguage"], context, `${path}.languagePair`);
  const source = object(pair.requestedSource, context, `${path}.languagePair.requestedSource`);
  exact(source, ["mode", "languages", "reason"], context, `${path}.languagePair.requestedSource`);
  const mode = oneOf<string>(
    source.mode,
    new Set(["declared", "automatic", "mixed", "unknown", "withheld"]),
    context,
    `${path}.languagePair.requestedSource.mode`,
  );
  const languages = array(
    source.languages,
    context,
    `${path}.languagePair.requestedSource.languages`,
  ).map((candidate, index) =>
    languageTag(candidate, context, `${path}.languagePair.requestedSource.languages[${index}]`),
  );
  if (new Set(languages).size !== languages.length) {
    fail(context, `${path}.languagePair.requestedSource.languages`, "must not contain duplicates");
  }
  const reason = source.reason === null
    ? null
    : string(source.reason, context, `${path}.languagePair.requestedSource.reason`);
  if (mode === "declared" && (languages.length !== 1 || reason !== null)) {
    fail(
      context,
      `${path}.languagePair.requestedSource`,
      "declared source requires exactly one language and no reason",
    );
  }
  if (mode === "mixed" && (languages.length < 2 || reason !== null)) {
    fail(
      context,
      `${path}.languagePair.requestedSource`,
      "mixed source requires at least two languages and no reason",
    );
  }
  if ((mode === "automatic" || mode === "unknown") && (languages.length !== 0 || reason !== null)) {
    fail(
      context,
      `${path}.languagePair.requestedSource`,
      `${mode} source cannot carry languages or a reason`,
    );
  }
  if (mode === "withheld" && (languages.length !== 0 || reason === null)) {
    fail(
      context,
      `${path}.languagePair.requestedSource`,
      "withheld source requires only a reason",
    );
  }
  languageTag(pair.targetLanguage, context, `${path}.languagePair.targetLanguage`);
  nullableString(item.selectedLanguagePackId, context, `${path}.selectedLanguagePackId`);
  const evidence = uniqueStrings(
    item.detectedLanguageEvidenceContentIds,
    context,
    `${path}.detectedLanguageEvidenceContentIds`,
  );
  evidence.forEach((id, index) =>
    contentId(id, context, `${path}.detectedLanguageEvidenceContentIds[${index}]`),
  );
}

export function assertProductionSourceSession(
  value: unknown,
  context = "Production source session",
): asserts value is ProductionSourceSession {
  const item = object(value, context, "session");
  exact(
    item,
    [
      "schema",
      "sessionId",
      "revisionId",
      "adapterId",
      "sourceReceipt",
      "source",
      "mediaProbe",
      "preflight",
      "detectedLanguageEvidenceContentIds",
    ],
    context,
    "session",
  );
  literal(item.schema, "studio.source-session.v1", context, "session.schema");
  string(item.sessionId, context, "session.sessionId");
  string(item.revisionId, context, "session.revisionId");
  literal(item.adapterId, "owned-local-source-adapter.v1", context, "session.adapterId");

  const receipt = object(item.sourceReceipt, context, "session.sourceReceipt");
  exact(receipt, ["schema", "receiptId", "contentId", "rightsScope"], context, "session.sourceReceipt");
  literal(receipt.schema, "studio.ingest.owned-local.v1", context, "session.sourceReceipt.schema");
  string(receipt.receiptId, context, "session.sourceReceipt.receiptId");
  contentId(receipt.contentId, context, "session.sourceReceipt.contentId");
  oneOf(
    receipt.rightsScope,
    new Set(["local_processing", "redistribution"]),
    context,
    "session.sourceReceipt.rightsScope",
  );

  const source = object(item.source, context, "session.source");
  exact(source, ["contentId", "bytes", "durationMs"], context, "session.source");
  contentId(source.contentId, context, "session.source.contentId");
  integer(source.bytes, context, "session.source.bytes", 1);
  integer(source.durationMs, context, "session.source.durationMs", 1);

  const probe = object(item.mediaProbe, context, "session.mediaProbe");
  exact(probe, ["schema", "producer", "contentId"], context, "session.mediaProbe");
  literal(probe.schema, "studio.media-probe.v1", context, "session.mediaProbe.schema");
  literal(probe.producer, "scripts/probe-media.mjs", context, "session.mediaProbe.producer");
  contentId(probe.contentId, context, "session.mediaProbe.contentId");

  const preflight = object(item.preflight, context, "session.preflight");
  exact(preflight, ["schema", "preflightId", "contentId"], context, "session.preflight");
  oneOf(
    preflight.schema,
    new Set(["studio.preflight-bundle.v1", "studio.preflight-bundle.v2", "studio.preflight-bundle.v3"]),
    context,
    "session.preflight.schema",
  );
  string(preflight.preflightId, context, "session.preflight.preflightId");
  contentId(preflight.contentId, context, "session.preflight.contentId");

  const evidence = uniqueStrings(
    item.detectedLanguageEvidenceContentIds,
    context,
    "session.detectedLanguageEvidenceContentIds",
  );
  evidence.forEach((id, index) =>
    contentId(id, context, `session.detectedLanguageEvidenceContentIds[${index}]`),
  );
  if (preflight.schema !== "studio.preflight-bundle.v3" && evidence.length !== 0) {
    fail(
      context,
      "session.detectedLanguageEvidenceContentIds",
      "requires a V3 preflight bundle",
    );
  }
}

export function assertProductionAnalysisRequest(
  value: unknown,
  context = "Production analysis request",
): asserts value is ProductionAnalysisRequest {
  const item = object(value, context, "request");
  exact(
    item,
    [
      "schema",
      "requestId",
      "sourceSessionId",
      "sourceRevisionId",
      "sourceContentId",
      "range",
      "language",
      "outputDepth",
      "options",
    ],
    context,
    "request",
  );
  literal(item.schema, "studio.analysis-request.v1", context, "request.schema");
  string(item.requestId, context, "request.requestId");
  string(item.sourceSessionId, context, "request.sourceSessionId");
  string(item.sourceRevisionId, context, "request.sourceRevisionId");
  contentId(item.sourceContentId, context, "request.sourceContentId");
  const selected = object(item.range, context, "request.range");
  exact(selected, ["startMs", "endMs"], context, "request.range");
  const startMs = integer(selected.startMs, context, "request.range.startMs");
  const endMs = integer(selected.endMs, context, "request.range.endMs", 1);
  if (endMs <= startMs) fail(context, "request.range", "must be a non-empty half-open range");
  languageContext(item.language, context, "request.language");
  oneOf(item.outputDepth, new Set(["captions", "evidence"]), context, "request.outputDepth");

  const options = object(item.options, context, "request.options");
  exact(
    options,
    [
      "speechScope",
      "includeLyrics",
      "speaker",
      "honorifics",
      "translationStyle",
      "captionDensity",
      "slowAnalysis",
    ],
    context,
    "request.options",
  );
  oneOf(options.speechScope, new Set(["foreground", "all"]), context, "request.options.speechScope");
  boolean(options.includeLyrics, context, "request.options.includeLyrics");
  nullableString(options.speaker, context, "request.options.speaker");
  oneOf(
    options.honorifics,
    new Set(["preserve", "naturalize"]),
    context,
    "request.options.honorifics",
  );
  oneOf(
    options.translationStyle,
    new Set(["literal", "natural"]),
    context,
    "request.options.translationStyle",
  );
  oneOf(
    options.captionDensity,
    new Set(["compact", "balanced", "relaxed"]),
    context,
    "request.options.captionDensity",
  );
  boolean(options.slowAnalysis, context, "request.options.slowAnalysis");
}
