import { performance } from "node:perf_hooks";

import { ContentAddressedArtifactStore } from "./artifactStore.ts";
import {
  buildOcrObservationsArtifact,
  buildOcrReceiptArtifact,
  ocrObservationsArtifactId,
  ocrReceiptArtifactId,
} from "./artifactStore/ocrArtifacts.ts";
import { authorizeOcr } from "./authorization.ts";
import { auditFrameSampling } from "./frameAudit.ts";
import type { FrameDecoder } from "./frames/decoder.ts";
import { FfmpegFrameDecoder } from "./frames/ffmpegDecoder.ts";
import type { RuntimeLedger } from "./journal.ts";
import type {
  OcrArtifactState,
  OcrFailureReason,
  OcrFrameObservations,
  OcrObservations,
  OcrReceipt,
} from "./model.ts";
import type { OcrRecognizer } from "./ocr/recognizer.ts";
import { OcrRecognizerFailure } from "./ocr/recognizer.ts";
import { TesseractJsOcrRecognizer } from "./ocr/tesseractRecognizer.ts";
import type { PendingRuntimeEvent } from "./protocol.ts";
import {
  normalizeOcrText,
  ocrObservationId,
  ocrReceiptId,
  validateOcrObservations,
  validateOcrReceipt,
} from "./validation/ocr.ts";

export interface VerifiedOcr {
  observations: OcrObservations;
  observationsArtifact: ReturnType<typeof buildOcrObservationsArtifact>;
  receipt: OcrReceipt;
  receiptArtifact: ReturnType<typeof buildOcrReceiptArtifact>;
}

function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function reasonFromState(state: OcrArtifactState | OcrFrameObservations["state"]): OcrObservations["reason"] {
  if (state === "available") return "hypotheses_emitted";
  if (state === "empty") return "no_text_detected";
  if (state === "truncated") return "output_limit_exceeded";
  return "all_text_below_confidence";
}

function boxesOverlap(
  left: { x0: number; y0: number; x1: number; y1: number },
  right: { x0: number; y0: number; x1: number; y1: number },
): boolean {
  return left.x0 < right.x1 && right.x0 < left.x1 && left.y0 < right.y1 && right.y0 < left.y1;
}

function failureReason(error: unknown): OcrFailureReason {
  if (error instanceof OcrRecognizerFailure) return error.reason;
  if (error instanceof Error && error.message.startsWith("OCR input")) return "input_oversized";
  if (error instanceof Error && error.message.startsWith("OCR artifact")) return "artifact_oversized";
  if (error instanceof Error && error.message.includes("lineage drift")) return "runtime_drift";
  if (error instanceof Error && error.message.startsWith("Frame audit")) return "frame_lineage_unavailable";
  return "recognizer_failed";
}

export class BoundedOcrHost {
  private readonly ledger: RuntimeLedger;
  private readonly artifacts: ContentAddressedArtifactStore;
  private readonly recognizer: OcrRecognizer;
  private readonly frameDecoder: FrameDecoder;

  constructor(
    ledger: RuntimeLedger,
    artifacts: ContentAddressedArtifactStore,
    options: { recognizer?: OcrRecognizer; frameDecoder?: FrameDecoder } = {},
  ) {
    this.ledger = ledger;
    this.artifacts = artifacts;
    this.recognizer = options.recognizer ?? new TesseractJsOcrRecognizer();
    this.frameDecoder = options.frameDecoder ?? new FfmpegFrameDecoder();
  }

  async recognize(requestValue: unknown): Promise<VerifiedOcr> {
    const start = performance.now();
    const started = await this.ledger.transact(
      { producer: { kind: "ocr_host", id: "bounded-ocr-host" } },
      ({ state }) => {
        const authorization = authorizeOcr(state, requestValue);
        return {
          pending: [{
            type: "media.frames_ocr_started",
            data: {
              request: authorization.request,
              scope: authorization.scope,
              sourceContentId: authorization.artifact.content.contentId,
              executionId: authorization.executionId,
              launchClaimId: authorization.launchClaimId,
              requestFingerprint: authorization.requestFingerprint,
              limits: structuredClone(authorization.grant.ocrScope.limits),
            },
          }] satisfies PendingRuntimeEvent[],
          result: authorization,
        };
      },
    );
    const { request, grant, scope, artifact: source, executionId, launchClaimId } = started.result;
    const maximumWallMs = Math.min(grant.ocrScope.limits.maxWallMs, this.ledger.state().tasks[request.taskId].budget.wallMs);
    const deadlineAtMs = start + maximumWallMs;
    try {
      let verifiedFrames;
      try {
        verifiedFrames = await auditFrameSampling(
          this.ledger.state(),
          this.artifacts,
          this.frameDecoder,
          request.frameSamplingOperationId,
          { maxWallMs: Math.max(1, Math.floor(deadlineAtMs - performance.now())) },
        );
      } catch (cause) {
        throw new Error(`Frame audit failed before OCR: ${cause instanceof Error ? cause.message : "unknown frame lineage failure"}`, { cause });
      }
      if (verifiedFrames.frames.length > grant.ocrScope.limits.maxFrames) throw new Error("OCR input exceeds the frame count limit");
      const inputBytes = verifiedFrames.frames.reduce((sum, frame) => {
        if (frame.bytes.length > grant.ocrScope.limits.maxInputFrameBytes) throw new Error("OCR input exceeds the per-frame byte limit");
        return sum + frame.bytes.length;
      }, 0);
      if (inputBytes > grant.ocrScope.limits.maxTotalInputBytes) throw new Error("OCR input exceeds the aggregate byte limit");
      const recognized = await this.recognizer.recognize(verifiedFrames.frames, deadlineAtMs);
      if (recognized.frames.length !== verifiedFrames.frames.length ||
          recognized.frames.some((frame, index) => frame.frameId !== verifiedFrames.frames[index].identity.frameId)) {
        throw new OcrRecognizerFailure("recognizer_failed", "OCR recognizer changed the ordered U2 frame set");
      }
      const lineageAfter = await this.recognizer.currentLineage(deadlineAtMs);
      if (!same(recognized.lineage, lineageAfter)) throw new Error("OCR runtime/model lineage drifted during recognition");
      let totalBoxes = 0;
      let totalCodePoints = 0;
      const frames: OcrFrameObservations[] = recognized.frames.map((recognizedFrame, frameIndex) => {
        const verified = verifiedFrames.frames[frameIndex];
        const normalized = recognizedFrame.candidates
          .map((candidate) => ({ ...candidate, text: normalizeOcrText(candidate.text) }))
          .filter((candidate) => candidate.text.length > 0);
        const invalidBox = normalized.some(({ boundingBox }) =>
          !Number.isSafeInteger(boundingBox.x0) || !Number.isSafeInteger(boundingBox.y0) ||
          !Number.isSafeInteger(boundingBox.x1) || !Number.isSafeInteger(boundingBox.y1) ||
          boundingBox.x0 < 0 || boundingBox.y0 < 0 || boundingBox.x1 <= boundingBox.x0 || boundingBox.y1 <= boundingBox.y0 ||
          boundingBox.x1 > verified.identity.width || boundingBox.y1 > verified.identity.height);
        if (invalidBox) throw new OcrRecognizerFailure("recognizer_failed", "OCR recognizer returned an invalid frame bounding box");
        const candidateCodePoints = normalized.reduce((sum, candidate) => sum + [...candidate.text].length, 0);
        const truncated = normalized.length > grant.ocrScope.limits.maxBoxesPerFrame ||
          totalBoxes + normalized.length > grant.ocrScope.limits.maxTotalBoxes ||
          normalized.some((candidate) => [...candidate.text].length > grant.ocrScope.limits.maxTextCodePointsPerBox) ||
          totalCodePoints + candidateCodePoints > grant.ocrScope.limits.maxTotalTextCodePoints;
        if (truncated) {
          return {
            frameId: verified.identity.frameId,
            frameArtifactId: verified.artifact.id,
            frameContentId: verified.artifact.content.contentId,
            requestedTimestampMs: verified.identity.requestedTimestampMs,
            actualTimestampUs: verified.identity.actualPresentationTimestamp.microseconds,
            width: verified.identity.width,
            height: verified.identity.height,
            state: "truncated",
            reason: "output_limit_exceeded",
            observations: [],
          };
        }
        const observations = normalized.map((candidate, candidateIndex) => {
          const confidence = Math.max(0, Math.min(100, Math.round(candidate.confidence)));
          const conflicting = normalized.some((other, otherIndex) =>
            otherIndex !== candidateIndex && other.text !== candidate.text && boxesOverlap(candidate.boundingBox, other.boundingBox));
          const available = confidence >= grant.ocrScope.limits.minConfidence && !conflicting;
          const reason = available
            ? "confidence_at_or_above_threshold" as const
            : conflicting ? "conflicting_hypotheses" as const : "below_confidence_threshold" as const;
          const body = {
            operationId: request.operationId,
            frameId: verified.identity.frameId,
            candidateIndex,
            boundingBox: candidate.boundingBox,
            normalizedText: available ? candidate.text : null,
            confidence,
            state: available ? "available" as const : "unknown" as const,
            reason,
          };
          return { observationId: ocrObservationId(body), ...body };
        }).map(({ operationId: _operationId, candidateIndex: _candidateIndex, ...observation }) => observation);
        totalBoxes += observations.length;
        totalCodePoints += observations.reduce((sum, observation) =>
          sum + (observation.normalizedText === null ? 0 : [...observation.normalizedText].length), 0);
        const state: OcrFrameObservations["state"] = observations.length === 0
          ? "empty"
          : observations.some((observation) => observation.state === "available") ? "available" : "unknown";
        const reason = state === "unknown" && observations.some((observation) => observation.reason === "conflicting_hypotheses")
          ? "conflicting_hypotheses_withheld" as const
          : reasonFromState(state);
        return {
          frameId: verified.identity.frameId,
          frameArtifactId: verified.artifact.id,
          frameContentId: verified.artifact.content.contentId,
          requestedTimestampMs: verified.identity.requestedTimestampMs,
          actualTimestampUs: verified.identity.actualPresentationTimestamp.microseconds,
          width: verified.identity.width,
          height: verified.identity.height,
          state,
          reason,
          observations,
        };
      });
      const state: OcrArtifactState = frames.some((frame) => frame.state === "truncated")
        ? "truncated"
        : frames.some((frame) => frame.state === "available")
          ? "available"
          : frames.every((frame) => frame.state === "empty") ? "empty" : "unknown";
      const nonClaims: OcrObservations["nonClaims"] = {
        textTruth: "not_assessed",
        identity: "not_assessed",
        spellingTruth: "not_assessed",
        translation: "not_performed",
        culturalMeaning: "not_assessed",
        dialogueAuthority: "not_granted",
        personIdentification: "not_performed",
      };
      const artifactReason = state === "unknown" && frames.some((frame) => frame.reason === "conflicting_hypotheses_withheld")
        ? "conflicting_hypotheses_withheld" as const
        : reasonFromState(state);
      const observations: OcrObservations = validateOcrObservations({
        schema: "studio.ocr-observations.v1",
        operationId: request.operationId,
        runId: this.ledger.runId,
        source: {
          artifactId: source.id,
          contentId: source.content.contentId,
          videoTrackId: scope.trackId,
          grantedRange: { startMs: scope.startMs, endMs: scope.endMs },
        },
        frameSampling: {
          operationId: verifiedFrames.receipt.operationId,
          manifestArtifactId: verifiedFrames.manifestArtifact.id,
          manifestContentId: verifiedFrames.manifestArtifact.content.contentId,
          receiptId: verifiedFrames.receipt.receiptId,
          receiptArtifactId: verifiedFrames.receiptArtifact.id,
          receiptContentId: verifiedFrames.receiptArtifact.content.contentId,
        },
        producer: recognized.lineage,
        limits: structuredClone(grant.ocrScope.limits),
        state,
        reason: artifactReason,
        frames,
        nonClaims,
      });
      const storedObservations = await this.artifacts.storeJson(observations);
      if (storedObservations.content.bytes > grant.ocrScope.limits.maxObservationBytes) throw new Error("OCR artifact exceeds its observation byte limit");
      const preparedObservations = {
        artifactId: ocrObservationsArtifactId(this.ledger.runId, request.operationId, storedObservations.content.contentId),
        ...storedObservations,
      };
      const measuredBeforeReceiptMs = Math.ceil(performance.now() - start);
      if (measuredBeforeReceiptMs > maximumWallMs) throw new OcrRecognizerFailure("recognizer_timeout", "OCR exceeded its wall-time grant");
      const receiptWithoutId: Omit<OcrReceipt, "receiptId"> = {
        schema: "studio.ocr-producer.receipt.v1",
        operationId: request.operationId,
        capability: "media.frames.ocr",
        authorization: { grantId: grant.id, taskId: request.taskId, agentId: request.agentId, executionId, launchClaimId },
        request: { frameSamplingOperationId: request.frameSamplingOperationId },
        input: {
          artifactId: source.id,
          contentId: source.content.contentId,
          videoTrackId: scope.trackId,
          grantedRange: { startMs: scope.startMs, endMs: scope.endMs },
          operationId: verifiedFrames.receipt.operationId,
          manifestArtifactId: verifiedFrames.manifestArtifact.id,
          manifestContentId: verifiedFrames.manifestArtifact.content.contentId,
          receiptId: verifiedFrames.receipt.receiptId,
          receiptArtifactId: verifiedFrames.receiptArtifact.id,
          receiptContentId: verifiedFrames.receiptArtifact.content.contentId,
          frames: verifiedFrames.frames.map((frame) => ({
            frameId: frame.identity.frameId,
            artifactId: frame.artifact.id,
            contentId: frame.artifact.content.contentId,
            bytes: frame.bytes.length,
            actualTimestampUs: frame.identity.actualPresentationTimestamp.microseconds,
          })),
        },
        producer: recognized.lineage,
        limits: structuredClone(grant.ocrScope.limits),
        execution: {
          wallMs: maximumWallMs,
          measuredBeforeReceiptMs,
          wallAccounting: "full_grant_charged_before_atomic_completion",
          frameCount: verifiedFrames.frames.length,
          inputBytes,
          emittedBoxes: totalBoxes,
        },
        output: {
          artifactId: preparedObservations.artifactId,
          contentId: preparedObservations.content.contentId,
          bytes: preparedObservations.content.bytes,
          state,
        },
        nonClaims,
      };
      const receipt: OcrReceipt = validateOcrReceipt({ ...receiptWithoutId, receiptId: ocrReceiptId(receiptWithoutId) });
      const storedReceipt = await this.artifacts.storeJson(receipt);
      if (storedReceipt.content.bytes > grant.ocrScope.limits.maxReceiptBytes) throw new Error("OCR artifact exceeds its receipt byte limit");
      const preparedReceipt = {
        artifactId: ocrReceiptArtifactId(this.ledger.runId, request.operationId, storedReceipt.content.contentId),
        ...storedReceipt,
      };
      const u2Sources = [source.id, verifiedFrames.manifestArtifact.id, verifiedFrames.receiptArtifact.id, ...verifiedFrames.frames.map((frame) => frame.artifact.id)];
      const observationsArtifact = buildOcrObservationsArtifact({
        runId: this.ledger.runId,
        sourceArtifactIds: u2Sources,
        taskId: request.taskId,
        agentId: request.agentId,
        receipt,
        receiptContentId: preparedReceipt.content.contentId,
        prepared: preparedObservations,
      });
      const receiptArtifact = buildOcrReceiptArtifact({
        runId: this.ledger.runId,
        sourceArtifactIds: [source.id, observationsArtifact.id, ...u2Sources.slice(1)],
        taskId: request.taskId,
        agentId: request.agentId,
        receipt,
        prepared: preparedReceipt,
      });
      await Promise.all([observationsArtifact, receiptArtifact].map((artifact) => this.artifacts.resolveVerified(artifact)));
      if (performance.now() >= deadlineAtMs) throw new OcrRecognizerFailure("recognizer_timeout", "OCR exceeded its wall-time grant");
      await this.ledger.transact(
        { producer: { kind: "ocr_host", id: "bounded-ocr-host" }, causationId: request.operationId },
        () => ({
          pending: [
            { type: "artifact.recorded", data: { artifact: observationsArtifact } },
            { type: "artifact.recorded", data: { artifact: receiptArtifact } },
            {
              type: "media.frames_ocr_completed",
              data: {
                operationId: request.operationId,
                outputArtifactId: observationsArtifact.id,
                receiptArtifactId: receiptArtifact.id,
                receiptContentId: receiptArtifact.content.contentId,
                receipt,
              },
            },
          ] satisfies PendingRuntimeEvent[],
          result: undefined,
        }),
      );
      return { observations, observationsArtifact, receipt, receiptArtifact };
    } catch (error) {
      if (this.ledger.state().ocrOperations[request.operationId]?.status === "started") {
        await this.ledger.transact(
          { producer: { kind: "ocr_host", id: "bounded-ocr-host" }, causationId: request.operationId },
          () => ({
            pending: [{ type: "media.frames_ocr_failed", data: { operationId: request.operationId, reason: failureReason(error) } }] satisfies PendingRuntimeEvent[],
            result: undefined,
          }),
        );
      }
      throw error;
    }
  }
}
