import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";

import { ContentAddressedArtifactStore } from "../artifactStore.ts";
import {
  researchDocumentArtifactId,
  researchExtractionArtifactId,
  researchSearchReceiptArtifactId,
  researchSnapshotReceiptArtifactId,
} from "../artifactStore/researchArtifacts.ts";
import {
  RESEARCH_CAPABILITY,
  type ResearchDocumentSnapshotReceipt,
  type ResearchExtractionArtifact,
  type ResearchGrantView,
  type ResearchSearchReceipt,
  type ResearchSearchResult,
  type ResearchSnapshotRequest,
} from "../model/research.ts";
import {
  researchReceiptId,
  validateResearchExtractionArtifact,
  validateResearchSearchReceipt,
  validateResearchSnapshotReceipt,
} from "../validation/research.ts";
import { auditResearchSearch } from "./researchAudit.ts";
import { fetchResearchDocument, ResearchEgressError, type ResearchDnsLookup, type ResearchFetcher } from "./egressPolicy.ts";
import { extractResearchText, researchExtractionMethodFor } from "./extraction.ts";
import { authorizeResearch, ResearchOperationRegistry } from "./researchAuthorization.ts";
import type { ResearchProviderResult, ResearchSearchProvider } from "./provider.ts";

export async function withWallDeadline<T>(work: Promise<T>, deadlineAtMs: number): Promise<T> {
  const remainingMs = Math.floor(deadlineAtMs - performance.now());
  if (remainingMs <= 0) throw new ResearchEgressError("wall_timeout", "Research exhausted its wall-time grant");
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new ResearchEgressError("wall_timeout", "Research exhausted its wall-time grant")), remainingMs);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export interface VerifiedResearchSearch {
  receipt: ResearchSearchReceipt;
  receiptContentId: string;
  receiptArtifactId: string;
  storageKey: string;
}

export interface VerifiedResearchSnapshot {
  receipt: ResearchDocumentSnapshotReceipt;
  receiptContentId: string;
  receiptArtifactId: string;
  document: { artifactId: string; contentId: string; bytes: number };
  extraction: {
    envelope: ResearchExtractionArtifact;
    artifactId: string;
    contentId: string;
    bytes: number;
  };
}

/**
 * Host-owned bounded research producer. The model never sees a fetch, a socket, or a path:
 * search goes through the provider seam, documents are reachable only as indexes into this
 * host's own search receipts, and every operation leaves content-addressed receipts.
 */
export class BoundedResearchHost {
  private readonly runId: string;
  private readonly view: ResearchGrantView;
  private readonly artifacts: ContentAddressedArtifactStore;
  private readonly provider: ResearchSearchProvider;
  private readonly fetcher: ResearchFetcher | undefined;
  private readonly lookup: ResearchDnsLookup | undefined;
  private readonly now: () => string;
  private readonly registry = new ResearchOperationRegistry();

  constructor(
    runId: string,
    view: ResearchGrantView,
    artifacts: ContentAddressedArtifactStore,
    options: {
      searchProvider: ResearchSearchProvider;
      fetcher?: ResearchFetcher;
      lookup?: ResearchDnsLookup;
      now?: () => string;
    },
  ) {
    this.runId = runId;
    this.view = structuredClone(view);
    this.artifacts = artifacts;
    this.provider = options.searchProvider;
    this.fetcher = options.fetcher;
    this.lookup = options.lookup;
    this.now = options.now ?? (() => new Date().toISOString());
  }

  async search(requestValue: unknown): Promise<VerifiedResearchSearch> {
    const start = performance.now();
    const authorized = authorizeResearch(this.view, this.registry, requestValue);
    const { request, grant, scope } = authorized;
    if (request.op !== "search") throw new Error("Research search received a non-search request");
    this.registry.start({ operationId: request.operationId, grantId: grant.id, op: "search", fingerprint: authorized.fingerprint });
    try {
      const deadlineAtMs = start + scope.limits.maxWallMs;
      let raw: ResearchProviderResult[];
      try {
        raw = await withWallDeadline(
          this.provider.search(request.query, { maxResults: scope.limits.maxResultsPerQuery + 1, deadlineAtMs }),
          deadlineAtMs,
        );
      } catch (error) {
        if (error instanceof ResearchEgressError) throw error;
        throw new ResearchEgressError("provider_result_invalid", "Research provider failed to return results");
      }
      if (!Array.isArray(raw)) throw new ResearchEgressError("provider_result_invalid", "Research provider returned a non-array result set");
      const truncated = raw.length > scope.limits.maxResultsPerQuery;
      const results: ResearchSearchResult[] = raw.slice(0, scope.limits.maxResultsPerQuery).map((entry, index) => {
        if (entry === null || typeof entry !== "object" || typeof entry.url !== "string" ||
            typeof entry.title !== "string" || typeof entry.snippet !== "string") {
          throw new ResearchEgressError("provider_result_invalid", "Research provider returned a malformed result entry");
        }
        let canonicalUrl: string;
        try {
          canonicalUrl = new URL(entry.url).href;
        } catch {
          throw new ResearchEgressError("provider_result_invalid", "Research provider returned an unparseable result URL");
        }
        if (!canonicalUrl.startsWith("https://") || canonicalUrl.length > scope.limits.maxUrlChars) {
          throw new ResearchEgressError("provider_result_invalid", "Research provider returned a result outside the https URL bounds");
        }
        const title = entry.title.trim();
        const snippet = entry.snippet.trim();
        if (
          title.length === 0 || title.length > scope.limits.maxTitleChars ||
          snippet.length === 0 || snippet.length > scope.limits.maxSnippetChars
        ) {
          throw new ResearchEgressError("provider_result_invalid", "Research provider returned a result outside the closed text bounds");
        }
        return { index, canonicalUrl, title, snippet, snippetRole: "routing_hint_not_citation" as const };
      });
      const body: Omit<ResearchSearchReceipt, "receiptId"> = {
        schema: "studio.research-search.receipt.v1",
        operationId: request.operationId,
        runId: this.runId,
        capability: RESEARCH_CAPABILITY,
        authorization: { grantId: grant.id, taskId: request.taskId, agentId: request.agentId },
        gap: structuredClone(scope.gap),
        provider: { id: this.provider.id, version: this.provider.version },
        query: request.query,
        results,
        limits: structuredClone(scope.limits),
        allowedDomains: [...scope.allowedDomains],
        retrievedAt: this.now(),
        state: truncated ? "truncated" : results.length === 0 ? "empty" : "available",
        nonClaims: { snippetEvidence: "routing_hint_only", sourceTruth: "not_assessed" },
      };
      const receipt = validateResearchSearchReceipt({ ...body, receiptId: researchReceiptId(body) });
      const stored = await this.artifacts.storeJson(receipt);
      if (stored.content.bytes > scope.limits.maxJsonArtifactBytes) {
        throw new ResearchEgressError("artifact_oversized", "Research search receipt exceeds its byte ceiling");
      }
      if (performance.now() - start > scope.limits.maxWallMs) {
        throw new ResearchEgressError("wall_timeout", "Research search exceeded its wall-time grant");
      }
      const receiptArtifactId = researchSearchReceiptArtifactId(this.runId, request.operationId, stored.content.contentId);
      this.registry.completeSearch(request.operationId, {
        operationId: request.operationId,
        grantId: grant.id,
        receipt,
        receiptContentId: stored.content.contentId,
        receiptArtifactId,
      });
      return { receipt, receiptContentId: stored.content.contentId, receiptArtifactId, storageKey: stored.storageKey };
    } catch (error) {
      this.registry.fail(request.operationId);
      throw error;
    }
  }

  async snapshotDocument(requestValue: unknown): Promise<VerifiedResearchSnapshot> {
    const start = performance.now();
    const authorized = authorizeResearch(this.view, this.registry, requestValue);
    const { grant, scope } = authorized;
    const request = authorized.request as ResearchSnapshotRequest;
    if (request.op !== "document_snapshot" || !authorized.search) {
      throw new Error("Research snapshot received a non-snapshot request");
    }
    this.registry.start({ operationId: request.operationId, grantId: grant.id, op: "document_snapshot", fingerprint: authorized.fingerprint });
    try {
      const deadlineAtMs = start + scope.limits.maxWallMs;
      const reopenedSearch = await auditResearchSearch(this.artifacts, this.runId, authorized.search.receiptContentId);
      const storedSearch = reopenedSearch.receipt;
      if (
        storedSearch.receiptId !== authorized.search.receipt.receiptId ||
        storedSearch.authorization.grantId !== grant.id
      ) {
        throw new Error("Research snapshot search receipt drifted from its recorded identity");
      }
      const result = storedSearch.results[request.resultIndex];
      if (!result) throw new Error("Research snapshot names a result outside the reopened search receipt");
      const fetched = await fetchResearchDocument(result.canonicalUrl, {
        allowedDomains: scope.allowedDomains,
        deadlineAtMs,
        fetcher: this.fetcher,
        lookup: this.lookup,
      });
      const temporaryDirectory = await mkdtemp(join(tmpdir(), "studio-research-"));
      let documentPrepared: Awaited<ReturnType<ContentAddressedArtifactStore["prepareDerived"]>>;
      try {
        const documentPath = join(temporaryDirectory, "document");
        await writeFile(documentPath, fetched.bytes, { mode: 0o600, flag: "wx" });
        documentPrepared = await this.artifacts.prepareDerived(documentPath, {
          runId: this.runId,
          kind: "studio.research-document-snapshot.v1",
          operationId: request.operationId,
          publication: "private",
          durationMs: 0,
          tracks: [],
        });
      } finally {
        await rm(temporaryDirectory, { recursive: true, force: true });
      }
      if (documentPrepared.artifactId !== researchDocumentArtifactId(this.runId, request.operationId, documentPrepared.content.contentId)) {
        throw new Error("Research document artifact identity is not derivable");
      }
      const method = researchExtractionMethodFor(fetched.mimeType);
      const text = extractResearchText(fetched.bytes, method);
      const unitCount = Buffer.byteLength(text, "utf8");
      if (unitCount === 0) throw new Error("Research extraction produced no text to cite");
      if (unitCount > scope.limits.maxExtractionUnits) {
        throw new ResearchEgressError("artifact_oversized", "Research extraction exceeds its closed size");
      }
      const extraction = validateResearchExtractionArtifact({
        schema: "studio.research-extraction.v1",
        operationId: request.operationId,
        runId: this.runId,
        method,
        sourceDocumentContentId: documentPrepared.content.contentId,
        unit: "utf8_byte",
        unitCount,
        text,
      });
      const storedExtraction = await this.artifacts.storeJson(extraction);
      if (storedExtraction.content.bytes > scope.limits.maxJsonArtifactBytes) {
        throw new ResearchEgressError("artifact_oversized", "Research extraction artifact exceeds its byte ceiling");
      }
      const extractionArtifactId = researchExtractionArtifactId(this.runId, request.operationId, storedExtraction.content.contentId);
      const body: Omit<ResearchDocumentSnapshotReceipt, "receiptId"> = {
        schema: "studio.research-document-snapshot.receipt.v1",
        operationId: request.operationId,
        runId: this.runId,
        capability: RESEARCH_CAPABILITY,
        authorization: { grantId: grant.id, taskId: request.taskId, agentId: request.agentId },
        gap: structuredClone(scope.gap),
        search: {
          operationId: storedSearch.operationId,
          receiptId: storedSearch.receiptId,
          receiptContentId: authorized.search.receiptContentId,
          resultIndex: request.resultIndex,
        },
        request: { url: result.canonicalUrl },
        redirectChain: fetched.redirectChain,
        finalUrl: fetched.finalUrl,
        response: {
          status: fetched.status,
          mimeType: fetched.mimeType,
          declaredContentLength: fetched.declaredContentLength,
          headersDigest: fetched.headersDigest,
        },
        document: {
          artifactId: documentPrepared.artifactId,
          contentId: documentPrepared.content.contentId,
          bytes: documentPrepared.content.bytes,
        },
        extraction: {
          artifactId: extractionArtifactId,
          contentId: storedExtraction.content.contentId,
          bytes: storedExtraction.content.bytes,
          method,
          unit: "utf8_byte",
          unitCount,
        },
        retrievedAt: this.now(),
        limits: structuredClone(scope.limits),
        allowedDomains: [...scope.allowedDomains],
        egressPolicy: {
          dnsRebindingWindow: "checked_before_fetch_not_pinned",
          cookies: "never_sent_never_stored",
        },
        state: "available",
        nonClaims: {
          snapshotTruth: "retrieval_time_only",
          entityMatch: "not_assessed",
          currency: "not_assessed",
          speechEvidenceAuthority: "not_granted",
        },
      };
      const receipt = validateResearchSnapshotReceipt({ ...body, receiptId: researchReceiptId(body) });
      const storedReceipt = await this.artifacts.storeJson(receipt);
      if (storedReceipt.content.bytes > scope.limits.maxJsonArtifactBytes) {
        throw new ResearchEgressError("artifact_oversized", "Research snapshot receipt exceeds its byte ceiling");
      }
      if (performance.now() - start > scope.limits.maxWallMs) {
        throw new ResearchEgressError("wall_timeout", "Research snapshot exceeded its wall-time grant");
      }
      const receiptArtifactId = researchSnapshotReceiptArtifactId(this.runId, request.operationId, storedReceipt.content.contentId);
      this.registry.completeSnapshot(request.operationId);
      return {
        receipt,
        receiptContentId: storedReceipt.content.contentId,
        receiptArtifactId,
        document: {
          artifactId: documentPrepared.artifactId,
          contentId: documentPrepared.content.contentId,
          bytes: documentPrepared.content.bytes,
        },
        extraction: {
          envelope: extraction,
          artifactId: extractionArtifactId,
          contentId: storedExtraction.content.contentId,
          bytes: storedExtraction.content.bytes,
        },
      };
    } catch (error) {
      this.registry.fail(request.operationId);
      throw error;
    }
  }
}
