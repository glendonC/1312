import {
  canonicalJsonContentId,
  ContentAddressedArtifactStore,
  createLearningPrepArtifactId,
} from "../artifactStore.ts";
import { canonicalJson } from "../artifactStore/contentIdentity.ts";
import { canonicalSha256 } from "../canonicalIdentity.ts";
import { reopenCaptionProductionResults } from "../captions/captionProductionAudit.ts";
import { materializeCaptionProductionLines } from "../captions/captionArtifactCompaction.ts";
import { RuntimeJournalConflict, type RuntimeLedger } from "../journal.ts";
import { languageExplanationCaptionSnapshot } from "../languageExplanations/languageExplanationHost.ts";
import type {
  GeneratedLearningPrepOutput,
  LearningPrepArtifact,
  LearningPrepCandidate,
  LearningPrepContextLine,
  LearningPrepInputAuthority,
  LearningPrepLensOutcome,
  LearningPrepReceipt,
  LearningPrepRequest,
  LearningPrepSegmentation,
} from "../model.ts";
import {
  LEARNING_PREP_LIMITS,
  LEARNING_PREP_NON_CLAIMS,
} from "../model.ts";
import type { PendingRuntimeEvent } from "../protocol.ts";
import {
  assertLearningPrepRequest,
  deriveLearningPrepResult,
  validateGeneratedLearningPrepOutput,
  validateLearningPrepArtifact,
  validateLearningPrepExecutorDescriptor,
  validateLearningPrepReceipt,
} from "../validation/learningPrep.ts";
import type { LearningPrepExecutor } from "./executor.ts";
import {
  createLearningPrepGrantId,
  createLearningPrepJobId,
  createLearningPrepRequestFingerprint,
} from "./identity.ts";

export type LearningPrepHostErrorCode =
  | "verified_current_caption_required"
  | "unrevoked_caption_authority_required"
  | "learning_prep_executor_unavailable"
  | "learning_prep_limits_exceeded"
  | "illegal_learning_prep_transition"
  | "stored_learning_prep_lineage_invalid"
  | "learning_prep_executor_failed";

export class LearningPrepHostError extends Error {
  readonly code: LearningPrepHostErrorCode;

  constructor(code: LearningPrepHostErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "LearningPrepHostError";
    this.code = code;
  }
}

export interface LearningPrepHostResult {
  prep: LearningPrepArtifact;
  receipt: LearningPrepReceipt;
  artifactId: string;
  contentId: string;
  receiptArtifactId: string;
  receiptContentId: string;
}

export function learningPrepLineSnapshots(
  lines: ReturnType<typeof materializeCaptionProductionLines>,
): LearningPrepContextLine[] {
  return lines.map(languageExplanationCaptionSnapshot);
}

function storedSegmentation(
  generated: GeneratedLearningPrepOutput["segmentation"],
  lines: readonly LearningPrepContextLine[],
): LearningPrepSegmentation {
  if (generated.mode === "watch_through") return structuredClone(generated);
  const lineById = new Map(lines.map((line) => [line.lineId, line]));
  return {
    mode: "beats",
    beats: generated.beats.map((beat, index) => ({
      beatId: `beat:${index}`,
      startMs: lineById.get(beat.lineIds[0])!.startMs,
      endMs: lineById.get(beat.lineIds[beat.lineIds.length - 1])!.endMs,
      lineIds: [...beat.lineIds],
    })),
  };
}

function storedCandidates(
  generated: GeneratedLearningPrepOutput["candidates"],
  lines: readonly LearningPrepContextLine[],
): LearningPrepCandidate[] {
  const lineById = new Map(lines.map((line) => [line.lineId, line]));
  return generated.map((candidate) => {
    const line = lineById.get(candidate.lineId)!;
    const anchor = { lineId: line.lineId, startMs: line.startMs, endMs: line.endMs };
    return candidate.availability === "available"
      ? {
          lens: candidate.lens,
          anchor,
          availability: "available",
          reasonCode: null,
          content: structuredClone(candidate.content),
          executionAuthority: "host_receipted",
          semanticReview: "not_reviewed",
          grounding: "caption_context_inference",
          externalCitationIds: [],
        } as LearningPrepCandidate
      : {
          lens: candidate.lens,
          anchor,
          availability: candidate.availability,
          reasonCode: candidate.reasonCode,
          content: null,
          executionAuthority: "host_receipted",
          semanticReview: "not_reviewed",
          grounding: "none",
          externalCitationIds: [],
        };
  });
}

function lensOutcomes(
  armedLenses: readonly LearningPrepArtifact["grant"]["fineTune"]["armedLenses"][number][],
  candidates: readonly LearningPrepCandidate[],
  abstentions: GeneratedLearningPrepOutput["lensAbstentions"],
): LearningPrepLensOutcome[] {
  const abstentionByLens = new Map(abstentions.map((entry) => [entry.lens, entry.reasonCode]));
  return armedLenses.map((lens) => {
    const candidateCount = candidates.filter((candidate) => candidate.lens === lens).length;
    if (candidateCount > 0) return { lens, state: "surfaced", reasonCode: null, candidateCount };
    return { lens, state: "abstained", reasonCode: abstentionByLens.get(lens)!, candidateCount: 0 };
  });
}

/** Private post-study Apply prep host. It accepts identities and a typed fine-tune, never caller-authored beats, candidates, or prose. */
export class LearningPrepHost {
  private readonly ledger: RuntimeLedger;
  private readonly artifacts: ContentAddressedArtifactStore;
  private readonly executor: LearningPrepExecutor;
  private readonly rightsScope: "local_processing" | "redistribution";

  constructor(
    ledger: RuntimeLedger,
    artifacts: ContentAddressedArtifactStore,
    executor: LearningPrepExecutor,
    rightsScope: "local_processing" | "redistribution",
  ) {
    this.ledger = ledger;
    this.artifacts = artifacts;
    this.executor = executor;
    this.rightsScope = rightsScope;
  }

  async produce(requestValue: unknown): Promise<LearningPrepHostResult> {
    const request: LearningPrepRequest = assertLearningPrepRequest(requestValue);
    const executor = validateLearningPrepExecutorDescriptor(
      this.executor.describe(),
      "Learning-prep host",
      "executor",
    );
    if (executor.classification === "unavailable") {
      throw new LearningPrepHostError(
        "learning_prep_executor_unavailable",
        "Learning prep generation is unavailable until a model is explicitly configured",
      );
    }
    const state = this.ledger.state();
    const events = await this.ledger.events();
    let captions;
    try {
      captions = await reopenCaptionProductionResults(state, events, this.artifacts);
    } catch (error) {
      throw new LearningPrepHostError(
        "stored_learning_prep_lineage_invalid",
        "The production caption lineage failed closed recursive verification",
        { cause: error },
      );
    }
    const caption = captions.find((candidate) =>
      candidate.verification.jobId === request.caption.jobId &&
      candidate.verification.captionArtifactId === request.caption.artifactId &&
      candidate.verification.captionContentId === request.caption.contentId &&
      candidate.verification.receiptArtifactId === request.caption.receiptArtifactId &&
      candidate.verification.receiptId === request.caption.receiptId &&
      candidate.verification.receiptContentId === request.caption.receiptContentId
    );
    if (!caption) {
      throw new LearningPrepHostError(
        "verified_current_caption_required",
        "Learning prep requires one exact verified production caption result",
      );
    }
    if (caption.verification.authorityState !== "unrevoked") {
      throw new LearningPrepHostError(
        "unrevoked_caption_authority_required",
        "New learning prep cannot be produced after caption authority is revoked",
      );
    }
    const sourceArtifact = state.artifacts[caption.verification.source.artifactId];
    const recordedRightsScope = sourceArtifact?.origin.kind === "ingest"
      ? sourceArtifact.publication === "public" ? "redistribution" : "local_processing"
      : null;
    if (recordedRightsScope === null || recordedRightsScope !== this.rightsScope) {
      throw new LearningPrepHostError(
        "stored_learning_prep_lineage_invalid",
        "The registered source rights do not match the runtime host authority",
      );
    }
    const captionLines = materializeCaptionProductionLines(caption.artifact);
    if (captionLines.length === 0 || captionLines.length > LEARNING_PREP_LIMITS.maxLines) {
      throw new LearningPrepHostError(
        "learning_prep_limits_exceeded",
        "The verified caption result does not fit the fixed learning-prep line ceiling",
      );
    }
    const lines = learningPrepLineSnapshots(captionLines);
    const input: LearningPrepInputAuthority = {
      source: {
        artifactId: caption.verification.source.artifactId,
        contentId: caption.verification.source.contentId,
        analysisRequestId: caption.verification.source.analysisRequestId,
        rightsScope: this.rightsScope,
      },
      study: {
        studyId: caption.verification.study.studyId,
        artifactId: caption.verification.study.artifactId,
        contentId: caption.verification.study.contentId,
      },
      readiness: structuredClone(caption.verification.readiness),
      approval: structuredClone(caption.verification.approval),
      caption: structuredClone(request.caption),
      lines,
    };
    const requestFingerprint = createLearningPrepRequestFingerprint({
      runId: this.ledger.runId,
      request,
      authority: input,
      executor,
      rightsScope: this.rightsScope,
    });
    const priorAttempts = Object.values(state.learningPreps)
      .filter((record) => record.requestFingerprint === requestFingerprint);
    if (priorAttempts.some((record) => record.status !== "failed")) {
      throw new LearningPrepHostError(
        "illegal_learning_prep_transition",
        "This exact learning-prep request is already active or completed",
      );
    }
    if (priorAttempts.length >= LEARNING_PREP_LIMITS.maxAttemptsPerRequest) {
      throw new LearningPrepHostError(
        "illegal_learning_prep_transition",
        "This learning-prep request exhausted its bounded retry attempts",
      );
    }
    const attempt = priorAttempts.length;
    const grantId = createLearningPrepGrantId({
      runId: this.ledger.runId,
      requestFingerprint,
      caption: request.caption,
      attempt,
    });
    const jobId = createLearningPrepJobId(grantId);
    const grant = {
      schema: "studio.learning-prep.grant.v1" as const,
      grantId,
      attempt,
      runId: this.ledger.runId,
      requestFingerprint,
      caption: structuredClone(request.caption),
      fineTune: structuredClone(request.fineTune),
      rightsScope: this.rightsScope,
      disposition: "private_apply_output" as const,
      executor: structuredClone(executor),
      limits: structuredClone(LEARNING_PREP_LIMITS),
    };

    let started = false;
    let completed = false;
    try {
      await this.ledger.transact(
        {
          producer: { kind: "learning_prep_host", id: "host-learning-prep" },
          causationId: request.caption.jobId,
        },
        ({ state: current }) => {
          const matching = Object.values(current.learningPreps)
            .filter((record) => record.requestFingerprint === requestFingerprint);
          if (current.learningPreps[jobId] || matching.length !== attempt ||
              matching.some((record) => record.status !== "failed")) {
            throw new LearningPrepHostError(
              "illegal_learning_prep_transition",
              "This exact learning-prep request already has immutable lineage",
            );
          }
          return {
            pending: [{
              type: "learning.prep_started",
              data: {
                jobId,
                request: structuredClone(request),
                grant: structuredClone(grant),
                input: structuredClone(input),
              },
            }] satisfies PendingRuntimeEvent[],
            result: undefined,
          };
        },
      );
      started = true;
      const controller = new AbortController();
      let timeout: ReturnType<typeof setTimeout> | null = null;
      const wallLimit = new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => {
          controller.abort(new Error("Learning prep exceeded its wall-time ceiling"));
          reject(new LearningPrepHostError(
            "learning_prep_limits_exceeded",
            "Learning prep exceeded its wall-time ceiling",
          ));
        }, LEARNING_PREP_LIMITS.maxWallMs);
      });
      let generated;
      try {
        generated = await Promise.race([
          this.executor.generate({ grant, lines }, controller.signal),
          wallLimit,
        ]);
      } finally {
        if (timeout !== null) clearTimeout(timeout);
      }
      const output = validateGeneratedLearningPrepOutput(
        generated.output,
        grant.fineTune,
        lines,
      );
      if (
        generated.execution.outputTokens !== null &&
        generated.execution.outputTokens > LEARNING_PREP_LIMITS.maxCompletionTokens
      ) {
        throw new LearningPrepHostError(
          "learning_prep_limits_exceeded",
          "Learning-prep generator output exceeded its completion-token ceiling",
        );
      }
      if (new TextEncoder().encode(canonicalJson(output)).byteLength > LEARNING_PREP_LIMITS.maxOutputBytes) {
        throw new LearningPrepHostError(
          "learning_prep_limits_exceeded",
          "Learning-prep generator output exceeded its byte ceiling",
        );
      }
      const segmentation = storedSegmentation(output.segmentation, lines);
      const candidates = storedCandidates(output.candidates, lines);
      const lenses = lensOutcomes(grant.fineTune.armedLenses, candidates, output.lensAbstentions);
      await this.ledger.refresh();
      const executorAfter = validateLearningPrepExecutorDescriptor(
        this.executor.describe(),
        "Learning-prep host",
        "executor",
      );
      if (canonicalSha256(executorAfter) !== canonicalSha256(executor)) {
        throw new LearningPrepHostError(
          "stored_learning_prep_lineage_invalid",
          "The learning-prep executor configuration changed while the bounded job was running",
        );
      }
      const captionsAfter = await reopenCaptionProductionResults(
        this.ledger.state(),
        await this.ledger.events(),
        this.artifacts,
      );
      const captionAfter = captionsAfter.find((candidate) =>
        candidate.verification.jobId === request.caption.jobId &&
        candidate.verification.captionArtifactId === request.caption.artifactId &&
        candidate.verification.captionContentId === request.caption.contentId &&
        candidate.verification.receiptArtifactId === request.caption.receiptArtifactId &&
        candidate.verification.receiptId === request.caption.receiptId &&
        candidate.verification.receiptContentId === request.caption.receiptContentId
      );
      if (!captionAfter || captionAfter.verification.authorityState !== "unrevoked") {
        throw new LearningPrepHostError(
          "unrevoked_caption_authority_required",
          "Caption authority changed while the learning prep was running",
        );
      }
      const prep: LearningPrepArtifact = {
        schema: "studio.learning-prep.artifact.v1",
        jobId,
        runId: this.ledger.runId,
        input,
        grant,
        executor,
        segmentation,
        lenses,
        candidates,
        result: deriveLearningPrepResult(grant.fineTune, candidates, lenses, segmentation),
        semanticReview: { state: "not_reviewed", receiptId: null },
        rights: {
          sourceScope: this.rightsScope,
          publication: "private",
          exportEligibility: "unavailable",
        },
        nonClaims: LEARNING_PREP_NON_CLAIMS,
      };
      validateLearningPrepArtifact(prep);
      const storedPrep = await this.artifacts.storeJson(prep);
      if (storedPrep.content.bytes > LEARNING_PREP_LIMITS.maxArtifactBytes) {
        throw new LearningPrepHostError(
          "learning_prep_limits_exceeded",
          "The canonical learning-prep artifact exceeds its byte ceiling",
        );
      }
      const artifactId = createLearningPrepArtifactId(
        this.ledger.runId,
        jobId,
        storedPrep.content.contentId,
      );
      const receiptBody = {
        jobId,
        grant: structuredClone(grant),
        input: structuredClone(input),
        producer: {
          id: "studio.host-learning-prep" as const,
          version: "1" as const,
          policy: "verified_current_caption_post_study_apply_only" as const,
          executor: structuredClone(executor),
        },
        limits: structuredClone(LEARNING_PREP_LIMITS),
        execution: structuredClone(generated.execution),
        result: {
          ...structuredClone(prep.result),
          artifactId,
          contentId: storedPrep.content.contentId,
          bytes: storedPrep.content.bytes,
          lenses: lenses.map((lens) => ({
            lens: lens.lens,
            state: lens.state,
            reasonCode: lens.reasonCode,
            candidateCount: lens.candidateCount,
          })),
        },
        nonClaims: LEARNING_PREP_NON_CLAIMS,
      };
      const receipt: LearningPrepReceipt = {
        schema: "studio.learning-prep.receipt.v1",
        receiptId: `learning-prep-receipt:${canonicalSha256(receiptBody)}`,
        ...receiptBody,
      };
      validateLearningPrepReceipt(receipt);
      const storedReceipt = await this.artifacts.storeJson(receipt);
      if (
        canonicalJsonContentId(prep) !== storedPrep.content.contentId ||
        canonicalJsonContentId(receipt) !== storedReceipt.content.contentId ||
        storedReceipt.content.bytes > LEARNING_PREP_LIMITS.maxArtifactBytes
      ) {
        throw new LearningPrepHostError(
          "stored_learning_prep_lineage_invalid",
          "Stored learning-prep bytes changed canonical identity or exceeded limits",
        );
      }
      const built = this.artifacts.buildLearningPrepArtifacts({
        runId: this.ledger.runId,
        prep,
        receipt,
        storedPrep,
        storedReceipt,
      });
      await Promise.all([
        this.artifacts.resolveVerified(built.prepArtifact),
        this.artifacts.resolveVerified(built.receiptArtifact),
      ]);
      await this.ledger.transact(
        {
          producer: { kind: "learning_prep_host", id: "host-learning-prep" },
          causationId: jobId,
        },
        ({ state: current }) => {
          const captionRecord = current.captionProductions[request.caption.jobId];
          if (
            !captionRecord || captionRecord.status !== "completed" ||
            Object.values(current.publishReviewRevocations).some((revocation) =>
              revocation.reviewId === captionRecord.approvalReviewId && revocation.status !== "failed")
          ) {
            throw new LearningPrepHostError(
              "unrevoked_caption_authority_required",
              "Learning prep cannot complete after caption authority revocation starts",
            );
          }
          return {
            pending: [
              { type: "artifact.recorded", data: { artifact: built.prepArtifact } },
              { type: "artifact.recorded", data: { artifact: built.receiptArtifact } },
              {
                type: "learning.prep_completed",
                data: {
                  jobId,
                  artifactId: built.prepArtifact.id,
                  contentId: storedPrep.content.contentId,
                  receiptArtifactId: built.receiptArtifact.id,
                  receiptContentId: storedReceipt.content.contentId,
                  receipt,
                },
              },
            ] satisfies PendingRuntimeEvent[],
            result: undefined,
          };
        },
      );
      completed = true;
      return {
        prep,
        receipt,
        artifactId: built.prepArtifact.id,
        contentId: storedPrep.content.contentId,
        receiptArtifactId: built.receiptArtifact.id,
        receiptContentId: storedReceipt.content.contentId,
      };
    } catch (error) {
      if (started && !completed) {
        const reason = error instanceof LearningPrepHostError
          ? error.message
          : "Learning prep generation failed closed";
        for (let failureAttempt = 0; failureAttempt < 3; failureAttempt += 1) {
          try {
            await this.ledger.refresh();
            await this.ledger.transact(
              {
                producer: { kind: "learning_prep_host", id: "host-learning-prep" },
                causationId: jobId,
              },
              ({ state: current }) => current.learningPreps[jobId]?.status === "started"
                ? {
                    pending: [{ type: "learning.prep_failed", data: { jobId, reason } }] satisfies PendingRuntimeEvent[],
                    result: undefined,
                  }
                : { pending: [] as PendingRuntimeEvent[], result: undefined },
            );
            break;
          } catch (failureError) {
            if (!(failureError instanceof RuntimeJournalConflict) || failureAttempt === 2) {
              // Preserve the primary failure. Explicit host recovery can close any still-started attempt.
              break;
            }
          }
        }
      }
      if (error instanceof LearningPrepHostError) throw error;
      throw new LearningPrepHostError(
        "learning_prep_executor_failed",
        "Learning prep generation failed closed",
        { cause: error },
      );
    }
  }
}
