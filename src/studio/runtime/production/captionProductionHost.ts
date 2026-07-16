import {
  canonicalJsonContentId,
  canonicalSha256,
  ContentAddressedArtifactStore,
  createCaptionArtifactId,
} from "./artifactStore.ts";
import type { CaptionProductionExecutor, CaptionExecutorInput } from "./captionProductionExecutor.ts";
import type { RuntimeLedger } from "./journal.ts";
import type {
  CaptionProductionArtifact,
  CaptionProductionReceipt,
  CaptionProductionRequest,
  ProductionAnalysisRequest,
} from "./model.ts";
import { CAPTION_PRODUCTION_LIMITS } from "./model.ts";
import { reopenPublishReviewDecisions } from "./publishReviewDecisionAudit.ts";
import { reopenPromotedRootOutputs } from "./rootOutputDispositionAudit.ts";
import type { PendingRuntimeEvent } from "./protocol.ts";
import {
  assertCaptionProductionRequest,
  deriveCaptionProductionResult,
  validateCaptionProductionArtifact,
  validateCaptionProductionReceipt,
} from "./validation/captionProduction.ts";

export type CaptionProductionHostErrorCode =
  | "verified_unrevoked_approval_required"
  | "verified_accepted_child_output_required"
  | "unsupported_caption_language_pair"
  | "caption_limits_exceeded"
  | "illegal_caption_transition"
  | "stored_lineage_invalid"
  | "caption_executor_failed";

export class CaptionProductionHostError extends Error {
  readonly code: CaptionProductionHostErrorCode;

  constructor(code: CaptionProductionHostErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "CaptionProductionHostError";
    this.code = code;
  }
}

export interface CaptionProductionHostInput {
  sourcePath: string;
  fixtureCaptionPath: string;
  sourceArtifactId: string;
  sourceContentId: string;
  analysisRequest: ProductionAnalysisRequest;
}

export interface CaptionProductionHostResult {
  caption: CaptionProductionArtifact;
  receipt: CaptionProductionReceipt;
  captionContentId: string;
  captionArtifactId: string;
  receiptContentId: string;
  receiptArtifactId: string;
}

/** Separate, private caption authority. It cannot publish and accepts no media paths or prose. */
export class CaptionProductionHost {
  private readonly ledger: RuntimeLedger;
  private readonly artifacts: ContentAddressedArtifactStore;
  private readonly executor: CaptionProductionExecutor;
  private readonly hostInput: CaptionProductionHostInput;

  constructor(
    ledger: RuntimeLedger,
    artifacts: ContentAddressedArtifactStore,
    executor: CaptionProductionExecutor,
    hostInput: CaptionProductionHostInput,
  ) {
    this.ledger = ledger;
    this.artifacts = artifacts;
    this.executor = executor;
    this.hostInput = structuredClone(hostInput);
  }

  async produce(requestValue: unknown): Promise<CaptionProductionHostResult> {
    const request: CaptionProductionRequest = assertCaptionProductionRequest(requestValue);
    const analysis = this.hostInput.analysisRequest;
    if (
      analysis.language.languagePair.requestedSource.mode !== "declared" ||
      analysis.language.languagePair.requestedSource.languages.length !== 1 ||
      analysis.language.languagePair.requestedSource.languages[0] !== "ko" ||
      analysis.language.languagePair.targetLanguage !== "en"
    ) {
      throw new CaptionProductionHostError(
        "unsupported_caption_language_pair",
        "This caption producer emits only the exact declared ko-to-en production contract",
      );
    }
    const durationMs = analysis.range.endMs - analysis.range.startMs;
    if (durationMs <= 0 || durationMs > CAPTION_PRODUCTION_LIMITS.maxDurationMs) {
      throw new CaptionProductionHostError(
        "caption_limits_exceeded",
        "The immutable analysis range exceeds the caption-production duration ceiling",
      );
    }
    const executorInput: CaptionExecutorInput = {
      sourcePath: this.hostInput.sourcePath,
      fixtureCaptionPath: this.hostInput.fixtureCaptionPath,
      range: structuredClone(analysis.range),
    };
    const executor = await this.executor.describe(executorInput);
    const state = this.ledger.state();
    const source = state.artifacts[this.hostInput.sourceArtifactId];
    if (
      !source || source.origin.kind !== "ingest" ||
      source.content.contentId !== this.hostInput.sourceContentId
    ) {
      throw new CaptionProductionHostError(
        "stored_lineage_invalid",
        "The host-resolved caption source no longer matches the runtime ingest artifact",
      );
    }

    let promotions;
    try {
      promotions = await reopenPromotedRootOutputs(state, this.artifacts);
    } catch (error) {
      throw new CaptionProductionHostError(
        "stored_lineage_invalid",
        "The accepted child and root-promotion lineage failed closed recursive verification",
        { cause: error },
      );
    }
    const matchingPromotions = promotions.filter((candidate) =>
      candidate.receipt.delegation.grants.some((grant) => grant.capability === "media.seek") &&
      candidate.evidence.mediaOperationIds.length > 0 &&
      candidate.receipt.delegation.mediaScope.some((scope) =>
        scope.artifactId === source.id &&
        scope.startMs <= analysis.range.startMs &&
        scope.endMs >= analysis.range.endMs
      )
    );
    if (matchingPromotions.length !== 1) {
      throw new CaptionProductionHostError(
        "verified_accepted_child_output_required",
        "Caption candidates require one exact verified current-run promoted child output covering the source window",
      );
    }
    const promotion = matchingPromotions[0];
    const acceptedChildOutput = state.artifacts[promotion.receipt.input.artifactId];
    const rootPromotionArtifact = state.artifacts[promotion.receiptArtifactId];
    if (!acceptedChildOutput || !rootPromotionArtifact) {
      throw new CaptionProductionHostError(
        "stored_lineage_invalid",
        "The verified caption promotion artifacts are missing from the current run",
      );
    }

    let reviews;
    try {
      reviews = await reopenPublishReviewDecisions(
        state,
        await this.ledger.events(),
        this.artifacts,
      );
    } catch (error) {
      throw new CaptionProductionHostError(
        "stored_lineage_invalid",
        "The caption approval lineage failed closed recursive verification",
        { cause: error },
      );
    }
    const approval = reviews.find((candidate) =>
      candidate.reviewId === request.approval.reviewId &&
      candidate.artifactId === request.approval.artifactId &&
      candidate.receiptId === request.approval.receiptId &&
      candidate.receiptContentId === request.approval.receiptContentId
    );
    if (
      !approval || approval.outcome !== "approve_for_caption_production" ||
      approval.state !== "approved_for_caption_production" || approval.revocation !== null
    ) {
      throw new CaptionProductionHostError(
        "verified_unrevoked_approval_required",
        "Caption production requires one exact recursively verified unrevoked approval identity",
      );
    }

    const jobId = `caption-production:${canonicalSha256({
      runId: this.ledger.runId,
      approval: request.approval,
    })}`;
    const input: CaptionProductionArtifact["input"] = {
      sourceArtifactId: source.id,
      sourceContentId: source.content.contentId,
      analysisRequestId: analysis.requestId,
      range: structuredClone(analysis.range),
      sourceLanguage: "ko",
      targetLanguage: "en",
      acceptedChildOutput: {
        artifactId: acceptedChildOutput.id,
        contentId: acceptedChildOutput.content.contentId,
      },
      rootPromotion: {
        dispositionId: promotion.receipt.dispositionId,
        artifactId: rootPromotionArtifact.id,
        contentId: rootPromotionArtifact.content.contentId,
        receiptId: promotion.receipt.receiptId,
        receiptContentId: promotion.receiptContentId,
      },
    };
    let started = false;
    try {
      await this.ledger.transact(
        {
          producer: { kind: "caption_production_host", id: "host-caption-production" },
          causationId: approval.reviewId,
        },
        ({ state: current }) => {
          if (
            current.captionProductions[jobId] ||
            Object.values(current.captionProductions).some((job) => job.approvalReviewId === approval.reviewId)
          ) {
            throw new CaptionProductionHostError(
              "illegal_caption_transition",
              "The approval already has immutable caption-production lineage",
            );
          }
          return {
            pending: [{
              type: "caption.production_started",
              data: {
                jobId,
                request: structuredClone(request),
                input: structuredClone(input),
                limits: structuredClone(CAPTION_PRODUCTION_LIMITS),
                executor: structuredClone(executor),
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
          controller.abort();
          reject(new CaptionProductionHostError(
            "caption_limits_exceeded",
            "Caption production exceeded its wall-time ceiling",
          ));
        }, CAPTION_PRODUCTION_LIMITS.maxWallMs);
      });
      let lines;
      try {
        lines = await Promise.race([
          this.executor.execute(executorInput, controller.signal),
          wallLimit,
        ]);
      } finally {
        if (timeout !== null) clearTimeout(timeout);
      }
      const executorAfter = await this.executor.describe(executorInput);
      if (canonicalSha256(executorAfter) !== canonicalSha256(executor)) {
        throw new CaptionProductionHostError(
          "stored_lineage_invalid",
          "Caption executor evidence changed while the bounded job was running",
        );
      }
      try {
        await this.artifacts.resolveVerified(source);
        const promotionsAfter = await reopenPromotedRootOutputs(this.ledger.state(), this.artifacts);
        if (!promotionsAfter.some((candidate) =>
          candidate.receipt.dispositionId === promotion.receipt.dispositionId &&
          candidate.receiptArtifactId === promotion.receiptArtifactId &&
          candidate.receiptContentId === promotion.receiptContentId &&
          candidate.receipt.input.artifactId === promotion.receipt.input.artifactId &&
          candidate.receipt.input.contentId === promotion.receipt.input.contentId
        )) throw new Error("The selected root promotion is no longer verified");
      } catch (error) {
        throw new CaptionProductionHostError(
          "stored_lineage_invalid",
          "The current-run source or accepted promotion changed while caption production was running",
          { cause: error },
        );
      }
      const derivation = executor.executionScope === "test_demo_only"
        ? "recorded_fixture_test_demo_only" as const
        : "current_run_source_execution" as const;
      const captionLines: CaptionProductionArtifact["lines"] = lines.map((line) => ({
        ...structuredClone(line),
        lineage: {
          derivation,
          source: {
            artifactId: input.sourceArtifactId,
            contentId: input.sourceContentId,
            window: { startMs: line.startMs, endMs: line.endMs },
          },
          acceptedChildOutput: structuredClone(input.acceptedChildOutput),
          rootPromotion: structuredClone(input.rootPromotion),
        },
      }));
      const caption: CaptionProductionArtifact = {
        schema: "studio.caption-production.artifact.v1",
        jobId,
        runId: this.ledger.runId,
        input,
        executor,
        lines: captionLines,
        result: deriveCaptionProductionResult(captionLines),
      };
      validateCaptionProductionArtifact(caption);
      const storedCaption = await this.artifacts.storeJson(caption);
      if (storedCaption.content.bytes > CAPTION_PRODUCTION_LIMITS.maxArtifactBytes) {
        throw new CaptionProductionHostError(
          "caption_limits_exceeded",
          "The canonical caption artifact exceeds its byte ceiling",
        );
      }
      const captionArtifactId = createCaptionArtifactId(
        this.ledger.runId,
        jobId,
        storedCaption.content.contentId,
      );
      const receiptBody = {
        jobId,
        authority: {
          approval: structuredClone(request.approval),
          verification: {
            integrity: "stored_review_and_verified_queued_intake" as const,
            producer: "host_publish_review_v1" as const,
            outcome: "approve_for_caption_production" as const,
            unrevokedAtStart: true as const,
          },
        },
        input: structuredClone(input),
        producer: {
          id: "studio.host-caption-production" as const,
          version: "1" as const,
          policy: "verified_unrevoked_approval_only" as const,
          executor: structuredClone(executor),
        },
        limits: structuredClone(CAPTION_PRODUCTION_LIMITS),
        result: {
          ...structuredClone(caption.result),
          captionArtifactId,
          captionContentId: storedCaption.content.contentId,
          captionBytes: storedCaption.content.bytes,
        },
      };
      const receipt: CaptionProductionReceipt = {
        schema: "studio.caption-production.receipt.v1",
        receiptId: `caption-production-receipt:${canonicalSha256(receiptBody)}`,
        ...receiptBody,
      };
      validateCaptionProductionReceipt(receipt);
      const storedReceipt = await this.artifacts.storeJson(receipt);
      if (
        canonicalJsonContentId(caption) !== storedCaption.content.contentId ||
        canonicalJsonContentId(receipt) !== storedReceipt.content.contentId ||
        storedReceipt.content.bytes > CAPTION_PRODUCTION_LIMITS.maxArtifactBytes
      ) throw new Error("Stored caption production changed its canonical content identity or byte bound");

      const built = this.artifacts.buildCaptionProductionArtifacts({
        runId: this.ledger.runId,
        caption,
        receipt,
        storedCaption,
        storedReceipt,
      });
      await this.artifacts.record(this.ledger, built.captionArtifact, jobId);
      await this.artifacts.record(this.ledger, built.receiptArtifact, jobId);
      await this.ledger.transact(
        {
          producer: { kind: "caption_production_host", id: "host-caption-production" },
          causationId: jobId,
        },
        () => ({
          pending: [{
            type: "caption.production_completed",
            data: {
              jobId,
              captionArtifactId: built.captionArtifact.id,
              captionContentId: storedCaption.content.contentId,
              receiptArtifactId: built.receiptArtifact.id,
              receiptContentId: storedReceipt.content.contentId,
              receipt,
            },
          }] satisfies PendingRuntimeEvent[],
          result: undefined,
        }),
      );
      return {
        caption,
        receipt,
        captionContentId: storedCaption.content.contentId,
        captionArtifactId: built.captionArtifact.id,
        receiptContentId: storedReceipt.content.contentId,
        receiptArtifactId: built.receiptArtifact.id,
      };
    } catch (error) {
      if (started && this.ledger.state().captionProductions[jobId]?.status === "started") {
        await this.ledger.transact(
          {
            producer: { kind: "caption_production_host", id: "host-caption-production" },
            causationId: jobId,
          },
          () => ({
            pending: [{
              type: "caption.production_failed",
              data: { jobId, reason: "Caption production failed closed within its bounded executor contract." },
            }] satisfies PendingRuntimeEvent[],
            result: undefined,
          }),
        );
      }
      if (error instanceof CaptionProductionHostError) throw error;
      throw new CaptionProductionHostError(
        "caption_executor_failed",
        "The bounded caption executor did not produce a valid immutable artifact",
        { cause: error },
      );
    }
  }
}
