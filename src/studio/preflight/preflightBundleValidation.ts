import type {
  LanguageRangesReceipt,
  PreflightArtifact,
  PreflightArtifactKind,
  PreflightBundle,
  PreflightBundleV1,
  PreflightSourceBinding,
  SpeechActivityReceipt,
} from "./contracts";
import type { AcousticObservations, AcousticTriageReceipt } from "../acoustic/contracts.ts";
import { validateAcousticObservations, validateAcousticReceipt } from "../acoustic/validation.ts";
import { ACOUSTIC_LIMITS } from "../acoustic/contracts.ts";

const SHA256 = /^[a-f0-9]{64}$/;
const ARTIFACT_ID = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

function fail(context: string, path: string, message: string): never {
  throw new Error(`${context}: ${path} ${message}`);
}

function record(value: unknown, context: string, path: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail(context, path, "must be an object");
  }
  return value as Record<string, unknown>;
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  context: string,
  path: string,
): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    fail(context, path, `must contain exactly ${wanted.join(", ")}`);
  }
}

function list(value: unknown, context: string, path: string): unknown[] {
  if (!Array.isArray(value)) fail(context, path, "must be an array");
  return value;
}

function text(value: unknown, context: string, path: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    fail(context, path, "must be a non-empty string");
  }
  return value;
}

function exact(value: unknown, expected: string, context: string, path: string): void {
  if (text(value, context, path) !== expected) fail(context, path, `must equal ${expected}`);
}

function positiveInteger(value: unknown, context: string, path: string): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    fail(context, path, "must be a positive safe integer");
  }
  return value as number;
}

function contentId(value: unknown, context: string, path: string): string {
  const id = text(value, context, path);
  if (!id.startsWith("sha256:") || !SHA256.test(id.slice("sha256:".length))) {
    fail(context, path, "must be a sha256:<lowercase digest> content id");
  }
  return id;
}

function artifactId(value: unknown, context: string, path: string): string {
  const id = text(value, context, path);
  if (!ARTIFACT_ID.test(id)) fail(context, path, "must be a lowercase kebab-case artifact id");
  return id;
}

function relativeArtifactPath(value: unknown, context: string, path: string): string {
  const candidate = text(value, context, path);
  if (candidate.startsWith("/") || candidate.startsWith("\\") || candidate.split(/[\\/]/).includes("..")) {
    fail(context, path, "must stay inside the preflight directory");
  }
  return candidate;
}

function artifact(
  value: unknown,
  version: "v1" | "v2" | "v3" | "v4",
  context: string,
  path: string,
): PreflightArtifact {
  const item = record(value, context, path);
  exactKeys(
    item,
    ["artifact_id", "kind", "class", "path", "content", "producer", "source_content_ids"],
    context,
    path,
  );
  artifactId(item.artifact_id, context, `${path}.artifact_id`);
  const kind = text(item.kind, context, `${path}.kind`) as PreflightArtifactKind;
  const v1Kinds: PreflightArtifactKind[] = ["raw_media", "source_receipt", "media_probe_receipt"];
  const v2Kinds: PreflightArtifactKind[] = [...v1Kinds, "detector_audio", "speech_activity_receipt"];
  const v3Kinds: PreflightArtifactKind[] = [...v2Kinds, "language_ranges_receipt"];
  const v4Kinds: PreflightArtifactKind[] = [...v3Kinds, "acoustic_observations", "acoustic_triage_receipt"];
  const registeredKinds = version === "v1" ? v1Kinds : version === "v2" ? v2Kinds : version === "v3" ? v3Kinds : v4Kinds;
  if (!registeredKinds.includes(kind)) {
    fail(context, `${path}.kind`, `has no registered ${version} artifact kind ${kind}`);
  }
  const artifactClass = text(item.class, context, `${path}.class`);
  const expectedClass = kind === "raw_media" ? "raw" : kind === "detector_audio" || kind === "acoustic_observations" ? "derived" : "receipt";
  if (artifactClass !== expectedClass) {
    fail(context, `${path}.class`, `must equal ${expectedClass} for artifact kind ${kind}`);
  }
  relativeArtifactPath(item.path, context, `${path}.path`);
  const content = record(item.content, context, `${path}.content`);
  exactKeys(content, ["id", "hash", "bytes"], context, `${path}.content`);
  const id = contentId(content.id, context, `${path}.content.id`);
  const hash = record(content.hash, context, `${path}.content.hash`);
  exactKeys(hash, ["algorithm", "digest"], context, `${path}.content.hash`);
  exact(hash.algorithm, "sha256", context, `${path}.content.hash.algorithm`);
  const digest = text(hash.digest, context, `${path}.content.hash.digest`);
  if (!SHA256.test(digest)) fail(context, `${path}.content.hash.digest`, "must be a lowercase SHA-256 digest");
  if (id !== `sha256:${digest}`) fail(context, `${path}.content.id`, "does not match its digest");
  positiveInteger(content.bytes, context, `${path}.content.bytes`);
  text(item.producer, context, `${path}.producer`);
  const sources = list(item.source_content_ids, context, `${path}.source_content_ids`).map((entry, index) =>
    contentId(entry, context, `${path}.source_content_ids[${index}]`),
  );
  if (new Set(sources).size !== sources.length) {
    fail(context, `${path}.source_content_ids`, "must not contain duplicate content ids");
  }
  return value as PreflightArtifact;
}

function oneArtifact(
  artifacts: Map<string, PreflightArtifact>,
  id: unknown,
  kind: PreflightArtifactKind,
  context: string,
  path: string,
): PreflightArtifact {
  const reference = artifactId(id, context, path);
  const found = artifacts.get(reference);
  if (!found) fail(context, path, `references missing artifact ${reference}`);
  if (found.kind !== kind) fail(context, path, `must reference a ${kind} artifact`);
  return found;
}

function exactSources(
  artifactValue: PreflightArtifact,
  expected: readonly string[],
  context: string,
  path: string,
): void {
  if (
    artifactValue.source_content_ids.length !== expected.length ||
    artifactValue.source_content_ids.some((id, index) => id !== expected[index])
  ) {
    fail(context, path, `must contain exactly ${expected.join(", ") || "no source content ids"}`);
  }
}

function commonArtifacts(
  bundle: Record<string, unknown>,
  binding: PreflightSourceBinding,
  version: "v1" | "v2" | "v3" | "v4",
  expectedCount: number,
  context: string,
): { artifacts: Map<string, PreflightArtifact>; findings: Record<string, unknown> } {
  const entries = list(bundle.artifacts, context, "bundle.artifacts").map((entry, index) =>
    artifact(entry, version, context, `bundle.artifacts[${index}]`),
  );
  if (entries.length !== expectedCount) {
    fail(
      context,
      "bundle.artifacts",
      version === "v1"
        ? "must contain the exact raw, source, and media-probe artifacts"
        : version === "v2"
          ? "must contain the exact raw, source, media-probe, detector-audio, and speech-activity artifacts"
          : version === "v3"
            ? "must contain the exact raw, source, media-probe, detector-audio, speech-activity, and language-ranges artifacts"
            : "must contain the exact v3 artifacts plus acoustic observations and their producer receipt",
    );
  }
  const artifacts = new Map(entries.map((entry) => [entry.artifact_id, entry]));
  if (artifacts.size !== entries.length) fail(context, "bundle.artifacts", "must not contain duplicate artifact ids");
  if (new Set(entries.map((entry) => entry.path)).size !== entries.length) {
    fail(context, "bundle.artifacts", "must not contain duplicate artifact paths");
  }

  const source = record(bundle.source, context, "bundle.source");
  exactKeys(source, ["receipt_id", "receipt_artifact_id", "raw_artifact_id"], context, "bundle.source");
  exact(source.receipt_id, binding.receiptId, context, "bundle.source.receipt_id");
  const raw = oneArtifact(artifacts, source.raw_artifact_id, "raw_media", context, "bundle.source.raw_artifact_id");
  const receipt = oneArtifact(
    artifacts,
    source.receipt_artifact_id,
    "source_receipt",
    context,
    "bundle.source.receipt_artifact_id",
  );
  if (raw.path !== binding.raw.path) fail(context, "bundle.source.raw_artifact_id", "does not reference the receipted raw path");
  if (raw.content.id !== binding.raw.contentId || raw.content.bytes !== binding.raw.bytes) {
    fail(context, "bundle.source.raw_artifact_id", "does not match the receipted raw content");
  }
  if (raw.producer !== binding.raw.producer) fail(context, "bundle.source.raw_artifact_id", "has the wrong raw producer");
  exactSources(raw, [], context, "bundle.source.raw_artifact_id.source_content_ids");
  if (receipt.path !== binding.receiptPath || receipt.producer !== binding.receiptProducer) {
    fail(context, "bundle.source.receipt_artifact_id", "does not match the registered source receipt producer");
  }
  exactSources(receipt, [binding.raw.contentId], context, "bundle.source.receipt_artifact_id.source_content_ids");

  const findings = record(bundle.findings, context, "bundle.findings");
  exactKeys(
    findings,
    ["container_tracks", "speech_activity", "language_ranges", "acoustic_ranges", "speaker_overlap", "complexity"],
    context,
    "bundle.findings",
  );
  const probe = oneArtifact(
    artifacts,
    findings.container_tracks,
    "media_probe_receipt",
    context,
    "bundle.findings.container_tracks",
  );
  if (
    probe.path !== binding.mediaProbe.path ||
    probe.producer !== binding.mediaProbe.producer ||
    probe.content.id !== binding.mediaProbe.contentId
  ) {
    fail(context, "bundle.findings.container_tracks", "does not match the registered media-probe receipt");
  }
  exactSources(probe, [binding.raw.contentId], context, "bundle.findings.container_tracks.source_content_ids");
  return { artifacts, findings };
}

function validateSpeechArtifacts(
  artifacts: Map<string, PreflightArtifact>,
  findings: Record<string, unknown>,
  binding: PreflightSourceBinding,
  speechActivity: SpeechActivityReceipt,
  version: "v2" | "v3" | "v4",
  context: string,
): { normalized: PreflightArtifact; speechReceipt: PreflightArtifact } {
  const expectedIds = version === "v2"
    ? ["raw-media", "source-receipt", "container-probe", "speech-detector-audio", "speech-activity"]
    : version === "v3"
      ? ["raw-media", "source-receipt", "container-probe", "speech-detector-audio", "speech-activity", "language-ranges"]
      : ["raw-media", "source-receipt", "container-probe", "speech-detector-audio", "speech-activity", "language-ranges", "acoustic-observations", "acoustic-triage"];
  if (expectedIds.some((id) => !artifacts.has(id))) {
    fail(context, "bundle.artifacts", `must use the exact ${version} artifact ids ${expectedIds.join(", ")}`);
  }
  if (version !== "v2" && Array.from(artifacts.keys()).some((id, index) => id !== expectedIds[index])) {
    fail(context, "bundle.artifacts", `must use the exact ordered ${version} artifact ids ${expectedIds.join(", ")}`);
  }
  exact(findings.speech_activity, "speech-activity", context, "bundle.findings.speech_activity");
  const normalized = oneArtifact(
    artifacts,
    "speech-detector-audio",
    "detector_audio",
    context,
    "bundle.artifacts.speech-detector-audio",
  );
  const normalizedReceipt = speechActivity.normalization.artifact;
  if (
    normalized.path !== normalizedReceipt.path ||
    normalized.content.id !== normalizedReceipt.content.id ||
    normalized.content.bytes !== normalizedReceipt.content.bytes ||
    normalized.producer !== speechActivity.producer.implementation
  ) {
    fail(context, "bundle.artifacts.speech-detector-audio", "does not match the normalized detector audio receipt");
  }
  exactSources(normalized, [binding.raw.contentId], context, "bundle.artifacts.speech-detector-audio.source_content_ids");

  const speechReceipt = oneArtifact(
    artifacts,
    findings.speech_activity,
    "speech_activity_receipt",
    context,
    "bundle.findings.speech_activity",
  );
  if (speechReceipt.path !== "speech-activity.json" || speechReceipt.producer !== speechActivity.producer.implementation) {
    fail(context, "bundle.findings.speech_activity", "does not match the registered speech-activity receipt artifact");
  }
  exactSources(
    speechReceipt,
    [binding.raw.contentId, normalized.content.id, speechActivity.producer.model.content.id],
    context,
    "bundle.findings.speech_activity.source_content_ids",
  );
  return { normalized, speechReceipt };
}

function validateV4(
  bundle: Record<string, unknown>,
  binding: PreflightSourceBinding,
  speechActivity: SpeechActivityReceipt | null | undefined,
  languageRanges: LanguageRangesReceipt | null | undefined,
  acousticObservationsValue: AcousticObservations | null | undefined,
  acousticReceiptValue: AcousticTriageReceipt | null | undefined,
  context: string,
): void {
  exact(bundle.producer, "scripts/seal-acoustic-preflight.mjs", context, "bundle.producer");
  exact(bundle.preflight_id, `preflight:${binding.raw.contentId}:speech-v1:language-v1:acoustic-v1`, context, "bundle.preflight_id");
  if (!speechActivity || !languageRanges || !acousticObservationsValue || !acousticReceiptValue) fail(context, "acousticReceipts", "are required to validate a v4 preflight bundle");
  const acousticObservations = validateAcousticObservations(acousticObservationsValue);
  const acousticReceipt = validateAcousticReceipt(acousticReceiptValue, acousticObservations);
  validateV3({
    schema: "studio.preflight-bundle.v3",
    producer: "scripts/seal-language-preflight.mjs",
    preflight_id: `preflight:${binding.raw.contentId}:speech-v1:language-v1`,
    source: bundle.source,
    artifacts: list(bundle.artifacts, context, "bundle.artifacts").slice(0, 6),
    findings: { ...(bundle.findings as Record<string, unknown>), acoustic_ranges: null },
    note: bundle.note,
  }, binding, speechActivity, languageRanges, `${context} inherited V3`);
  const { artifacts, findings } = commonArtifacts(bundle, binding, "v4", 8, context);
  const { normalized, speechReceipt } = validateSpeechArtifacts(artifacts, findings, binding, speechActivity, "v4", context);
  exact(findings.language_ranges, "language-ranges", context, "bundle.findings.language_ranges");
  const languageReceipt = oneArtifact(artifacts, findings.language_ranges, "language_ranges_receipt", context, "bundle.findings.language_ranges");
  if (
    languageReceipt.path !== "language-ranges.json" ||
    languageRanges.input.normalized_audio.content.id !== normalized.content.id ||
    languageRanges.input.speech_activity.content.id !== speechReceipt.content.id
  ) fail(context, "languageRanges.input", "does not match the indexed v4 speech lineage");
  exact(findings.acoustic_ranges, "acoustic-observations", context, "bundle.findings.acoustic_ranges");
  const observationsArtifact = oneArtifact(artifacts, findings.acoustic_ranges, "acoustic_observations", context, "bundle.findings.acoustic_ranges");
  const acousticReceiptArtifact = oneArtifact(artifacts, "acoustic-triage", "acoustic_triage_receipt", context, "bundle.artifacts.acoustic-triage");
  if (observationsArtifact.content.bytes > ACOUSTIC_LIMITS.maxObservationBytes || acousticReceiptArtifact.content.bytes > ACOUSTIC_LIMITS.maxReceiptBytes) {
    fail(context, "bundle.findings.acoustic_ranges", "exceeds the registered acoustic artifact byte limits");
  }
  if (
    observationsArtifact.path !== "acoustic-observations.json" || observationsArtifact.producer !== "scripts/detect-acoustics.mjs" ||
    acousticReceiptArtifact.path !== "acoustic-triage.json" || acousticReceiptArtifact.producer !== "scripts/detect-acoustics.mjs" ||
    acousticReceipt.output.content.id !== observationsArtifact.content.id ||
    acousticReceipt.input.media.content.id !== binding.raw.contentId ||
    acousticReceipt.input.normalizedAudio.content.id !== normalized.content.id ||
    acousticReceipt.input.speechActivity.content.id !== speechReceipt.content.id ||
    acousticObservations.source.contentId !== binding.raw.contentId
  ) fail(context, "bundle.findings.acoustic_ranges", "does not close over its source, normalized audio, observations, and separate receipt");
  const modelLineage = acousticReceipt.producer.model.files.map((file) => file.content.id);
  exactSources(observationsArtifact, [binding.raw.contentId, normalized.content.id, ...modelLineage], context, "bundle.findings.acoustic_ranges.source_content_ids");
  exactSources(acousticReceiptArtifact, [binding.raw.contentId, speechReceipt.content.id, normalized.content.id, observationsArtifact.content.id, ...modelLineage], context, "bundle.artifacts.acoustic-triage.source_content_ids");
  for (const key of ["speaker_overlap", "complexity"] as const) if (findings[key] !== null) fail(context, `bundle.findings.${key}`, "has no registered deterministic producer");
}

function validateV1(
  bundle: Record<string, unknown>,
  binding: PreflightSourceBinding,
  context: string,
): void {
  exact(bundle.producer, "scripts/preflight-owned-media.mjs", context, "bundle.producer");
  exact(bundle.preflight_id, `preflight:${binding.raw.contentId}`, context, "bundle.preflight_id");
  const { findings } = commonArtifacts(bundle, binding, "v1", 3, context);
  for (const key of ["speech_activity", "language_ranges", "acoustic_ranges", "speaker_overlap", "complexity"] as const) {
    if (findings[key] !== null) {
      fail(context, `bundle.findings.${key}`, "has no registered deterministic producer");
    }
  }
}

function validateV2(
  bundle: Record<string, unknown>,
  binding: PreflightSourceBinding,
  speechActivity: SpeechActivityReceipt | null | undefined,
  context: string,
): void {
  exact(bundle.producer, "scripts/seal-speech-preflight.mjs", context, "bundle.producer");
  exact(bundle.preflight_id, `preflight:${binding.raw.contentId}:speech-v1`, context, "bundle.preflight_id");
  if (!speechActivity) fail(context, "speechActivity", "is required to validate a v2 preflight bundle");
  if (
    speechActivity.schema !== "studio.speech-activity.v1" ||
    speechActivity.producer.id !== "silero-vad" ||
    speechActivity.producer.version !== "6.2.1" ||
    speechActivity.producer.implementation !== "scripts/detect-speech.mjs"
  ) {
    fail(context, "speechActivity.producer", "is not the registered speech-activity receipt");
  }
  if (
    speechActivity.input.media !== binding.raw.path ||
    speechActivity.input.content_id !== binding.raw.contentId ||
    speechActivity.input.bytes !== binding.raw.bytes
  ) {
    fail(context, "speechActivity.input", "does not match the receipted raw media");
  }

  const { artifacts, findings } = commonArtifacts(bundle, binding, "v2", 5, context);
  validateSpeechArtifacts(artifacts, findings, binding, speechActivity, "v2", context);
  for (const key of ["language_ranges", "acoustic_ranges", "speaker_overlap", "complexity"] as const) {
    if (findings[key] !== null) fail(context, `bundle.findings.${key}`, "has no registered deterministic producer");
  }
}

function validateV3(
  bundle: Record<string, unknown>,
  binding: PreflightSourceBinding,
  speechActivity: SpeechActivityReceipt | null | undefined,
  languageRanges: LanguageRangesReceipt | null | undefined,
  context: string,
): void {
  exact(bundle.producer, "scripts/seal-language-preflight.mjs", context, "bundle.producer");
  exact(bundle.preflight_id, `preflight:${binding.raw.contentId}:speech-v1:language-v1`, context, "bundle.preflight_id");
  if (!speechActivity) fail(context, "speechActivity", "is required to validate a v3 preflight bundle");
  if (!languageRanges) fail(context, "languageRanges", "is required to validate a v3 preflight bundle");
  if (
    speechActivity.schema !== "studio.speech-activity.v1" ||
    speechActivity.producer.id !== "silero-vad" ||
    speechActivity.producer.version !== "6.2.1" ||
    speechActivity.producer.implementation !== "scripts/detect-speech.mjs"
  ) {
    fail(context, "speechActivity.producer", "is not the registered speech-activity receipt");
  }
  if (
    speechActivity.input.media !== binding.raw.path ||
    speechActivity.input.content_id !== binding.raw.contentId ||
    speechActivity.input.bytes !== binding.raw.bytes
  ) {
    fail(context, "speechActivity.input", "does not match the receipted raw media");
  }
  if (
    languageRanges.schema !== "studio.language-ranges.v1" ||
    languageRanges.producer.id !== "whisper-language-id" ||
    languageRanges.producer.version !== "1.0.0" ||
    languageRanges.producer.implementation !== "scripts/detect-language.mjs"
  ) {
    fail(context, "languageRanges.producer", "is not the registered language-ranges receipt");
  }

  const { artifacts, findings } = commonArtifacts(bundle, binding, "v3", 6, context);
  const { normalized, speechReceipt } = validateSpeechArtifacts(
    artifacts,
    findings,
    binding,
    speechActivity,
    "v3",
    context,
  );
  exact(findings.language_ranges, "language-ranges", context, "bundle.findings.language_ranges");
  const languageReceipt = oneArtifact(
    artifacts,
    findings.language_ranges,
    "language_ranges_receipt",
    context,
    "bundle.findings.language_ranges",
  );
  if (languageReceipt.path !== "language-ranges.json" || languageReceipt.producer !== languageRanges.producer.implementation) {
    fail(context, "bundle.findings.language_ranges", "does not match the registered language-ranges receipt artifact");
  }
  if (
    languageRanges.run !== speechActivity.run ||
    languageRanges.input.normalized_audio.path !== normalized.path ||
    languageRanges.input.normalized_audio.content.id !== normalized.content.id ||
    languageRanges.input.normalized_audio.content.bytes !== normalized.content.bytes ||
    languageRanges.input.speech_activity.path !== speechReceipt.path ||
    languageRanges.input.speech_activity.content.id !== speechReceipt.content.id ||
    languageRanges.input.speech_activity.content.bytes !== speechReceipt.content.bytes
  ) {
    fail(context, "languageRanges.input", "does not match the indexed speech receipt and normalized audio");
  }
  const modelLineage = languageRanges.producer.model.files.slice(0, 5).map((file) => file.content.id);
  if (modelLineage.length !== 5) {
    fail(context, "languageRanges.producer.model.files", "must provide the five executable model lineage inputs");
  }
  exactSources(
    languageReceipt,
    [binding.raw.contentId, speechReceipt.content.id, normalized.content.id, ...modelLineage],
    context,
    "bundle.findings.language_ranges.source_content_ids",
  );
  for (const key of ["acoustic_ranges", "speaker_overlap", "complexity"] as const) {
    if (findings[key] !== null) fail(context, `bundle.findings.${key}`, "has no registered deterministic producer");
  }
}

/**
 * Validate an immutable preflight index against normalized source facts. V1 keeps its original
 * three-argument API. V2 additionally requires a separately loaded, fully validated speech receipt.
 * V3 also requires the validated language receipt so its speech input and model lineage can be
 * cross-bound without reconstructing evidence from prose or filenames.
 */
export function assertPreflightBundle(
  value: unknown,
  binding: PreflightSourceBinding,
  context?: string,
  speechActivity?: SpeechActivityReceipt | null,
  languageRanges?: LanguageRangesReceipt | null,
  acousticObservations?: AcousticObservations | null,
  acousticReceipt?: AcousticTriageReceipt | null,
): asserts value is PreflightBundle {
  const label = context ?? "Studio preflight bundle";
  const bundle = record(value, label, "bundle");
  exactKeys(bundle, ["schema", "producer", "preflight_id", "source", "artifacts", "findings", "note"], label, "bundle");
  const schema = text(bundle.schema, label, "bundle.schema");
  text(bundle.note, label, "bundle.note");
  if (schema === "studio.preflight-bundle.v1") {
    if (speechActivity || languageRanges) fail(label, "detectorReceipts", "require studio.preflight-bundle.v2 or v3");
    validateV1(bundle, binding, label);
    return;
  }
  if (schema === "studio.preflight-bundle.v2") {
    if (languageRanges) fail(label, "languageRanges", "requires studio.preflight-bundle.v3");
    validateV2(bundle, binding, speechActivity, label);
    return;
  }
  if (schema === "studio.preflight-bundle.v3") {
    if (acousticObservations || acousticReceipt) fail(label, "acousticReceipts", "require studio.preflight-bundle.v4");
    validateV3(bundle, binding, speechActivity, languageRanges, label);
    return;
  }
  if (schema === "studio.preflight-bundle.v4") {
    validateV4(bundle, binding, speechActivity, languageRanges, acousticObservations, acousticReceipt, label);
    return;
  }
  fail(label, "bundle.schema", `has no registered preflight schema ${schema}`);
}

/** Preserve the historical V1 type name for callers that deliberately accept only V1. */
export type LegacyPreflightBundle = PreflightBundleV1;
