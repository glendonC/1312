import type {
  PreflightEvidenceArtifactDescriptor,
  SourceArtifactDescriptor,
} from "../model.ts";
import { contentId, exact, fail, hash, integer, literal, object, oneOf, string } from "./primitives.ts";
import { validateTracks } from "./scheduling.ts";

export function assertSourceArtifactDescriptor(
  value: unknown,
  context = "Source artifact descriptor",
): asserts value is SourceArtifactDescriptor {
  const item = object(value, context, "source");
  exact(
    item,
    [
      "schema",
      "adapterId",
      "sourceReceiptRef",
      "publication",
      "path",
      "content",
      "durationMs",
      "tracks",
    ],
    context,
    "source",
  );
  literal(item.schema, "studio.source-artifact.v1", context, "source.schema");
  string(item.adapterId, context, "source.adapterId");
  string(item.sourceReceiptRef, context, "source.sourceReceiptRef");
  oneOf(item.publication, new Set(["private", "public"]), context, "source.publication");
  string(item.path, context, "source.path");
  hash(item.content, context, "source.content");
  const duration = integer(item.durationMs, context, "source.durationMs", 1);
  validateTracks(item.tracks, context, "source.tracks");
  for (const candidate of item.tracks as Array<{ durationMs: number | null }>) {
    if (candidate.durationMs !== null && candidate.durationMs > duration + 1) {
      fail(context, "source.tracks", "contains a duration beyond the source duration");
    }
  }
}

export function assertPreflightEvidenceArtifactDescriptor(
  value: unknown,
  context = "Preflight evidence artifact descriptor",
): asserts value is PreflightEvidenceArtifactDescriptor {
  const item = object(value, context, "evidence");
  const descriptorSchema = oneOf(item.schema, new Set(["studio.preflight-evidence-artifact.v1", "studio.preflight-evidence-artifact.v2"]), context, "evidence.schema");
  exact(
    item,
    descriptorSchema === "studio.preflight-evidence-artifact.v2" ? [
      "schema", "evidenceKind", "receiptSchema", "producerId", "path", "content", "producerReceiptPath", "producerReceiptContent", "preflightId", "preflightContentId",
    ] : [
      "schema",
      "evidenceKind",
      "receiptSchema",
      "producerId",
      "path",
      "content",
      "preflightId",
      "preflightContentId",
    ],
    context,
    "evidence",
  );
  const evidenceKind = oneOf(
    item.evidenceKind,
    new Set(["speech_activity", "language_ranges", "acoustic_ranges"]),
    context,
    "evidence.evidenceKind",
  );
  const receiptSchema = oneOf(
    item.receiptSchema,
    new Set(["studio.speech-activity.v1", "studio.language-ranges.v1", "studio.acoustic-observations.v1"]),
    context,
    "evidence.receiptSchema",
  );
  const producerId = oneOf(
    item.producerId,
    new Set(["silero-vad", "whisper-language-id", "yamnet-acoustic-triage"]),
    context,
    "evidence.producerId",
  );
  if (
    (evidenceKind === "speech_activity" &&
      (receiptSchema !== "studio.speech-activity.v1" || producerId !== "silero-vad")) ||
    (evidenceKind === "language_ranges" &&
      (receiptSchema !== "studio.language-ranges.v1" || producerId !== "whisper-language-id")) ||
    (evidenceKind === "acoustic_ranges" &&
      (descriptorSchema !== "studio.preflight-evidence-artifact.v2" || receiptSchema !== "studio.acoustic-observations.v1" || producerId !== "yamnet-acoustic-triage")) ||
    (descriptorSchema === "studio.preflight-evidence-artifact.v2" && evidenceKind !== "acoustic_ranges")
  ) {
    fail(context, "evidence", "kind, receipt schema, and pinned producer must agree");
  }
  string(item.path, context, "evidence.path");
  hash(item.content, context, "evidence.content");
  if (descriptorSchema === "studio.preflight-evidence-artifact.v2") {
    string(item.producerReceiptPath, context, "evidence.producerReceiptPath");
    hash(item.producerReceiptContent, context, "evidence.producerReceiptContent");
  }
  string(item.preflightId, context, "evidence.preflightId");
  contentId(item.preflightContentId, context, "evidence.preflightContentId");
}
