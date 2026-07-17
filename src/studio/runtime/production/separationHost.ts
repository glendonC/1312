import { execFile } from "node:child_process";
import { chmod, copyFile, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";

import { ContentAddressedArtifactStore, identifyFile } from "./artifactStore.ts";
import {
  buildConditionalSeparationReceiptArtifact,
  buildRawStemComparisonArtifact,
  buildRawStemComparisonReceiptArtifact,
  buildSeparationStemArtifact,
  conditionalSeparationReceiptArtifactId,
  rawStemComparisonArtifactId,
  rawStemComparisonReceiptArtifactId,
  separationStemArtifactId,
} from "./artifactStore/separationArtifacts.ts";
import { authorizeConditionalSeparation } from "./authorization.ts";
import type { RuntimeLedger } from "./journal.ts";
import type {
  ConditionalSeparationFailureReason,
  ConditionalSeparationReceipt,
  RawStemComparison,
  RawStemComparisonReceipt,
  RuntimeArtifact,
  SeparationRecognizerResult,
  SeparationStemOutput,
} from "./model.ts";
import type { PendingRuntimeEvent } from "./protocol.ts";
import type { CurrentRunRecognizerResult, CurrentRunSpeechRecognizer } from "./semantic/currentRunSpeechRecognizer.ts";
import { UnavailableCurrentRunSpeechRecognizer } from "./semantic/currentRunSpeechRecognizer.ts";
import type { SourceSeparator } from "./separation/separator.ts";
import { SourceSeparatorFailure } from "./separation/separator.ts";
import { SpeechbrainSepformerSeparator } from "./separation/speechbrainSepformerSeparator.ts";
import type { SpeakerDiarizer } from "./speaker/diarizer.ts";
import { auditSpeakerOverlap } from "./speakerAudit.ts";
import {
  conditionalSeparationReceiptId,
  rawStemComparisonReceiptId,
  validateConditionalSeparationReceipt,
  validateRawStemComparison,
  validateRawStemComparisonReceipt,
} from "./validation/separation.ts";

export interface VerifiedConditionalSeparation {
  stems: [RuntimeArtifact, RuntimeArtifact];
  receipt: ConditionalSeparationReceipt;
  receiptArtifact: RuntimeArtifact;
  comparison: RawStemComparison;
  comparisonArtifact: RuntimeArtifact;
  comparisonReceipt: RawStemComparisonReceipt;
  comparisonReceiptArtifact: RuntimeArtifact;
}

class SeparationHostFailure extends Error {
  readonly reason: ConditionalSeparationFailureReason;
  constructor(reason: ConditionalSeparationFailureReason, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "SeparationHostFailure";
    this.reason = reason;
  }
}

function failureReason(error: unknown): ConditionalSeparationFailureReason {
  if (error instanceof SourceSeparatorFailure || error instanceof SeparationHostFailure) return error.reason;
  return "separator_failed";
}

function execute(file: string, args: readonly string[], timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => execFile(file, [...args], { timeout: timeoutMs, maxBuffer: 1024 * 1024, windowsHide: true }, (error) => error ? reject(error) : resolve()));
}

function nonClaims(): ConditionalSeparationReceipt["nonClaims"] {
  return {
    speakerIdentity: "not_assessed",
    sourceIdentity: "anonymous_estimate_only",
    separationQuality: "not_assessed",
    semanticPreference: "not_granted",
    captionAuthority: "not_granted",
    publication: "not_granted",
  };
}

function rebase(result: CurrentRunRecognizerResult, offsetMs: number, range: { startMs: number; endMs: number }): SeparationRecognizerResult {
  return {
    availability: result.availability,
    reason: result.reason,
    segments: result.segments.map((segment) => ({
      ...segment,
      startMs: Math.max(range.startMs, Math.min(range.endMs, segment.startMs + offsetMs)),
      endMs: Math.max(range.startMs, Math.min(range.endMs, segment.endMs + offsetMs)),
    })).filter((segment) => segment.endMs > segment.startMs),
  };
}

function normalizedText(result: SeparationRecognizerResult): string {
  return result.segments.filter((segment) => segment.state === "available" && segment.text !== null)
    .map((segment) => segment.text!.normalize("NFC").trim().replace(/\s+/g, " "))
    .filter(Boolean).join(" ");
}

async function recognize(
  recognizer: CurrentRunSpeechRecognizer,
  input: Parameters<CurrentRunSpeechRecognizer["recognize"]>[0],
  deadlineAtMs: number,
): Promise<CurrentRunRecognizerResult> {
  const controller = new AbortController();
  const timeoutMs = Math.max(1, Math.floor(deadlineAtMs - performance.now()));
  const timeout = setTimeout(() => controller.abort(new Error("Raw/stem recognizer deadline expired")), timeoutMs);
  try {
    return await recognizer.recognize(input, controller.signal).catch(() => ({ availability: "unavailable", reason: "recognizer_unavailable", segments: [] }));
  } finally {
    clearTimeout(timeout);
  }
}

export class BoundedConditionalSeparationHost {
  private readonly ledger: RuntimeLedger;
  private readonly artifacts: ContentAddressedArtifactStore;
  private readonly separator: SourceSeparator;
  private readonly recognizer: CurrentRunSpeechRecognizer;
  private readonly ffmpeg: string;
  private readonly temporaryRoot: string;

  constructor(
    ledger: RuntimeLedger,
    artifacts: ContentAddressedArtifactStore,
    options: { separator?: SourceSeparator; recognizer?: CurrentRunSpeechRecognizer; speakerDiarizer?: SpeakerDiarizer; ffmpeg?: string; temporaryRoot?: string } = {},
  ) {
    this.ledger = ledger;
    this.artifacts = artifacts;
    this.separator = options.separator ?? new SpeechbrainSepformerSeparator();
    this.recognizer = options.recognizer ?? new UnavailableCurrentRunSpeechRecognizer();
    this.speakerDiarizer = options.speakerDiarizer;
    this.ffmpeg = options.ffmpeg ?? "ffmpeg";
    this.temporaryRoot = options.temporaryRoot ?? tmpdir();
  }

  private readonly speakerDiarizer: SpeakerDiarizer | undefined;

  async separate(requestValue: unknown): Promise<VerifiedConditionalSeparation> {
    const startedAt = performance.now();
    const started = await this.ledger.transact(
      { producer: { kind: "separation_host", id: "bounded-conditional-separation-host" } },
      ({ state }) => {
        const authorization = authorizeConditionalSeparation(state, requestValue);
        return {
          pending: [{ type: "media.conditional_separation_started", data: {
            request: authorization.request,
            scope: authorization.scope,
            sourceContentId: authorization.artifact.content.contentId,
            executionId: authorization.executionId,
            launchClaimId: authorization.launchClaimId,
            requestFingerprint: authorization.requestFingerprint,
            trigger: structuredClone(authorization.grant.separationScope.trigger),
            limits: structuredClone(authorization.grant.separationScope.limits),
          } }] satisfies PendingRuntimeEvent[],
          result: authorization,
        };
      },
    );
    const { request, grant, scope, artifact: source, track, executionId, launchClaimId } = started.result;
    const maximumWallMs = Math.min(grant.separationScope.limits.maxWallMs, this.ledger.state().tasks[request.taskId].budget.wallMs);
    const deadlineAtMs = startedAt + maximumWallMs;
    let temporaryDirectory: string | null = null;
    try {
      const auditedTrigger = await auditSpeakerOverlap(this.ledger.state(), this.artifacts, grant.separationScope.trigger.operationId, { diarizer: this.speakerDiarizer });
      const triggerCell = auditedTrigger.observations.accounting.find((cell) => cell.observationId === grant.separationScope.trigger.observationId);
      if (
        !triggerCell || triggerCell.state !== "conflicting" || triggerCell.kind !== "overlap" || triggerCell.uncertainty.reason !== "overlap_hypothesis_requires_speech_restudy" ||
        triggerCell.startMs !== scope.startMs || triggerCell.endMs !== scope.endMs || auditedTrigger.observationsArtifact.id !== grant.separationScope.trigger.observationsArtifactId ||
        auditedTrigger.receiptArtifact.id !== grant.separationScope.trigger.receiptArtifactId
      ) throw new SeparationHostFailure("trigger_invalid", "Conditional separation trigger no longer cold-audits to one exact U6.1 overlap cell");
      temporaryDirectory = await mkdtemp(join(this.temporaryRoot, "studio-separation-"));
      const registeredSourcePath = await this.artifacts.resolveVerified(source).catch((cause) => { throw new SeparationHostFailure("source_unavailable", "Raw source failed content verification", { cause }); });
      const sealedSourcePath = join(temporaryDirectory, "authorized-source.media");
      await copyFile(registeredSourcePath, sealedSourcePath);
      await chmod(sealedSourcePath, 0o400);
      const sealed = await identifyFile(sealedSourcePath);
      if (sealed.contentId !== source.content.contentId || sealed.bytes !== source.content.bytes) throw new SeparationHostFailure("source_unavailable", "Raw source changed while its private snapshot was sealed");
      const normalizedPath = join(temporaryDirectory, "authorized-range.wav");
      await execute(this.ffmpeg, [
        "-nostdin", "-hide_banner", "-loglevel", "error", "-ss", (scope.startMs / 1_000).toFixed(3),
        "-t", ((scope.endMs - scope.startMs) / 1_000).toFixed(3), "-i", sealedSourcePath, "-map", `0:${track.index}`,
        "-vn", "-ac", "1", "-ar", "8000", "-c:a", "pcm_s16le", normalizedPath,
      ], Math.max(1, Math.floor(deadlineAtMs - performance.now()))).catch((cause) => { throw new SeparationHostFailure("decoder_failed", "Exact-range audio normalization failed", { cause }); });
      const normalized = await identifyFile(normalizedPath);
      const expectedSampleCount = Math.round((scope.endMs - scope.startMs) * 8);
      if (normalized.bytes <= 44 || normalized.bytes > grant.separationScope.limits.maxNormalizedAudioBytes || expectedSampleCount > grant.separationScope.limits.maxDecodedSamples) throw new SeparationHostFailure("input_oversized", "Normalized exact range exceeds U7 limits");
      const separated = await this.separator.separate({ wavPath: normalizedPath, outputDirectory: temporaryDirectory, expectedSampleCount }, deadlineAtMs);
      if (
        separated.lineage.adapter.id !== grant.separationScope.producerPolicy.methodId ||
        separated.lineage.model.revision !== grant.separationScope.producerPolicy.modelRevision ||
        JSON.stringify(separated.lineage.model.files.map((file) => file.content.contentId)) !== JSON.stringify(grant.separationScope.producerPolicy.modelContentIds) ||
        separated.lineage.configuration.contentId !== grant.separationScope.producerPolicy.configurationContentId
      ) throw new SeparationHostFailure("runtime_drift", "Separator lineage changed from the scheduler policy");
      const durationMs = scope.endMs - scope.startMs;
      const preparedStems = [] as Array<{ output: SeparationStemOutput; prepared: { artifactId: string; content: Awaited<ReturnType<typeof identifyFile>>; storageKey: string }; path: string }>;
      for (const stem of separated.stems) {
        const measured = await identifyFile(stem.path);
        const details = await stat(stem.path);
        if (!details.isFile() || measured.bytes <= 44 || measured.bytes > grant.separationScope.limits.maxStemBytes || stem.sampleCount !== expectedSampleCount) throw new SeparationHostFailure("artifact_oversized", `Separated ${stem.role} is invalid or over limit`);
        const stored = await this.artifacts.prepareDerived(stem.path, { runId: this.ledger.runId, kind: "studio.separated-audio-stem.v1", operationId: request.operationId, publication: "private", durationMs, tracks: [{ id: `stem:${stem.role}`, index: 0, kind: "audio", codec: "pcm_s16le", durationMs }] });
        const artifactId = separationStemArtifactId(this.ledger.runId, request.operationId, stem.role, stored.content.contentId);
        preparedStems.push({ path: stem.path, prepared: { artifactId, content: stored.content, storageKey: stored.storageKey }, output: { role: stem.role, artifactId, contentId: stored.content.contentId, bytes: stored.content.bytes, trackId: `stem:${stem.role}`, durationMs, sampleCount: stem.sampleCount } });
      }
      const measuredBeforeReceiptMs = Math.ceil(performance.now() - startedAt);
      if (measuredBeforeReceiptMs > maximumWallMs) throw new SourceSeparatorFailure("separator_timeout", "Conditional separation exceeded its wall grant");
      const receiptWithoutId: Omit<ConditionalSeparationReceipt, "receiptId"> = {
        schema: "studio.conditional-separation.receipt.v1",
        operationId: request.operationId,
        capability: "media.audio.separate",
        authorization: { grantId: grant.id, taskId: request.taskId, agentId: request.agentId, executionId, launchClaimId },
        source: { ...grant.separationScope.source, sourceBytes: source.content.bytes, normalizedAudio: { content: normalized, sampleRateHz: 8_000, channels: 1, sampleFormat: "pcm_s16le_wav", sampleCount: expectedSampleCount } },
        trigger: structuredClone(grant.separationScope.trigger),
        producer: separated.lineage,
        limits: structuredClone(grant.separationScope.limits),
        execution: { wallMs: maximumWallMs, measuredBeforeReceiptMs, wallAccounting: "full_grant_charged_before_atomic_completion" },
        outputs: [preparedStems[0].output, preparedStems[1].output],
        nonClaims: nonClaims(),
      };
      const receipt = validateConditionalSeparationReceipt({ ...receiptWithoutId, receiptId: conditionalSeparationReceiptId(receiptWithoutId) });
      const storedReceipt = await this.artifacts.storeJson(receipt);
      if (storedReceipt.content.bytes > grant.separationScope.limits.maxReceiptBytes) throw new SeparationHostFailure("artifact_oversized", "Separation receipt exceeds its byte limit");
      const preparedReceipt = { artifactId: conditionalSeparationReceiptArtifactId(this.ledger.runId, request.operationId, storedReceipt.content.contentId), ...storedReceipt };
      const stemArtifacts = preparedStems.map(({ output, prepared }) => buildSeparationStemArtifact({ runId: this.ledger.runId, taskId: request.taskId, agentId: request.agentId, receipt, receiptContentId: preparedReceipt.content.contentId, output, prepared })) as [RuntimeArtifact, RuntimeArtifact];
      const receiptArtifact = buildConditionalSeparationReceiptArtifact({ runId: this.ledger.runId, taskId: request.taskId, agentId: request.agentId, receipt, prepared: preparedReceipt });
      const requestedSourceLanguage = structuredClone(this.ledger.state().tasks[request.taskId].jobContext.requestedSourceLanguagePolicy);
      const recognizerDescriptor = await this.recognizer.describe({ requestedSourceLanguage }).catch((cause) => {
        throw new SeparationHostFailure("recognizer_failed", "Raw/stem recognizer lineage is unavailable", { cause });
      });
      const rawResult = rebase(await recognize(this.recognizer, { sourcePath: sealedSourcePath, trackIndex: track.index, range: { startMs: scope.startMs, endMs: scope.endMs }, requestedSourceLanguage }, deadlineAtMs), 0, grant.separationScope.source.range);
      const stemResults = await Promise.all(preparedStems.map(async (stem) => rebase(await recognize(this.recognizer, { sourcePath: stem.path, trackIndex: 0, range: { startMs: 0, endMs: durationMs }, requestedSourceLanguage }, deadlineAtMs), scope.startMs, grant.separationScope.source.range)));
      const allResults = [rawResult, ...stemResults];
      const comparableResults = allResults.every((result) => result.availability === "available");
      const texts = allResults.map(normalizedText);
      const agrees = comparableResults && texts.every((text) => text === texts[0]);
      if (performance.now() > deadlineAtMs) throw new SeparationHostFailure("separator_timeout", "Raw/stem comparison exceeded the conditional-separation wall grant");
      const comparison = validateRawStemComparison({
        schema: "studio.raw-stem-comparison.v1", operationId: request.operationId, runId: this.ledger.runId,
        source: structuredClone(grant.separationScope.source), separationReceiptId: receipt.receiptId,
        recognizer: recognizerDescriptor, requestedSourceLanguage,
        inputs: {
          raw: { artifactId: source.id, contentId: source.content.contentId, result: rawResult },
          stems: preparedStems.map((stem, index) => ({ role: stem.output.role, artifactId: stem.output.artifactId, contentId: stem.output.contentId, result: stemResults[index] })),
        },
        outcome: comparableResults ? agrees ? "agreement" : "disagreement" : "abstention",
        reason: comparableResults ? agrees ? "normalized_text_agrees" : "normalized_text_disagrees" : "recognizer_unavailable_or_incomplete",
        deterministicGate: { lineage: "verified", comparable: true, sameRecognizer: true, exactRange: true, semanticPreference: null, semanticAuthority: "not_granted", captionAuthority: "not_granted" },
      });
      const storedComparison = await this.artifacts.storeJson(comparison);
      if (storedComparison.content.bytes > grant.separationScope.limits.maxComparisonBytes) throw new SeparationHostFailure("artifact_oversized", "Raw/stem comparison exceeds its byte limit");
      const preparedComparison = { artifactId: rawStemComparisonArtifactId(this.ledger.runId, request.operationId, storedComparison.content.contentId), ...storedComparison };
      const comparisonReceiptWithoutId: Omit<RawStemComparisonReceipt, "receiptId"> = {
        schema: "studio.raw-stem-comparison.receipt.v1", operationId: request.operationId, separationReceiptId: receipt.receiptId,
        comparison: { artifactId: preparedComparison.artifactId, contentId: preparedComparison.content.contentId, bytes: preparedComparison.content.bytes, outcome: comparison.outcome },
        recognizer: recognizerDescriptor,
        inputArtifactIds: [source.id, preparedStems[0].output.artifactId, preparedStems[1].output.artifactId],
        nonClaims: nonClaims(),
      };
      const comparisonReceipt = validateRawStemComparisonReceipt({ ...comparisonReceiptWithoutId, receiptId: rawStemComparisonReceiptId(comparisonReceiptWithoutId) });
      const storedComparisonReceipt = await this.artifacts.storeJson(comparisonReceipt);
      if (storedComparisonReceipt.content.bytes > grant.separationScope.limits.maxComparisonReceiptBytes) throw new SeparationHostFailure("artifact_oversized", "Raw/stem comparison receipt exceeds its byte limit");
      const preparedComparisonReceipt = { artifactId: rawStemComparisonReceiptArtifactId(this.ledger.runId, request.operationId, storedComparisonReceipt.content.contentId), ...storedComparisonReceipt };
      const comparisonArtifact = buildRawStemComparisonArtifact({ runId: this.ledger.runId, taskId: request.taskId, agentId: request.agentId, separationReceiptArtifactId: receiptArtifact.id, comparison, receipt: comparisonReceipt, receiptContentId: preparedComparisonReceipt.content.contentId, prepared: preparedComparison });
      const comparisonReceiptArtifact = buildRawStemComparisonReceiptArtifact({ runId: this.ledger.runId, taskId: request.taskId, agentId: request.agentId, separationReceiptArtifactId: receiptArtifact.id, receipt: comparisonReceipt, prepared: preparedComparisonReceipt });
      await Promise.all([...stemArtifacts, receiptArtifact, comparisonArtifact, comparisonReceiptArtifact].map((artifact) => this.artifacts.resolveVerified(artifact)));
      if (performance.now() > deadlineAtMs) throw new SeparationHostFailure("separator_timeout", "Conditional separation exceeded its wall grant before atomic completion");
      await this.ledger.transact(
        { producer: { kind: "separation_host", id: "bounded-conditional-separation-host" }, causationId: request.operationId },
        () => ({ pending: [
          ...stemArtifacts.map((artifact) => ({ type: "artifact.recorded" as const, data: { artifact } })),
          { type: "artifact.recorded", data: { artifact: receiptArtifact } },
          { type: "artifact.recorded", data: { artifact: comparisonArtifact } },
          { type: "artifact.recorded", data: { artifact: comparisonReceiptArtifact } },
          { type: "media.conditional_separation_completed", data: {
            operationId: request.operationId, stemArtifactIds: [stemArtifacts[0].id, stemArtifacts[1].id], receiptArtifactId: receiptArtifact.id,
            receiptContentId: receiptArtifact.content.contentId, receipt, comparisonArtifactId: comparisonArtifact.id,
            comparisonReceiptArtifactId: comparisonReceiptArtifact.id, comparisonReceiptContentId: comparisonReceiptArtifact.content.contentId, comparisonReceipt,
          } },
        ] satisfies PendingRuntimeEvent[], result: undefined }),
      );
      return { stems: stemArtifacts, receipt, receiptArtifact, comparison, comparisonArtifact, comparisonReceipt, comparisonReceiptArtifact };
    } catch (error) {
      if (this.ledger.state().conditionalSeparationOperations[request.operationId]?.status === "started") {
        await this.ledger.transact(
          { producer: { kind: "separation_host", id: "bounded-conditional-separation-host" }, causationId: request.operationId },
          () => ({ pending: [{ type: "media.conditional_separation_failed", data: { operationId: request.operationId, reason: failureReason(error) } }] satisfies PendingRuntimeEvent[], result: undefined }),
        );
      }
      throw error;
    } finally {
      if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true });
    }
  }
}
