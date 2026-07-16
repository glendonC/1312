import { canonicalSha256 } from "../canonicalIdentity.ts";
import type {
  CurrentRunRecognizerDescriptor,
  SemanticMediaEvidenceArtifact,
  SemanticMediaEvidenceReceipt,
  SemanticEvidenceCitationInput,
  SpeechTranscribeRequest,
  TimedTranscriptHypothesis,
} from "../model.ts";
import { SEMANTIC_EVIDENCE_LIMITS } from "../model.ts";
import {
  array,
  boolean,
  contentId,
  exact,
  fail,
  integer,
  literal,
  object,
  oneOf,
  string,
} from "./primitives.ts";

const AVAILABILITY = new Set(["available", "empty", "unavailable", "unknown"]);
const REASONS = new Set([
  "current_run_hypotheses_returned",
  "recognizer_returned_no_segments",
  "recognizer_unavailable",
  "recognizer_output_unknown",
  "segment_or_byte_ceiling",
]);

function exactValue<T>(value: unknown, expected: T, context: string, path: string): T {
  if (value !== expected) fail(context, path, `must equal ${String(expected)}`);
  return expected;
}

function pathFreeIdentity(value: unknown, context: string, path: string): string {
  const result = string(value, context, path);
  if (result.includes("/") || result.includes("\\") || result.includes("..")) {
    fail(context, path, "must be a path-free identity");
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

export function assertSpeechTranscribeRequest(
  value: unknown,
  context = "Speech transcribe request",
): asserts value is SpeechTranscribeRequest {
  const item = object(value, context, "request");
  exact(item, ["operationId", "taskId", "agentId", "artifactId", "trackId", "startMs", "endMs"], context, "request");
  pathFreeIdentity(item.operationId, context, "request.operationId");
  pathFreeIdentity(item.taskId, context, "request.taskId");
  pathFreeIdentity(item.agentId, context, "request.agentId");
  pathFreeIdentity(item.artifactId, context, "request.artifactId");
  pathFreeIdentity(item.trackId, context, "request.trackId");
  const startMs = integer(item.startMs, context, "request.startMs");
  const endMs = integer(item.endMs, context, "request.endMs", 1);
  if (endMs <= startMs) fail(context, "request", "must be a non-empty half-open range");
  if (endMs - startMs > SEMANTIC_EVIDENCE_LIMITS.maxDurationMs) {
    fail(context, "request", "exceeds the semantic evidence duration ceiling");
  }
}

export function validateCurrentRunRecognizerDescriptor(
  value: unknown,
  context: string,
  path: string,
): CurrentRunRecognizerDescriptor {
  const item = object(value, context, path);
  exact(item, ["id", "version", "model", "runtime", "configuration", "executionScope", "fixtureContentId"], context, path);
  const id = pathFreeIdentity(item.id, context, `${path}.id`);
  const version = pathFreeIdentity(item.version, context, `${path}.version`);
  const model = item.model === null ? null : pathFreeIdentity(item.model, context, `${path}.model`);
  const runtime = object(item.runtime, context, `${path}.runtime`);
  exact(runtime, ["id", "version"], context, `${path}.runtime`);
  const configuration = object(item.configuration, context, `${path}.configuration`);
  exact(configuration, ["id", "contentId", "language", "timestampMode", "segmentation"], context, `${path}.configuration`);
  const configurationBody = {
    id: pathFreeIdentity(configuration.id, context, `${path}.configuration.id`),
    language: configuration.language === null ? null : pathFreeIdentity(configuration.language, context, `${path}.configuration.language`),
    timestampMode: literal(configuration.timestampMode, "segment", context, `${path}.configuration.timestampMode`),
    segmentation: oneOf<"server_vad" | "producer_defined">(
      configuration.segmentation,
      new Set(["server_vad", "producer_defined"]),
      context,
      `${path}.configuration.segmentation`,
    ),
  };
  const configurationContentId = contentId(configuration.contentId, context, `${path}.configuration.contentId`);
  if (configurationContentId !== `sha256:${canonicalSha256(configurationBody)}`) {
    fail(context, `${path}.configuration.contentId`, "does not bind the recognizer configuration");
  }
  literal(item.executionScope, "current_run", context, `${path}.executionScope`);
  exactValue(item.fixtureContentId, null, context, `${path}.fixtureContentId`);
  return {
    id,
    version,
    model,
    runtime: {
      id: pathFreeIdentity(runtime.id, context, `${path}.runtime.id`),
      version: pathFreeIdentity(runtime.version, context, `${path}.runtime.version`),
    },
    configuration: { ...configurationBody, contentId: configurationContentId },
    executionScope: "current_run",
    fixtureContentId: null,
  };
}

function normalization(value: unknown, context: string, path: string): SemanticMediaEvidenceArtifact["normalization"] {
  const item = object(value, context, path);
  exact(item, ["audio", "text", "timing"], context, path);
  const audio = object(item.audio, context, `${path}.audio`);
  exact(audio, ["container", "codec", "channels", "sampleRateHz"], context, `${path}.audio`);
  literal(audio.container, "wav", context, `${path}.audio.container`);
  literal(audio.codec, "pcm_s16le", context, `${path}.audio.codec`);
  exactValue(audio.channels, 1, context, `${path}.audio.channels`);
  exactValue(audio.sampleRateHz, 16_000, context, `${path}.audio.sampleRateHz`);
  const text = object(item.text, context, `${path}.text`);
  exact(text, ["unicode", "whitespace", "preserveCase"], context, `${path}.text`);
  literal(text.unicode, "NFC", context, `${path}.text.unicode`);
  literal(text.whitespace, "trim_and_collapse", context, `${path}.text.whitespace`);
  exactValue(text.preserveCase, true, context, `${path}.text.preserveCase`);
  const timing = object(item.timing, context, `${path}.timing`);
  exact(timing, ["unit", "range"], context, `${path}.timing`);
  literal(timing.unit, "integer_millisecond", context, `${path}.timing.unit`);
  literal(timing.range, "half_open_absolute_source", context, `${path}.timing.range`);
  return {
    audio: { container: "wav", codec: "pcm_s16le", channels: 1, sampleRateHz: 16_000 },
    text: { unicode: "NFC", whitespace: "trim_and_collapse", preserveCase: true },
    timing: { unit: "integer_millisecond", range: "half_open_absolute_source" },
  };
}

export function validateSemanticEvidenceLimits(value: unknown, context: string, path: string): typeof SEMANTIC_EVIDENCE_LIMITS {
  const item = object(value, context, path);
  exact(item, Object.keys(SEMANTIC_EVIDENCE_LIMITS), context, path);
  for (const [key, expected] of Object.entries(SEMANTIC_EVIDENCE_LIMITS)) {
    if (item[key] !== expected) fail(context, `${path}.${key}`, `must equal ${expected}`);
  }
  return SEMANTIC_EVIDENCE_LIMITS;
}

function authorization(value: unknown, context: string, path: string): SemanticMediaEvidenceArtifact["authorization"] {
  const item = object(value, context, path);
  exact(item, ["grantId", "taskId", "agentId", "executionId", "launchClaimId"], context, path);
  return {
    grantId: pathFreeIdentity(item.grantId, context, `${path}.grantId`),
    taskId: pathFreeIdentity(item.taskId, context, `${path}.taskId`),
    agentId: pathFreeIdentity(item.agentId, context, `${path}.agentId`),
    executionId: pathFreeIdentity(item.executionId, context, `${path}.executionId`),
    launchClaimId: pathFreeIdentity(item.launchClaimId, context, `${path}.launchClaimId`),
  };
}

function source(value: unknown, context: string, path: string): SemanticMediaEvidenceArtifact["source"] {
  const item = object(value, context, path);
  exact(item, ["artifactId", "contentId", "trackId"], context, path);
  return {
    artifactId: pathFreeIdentity(item.artifactId, context, `${path}.artifactId`),
    contentId: contentId(item.contentId, context, `${path}.contentId`),
    trackId: pathFreeIdentity(item.trackId, context, `${path}.trackId`),
  };
}

export function semanticObservationId(
  operationId: string,
  observation: Omit<TimedTranscriptHypothesis, "observationId">,
): string {
  return `observation:${canonicalSha256({ operationId, ...observation })}`;
}

function observations(
  value: unknown,
  operationId: string,
  requested: { startMs: number; endMs: number },
  context: string,
  path: string,
): TimedTranscriptHypothesis[] {
  const items = array(value, context, path);
  if (items.length > SEMANTIC_EVIDENCE_LIMITS.maxSegments) fail(context, path, "exceeds the segment ceiling");
  const result = items.map((candidate, index): TimedTranscriptHypothesis => {
    const item = object(candidate, context, `${path}[${index}]`);
    exact(item, ["kind", "observationId", "range", "state", "text"], context, `${path}[${index}]`);
    literal(item.kind, "timed_transcript_hypothesis", context, `${path}[${index}].kind`);
    const observationRange = range(item.range, context, `${path}[${index}].range`);
    if (observationRange.startMs < requested.startMs || observationRange.endMs > requested.endMs) {
      fail(context, `${path}[${index}].range`, "escapes the requested range");
    }
    const state = oneOf<"available" | "unavailable" | "unknown">(
      item.state,
      new Set(["available", "unavailable", "unknown"]),
      context,
      `${path}[${index}].state`,
    );
    const text = item.text === null ? null : string(item.text, context, `${path}[${index}].text`);
    if ((state === "available") !== (text !== null)) {
      fail(context, `${path}[${index}]`, "must carry text exactly for an available hypothesis");
    }
    if (text !== null && (text !== text.normalize("NFC") || text !== text.trim() || /\s{2,}/u.test(text))) {
      fail(context, `${path}[${index}].text`, "does not satisfy the receipted normalization");
    }
    const body = { kind: "timed_transcript_hypothesis" as const, range: observationRange, state, text };
    const observationId = pathFreeIdentity(item.observationId, context, `${path}[${index}].observationId`);
    if (observationId !== semanticObservationId(operationId, body)) {
      fail(context, `${path}[${index}].observationId`, "does not bind the timed hypothesis");
    }
    return { ...body, observationId };
  });
  if (new Set(result.map((entry) => entry.observationId)).size !== result.length) {
    fail(context, path, "must not repeat observation identities");
  }
  for (let index = 1; index < result.length; index += 1) {
    const previous = result[index - 1];
    const current = result[index];
    if (current.range.startMs < previous.range.startMs ||
      (current.range.startMs === previous.range.startMs && current.range.endMs < previous.range.endMs)) {
      fail(context, `${path}[${index}]`, "must be ordered by source timing");
    }
  }
  const textBytes = result.reduce((total, entry) => total + new TextEncoder().encode(entry.text ?? "").byteLength, 0);
  if (textBytes > SEMANTIC_EVIDENCE_LIMITS.maxTextBytes) fail(context, path, "exceeds the text byte ceiling");
  return result;
}

export function semanticAvailabilityId(input: {
  operationId: string;
  state: SemanticMediaEvidenceArtifact["availability"]["state"];
  reason: SemanticMediaEvidenceArtifact["availability"]["reason"];
  truncated: boolean;
  observationIds: string[];
}): string {
  return `availability:${canonicalSha256(input)}`;
}

function availability(
  value: unknown,
  operationId: string,
  found: TimedTranscriptHypothesis[],
  context: string,
  path: string,
): SemanticMediaEvidenceArtifact["availability"] {
  const item = object(value, context, path);
  exact(item, ["id", "state", "reason", "truncated"], context, path);
  const state = oneOf<SemanticMediaEvidenceArtifact["availability"]["state"]>(item.state, AVAILABILITY, context, `${path}.state`);
  const reason = oneOf<SemanticMediaEvidenceArtifact["availability"]["reason"]>(item.reason, REASONS, context, `${path}.reason`);
  const truncated = boolean(item.truncated, context, `${path}.truncated`);
  if ((state === "available") !== (found.length > 0)) fail(context, path, "availability and observation count disagree");
  if (truncated !== (reason === "segment_or_byte_ceiling")) fail(context, path, "truncation and reason disagree");
  if (
    (!truncated && state === "available" && reason !== "current_run_hypotheses_returned") ||
    (state === "empty" && reason !== "recognizer_returned_no_segments") ||
    (state === "unavailable" && reason !== "recognizer_unavailable") ||
    (state === "unknown" && reason !== "recognizer_output_unknown")
  ) fail(context, path, "state and reason disagree");
  const id = pathFreeIdentity(item.id, context, `${path}.id`);
  const expected = semanticAvailabilityId({
    operationId,
    state,
    reason,
    truncated,
    observationIds: found.map((entry) => entry.observationId),
  });
  if (id !== expected) fail(context, `${path}.id`, "does not bind the closed availability state");
  return { id, state, reason, truncated };
}

function returnedRange(
  value: unknown,
  found: TimedTranscriptHypothesis[],
  context: string,
  path: string,
): { startMs: number; endMs: number } | null {
  const result = value === null ? null : range(value, context, path);
  const expected = found.length === 0 ? null : {
    startMs: Math.min(...found.map((entry) => entry.range.startMs)),
    endMs: Math.max(...found.map((entry) => entry.range.endMs)),
  };
  if (JSON.stringify(result) !== JSON.stringify(expected)) fail(context, path, "does not equal the returned observation bounds");
  return result;
}

export function validateSemanticMediaEvidenceArtifact(
  value: unknown,
  context = "Semantic media evidence artifact",
  path = "artifact",
): SemanticMediaEvidenceArtifact {
  const item = object(value, context, path);
  exact(item, ["schema", "operationId", "runId", "capability", "authorization", "source", "requestedRange", "returnedRange", "normalization", "producer", "limits", "availability", "observations"], context, path);
  literal(item.schema, "studio.semantic-media-evidence.v1", context, `${path}.schema`);
  const operationId = pathFreeIdentity(item.operationId, context, `${path}.operationId`);
  const requestedRange = range(item.requestedRange, context, `${path}.requestedRange`);
  if (requestedRange.endMs - requestedRange.startMs > SEMANTIC_EVIDENCE_LIMITS.maxDurationMs) {
    fail(context, `${path}.requestedRange`, "exceeds the duration ceiling");
  }
  const found = observations(item.observations, operationId, requestedRange, context, `${path}.observations`);
  return {
    schema: "studio.semantic-media-evidence.v1",
    operationId,
    runId: pathFreeIdentity(item.runId, context, `${path}.runId`),
    capability: literal(item.capability, "speech.transcribe", context, `${path}.capability`),
    authorization: authorization(item.authorization, context, `${path}.authorization`),
    source: source(item.source, context, `${path}.source`),
    requestedRange,
    returnedRange: returnedRange(item.returnedRange, found, context, `${path}.returnedRange`),
    normalization: normalization(item.normalization, context, `${path}.normalization`),
    producer: validateCurrentRunRecognizerDescriptor(item.producer, context, `${path}.producer`),
    limits: validateSemanticEvidenceLimits(item.limits, context, `${path}.limits`),
    availability: availability(item.availability, operationId, found, context, `${path}.availability`),
    observations: found,
  };
}

export function semanticReceiptId(receipt: Omit<SemanticMediaEvidenceReceipt, "receiptId">): string {
  const { schema: _schema, ...body } = receipt;
  return `receipt:${canonicalSha256(body)}`;
}

export function validateSemanticMediaEvidenceReceipt(
  value: unknown,
  context = "Semantic media evidence receipt",
  path = "receipt",
): SemanticMediaEvidenceReceipt {
  const item = object(value, context, path);
  exact(item, ["schema", "receiptId", "operationId", "capability", "authorization", "source", "request", "returnedRange", "normalization", "producer", "limits", "output", "availability", "observations", "claims"], context, path);
  literal(item.schema, "studio.semantic-media-evidence.receipt.v1", context, `${path}.schema`);
  const operationId = pathFreeIdentity(item.operationId, context, `${path}.operationId`);
  const request = range(item.request, context, `${path}.request`);
  const found = observations(item.observations, operationId, request, context, `${path}.observations`);
  const output = object(item.output, context, `${path}.output`);
  exact(output, ["artifactId", "contentId", "bytes", "schema"], context, `${path}.output`);
  const claims = object(item.claims, context, `${path}.claims`);
  exact(claims, ["accuracy", "understanding"], context, `${path}.claims`);
  const receipt: SemanticMediaEvidenceReceipt = {
    schema: "studio.semantic-media-evidence.receipt.v1",
    receiptId: pathFreeIdentity(item.receiptId, context, `${path}.receiptId`),
    operationId,
    capability: literal(item.capability, "speech.transcribe", context, `${path}.capability`),
    authorization: authorization(item.authorization, context, `${path}.authorization`),
    source: source(item.source, context, `${path}.source`),
    request,
    returnedRange: returnedRange(item.returnedRange, found, context, `${path}.returnedRange`),
    normalization: normalization(item.normalization, context, `${path}.normalization`),
    producer: validateCurrentRunRecognizerDescriptor(item.producer, context, `${path}.producer`),
    limits: validateSemanticEvidenceLimits(item.limits, context, `${path}.limits`),
    output: {
      artifactId: pathFreeIdentity(output.artifactId, context, `${path}.output.artifactId`),
      contentId: contentId(output.contentId, context, `${path}.output.contentId`),
      bytes: integer(output.bytes, context, `${path}.output.bytes`, 1),
      schema: literal(output.schema, "studio.semantic-media-evidence.v1", context, `${path}.output.schema`),
    },
    availability: availability(item.availability, operationId, found, context, `${path}.availability`),
    observations: found,
    claims: {
      accuracy: literal(claims.accuracy, "not_assessed", context, `${path}.claims.accuracy`),
      understanding: literal(claims.understanding, "not_claimed", context, `${path}.claims.understanding`),
    },
  };
  if (receipt.output.bytes > SEMANTIC_EVIDENCE_LIMITS.maxArtifactBytes) fail(context, `${path}.output.bytes`, "exceeds the artifact byte ceiling");
  const { receiptId: _receiptId, ...withoutReceiptId } = receipt;
  if (receipt.receiptId !== semanticReceiptId(withoutReceiptId)) {
    fail(context, `${path}.receiptId`, "does not bind the receipt body");
  }
  return receipt;
}

export function validateSemanticEvidenceCitationInput(
  value: unknown,
  context: string,
  path: string,
): SemanticEvidenceCitationInput {
  const item = object(value, context, path);
  exact(item, ["operationId", "artifactId", "contentId", "receiptId", "receiptContentId", "observations"], context, path);
  const citedObservations = array(item.observations, context, `${path}.observations`).map((candidate, index) => {
    const observation = object(candidate, context, `${path}.observations[${index}]`);
    exact(observation, ["observationId", "startMs", "endMs"], context, `${path}.observations[${index}]`);
    const startMs = integer(observation.startMs, context, `${path}.observations[${index}].startMs`);
    const endMs = integer(observation.endMs, context, `${path}.observations[${index}].endMs`, 1);
    if (endMs <= startMs) fail(context, `${path}.observations[${index}]`, "must cite a non-empty range");
    return {
      observationId: pathFreeIdentity(observation.observationId, context, `${path}.observations[${index}].observationId`),
      startMs,
      endMs,
    };
  });
  if (new Set(citedObservations.map((entry) => entry.observationId)).size !== citedObservations.length) {
    fail(context, `${path}.observations`, "must not repeat observation identities");
  }
  return {
    operationId: pathFreeIdentity(item.operationId, context, `${path}.operationId`),
    artifactId: pathFreeIdentity(item.artifactId, context, `${path}.artifactId`),
    contentId: contentId(item.contentId, context, `${path}.contentId`),
    receiptId: pathFreeIdentity(item.receiptId, context, `${path}.receiptId`),
    receiptContentId: contentId(item.receiptContentId, context, `${path}.receiptContentId`),
    observations: citedObservations,
  };
}
