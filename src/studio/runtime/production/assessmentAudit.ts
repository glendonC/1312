import { createHash } from "node:crypto";

import {
  canonicalJsonContentId,
  canonicalSha256,
  ContentAddressedArtifactStore,
} from "./artifactStore.ts";
import type {
  EvidenceAssessmentReceipt,
  EvidenceAssessmentState,
  EvidenceFact,
  EvidenceReadReceipt,
  RuntimeProjection,
} from "./model.ts";
import type { RuntimeEvent } from "./protocol.ts";
import { validateEvidenceAssessmentReceipt } from "./validation/assessment.ts";
import { validateEvidenceReadReceipt } from "./validation/evidence.ts";

const MAX_STORED_ASSESSMENT_RECEIPT_BYTES = 256 * 1024;
const MAX_STORED_READ_RECEIPT_BYTES = 128 * 1024;

export interface EvidenceAssessmentAuditCitation {
  readOperationId: string;
  receiptId: string;
  receiptContentId: string;
  evidenceArtifactId: string;
  factIndexes: number[];
}

export interface EvidenceAssessmentAuditClaim {
  claimIndex: number;
  kind: "speech_activity" | "language_identity";
  value: "speech" | "non_speech" | string | null;
  range: { startMs: number; endMs: number };
  states: EvidenceAssessmentState[];
  citations: EvidenceAssessmentAuditCitation[];
}

export interface EvidenceAssessmentAudit {
  operationId: string;
  artifactId: string;
  receiptId: string;
  receiptContentId: string;
  taskId: string;
  agentId: string;
  integrity: "stored_receipt_and_citations_verified";
  claims: EvidenceAssessmentAuditClaim[];
}

interface LoadedReadReceipt {
  receipt: EvidenceReadReceipt;
  operationId: string;
  evidenceArtifactId: string;
}

function receiptKey(receiptId: string, receiptContentId: string): string {
  return `${receiptId}\u0000${receiptContentId}`;
}

function expectedStorageKey(contentId: string): string {
  const digest = contentId.replace(/^sha256:/, "");
  return `objects/sha256/${digest.slice(0, 2)}/${digest}`;
}

async function storedJson(
  artifacts: ContentAddressedArtifactStore,
  contentId: string,
  maximumBytes: number,
  context: string,
): Promise<{ value: unknown; bytes: number }> {
  const bytes = await artifacts.receiptBytes(contentId);
  if (bytes.byteLength <= 0 || bytes.byteLength > maximumBytes) {
    throw new Error(`${context} exceeds its stored-byte bound`);
  }
  const measured = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  if (measured !== contentId) throw new Error(`${context} no longer matches its content identity`);
  let value: unknown;
  try {
    value = JSON.parse(bytes.toString("utf8")) as unknown;
  } catch {
    throw new Error(`${context} is no longer valid JSON`);
  }
  if (canonicalJsonContentId(value) !== contentId) {
    throw new Error(`${context} is not the canonical JSON bound by its content identity`);
  }
  return { value, bytes: bytes.byteLength };
}

function assessmentReceiptId(receipt: EvidenceAssessmentReceipt): string {
  const body = structuredClone(receipt) as unknown as Record<string, unknown>;
  delete body.schema;
  delete body.receiptId;
  return `evidence-assessment:${canonicalSha256(body)}`;
}

function readReceiptId(receipt: EvidenceReadReceipt): string {
  const body = structuredClone(receipt) as unknown as Record<string, unknown>;
  delete body.schema;
  delete body.receiptId;
  return `evidence-read:${canonicalSha256(body)}`;
}

function sameCanonicalContent(left: unknown, right: unknown): boolean {
  return canonicalSha256(left) === canonicalSha256(right);
}

function expectedStates(
  kind: EvidenceAssessmentAuditClaim["kind"],
  value: EvidenceAssessmentAuditClaim["value"],
  cited: Array<{ fact: EvidenceFact; read: EvidenceReadReceipt }>,
): EvidenceAssessmentState[] {
  const states = new Set<EvidenceAssessmentState>();
  if (cited.some(({ read }) => read.result.truncated)) states.add("truncated");
  if (kind === "speech_activity") {
    const expectedKind = value === "speech" ? "speech_window" : "non_speech_window";
    if (cited.some(({ fact }) => fact.kind !== expectedKind)) {
      throw new Error("Audited speech claim is not supported by every cited fact");
    }
  } else {
    if (cited.some(({ fact }) => fact.kind !== "language_range")) {
      throw new Error("Audited language claim cites a non-language fact");
    }
    const facts = cited.map(({ fact }) => fact).filter((fact) => fact.kind === "language_range");
    if (facts.some((fact) => fact.decision.status === "withheld")) states.add("withheld");
    if (facts.some((fact) => fact.decision.status === "unknown")) states.add("unknown");
    const classifiedCodes = new Set(
      facts
        .filter((fact) => fact.decision.status === "classified")
        .map((fact) => fact.decision.code)
        .filter((code): code is string => code !== null),
    );
    if (states.has("unknown") || states.has("withheld")) {
      if (value !== null) throw new Error("Audited unknown or withheld language claim has a value");
    } else if (classifiedCodes.size !== 1 || value !== [...classifiedCodes][0]) {
      throw new Error("Audited language claim does not equal its cited classified code");
    }
  }
  if (states.size === 0) states.add("supported");
  return (["withheld", "unknown", "truncated", "supported"] as const)
    .filter((state) => states.has(state));
}

async function loadReadReceipt(
  input: EvidenceAssessmentReceipt["inputs"][number],
  state: RuntimeProjection,
  events: readonly RuntimeEvent[],
  artifacts: ContentAddressedArtifactStore,
  taskId: string,
  agentId: string,
): Promise<LoadedReadReceipt> {
  const operation = state.evidenceReads[input.readOperationId];
  const evidenceArtifact = state.artifacts[input.evidenceArtifactId];
  if (
    !operation ||
    operation.status !== "completed" ||
    operation.taskId !== taskId ||
    operation.agentId !== agentId ||
    operation.artifactId !== input.evidenceArtifactId ||
    operation.evidenceKind !== input.evidenceKind ||
    operation.receiptId !== input.receiptId ||
    operation.receiptContentId !== input.receiptContentId ||
    operation.returnedItems !== input.returnedItems ||
    operation.truncated !== input.truncated
  ) {
    throw new Error("Assessment audit input is outside the completed same-task read lineage");
  }
  if (
    !evidenceArtifact ||
    evidenceArtifact.origin.kind !== "preflight_evidence" ||
    evidenceArtifact.content.contentId === input.receiptContentId
  ) {
    throw new Error("Assessment audit input has no distinct preflight-evidence artifact lineage");
  }
  const completion = events.find((event) =>
    event.type === "evidence.read_completed" && event.data.operationId === input.readOperationId);
  if (!completion || completion.type !== "evidence.read_completed") {
    throw new Error("Assessment audit input has no completed journal read receipt");
  }
  const stored = await storedJson(
    artifacts,
    input.receiptContentId,
    MAX_STORED_READ_RECEIPT_BYTES,
    `Stored evidence-read receipt ${input.receiptId}`,
  );
  validateEvidenceReadReceipt(stored.value, "Assessment audit read receipt", "receipt");
  const receipt = stored.value;
  if (
    receipt.receiptId !== readReceiptId(receipt) ||
    receipt.receiptId !== input.receiptId ||
    receipt.operationId !== operation.id ||
    receipt.authorization.grantId !== operation.grantId ||
    receipt.authorization.taskId !== taskId ||
    receipt.authorization.agentId !== agentId ||
    receipt.authorization.maxBytes !== operation.maxBytes ||
    receipt.authorization.maxItems !== operation.maxItems ||
    receipt.input.artifactId !== input.evidenceArtifactId ||
    receipt.input.contentId !== evidenceArtifact.content.contentId ||
    receipt.input.bytes !== evidenceArtifact.content.bytes ||
    receipt.input.evidenceKind !== input.evidenceKind ||
    receipt.input.receiptSchema !== evidenceArtifact.origin.receiptSchema ||
    receipt.result.returnedItems !== input.returnedItems ||
    receipt.result.returnedItems !== receipt.facts.length ||
    receipt.result.returnedFactBytes !== operation.returnedFactBytes ||
    receipt.result.truncated !== input.truncated ||
    receipt.lineage.preflightId !== evidenceArtifact.origin.preflightId ||
    receipt.lineage.preflightContentId !== evidenceArtifact.origin.preflightContentId ||
    !sameCanonicalContent(receipt.lineage.sourceArtifactIds, evidenceArtifact.sourceArtifactIds) ||
    completion.data.receiptContentId !== input.receiptContentId ||
    !sameCanonicalContent(completion.data.receipt, receipt)
  ) {
    throw new Error("Stored evidence-read receipt does not close against its journal lineage");
  }
  return { receipt, operationId: operation.id, evidenceArtifactId: operation.artifactId };
}

/**
 * Reopens stored assessment and cited read receipts by content identity, then closes them against
 * the complete journal projection. It returns no partial or best-effort audit.
 */
export async function reopenEvidenceAssessmentAudits(
  state: RuntimeProjection,
  events: readonly RuntimeEvent[],
  artifacts: ContentAddressedArtifactStore,
): Promise<EvidenceAssessmentAudit[]> {
  const audits: EvidenceAssessmentAudit[] = [];
  const completed = Object.values(state.evidenceAssessments)
    .filter((assessment) => assessment.status === "completed")
    .sort((left, right) => left.id.localeCompare(right.id));

  for (const operation of completed) {
    if (!operation.artifactId || !operation.receiptId || !operation.receiptContentId) {
      throw new Error(`Completed assessment ${operation.id} has an incomplete projection`);
    }
    const artifact = state.artifacts[operation.artifactId];
    const completion = events.find((event) =>
      event.type === "analysis.evidence.assessment_completed" && event.data.operationId === operation.id);
    const started = events.find((event) =>
      event.type === "analysis.evidence.assessment_started" && event.data.request.operationId === operation.id);
    if (
      !artifact ||
      artifact.origin.kind !== "evidence_assessment" ||
      !completion ||
      completion.type !== "analysis.evidence.assessment_completed" ||
      !started ||
      started.type !== "analysis.evidence.assessment_started"
    ) {
      throw new Error(`Completed assessment ${operation.id} has no closed journal/artifact lineage`);
    }
    const expectedArtifactId = `artifact:${canonicalSha256({
      runId: state.runId,
      operationId: operation.id,
      kind: "evidence-assessment-receipt",
      contentId: operation.receiptContentId,
    })}`;
    if (
      artifact.id !== expectedArtifactId ||
      artifact.runId !== state.runId ||
      artifact.kind !== "evidence-assessment-receipt" ||
      artifact.mediaClass !== "non_media" ||
      artifact.publication !== "private" ||
      artifact.content.contentId !== operation.receiptContentId ||
      artifact.storageKey !== expectedStorageKey(operation.receiptContentId) ||
      artifact.producerTaskId !== operation.taskId ||
      artifact.producerAgentId !== operation.agentId ||
      artifact.origin.operationId !== operation.id ||
      artifact.origin.receiptId !== operation.receiptId ||
      artifact.origin.receiptContentId !== operation.receiptContentId ||
      completion.data.outputArtifactId !== artifact.id ||
      completion.data.receiptContentId !== operation.receiptContentId
    ) {
      throw new Error(`Assessment artifact ${artifact.id} does not match its journal projection`);
    }

    const stored = await storedJson(
      artifacts,
      operation.receiptContentId,
      MAX_STORED_ASSESSMENT_RECEIPT_BYTES,
      `Stored evidence-assessment receipt ${operation.receiptId}`,
    );
    validateEvidenceAssessmentReceipt(stored.value, "Assessment receipt audit", "receipt");
    const receipt = stored.value;
    const task = state.tasks[operation.taskId];
    const grant = task?.grants.find((candidate) =>
      candidate.id === operation.grantId && candidate.capability === "analysis.evidence.assess");
    const scope = grant?.assessmentScope;
    if (
      !scope ||
      artifact.content.bytes !== stored.bytes ||
      receipt.receiptId !== assessmentReceiptId(receipt) ||
      receipt.receiptId !== operation.receiptId ||
      receipt.operationId !== operation.id ||
      receipt.authorization.grantId !== operation.grantId ||
      receipt.authorization.taskId !== operation.taskId ||
      receipt.authorization.agentId !== operation.agentId ||
      receipt.authorization.maxAssessments !== scope.maxAssessments ||
      receipt.authorization.maxReadReceipts !== operation.maxReadReceipts ||
      receipt.authorization.maxClaims !== operation.maxClaims ||
      receipt.authorization.maxCitations !== operation.maxCitations ||
      receipt.authorization.maxTokens !== operation.maxTokens ||
      receipt.result.claimCount !== operation.claimCount ||
      receipt.result.citationCount !== operation.citationCount ||
      receipt.result.tokenCount !== operation.tokenCount ||
      !receipt.inputs.every((input) => scope.evidenceArtifactIds.includes(input.evidenceArtifactId)) ||
      !sameCanonicalContent(completion.data.receipt, receipt)
    ) {
      throw new Error(`Stored assessment receipt ${receipt.receiptId} does not match its journal completion`);
    }
    if (
      !sameCanonicalContent(
        started.data.request.claims,
        receipt.claims.map(({ claimIndex: _claimIndex, states: _states, ...claim }) => claim),
      ) ||
      !sameCanonicalContent(started.data.request.readReceipts, receipt.inputs.map((input) => ({
        receiptId: input.receiptId,
        receiptContentId: input.receiptContentId,
      }))) ||
      !sameCanonicalContent(artifact.origin.readReceiptIds, receipt.inputs.map((input) => input.receiptId)) ||
      !sameCanonicalContent(
        artifact.origin.readReceiptContentIds,
        receipt.inputs.map((input) => input.receiptContentId),
      )
    ) {
      throw new Error(`Stored assessment receipt ${receipt.receiptId} changed its declared read lineage`);
    }

    const loaded = await Promise.all(receipt.inputs.map((input) =>
      loadReadReceipt(input, state, events, artifacts, operation.taskId, operation.agentId)));
    const loadedByIdentity = new Map(loaded.map((input) => [
      receiptKey(input.receipt.receiptId, canonicalJsonContentId(input.receipt)),
      input,
    ]));

    const claims = receipt.claims.map((claim): EvidenceAssessmentAuditClaim => {
      const cited: Array<{ fact: EvidenceFact; read: EvidenceReadReceipt }> = [];
      const citations = claim.citations.map((citation): EvidenceAssessmentAuditCitation => {
        const read = loadedByIdentity.get(receiptKey(citation.receiptId, citation.receiptContentId));
        if (!read) throw new Error(`Assessment claim ${claim.claimIndex} cites an undeclared read receipt`);
        for (const factIndex of citation.factIndexes) {
          const fact = read.receipt.facts[factIndex];
          if (!fact) throw new Error(`Assessment claim ${claim.claimIndex} cites an out-of-bounds fact index`);
          cited.push({ fact, read: read.receipt });
        }
        return {
          readOperationId: read.operationId,
          receiptId: citation.receiptId,
          receiptContentId: citation.receiptContentId,
          evidenceArtifactId: read.evidenceArtifactId,
          factIndexes: [...citation.factIndexes],
        };
      });
      if (cited.length === 0) throw new Error(`Assessment claim ${claim.claimIndex} has no cited facts`);
      const range = {
        startMs: Math.min(...cited.map(({ fact }) => fact.startMs)),
        endMs: Math.max(...cited.map(({ fact }) => fact.endMs)),
      };
      const states = expectedStates(claim.kind, claim.value, cited);
      if (
        claim.range.startMs !== range.startMs ||
        claim.range.endMs !== range.endMs ||
        !sameCanonicalContent(claim.states, states)
      ) {
        throw new Error(`Assessment claim ${claim.claimIndex} changed its range or preserved states`);
      }
      return {
        claimIndex: claim.claimIndex,
        kind: claim.kind,
        value: claim.value,
        range,
        states,
        citations,
      };
    });

    audits.push({
      operationId: operation.id,
      artifactId: artifact.id,
      receiptId: receipt.receiptId,
      receiptContentId: operation.receiptContentId,
      taskId: operation.taskId,
      agentId: operation.agentId,
      integrity: "stored_receipt_and_citations_verified",
      claims,
    });
  }
  return audits;
}
