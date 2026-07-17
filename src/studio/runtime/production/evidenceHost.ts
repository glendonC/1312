import { readFile } from "node:fs/promises";

import type {
  LanguageRangesReceipt,
  SpeechActivityReceipt,
} from "../../preflight/contracts.ts";
import type { AcousticObservations } from "../../acoustic/contracts.ts";
import { validateAcousticObservations, validateAcousticReceipt } from "../../acoustic/validation.ts";
import { authorizeEvidenceRead, type AuthorizedEvidenceRead } from "./authorization.ts";
import { canonicalSha256, ContentAddressedArtifactStore } from "./artifactStore.ts";
import type { RuntimeLedger } from "./journal.ts";
import type {
  EvidenceFact,
  EvidenceReadReceipt,
  EvidenceReadRequest,
  LanguageRangeEvidenceFact,
  SpeechWindowEvidenceFact,
  AcousticRangeEvidenceFact,
} from "./model.ts";
import type { PendingRuntimeEvent } from "./protocol.ts";
import { validateEvidenceReadReceipt } from "./validation/evidence.ts";

const MAX_EVIDENCE_SOURCE_BYTES = 1024 * 1024;
const SAMPLE_RATE = 16_000;

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function startMilliseconds(sample: number): number {
  return Math.floor(sample * 1_000 / SAMPLE_RATE);
}

function endMilliseconds(sample: number): number {
  return Math.ceil(sample * 1_000 / SAMPLE_RATE);
}

function speechFacts(value: unknown): SpeechWindowEvidenceFact[] {
  const receipt = record(value);
  const producer = record(receipt?.producer);
  const normalization = record(receipt?.normalization);
  if (
    receipt?.schema !== "studio.speech-activity.v1" ||
    producer?.id !== "silero-vad" ||
    producer.version !== "6.2.1" ||
    normalization?.sample_rate_hz !== SAMPLE_RATE ||
    !Number.isSafeInteger(normalization.sample_count) ||
    !Array.isArray(receipt.speech_windows) ||
    !Array.isArray(receipt.non_speech_windows)
  ) {
    throw new Error("The stored speech evidence no longer has its validated receipt shape");
  }
  const convert = (
    values: unknown[],
    kind: SpeechWindowEvidenceFact["kind"],
  ): SpeechWindowEvidenceFact[] => values.map((candidate, index) => {
    const range = record(candidate);
    if (
      !range ||
      Object.keys(range).length !== 2 ||
      !Number.isSafeInteger(range.start_sample) ||
      !Number.isSafeInteger(range.end_sample) ||
      (range.start_sample as number) < 0 ||
      (range.end_sample as number) <= (range.start_sample as number) ||
      (range.end_sample as number) > (normalization.sample_count as number)
    ) {
      throw new Error("The stored speech evidence contains an invalid window");
    }
    return {
      kind,
      index,
      startSample: range.start_sample as number,
      endSample: range.end_sample as number,
      startMs: startMilliseconds(range.start_sample as number),
      endMs: endMilliseconds(range.end_sample as number),
    };
  });
  return [
    ...convert(receipt.speech_windows, "speech_window"),
    ...convert(receipt.non_speech_windows, "non_speech_window"),
  ].sort((left, right) => left.startSample - right.startSample || left.kind.localeCompare(right.kind));
}

function languageFacts(value: unknown): LanguageRangeEvidenceFact[] {
  const receipt = record(value);
  const producer = record(receipt?.producer);
  const input = record(receipt?.input);
  if (
    receipt?.schema !== "studio.language-ranges.v1" ||
    producer?.id !== "whisper-language-id" ||
    producer.version !== "1.0.0" ||
    input?.sample_rate_hz !== SAMPLE_RATE ||
    !Array.isArray(receipt.ranges)
  ) {
    throw new Error("The stored language evidence no longer has its validated receipt shape");
  }
  return (receipt as unknown as LanguageRangesReceipt).ranges.map((range) => {
    const decision = range.decision;
    if (
      !Number.isSafeInteger(range.speech_window_index) ||
      !Number.isSafeInteger(range.chunk_index) ||
      !Number.isSafeInteger(range.start_sample) ||
      !Number.isSafeInteger(range.end_sample) ||
      range.start_sample < 0 ||
      range.end_sample <= range.start_sample ||
      !["classified", "unknown", "withheld"].includes(decision.status)
    ) {
      throw new Error("The stored language evidence contains an invalid range");
    }
    return {
      kind: "language_range",
      speechWindowIndex: range.speech_window_index,
      chunkIndex: range.chunk_index,
      startSample: range.start_sample,
      endSample: range.end_sample,
      startMs: startMilliseconds(range.start_sample),
      endMs: endMilliseconds(range.end_sample),
      decision: {
        status: decision.status,
        code: decision.code,
        probability: decision.probability,
        margin: decision.margin,
        reason: decision.reason,
      },
    } satisfies LanguageRangeEvidenceFact;
  });
}

function acousticFacts(value: unknown): AcousticRangeEvidenceFact[] {
  const observations = validateAcousticObservations(value);
  if (observations.status !== "complete") throw new Error("Acoustic evidence is not a complete partition");
  return observations.observations.map((observation) => ({
    kind: "acoustic_range",
    index: observation.index,
    startSample: observation.startSample,
    endSample: observation.endSample,
    startMs: observation.startMs,
    endMs: observation.endMs,
    classification: observation.classification,
    certainty: observation.certainty,
    confidence: structuredClone(observation.confidence),
    reason: observation.reason,
  }));
}

function allFacts(authorized: AuthorizedEvidenceRead, value: unknown): EvidenceFact[] {
  if (authorized.artifact.origin.kind !== "preflight_evidence") {
    throw new Error("Evidence read artifact origin changed after authorization");
  }
  return authorized.artifact.origin.evidenceKind === "speech_activity"
    ? speechFacts(value as SpeechActivityReceipt)
    : authorized.artifact.origin.evidenceKind === "language_ranges"
      ? languageFacts(value as LanguageRangesReceipt)
      : acousticFacts(value as AcousticObservations);
}

function factsInAuthorizedWindow(
  facts: EvidenceFact[],
  window: { startMs: number; endMs: number },
): EvidenceFact[] {
  const startSample = Math.ceil(window.startMs * SAMPLE_RATE / 1_000);
  const endSample = Math.floor(window.endMs * SAMPLE_RATE / 1_000);
  if (endSample <= startSample) throw new Error("Evidence read window cannot address a complete audio sample");
  return facts
    .filter((fact) => fact.endSample > startSample && fact.startSample < endSample)
    .map((fact) => {
      const clippedStartSample = Math.max(fact.startSample, startSample);
      const clippedEndSample = Math.min(fact.endSample, endSample);
      return {
        ...fact,
        startSample: clippedStartSample,
        endSample: clippedEndSample,
        startMs: Math.max(window.startMs, startMilliseconds(clippedStartSample)),
        endMs: Math.min(window.endMs, endMilliseconds(clippedEndSample)),
      };
    });
}

function boundedFacts(
  facts: EvidenceFact[],
  maxItems: number,
  maxBytes: number,
): { facts: EvidenceFact[]; bytes: number; truncated: boolean } {
  const selected = facts.slice(0, maxItems);
  let bytes = new TextEncoder().encode(JSON.stringify(selected)).byteLength;
  while (selected.length > 0 && bytes > maxBytes) {
    selected.pop();
    bytes = new TextEncoder().encode(JSON.stringify(selected)).byteLength;
  }
  if (bytes > maxBytes) throw new Error("Evidence read byte budget cannot encode an empty fact list");
  return { facts: selected, bytes, truncated: selected.length < facts.length };
}

export interface EvidenceReadHostResult {
  receipt: EvidenceReadReceipt;
  receiptContentId: string;
}

/** Reads only registered producer evidence; it never accepts or resolves a caller path. */
export class BoundedEvidenceReadHost {
  private readonly ledger: RuntimeLedger;
  private readonly artifacts: ContentAddressedArtifactStore;

  constructor(ledger: RuntimeLedger, artifacts: ContentAddressedArtifactStore) {
    this.ledger = ledger;
    this.artifacts = artifacts;
  }

  async read(requestValue: unknown): Promise<EvidenceReadHostResult> {
    let request: EvidenceReadRequest | null = null;
    let operationId: string | null = null;
    let started = false;
    try {
      const authorization = await this.ledger.transact(
        { producer: { kind: "evidence_host", id: "bounded-evidence-read-host" }, causationId: null },
        ({ state }) => {
          const authorized = authorizeEvidenceRead(state, requestValue);
          request = structuredClone(authorized.request);
          operationId = authorized.request.operationId;
          return {
            pending: [{
              type: "evidence.read_started",
              data: {
                request: authorized.request,
                grantId: authorized.grant.id,
                evidenceKind: authorized.scope.evidenceKind,
                sourceArtifactId: authorized.scope.sourceArtifactId,
                startMs: authorized.scope.startMs,
                endMs: authorized.scope.endMs,
                maxBytes: authorized.remainingBytes,
                maxItems: authorized.remainingItems,
              },
            }] satisfies PendingRuntimeEvent[],
            result: authorized,
          };
        },
      );
      started = true;
      const authorized = authorization.result;
      if (authorized.artifact.content.bytes > MAX_EVIDENCE_SOURCE_BYTES) {
        throw new Error("Evidence read input exceeds the host's registered receipt byte bound");
      }
      const path = await this.artifacts.resolveVerified(authorized.artifact);
      const raw = await readFile(path, "utf8");
      let value: unknown;
      try {
        value = JSON.parse(raw) as unknown;
      } catch {
        throw new Error("Registered evidence is no longer valid JSON");
      }
      if (authorized.artifact.origin.kind === "preflight_evidence" && authorized.artifact.origin.evidenceKind === "acoustic_ranges") {
        const receiptContentId = authorized.artifact.origin.producerReceiptContentId;
        if (!receiptContentId) throw new Error("Acoustic evidence lost its separate producer receipt identity");
        const receiptBytes = await this.artifacts.receiptBytes(receiptContentId);
        let producerReceipt: unknown;
        try { producerReceipt = JSON.parse(receiptBytes.toString("utf8")); } catch { throw new Error("Acoustic producer receipt is no longer valid JSON"); }
        validateAcousticReceipt(producerReceipt, validateAcousticObservations(value));
      }
      const available = factsInAuthorizedWindow(allFacts(authorized, value), authorized.scope);
      const projected = boundedFacts(available, authorized.remainingItems, authorized.remainingBytes);
      if (authorized.artifact.origin.kind !== "preflight_evidence") {
        throw new Error("Evidence read artifact origin changed after content verification");
      }
      const acoustic = authorized.artifact.origin.evidenceKind === "acoustic_ranges";
      const body = {
        operationId: authorized.request.operationId,
        capability: "evidence.read" as const,
        authorization: {
          grantId: authorized.grant.id,
          taskId: authorized.request.taskId,
          agentId: authorized.request.agentId,
          sourceArtifactId: authorized.scope.sourceArtifactId,
          startMs: authorized.scope.startMs,
          endMs: authorized.scope.endMs,
          maxBytes: authorized.remainingBytes,
          maxItems: authorized.remainingItems,
        },
        input: {
          artifactId: authorized.artifact.id,
          contentId: authorized.artifact.content.contentId,
          bytes: authorized.artifact.content.bytes,
          evidenceKind: authorized.artifact.origin.evidenceKind,
          receiptSchema: authorized.artifact.origin.receiptSchema,
        },
        producer: {
          id: "studio.bounded-evidence-read" as const,
          version: acoustic ? "3" as const : "2" as const,
          rangePolicy: "intersect_and_clip_to_authorized_window" as const,
        },
        facts: projected.facts,
        result: {
          availableItems: available.length,
          returnedItems: projected.facts.length,
          returnedFactBytes: projected.bytes,
          truncated: projected.truncated,
        },
        lineage: {
          preflightId: authorized.artifact.origin.preflightId,
          preflightContentId: authorized.artifact.origin.preflightContentId,
          sourceArtifactIds: [...authorized.artifact.sourceArtifactIds],
          ...(acoustic ? { producerReceiptContentId: authorized.artifact.origin.producerReceiptContentId! } : {}),
        },
      };
      const receipt: EvidenceReadReceipt = {
        schema: acoustic ? "studio.evidence-read.receipt.v3" : "studio.evidence-read.receipt.v2",
        receiptId: `evidence-read:${canonicalSha256(body)}`,
        ...body,
      };
      validateEvidenceReadReceipt(receipt);
      const stored = await this.artifacts.storeJson(receipt);
      await this.ledger.transact(
        {
          producer: { kind: "evidence_host", id: "bounded-evidence-read-host" },
          causationId: authorized.request.operationId,
        },
        () => ({
          pending: [{
            type: "evidence.read_completed",
            data: {
              operationId: authorized.request.operationId,
              receiptContentId: stored.content.contentId,
              receipt,
            },
          }] satisfies PendingRuntimeEvent[],
          result: undefined,
        }),
      );
      return { receipt, receiptContentId: stored.content.contentId };
    } catch (error) {
      if (started && request && operationId) {
        const failedOperationId = operationId;
        await this.ledger.transact(
          { producer: { kind: "evidence_host", id: "bounded-evidence-read-host" }, causationId: failedOperationId },
          () => ({
            pending: [{
              type: "evidence.read_failed",
              data: { operationId: failedOperationId, reason: "The bounded evidence read failed closed." },
            }] satisfies PendingRuntimeEvent[],
            result: undefined,
          }),
        );
      }
      throw error;
    }
  }
}
