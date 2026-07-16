import { ContentAddressedArtifactStore } from "./artifactStore.ts";
import { authorizeSpeechTranscribe } from "./authorization.ts";
import {
  SEMANTIC_EVIDENCE_NORMALIZATION,
  UnavailableCurrentRunSpeechRecognizer,
  type CurrentRunRecognizerResult,
  type CurrentRunSpeechRecognizer,
} from "./currentRunSpeechRecognizer.ts";
import type { RuntimeLedger } from "./journal.ts";
import type {
  RuntimeArtifact,
  SemanticMediaEvidenceArtifact,
  SemanticMediaEvidenceReceipt,
  TimedTranscriptHypothesis,
} from "./model.ts";
import { SEMANTIC_EVIDENCE_LIMITS } from "./model.ts";
import type { PendingRuntimeEvent } from "./protocol.ts";
import { reopenSemanticEvidence } from "./semanticEvidenceAudit.ts";
import {
  semanticAvailabilityId,
  semanticObservationId,
  semanticReceiptId,
  validateCurrentRunRecognizerDescriptor,
  validateSemanticMediaEvidenceArtifact,
  validateSemanticMediaEvidenceReceipt,
} from "./validation/semanticEvidence.ts";

class SemanticRecognizerTimeout extends Error {}

function safeFailure(error: unknown): string {
  if (error instanceof SemanticRecognizerTimeout) return "Current-run speech recognizer timed out.";
  return "Current-run speech recognizer failed its closed execution boundary.";
}

function normalizeText(value: string): string {
  return value.normalize("NFC").trim().replace(/\s+/gu, " ");
}

async function boundedRecognition(
  recognizer: CurrentRunSpeechRecognizer,
  input: Parameters<CurrentRunSpeechRecognizer["recognize"]>[0],
  timeoutMs: number,
): Promise<CurrentRunRecognizerResult> {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | null = null;
  const timedOut = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      const error = new SemanticRecognizerTimeout("Recognizer timeout");
      controller.abort(error);
      reject(error);
    }, timeoutMs);
  });
  try {
    return await Promise.race([recognizer.recognize(input, controller.signal), timedOut]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function closeRecognizerResult(
  operationId: string,
  requested: { startMs: number; endMs: number },
  result: CurrentRunRecognizerResult,
): Pick<SemanticMediaEvidenceArtifact, "returnedRange" | "availability" | "observations"> {
  if (result.availability !== "available" && result.segments.length !== 0) {
    throw new Error("Unavailable recognizer output cannot carry timed segments");
  }
  if (result.availability === "available" && result.segments.length === 0) {
    throw new Error("Available recognizer output must carry a timed segment");
  }
  const normalized = result.segments.map((segment) => {
    if (
      !Number.isSafeInteger(segment.startMs) ||
      !Number.isSafeInteger(segment.endMs) ||
      segment.endMs <= segment.startMs ||
      segment.startMs < requested.startMs ||
      segment.endMs > requested.endMs
    ) throw new Error("Recognizer returned a segment outside the authorized source range");
    const text = segment.text === null ? null : normalizeText(segment.text);
    if ((segment.state === "available") !== Boolean(text)) {
      throw new Error("Recognizer segment text and state disagree");
    }
    return { range: { startMs: segment.startMs, endMs: segment.endMs }, state: segment.state, text };
  }).sort((left, right) => left.range.startMs - right.range.startMs || left.range.endMs - right.range.endMs);

  const observations: TimedTranscriptHypothesis[] = [];
  let textBytes = 0;
  let truncated = false;
  for (const segment of normalized) {
    const bytes = new TextEncoder().encode(segment.text ?? "").byteLength;
    if (observations.length >= SEMANTIC_EVIDENCE_LIMITS.maxSegments ||
      textBytes + bytes > SEMANTIC_EVIDENCE_LIMITS.maxTextBytes) {
      truncated = true;
      break;
    }
    const body = {
      kind: "timed_transcript_hypothesis" as const,
      range: segment.range,
      state: segment.state,
      text: segment.text,
    };
    observations.push({ ...body, observationId: semanticObservationId(operationId, body) });
    textBytes += bytes;
  }
  if (normalized.length > 0 && observations.length === 0) {
    throw new Error("Recognizer output cannot fit the first timed segment within the byte ceiling");
  }
  const availabilityState = result.availability;
  const reason = truncated ? "segment_or_byte_ceiling" as const : result.reason;
  const availability = {
    id: semanticAvailabilityId({
      operationId,
      state: availabilityState,
      reason,
      truncated,
      observationIds: observations.map((observation) => observation.observationId),
    }),
    state: availabilityState,
    reason,
    truncated,
  };
  const returnedRange = observations.length === 0 ? null : {
    startMs: Math.min(...observations.map((observation) => observation.range.startMs)),
    endMs: Math.max(...observations.map((observation) => observation.range.endMs)),
  };
  return { observations, availability, returnedRange };
}

export interface SemanticEvidenceHostResult {
  artifact: RuntimeArtifact;
  envelope: SemanticMediaEvidenceArtifact;
  receipt: SemanticMediaEvidenceReceipt;
  receiptContentId: string;
}

export class SpeechTranscribeCapabilityHost {
  private readonly ledger: RuntimeLedger;
  private readonly artifacts: ContentAddressedArtifactStore;
  private readonly recognizer: CurrentRunSpeechRecognizer;
  private readonly timeoutMs: number;

  constructor(
    ledger: RuntimeLedger,
    artifacts: ContentAddressedArtifactStore,
    options: { recognizer?: CurrentRunSpeechRecognizer; timeoutMs?: number } = {},
  ) {
    this.ledger = ledger;
    this.artifacts = artifacts;
    this.recognizer = options.recognizer ?? new UnavailableCurrentRunSpeechRecognizer();
    this.timeoutMs = Math.min(options.timeoutMs ?? SEMANTIC_EVIDENCE_LIMITS.maxWallMs, SEMANTIC_EVIDENCE_LIMITS.maxWallMs);
  }

  async transcribe(requestValue: unknown): Promise<SemanticEvidenceHostResult> {
    const stateBefore = this.ledger.state();
    const authorization = authorizeSpeechTranscribe(stateBefore, requestValue);
    const task = stateBefore.tasks[authorization.request.taskId];
    const producer = validateCurrentRunRecognizerDescriptor(
      await this.recognizer.describe({ requestedSourceLanguage: task.jobContext.requestedSourceLanguagePolicy }),
      "Current-run recognizer descriptor",
      "producer",
    );
    const started = await this.ledger.transact(
      { producer: { kind: "semantic_evidence_host", id: "speech-transcribe-capability-host" } },
      ({ state }) => {
        const checked = authorizeSpeechTranscribe(state, requestValue);
        if (
          checked.executionId !== authorization.executionId ||
          checked.launchClaimId !== authorization.launchClaimId ||
          checked.grant.id !== authorization.grant.id
        ) throw new Error("Speech transcription authorization changed before start");
        return {
          pending: [{
            type: "semantic.evidence_started",
            data: {
              request: checked.request,
              grantId: checked.grant.id,
              executionId: checked.executionId,
              launchClaimId: checked.launchClaimId,
              sourceContentId: checked.artifact.content.contentId,
              producer,
              limits: SEMANTIC_EVIDENCE_LIMITS,
            },
          }] satisfies PendingRuntimeEvent[],
          result: checked,
        };
      },
    );
    const { request, grant, artifact: source, track, executionId, launchClaimId } = started.result;
    try {
      const sourcePath = await this.artifacts.resolveVerified(source);
      const timeoutMs = Math.max(1, Math.min(this.timeoutMs, task.budget.wallMs));
      const result = await boundedRecognition(this.recognizer, {
        sourcePath,
        trackIndex: track.index,
        range: { startMs: request.startMs, endMs: request.endMs },
        requestedSourceLanguage: task.jobContext.requestedSourceLanguagePolicy,
      }, timeoutMs);
      const closed = closeRecognizerResult(
        request.operationId,
        { startMs: request.startMs, endMs: request.endMs },
        result,
      );
      const envelope = validateSemanticMediaEvidenceArtifact({
        schema: "studio.semantic-media-evidence.v1",
        operationId: request.operationId,
        runId: this.ledger.runId,
        capability: "speech.transcribe",
        authorization: {
          grantId: grant.id,
          taskId: request.taskId,
          agentId: request.agentId,
          executionId,
          launchClaimId,
        },
        source: { artifactId: source.id, contentId: source.content.contentId, trackId: request.trackId },
        requestedRange: { startMs: request.startMs, endMs: request.endMs },
        returnedRange: closed.returnedRange,
        normalization: SEMANTIC_EVIDENCE_NORMALIZATION,
        producer,
        limits: SEMANTIC_EVIDENCE_LIMITS,
        availability: closed.availability,
        observations: closed.observations,
      });
      const prepared = await this.artifacts.prepareSemanticEvidence(this.ledger.runId, envelope);
      const receiptWithoutId: Omit<SemanticMediaEvidenceReceipt, "receiptId"> = {
        schema: "studio.semantic-media-evidence.receipt.v1",
        operationId: request.operationId,
        capability: "speech.transcribe",
        authorization: structuredClone(envelope.authorization),
        source: structuredClone(envelope.source),
        request: structuredClone(envelope.requestedRange),
        returnedRange: structuredClone(envelope.returnedRange),
        normalization: structuredClone(envelope.normalization),
        producer: structuredClone(envelope.producer),
        limits: SEMANTIC_EVIDENCE_LIMITS,
        output: {
          artifactId: prepared.artifactId,
          contentId: prepared.content.contentId,
          bytes: prepared.content.bytes,
          schema: "studio.semantic-media-evidence.v1",
        },
        availability: structuredClone(envelope.availability),
        observations: structuredClone(envelope.observations),
        claims: { accuracy: "not_assessed", understanding: "not_claimed" },
      };
      const receipt = validateSemanticMediaEvidenceReceipt({
        ...receiptWithoutId,
        receiptId: semanticReceiptId(receiptWithoutId),
      });
      const storedReceipt = await this.artifacts.storeJson(receipt);
      const artifact = this.artifacts.buildSemanticEvidenceArtifact({
        runId: this.ledger.runId,
        receiptId: receipt.receiptId,
        receiptContentId: storedReceipt.content.contentId,
        prepared,
      });
      await this.artifacts.record(this.ledger, artifact, request.operationId);
      await this.ledger.transact(
        { producer: { kind: "semantic_evidence_host", id: "speech-transcribe-capability-host" }, causationId: request.operationId },
        () => ({
          pending: [{
            type: "semantic.evidence_completed",
            data: {
              operationId: request.operationId,
              outputArtifactId: artifact.id,
              outputContentId: artifact.content.contentId,
              receiptContentId: storedReceipt.content.contentId,
              receipt,
            },
          }] satisfies PendingRuntimeEvent[],
          result: undefined,
        }),
      );
      const verified = await reopenSemanticEvidence(this.ledger.state(), this.artifacts, request.operationId);
      return {
        artifact,
        envelope: verified.envelope,
        receipt: verified.receipt,
        receiptContentId: verified.receiptContentId,
      };
    } catch (error) {
      if (this.ledger.state().semanticEvidence[request.operationId]?.status === "started") {
        await this.ledger.transact(
          { producer: { kind: "semantic_evidence_host", id: "speech-transcribe-capability-host" }, causationId: request.operationId },
          () => ({
            pending: [{
              type: "semantic.evidence_failed",
              data: { operationId: request.operationId, reason: safeFailure(error) },
            }] satisfies PendingRuntimeEvent[],
            result: undefined,
          }),
        );
      }
      throw error;
    }
  }
}
