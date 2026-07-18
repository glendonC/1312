import { performance } from "node:perf_hooks";

import { ContentAddressedArtifactStore } from "../artifactStore.ts";
import {
  buildVisualTransitionObservationsArtifact,
  buildVisualTransitionReceiptArtifact,
  visualTransitionObservationsArtifactId,
  visualTransitionReceiptArtifactId,
} from "../artifactStore/visualTransitionArtifacts.ts";
import { auditFrameSampling } from "../frameAudit.ts";
import type { FrameDecoder } from "../frames/decoder.ts";
import { FfmpegFrameDecoder } from "../frames/ffmpegDecoder.ts";
import type { RuntimeLedger } from "../journal.ts";
import type {
  VisualTransitionFailureReason,
  VisualTransitionNonClaims,
  VisualTransitionObservations,
  VisualTransitionReceipt,
} from "../model/visualTransitions.ts";
import type { OcrRecognizer } from "../ocr/recognizer.ts";
import { auditOcr } from "../ocrAudit.ts";
import type { PendingRuntimeEvent } from "../protocol.ts";
import {
  validateVisualTransitionObservations,
  validateVisualTransitionReceipt,
  visualTransitionReceiptId,
} from "../validation/visualTransitions.ts";
import {
  DeterministicRgbGridVisualTransitionAnalyzer,
  type VisualTransitionAnalyzer,
} from "./analyzer.ts";
import { authorizeVisualTransition } from "./authorization.ts";
import { visualTransitionFrameIdentity } from "./lineage.ts";

export interface VerifiedVisualTransition {
  observations: VisualTransitionObservations;
  observationsArtifact: ReturnType<typeof buildVisualTransitionObservationsArtifact>;
  receipt: VisualTransitionReceipt;
  receiptArtifact: ReturnType<typeof buildVisualTransitionReceiptArtifact>;
}

function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function failureReason(error: unknown): VisualTransitionFailureReason {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("wall limit") || message.includes("wall-time") || message.includes("timeout")) return "producer_timeout";
  if (message.includes("frame count") || message.includes("byte limit") || message.includes("exceeds")) return "input_limit_exceeded";
  if (message.includes("frame set") || message.includes("ordered") || message.includes("dimensions")) return "frame_set_mismatch";
  if (message.includes("audit") || message.includes("lineage") || message.includes("U2") || message.includes("U5")) return "input_lineage_invalid";
  return "producer_failed";
}

const NON_CLAIMS: VisualTransitionNonClaims = {
  sceneBoundary: "not_assessed",
  shotBoundary: "not_assessed",
  visualUnderstanding: "not_assessed",
  rightFrameSelection: "not_assessed",
  ocrTextTruth: "not_assessed",
  semanticCorrectness: "not_assessed",
  dialogueAuthority: "not_granted",
  captionAuthority: "not_granted",
  personIdentification: "not_performed",
};

export class BoundedVisualTransitionHost {
  private readonly ledger: RuntimeLedger;
  private readonly artifacts: ContentAddressedArtifactStore;
  private readonly frameDecoder: FrameDecoder;
  private readonly recognizer: OcrRecognizer | undefined;
  private readonly analyzer: VisualTransitionAnalyzer;

  constructor(
    ledger: RuntimeLedger,
    artifacts: ContentAddressedArtifactStore,
    options: { frameDecoder?: FrameDecoder; recognizer?: OcrRecognizer; analyzer?: VisualTransitionAnalyzer } = {},
  ) {
    this.ledger = ledger;
    this.artifacts = artifacts;
    this.frameDecoder = options.frameDecoder ?? new FfmpegFrameDecoder();
    this.recognizer = options.recognizer;
    this.analyzer = options.analyzer ?? new DeterministicRgbGridVisualTransitionAnalyzer();
  }

  async analyze(requestValue: unknown): Promise<VerifiedVisualTransition> {
    const start = performance.now();
    const started = await this.ledger.transact(
      { producer: { kind: "visual_transition_host", id: "bounded-visual-transition-host" } },
      ({ state }) => {
        const authorization = authorizeVisualTransition(state, requestValue);
        return {
          pending: [{
            type: "media.visual_transitions_started",
            data: {
              request: authorization.request,
              scope: authorization.scope,
              sourceContentId: authorization.artifact.content.contentId,
              executionId: authorization.executionId,
              launchClaimId: authorization.launchClaimId,
              requestFingerprint: authorization.requestFingerprint,
              limits: structuredClone(authorization.grant.visualTransitionScope.limits),
            },
          }] satisfies PendingRuntimeEvent[],
          result: authorization,
        };
      },
    );
    const { request, grant, scope, artifact: source, executionId, launchClaimId } = started.result;
    const maximumWallMs = Math.min(
      grant.visualTransitionScope.limits.maxWallMs,
      this.ledger.state().tasks[request.taskId].budget.wallMs,
    );
    const deadlineAtMs = start + maximumWallMs;
    try {
      const remainingWallMs = () => Math.max(1, Math.floor(deadlineAtMs - performance.now()));
      const verifiedFrames = await auditFrameSampling(
        this.ledger.state(),
        this.artifacts,
        this.frameDecoder,
        request.frameSamplingOperationId,
        { maxWallMs: remainingWallMs() },
      );
      const verifiedOcr = await auditOcr(this.ledger.state(), this.artifacts, request.ocrOperationId, {
        frameDecoder: this.frameDecoder,
        recognizer: this.recognizer,
        maxWallMs: remainingWallMs(),
      });
      if (verifiedFrames.frames.length < grant.visualTransitionScope.limits.minFrames ||
          verifiedFrames.frames.length > grant.visualTransitionScope.limits.maxFrames ||
          verifiedOcr.observations.frames.length !== verifiedFrames.frames.length) {
        throw new Error("Visual-transition input changed its bounded frame count");
      }
      const frames = verifiedFrames.frames.map((frame, index) => visualTransitionFrameIdentity(frame, verifiedOcr.observations.frames[index]));
      const inputBytes = frames.reduce((sum, frame) => {
        if (frame.bytes > grant.visualTransitionScope.limits.maxInputFrameBytes) {
          throw new Error("Visual-transition input exceeds the per-frame byte limit");
        }
        return sum + frame.bytes;
      }, 0);
      if (inputBytes > grant.visualTransitionScope.limits.maxTotalInputBytes) {
        throw new Error("Visual-transition input exceeds the aggregate byte limit");
      }
      const analysis = this.analyzer.analyze({
        operationId: request.operationId,
        grantedRange: { startMs: scope.startMs, endMs: scope.endMs },
        frames: verifiedFrames.frames.map((frame, index) => ({ identity: frames[index], bytes: frame.bytes })),
      }, deadlineAtMs);
      const frameSampling = {
        operationId: verifiedFrames.receipt.operationId,
        manifestArtifactId: verifiedFrames.manifestArtifact.id,
        manifestContentId: verifiedFrames.manifestArtifact.content.contentId,
        receiptId: verifiedFrames.receipt.receiptId,
        receiptArtifactId: verifiedFrames.receiptArtifact.id,
        receiptContentId: verifiedFrames.receiptArtifact.content.contentId,
      };
      const ocr = {
        operationId: verifiedOcr.receipt.operationId,
        observationsArtifactId: verifiedOcr.observationsArtifact.id,
        observationsContentId: verifiedOcr.observationsArtifact.content.contentId,
        receiptId: verifiedOcr.receipt.receiptId,
        receiptArtifactId: verifiedOcr.receiptArtifact.id,
        receiptContentId: verifiedOcr.receiptArtifact.content.contentId,
      };
      const sourceLineage = {
        artifactId: source.id,
        contentId: source.content.contentId,
        videoTrackId: scope.trackId,
        grantedRange: { startMs: scope.startMs, endMs: scope.endMs },
      };
      const observations = validateVisualTransitionObservations({
        schema: "studio.visual-transition-observations.v1",
        operationId: request.operationId,
        runId: this.ledger.runId,
        source: sourceLineage,
        frameSampling,
        ocr,
        producer: analysis.producer,
        limits: structuredClone(grant.visualTransitionScope.limits),
        frames,
        intervals: analysis.intervals,
        nonClaims: NON_CLAIMS,
      });
      const storedObservations = await this.artifacts.storeJson(observations);
      if (storedObservations.content.bytes > grant.visualTransitionScope.limits.maxObservationBytes) {
        throw new Error("Visual-transition artifact exceeds its observation byte limit");
      }
      const preparedObservations = {
        artifactId: visualTransitionObservationsArtifactId(this.ledger.runId, request.operationId, storedObservations.content.contentId),
        ...storedObservations,
      };
      const measuredBeforeReceiptMs = Math.ceil(performance.now() - start);
      if (measuredBeforeReceiptMs > maximumWallMs) throw new Error("Visual-transition analysis exceeded its wall-time grant");
      const receiptWithoutId: Omit<VisualTransitionReceipt, "receiptId"> = {
        schema: "studio.visual-transition-producer.receipt.v1",
        operationId: request.operationId,
        capability: "media.visual-transitions.analyze",
        authorization: { grantId: grant.id, taskId: request.taskId, agentId: request.agentId, executionId, launchClaimId },
        request: { frameSamplingOperationId: request.frameSamplingOperationId, ocrOperationId: request.ocrOperationId },
        input: { source: sourceLineage, frameSampling, ocr, frames },
        producer: analysis.producer,
        limits: structuredClone(grant.visualTransitionScope.limits),
        execution: {
          wallMs: maximumWallMs,
          measuredBeforeReceiptMs,
          wallAccounting: "full_grant_charged_before_atomic_completion",
          frameCount: frames.length,
          intervalCount: analysis.intervals.length,
          inputBytes,
          sampledRgbValues: analysis.sampledRgbValues,
        },
        output: {
          artifactId: preparedObservations.artifactId,
          content: preparedObservations.content,
          intervalIds: analysis.intervals.map((interval) => interval.intervalId),
        },
        nonClaims: NON_CLAIMS,
      };
      const receipt = validateVisualTransitionReceipt({
        ...receiptWithoutId,
        receiptId: visualTransitionReceiptId(receiptWithoutId),
      });
      if (!same(receipt.producer, observations.producer)) throw new Error("Visual-transition producer lineage changed before receipt");
      const storedReceipt = await this.artifacts.storeJson(receipt);
      if (storedReceipt.content.bytes > grant.visualTransitionScope.limits.maxReceiptBytes) {
        throw new Error("Visual-transition artifact exceeds its receipt byte limit");
      }
      const preparedReceipt = {
        artifactId: visualTransitionReceiptArtifactId(this.ledger.runId, request.operationId, storedReceipt.content.contentId),
        ...storedReceipt,
      };
      const upstreamArtifactIds = [
        source.id,
        verifiedFrames.manifestArtifact.id,
        verifiedFrames.receiptArtifact.id,
        ...verifiedFrames.frames.map((frame) => frame.artifact.id),
        verifiedOcr.observationsArtifact.id,
        verifiedOcr.receiptArtifact.id,
      ];
      const observationsArtifact = buildVisualTransitionObservationsArtifact({
        runId: this.ledger.runId,
        sourceArtifactIds: upstreamArtifactIds,
        taskId: request.taskId,
        agentId: request.agentId,
        receipt,
        receiptContentId: preparedReceipt.content.contentId,
        prepared: preparedObservations,
      });
      const receiptArtifact = buildVisualTransitionReceiptArtifact({
        runId: this.ledger.runId,
        sourceArtifactIds: [...upstreamArtifactIds, observationsArtifact.id],
        taskId: request.taskId,
        agentId: request.agentId,
        receipt,
        prepared: preparedReceipt,
      });
      await Promise.all([observationsArtifact, receiptArtifact].map((artifact) => this.artifacts.resolveVerified(artifact)));
      if (performance.now() >= deadlineAtMs) throw new Error("Visual-transition analysis exceeded its wall-time grant");
      await this.ledger.transact(
        { producer: { kind: "visual_transition_host", id: "bounded-visual-transition-host" }, causationId: request.operationId },
        () => ({
          pending: [
            { type: "artifact.recorded", data: { artifact: observationsArtifact } },
            { type: "artifact.recorded", data: { artifact: receiptArtifact } },
            {
              type: "media.visual_transitions_completed",
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
      const state = this.ledger.state() as ReturnType<RuntimeLedger["state"]> & {
        visualTransitionOperations: Record<string, { status: string }>;
      };
      if (state.visualTransitionOperations[request.operationId]?.status === "started") {
        await this.ledger.transact(
          { producer: { kind: "visual_transition_host", id: "bounded-visual-transition-host" }, causationId: request.operationId },
          () => ({
            pending: [{
              type: "media.visual_transitions_failed",
              data: { operationId: request.operationId, reason: failureReason(error) },
            }] satisfies PendingRuntimeEvent[],
            result: undefined,
          }),
        );
      }
      throw error;
    }
  }
}
