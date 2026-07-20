import {
  canonicalJsonContentId,
  ContentAddressedArtifactStore,
  createSpanTranslationArtifactId,
} from "../artifactStore.ts";
import { canonicalJson } from "../artifactStore/contentIdentity.ts";
import { canonicalSha256 } from "../canonicalIdentity.ts";
import { reopenCaptionProductionResults } from "../captions/captionProductionAudit.ts";
import { materializeCaptionProductionLines } from "../captions/captionArtifactCompaction.ts";
import { RuntimeJournalConflict, type RuntimeLedger } from "../journal.ts";
import type {
  CaptionProductionLine,
  SpanTranslationArtifact,
  SpanTranslationBody,
  SpanTranslationContextLine,
  SpanTranslationInputAuthority,
  SpanTranslationReceipt,
  SpanTranslationRequest,
} from "../model.ts";
import {
  SPAN_TRANSLATION_LIMITS,
  SPAN_TRANSLATION_NON_CLAIMS,
} from "../model.ts";
import type { PendingRuntimeEvent } from "../protocol.ts";
import { languageExplanationCaptionSnapshot } from "../languageExplanations/languageExplanationHost.ts";
import {
  assertSpanTranslationRequest,
  spanTranslationTargetLanguage,
  validateGeneratedSpanTranslation,
  validateSpanTranslationArtifact,
  validateSpanTranslationExecutorDescriptor,
  validateSpanTranslationReceipt,
} from "../validation/spanTranslations.ts";
import type { SpanTranslationExecutor } from "./executor.ts";
import {
  createSpanTranslationGrantId,
  createSpanTranslationJobId,
  createSpanTranslationRequestFingerprint,
} from "./identity.ts";

export type SpanTranslationHostErrorCode =
  | "verified_current_caption_required"
  | "unrevoked_caption_authority_required"
  | "span_translation_executor_unavailable"
  | "invalid_span_selection"
  | "span_translation_limits_exceeded"
  | "illegal_span_translation_transition"
  | "stored_span_translation_lineage_invalid"
  | "span_translation_executor_failed";

export class SpanTranslationHostError extends Error {
  readonly code: SpanTranslationHostErrorCode;

  constructor(code: SpanTranslationHostErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "SpanTranslationHostError";
    this.code = code;
  }
}

export interface SpanTranslationHostResult {
  translation: SpanTranslationArtifact;
  receipt: SpanTranslationReceipt;
  artifactId: string;
  contentId: string;
  receiptArtifactId: string;
  receiptContentId: string;
}

export function spanTranslationContextWindow(lines: readonly CaptionProductionLine[], selectedIndex: number): SpanTranslationContextLine[] {
  const half = Math.floor(SPAN_TRANSLATION_LIMITS.maxContextLines / 2);
  let start = Math.max(0, selectedIndex - half);
  const end = Math.min(lines.length, start + SPAN_TRANSLATION_LIMITS.maxContextLines);
  start = Math.max(0, end - SPAN_TRANSLATION_LIMITS.maxContextLines);
  return lines.slice(start, end).map(languageExplanationCaptionSnapshot);
}

/** Private post-caption Apply host. It accepts identities and a span, never caller-authored caption or translation prose. */
export class SpanTranslationHost {
  private readonly ledger: RuntimeLedger;
  private readonly artifacts: ContentAddressedArtifactStore;
  private readonly executor: SpanTranslationExecutor;
  private readonly rightsScope: "local_processing" | "redistribution";

  constructor(
    ledger: RuntimeLedger,
    artifacts: ContentAddressedArtifactStore,
    executor: SpanTranslationExecutor,
    rightsScope: "local_processing" | "redistribution",
  ) {
    this.ledger = ledger;
    this.artifacts = artifacts;
    this.executor = executor;
    this.rightsScope = rightsScope;
  }

  async produce(requestValue: unknown): Promise<SpanTranslationHostResult> {
    const request: SpanTranslationRequest = assertSpanTranslationRequest(requestValue);
    const executor = validateSpanTranslationExecutorDescriptor(
      this.executor.describe(),
      "Span-translation host",
      "executor",
    );
    if (executor.classification === "unavailable") {
      throw new SpanTranslationHostError(
        "span_translation_executor_unavailable",
        "Span translation is unavailable until a model is explicitly configured",
      );
    }
    const state = this.ledger.state();
    const events = await this.ledger.events();
    let captions;
    try {
      captions = await reopenCaptionProductionResults(state, events, this.artifacts);
    } catch (error) {
      throw new SpanTranslationHostError(
        "stored_span_translation_lineage_invalid",
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
      throw new SpanTranslationHostError(
        "verified_current_caption_required",
        "Span translations require one exact verified production caption result",
      );
    }
    if (caption.verification.authorityState !== "unrevoked") {
      throw new SpanTranslationHostError(
        "unrevoked_caption_authority_required",
        "New span translations cannot be produced after caption authority is revoked",
      );
    }
    const sourceArtifact = state.artifacts[caption.verification.source.artifactId];
    const recordedRightsScope = sourceArtifact?.origin.kind === "ingest"
      ? sourceArtifact.publication === "public" ? "redistribution" : "local_processing"
      : null;
    if (recordedRightsScope === null || recordedRightsScope !== this.rightsScope) {
      throw new SpanTranslationHostError(
        "stored_span_translation_lineage_invalid",
        "The registered source rights do not match the runtime host authority",
      );
    }
    const captionLines = materializeCaptionProductionLines(caption.artifact);
    const selectedIndex = captionLines.findIndex((line) => line.id === request.lineId);
    if (selectedIndex < 0) {
      throw new SpanTranslationHostError("invalid_span_selection", "The selected caption line does not exist");
    }
    const selectedLine = captionLines[selectedIndex];
    const selectedSide = request.selection.side === "source" ? selectedLine.source : selectedLine.target;
    if (selectedSide.state !== "available" || selectedSide.text === null) {
      throw new SpanTranslationHostError(
        "invalid_span_selection",
        "The selected caption side is withheld or unavailable and has no selectable text",
      );
    }
    const selectedText = Array.from(selectedSide.text)
      .slice(request.selection.start, request.selection.end)
      .join("");
    if (selectedText !== request.selection.text) {
      throw new SpanTranslationHostError(
        "invalid_span_selection",
        "The selected Unicode code-point span does not match the stored caption text",
      );
    }
    const line = languageExplanationCaptionSnapshot(selectedLine);
    const contextLines = spanTranslationContextWindow(captionLines, selectedIndex);
    const approval = caption.verification.approval;
    const semanticCitations = selectedLine.lineage.study.semanticCitations;
    const input: SpanTranslationInputAuthority = {
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
      approval: structuredClone(approval),
      caption: structuredClone(request.caption),
      line,
      contextLines,
      selection: structuredClone(request.selection),
      inputContextLineage: {
        claimIds: [...selectedLine.lineage.study.claimIds],
        citationIds: semanticCitations.map((citation) => citation.operationId),
        semanticEvidenceArtifactIds: semanticCitations.map((citation) => citation.artifactId),
        semanticEvidenceReceiptIds: semanticCitations.map((citation) => citation.receiptId),
      },
    };
    const requestFingerprint = createSpanTranslationRequestFingerprint({
      runId: this.ledger.runId,
      request,
      authority: input,
      executor,
      rightsScope: this.rightsScope,
    });
    const priorAttempts = Object.values(state.spanTranslations)
      .filter((record) => record.requestFingerprint === requestFingerprint);
    if (priorAttempts.some((record) => record.status !== "failed")) {
      throw new SpanTranslationHostError(
        "illegal_span_translation_transition",
        "This exact span-translation request is already active or completed",
      );
    }
    if (priorAttempts.length >= SPAN_TRANSLATION_LIMITS.maxAttemptsPerRequest) {
      throw new SpanTranslationHostError(
        "illegal_span_translation_transition",
        "This span-translation request exhausted its bounded retry attempts",
      );
    }
    const attempt = priorAttempts.length;
    const grantId = createSpanTranslationGrantId({
      runId: this.ledger.runId,
      requestFingerprint,
      caption: request.caption,
      attempt,
    });
    const jobId = createSpanTranslationJobId(grantId);
    const grant = {
      schema: "studio.span-translation.grant.v1" as const,
      grantId,
      attempt,
      runId: this.ledger.runId,
      requestFingerprint,
      caption: structuredClone(request.caption),
      lineId: request.lineId,
      selection: structuredClone(request.selection),
      rightsScope: this.rightsScope,
      disposition: "private_apply_output" as const,
      executor: structuredClone(executor),
      limits: structuredClone(SPAN_TRANSLATION_LIMITS),
    };

    let started = false;
    let completed = false;
    try {
      await this.ledger.transact(
        {
          producer: { kind: "span_translation_host", id: "host-span-translation" },
          causationId: request.caption.jobId,
        },
        ({ state: current }) => {
          const matching = Object.values(current.spanTranslations)
            .filter((record) => record.requestFingerprint === requestFingerprint);
          if (current.spanTranslations[jobId] || matching.length !== attempt ||
              matching.some((record) => record.status !== "failed")) {
            throw new SpanTranslationHostError(
              "illegal_span_translation_transition",
              "This exact span-translation request already has immutable lineage",
            );
          }
          return {
            pending: [{
              type: "translation.span_started",
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
          controller.abort(new Error("Span translation exceeded its wall-time ceiling"));
          reject(new SpanTranslationHostError(
            "span_translation_limits_exceeded",
            "Span translation exceeded its wall-time ceiling",
          ));
        }, SPAN_TRANSLATION_LIMITS.maxWallMs);
      });
      let generated;
      try {
        generated = await Promise.race([
          this.executor.generate({ grant, line, contextLines }, controller.signal),
          wallLimit,
        ]);
      } finally {
        if (timeout !== null) clearTimeout(timeout);
      }
      const generatedTranslation = validateGeneratedSpanTranslation(generated.translation);
      if (
        generated.execution.outputTokens !== null &&
        generated.execution.outputTokens > SPAN_TRANSLATION_LIMITS.maxCompletionTokens
      ) {
        throw new SpanTranslationHostError(
          "span_translation_limits_exceeded",
          "Span-translation generator output exceeded its completion-token ceiling",
        );
      }
      if (new TextEncoder().encode(canonicalJson({ translation: generatedTranslation })).byteLength > SPAN_TRANSLATION_LIMITS.maxOutputBytes) {
        throw new SpanTranslationHostError(
          "span_translation_limits_exceeded",
          "Span-translation generator output exceeded its byte ceiling",
        );
      }
      const language = spanTranslationTargetLanguage(request.selection.side);
      const translation: SpanTranslationBody = generatedTranslation.availability === "available"
        ? {
            language,
            ...generatedTranslation,
            executionAuthority: "host_receipted",
            semanticReview: "not_reviewed",
            grounding: "caption_context_inference",
            externalCitationIds: [],
          }
        : {
            language,
            ...generatedTranslation,
            executionAuthority: "host_receipted",
            semanticReview: "not_reviewed",
            grounding: "none",
            externalCitationIds: [],
          };
      await this.ledger.refresh();
      const executorAfter = validateSpanTranslationExecutorDescriptor(
        this.executor.describe(),
        "Span-translation host",
        "executor",
      );
      if (canonicalSha256(executorAfter) !== canonicalSha256(executor)) {
        throw new SpanTranslationHostError(
          "stored_span_translation_lineage_invalid",
          "The span-translation executor configuration changed while the bounded job was running",
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
        throw new SpanTranslationHostError(
          "unrevoked_caption_authority_required",
          "Caption authority changed while the span translation was running",
        );
      }
      const artifact: SpanTranslationArtifact = {
        schema: "studio.span-translation.artifact.v1",
        jobId,
        runId: this.ledger.runId,
        input,
        grant,
        executor,
        translation,
        result: { status: translation.availability === "available" ? "completed" : translation.availability },
        semanticReview: { state: "not_reviewed", receiptId: null },
        rights: {
          sourceScope: this.rightsScope,
          publication: "private",
          exportEligibility: "unavailable",
        },
        nonClaims: SPAN_TRANSLATION_NON_CLAIMS,
      };
      validateSpanTranslationArtifact(artifact);
      const storedTranslation = await this.artifacts.storeJson(artifact);
      if (storedTranslation.content.bytes > SPAN_TRANSLATION_LIMITS.maxArtifactBytes) {
        throw new SpanTranslationHostError(
          "span_translation_limits_exceeded",
          "The canonical span-translation artifact exceeds its byte ceiling",
        );
      }
      const artifactId = createSpanTranslationArtifactId(
        this.ledger.runId,
        jobId,
        storedTranslation.content.contentId,
      );
      const receiptBody = {
        jobId,
        grant: structuredClone(grant),
        input: structuredClone(input),
        producer: {
          id: "studio.host-span-translation" as const,
          version: "1" as const,
          policy: "verified_current_caption_private_apply_only" as const,
          executor: structuredClone(executor),
        },
        limits: structuredClone(SPAN_TRANSLATION_LIMITS),
        execution: structuredClone(generated.execution),
        result: {
          ...structuredClone(artifact.result),
          availability: translation.availability,
          reasonCode: translation.reasonCode,
          artifactId,
          contentId: storedTranslation.content.contentId,
          bytes: storedTranslation.content.bytes,
        },
        nonClaims: SPAN_TRANSLATION_NON_CLAIMS,
      };
      const receipt: SpanTranslationReceipt = {
        schema: "studio.span-translation.receipt.v1",
        receiptId: `span-translation-receipt:${canonicalSha256(receiptBody)}`,
        ...receiptBody,
      };
      validateSpanTranslationReceipt(receipt);
      const storedReceipt = await this.artifacts.storeJson(receipt);
      if (
        canonicalJsonContentId(artifact) !== storedTranslation.content.contentId ||
        canonicalJsonContentId(receipt) !== storedReceipt.content.contentId ||
        storedReceipt.content.bytes > SPAN_TRANSLATION_LIMITS.maxArtifactBytes
      ) {
        throw new SpanTranslationHostError(
          "stored_span_translation_lineage_invalid",
          "Stored span-translation bytes changed canonical identity or exceeded limits",
        );
      }
      const built = this.artifacts.buildSpanTranslationArtifacts({
        runId: this.ledger.runId,
        translation: artifact,
        receipt,
        storedTranslation,
        storedReceipt,
      });
      await Promise.all([
        this.artifacts.resolveVerified(built.translationArtifact),
        this.artifacts.resolveVerified(built.receiptArtifact),
      ]);
      await this.ledger.transact(
        {
          producer: { kind: "span_translation_host", id: "host-span-translation" },
          causationId: jobId,
        },
        ({ state: current }) => {
          const captionRecord = current.captionProductions[request.caption.jobId];
          if (
            !captionRecord || captionRecord.status !== "completed" ||
            Object.values(current.publishReviewRevocations).some((revocation) =>
              revocation.reviewId === captionRecord.approvalReviewId && revocation.status !== "failed")
          ) {
            throw new SpanTranslationHostError(
              "unrevoked_caption_authority_required",
              "Span translation cannot complete after caption authority revocation starts",
            );
          }
          return {
            pending: [
              { type: "artifact.recorded", data: { artifact: built.translationArtifact } },
              { type: "artifact.recorded", data: { artifact: built.receiptArtifact } },
              {
                type: "translation.span_completed",
                data: {
                  jobId,
                  artifactId: built.translationArtifact.id,
                  contentId: storedTranslation.content.contentId,
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
        translation: artifact,
        receipt,
        artifactId: built.translationArtifact.id,
        contentId: storedTranslation.content.contentId,
        receiptArtifactId: built.receiptArtifact.id,
        receiptContentId: storedReceipt.content.contentId,
      };
    } catch (error) {
      if (started && !completed) {
        const reason = error instanceof SpanTranslationHostError
          ? error.message
          : "Span translation failed closed";
        for (let failureAttempt = 0; failureAttempt < 3; failureAttempt += 1) {
          try {
            await this.ledger.refresh();
            await this.ledger.transact(
              {
                producer: { kind: "span_translation_host", id: "host-span-translation" },
                causationId: jobId,
              },
              ({ state: current }) => current.spanTranslations[jobId]?.status === "started"
                ? {
                    pending: [{ type: "translation.span_failed", data: { jobId, reason } }] satisfies PendingRuntimeEvent[],
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
      if (error instanceof SpanTranslationHostError) throw error;
      throw new SpanTranslationHostError(
        "span_translation_executor_failed",
        "Span translation failed closed",
        { cause: error },
      );
    }
  }
}
