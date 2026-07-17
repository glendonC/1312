import { createHash } from "node:crypto";

import { authorizeEvidenceAssessment, type AuthorizedEvidenceAssessment } from "./authorization.ts";
import {
  canonicalJsonContentId,
  canonicalSha256,
  ContentAddressedArtifactStore,
} from "./artifactStore.ts";
import type { RuntimeLedger } from "./journal.ts";
import type {
  EvidenceAssessmentClaim,
  EvidenceAssessmentReceipt,
  EvidenceAssessmentRequest,
  EvidenceAssessmentState,
  EvidenceFact,
  EvidenceReadReceipt,
  ReceiptedEvidenceAssessmentClaim,
} from "./model.ts";
import type { PendingRuntimeEvent } from "./protocol.ts";
import {
  countAssessmentTokens,
  validateEvidenceAssessmentReceipt,
} from "./validation/assessment.ts";
import { validateEvidenceReadReceipt } from "./validation/evidence.ts";

const MAX_STORED_READ_RECEIPT_BYTES = 128 * 1024;

interface LoadedReadReceipt {
  receipt: EvidenceReadReceipt;
  receiptContentId: string;
  readOperationId: string;
  evidenceArtifactId: string;
}

function readReceiptIdentityMatches(receipt: EvidenceReadReceipt, receiptContentId: string): boolean {
  const body = structuredClone(receipt) as unknown as Record<string, unknown>;
  delete body.schema;
  delete body.receiptId;
  return (
    receipt.receiptId === `evidence-read:${canonicalSha256(body)}` &&
    canonicalJsonContentId(receipt) === receiptContentId
  );
}

async function loadReadReceipts(
  authorized: AuthorizedEvidenceAssessment,
  artifacts: ContentAddressedArtifactStore,
): Promise<LoadedReadReceipt[]> {
  return Promise.all(authorized.request.readReceipts.map(async (identity) => {
    const operation = authorized.reads.find((candidate) =>
      candidate.receiptId === identity.receiptId && candidate.receiptContentId === identity.receiptContentId);
    if (!operation || operation.status !== "completed") {
      throw new Error("Assessment input is no longer a completed evidence read");
    }
    const bytes = await artifacts.receiptBytes(identity.receiptContentId);
    if (bytes.byteLength <= 0 || bytes.byteLength > MAX_STORED_READ_RECEIPT_BYTES) {
      throw new Error("Stored evidence-read receipt exceeds the assessment input bound");
    }
    const digest = createHash("sha256").update(bytes).digest("hex");
    if (`sha256:${digest}` !== identity.receiptContentId) {
      throw new Error("Stored evidence-read receipt no longer matches its content identity");
    }
    let value: unknown;
    try {
      value = JSON.parse(bytes.toString("utf8")) as unknown;
    } catch {
      throw new Error("Stored evidence-read receipt is no longer valid JSON");
    }
    validateEvidenceReadReceipt(value, "Evidence assessment input", "receipt");
    const receipt = value;
    if (receipt.schema !== "studio.evidence-read.receipt.v2" || receipt.input.evidenceKind === "acoustic_ranges") {
      throw new Error("Acoustic evidence is not a speech-specific assessment claim input");
    }
    if (
      !readReceiptIdentityMatches(receipt, identity.receiptContentId) ||
      receipt.operationId !== operation.id ||
      receipt.receiptId !== operation.receiptId ||
      receipt.authorization.taskId !== authorized.request.taskId ||
      receipt.authorization.agentId !== authorized.request.agentId ||
      receipt.input.artifactId !== operation.artifactId ||
      receipt.input.evidenceKind !== operation.evidenceKind ||
      receipt.result.returnedItems !== operation.returnedItems ||
      receipt.result.returnedFactBytes !== operation.returnedFactBytes ||
      receipt.result.truncated !== operation.truncated
    ) {
      throw new Error("Stored evidence-read receipt does not match the completed journal read");
    }
    return {
      receipt,
      receiptContentId: identity.receiptContentId,
      readOperationId: operation.id,
      evidenceArtifactId: operation.artifactId,
    };
  }));
}

function factRange(fact: EvidenceFact): { startMs: number; endMs: number } {
  return { startMs: fact.startMs, endMs: fact.endMs };
}

function receiptKey(receiptId: string, receiptContentId: string): string {
  return `${receiptId}\u0000${receiptContentId}`;
}

function assessClaim(
  claim: EvidenceAssessmentClaim,
  claimIndex: number,
  loadedByIdentity: ReadonlyMap<string, LoadedReadReceipt>,
): ReceiptedEvidenceAssessmentClaim {
  const cited: Array<{ fact: EvidenceFact; read: LoadedReadReceipt }> = [];
  for (const citation of claim.citations) {
    const read = loadedByIdentity.get(receiptKey(citation.receiptId, citation.receiptContentId));
    if (!read) throw new Error("Assessment claim cites an undeclared evidence-read receipt");
    for (const factIndex of citation.factIndexes) {
      const fact = read.receipt.facts[factIndex];
      if (!fact) throw new Error("Assessment claim cites an out-of-bounds fact index");
      cited.push({ fact, read });
    }
  }
  if (cited.length === 0) throw new Error("Assessment claim has no receipted facts");
  const ranges = cited.map(({ fact }) => factRange(fact));
  const exactRange = {
    startMs: Math.min(...ranges.map((range) => range.startMs)),
    endMs: Math.max(...ranges.map((range) => range.endMs)),
  };
  if (claim.range.startMs !== exactRange.startMs || claim.range.endMs !== exactRange.endMs) {
    throw new Error("Assessment claim range must equal the cited facts' exact bounding range");
  }

  const states = new Set<EvidenceAssessmentState>();
  if (cited.some(({ read }) => read.receipt.result.truncated)) states.add("truncated");
  if (claim.kind === "speech_activity") {
    const expectedKind = claim.value === "speech" ? "speech_window" : "non_speech_window";
    if (cited.some(({ fact }) => fact.kind !== expectedKind)) {
      throw new Error("Speech assessment value is not supported by every cited fact");
    }
  } else {
    if (cited.some(({ fact }) => fact.kind !== "language_range")) {
      throw new Error("Language assessment may cite only returned language facts");
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
      if (claim.value !== null) throw new Error("Unknown or withheld language evidence cannot support a language identity");
    } else {
      if (classifiedCodes.size !== 1 || claim.value !== [...classifiedCodes][0]) {
        throw new Error("Language assessment value must equal the single classified code in every cited fact");
      }
    }
  }
  if (states.size === 0) states.add("supported");
  const stateOrder: EvidenceAssessmentState[] = ["withheld", "unknown", "truncated", "supported"];
  const orderedStates = stateOrder
    .filter((state): state is EvidenceAssessmentState => states.has(state));
  return { ...structuredClone(claim), claimIndex, states: orderedStates };
}

export interface EvidenceAssessmentHostResult {
  receipt: EvidenceAssessmentReceipt;
  receiptContentId: string;
  outputArtifactId: string;
}

/** Assesses only completed evidence-read receipts; it never accepts producer artifacts or paths. */
export class BoundedEvidenceAssessmentHost {
  private readonly ledger: RuntimeLedger;
  private readonly artifacts: ContentAddressedArtifactStore;

  constructor(ledger: RuntimeLedger, artifacts: ContentAddressedArtifactStore) {
    this.ledger = ledger;
    this.artifacts = artifacts;
  }

  async assess(requestValue: unknown): Promise<EvidenceAssessmentHostResult> {
    let request: EvidenceAssessmentRequest | null = null;
    let operationId: string | null = null;
    let started = false;
    try {
      const authorization = await this.ledger.transact(
        { producer: { kind: "assessment_host", id: "bounded-evidence-assessment-host" }, causationId: null },
        ({ state }) => {
          const authorized = authorizeEvidenceAssessment(state, requestValue);
          request = structuredClone(authorized.request);
          operationId = authorized.request.operationId;
          return {
            pending: [{
              type: "analysis.evidence.assessment_started",
              data: {
                request: authorized.request,
                grantId: authorized.grant.id,
                maxReadReceipts: authorized.scope.maxReadReceipts,
                maxClaims: authorized.scope.maxClaims,
                maxCitations: authorized.scope.maxCitations,
                maxTokens: authorized.scope.maxTokens,
              },
            }] satisfies PendingRuntimeEvent[],
            result: authorized,
          };
        },
      );
      started = true;
      const authorized = authorization.result;
      const loaded = await loadReadReceipts(authorized, this.artifacts);
      const loadedByIdentity = new Map(loaded.map((input) => [
        receiptKey(input.receipt.receiptId, input.receiptContentId),
        input,
      ]));
      const claims = authorized.request.claims.map((claim, index) => assessClaim(claim, index, loadedByIdentity));
      const citationCount = claims.reduce(
        (total, claim) => total + claim.citations.reduce((subtotal, citation) => subtotal + citation.factIndexes.length, 0),
        0,
      );
      const tokenCount = countAssessmentTokens(claims);
      if (
        claims.length > authorized.scope.maxClaims ||
        citationCount > authorized.scope.maxCitations ||
        tokenCount > authorized.scope.maxTokens
      ) throw new Error("Receipted assessment exceeds its hard claim, citation, or token budget");
      const body = {
        operationId: authorized.request.operationId,
        capability: "analysis.evidence.assess" as const,
        authorization: {
          grantId: authorized.grant.id,
          taskId: authorized.request.taskId,
          agentId: authorized.request.agentId,
          maxAssessments: authorized.scope.maxAssessments,
          maxReadReceipts: authorized.scope.maxReadReceipts,
          maxClaims: authorized.scope.maxClaims,
          maxCitations: authorized.scope.maxCitations,
          maxTokens: authorized.scope.maxTokens,
        },
        inputs: loaded.map((input) => ({
          readOperationId: input.readOperationId,
          receiptId: input.receipt.receiptId,
          receiptContentId: input.receiptContentId,
          evidenceArtifactId: input.evidenceArtifactId,
          evidenceKind: input.receipt.input.evidenceKind,
          returnedItems: input.receipt.result.returnedItems,
          truncated: input.receipt.result.truncated,
        })),
        producer: { id: "studio.bounded-evidence-assessment" as const, version: "1" as const },
        claims,
        result: {
          readReceiptCount: loaded.length,
          claimCount: claims.length,
          citationCount,
          tokenCount,
        },
      };
      const receipt: EvidenceAssessmentReceipt = {
        schema: "studio.evidence-assessment.receipt.v1",
        receiptId: `evidence-assessment:${canonicalSha256(body)}`,
        ...body,
      };
      validateEvidenceAssessmentReceipt(receipt);
      const stored = await this.artifacts.storeJson(receipt);
      const artifact = this.artifacts.buildEvidenceAssessmentArtifact({
        runId: this.ledger.runId,
        receipt,
        storedReceipt: stored,
      });
      await this.artifacts.record(this.ledger, artifact, authorized.request.operationId);
      await this.ledger.transact(
        {
          producer: { kind: "assessment_host", id: "bounded-evidence-assessment-host" },
          causationId: authorized.request.operationId,
        },
        () => ({
          pending: [{
            type: "analysis.evidence.assessment_completed",
            data: {
              operationId: authorized.request.operationId,
              outputArtifactId: artifact.id,
              receiptContentId: stored.content.contentId,
              receipt,
            },
          }] satisfies PendingRuntimeEvent[],
          result: undefined,
        }),
      );
      return { receipt, receiptContentId: stored.content.contentId, outputArtifactId: artifact.id };
    } catch (error) {
      if (started && request && operationId) {
        const failedOperationId = operationId;
        await this.ledger.transact(
          {
            producer: { kind: "assessment_host", id: "bounded-evidence-assessment-host" },
            causationId: failedOperationId,
          },
          () => ({
            pending: [{
              type: "analysis.evidence.assessment_failed",
              data: { operationId: failedOperationId, reason: "The bounded evidence assessment failed closed." },
            }] satisfies PendingRuntimeEvent[],
            result: undefined,
          }),
        );
      }
      throw error;
    }
  }
}
