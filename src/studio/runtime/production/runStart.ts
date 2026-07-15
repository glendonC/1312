import { readFile, realpath, writeFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

import type {
  LanguageRangesReceipt,
  PreflightBundle,
  SpeechActivityReceipt,
} from "../../preflight/contracts.ts";
import { assertPreflightBundle } from "../../preflight/preflightBundleValidation.ts";
import { assertSourceReceipts } from "../../preflight/receiptValidation.ts";
import { preflightSourceBinding } from "../../preflight/sourceAdapters.ts";
import type { MediaProbeReceipt, OwnedLocalIngestReceipt } from "../../types.ts";
import {
  assertProductionAnalysisRequest,
  assertProductionSourceSession,
  assertSourceArtifactDescriptor,
} from "./assertions.ts";
import { canonicalSha256, identifyFile } from "./artifactStore.ts";
import type {
  ContentIdentity,
  ProductionAnalysisRequest,
  ProductionSourceSession,
  RequestedSourceLanguage,
  RuntimeStartRecord,
  SourceArtifactDescriptor,
} from "./model.ts";
import { createForecastArtifact, freezeForecastArtifact } from "./forecast/planner.ts";
import { assertRuntimeStartRecord } from "./runStartValidation.ts";

const PREFLIGHT_FILES = ["preflight-v3.json", "preflight-v2.json", "preflight.json"] as const;
const TRACK_KINDS = new Set(["audio", "video", "subtitle", "data", "attachment"]);

export interface LoadedOwnedSourceSession {
  session: ProductionSourceSession;
  descriptor: SourceArtifactDescriptor;
  directory: string;
}

export interface AnalysisRequestInput {
  range: { startMs: number; endMs: number };
  requestedSource: RequestedSourceLanguage;
  targetLanguage: string;
  selectedLanguagePackId: string | null;
  outputDepth: "captions" | "evidence";
  options?: Partial<ProductionAnalysisRequest["options"]>;
}

interface StartInput {
  runId: string;
  journalId: string;
  acceptedBy: string;
  startedAt: string;
  sourceSession: ProductionSourceSession;
  sourceArtifactId: string;
  analysisRequest: ProductionAnalysisRequest;
}

function contained(root: string, candidate: string, label: string): string {
  if (!candidate || isAbsolute(candidate) || candidate.split(/[\\/]/).includes("..")) {
    throw new Error(`Local source session: ${label} must stay inside the source directory`);
  }
  const path = resolve(root, candidate);
  const inside = relative(root, path);
  if (!inside || inside.startsWith("..") || isAbsolute(inside)) {
    throw new Error(`Local source session: ${label} escapes the source directory`);
  }
  return path;
}

async function containedFile(root: string, candidate: string, label: string): Promise<string> {
  const lexicalPath = contained(root, candidate, label);
  const [realRoot, realPath] = await Promise.all([realpath(root), realpath(lexicalPath)]);
  const inside = relative(realRoot, realPath);
  if (!inside || inside.startsWith("..") || isAbsolute(inside)) {
    throw new Error(`Local source session: ${label} resolves outside the source directory`);
  }
  return realPath;
}

async function readJson(path: string, label: string): Promise<unknown> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    throw new Error(`Local source session: ${label} could not be read`, { cause: error });
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch (error) {
    throw new Error(`Local source session: ${label} is not valid JSON`, { cause: error });
  }
}

async function optionalJson(root: string, name: string): Promise<unknown | null> {
  try {
    return await readJson(await containedFile(root, name, name), name);
  } catch (error) {
    const failure = error as NodeJS.ErrnoException & { cause?: NodeJS.ErrnoException };
    if (failure.code === "ENOENT" || failure.cause?.code === "ENOENT") return null;
    throw error;
  }
}

async function selectedPreflight(root: string): Promise<{ name: string; value: unknown }> {
  for (const name of PREFLIGHT_FILES) {
    const value = await optionalJson(root, name);
    if (value !== null) return { name, value };
  }
  throw new Error("Local source session: no immutable preflight index was found");
}

function contentMatches(measured: ContentIdentity, expected: { id: string; bytes: number }, label: string): void {
  if (measured.contentId !== expected.id || measured.bytes !== expected.bytes) {
    throw new Error(`Local source session: ${label} does not match its preflight content identity`);
  }
}

/**
 * Load only producer-named files from an owned-media preflight directory. Receipt paths are
 * resolved by the host, every indexed byte is re-hashed, and no caller-supplied media path enters
 * the runtime descriptor.
 */
export async function loadOwnedSourceSession(directoryValue: string): Promise<LoadedOwnedSourceSession> {
  if (!directoryValue.trim()) throw new Error("Local source session: source directory is required");
  const directory = resolve(directoryValue);
  const sourcePath = await containedFile(directory, "source.json", "source.json");
  const probePath = await containedFile(directory, "media-probe.json", "media-probe.json");
  const sourceValue = await readJson(sourcePath, "source.json");
  const probeValue = await readJson(probePath, "media-probe.json");
  const { name: preflightName, value: preflightValue } = await selectedPreflight(directory);
  const source = sourceValue as OwnedLocalIngestReceipt;
  const probe = probeValue as MediaProbeReceipt;

  assertSourceReceipts(
    sourceValue,
    probeValue,
    {
      runId: probe.run,
      duration: probe.duration,
      media: probe.media,
      source: { kind: "owned_local" },
    },
    "Local source session receipts",
  );
  if (source.kind !== "owned_local") {
    throw new Error("Local source session: only the owned/local source adapter is supported");
  }
  const binding = preflightSourceBinding(source);
  if (!binding) throw new Error("Local source session: owned receipt has no normalized source binding");

  const preflightSchema = (preflightValue as { schema?: unknown }).schema;
  const speechValue = preflightSchema === "studio.preflight-bundle.v2" || preflightSchema === "studio.preflight-bundle.v3"
    ? await readJson(await containedFile(directory, "speech-activity.json", "speech-activity.json"), "speech-activity.json")
    : null;
  const languageValue = preflightSchema === "studio.preflight-bundle.v3"
    ? await readJson(await containedFile(directory, "language-ranges.json", "language-ranges.json"), "language-ranges.json")
    : null;
  assertPreflightBundle(
    preflightValue,
    binding,
    "Local source session preflight",
    speechValue as SpeechActivityReceipt | null,
    languageValue as LanguageRangesReceipt | null,
  );
  const preflight = preflightValue as PreflightBundle;

  const measuredArtifacts = new Map<string, ContentIdentity>();
  for (const artifact of preflight.artifacts) {
    const path = await containedFile(directory, artifact.path, `preflight artifact ${artifact.artifact_id}`);
    const measured = await identifyFile(path);
    contentMatches(measured, artifact.content, `preflight artifact ${artifact.artifact_id}`);
    measuredArtifacts.set(artifact.artifact_id, measured);
  }

  const sourceReceiptContent = measuredArtifacts.get(preflight.source.receipt_artifact_id);
  const rawContent = measuredArtifacts.get(preflight.source.raw_artifact_id);
  const probeArtifact = preflight.artifacts.find((artifact) => artifact.kind === "media_probe_receipt");
  if (!sourceReceiptContent || !rawContent || !probeArtifact) {
    throw new Error("Local source session: preflight omits its required source, raw, or probe artifact");
  }
  if (
    sourceReceiptContent.contentId !== (await identifyFile(sourcePath)).contentId ||
    rawContent.contentId !== source.content.id
  ) {
    throw new Error("Local source session: source receipt or raw bytes changed after preflight sealing");
  }
  const probeContent = measuredArtifacts.get(probeArtifact.artifact_id);
  if (!probeContent || probeContent.contentId !== source.derived_artifacts[0].content_hash) {
    throw new Error("Local source session: media probe changed after owned ingest");
  }
  const preflightContent = await identifyFile(await containedFile(directory, preflightName, preflightName));

  const languageEvidence = preflight.findings.language_ranges === null
    ? []
    : [
        measuredArtifacts.get(preflight.findings.language_ranges)?.contentId
          ?? (() => { throw new Error("Local source session: language finding has no indexed receipt"); })(),
      ];
  const sessionBody = {
    adapterId: "owned-local-source-adapter.v1" as const,
    sourceReceipt: {
      schema: "studio.ingest.owned-local.v1" as const,
      receiptId: source.receipt_id,
      contentId: sourceReceiptContent.contentId,
      rightsScope: source.rights.scope,
    },
    source: {
      contentId: rawContent.contentId,
      bytes: rawContent.bytes,
      durationMs: Math.round(probe.duration * 1_000),
    },
    mediaProbe: {
      schema: "studio.media-probe.v1" as const,
      producer: "scripts/probe-media.mjs" as const,
      contentId: probeContent.contentId,
    },
    preflight: {
      schema: preflight.schema,
      preflightId: preflight.preflight_id,
      contentId: preflightContent.contentId,
    },
    detectedLanguageEvidenceContentIds: languageEvidence,
  };
  const session: ProductionSourceSession = {
    schema: "studio.source-session.v1",
    sessionId: `source-session:${canonicalSha256({
      adapterId: sessionBody.adapterId,
      receiptId: sessionBody.sourceReceipt.receiptId,
      sourceContentId: sessionBody.source.contentId,
    })}`,
    revisionId: `source-revision:${canonicalSha256(sessionBody)}`,
    ...sessionBody,
  };
  assertProductionSourceSession(session);

  const rawPath = await containedFile(directory, source.raw_media.path, "owned raw media");
  const descriptor: SourceArtifactDescriptor = {
    schema: "studio.source-artifact.v1",
    adapterId: session.adapterId,
    sourceReceiptRef: source.receipt_id,
    publication: source.rights.scope === "redistribution" ? "public" : "private",
    path: rawPath,
    content: rawContent,
    durationMs: session.source.durationMs,
    tracks: probe.tracks.map((track) => {
      if (!TRACK_KINDS.has(track.type)) {
        throw new Error(`Local source session: media track ${track.index} has unsupported type ${track.type}`);
      }
      return {
        id: `stream:${track.index}`,
        index: track.index,
        kind: track.type as SourceArtifactDescriptor["tracks"][number]["kind"],
        codec: track.codec,
        durationMs: track.duration === undefined ? null : Math.round(track.duration * 1_000),
      };
    }),
  };
  assertSourceArtifactDescriptor(descriptor, "Local source session descriptor");
  return { session, descriptor, directory };
}

export function createProductionAnalysisRequest(
  sessionValue: unknown,
  input: AnalysisRequestInput,
): ProductionAnalysisRequest {
  assertProductionSourceSession(sessionValue);
  const session = sessionValue;
  const options: ProductionAnalysisRequest["options"] = {
    speechScope: "foreground",
    includeLyrics: false,
    speaker: null,
    honorifics: "preserve",
    translationStyle: "natural",
    captionDensity: "balanced",
    slowAnalysis: false,
    ...input.options,
  };
  const body = {
    sourceSessionId: session.sessionId,
    sourceRevisionId: session.revisionId,
    sourceContentId: session.source.contentId,
    range: { ...input.range },
    language: {
      languagePair: {
        requestedSource: structuredClone(input.requestedSource),
        targetLanguage: input.targetLanguage,
      },
      selectedLanguagePackId: input.selectedLanguagePackId,
      detectedLanguageEvidenceContentIds: [...session.detectedLanguageEvidenceContentIds],
    },
    outputDepth: input.outputDepth,
    options,
  };
  const request: ProductionAnalysisRequest = {
    schema: "studio.analysis-request.v1",
    requestId: `analysis-request:${canonicalSha256(body)}`,
    ...body,
  };
  assertProductionAnalysisRequest(request);
  if (request.range.endMs > session.source.durationMs) {
    throw new Error("Production analysis request: selected range exceeds the measured source duration");
  }
  return request;
}

/**
 * Build the first honest plan: a bounded worker-contract proof scoped to the selected source
 * range. It does not claim transcription, translation, media inspection, captions, or study work.
 */
export function createRuntimeStart(input: StartInput): RuntimeStartRecord {
  assertProductionSourceSession(input.sourceSession);
  assertProductionAnalysisRequest(input.analysisRequest);
  const operationId = `operation:contract-proof:${canonicalSha256({
    requestId: input.analysisRequest.requestId,
    range: input.analysisRequest.range,
  })}`;
  const workPlan = {
    schema: "studio.forecast.work-plan.v1" as const,
    planId: `plan:contract-proof:${canonicalSha256({ operationId })}`,
    operations: [
      {
        operationId,
        kind: "runtime.worker-contract-proof",
        range: { ...input.analysisRequest.range },
      },
    ],
  };
  const forecast = createForecastArtifact({
    artifact: {
      artifactId: input.sourceArtifactId,
      contentId: input.sourceSession.source.contentId,
      measuredDurationMs: input.sourceSession.source.durationMs,
      durationMeasurement: {
        schema: "studio.media-probe.v1",
        producer: "scripts/probe-media.mjs",
        receiptContentId: input.sourceSession.mediaProbe.contentId,
      },
    },
    range: { ...input.analysisRequest.range },
    workPlan,
  });
  const frozenForecast = freezeForecastArtifact(forecast, {
    runId: input.runId,
    acceptedBy: input.acceptedBy,
    runStartAt: input.startedAt,
  });
  const start: RuntimeStartRecord = {
    schema: "studio.runtime-start.v1",
    producer: { id: "studio.local-runtime-start", version: "1" },
    commandId: `runtime-start:${canonicalSha256({
      sourceRevisionId: input.sourceSession.revisionId,
      analysisRequestId: input.analysisRequest.requestId,
      workPlan,
    })}`,
    runtimeId: input.runId,
    journalId: input.journalId,
    sourceSession: structuredClone(input.sourceSession),
    sourceArtifactId: input.sourceArtifactId,
    analysisRequest: structuredClone(input.analysisRequest),
    workPlan,
    forecast,
    frozenForecast,
    startedAt: input.startedAt,
  };
  assertRuntimeStartRecord(start);
  return start;
}

export async function writeRuntimeStartReceipt(path: string, startValue: unknown): Promise<ContentIdentity> {
  assertRuntimeStartRecord(startValue);
  await writeFile(path, `${JSON.stringify(startValue, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
    flag: "wx",
  });
  return identifyFile(path);
}
