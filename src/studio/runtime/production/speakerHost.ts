import { execFile } from "node:child_process";
import { chmod, copyFile, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";

import { ContentAddressedArtifactStore, identifyFile } from "./artifactStore.ts";
import {
  buildSpeakerObservationsArtifact,
  buildSpeakerReceiptArtifact,
  speakerObservationsArtifactId,
  speakerReceiptArtifactId,
} from "./artifactStore/speakerArtifacts.ts";
import { authorizeSpeakerOverlap } from "./authorization.ts";
import type { RuntimeLedger } from "./journal.ts";
import type {
  AnonymousSpeakerTurnHypothesis,
  SpeakerAccountingCell,
  SpeakerOverlapArtifactState,
  SpeakerOverlapFailureReason,
  SpeakerOverlapObservations,
  SpeakerOverlapReceipt,
} from "./model.ts";
import type { PendingRuntimeEvent } from "./protocol.ts";
import type { SpeakerDiarizer, SpeakerDiarizerSegment } from "./speaker/diarizer.ts";
import { SpeakerDiarizerFailure } from "./speaker/diarizer.ts";
import { SherpaOnnxSpeakerDiarizer } from "./speaker/sherpaOnnxDiarizer.ts";
import {
  speakerAccountingObservationId,
  speakerOverlapReceiptId,
  speakerTurnId,
  validateSpeakerOverlapObservations,
  validateSpeakerOverlapProducerLineage,
  validateSpeakerOverlapReceipt,
} from "./validation/speakers.ts";

export interface VerifiedSpeakerOverlap {
  observations: SpeakerOverlapObservations;
  observationsArtifact: ReturnType<typeof buildSpeakerObservationsArtifact>;
  receipt: SpeakerOverlapReceipt;
  receiptArtifact: ReturnType<typeof buildSpeakerReceiptArtifact>;
}

function execute(file: string, args: readonly string[], timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(file, [...args], { timeout: timeoutMs, maxBuffer: 1024 * 1024, windowsHide: true }, (error) => error ? reject(error) : resolve());
  });
}

function failureReason(error: unknown): SpeakerOverlapFailureReason {
  if (error instanceof SpeakerDiarizerFailure) return error.reason;
  if (error instanceof SpeakerHostFailure) return error.reason;
  return "diarizer_failed";
}

class SpeakerHostFailure extends Error {
  readonly reason: SpeakerOverlapFailureReason;

  constructor(reason: SpeakerOverlapFailureReason, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "SpeakerHostFailure";
    this.reason = reason;
  }
}

function nonClaims(): SpeakerOverlapObservations["nonClaims"] {
  return {
    personIdentity: "not_assessed",
    biometricIdentity: "not_performed",
    crossRunIdentity: "not_available",
    namedSpeakers: "not_available",
    transcriptCorrectness: "not_assessed",
    translationCorrectness: "not_assessed",
    dialogueAuthority: "not_granted",
    perfectDiarization: "not_claimed",
  };
}

function closeSegments(
  operationId: string,
  raw: readonly SpeakerDiarizerSegment[],
  range: { startMs: number; endMs: number },
  limits: SpeakerOverlapObservations["limits"],
): {
  turns: AnonymousSpeakerTurnHypothesis[];
  accounting: SpeakerAccountingCell[];
  state: SpeakerOverlapArtifactState;
  reason: SpeakerOverlapObservations["reason"];
  observedRawTurnCount: number;
  observedClusterCount: number;
} {
  const durationMs = range.endMs - range.startMs;
  const normalized = raw.map((segment) => ({
    startMs: range.startMs + Math.max(0, Math.min(durationMs, segment.startMs)),
    endMs: range.startMs + Math.max(0, Math.min(durationMs, segment.endMs)),
    speakerCluster: segment.speakerCluster,
  })).filter((segment) => segment.endMs > segment.startMs)
    .sort((left, right) => left.startMs - right.startMs || left.endMs - right.endMs || left.speakerCluster - right.speakerCluster);
  const rawClusters = [...new Set(normalized.map((segment) => segment.speakerCluster))];
  const boundaries = [...new Set([range.startMs, range.endMs, ...normalized.flatMap((segment) => [segment.startMs, segment.endMs])])].sort((left, right) => left - right);
  if (normalized.length > limits.maxTurns || rawClusters.length > limits.maxLocalSpeakerClusters || boundaries.length - 1 > limits.maxAccountingCells) {
    const cellWithoutId: Omit<SpeakerAccountingCell, "observationId"> = {
      index: 0,
      startMs: range.startMs,
      endMs: range.endMs,
      state: "truncated",
      kind: "output_limit_exceeded",
      speakerLabels: [],
      turnIds: [],
      uncertainty: { state: "not_applicable", reason: "output_limit_replaced_partial_result" },
    };
    return {
      turns: [],
      accounting: [{ ...cellWithoutId, observationId: speakerAccountingObservationId({ operationId, ...cellWithoutId }) }],
      state: "truncated",
      reason: "output_limit_exceeded",
      observedRawTurnCount: Math.min(normalized.length, limits.maxTurns + 1),
      observedClusterCount: Math.min(rawClusters.length, limits.maxLocalSpeakerClusters + 1),
    };
  }
  const labels = new Map(rawClusters.map((cluster, index) => [cluster, `anon_cluster_${index + 1}`]));
  const turns = normalized.map((segment): AnonymousSpeakerTurnHypothesis => {
    const speakerLabel = labels.get(segment.speakerCluster)!;
    const body = { operationId, startMs: segment.startMs, endMs: segment.endMs, speakerLabel };
    return {
      turnId: speakerTurnId(body),
      startMs: segment.startMs,
      endMs: segment.endMs,
      speakerLabel,
      uncertainty: { state: "unquantified", reason: "runtime_does_not_expose_segment_scores" },
    };
  });
  const accounting = boundaries.slice(0, -1).map((startMs, index): SpeakerAccountingCell => {
    const endMs = boundaries[index + 1];
    const active = turns.filter((turn) => turn.startMs <= startMs && turn.endMs >= endMs);
    const activeLabels = [...new Set(active.map((turn) => turn.speakerLabel))].sort();
    let body: Omit<SpeakerAccountingCell, "observationId">;
    if (activeLabels.length === 0) {
      body = {
        index, startMs, endMs, state: "unknown", kind: "no_hypothesis", speakerLabels: [], turnIds: [],
        uncertainty: { state: "weak", reason: "no_speaker_hypothesis_is_not_non_speech_proof" },
      };
    } else if (activeLabels.length > 1) {
      body = {
        index, startMs, endMs, state: "conflicting", kind: "overlap", speakerLabels: activeLabels,
        turnIds: active.map((turn) => turn.turnId).sort(),
        uncertainty: { state: "weak", reason: "overlap_hypothesis_requires_speech_restudy" },
      };
    } else if (endMs - startMs < limits.minReliableTurnMs) {
      body = {
        index, startMs, endMs, state: "unknown", kind: "rapid_turn", speakerLabels: activeLabels,
        turnIds: active.map((turn) => turn.turnId).sort(),
        uncertainty: { state: "weak", reason: "rapid_turn_boundary_below_reliability_floor" },
      };
    } else {
      body = {
        index, startMs, endMs, state: "available", kind: "anonymous_turn", speakerLabels: activeLabels,
        turnIds: active.map((turn) => turn.turnId).sort(),
        uncertainty: { state: "unquantified", reason: "runtime_does_not_expose_segment_scores" },
      };
    }
    return { ...body, observationId: speakerAccountingObservationId({ operationId, ...body }) };
  });
  if (turns.length === 0) return { turns, accounting, state: "empty", reason: "no_speaker_hypotheses", observedRawTurnCount: 0, observedClusterCount: 0 };
  if (accounting.some((cell) => cell.state === "available")) return { turns, accounting, state: "available", reason: "hypotheses_emitted", observedRawTurnCount: turns.length, observedClusterCount: rawClusters.length };
  return { turns, accounting, state: "unknown", reason: "all_cells_uncertain", observedRawTurnCount: turns.length, observedClusterCount: rawClusters.length };
}

export class BoundedSpeakerOverlapHost {
  private readonly ledger: RuntimeLedger;
  private readonly artifacts: ContentAddressedArtifactStore;
  private readonly diarizer: SpeakerDiarizer;
  private readonly ffmpeg: string;
  private readonly temporaryRoot: string;

  constructor(
    ledger: RuntimeLedger,
    artifacts: ContentAddressedArtifactStore,
    options: { diarizer?: SpeakerDiarizer; ffmpeg?: string; temporaryRoot?: string } = {},
  ) {
    this.ledger = ledger;
    this.artifacts = artifacts;
    this.diarizer = options.diarizer ?? new SherpaOnnxSpeakerDiarizer();
    this.ffmpeg = options.ffmpeg ?? "ffmpeg";
    this.temporaryRoot = options.temporaryRoot ?? tmpdir();
  }

  async analyze(requestValue: unknown): Promise<VerifiedSpeakerOverlap> {
    const start = performance.now();
    const started = await this.ledger.transact(
      { producer: { kind: "speaker_host", id: "bounded-speaker-overlap-host" } },
      ({ state }) => {
        const authorization = authorizeSpeakerOverlap(state, requestValue);
        return {
          pending: [{
            type: "media.speakers_started",
            data: {
              request: authorization.request,
              scope: authorization.scope,
              sourceContentId: authorization.artifact.content.contentId,
              executionId: authorization.executionId,
              launchClaimId: authorization.launchClaimId,
              requestFingerprint: authorization.requestFingerprint,
              limits: structuredClone(authorization.grant.speakerScope.limits),
            },
          }] satisfies PendingRuntimeEvent[],
          result: authorization,
        };
      },
    );
    const { request, grant, scope, artifact: source, track, executionId, launchClaimId } = started.result;
    const maximumWallMs = Math.min(grant.speakerScope.limits.maxWallMs, this.ledger.state().tasks[request.taskId].budget.wallMs);
    const deadlineAtMs = start + maximumWallMs;
    let temporaryDirectory: string | null = null;
    try {
      temporaryDirectory = await mkdtemp(join(this.temporaryRoot, "studio-speakers-"));
      const registeredSourcePath = await this.artifacts.resolveVerified(source).catch((cause) => {
        throw new SpeakerHostFailure("source_unavailable", "Registered speaker/overlap source failed content verification", { cause });
      });
      const sourcePath = join(temporaryDirectory, "authorized-source.media");
      await copyFile(registeredSourcePath, sourcePath);
      await chmod(sourcePath, 0o400);
      const sealedSource = await identifyFile(sourcePath);
      if (sealedSource.contentId !== source.content.contentId || sealedSource.bytes !== source.content.bytes) {
        throw new SpeakerHostFailure("source_unavailable", "Speaker/overlap source changed while its private decode snapshot was sealed");
      }
      const pcmPath = join(temporaryDirectory, "authorized-range.pcm");
      const remainingDecodeMs = Math.max(1, Math.floor(deadlineAtMs - performance.now()));
      await execute(this.ffmpeg, [
        "-nostdin", "-hide_banner", "-loglevel", "error",
        "-ss", (scope.startMs / 1_000).toFixed(3),
        "-t", ((scope.endMs - scope.startMs) / 1_000).toFixed(3),
        "-i", sourcePath,
        "-map", `0:${track.index}`,
        "-vn", "-ac", "1", "-ar", "16000", "-f", "s16le", pcmPath,
      ], remainingDecodeMs).catch((cause) => {
        throw new SpeakerHostFailure("decoder_failed", "Speaker/overlap audio normalization failed", { cause });
      });
      const pcmStat = await stat(pcmPath);
      if (!pcmStat.isFile() || pcmStat.size <= 0 || pcmStat.size > grant.speakerScope.limits.maxNormalizedAudioBytes || pcmStat.size % 2 !== 0) {
        throw new SpeakerHostFailure("input_oversized", "Normalized speaker/overlap audio exceeds its byte envelope");
      }
      const sampleCount = pcmStat.size / 2;
      if (sampleCount > grant.speakerScope.limits.maxDecodedSamples) throw new SpeakerHostFailure("input_oversized", "Normalized speaker/overlap audio exceeds its sample envelope");
      const pcm16 = await readFile(pcmPath);
      const normalizedAudio = await identifyFile(pcmPath);
      const recognized = await this.diarizer.diarize({ pcm16, sampleRateHz: 16_000 }, deadlineAtMs);
      validateSpeakerOverlapProducerLineage(recognized.lineage, "Speaker diarizer result", "producer");
      const closed = closeSegments(request.operationId, recognized.segments, { startMs: scope.startMs, endMs: scope.endMs }, grant.speakerScope.limits);
      const claims = nonClaims();
      const observations = validateSpeakerOverlapObservations({
        schema: "studio.speaker-overlap-observations.v1",
        operationId: request.operationId,
        runId: this.ledger.runId,
        source: {
          artifactId: source.id,
          contentId: source.content.contentId,
          audioTrackId: track.id,
          grantedRange: { startMs: scope.startMs, endMs: scope.endMs },
        },
        producer: recognized.lineage,
        limits: structuredClone(grant.speakerScope.limits),
        labelScope: { kind: "run_artifact_operation_local", runId: this.ledger.runId, sourceArtifactId: source.id, operationId: request.operationId },
        state: closed.state,
        reason: closed.reason,
        turns: closed.turns,
        accounting: closed.accounting,
        nonClaims: claims,
      });
      const storedObservations = await this.artifacts.storeJson(observations);
      if (storedObservations.content.bytes > grant.speakerScope.limits.maxObservationBytes) throw new SpeakerHostFailure("artifact_oversized", "Speaker/overlap observations exceed their byte envelope");
      const preparedObservations = {
        artifactId: speakerObservationsArtifactId(this.ledger.runId, request.operationId, storedObservations.content.contentId),
        ...storedObservations,
      };
      const measuredBeforeReceiptMs = Math.ceil(performance.now() - start);
      if (measuredBeforeReceiptMs > maximumWallMs) throw new SpeakerDiarizerFailure("diarizer_timeout", "Speaker diarization exceeded its wall-time grant");
      const receiptWithoutId: Omit<SpeakerOverlapReceipt, "receiptId"> = {
        schema: "studio.speaker-overlap-producer.receipt.v1",
        operationId: request.operationId,
        capability: "media.speakers.analyze",
        authorization: { grantId: grant.id, taskId: request.taskId, agentId: request.agentId, executionId, launchClaimId },
        input: {
          ...observations.source,
          sourceBytes: source.content.bytes,
          normalizedAudio: { content: normalizedAudio, sampleRateHz: 16_000, channels: 1, sampleFormat: "s16le", sampleCount },
        },
        producer: recognized.lineage,
        limits: structuredClone(grant.speakerScope.limits),
        execution: {
          wallMs: maximumWallMs,
          measuredBeforeReceiptMs,
          wallAccounting: "full_grant_charged_before_atomic_completion",
          rawTurnCount: closed.observedRawTurnCount,
          accountingCellCount: observations.accounting.length,
          localSpeakerClusterCount: closed.observedClusterCount,
          inputBytes: normalizedAudio.bytes,
        },
        output: {
          artifactId: preparedObservations.artifactId,
          contentId: preparedObservations.content.contentId,
          bytes: preparedObservations.content.bytes,
          state: observations.state,
        },
        nonClaims: claims,
      };
      const receipt = validateSpeakerOverlapReceipt({ ...receiptWithoutId, receiptId: speakerOverlapReceiptId(receiptWithoutId) });
      const storedReceipt = await this.artifacts.storeJson(receipt);
      if (storedReceipt.content.bytes > grant.speakerScope.limits.maxReceiptBytes) throw new SpeakerHostFailure("artifact_oversized", "Speaker/overlap receipt exceeds its byte envelope");
      const preparedReceipt = {
        artifactId: speakerReceiptArtifactId(this.ledger.runId, request.operationId, storedReceipt.content.contentId),
        ...storedReceipt,
      };
      const observationsArtifact = buildSpeakerObservationsArtifact({
        runId: this.ledger.runId,
        sourceArtifactId: source.id,
        taskId: request.taskId,
        agentId: request.agentId,
        receipt,
        receiptContentId: preparedReceipt.content.contentId,
        prepared: preparedObservations,
      });
      const receiptArtifact = buildSpeakerReceiptArtifact({
        runId: this.ledger.runId,
        sourceArtifactId: source.id,
        taskId: request.taskId,
        agentId: request.agentId,
        receipt,
        prepared: preparedReceipt,
      });
      await Promise.all([observationsArtifact, receiptArtifact].map((artifact) => this.artifacts.resolveVerified(artifact)));
      await this.ledger.transact(
        { producer: { kind: "speaker_host", id: "bounded-speaker-overlap-host" }, causationId: request.operationId },
        () => ({
          pending: [
            { type: "artifact.recorded", data: { artifact: observationsArtifact } },
            { type: "artifact.recorded", data: { artifact: receiptArtifact } },
            {
              type: "media.speakers_completed",
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
      if (this.ledger.state().speakerOverlapOperations[request.operationId]?.status === "started") {
        await this.ledger.transact(
          { producer: { kind: "speaker_host", id: "bounded-speaker-overlap-host" }, causationId: request.operationId },
          () => ({ pending: [{ type: "media.speakers_failed", data: { operationId: request.operationId, reason: failureReason(error) } }] satisfies PendingRuntimeEvent[], result: undefined }),
        );
      }
      throw error;
    } finally {
      if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true });
    }
  }
}
