export const RESEARCH_CAPABILITY = "research.investigate" as const;

export const RESEARCH_HOST_ARTIFACT_KINDS = [
  "studio.research-search.receipt.v1",
  "studio.research-document-snapshot.v1",
  "studio.research-extraction.v1",
  "studio.research-document-snapshot.receipt.v1",
  "studio.research-exhaustion.receipt.v1",
] as const;

export function isResearchHostArtifactKind(value: string): boolean {
  return (RESEARCH_HOST_ARTIFACT_KINDS as readonly string[]).includes(value);
}

/** Closed MIME allowlist. The grant scope cannot widen it. */
export const RESEARCH_ALLOWED_MIME_TYPES = ["text/html", "text/plain"] as const;

export type ResearchAllowedMimeType = (typeof RESEARCH_ALLOWED_MIME_TYPES)[number];

export const RESEARCH_LIMITS = {
  maxQueries: 2,
  maxQueryChars: 256,
  maxResultsPerQuery: 8,
  maxSnippetChars: 512,
  maxTitleChars: 256,
  maxDocuments: 2,
  maxDocumentBytes: 1_048_576,
  maxRedirects: 3,
  maxUrlChars: 2048,
  maxAllowedDomains: 8,
  maxExtractionUnits: 200_000,
  maxJsonArtifactBytes: 262_144,
  maxWallMs: 60_000,
  maxCalls: 4,
} as const;

export interface ResearchLimits {
  maxQueries: number;
  maxQueryChars: number;
  maxResultsPerQuery: number;
  maxSnippetChars: number;
  maxTitleChars: number;
  maxDocuments: number;
  maxDocumentBytes: number;
  maxRedirects: number;
  maxUrlChars: number;
  maxAllowedDomains: number;
  maxExtractionUnits: number;
  maxJsonArtifactBytes: number;
  maxWallMs: number;
  maxCalls: number;
}

/** Integer millisecond, half-open range on one owned media track. */
export interface ResearchQualifiedMedia {
  artifactId: string;
  contentId: string;
  trackId: string;
  startMs: number;
  endMs: number;
}

/**
 * Exact unresolved gap the grant is scoped to. Research context can only qualify this media
 * range; it cannot roam or attach to other ranges.
 */
export interface ResearchGapBinding {
  inputId: string;
  triggerId: string;
  hypothesis: string;
  media: ResearchQualifiedMedia;
}

export interface ResearchGrantScope {
  schema: "studio.research-grant.v1";
  limits: ResearchLimits;
  /** Exact lowercase https hostnames. Empty means no egress is possible under this grant. */
  allowedDomains: string[];
  gap: ResearchGapBinding;
}

/**
 * Narrow grant view shared by the scheduler-issued CapabilityGrant union member and research hosts.
 */
export interface ResearchCapabilityGrant {
  id: string;
  capability: typeof RESEARCH_CAPABILITY;
  researchScope: ResearchGrantScope;
}

/** Task view injected by the host owner. Callers never supply task/agent/grant identities. */
export interface ResearchGrantView {
  taskId: string;
  agentId: string;
  grants: ResearchCapabilityGrant[];
}

/**
 * Executor lineage resolved by the launcher from its own executor.started mint. Fixtures that
 * run the host outside a RuntimeLedger execution omit the binding entirely; they never invent
 * placeholder identities.
 */
export interface ResearchExecutionBinding {
  executionId: string;
  launchClaimId: string;
}

/**
 * Two closed shapes, never a partial mix: ledger-bound receipts always carry the executor
 * lineage; unbound fixture receipts always omit it.
 */
export type ResearchReceiptAuthorization =
  | { grantId: string; taskId: string; agentId: string }
  | { grantId: string; taskId: string; agentId: string; executionId: string; launchClaimId: string };

export interface ResearchSearchRequest {
  operationId: string;
  taskId: string;
  agentId: string;
  grantId: string;
  op: "search";
  query: string;
}

/**
 * Path-free by construction: the document to snapshot is named as an index into a completed
 * search receipt owned by the same grant, never as a caller-supplied URL.
 */
export interface ResearchSnapshotRequest {
  operationId: string;
  taskId: string;
  agentId: string;
  grantId: string;
  op: "document_snapshot";
  searchOperationId: string;
  resultIndex: number;
}

export type ResearchRequest = ResearchSearchRequest | ResearchSnapshotRequest;

export interface ResearchSearchResult {
  index: number;
  canonicalUrl: string;
  title: string;
  snippet: string;
  snippetRole: "routing_hint_not_citation";
}

export type ResearchSearchState = "available" | "empty" | "truncated";

export interface ResearchSearchReceipt {
  schema: "studio.research-search.receipt.v1";
  receiptId: string;
  operationId: string;
  runId: string;
  capability: typeof RESEARCH_CAPABILITY;
  authorization: ResearchReceiptAuthorization;
  gap: ResearchGapBinding;
  provider: { id: string; version: string };
  query: string;
  results: ResearchSearchResult[];
  limits: ResearchLimits;
  allowedDomains: string[];
  retrievedAt: string;
  state: ResearchSearchState;
  nonClaims: {
    snippetEvidence: "routing_hint_only";
    sourceTruth: "not_assessed";
  };
}

export interface ResearchRedirectHop {
  url: string;
  status: number;
  location: string;
}

export type ResearchExtractionMethod = "html_text_v1" | "plain_text_v1";

export interface ResearchExtractionArtifact {
  schema: "studio.research-extraction.v1";
  operationId: string;
  runId: string;
  method: ResearchExtractionMethod;
  sourceDocumentContentId: string;
  unit: "utf8_byte";
  unitCount: number;
  text: string;
}

export interface ResearchDocumentSnapshotReceipt {
  schema: "studio.research-document-snapshot.receipt.v1";
  receiptId: string;
  operationId: string;
  runId: string;
  capability: typeof RESEARCH_CAPABILITY;
  authorization: ResearchReceiptAuthorization;
  gap: ResearchGapBinding;
  search: {
    operationId: string;
    receiptId: string;
    receiptContentId: string;
    resultIndex: number;
  };
  request: { url: string };
  redirectChain: ResearchRedirectHop[];
  finalUrl: string;
  response: {
    status: number;
    mimeType: ResearchAllowedMimeType;
    declaredContentLength: number | null;
    headersDigest: string;
  };
  document: { artifactId: string; contentId: string; bytes: number };
  extraction: {
    artifactId: string;
    contentId: string;
    bytes: number;
    method: ResearchExtractionMethod;
    unit: "utf8_byte";
    unitCount: number;
  };
  retrievedAt: string;
  limits: ResearchLimits;
  allowedDomains: string[];
  /**
   * The snapshot proves what the destination served at retrieval time over a validated public
   * https route. Without a pinned socket dialer the address is re-resolved between the policy
   * check and the fetch, so a hostile nameserver rotating answers is out of scope for this
   * receipt and is stated rather than hidden.
   */
  egressPolicy: {
    dnsRebindingWindow: "checked_before_fetch_not_pinned";
    cookies: "never_sent_never_stored";
  };
  state: "available";
  nonClaims: {
    snapshotTruth: "retrieval_time_only";
    entityMatch: "not_assessed";
    currency: "not_assessed";
    speechEvidenceAuthority: "not_granted";
  };
}

export type ResearchFailureReason =
  | "destination_not_allowed"
  | "private_destination"
  | "scheme_not_allowed"
  | "credentials_in_url"
  | "port_not_allowed"
  | "url_too_long"
  | "redirect_limit_exceeded"
  | "mime_not_allowed"
  | "byte_limit_exceeded"
  | "wall_timeout"
  | "fetch_failed"
  | "provider_result_invalid"
  | "artifact_oversized";

/** One research trigger derived from a reopened, content-verified unresolved study conflict. */
export interface ResearchTriggerOption {
  triggerId: string;
  source: ResearchQualifiedMedia;
  gap: {
    kind: "unresolved_study_conflict";
    studyId: string;
    studyArtifactId: string;
    studyContentId: string;
    conflictId: string;
    coverageId: string;
    detail: string;
  };
}

export interface ResearchRequestInput {
  schema: "studio.research-request-input.v1";
  runId: string;
  inputId: string;
  triggers: ResearchTriggerOption[];
}

export interface ResearchRequestReceipt {
  schema: "studio.research-request.receipt.v1";
  receiptId: string;
  runId: string;
  inputId: string;
  trigger: ResearchTriggerOption;
  /** Exact scope a scheduler-issued grant must carry for this request. */
  gap: ResearchGapBinding;
}

/**
 * Journal-projected research operation, the ledger-bound relocation of the in-host
 * ResearchOperationRegistry record. One record per started operation, both ops; failed
 * operations keep charging grant and task budgets exactly like the registry.
 */
export interface ResearchOperationRecord {
  id: string;
  op: "search" | "document_snapshot";
  taskId: string;
  agentId: string;
  grantId: string;
  executionId: string;
  launchClaimId: string;
  requestFingerprint: string;
  gap: ResearchGapBinding;
  status: "started" | "completed" | "failed";
  query: string | null;
  searchOperationId: string | null;
  resultIndex: number | null;
  receiptArtifactId: string | null;
  receiptId: string | null;
  receiptContentId: string | null;
  documentArtifactId: string | null;
  extractionArtifactId: string | null;
  /** Completed search operations record their result count so snapshot admission stays closed. */
  searchResultCount: number | null;
  failure: ResearchFailureReason | null;
}

/**
 * Closed R1 insufficiency cause. It proves that the full search-query budget returned no result
 * identities to snapshot; it does not claim that any source was semantically irrelevant.
 */
export type ResearchExhaustionReason = "query_budget_exhausted_without_results";

export interface ResearchExhaustionOperationBinding {
  operationId: string;
  receiptArtifactId: string;
  receiptId: string;
  receiptContentId: string;
}

export interface ResearchExhaustionReceipt {
  schema: "studio.research-exhaustion.receipt.v1";
  receiptId: string;
  runId: string;
  authorization: Extract<ResearchReceiptAuthorization, { executionId: string }>;
  gap: ResearchGapBinding;
  reason: ResearchExhaustionReason;
  operations: ResearchExhaustionOperationBinding[];
  limits: ResearchLimits;
  outcome: "r1_insufficient";
  nonClaims: {
    semanticInsufficiency: "not_assessed";
    sourceTruth: "not_assessed";
    entityMatch: "not_assessed";
    speechEvidenceAuthority: "not_granted";
    claimSupportAuthority: "not_granted";
    captionAuthority: "not_granted";
    r2Authorization: "cause_only";
  };
}

/** Durable projection record consumed by later R2 authorization. */
export interface ResearchExhaustionRecord {
  id: string;
  taskId: string;
  agentId: string;
  grantId: string;
  executionId: string;
  launchClaimId: string;
  gap: ResearchGapBinding;
  reason: ResearchExhaustionReason;
  operationIds: string[];
  outputArtifactId: string;
  receiptContentId: string;
}
