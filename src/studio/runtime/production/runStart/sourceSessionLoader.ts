import { readFile, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

import type {
  LanguageRangesReceipt,
  PreflightBundle,
  SpeechActivityReceipt,
} from "../../../preflight/contracts.ts";
import type { AcousticObservations, AcousticTriageReceipt } from "../../../acoustic/contracts.ts";
import { assertPreflightBundle } from "../../../preflight/preflightBundleValidation.ts";
import { assertSourceReceipts } from "../../../preflight/receiptValidation.ts";
import { preflightSourceBinding } from "../../../preflight/sourceAdapters.ts";
import type { MediaProbeReceipt, OwnedLocalIngestReceipt } from "../../../types.ts";
import {
  assertProductionSourceSession,
  assertSourceArtifactDescriptor,
} from "../assertions.ts";
import { canonicalSha256, identifyFile } from "../artifactStore.ts";
import type {
  ContentIdentity,
  PreflightEvidenceArtifactDescriptor,
  ProductionSourceSession,
  SourceArtifactDescriptor,
} from "../model.ts";

const PREFLIGHT_FILES = ["preflight-v4.json", "preflight-v3.json", "preflight-v2.json", "preflight.json"] as const;
const TRACK_KINDS = new Set(["audio", "video", "subtitle", "data", "attachment"]);

export interface LoadedOwnedSourceSession {
  session: ProductionSourceSession;
  descriptor: SourceArtifactDescriptor;
  operator: {
    label: string;
    rightsScope: ProductionSourceSession["sourceReceipt"]["rightsScope"];
  };
  directory: string;
  evidenceDescriptors: PreflightEvidenceArtifactDescriptor[];
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
  const speechValue = preflightSchema === "studio.preflight-bundle.v2" || preflightSchema === "studio.preflight-bundle.v3" || preflightSchema === "studio.preflight-bundle.v4"
    ? await readJson(await containedFile(directory, "speech-activity.json", "speech-activity.json"), "speech-activity.json")
    : null;
  const languageValue = preflightSchema === "studio.preflight-bundle.v3" || preflightSchema === "studio.preflight-bundle.v4"
    ? await readJson(await containedFile(directory, "language-ranges.json", "language-ranges.json"), "language-ranges.json")
    : null;
  const acousticValue = preflightSchema === "studio.preflight-bundle.v4"
    ? await readJson(await containedFile(directory, "acoustic-observations.json", "acoustic-observations.json"), "acoustic-observations.json")
    : null;
  const acousticReceiptValue = preflightSchema === "studio.preflight-bundle.v4"
    ? await readJson(await containedFile(directory, "acoustic-triage.json", "acoustic-triage.json"), "acoustic-triage.json")
    : null;
  assertPreflightBundle(
    preflightValue,
    binding,
    "Local source session preflight",
    speechValue as SpeechActivityReceipt | null,
    languageValue as LanguageRangesReceipt | null,
    acousticValue as AcousticObservations | null,
    acousticReceiptValue as AcousticTriageReceipt | null,
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

  const evidenceDescriptors: PreflightEvidenceArtifactDescriptor[] = [];
  const appendEvidence = async (
    artifactId: string | null,
    evidenceKind: PreflightEvidenceArtifactDescriptor["evidenceKind"],
  ): Promise<void> => {
    if (artifactId === null) return;
    const artifact = preflight.artifacts.find((candidate) => candidate.artifact_id === artifactId);
    const measured = measuredArtifacts.get(artifactId);
    if (!artifact || !measured) {
      throw new Error(`Local source session: ${evidenceKind} finding has no indexed receipt`);
    }
    const expectedKind = evidenceKind === "speech_activity"
      ? "speech_activity_receipt"
      : evidenceKind === "language_ranges" ? "language_ranges_receipt" : "acoustic_observations";
    if (artifact.kind !== expectedKind || artifact.class !== (evidenceKind === "acoustic_ranges" ? "derived" : "receipt")) {
      throw new Error(`Local source session: ${evidenceKind} finding is not its producer receipt`);
    }
    const acousticReceiptArtifact = evidenceKind === "acoustic_ranges"
      ? preflight.artifacts.find((candidate) => candidate.kind === "acoustic_triage_receipt")
      : null;
    const acousticReceiptMeasured = acousticReceiptArtifact ? measuredArtifacts.get(acousticReceiptArtifact.artifact_id) : null;
    if (evidenceKind === "acoustic_ranges" && (!acousticReceiptArtifact || !acousticReceiptMeasured)) {
      throw new Error("Local source session: acoustic evidence lost its separate producer receipt");
    }
    evidenceDescriptors.push({
      schema: evidenceKind === "acoustic_ranges" ? "studio.preflight-evidence-artifact.v2" : "studio.preflight-evidence-artifact.v1",
      evidenceKind,
      receiptSchema: evidenceKind === "speech_activity"
        ? "studio.speech-activity.v1"
        : evidenceKind === "language_ranges" ? "studio.language-ranges.v1" : "studio.acoustic-observations.v1",
      producerId: evidenceKind === "speech_activity" ? "silero-vad" : evidenceKind === "language_ranges" ? "whisper-language-id" : "yamnet-acoustic-triage",
      path: await containedFile(directory, artifact.path, `${evidenceKind} evidence`),
      content: measured,
      ...(acousticReceiptArtifact && acousticReceiptMeasured ? {
        producerReceiptPath: await containedFile(directory, acousticReceiptArtifact.path, "acoustic producer receipt"),
        producerReceiptContent: acousticReceiptMeasured,
      } : {}),
      preflightId: preflight.preflight_id,
      preflightContentId: preflightContent.contentId,
    });
  };
  await appendEvidence(preflight.findings.speech_activity, "speech_activity");
  await appendEvidence(preflight.findings.language_ranges, "language_ranges");
  await appendEvidence(preflight.findings.acoustic_ranges, "acoustic_ranges");

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
  return {
    session,
    descriptor,
    operator: {
      label: source.label,
      rightsScope: source.rights.scope,
    },
    directory,
    evidenceDescriptors,
  };
}
