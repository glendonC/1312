import {
  canonicalJsonContentId,
  ContentAddressedArtifactStore,
  createLanguageExplanationArtifactId,
} from "../artifactStore.ts";
import { canonicalJson } from "../artifactStore/contentIdentity.ts";
import { canonicalSha256 } from "../canonicalIdentity.ts";
import { reopenCaptionProductionResults } from "../captions/captionProductionAudit.ts";
import { RuntimeJournalConflict, type RuntimeLedger } from "../journal.ts";
import type {
  CaptionProductionLine,
  LanguageExplanationArtifact,
  LanguageExplanationContextLine,
  LanguageExplanationFacet,
  LanguageExplanationInputAuthority,
  LanguageExplanationReceipt,
  LanguageExplanationRequest,
} from "../model.ts";
import {
  LANGUAGE_EXPLANATION_LIMITS,
  LANGUAGE_EXPLANATION_NON_CLAIMS,
} from "../model.ts";
import type { PendingRuntimeEvent } from "../protocol.ts";
import {
  assertLanguageExplanationRequest,
  validateGeneratedLanguageExplanationFacets,
  validateLanguageExplanationArtifact,
  validateLanguageExplanationExecutorDescriptor,
  validateLanguageExplanationReceipt,
} from "../validation/languageExplanations.ts";
import type { LanguageExplanationExecutor } from "./executor.ts";
import {
  createLanguageExplanationGrantId,
  createLanguageExplanationJobId,
  createLanguageExplanationRequestFingerprint,
} from "./identity.ts";

export type LanguageExplanationHostErrorCode =
  | "verified_current_caption_required"
  | "unrevoked_caption_authority_required"
  | "language_explanation_executor_unavailable"
  | "invalid_language_selection"
  | "language_explanation_limits_exceeded"
  | "illegal_language_explanation_transition"
  | "stored_language_explanation_lineage_invalid"
  | "language_explanation_executor_failed";

export class LanguageExplanationHostError extends Error {
  readonly code: LanguageExplanationHostErrorCode;

  constructor(code: LanguageExplanationHostErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "LanguageExplanationHostError";
    this.code = code;
  }
}

export interface LanguageExplanationHostResult {
  explanation: LanguageExplanationArtifact;
  receipt: LanguageExplanationReceipt;
  artifactId: string;
  contentId: string;
  receiptArtifactId: string;
  receiptContentId: string;
}

export function languageExplanationCaptionSnapshot(line: CaptionProductionLine): LanguageExplanationContextLine {
  if (line.source.state !== "available" && line.source.reasonCode === null) {
    throw new Error(`Caption line ${line.id} omitted its source availability reason`);
  }
  if (line.target.state !== "available" && line.target.reasonCode === null) {
    throw new Error(`Caption line ${line.id} omitted its target availability reason`);
  }
  return {
    lineId: line.id,
    startMs: line.startMs,
    endMs: line.endMs,
    source: line.source.state === "available"
      ? { language: "ko", state: "available", text: line.source.text!, reasonCode: null }
      : { language: "ko", state: line.source.state, text: null, reasonCode: line.source.reasonCode! },
    target: line.target.state === "available"
      ? { language: "en", state: "available", text: line.target.text!, reasonCode: null }
      : { language: "en", state: line.target.state, text: null, reasonCode: line.target.reasonCode! },
  };
}

export function languageExplanationContextWindow(lines: readonly CaptionProductionLine[], selectedIndex: number): LanguageExplanationContextLine[] {
  const half = Math.floor(LANGUAGE_EXPLANATION_LIMITS.maxContextLines / 2);
  let start = Math.max(0, selectedIndex - half);
  let end = Math.min(lines.length, start + LANGUAGE_EXPLANATION_LIMITS.maxContextLines);
  start = Math.max(0, end - LANGUAGE_EXPLANATION_LIMITS.maxContextLines);
  return lines.slice(start, end).map(languageExplanationCaptionSnapshot);
}

function resultFor(facets: readonly LanguageExplanationFacet[]): LanguageExplanationArtifact["result"] {
  const availableFacetCount = facets.filter((facet) => facet.availability === "available").length;
  const withheldFacetCount = facets.filter((facet) => facet.availability === "withheld").length;
  const unavailableFacetCount = facets.filter((facet) => facet.availability === "unavailable").length;
  return {
    status: availableFacetCount === facets.length ? "completed" : availableFacetCount > 0 ? "partial" : "unavailable",
    requestedFacetCount: facets.length,
    availableFacetCount,
    withheldFacetCount,
    unavailableFacetCount,
  };
}

/** Private post-caption Apply host. It accepts identities and a span, never caller-authored caption or explanation prose. */
export class LanguageExplanationHost {
  private readonly ledger: RuntimeLedger;
  private readonly artifacts: ContentAddressedArtifactStore;
  private readonly executor: LanguageExplanationExecutor;
  private readonly rightsScope: "local_processing" | "redistribution";

  constructor(
    ledger: RuntimeLedger,
    artifacts: ContentAddressedArtifactStore,
    executor: LanguageExplanationExecutor,
    rightsScope: "local_processing" | "redistribution",
  ) {
    this.ledger = ledger;
    this.artifacts = artifacts;
    this.executor = executor;
    this.rightsScope = rightsScope;
  }

  async produce(requestValue: unknown): Promise<LanguageExplanationHostResult> {
    const request: LanguageExplanationRequest = assertLanguageExplanationRequest(requestValue);
    const executor = validateLanguageExplanationExecutorDescriptor(
      this.executor.describe(),
      "Language-explanation host",
      "executor",
    );
    if (executor.classification === "unavailable") {
      throw new LanguageExplanationHostError(
        "language_explanation_executor_unavailable",
        "Language explanation generation is unavailable until a model is explicitly configured",
      );
    }
    const state = this.ledger.state();
    const events = await this.ledger.events();
    let captions;
    try {
      captions = await reopenCaptionProductionResults(state, events, this.artifacts);
    } catch (error) {
      throw new LanguageExplanationHostError(
        "stored_language_explanation_lineage_invalid",
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
      throw new LanguageExplanationHostError(
        "verified_current_caption_required",
        "Language explanations require one exact verified production caption result",
      );
    }
    if (caption.verification.authorityState !== "unrevoked") {
      throw new LanguageExplanationHostError(
        "unrevoked_caption_authority_required",
        "New language explanations cannot be produced after caption authority is revoked",
      );
    }
    const sourceArtifact = state.artifacts[caption.verification.source.artifactId];
    const recordedRightsScope = sourceArtifact?.origin.kind === "ingest"
      ? sourceArtifact.publication === "public" ? "redistribution" : "local_processing"
      : null;
    if (recordedRightsScope === null || recordedRightsScope !== this.rightsScope) {
      throw new LanguageExplanationHostError(
        "stored_language_explanation_lineage_invalid",
        "The registered source rights do not match the runtime host authority",
      );
    }
    const selectedIndex = caption.artifact.lines.findIndex((line) => line.id === request.lineId);
    if (selectedIndex < 0) {
      throw new LanguageExplanationHostError("invalid_language_selection", "The selected caption line does not exist");
    }
    const selectedLine = caption.artifact.lines[selectedIndex];
    const selectedSide = request.selection.side === "source" ? selectedLine.source : selectedLine.target;
    if (selectedSide.state !== "available" || selectedSide.text === null) {
      throw new LanguageExplanationHostError(
        "invalid_language_selection",
        "The selected caption side is withheld or unavailable and has no selectable text",
      );
    }
    const selectedText = Array.from(selectedSide.text)
      .slice(request.selection.start, request.selection.end)
      .join("");
    if (selectedText !== request.selection.text) {
      throw new LanguageExplanationHostError(
        "invalid_language_selection",
        "The selected Unicode code-point span does not match the stored caption text",
      );
    }
    const line = languageExplanationCaptionSnapshot(selectedLine);
    const contextLines = languageExplanationContextWindow(caption.artifact.lines, selectedIndex);
    const approval = caption.verification.approval;
    const semanticCitations = selectedLine.lineage.study.semanticCitations;
    const input: LanguageExplanationInputAuthority = {
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
    const requestFingerprint = createLanguageExplanationRequestFingerprint({
      runId: this.ledger.runId,
      request,
      authority: input,
      executor,
      rightsScope: this.rightsScope,
    });
    const priorAttempts = Object.values(state.languageExplanations)
      .filter((record) => record.requestFingerprint === requestFingerprint);
    if (priorAttempts.some((record) => record.status !== "failed")) {
      throw new LanguageExplanationHostError(
        "illegal_language_explanation_transition",
        "This exact language-explanation request is already active or completed",
      );
    }
    if (priorAttempts.length >= LANGUAGE_EXPLANATION_LIMITS.maxAttemptsPerRequest) {
      throw new LanguageExplanationHostError(
        "illegal_language_explanation_transition",
        "This language-explanation request exhausted its bounded retry attempts",
      );
    }
    const attempt = priorAttempts.length;
    const grantId = createLanguageExplanationGrantId({
      runId: this.ledger.runId,
      requestFingerprint,
      caption: request.caption,
      attempt,
    });
    const jobId = createLanguageExplanationJobId(grantId);
    const grant = {
      schema: "studio.language-explanation.grant.v1" as const,
      grantId,
      attempt,
      runId: this.ledger.runId,
      requestFingerprint,
      caption: structuredClone(request.caption),
      lineId: request.lineId,
      selection: structuredClone(request.selection),
      facetKinds: [...request.facetKinds],
      rightsScope: this.rightsScope,
      disposition: "private_apply_output" as const,
      executor: structuredClone(executor),
      limits: structuredClone(LANGUAGE_EXPLANATION_LIMITS),
    };

    let started = false;
    let completed = false;
    try {
      await this.ledger.transact(
        {
          producer: { kind: "language_explanation_host", id: "host-language-explanation" },
          causationId: request.caption.jobId,
        },
        ({ state: current }) => {
          const matching = Object.values(current.languageExplanations)
            .filter((record) => record.requestFingerprint === requestFingerprint);
          if (current.languageExplanations[jobId] || matching.length !== attempt ||
              matching.some((record) => record.status !== "failed")) {
            throw new LanguageExplanationHostError(
              "illegal_language_explanation_transition",
              "This exact language-explanation request already has immutable lineage",
            );
          }
          return {
            pending: [{
              type: "language.explanation_started",
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
          controller.abort(new Error("Language explanation exceeded its wall-time ceiling"));
          reject(new LanguageExplanationHostError(
            "language_explanation_limits_exceeded",
            "Language explanation exceeded its wall-time ceiling",
          ));
        }, LANGUAGE_EXPLANATION_LIMITS.maxWallMs);
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
      const generatedFacets = validateGeneratedLanguageExplanationFacets(
        generated.facets,
        grant.facetKinds,
      );
      if (
        generated.execution.outputTokens !== null &&
        generated.execution.outputTokens > LANGUAGE_EXPLANATION_LIMITS.maxCompletionTokens
      ) {
        throw new LanguageExplanationHostError(
          "language_explanation_limits_exceeded",
          "Language-explanation generator output exceeded its completion-token ceiling",
        );
      }
      if (new TextEncoder().encode(canonicalJson({ facets: generatedFacets })).byteLength > LANGUAGE_EXPLANATION_LIMITS.maxOutputBytes) {
        throw new LanguageExplanationHostError(
          "language_explanation_limits_exceeded",
          "Language-explanation generator output exceeded its byte ceiling",
        );
      }
      const facets: LanguageExplanationFacet[] = generatedFacets.map((facet) =>
        facet.availability === "available"
          ? {
              ...facet,
              executionAuthority: "host_receipted",
              semanticReview: "not_reviewed",
              grounding: "caption_context_inference",
              externalCitationIds: [],
            }
          : {
              ...facet,
              executionAuthority: "host_receipted",
              semanticReview: "not_reviewed",
              grounding: "none",
              externalCitationIds: [],
            });
      await this.ledger.refresh();
      const executorAfter = validateLanguageExplanationExecutorDescriptor(
        this.executor.describe(),
        "Language-explanation host",
        "executor",
      );
      if (canonicalSha256(executorAfter) !== canonicalSha256(executor)) {
        throw new LanguageExplanationHostError(
          "stored_language_explanation_lineage_invalid",
          "The explanation executor configuration changed while the bounded job was running",
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
        throw new LanguageExplanationHostError(
          "unrevoked_caption_authority_required",
          "Caption authority changed while the explanation was running",
        );
      }
      const explanation: LanguageExplanationArtifact = {
        schema: "studio.language-explanation.artifact.v1",
        jobId,
        runId: this.ledger.runId,
        input,
        grant,
        executor,
        facets,
        result: resultFor(facets),
        semanticReview: { state: "not_reviewed", receiptId: null },
        rights: {
          sourceScope: this.rightsScope,
          publication: "private",
          exportEligibility: "unavailable",
        },
        nonClaims: LANGUAGE_EXPLANATION_NON_CLAIMS,
      };
      validateLanguageExplanationArtifact(explanation);
      const storedExplanation = await this.artifacts.storeJson(explanation);
      if (storedExplanation.content.bytes > LANGUAGE_EXPLANATION_LIMITS.maxArtifactBytes) {
        throw new LanguageExplanationHostError(
          "language_explanation_limits_exceeded",
          "The canonical language-explanation artifact exceeds its byte ceiling",
        );
      }
      const artifactId = createLanguageExplanationArtifactId(
        this.ledger.runId,
        jobId,
        storedExplanation.content.contentId,
      );
      const receiptBody = {
        jobId,
        grant: structuredClone(grant),
        input: structuredClone(input),
        producer: {
          id: "studio.host-language-explanation" as const,
          version: "1" as const,
          policy: "verified_current_caption_private_apply_only" as const,
          executor: structuredClone(executor),
        },
        limits: structuredClone(LANGUAGE_EXPLANATION_LIMITS),
        execution: structuredClone(generated.execution),
        result: {
          ...structuredClone(explanation.result),
          artifactId,
          contentId: storedExplanation.content.contentId,
          bytes: storedExplanation.content.bytes,
          facets: facets.map((facet) => ({
            kind: facet.kind,
            availability: facet.availability,
            reasonCode: facet.reasonCode,
          })),
        },
        nonClaims: LANGUAGE_EXPLANATION_NON_CLAIMS,
      };
      const receipt: LanguageExplanationReceipt = {
        schema: "studio.language-explanation.receipt.v1",
        receiptId: `language-explanation-receipt:${canonicalSha256(receiptBody)}`,
        ...receiptBody,
      };
      validateLanguageExplanationReceipt(receipt);
      const storedReceipt = await this.artifacts.storeJson(receipt);
      if (
        canonicalJsonContentId(explanation) !== storedExplanation.content.contentId ||
        canonicalJsonContentId(receipt) !== storedReceipt.content.contentId ||
        storedReceipt.content.bytes > LANGUAGE_EXPLANATION_LIMITS.maxArtifactBytes
      ) {
        throw new LanguageExplanationHostError(
          "stored_language_explanation_lineage_invalid",
          "Stored language-explanation bytes changed canonical identity or exceeded limits",
        );
      }
      const built = this.artifacts.buildLanguageExplanationArtifacts({
        runId: this.ledger.runId,
        explanation,
        receipt,
        storedExplanation,
        storedReceipt,
      });
      await Promise.all([
        this.artifacts.resolveVerified(built.explanationArtifact),
        this.artifacts.resolveVerified(built.receiptArtifact),
      ]);
      await this.ledger.transact(
        {
          producer: { kind: "language_explanation_host", id: "host-language-explanation" },
          causationId: jobId,
        },
        ({ state: current }) => {
          const captionRecord = current.captionProductions[request.caption.jobId];
          if (
            !captionRecord || captionRecord.status !== "completed" ||
            Object.values(current.publishReviewRevocations).some((revocation) =>
              revocation.reviewId === captionRecord.approvalReviewId && revocation.status !== "failed")
          ) {
            throw new LanguageExplanationHostError(
              "unrevoked_caption_authority_required",
              "Language explanation cannot complete after caption authority revocation starts",
            );
          }
          return {
            pending: [
              { type: "artifact.recorded", data: { artifact: built.explanationArtifact } },
              { type: "artifact.recorded", data: { artifact: built.receiptArtifact } },
              {
                type: "language.explanation_completed",
                data: {
                  jobId,
                  artifactId: built.explanationArtifact.id,
                  contentId: storedExplanation.content.contentId,
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
        explanation,
        receipt,
        artifactId: built.explanationArtifact.id,
        contentId: storedExplanation.content.contentId,
        receiptArtifactId: built.receiptArtifact.id,
        receiptContentId: storedReceipt.content.contentId,
      };
    } catch (error) {
      if (started && !completed) {
        const reason = error instanceof LanguageExplanationHostError
          ? error.message
          : "Language explanation generation failed closed";
        for (let failureAttempt = 0; failureAttempt < 3; failureAttempt += 1) {
          try {
            await this.ledger.refresh();
            await this.ledger.transact(
              {
                producer: { kind: "language_explanation_host", id: "host-language-explanation" },
                causationId: jobId,
              },
              ({ state: current }) => current.languageExplanations[jobId]?.status === "started"
                ? {
                    pending: [{ type: "language.explanation_failed", data: { jobId, reason } }] satisfies PendingRuntimeEvent[],
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
      if (error instanceof LanguageExplanationHostError) throw error;
      throw new LanguageExplanationHostError(
        "language_explanation_executor_failed",
        "Language explanation generation failed closed",
        { cause: error },
      );
    }
  }
}
