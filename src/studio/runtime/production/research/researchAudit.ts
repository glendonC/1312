import { createHash } from "node:crypto";

import { ContentAddressedArtifactStore } from "../artifactStore.ts";
import { canonicalJson, canonicalJsonContentId } from "../artifactStore/contentIdentity.ts";
import {
  researchDocumentArtifactId,
  researchExtractionArtifactId,
  researchSearchReceiptArtifactId,
  researchSnapshotReceiptArtifactId,
} from "../artifactStore/researchArtifacts.ts";
import {
  RESEARCH_LIMITS,
  type ResearchDocumentSnapshotReceipt,
  type ResearchExtractionArtifact,
  type ResearchSearchReceipt,
} from "../model/research.ts";
import {
  validateResearchExtractionArtifact,
  validateResearchSearchReceipt,
  validateResearchSnapshotReceipt,
} from "../validation/research.ts";
import { extractResearchText } from "./extraction.ts";

export interface VerifiedResearchSearchAudit {
  receipt: ResearchSearchReceipt;
  receiptContentId: string;
  receiptArtifactId: string;
}

export interface VerifiedResearchSnapshotAudit {
  receipt: ResearchDocumentSnapshotReceipt;
  receiptContentId: string;
  receiptArtifactId: string;
  search: VerifiedResearchSearchAudit;
  documentBytes: Buffer;
  extraction: {
    envelope: ResearchExtractionArtifact;
    artifactId: string;
    contentId: string;
    bytes: number;
  };
}

function same(left: unknown, right: unknown): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

async function storedCanonicalJson<T>(
  artifacts: ContentAddressedArtifactStore,
  contentId: string,
  label: string,
  validate: (value: unknown) => T,
): Promise<{ value: T; bytes: number }> {
  const bytes = await artifacts.receiptBytes(contentId);
  if (bytes.length <= 0 || bytes.length > RESEARCH_LIMITS.maxJsonArtifactBytes) {
    throw new Error(`${label} escapes its bounded JSON contract`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error(`${label} is not valid JSON`);
  }
  const value = validate(parsed);
  if (!bytes.equals(Buffer.from(`${canonicalJson(value)}\n`, "utf8")) || canonicalJsonContentId(value) !== contentId) {
    throw new Error(`${label} is not canonical content for its address`);
  }
  return { value, bytes: bytes.length };
}

export async function auditResearchSearch(
  artifacts: ContentAddressedArtifactStore,
  runId: string,
  receiptContentId: string,
): Promise<VerifiedResearchSearchAudit> {
  const { value: receipt } = await storedCanonicalJson(
    artifacts,
    receiptContentId,
    "Stored research search receipt",
    (value) => validateResearchSearchReceipt(value),
  );
  if (receipt.runId !== runId) throw new Error("Research search receipt belongs to another run");
  return {
    receipt,
    receiptContentId,
    receiptArtifactId: researchSearchReceiptArtifactId(runId, receipt.operationId, receiptContentId),
  };
}

/**
 * Cold audit from stored bytes alone: reopen the snapshot receipt, its originating search
 * receipt, the raw document, and the extraction; re-hash every address; re-run the pinned
 * extraction method; fail closed on any drift.
 */
export async function auditResearchSnapshot(
  artifacts: ContentAddressedArtifactStore,
  runId: string,
  receiptContentId: string,
): Promise<VerifiedResearchSnapshotAudit> {
  const { value: receipt } = await storedCanonicalJson(
    artifacts,
    receiptContentId,
    "Stored research snapshot receipt",
    (value) => validateResearchSnapshotReceipt(value),
  );
  if (receipt.runId !== runId) throw new Error("Research snapshot receipt belongs to another run");
  const search = await auditResearchSearch(artifacts, runId, receipt.search.receiptContentId);
  if (
    search.receipt.receiptId !== receipt.search.receiptId ||
    search.receipt.operationId !== receipt.search.operationId ||
    !same(search.receipt.authorization, receipt.authorization) ||
    !same(search.receipt.gap, receipt.gap) ||
    !same(search.receipt.allowedDomains, receipt.allowedDomains) ||
    !same(search.receipt.limits, receipt.limits)
  ) {
    throw new Error("Research snapshot drifted from its originating search grant lineage");
  }
  const namedResult = search.receipt.results[receipt.search.resultIndex];
  if (!namedResult || namedResult.canonicalUrl !== receipt.request.url) {
    throw new Error("Research snapshot URL is not the recorded search result it names");
  }
  const documentBytes = await artifacts.receiptBytes(receipt.document.contentId);
  const digest = createHash("sha256").update(documentBytes).digest("hex");
  if (
    `sha256:${digest}` !== receipt.document.contentId ||
    documentBytes.length !== receipt.document.bytes ||
    receipt.document.artifactId !== researchDocumentArtifactId(runId, receipt.operationId, receipt.document.contentId)
  ) {
    throw new Error("Research document bytes no longer match their receipted identity");
  }
  const { value: extraction, bytes: extractionBytes } = await storedCanonicalJson(
    artifacts,
    receipt.extraction.contentId,
    "Stored research extraction",
    (value) => validateResearchExtractionArtifact(value),
  );
  const replayedText = extractResearchText(documentBytes, receipt.extraction.method);
  if (
    extraction.operationId !== receipt.operationId || extraction.runId !== runId ||
    extraction.method !== receipt.extraction.method ||
    extraction.sourceDocumentContentId !== receipt.document.contentId ||
    extraction.unitCount !== receipt.extraction.unitCount ||
    extraction.text !== replayedText ||
    extractionBytes !== receipt.extraction.bytes ||
    receipt.extraction.artifactId !== researchExtractionArtifactId(runId, receipt.operationId, receipt.extraction.contentId)
  ) {
    throw new Error("Research extraction drifted from its pinned method over the stored document");
  }
  return {
    receipt,
    receiptContentId,
    receiptArtifactId: researchSnapshotReceiptArtifactId(runId, receipt.operationId, receiptContentId),
    search,
    documentBytes,
    extraction: {
      envelope: extraction,
      artifactId: receipt.extraction.artifactId,
      contentId: receipt.extraction.contentId,
      bytes: receipt.extraction.bytes,
    },
  };
}
