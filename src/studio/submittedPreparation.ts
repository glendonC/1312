import {
  validateRemoteSourceResolution,
  type RemoteSourceResolutionReceipt,
} from "./sourceResolution.ts";
import { canonicalJsonLine, identifyUtf8 } from "./runtime/production/observability/hash.ts";

export const SUBMITTED_PREPARATION_POLICY = {
  id: "studio.submitted-source-selection-limit",
  version: "1",
  maximumDurationMs: 120_000,
  enforcement: "reject",
} as const;

export type SubmittedSourceLanguageIntent =
  | { mode: "automatic"; language: null }
  | { mode: "declared"; language: string };

export interface SubmittedPreparationInput {
  start: number;
  end: number;
  targetLanguage: string;
  outputDepth: "captions" | "evidence";
  speechScope: "foreground" | "all";
  includeLyrics: boolean;
  speaker: string | null;
  honorifics: "preserve" | "naturalize";
  translationStyle: "literal" | "natural";
  captionDensity: "compact" | "balanced" | "relaxed";
  slowAnalysis: boolean;
}

export interface SubmittedSourcePreparationRequest {
  schema: "studio.submitted-source-preparation-request.v1";
  requestId: string;
  content: {
    algorithm: "sha256";
    digest: string;
    contentId: string;
    bytes: number;
  };
  purpose: "configure_recorded_interface_preview";
  resolution: {
    schema: "studio.remote-source-resolution.v1";
    resolutionId: string;
    contentId: string;
  };
  range: { startMs: number; endMs: number };
  language: {
    source: SubmittedSourceLanguageIntent;
    target: string;
  };
  output: {
    depth: "captions" | "evidence";
    options: {
      speechScope: "foreground" | "all";
      includeLyrics: boolean;
      speaker: string | null;
      honorifics: "preserve" | "naturalize";
      translationStyle: "literal" | "natural";
      captionDensity: "compact" | "balanced" | "relaxed";
      slowAnalysis: boolean;
    };
  };
  policy: typeof SUBMITTED_PREPARATION_POLICY;
}

export type SubmittedPreparationState =
  | { status: "idle" | "building"; request: null; message: null }
  | { status: "ready"; request: SubmittedSourcePreparationRequest; message: null }
  | { status: "invalid"; request: null; message: string };

export class SubmittedPreparationRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SubmittedPreparationRequestError";
  }
}

function fail(message: string): never {
  throw new SubmittedPreparationRequestError(message);
}

function object(value: unknown, context: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail(`${context} is not an object.`);
  return value as Record<string, unknown>;
}

function exact(item: Record<string, unknown>, fields: readonly string[], context: string): void {
  const expected = new Set(fields);
  for (const key of Object.keys(item)) if (!expected.has(key)) fail(`${context}.${key} is not allowed.`);
  for (const field of fields) if (!(field in item)) fail(`${context}.${field} is required.`);
}

function text(value: unknown, context: string, maximum = 160): string {
  if (typeof value !== "string" || value.length === 0 || value.trim() !== value || value.length > maximum) {
    fail(`${context} is invalid.`);
  }
  return value;
}

function identity(value: unknown, context: string, prefix: string): string {
  const result = text(value, context, 180);
  if (!result.startsWith(prefix) || result.length <= prefix.length) fail(`${context} is invalid.`);
  return result;
}

function languageTag(value: unknown, context: string): string {
  const result = text(value, context, 80);
  if (!/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/.test(result)) {
    fail(`${context} must be a BCP-47 language tag.`);
  }
  return result;
}

function enumeration<const Value extends string>(
  value: unknown,
  allowed: readonly Value[],
  context: string,
): Value {
  if (typeof value !== "string" || !allowed.includes(value as Value)) fail(`${context} is invalid.`);
  return value as Value;
}

function boolean(value: unknown, context: string): boolean {
  if (typeof value !== "boolean") fail(`${context} is invalid.`);
  return value;
}

function nullableText(value: unknown, context: string): string | null {
  return value === null ? null : text(value, context);
}

function milliseconds(seconds: number, context: string): number {
  const value = Math.round(seconds * 1_000);
  if (!Number.isSafeInteger(value) || value < 0) fail(`${context} must be a non-negative time.`);
  return value;
}

function requestPayload(
  resolution: RemoteSourceResolutionReceipt,
  request: SubmittedPreparationInput,
  sourceLanguage: SubmittedSourceLanguageIntent,
) {
  const startMs = milliseconds(request.start, "Selected range start");
  const endMs = milliseconds(request.end, "Selected range end");
  if (endMs <= startMs) fail("Selected range must be non-empty.");
  if (endMs > resolution.source.durationMs) fail("Selected range exceeds the resolved video duration.");
  if (endMs - startMs > SUBMITTED_PREPARATION_POLICY.maximumDurationMs) {
    fail("Selected range exceeds the current 120-second submitted-source policy.");
  }

  let normalizedSourceLanguage: SubmittedSourceLanguageIntent;
  if (sourceLanguage.mode === "automatic" && sourceLanguage.language === null) {
    normalizedSourceLanguage = { mode: "automatic", language: null };
  } else if (sourceLanguage.mode === "declared") {
    normalizedSourceLanguage = {
      mode: "declared",
      language: languageTag(sourceLanguage.language, "Declared source language"),
    };
  } else {
    fail("Source language intent is invalid.");
  }

  return {
    schema: "studio.submitted-source-preparation-request.v1" as const,
    purpose: "configure_recorded_interface_preview" as const,
    resolution: {
      schema: resolution.schema,
      resolutionId: resolution.resolutionId,
      contentId: resolution.content.contentId,
    },
    range: { startMs, endMs },
    language: {
      source: normalizedSourceLanguage,
      target: languageTag(request.targetLanguage, "Target language"),
    },
    output: {
      depth: enumeration(request.outputDepth, ["captions", "evidence"], "Requested output depth"),
      options: {
        speechScope: enumeration(request.speechScope, ["foreground", "all"], "Speech scope"),
        includeLyrics: boolean(request.includeLyrics, "Lyrics option"),
        speaker: nullableText(request.speaker, "Speaker option"),
        honorifics: enumeration(request.honorifics, ["preserve", "naturalize"], "Honorific option"),
        translationStyle: enumeration(request.translationStyle, ["literal", "natural"], "Translation style"),
        captionDensity: enumeration(request.captionDensity, ["compact", "balanced", "relaxed"], "Caption density"),
        slowAnalysis: boolean(request.slowAnalysis, "Analysis pace option"),
      },
    },
    policy: SUBMITTED_PREPARATION_POLICY,
  };
}

/**
 * Creates an immutable UI-preparation identity. This is deliberately not a runtime-start,
 * production analysis-request, source-session, or media-processing contract.
 */
export async function createSubmittedSourcePreparationRequest(
  resolutionValue: unknown,
  request: SubmittedPreparationInput,
  sourceLanguage: SubmittedSourceLanguageIntent,
): Promise<SubmittedSourcePreparationRequest> {
  const resolution = await validateRemoteSourceResolution(resolutionValue);
  const payload = requestPayload(resolution, request, sourceLanguage);
  const content = await identifyUtf8(canonicalJsonLine(payload));
  return {
    ...payload,
    requestId: `submitted-preparation:${content.digest}`,
    content,
  };
}

export async function validateSubmittedSourcePreparationRequest(
  value: unknown,
  resolutionValue: unknown,
): Promise<SubmittedSourcePreparationRequest> {
  const resolution = await validateRemoteSourceResolution(resolutionValue);
  const item = object(value, "Submitted preparation request");
  exact(item, [
    "schema",
    "requestId",
    "content",
    "purpose",
    "resolution",
    "range",
    "language",
    "output",
    "policy",
  ], "Submitted preparation request");
  if (item.schema !== "studio.submitted-source-preparation-request.v1") fail("Submitted preparation schema is unsupported.");
  if (item.purpose !== "configure_recorded_interface_preview") fail("Submitted preparation purpose is unsupported.");

  const resolutionBinding = object(item.resolution, "Submitted preparation resolution");
  exact(resolutionBinding, ["schema", "resolutionId", "contentId"], "Submitted preparation resolution");
  if (
    resolutionBinding.schema !== resolution.schema
    || resolutionBinding.resolutionId !== resolution.resolutionId
    || resolutionBinding.contentId !== resolution.content.contentId
  ) fail("Submitted preparation resolution identity does not match its receipt.");

  const range = object(item.range, "Submitted preparation range");
  exact(range, ["startMs", "endMs"], "Submitted preparation range");
  if (!Number.isSafeInteger(range.startMs) || (range.startMs as number) < 0) fail("Submitted preparation range start is invalid.");
  if (!Number.isSafeInteger(range.endMs) || (range.endMs as number) <= (range.startMs as number)) {
    fail("Submitted preparation range is empty or invalid.");
  }
  if ((range.endMs as number) > resolution.source.durationMs) fail("Submitted preparation range exceeds the resolved duration.");

  const language = object(item.language, "Submitted preparation language");
  exact(language, ["source", "target"], "Submitted preparation language");
  const source = object(language.source, "Submitted preparation source language");
  exact(source, ["mode", "language"], "Submitted preparation source language");
  let sourceLanguage: SubmittedSourceLanguageIntent;
  if (source.mode === "automatic" && source.language === null) {
    sourceLanguage = { mode: "automatic", language: null };
  } else if (source.mode === "declared") {
    sourceLanguage = { mode: "declared", language: languageTag(source.language, "Declared source language") };
  } else {
    fail("Submitted preparation source language intent is invalid.");
  }

  const output = object(item.output, "Submitted preparation output");
  exact(output, ["depth", "options"], "Submitted preparation output");
  const outputDepth = enumeration(output.depth, ["captions", "evidence"], "Submitted preparation output depth");
  const options = object(output.options, "Submitted preparation options");
  exact(options, [
    "speechScope",
    "includeLyrics",
    "speaker",
    "honorifics",
    "translationStyle",
    "captionDensity",
    "slowAnalysis",
  ], "Submitted preparation options");
  const speechScope = enumeration(options.speechScope, ["foreground", "all"], "Submitted preparation speech scope");
  const includeLyrics = boolean(options.includeLyrics, "Submitted preparation lyrics option");
  const speaker = nullableText(options.speaker, "Submitted preparation speaker option");
  const honorifics = enumeration(options.honorifics, ["preserve", "naturalize"], "Submitted preparation honorific option");
  const translationStyle = enumeration(options.translationStyle, ["literal", "natural"], "Submitted preparation translation style");
  const captionDensity = enumeration(options.captionDensity, ["compact", "balanced", "relaxed"], "Submitted preparation caption density");
  const slowAnalysis = boolean(options.slowAnalysis, "Submitted preparation analysis pace option");

  const policy = object(item.policy, "Submitted preparation policy");
  exact(policy, ["id", "version", "maximumDurationMs", "enforcement"], "Submitted preparation policy");
  if (
    policy.id !== SUBMITTED_PREPARATION_POLICY.id
    || policy.version !== SUBMITTED_PREPARATION_POLICY.version
    || policy.maximumDurationMs !== SUBMITTED_PREPARATION_POLICY.maximumDurationMs
    || policy.enforcement !== SUBMITTED_PREPARATION_POLICY.enforcement
  ) fail("Submitted preparation policy is unsupported.");
  if ((range.endMs as number) - (range.startMs as number) > SUBMITTED_PREPARATION_POLICY.maximumDurationMs) {
    fail("Submitted preparation range exceeds the current policy.");
  }

  const payload = {
    schema: "studio.submitted-source-preparation-request.v1" as const,
    purpose: "configure_recorded_interface_preview" as const,
    resolution: {
      schema: resolution.schema,
      resolutionId: resolution.resolutionId,
      contentId: resolution.content.contentId,
    },
    range: { startMs: range.startMs as number, endMs: range.endMs as number },
    language: {
      source: sourceLanguage,
      target: languageTag(language.target, "Target language"),
    },
    output: {
      depth: outputDepth,
      options: {
        speechScope,
        includeLyrics,
        speaker,
        honorifics,
        translationStyle,
        captionDensity,
        slowAnalysis,
      },
    },
    policy: SUBMITTED_PREPARATION_POLICY,
  };
  const content = await identifyUtf8(canonicalJsonLine(payload));
  const suppliedContent = object(item.content, "Submitted preparation content");
  exact(suppliedContent, ["algorithm", "digest", "contentId", "bytes"], "Submitted preparation content");
  if (
    suppliedContent.algorithm !== content.algorithm
    || suppliedContent.digest !== content.digest
    || suppliedContent.contentId !== content.contentId
    || suppliedContent.bytes !== content.bytes
    || item.requestId !== `submitted-preparation:${content.digest}`
  ) fail("Submitted preparation content identity does not match its request.");

  return {
    ...payload,
    requestId: identity(item.requestId, "Submitted preparation request identity", "submitted-preparation:"),
    content,
  };
}
