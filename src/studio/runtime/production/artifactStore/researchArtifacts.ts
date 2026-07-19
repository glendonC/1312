import { canonicalSha256 } from "../canonicalIdentity.ts";
import type {
  ContentIdentity,
  ResearchDocumentSnapshotReceipt,
  ResearchExhaustionReceipt,
  ResearchExtractionMethod,
  ResearchSearchReceipt,
  RuntimeArtifact,
} from "../model.ts";
import { assertRuntimeArtifact } from "../validation/artifacts.ts";

/**
 * Content-addressed research artifact identities. Derivation matches
 * ContentAddressedArtifactStore.prepareDerived ({runId, operationId, kind, contentId}) so ids stay
 * stable across projection origin wiring without mutating closed content hashes.
 */
function researchArtifactId(runId: string, operationId: string, kind: string, contentId: string): string {
  return `artifact:${canonicalSha256({ runId, operationId, kind, contentId })}`;
}

export function researchSearchReceiptArtifactId(runId: string, operationId: string, contentId: string): string {
  return researchArtifactId(runId, operationId, "studio.research-search.receipt.v1", contentId);
}

export function researchDocumentArtifactId(runId: string, operationId: string, contentId: string): string {
  return researchArtifactId(runId, operationId, "studio.research-document-snapshot.v1", contentId);
}

export function researchExtractionArtifactId(runId: string, operationId: string, contentId: string): string {
  return researchArtifactId(runId, operationId, "studio.research-extraction.v1", contentId);
}

export function researchSnapshotReceiptArtifactId(runId: string, operationId: string, contentId: string): string {
  return researchArtifactId(runId, operationId, "studio.research-document-snapshot.receipt.v1", contentId);
}

export function researchExhaustionReceiptArtifactId(runId: string, receiptId: string, contentId: string): string {
  return researchArtifactId(runId, receiptId, "studio.research-exhaustion.receipt.v1", contentId);
}

interface PreparedResearchObject {
  artifactId: string;
  content: ContentIdentity;
  storageKey: string;
}

function privateResearchRow(input: {
  runId: string;
  taskId: string;
  agentId: string;
  kind: string;
  prepared: PreparedResearchObject;
  sourceArtifactIds: string[];
  origin: RuntimeArtifact["origin"];
}): RuntimeArtifact {
  const artifact: RuntimeArtifact = {
    schema: "studio.runtime.artifact.v1",
    id: input.prepared.artifactId,
    runId: input.runId,
    kind: input.kind,
    mediaClass: "non_media",
    publication: "private",
    content: input.prepared.content,
    storageKey: input.prepared.storageKey,
    durationMs: null,
    tracks: [],
    sourceArtifactIds: input.sourceArtifactIds,
    producerTaskId: input.taskId,
    producerAgentId: input.agentId,
    origin: input.origin,
  };
  assertRuntimeArtifact(artifact);
  return artifact;
}

export function buildResearchSearchReceiptArtifact(input: {
  runId: string;
  taskId: string;
  agentId: string;
  receipt: ResearchSearchReceipt;
  prepared: PreparedResearchObject;
}): RuntimeArtifact {
  return privateResearchRow({
    runId: input.runId,
    taskId: input.taskId,
    agentId: input.agentId,
    kind: "studio.research-search.receipt.v1",
    prepared: input.prepared,
    sourceArtifactIds: [],
    origin: { kind: "research_search_receipt", operationId: input.receipt.operationId, receiptId: input.receipt.receiptId },
  });
}

export function buildResearchDocumentArtifact(input: {
  runId: string;
  taskId: string;
  agentId: string;
  operationId: string;
  searchOperationId: string;
  searchReceiptArtifactId: string;
  resultIndex: number;
  prepared: PreparedResearchObject;
}): RuntimeArtifact {
  return privateResearchRow({
    runId: input.runId,
    taskId: input.taskId,
    agentId: input.agentId,
    kind: "studio.research-document-snapshot.v1",
    prepared: input.prepared,
    sourceArtifactIds: [input.searchReceiptArtifactId],
    origin: {
      kind: "research_document_snapshot",
      operationId: input.operationId,
      searchOperationId: input.searchOperationId,
      resultIndex: input.resultIndex,
    },
  });
}

export function buildResearchExtractionArtifact(input: {
  runId: string;
  taskId: string;
  agentId: string;
  operationId: string;
  documentArtifactId: string;
  method: ResearchExtractionMethod;
  prepared: PreparedResearchObject;
}): RuntimeArtifact {
  return privateResearchRow({
    runId: input.runId,
    taskId: input.taskId,
    agentId: input.agentId,
    kind: "studio.research-extraction.v1",
    prepared: input.prepared,
    sourceArtifactIds: [input.documentArtifactId],
    origin: {
      kind: "research_extraction",
      operationId: input.operationId,
      documentArtifactId: input.documentArtifactId,
      method: input.method,
    },
  });
}

export function buildResearchSnapshotReceiptArtifact(input: {
  runId: string;
  taskId: string;
  agentId: string;
  receipt: ResearchDocumentSnapshotReceipt;
  searchReceiptArtifactId: string;
  prepared: PreparedResearchObject;
}): RuntimeArtifact {
  return privateResearchRow({
    runId: input.runId,
    taskId: input.taskId,
    agentId: input.agentId,
    kind: "studio.research-document-snapshot.receipt.v1",
    prepared: input.prepared,
    sourceArtifactIds: [input.searchReceiptArtifactId, input.receipt.document.artifactId, input.receipt.extraction.artifactId],
    origin: {
      kind: "research_snapshot_receipt",
      operationId: input.receipt.operationId,
      receiptId: input.receipt.receiptId,
      documentArtifactId: input.receipt.document.artifactId,
      extractionArtifactId: input.receipt.extraction.artifactId,
    },
  });
}

export function buildResearchExhaustionReceiptArtifact(input: {
  runId: string;
  taskId: string;
  agentId: string;
  receipt: ResearchExhaustionReceipt;
  sourceArtifactIds: string[];
  prepared: PreparedResearchObject;
}): RuntimeArtifact {
  return privateResearchRow({
    runId: input.runId,
    taskId: input.taskId,
    agentId: input.agentId,
    kind: "studio.research-exhaustion.receipt.v1",
    prepared: input.prepared,
    sourceArtifactIds: input.sourceArtifactIds,
    origin: {
      kind: "research_exhaustion_receipt",
      receiptId: input.receipt.receiptId,
      grantId: input.receipt.authorization.grantId,
    },
  });
}
