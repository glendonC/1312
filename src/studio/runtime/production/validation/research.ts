import { canonicalSha256 } from "../canonicalIdentity.ts";
import {
  RESEARCH_ALLOWED_MIME_TYPES,
  RESEARCH_CAPABILITY,
  RESEARCH_CITATION_MAX_SPANS,
  RESEARCH_LIMITS,
  type ResearchAllowedMimeType,
  type ResearchDocumentSnapshotReceipt,
  type ResearchEvidenceCitationInput,
  type ResearchExhaustionReason,
  type ResearchExhaustionReceipt,
  type ResearchExtractionArtifact,
  type ResearchExtractionMethod,
  type ResearchGapBinding,
  type ResearchGrantScope,
  type ResearchLimits,
  type ResearchQualifiedMedia,
  type ResearchRedirectHop,
  type ResearchRequest,
  type ResearchRequestInput,
  type ResearchRequestReceipt,
  type ResearchSearchReceipt,
  type ResearchSearchResult,
  type ResearchSearchState,
  type ResearchTriggerOption,
  type RestudiedResearchBasis,
  type RestudiedResearchRequestInput,
  type RestudiedResearchTriggerOption,
} from "../model/research.ts";
import {
  array,
  contentId,
  exact,
  fail,
  integer,
  isoTimestamp,
  literal,
  nullableInteger,
  object,
  oneOf,
  string,
  uniqueStrings,
} from "./primitives.ts";

const LIMIT_KEYS = Object.keys(RESEARCH_LIMITS) as Array<keyof ResearchLimits>;
const SEARCH_STATES = new Set<ResearchSearchState>(["available", "empty", "truncated"]);
const MIME_TYPES = new Set<string>(RESEARCH_ALLOWED_MIME_TYPES);
const EXTRACTION_METHODS = new Set<ResearchExtractionMethod>(["html_text_v1", "plain_text_v1"]);
const EXHAUSTION_REASONS = new Set<ResearchExhaustionReason>(["query_budget_exhausted_without_results"]);

/** Exact lowercase registrable https hostname. IP literals and wildcards are never domains. */
const DOMAIN_PATTERN = /^(?=.{1,253}$)[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/;
const IPV4_PATTERN = /^\d{1,3}(\.\d{1,3}){3}$/;

export function researchReceiptId(
  value: Omit<ResearchSearchReceipt, "receiptId"> | Omit<ResearchDocumentSnapshotReceipt, "receiptId">,
): string {
  const { schema: _schema, ...body } = value;
  return `research-receipt:${canonicalSha256(body)}`;
}

export function researchRequestReceiptId(value: Omit<ResearchRequestReceipt, "receiptId">): string {
  const { schema: _schema, ...body } = value;
  return `research-request-receipt:${canonicalSha256(body)}`;
}

export function researchExhaustionReceiptId(value: Omit<ResearchExhaustionReceipt, "receiptId">): string {
  const { schema: _schema, ...body } = value;
  return `research-exhaustion-receipt:${canonicalSha256(body)}`;
}

export function researchTriggerId(value: Omit<ResearchTriggerOption, "triggerId">): string {
  return `research-trigger:${canonicalSha256(value)}`;
}

export function researchRequestInputId(value: Omit<ResearchRequestInput, "inputId">): string {
  return `research-request-input:${canonicalSha256(value)}`;
}

export function restudiedResearchBasisId(value: Omit<RestudiedResearchBasis, "basisId">): string {
  return `restudied-research-basis:${canonicalSha256(value)}`;
}

export function restudiedResearchTriggerId(value: Omit<RestudiedResearchTriggerOption, "triggerId">): string {
  return `restudied-research-trigger:${canonicalSha256(value)}`;
}

export function restudiedResearchRequestInputId(value: Omit<RestudiedResearchRequestInput, "inputId">): string {
  return `restudied-research-request-input:${canonicalSha256(value)}`;
}

export function researchRequestFingerprint(input: {
  grantId: string;
  op: "search" | "document_snapshot";
  query: string | null;
  searchOperationId: string | null;
  resultIndex: number | null;
}): string {
  return `research-request:${canonicalSha256(input)}`;
}

export function validateResearchLimits(value: unknown, context: string, path: string): ResearchLimits {
  const item = object(value, context, path);
  exact(item, LIMIT_KEYS, context, path);
  for (const key of LIMIT_KEYS) {
    const measured = integer(item[key], context, `${path}.${key}`, 1);
    if (measured !== RESEARCH_LIMITS[key]) {
      fail(context, `${path}.${key}`, `must equal the registered R1 limit ${RESEARCH_LIMITS[key]}`);
    }
  }
  return item as unknown as ResearchLimits;
}

export function validateResearchDomain(value: unknown, context: string, path: string): string {
  const domain = string(value, context, path);
  if (domain.length > 253 || IPV4_PATTERN.test(domain) || !DOMAIN_PATTERN.test(domain)) {
    fail(context, path, "must be an exact lowercase public hostname, never an IP literal");
  }
  return domain;
}

export function validateResearchAllowedDomains(value: unknown, context: string, path: string): string[] {
  const domains = uniqueStrings(value, context, path);
  if (domains.length > RESEARCH_LIMITS.maxAllowedDomains) {
    fail(context, path, "exceeds the closed allowlist size");
  }
  domains.forEach((domain, index) => validateResearchDomain(domain, context, `${path}[${index}]`));
  return domains;
}

export function validateResearchQualifiedMedia(
  value: unknown,
  context: string,
  path: string,
): ResearchQualifiedMedia {
  const item = object(value, context, path);
  exact(item, ["artifactId", "contentId", "trackId", "startMs", "endMs"], context, path);
  const startMs = integer(item.startMs, context, `${path}.startMs`);
  const endMs = integer(item.endMs, context, `${path}.endMs`, 1);
  if (endMs <= startMs) fail(context, path, "must be a non-empty media range");
  return {
    artifactId: string(item.artifactId, context, `${path}.artifactId`),
    contentId: contentId(item.contentId, context, `${path}.contentId`),
    trackId: string(item.trackId, context, `${path}.trackId`),
    startMs,
    endMs,
  };
}

export function validateResearchGapBinding(value: unknown, context: string, path: string): ResearchGapBinding {
  const item = object(value, context, path);
  exact(item, ["inputId", "triggerId", "hypothesis", "media"], context, path);
  return {
    inputId: string(item.inputId, context, `${path}.inputId`),
    triggerId: string(item.triggerId, context, `${path}.triggerId`),
    hypothesis: string(item.hypothesis, context, `${path}.hypothesis`),
    media: validateResearchQualifiedMedia(item.media, context, `${path}.media`),
  };
}

export function validateResearchGrantScope(value: unknown, context: string, path: string): ResearchGrantScope {
  const item = object(value, context, path);
  exact(item, ["schema", "limits", "allowedDomains", "gap"], context, path);
  literal(item.schema, "studio.research-grant.v1", context, `${path}.schema`);
  validateResearchLimits(item.limits, context, `${path}.limits`);
  validateResearchAllowedDomains(item.allowedDomains, context, `${path}.allowedDomains`);
  validateResearchGapBinding(item.gap, context, `${path}.gap`);
  return item as unknown as ResearchGrantScope;
}

export function assertResearchRequest(value: unknown, context = "Research request"): asserts value is ResearchRequest {
  const item = object(value, context, "request");
  const op = oneOf<"search" | "document_snapshot">(
    item.op,
    new Set(["search", "document_snapshot"]),
    context,
    "request.op",
  );
  if (op === "search") {
    exact(item, ["operationId", "taskId", "agentId", "grantId", "op", "query"], context, "request");
    const query = string(item.query, context, "request.query");
    if (query.length > RESEARCH_LIMITS.maxQueryChars) fail(context, "request.query", "exceeds the closed query length");
  } else {
    exact(item, ["operationId", "taskId", "agentId", "grantId", "op", "searchOperationId", "resultIndex"], context, "request");
    string(item.searchOperationId, context, "request.searchOperationId");
    const index = integer(item.resultIndex, context, "request.resultIndex");
    if (index >= RESEARCH_LIMITS.maxResultsPerQuery) fail(context, "request.resultIndex", "escapes the closed result window");
  }
  for (const key of ["operationId", "taskId", "agentId", "grantId"]) string(item[key], context, `request.${key}`);
}

function validateAuthorization(value: unknown, context: string, path: string): void {
  const item = object(value, context, path);
  // Two closed shapes: unbound fixture receipts omit the executor lineage entirely; ledger-bound
  // receipts carry both fields. A partial binding is never valid.
  const bound = "executionId" in item || "launchClaimId" in item;
  const keys = bound
    ? ["grantId", "taskId", "agentId", "executionId", "launchClaimId"]
    : ["grantId", "taskId", "agentId"];
  exact(item, keys, context, path);
  for (const key of keys) string(item[key], context, `${path}.${key}`);
}

function validateSearchResult(value: unknown, context: string, path: string, expectedIndex: number): ResearchSearchResult {
  const item = object(value, context, path);
  exact(item, ["index", "canonicalUrl", "title", "snippet", "snippetRole"], context, path);
  const index = integer(item.index, context, `${path}.index`);
  if (index !== expectedIndex) fail(context, `${path}.index`, "must preserve provider result order");
  const canonicalUrl = string(item.canonicalUrl, context, `${path}.canonicalUrl`);
  if (canonicalUrl.length > RESEARCH_LIMITS.maxUrlChars || !canonicalUrl.startsWith("https://")) {
    fail(context, `${path}.canonicalUrl`, "must be a bounded https URL");
  }
  const title = string(item.title, context, `${path}.title`);
  if (title.length > RESEARCH_LIMITS.maxTitleChars) fail(context, `${path}.title`, "exceeds the closed title length");
  const snippet = string(item.snippet, context, `${path}.snippet`);
  if (snippet.length > RESEARCH_LIMITS.maxSnippetChars) fail(context, `${path}.snippet`, "exceeds the closed snippet length");
  literal(item.snippetRole, "routing_hint_not_citation", context, `${path}.snippetRole`);
  return item as unknown as ResearchSearchResult;
}

export function validateResearchSearchReceipt(
  value: unknown,
  context = "Research search receipt",
  path = "receipt",
): ResearchSearchReceipt {
  const item = object(value, context, path);
  exact(item, [
    "schema", "receiptId", "operationId", "runId", "capability", "authorization", "gap", "provider",
    "query", "results", "limits", "allowedDomains", "retrievedAt", "state", "nonClaims",
  ], context, path);
  literal(item.schema, "studio.research-search.receipt.v1", context, `${path}.schema`);
  string(item.receiptId, context, `${path}.receiptId`);
  string(item.operationId, context, `${path}.operationId`);
  string(item.runId, context, `${path}.runId`);
  literal(item.capability, RESEARCH_CAPABILITY, context, `${path}.capability`);
  validateAuthorization(item.authorization, context, `${path}.authorization`);
  validateResearchGapBinding(item.gap, context, `${path}.gap`);
  const provider = object(item.provider, context, `${path}.provider`);
  exact(provider, ["id", "version"], context, `${path}.provider`);
  string(provider.id, context, `${path}.provider.id`);
  string(provider.version, context, `${path}.provider.version`);
  const query = string(item.query, context, `${path}.query`);
  if (query.length > RESEARCH_LIMITS.maxQueryChars) fail(context, `${path}.query`, "exceeds the closed query length");
  const results = array(item.results, context, `${path}.results`);
  if (results.length > RESEARCH_LIMITS.maxResultsPerQuery) fail(context, `${path}.results`, "exceeds the closed result count");
  results.forEach((entry, index) => validateSearchResult(entry, context, `${path}.results[${index}]`, index));
  validateResearchLimits(item.limits, context, `${path}.limits`);
  validateResearchAllowedDomains(item.allowedDomains, context, `${path}.allowedDomains`);
  isoTimestamp(item.retrievedAt, context, `${path}.retrievedAt`);
  const state = oneOf<ResearchSearchState>(item.state, SEARCH_STATES, context, `${path}.state`);
  if (state === "empty" && results.length !== 0) fail(context, `${path}.state`, "empty search receipts cannot carry results");
  if (state !== "empty" && results.length === 0) fail(context, `${path}.state`, "must be empty when no results were recorded");
  const nonClaims = object(item.nonClaims, context, `${path}.nonClaims`);
  exact(nonClaims, ["snippetEvidence", "sourceTruth"], context, `${path}.nonClaims`);
  literal(nonClaims.snippetEvidence, "routing_hint_only", context, `${path}.nonClaims.snippetEvidence`);
  literal(nonClaims.sourceTruth, "not_assessed", context, `${path}.nonClaims.sourceTruth`);
  const receipt = item as unknown as ResearchSearchReceipt;
  const { receiptId: _receiptId, ...withoutId } = receipt;
  if (receipt.receiptId !== researchReceiptId(withoutId)) fail(context, `${path}.receiptId`, "does not close the receipt body");
  return receipt;
}

export function validateResearchExtractionArtifact(
  value: unknown,
  context = "Research extraction artifact",
  path = "extraction",
): ResearchExtractionArtifact {
  const item = object(value, context, path);
  exact(item, ["schema", "operationId", "runId", "method", "sourceDocumentContentId", "unit", "unitCount", "text"], context, path);
  literal(item.schema, "studio.research-extraction.v1", context, `${path}.schema`);
  string(item.operationId, context, `${path}.operationId`);
  string(item.runId, context, `${path}.runId`);
  oneOf(item.method, EXTRACTION_METHODS, context, `${path}.method`);
  contentId(item.sourceDocumentContentId, context, `${path}.sourceDocumentContentId`);
  literal(item.unit, "utf8_byte", context, `${path}.unit`);
  const unitCount = integer(item.unitCount, context, `${path}.unitCount`);
  if (typeof item.text !== "string") fail(context, `${path}.text`, "must be a string");
  const text = item.text as string;
  const measured = Buffer.byteLength(text, "utf8");
  if (measured !== unitCount) fail(context, `${path}.unitCount`, "must equal the extracted UTF-8 byte length");
  if (unitCount > RESEARCH_LIMITS.maxExtractionUnits) fail(context, `${path}.text`, "exceeds the closed extraction size");
  return item as unknown as ResearchExtractionArtifact;
}

/**
 * Validates only the worker-selectable portion of an external citation. Snapshot lineage and the
 * extraction byte ceiling are checked later against the launcher's cold-audited source object.
 */
export function validateResearchEvidenceCitationInput(
  value: unknown,
  context = "Research evidence citation input",
  path = "input",
): ResearchEvidenceCitationInput {
  const item = object(value, context, path);
  exact(item, [
    "operationId",
    "receiptArtifactId",
    "receiptContentId",
    "extractionArtifactId",
    "extractionContentId",
    "spans",
  ], context, path);
  const spans = array(item.spans, context, `${path}.spans`);
  if (spans.length === 0 || spans.length > RESEARCH_CITATION_MAX_SPANS) {
    fail(context, `${path}.spans`, `must contain 1-${RESEARCH_CITATION_MAX_SPANS} exact spans`);
  }
  let previousEnd = -1;
  const validatedSpans = spans.map((span, index) => {
    const spanPath = `${path}.spans[${index}]`;
    const range = object(span, context, spanPath);
    exact(range, ["start", "end"], context, spanPath);
    const start = integer(range.start, context, `${spanPath}.start`);
    const end = integer(range.end, context, `${spanPath}.end`, 1);
    if (end <= start) fail(context, spanPath, "must be a non-empty UTF-8 byte range");
    if (start < previousEnd) fail(context, spanPath, "must be sorted and non-overlapping");
    previousEnd = end;
    return { start, end };
  });
  return {
    operationId: string(item.operationId, context, `${path}.operationId`),
    receiptArtifactId: string(item.receiptArtifactId, context, `${path}.receiptArtifactId`),
    receiptContentId: contentId(item.receiptContentId, context, `${path}.receiptContentId`),
    extractionArtifactId: string(item.extractionArtifactId, context, `${path}.extractionArtifactId`),
    extractionContentId: contentId(item.extractionContentId, context, `${path}.extractionContentId`),
    spans: validatedSpans,
  };
}

function validateRedirectHop(value: unknown, context: string, path: string): ResearchRedirectHop {
  const item = object(value, context, path);
  exact(item, ["url", "status", "location"], context, path);
  const url = string(item.url, context, `${path}.url`);
  const location = string(item.location, context, `${path}.location`);
  if (url.length > RESEARCH_LIMITS.maxUrlChars || location.length > RESEARCH_LIMITS.maxUrlChars) {
    fail(context, path, "exceeds the closed URL length");
  }
  const status = integer(item.status, context, `${path}.status`, 300);
  if (status > 399) fail(context, `${path}.status`, "must be a redirect status");
  return { url, status, location };
}

export function validateResearchSnapshotReceipt(
  value: unknown,
  context = "Research snapshot receipt",
  path = "receipt",
): ResearchDocumentSnapshotReceipt {
  const item = object(value, context, path);
  exact(item, [
    "schema", "receiptId", "operationId", "runId", "capability", "authorization", "gap", "search",
    "request", "redirectChain", "finalUrl", "response", "document", "extraction", "retrievedAt",
    "limits", "allowedDomains", "egressPolicy", "state", "nonClaims",
  ], context, path);
  literal(item.schema, "studio.research-document-snapshot.receipt.v1", context, `${path}.schema`);
  string(item.receiptId, context, `${path}.receiptId`);
  string(item.operationId, context, `${path}.operationId`);
  string(item.runId, context, `${path}.runId`);
  literal(item.capability, RESEARCH_CAPABILITY, context, `${path}.capability`);
  validateAuthorization(item.authorization, context, `${path}.authorization`);
  validateResearchGapBinding(item.gap, context, `${path}.gap`);
  const search = object(item.search, context, `${path}.search`);
  exact(search, ["operationId", "receiptId", "receiptContentId", "resultIndex"], context, `${path}.search`);
  string(search.operationId, context, `${path}.search.operationId`);
  string(search.receiptId, context, `${path}.search.receiptId`);
  contentId(search.receiptContentId, context, `${path}.search.receiptContentId`);
  const resultIndex = integer(search.resultIndex, context, `${path}.search.resultIndex`);
  if (resultIndex >= RESEARCH_LIMITS.maxResultsPerQuery) fail(context, `${path}.search.resultIndex`, "escapes the closed result window");
  const request = object(item.request, context, `${path}.request`);
  exact(request, ["url"], context, `${path}.request`);
  const requestUrl = string(request.url, context, `${path}.request.url`);
  if (requestUrl.length > RESEARCH_LIMITS.maxUrlChars || !requestUrl.startsWith("https://")) {
    fail(context, `${path}.request.url`, "must be a bounded https URL");
  }
  const redirectChain = array(item.redirectChain, context, `${path}.redirectChain`);
  if (redirectChain.length > RESEARCH_LIMITS.maxRedirects) fail(context, `${path}.redirectChain`, "exceeds the closed redirect count");
  redirectChain.forEach((entry, index) => validateRedirectHop(entry, context, `${path}.redirectChain[${index}]`));
  const finalUrl = string(item.finalUrl, context, `${path}.finalUrl`);
  if (finalUrl.length > RESEARCH_LIMITS.maxUrlChars || !finalUrl.startsWith("https://")) {
    fail(context, `${path}.finalUrl`, "must be a bounded https URL");
  }
  const response = object(item.response, context, `${path}.response`);
  exact(response, ["status", "mimeType", "declaredContentLength", "headersDigest"], context, `${path}.response`);
  if (integer(response.status, context, `${path}.response.status`, 200) !== 200) {
    fail(context, `${path}.response.status`, "must be a direct 200 terminal response");
  }
  oneOf<ResearchAllowedMimeType>(response.mimeType, MIME_TYPES, context, `${path}.response.mimeType`);
  nullableInteger(response.declaredContentLength, context, `${path}.response.declaredContentLength`);
  string(response.headersDigest, context, `${path}.response.headersDigest`);
  const documentValue = object(item.document, context, `${path}.document`);
  exact(documentValue, ["artifactId", "contentId", "bytes"], context, `${path}.document`);
  string(documentValue.artifactId, context, `${path}.document.artifactId`);
  contentId(documentValue.contentId, context, `${path}.document.contentId`);
  const documentBytes = integer(documentValue.bytes, context, `${path}.document.bytes`, 1);
  if (documentBytes > RESEARCH_LIMITS.maxDocumentBytes) fail(context, `${path}.document.bytes`, "exceeds the closed document size");
  const extraction = object(item.extraction, context, `${path}.extraction`);
  exact(extraction, ["artifactId", "contentId", "bytes", "method", "unit", "unitCount"], context, `${path}.extraction`);
  string(extraction.artifactId, context, `${path}.extraction.artifactId`);
  contentId(extraction.contentId, context, `${path}.extraction.contentId`);
  integer(extraction.bytes, context, `${path}.extraction.bytes`, 1);
  oneOf(extraction.method, EXTRACTION_METHODS, context, `${path}.extraction.method`);
  literal(extraction.unit, "utf8_byte", context, `${path}.extraction.unit`);
  const unitCount = integer(extraction.unitCount, context, `${path}.extraction.unitCount`);
  if (unitCount > RESEARCH_LIMITS.maxExtractionUnits) fail(context, `${path}.extraction.unitCount`, "exceeds the closed extraction size");
  isoTimestamp(item.retrievedAt, context, `${path}.retrievedAt`);
  validateResearchLimits(item.limits, context, `${path}.limits`);
  const allowedDomains = validateResearchAllowedDomains(item.allowedDomains, context, `${path}.allowedDomains`);
  for (const url of [requestUrl, finalUrl, ...redirectChain.map((entry) => (entry as ResearchRedirectHop).url)]) {
    const hostname = new URL(url).hostname.toLowerCase();
    if (!allowedDomains.includes(hostname)) fail(context, `${path}.redirectChain`, "every hop must stay inside the granted domain allowlist");
  }
  const egressPolicy = object(item.egressPolicy, context, `${path}.egressPolicy`);
  exact(egressPolicy, ["dnsRebindingWindow", "cookies"], context, `${path}.egressPolicy`);
  literal(egressPolicy.dnsRebindingWindow, "checked_before_fetch_not_pinned", context, `${path}.egressPolicy.dnsRebindingWindow`);
  literal(egressPolicy.cookies, "never_sent_never_stored", context, `${path}.egressPolicy.cookies`);
  literal(item.state, "available", context, `${path}.state`);
  const nonClaims = object(item.nonClaims, context, `${path}.nonClaims`);
  exact(nonClaims, ["snapshotTruth", "entityMatch", "currency", "speechEvidenceAuthority"], context, `${path}.nonClaims`);
  literal(nonClaims.snapshotTruth, "retrieval_time_only", context, `${path}.nonClaims.snapshotTruth`);
  literal(nonClaims.entityMatch, "not_assessed", context, `${path}.nonClaims.entityMatch`);
  literal(nonClaims.currency, "not_assessed", context, `${path}.nonClaims.currency`);
  literal(nonClaims.speechEvidenceAuthority, "not_granted", context, `${path}.nonClaims.speechEvidenceAuthority`);
  const receipt = item as unknown as ResearchDocumentSnapshotReceipt;
  const { receiptId: _receiptId, ...withoutId } = receipt;
  if (receipt.receiptId !== researchReceiptId(withoutId)) fail(context, `${path}.receiptId`, "does not close the receipt body");
  return receipt;
}

export function validateResearchExhaustionReceipt(
  value: unknown,
  context = "Research exhaustion receipt",
  path = "receipt",
): ResearchExhaustionReceipt {
  const item = object(value, context, path);
  exact(item, [
    "schema", "receiptId", "runId", "authorization", "gap", "reason", "operations", "limits",
    "outcome", "nonClaims",
  ], context, path);
  literal(item.schema, "studio.research-exhaustion.receipt.v1", context, `${path}.schema`);
  const receiptIdValue = string(item.receiptId, context, `${path}.receiptId`);
  string(item.runId, context, `${path}.runId`);
  validateAuthorization(item.authorization, context, `${path}.authorization`);
  const authorization = object(item.authorization, context, `${path}.authorization`);
  if (!("executionId" in authorization) || !("launchClaimId" in authorization)) {
    fail(context, `${path}.authorization`, "requires bound executor lineage");
  }
  validateResearchGapBinding(item.gap, context, `${path}.gap`);
  const reason = oneOf<ResearchExhaustionReason>(item.reason, EXHAUSTION_REASONS, context, `${path}.reason`);
  const operations = array(item.operations, context, `${path}.operations`);
  if (operations.length !== RESEARCH_LIMITS.maxQueries) {
    fail(context, `${path}.operations`, "must bind the full registered query budget");
  }
  const operationIds: string[] = [];
  for (const [index, value] of operations.entries()) {
    const operation = object(value, context, `${path}.operations[${index}]`);
    exact(operation, ["operationId", "receiptArtifactId", "receiptId", "receiptContentId"], context, `${path}.operations[${index}]`);
    operationIds.push(string(operation.operationId, context, `${path}.operations[${index}].operationId`));
    string(operation.receiptArtifactId, context, `${path}.operations[${index}].receiptArtifactId`);
    string(operation.receiptId, context, `${path}.operations[${index}].receiptId`);
    contentId(operation.receiptContentId, context, `${path}.operations[${index}].receiptContentId`);
  }
  if (new Set(operationIds).size !== operationIds.length || operationIds.some((id, index) => index > 0 && id.localeCompare(operationIds[index - 1]) <= 0)) {
    fail(context, `${path}.operations`, "must contain unique operation identities in canonical order");
  }
  validateResearchLimits(item.limits, context, `${path}.limits`);
  literal(item.outcome, "r1_insufficient", context, `${path}.outcome`);
  if (reason === "query_budget_exhausted_without_results" && operations.length !== RESEARCH_LIMITS.maxQueries) {
    fail(context, `${path}.operations`, "must exhaust the query budget");
  }
  const nonClaims = object(item.nonClaims, context, `${path}.nonClaims`);
  exact(nonClaims, [
    "semanticInsufficiency", "sourceTruth", "entityMatch", "speechEvidenceAuthority",
    "claimSupportAuthority", "captionAuthority", "r2Authorization",
  ], context, `${path}.nonClaims`);
  literal(nonClaims.semanticInsufficiency, "not_assessed", context, `${path}.nonClaims.semanticInsufficiency`);
  literal(nonClaims.sourceTruth, "not_assessed", context, `${path}.nonClaims.sourceTruth`);
  literal(nonClaims.entityMatch, "not_assessed", context, `${path}.nonClaims.entityMatch`);
  literal(nonClaims.speechEvidenceAuthority, "not_granted", context, `${path}.nonClaims.speechEvidenceAuthority`);
  literal(nonClaims.claimSupportAuthority, "not_granted", context, `${path}.nonClaims.claimSupportAuthority`);
  literal(nonClaims.captionAuthority, "not_granted", context, `${path}.nonClaims.captionAuthority`);
  literal(nonClaims.r2Authorization, "cause_only", context, `${path}.nonClaims.r2Authorization`);
  const receipt = item as unknown as ResearchExhaustionReceipt;
  const { receiptId: _receiptId, ...withoutId } = receipt;
  if (receiptIdValue !== researchExhaustionReceiptId(withoutId)) {
    fail(context, `${path}.receiptId`, "does not close the receipt body");
  }
  return receipt;
}

export function validateResearchTriggerOption(value: unknown, context: string, path: string): ResearchTriggerOption {
  const item = object(value, context, path);
  exact(item, ["triggerId", "source", "gap"], context, path);
  const triggerIdValue = string(item.triggerId, context, `${path}.triggerId`);
  const source = validateResearchQualifiedMedia(item.source, context, `${path}.source`);
  const gap = object(item.gap, context, `${path}.gap`);
  exact(gap, ["kind", "studyId", "studyArtifactId", "studyContentId", "conflictId", "coverageId", "detail"], context, `${path}.gap`);
  literal(gap.kind, "unresolved_study_conflict", context, `${path}.gap.kind`);
  for (const key of ["studyId", "studyArtifactId", "conflictId", "coverageId", "detail"]) {
    string(gap[key], context, `${path}.gap.${key}`);
  }
  contentId(gap.studyContentId, context, `${path}.gap.studyContentId`);
  const option = item as unknown as ResearchTriggerOption;
  const { triggerId: _triggerId, ...withoutId } = option;
  if (triggerIdValue !== researchTriggerId(withoutId)) fail(context, `${path}.triggerId`, "does not close the trigger body");
  return { triggerId: triggerIdValue, source, gap: option.gap };
}

export function validateResearchRequestInput(value: unknown, context = "Research request input", path = "input"): ResearchRequestInput {
  const item = object(value, context, path);
  exact(item, ["schema", "runId", "inputId", "triggers"], context, path);
  literal(item.schema, "studio.research-request-input.v1", context, `${path}.schema`);
  string(item.runId, context, `${path}.runId`);
  const inputIdValue = string(item.inputId, context, `${path}.inputId`);
  const triggers = array(item.triggers, context, `${path}.triggers`);
  triggers.forEach((entry, index) => validateResearchTriggerOption(entry, context, `${path}.triggers[${index}]`));
  const input = item as unknown as ResearchRequestInput;
  const { inputId: _inputId, ...withoutId } = input;
  if (inputIdValue !== researchRequestInputId(withoutId)) fail(context, `${path}.inputId`, "does not close the input body");
  return input;
}

function sortedUniqueStrings(value: unknown, context: string, path: string): string[] {
  const values = uniqueStrings(value, context, path);
  if (values.some((entry, index) => index > 0 && values[index - 1].localeCompare(entry) > 0)) {
    fail(context, path, "must be sorted");
  }
  return values;
}

export function validateRestudiedResearchBasis(
  value: unknown,
  context = "Restudied research basis",
  path = "basis",
): RestudiedResearchBasis {
  const item = object(value, context, path);
  exact(item, ["basisId", "root", "reports", "passes"], context, path);
  const basisIdValue = string(item.basisId, context, `${path}.basisId`);
  const root = object(item.root, context, `${path}.root`);
  exact(root, ["taskId", "agentId", "executionId"], context, `${path}.root`);
  for (const key of ["taskId", "agentId", "executionId"]) string(root[key], context, `${path}.root.${key}`);
  const reports = array(item.reports, context, `${path}.reports`);
  if (reports.length < 2) fail(context, `${path}.reports`, "requires at least two admitted and read reports");
  let priorAdmissionId: string | null = null;
  for (const [index, value] of reports.entries()) {
    const report = object(value, context, `${path}.reports[${index}]`);
    exact(report, ["admissionId", "admissionReceiptContentId", "reportArtifactId", "reportContentId", "readOperationId", "readReceiptContentId"], context, `${path}.reports[${index}]`);
    const admissionId = string(report.admissionId, context, `${path}.reports[${index}].admissionId`);
    if (priorAdmissionId !== null && priorAdmissionId.localeCompare(admissionId) >= 0) fail(context, `${path}.reports`, "must be uniquely sorted by admissionId");
    priorAdmissionId = admissionId;
    contentId(report.admissionReceiptContentId, context, `${path}.reports[${index}].admissionReceiptContentId`);
    string(report.reportArtifactId, context, `${path}.reports[${index}].reportArtifactId`);
    contentId(report.reportContentId, context, `${path}.reports[${index}].reportContentId`);
    string(report.readOperationId, context, `${path}.reports[${index}].readOperationId`);
    contentId(report.readReceiptContentId, context, `${path}.reports[${index}].readReceiptContentId`);
  }
  const passes = array(item.passes, context, `${path}.passes`);
  let priorPassId: string | null = null;
  for (const [index, value] of passes.entries()) {
    const pass = object(value, context, `${path}.passes[${index}]`);
    exact(pass, ["passId", "requestReceiptContentId", "terminalReceiptContentId"], context, `${path}.passes[${index}]`);
    const passId = string(pass.passId, context, `${path}.passes[${index}].passId`);
    if (priorPassId !== null && priorPassId.localeCompare(passId) >= 0) fail(context, `${path}.passes`, "must be uniquely sorted by passId");
    priorPassId = passId;
    contentId(pass.requestReceiptContentId, context, `${path}.passes[${index}].requestReceiptContentId`);
    contentId(pass.terminalReceiptContentId, context, `${path}.passes[${index}].terminalReceiptContentId`);
  }
  const basis = item as unknown as RestudiedResearchBasis;
  const { basisId: _basisId, ...withoutId } = basis;
  if (basisIdValue !== restudiedResearchBasisId(withoutId)) fail(context, `${path}.basisId`, "does not close the basis body");
  return basis;
}

export function validateRestudiedResearchTriggerOption(
  value: unknown,
  context = "Restudied research trigger",
  path = "trigger",
): RestudiedResearchTriggerOption {
  const item = object(value, context, path);
  exact(item, ["triggerId", "basisId", "source", "gap", "evidence"], context, path);
  const triggerIdValue = string(item.triggerId, context, `${path}.triggerId`);
  string(item.basisId, context, `${path}.basisId`);
  validateResearchQualifiedMedia(item.source, context, `${path}.source`);
  const gap = object(item.gap, context, `${path}.gap`);
  exact(gap, ["kind", "coverageId", "detail"], context, `${path}.gap`);
  literal(gap.kind, "unresolved_restudy_conflict", context, `${path}.gap.kind`);
  string(gap.coverageId, context, `${path}.gap.coverageId`);
  string(gap.detail, context, `${path}.gap.detail`);
  const evidence = object(item.evidence, context, `${path}.evidence`);
  exact(evidence, ["state", "preservedStates", "rawStates", "claimIds", "citationIds", "passIds"], context, `${path}.evidence`);
  literal(evidence.state, "conflicting", context, `${path}.evidence.state`);
  for (const key of ["preservedStates", "rawStates", "claimIds", "citationIds", "passIds"]) {
    sortedUniqueStrings(evidence[key], context, `${path}.evidence.${key}`);
  }
  const trigger = item as unknown as RestudiedResearchTriggerOption;
  const { triggerId: _triggerId, ...withoutId } = trigger;
  if (triggerIdValue !== restudiedResearchTriggerId(withoutId)) fail(context, `${path}.triggerId`, "does not close the trigger body");
  return trigger;
}

export function validateRestudiedResearchRequestInput(
  value: unknown,
  context = "Restudied research request input",
  path = "input",
): RestudiedResearchRequestInput {
  const item = object(value, context, path);
  exact(item, ["schema", "runId", "inputId", "basis", "triggers"], context, path);
  literal(item.schema, "studio.research-request-input.v2", context, `${path}.schema`);
  string(item.runId, context, `${path}.runId`);
  const inputIdValue = string(item.inputId, context, `${path}.inputId`);
  const basis = validateRestudiedResearchBasis(item.basis, context, `${path}.basis`);
  const triggers = array(item.triggers, context, `${path}.triggers`);
  let priorTriggerId: string | null = null;
  for (const [index, value] of triggers.entries()) {
    const trigger = validateRestudiedResearchTriggerOption(value, context, `${path}.triggers[${index}]`);
    if (trigger.basisId !== basis.basisId) fail(context, `${path}.triggers[${index}].basisId`, "must match the input basis");
    if (priorTriggerId !== null && priorTriggerId.localeCompare(trigger.triggerId) >= 0) fail(context, `${path}.triggers`, "must be uniquely sorted by triggerId");
    priorTriggerId = trigger.triggerId;
  }
  const input = item as unknown as RestudiedResearchRequestInput;
  const { inputId: _inputId, ...withoutId } = input;
  if (inputIdValue !== restudiedResearchRequestInputId(withoutId)) fail(context, `${path}.inputId`, "does not close the input body");
  return input;
}

export function validateResearchRequestReceipt(value: unknown, context = "Research request receipt", path = "receipt"): ResearchRequestReceipt {
  const item = object(value, context, path);
  exact(item, ["schema", "receiptId", "runId", "inputId", "trigger", "gap"], context, path);
  literal(item.schema, "studio.research-request.receipt.v1", context, `${path}.schema`);
  const receiptIdValue = string(item.receiptId, context, `${path}.receiptId`);
  string(item.runId, context, `${path}.runId`);
  string(item.inputId, context, `${path}.inputId`);
  const trigger = validateResearchTriggerOption(item.trigger, context, `${path}.trigger`);
  const gap = validateResearchGapBinding(item.gap, context, `${path}.gap`);
  if (
    gap.triggerId !== trigger.triggerId || gap.inputId !== item.inputId ||
    gap.hypothesis !== trigger.gap.detail ||
    gap.media.artifactId !== trigger.source.artifactId || gap.media.contentId !== trigger.source.contentId ||
    gap.media.trackId !== trigger.source.trackId ||
    gap.media.startMs !== trigger.source.startMs || gap.media.endMs !== trigger.source.endMs
  ) fail(context, `${path}.gap`, "must bind exactly to the selected trigger");
  const receipt = item as unknown as ResearchRequestReceipt;
  const { receiptId: _receiptId, ...withoutId } = receipt;
  if (receiptIdValue !== researchRequestReceiptId(withoutId)) fail(context, `${path}.receiptId`, "does not close the receipt body");
  return receipt;
}
