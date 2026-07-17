import type {
  EvidenceFact,
  EvidenceReadReceipt,
  EvidenceReadRequest,
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
import { MAX_EVIDENCE_READ_BYTES, MAX_EVIDENCE_READ_ITEMS } from "./scheduling.ts";

const EVIDENCE_KINDS = new Set(["speech_activity", "language_ranges", "acoustic_ranges"]);
const FACT_KINDS = new Set(["speech_window", "non_speech_window", "language_range", "acoustic_range"]);
const DECISION_STATUSES = new Set(["classified", "unknown", "withheld"]);

export function assertEvidenceReadRequest(
  value: unknown,
  context = "Evidence read",
): asserts value is EvidenceReadRequest {
  const item = object(value, context, "request");
  exact(item, ["operationId", "taskId", "agentId", "artifactId"], context, "request");
  string(item.operationId, context, "request.operationId");
  string(item.taskId, context, "request.taskId");
  string(item.agentId, context, "request.agentId");
  string(item.artifactId, context, "request.artifactId");
}

function optionalFinite(value: unknown, context: string, path: string): void {
  if (value !== null && (typeof value !== "number" || !Number.isFinite(value))) {
    fail(context, path, "must be null or finite");
  }
}

function fact(value: unknown, context: string, path: string): asserts value is EvidenceFact {
  const item = object(value, context, path);
  const kind = oneOf(item.kind, FACT_KINDS, context, `${path}.kind`);
  if (kind === "speech_window" || kind === "non_speech_window") {
    exact(item, ["kind", "index", "startSample", "endSample", "startMs", "endMs"], context, path);
    integer(item.index, context, `${path}.index`);
  } else if (kind === "language_range") {
    exact(
      item,
      ["kind", "speechWindowIndex", "chunkIndex", "startSample", "endSample", "startMs", "endMs", "decision"],
      context,
      path,
    );
    integer(item.speechWindowIndex, context, `${path}.speechWindowIndex`);
    integer(item.chunkIndex, context, `${path}.chunkIndex`);
    const decision = object(item.decision, context, `${path}.decision`);
    exact(decision, ["status", "code", "probability", "margin", "reason"], context, `${path}.decision`);
    oneOf(decision.status, DECISION_STATUSES, context, `${path}.decision.status`);
    nullableString(decision.code, context, `${path}.decision.code`);
    optionalFinite(decision.probability, context, `${path}.decision.probability`);
    optionalFinite(decision.margin, context, `${path}.decision.margin`);
    nullableString(decision.reason, context, `${path}.decision.reason`);
  } else {
    exact(item, ["kind", "index", "startSample", "endSample", "startMs", "endMs", "classification", "certainty", "confidence", "reason"], context, path);
    integer(item.index, context, `${path}.index`);
    oneOf(item.classification, new Set(["speech_candidate", "music", "noise", "mixed", "unknown"]), context, `${path}.classification`);
    oneOf(item.certainty, new Set(["strong", "weak"]), context, `${path}.certainty`);
    string(item.reason, context, `${path}.reason`);
    const confidence = object(item.confidence, context, `${path}.confidence`);
    exact(confidence, ["speechCandidate", "music", "noise", "winningScore", "margin"], context, `${path}.confidence`);
    for (const key of ["speechCandidate", "music", "noise", "winningScore", "margin"]) optionalFinite(confidence[key], context, `${path}.confidence.${key}`);
    if (item.certainty === "weak" && item.classification !== "unknown") fail(context, path, "cannot upgrade weak acoustic confidence to a definite class");
  }
  const startSample = integer(item.startSample, context, `${path}.startSample`);
  const endSample = integer(item.endSample, context, `${path}.endSample`, 1);
  const startMs = integer(item.startMs, context, `${path}.startMs`);
  const endMs = integer(item.endMs, context, `${path}.endMs`, 1);
  if (endSample <= startSample || endMs <= startMs) fail(context, path, "must contain positive ranges");
}

export function validateEvidenceReadReceipt(
  value: unknown,
  context = "Evidence read receipt",
  path = "receipt",
): asserts value is EvidenceReadReceipt {
  const item = object(value, context, path);
  exact(
    item,
    ["schema", "receiptId", "operationId", "capability", "authorization", "input", "producer", "facts", "result", "lineage"],
    context,
    path,
  );
  const schema = oneOf(item.schema, new Set(["studio.evidence-read.receipt.v2", "studio.evidence-read.receipt.v3"]), context, `${path}.schema`);
  string(item.receiptId, context, `${path}.receiptId`);
  string(item.operationId, context, `${path}.operationId`);
  literal(item.capability, "evidence.read", context, `${path}.capability`);

  const authorization = object(item.authorization, context, `${path}.authorization`);
  exact(
    authorization,
    ["grantId", "taskId", "agentId", "sourceArtifactId", "startMs", "endMs", "maxBytes", "maxItems"],
    context,
    `${path}.authorization`,
  );
  string(authorization.grantId, context, `${path}.authorization.grantId`);
  string(authorization.taskId, context, `${path}.authorization.taskId`);
  string(authorization.agentId, context, `${path}.authorization.agentId`);
  const sourceArtifactId = string(
    authorization.sourceArtifactId,
    context,
    `${path}.authorization.sourceArtifactId`,
  );
  const startMs = integer(authorization.startMs, context, `${path}.authorization.startMs`);
  const endMs = integer(authorization.endMs, context, `${path}.authorization.endMs`, 1);
  if (endMs <= startMs) fail(context, `${path}.authorization`, "must contain a non-empty source window");
  const maxBytes = integer(authorization.maxBytes, context, `${path}.authorization.maxBytes`, 1);
  const maxItems = integer(authorization.maxItems, context, `${path}.authorization.maxItems`, 1);
  if (maxBytes > MAX_EVIDENCE_READ_BYTES || maxItems > MAX_EVIDENCE_READ_ITEMS) {
    fail(context, `${path}.authorization`, "exceeds the hard evidence-read bounds");
  }

  const input = object(item.input, context, `${path}.input`);
  exact(input, ["artifactId", "contentId", "bytes", "evidenceKind", "receiptSchema"], context, `${path}.input`);
  string(input.artifactId, context, `${path}.input.artifactId`);
  contentId(input.contentId, context, `${path}.input.contentId`);
  integer(input.bytes, context, `${path}.input.bytes`, 1);
  const evidenceKind = oneOf(input.evidenceKind, EVIDENCE_KINDS, context, `${path}.input.evidenceKind`);
  const receiptSchema = oneOf(
    input.receiptSchema,
    new Set(["studio.speech-activity.v1", "studio.language-ranges.v1", "studio.acoustic-observations.v1"]),
    context,
    `${path}.input.receiptSchema`,
  );
  if (
    (evidenceKind === "speech_activity" && receiptSchema !== "studio.speech-activity.v1") ||
    (evidenceKind === "language_ranges" && receiptSchema !== "studio.language-ranges.v1") ||
    (evidenceKind === "acoustic_ranges" && (schema !== "studio.evidence-read.receipt.v3" || receiptSchema !== "studio.acoustic-observations.v1")) ||
    (schema === "studio.evidence-read.receipt.v3" && evidenceKind !== "acoustic_ranges")
  ) {
    fail(context, `${path}.input`, "evidence kind and receipt schema must agree");
  }

  const producer = object(item.producer, context, `${path}.producer`);
  exact(producer, ["id", "version", "rangePolicy"], context, `${path}.producer`);
  literal(producer.id, "studio.bounded-evidence-read", context, `${path}.producer.id`);
  literal(producer.version, schema === "studio.evidence-read.receipt.v3" ? "3" : "2", context, `${path}.producer.version`);
  literal(
    producer.rangePolicy,
    "intersect_and_clip_to_authorized_window",
    context,
    `${path}.producer.rangePolicy`,
  );

  const facts = array(item.facts, context, `${path}.facts`);
  facts.forEach((entry, index) => {
    fact(entry, context, `${path}.facts[${index}]`);
    if (entry.startMs < startMs || entry.endMs > endMs) {
      fail(context, `${path}.facts[${index}]`, "escapes the authorized source window");
    }
  });
  const result = object(item.result, context, `${path}.result`);
  exact(result, ["availableItems", "returnedItems", "returnedFactBytes", "truncated"], context, `${path}.result`);
  const available = integer(result.availableItems, context, `${path}.result.availableItems`);
  const returned = integer(result.returnedItems, context, `${path}.result.returnedItems`);
  const returnedBytes = integer(result.returnedFactBytes, context, `${path}.result.returnedFactBytes`, 1);
  const truncated = boolean(result.truncated, context, `${path}.result.truncated`);
  if (returned !== facts.length || returned > available || returned > maxItems || returnedBytes > maxBytes) {
    fail(context, `${path}.result`, "does not match the bounded returned facts");
  }
  if (new TextEncoder().encode(JSON.stringify(facts)).byteLength !== returnedBytes) {
    fail(context, `${path}.result.returnedFactBytes`, "does not match the encoded fact bytes");
  }
  if (truncated !== (returned < available)) {
    fail(context, `${path}.result.truncated`, "must report whether available facts were omitted");
  }

  const lineage = object(item.lineage, context, `${path}.lineage`);
  exact(lineage, schema === "studio.evidence-read.receipt.v3" ? ["preflightId", "preflightContentId", "sourceArtifactIds", "producerReceiptContentId"] : ["preflightId", "preflightContentId", "sourceArtifactIds"], context, `${path}.lineage`);
  string(lineage.preflightId, context, `${path}.lineage.preflightId`);
  contentId(lineage.preflightContentId, context, `${path}.lineage.preflightContentId`);
  if (schema === "studio.evidence-read.receipt.v3") contentId(lineage.producerReceiptContentId, context, `${path}.lineage.producerReceiptContentId`);
  const sources = uniqueStrings(lineage.sourceArtifactIds, context, `${path}.lineage.sourceArtifactIds`);
  if (sources.length !== 1) fail(context, `${path}.lineage.sourceArtifactIds`, "must name one runtime source artifact");
  if (sources[0] !== sourceArtifactId) {
    fail(context, `${path}.lineage.sourceArtifactIds`, "must equal the authorized source artifact");
  }
}
