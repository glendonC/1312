import type {
  EvidenceAssessmentClaim,
  EvidenceAssessmentReceipt,
  EvidenceAssessmentRequest,
  EvidenceAssessmentState,
  EvidenceReadReceiptIdentity,
  ReceiptedEvidenceAssessmentClaim,
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
import {
  MAX_EVIDENCE_ASSESSMENTS,
  MAX_EVIDENCE_ASSESS_CITATIONS,
  MAX_EVIDENCE_ASSESS_CLAIMS,
  MAX_EVIDENCE_ASSESS_READ_RECEIPTS,
  MAX_EVIDENCE_ASSESS_TOKENS,
} from "./scheduling.ts";

const CLAIM_KINDS = new Set(["speech_activity", "language_identity"]);
const ASSESSMENT_STATES = new Set(["supported", "unknown", "withheld", "truncated"]);
const EVIDENCE_KINDS = new Set(["speech_activity", "language_ranges"]);

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const item = value as Record<string, unknown>;
  return `{${Object.keys(item).sort().map((key) => `${JSON.stringify(key)}:${canonical(item[key])}`).join(",")}}`;
}

/** Deterministic structured-token units; deliberately not provider/model token accounting. */
export function countAssessmentTokens(value: unknown): number {
  return canonical(value).match(/[\p{L}\p{N}_:-]+|[^\s]/gu)?.length ?? 0;
}

function identity(
  value: unknown,
  context: string,
  path: string,
): asserts value is EvidenceReadReceiptIdentity {
  const item = object(value, context, path);
  exact(item, ["receiptId", "receiptContentId"], context, path);
  string(item.receiptId, context, `${path}.receiptId`);
  contentId(item.receiptContentId, context, `${path}.receiptContentId`);
}

function citation(value: unknown, context: string, path: string): number {
  const item = object(value, context, path);
  exact(item, ["receiptId", "receiptContentId", "factIndexes"], context, path);
  string(item.receiptId, context, `${path}.receiptId`);
  contentId(item.receiptContentId, context, `${path}.receiptContentId`);
  const indexes = array(item.factIndexes, context, `${path}.factIndexes`);
  if (indexes.length === 0) fail(context, `${path}.factIndexes`, "must cite at least one returned fact index");
  indexes.forEach((candidate, index) => integer(candidate, context, `${path}.factIndexes[${index}]`));
  if (new Set(indexes).size !== indexes.length) fail(context, `${path}.factIndexes`, "must not repeat indexes");
  return indexes.length;
}

function claim(
  value: unknown,
  context: string,
  path: string,
  receipted: boolean,
): { claim: EvidenceAssessmentClaim; citationCount: number } {
  const item = object(value, context, path);
  exact(
    item,
    receipted
      ? ["kind", "value", "range", "citations", "claimIndex", "states"]
      : ["kind", "value", "range", "citations"],
    context,
    path,
  );
  const kind = oneOf(item.kind, CLAIM_KINDS, context, `${path}.kind`);
  if (kind === "speech_activity") {
    oneOf(item.value, new Set(["speech", "non_speech"]), context, `${path}.value`);
  } else {
    nullableString(item.value, context, `${path}.value`);
  }
  const range = object(item.range, context, `${path}.range`);
  exact(range, ["startMs", "endMs"], context, `${path}.range`);
  const startMs = integer(range.startMs, context, `${path}.range.startMs`);
  const endMs = integer(range.endMs, context, `${path}.range.endMs`, 1);
  if (endMs <= startMs) fail(context, `${path}.range`, "must be a non-empty half-open range");
  const citations = array(item.citations, context, `${path}.citations`);
  if (citations.length === 0) fail(context, `${path}.citations`, "must cite completed evidence-read facts");
  let citationCount = 0;
  citations.forEach((candidate, index) => {
    citationCount += citation(candidate, context, `${path}.citations[${index}]`);
  });
  const citationKeys = citations.map((candidate) => {
    const cited = candidate as { receiptId: string; receiptContentId: string };
    return `${cited.receiptId}\u0000${cited.receiptContentId}`;
  });
  if (new Set(citationKeys).size !== citationKeys.length) {
    fail(context, `${path}.citations`, "must group indexes once per read receipt");
  }
  if (receipted) {
    integer(item.claimIndex, context, `${path}.claimIndex`);
    const states = uniqueStrings(item.states, context, `${path}.states`) as EvidenceAssessmentState[];
    if (states.length === 0) fail(context, `${path}.states`, "must preserve at least one upstream evidence state");
    states.forEach((state, index) => oneOf(state, ASSESSMENT_STATES, context, `${path}.states[${index}]`));
    if (states.includes("supported") && states.length !== 1) {
      fail(context, `${path}.states`, "supported cannot hide an unknown, withheld, or truncated state");
    }
  }
  return { claim: item as unknown as EvidenceAssessmentClaim, citationCount };
}

export function assertEvidenceAssessmentRequest(
  value: unknown,
  context = "Evidence assessment",
): asserts value is EvidenceAssessmentRequest {
  const item = object(value, context, "request");
  exact(item, ["operationId", "taskId", "agentId", "readReceipts", "claims"], context, "request");
  string(item.operationId, context, "request.operationId");
  string(item.taskId, context, "request.taskId");
  string(item.agentId, context, "request.agentId");
  const receipts = array(item.readReceipts, context, "request.readReceipts");
  if (receipts.length === 0 || receipts.length > MAX_EVIDENCE_ASSESS_READ_RECEIPTS) {
    fail(context, "request.readReceipts", `must contain 1-${MAX_EVIDENCE_ASSESS_READ_RECEIPTS} completed read receipts`);
  }
  receipts.forEach((candidate, index) => identity(candidate, context, `request.readReceipts[${index}]`));
  const receiptKeys = receipts.map((candidate) => {
    const receipt = candidate as EvidenceReadReceiptIdentity;
    return `${receipt.receiptId}\u0000${receipt.receiptContentId}`;
  });
  if (new Set(receiptKeys).size !== receiptKeys.length) fail(context, "request.readReceipts", "must be unique");
  const declared = new Set(receiptKeys);

  const claims = array(item.claims, context, "request.claims");
  if (claims.length === 0 || claims.length > MAX_EVIDENCE_ASSESS_CLAIMS) {
    fail(context, "request.claims", `must contain 1-${MAX_EVIDENCE_ASSESS_CLAIMS} range-bound claims`);
  }
  let citationCount = 0;
  claims.forEach((candidate, index) => {
    const validated = claim(candidate, context, `request.claims[${index}]`, false);
    citationCount += validated.citationCount;
    for (const cited of validated.claim.citations) {
      if (!declared.has(`${cited.receiptId}\u0000${cited.receiptContentId}`)) {
        fail(context, `request.claims[${index}].citations`, "must cite a declared completed read receipt identity");
      }
    }
  });
  if (citationCount > MAX_EVIDENCE_ASSESS_CITATIONS) {
    fail(context, "request.claims", `must not exceed ${MAX_EVIDENCE_ASSESS_CITATIONS} cited fact indexes`);
  }
  if (countAssessmentTokens(claims) > MAX_EVIDENCE_ASSESS_TOKENS) {
    fail(context, "request.claims", `must not exceed ${MAX_EVIDENCE_ASSESS_TOKENS} structured tokens`);
  }
}

export function validateEvidenceAssessmentReceipt(
  value: unknown,
  context = "Evidence assessment receipt",
  path = "receipt",
): asserts value is EvidenceAssessmentReceipt {
  const item = object(value, context, path);
  exact(
    item,
    ["schema", "receiptId", "operationId", "capability", "authorization", "inputs", "producer", "claims", "result"],
    context,
    path,
  );
  literal(item.schema, "studio.evidence-assessment.receipt.v1", context, `${path}.schema`);
  string(item.receiptId, context, `${path}.receiptId`);
  string(item.operationId, context, `${path}.operationId`);
  literal(item.capability, "analysis.evidence.assess", context, `${path}.capability`);
  const authorization = object(item.authorization, context, `${path}.authorization`);
  exact(
    authorization,
    ["grantId", "taskId", "agentId", "maxAssessments", "maxReadReceipts", "maxClaims", "maxCitations", "maxTokens"],
    context,
    `${path}.authorization`,
  );
  string(authorization.grantId, context, `${path}.authorization.grantId`);
  string(authorization.taskId, context, `${path}.authorization.taskId`);
  string(authorization.agentId, context, `${path}.authorization.agentId`);
  const maxAssessments = integer(authorization.maxAssessments, context, `${path}.authorization.maxAssessments`, 1);
  const maxReadReceipts = integer(authorization.maxReadReceipts, context, `${path}.authorization.maxReadReceipts`, 1);
  const maxClaims = integer(authorization.maxClaims, context, `${path}.authorization.maxClaims`, 1);
  const maxCitations = integer(authorization.maxCitations, context, `${path}.authorization.maxCitations`, 1);
  const maxTokens = integer(authorization.maxTokens, context, `${path}.authorization.maxTokens`, 1);
  if (
    maxAssessments > MAX_EVIDENCE_ASSESSMENTS ||
    maxReadReceipts > MAX_EVIDENCE_ASSESS_READ_RECEIPTS ||
    maxClaims > MAX_EVIDENCE_ASSESS_CLAIMS ||
    maxCitations > MAX_EVIDENCE_ASSESS_CITATIONS ||
    maxTokens > MAX_EVIDENCE_ASSESS_TOKENS
  ) fail(context, `${path}.authorization`, "exceeds hard assessment bounds");

  const inputs = array(item.inputs, context, `${path}.inputs`);
  if (inputs.length === 0 || inputs.length > maxReadReceipts) fail(context, `${path}.inputs`, "exceeds the read-receipt bound");
  inputs.forEach((candidate, index) => {
    const input = object(candidate, context, `${path}.inputs[${index}]`);
    exact(input, ["readOperationId", "receiptId", "receiptContentId", "evidenceArtifactId", "evidenceKind", "returnedItems", "truncated"], context, `${path}.inputs[${index}]`);
    string(input.readOperationId, context, `${path}.inputs[${index}].readOperationId`);
    string(input.receiptId, context, `${path}.inputs[${index}].receiptId`);
    contentId(input.receiptContentId, context, `${path}.inputs[${index}].receiptContentId`);
    string(input.evidenceArtifactId, context, `${path}.inputs[${index}].evidenceArtifactId`);
    oneOf(input.evidenceKind, EVIDENCE_KINDS, context, `${path}.inputs[${index}].evidenceKind`);
    integer(input.returnedItems, context, `${path}.inputs[${index}].returnedItems`);
    boolean(input.truncated, context, `${path}.inputs[${index}].truncated`);
  });
  const inputKeys = inputs.map((candidate) => {
    const input = candidate as { receiptId: string; receiptContentId: string };
    return `${input.receiptId}\u0000${input.receiptContentId}`;
  });
  if (new Set(inputKeys).size !== inputKeys.length) fail(context, `${path}.inputs`, "must contain unique read receipts");
  const declaredInputs = new Set(inputKeys);

  const producer = object(item.producer, context, `${path}.producer`);
  exact(producer, ["id", "version"], context, `${path}.producer`);
  literal(producer.id, "studio.bounded-evidence-assessment", context, `${path}.producer.id`);
  literal(producer.version, "1", context, `${path}.producer.version`);

  const claims = array(item.claims, context, `${path}.claims`);
  if (claims.length === 0 || claims.length > maxClaims) fail(context, `${path}.claims`, "exceeds the claim bound");
  let citationCount = 0;
  claims.forEach((candidate, index) => {
    const validated = claim(candidate, context, `${path}.claims[${index}]`, true);
    if ((candidate as ReceiptedEvidenceAssessmentClaim).claimIndex !== index) {
      fail(context, `${path}.claims[${index}].claimIndex`, "must match receipt order");
    }
    for (const cited of validated.claim.citations) {
      if (!declaredInputs.has(`${cited.receiptId}\u0000${cited.receiptContentId}`)) {
        fail(context, `${path}.claims[${index}].citations`, "must cite a receipted assessment input");
      }
    }
    citationCount += validated.citationCount;
  });
  const tokenCount = countAssessmentTokens(claims);
  if (citationCount > maxCitations || tokenCount > maxTokens) fail(context, `${path}.claims`, "exceeds citation or token bounds");

  const result = object(item.result, context, `${path}.result`);
  exact(result, ["readReceiptCount", "claimCount", "citationCount", "tokenCount"], context, `${path}.result`);
  const readReceiptCount = integer(result.readReceiptCount, context, `${path}.result.readReceiptCount`, 1);
  const claimCount = integer(result.claimCount, context, `${path}.result.claimCount`, 1);
  const recordedCitations = integer(result.citationCount, context, `${path}.result.citationCount`, 1);
  const recordedTokens = integer(result.tokenCount, context, `${path}.result.tokenCount`, 1);
  if (
    readReceiptCount !== inputs.length || claimCount !== claims.length ||
    recordedCitations !== citationCount || recordedTokens !== tokenCount
  ) fail(context, `${path}.result`, "does not match the receipted assessment content");
}
