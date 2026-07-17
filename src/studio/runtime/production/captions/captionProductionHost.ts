import {
  canonicalJsonContentId,
  canonicalSha256,
  ContentAddressedArtifactStore,
  createCaptionArtifactId,
} from "../artifactStore.ts";
import type { CaptionProductionExecutor, CaptionExecutorInput } from "./captionProductionExecutor.ts";
import {
  captionLineReceiptProjection,
  captionStudyIdentity,
  closeGeneralizedCaptionLineCausality,
  closeCaptionLineCausality,
  enforceCaptionDialogueScope,
  generalizedCaptionStudyIdentity,
} from "./captionStudyCausality.ts";
import type { RuntimeLedger } from "../journal.ts";
import type {
  CaptionProductionArtifact,
  CaptionProductionReceipt,
  CaptionProductionRequest,
  ProductionAnalysisRequest,
} from "../model.ts";
import { CAPTION_PRODUCTION_LIMITS } from "../model.ts";
import { reopenPublishReviewDecisions } from "../review/publishReviewDecisionAudit.ts";
import { reopenStudyReadiness } from "../study/studyReadinessAudit.ts";
import { reopenOwnedMediaStudy } from "../study/studySynthesisAudit.ts";
import { GeneralizedStudyReadinessHost } from "../study/generalizedStudyReadinessHost.ts";
import type { GeneralizedStudySynthesisResult } from "../study/generalizedStudySynthesisHost.ts";
import { generalizedReadinessReference } from "../study/generalizedStudyRuntime.ts";
import { GeneralizedCaptionCausalityHost } from "./generalizedCaptionCausality.ts";
import type { PendingRuntimeEvent } from "../protocol.ts";
import {
  assertCaptionProductionRequest,
  deriveCaptionProductionResult,
  validateCaptionProductionArtifact,
  validateCaptionProductionReceipt,
} from "../validation/captionProduction.ts";

export type CaptionProductionHostErrorCode =
  | "verified_unrevoked_approval_required"
  | "verified_study_readiness_required"
  | "current_run_caption_executor_required"
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
    const generalizedRecord = state.generalizedStudyReadiness[approval.readiness.readinessId] ?? null;
    let readiness: Awaited<ReturnType<typeof reopenStudyReadiness>> | null = null;
    let study: Awaited<ReturnType<typeof reopenOwnedMediaStudy>> | null = null;
    let generalizedReadiness: Awaited<ReturnType<GeneralizedStudyReadinessHost["reopen"]>> | null = null;
    let generalizedStudy: GeneralizedStudySynthesisResult | null = null;
    try {
      if (generalizedRecord) {
        generalizedReadiness = await new GeneralizedStudyReadinessHost(state, this.artifacts)
          .reopen(generalizedReadinessReference(generalizedRecord));
        generalizedStudy = generalizedReadiness.reopenedStudy;
        if (!generalizedStudy || generalizedRecord.artifactId !== approval.readiness.artifactId ||
            generalizedReadiness.readinessId !== approval.readiness.readinessId ||
            generalizedReadiness.receiptId !== approval.readiness.receiptId ||
            generalizedReadiness.receiptContentId !== approval.readiness.receiptContentId ||
            generalizedReadiness.receipt.result.outcome !== "proceed_to_caption_review") {
          throw new Error("The approval does not resolve to one exact generalized proceed-to-caption-review receipt");
        }
      } else {
        readiness = await reopenStudyReadiness(state, this.artifacts, approval.readiness.readinessId);
        if (
          readiness.readinessId !== approval.readiness.readinessId ||
          readiness.artifactId !== approval.readiness.artifactId ||
          readiness.receiptId !== approval.readiness.receiptId ||
          readiness.receiptContentId !== approval.readiness.receiptContentId ||
          readiness.receipt.result.outcome !== "proceed_to_caption_review"
        ) throw new Error("The approval does not resolve to one exact proceed-to-caption-review receipt");
        study = await reopenOwnedMediaStudy(state, this.artifacts, readiness.receipt.input.studyId);
      }
    } catch (error) {
      throw new CaptionProductionHostError(
        "verified_study_readiness_required",
        "Caption production requires the approval's exact recursively verified proceed-to-caption-review study readiness",
        { cause: error },
      );
    }
    const studyIdentity = generalizedStudy
      ? generalizedCaptionStudyIdentity(generalizedStudy)
      : captionStudyIdentity(study!);
    const generalizedRootTask = generalizedStudy ? state.tasks[generalizedStudy.envelope.root.taskId] : null;
    const matchesGeneralized = generalizedStudy && generalizedReadiness &&
      generalizedReadiness.receipt.input.artifactId === studyIdentity.artifactId &&
      generalizedReadiness.receipt.input.contentId === studyIdentity.contentId &&
      generalizedStudy.envelope.root.source.artifactId === source.id &&
      generalizedStudy.envelope.root.source.contentId === source.content.contentId &&
      generalizedRootTask?.jobContext.analysisRequest.requestId === analysis.requestId &&
      generalizedRootTask.jobContext.analysisRequest.requestedRange.startMs === analysis.range.startMs &&
      generalizedRootTask.jobContext.analysisRequest.requestedRange.endMs === analysis.range.endMs &&
      generalizedStudy.envelope.sourceArtifacts.some((candidate) => candidate.artifactId === source.id && candidate.contentId === source.content.contentId);
    const matchesLegacy = study && readiness &&
      readiness.receipt.input.artifactId === studyIdentity.artifactId &&
      readiness.receipt.input.contentId === studyIdentity.contentId &&
      readiness.receipt.input.executorReceiptId === studyIdentity.executorReceiptId &&
      readiness.receipt.input.executorReceiptContentId === studyIdentity.executorReceiptContentId &&
      study.envelope.root.jobContext.source.artifactId === source.id &&
      study.envelope.root.jobContext.source.contentId === source.content.contentId &&
      study.envelope.root.jobContext.analysisRequest.requestId === analysis.requestId &&
      study.envelope.root.jobContext.analysisRequest.requestedRange.startMs === analysis.range.startMs &&
      study.envelope.root.jobContext.analysisRequest.requestedRange.endMs === analysis.range.endMs &&
      study.envelope.sourceArtifacts.some((candidate) => candidate.artifactId === source.id && candidate.contentId === source.content.contentId);
    if (!matchesGeneralized && !matchesLegacy) {
      throw new CaptionProductionHostError(
        "verified_study_readiness_required",
        "The approved study/readiness does not match the immutable current-run source and analysis scope",
      );
    }
    if (executor.executionScope !== "current_run") {
      throw new CaptionProductionHostError(
        "current_run_caption_executor_required",
        "Recorded caption fixtures cannot consume current-run study authority and are refused for production",
      );
    }

    const jobId = `caption-production:${canonicalSha256({
      runId: this.ledger.runId,
      approval: request.approval,
      readiness: approval.readiness,
      study: studyIdentity,
    })}`;
    const input: CaptionProductionArtifact["input"] = {
      sourceArtifactId: source.id,
      sourceContentId: source.content.contentId,
      analysisRequestId: analysis.requestId,
      range: structuredClone(analysis.range),
      sourceLanguage: "ko",
      targetLanguage: "en",
      study: studyIdentity,
      readiness: structuredClone(approval.readiness),
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
      await this.ledger.refresh();
      const executorAfter = await this.executor.describe(executorInput);
      if (canonicalSha256(executorAfter) !== canonicalSha256(executor)) {
        throw new CaptionProductionHostError(
          "stored_lineage_invalid",
          "Caption executor evidence changed while the bounded job was running",
        );
      }
      try {
        await this.artifacts.resolveVerified(source);
        const currentState = this.ledger.state();
        const currentEvents = await this.ledger.events();
        const reviewsAfter = await reopenPublishReviewDecisions(currentState, currentEvents, this.artifacts);
        const approvalAfter = reviewsAfter.find((candidate) =>
          candidate.reviewId === request.approval.reviewId &&
          candidate.artifactId === request.approval.artifactId &&
          candidate.receiptId === request.approval.receiptId &&
          candidate.receiptContentId === request.approval.receiptContentId);
        if (!approvalAfter || approvalAfter.state !== "approved_for_caption_production" || approvalAfter.revocation !== null) {
          throw new Error("The approval was revoked while caption production was active");
        }
        if (generalizedRecord) {
          const readinessAfter = await new GeneralizedStudyReadinessHost(currentState, this.artifacts)
            .reopen(generalizedReadinessReference(currentState.generalizedStudyReadiness[approval.readiness.readinessId]));
          if (canonicalSha256(approvalAfter.readiness) !== canonicalSha256(approval.readiness) ||
              canonicalSha256(readinessAfter.receipt) !== canonicalSha256(generalizedReadiness!.receipt) ||
              !readinessAfter.reopenedStudy || canonicalSha256(generalizedCaptionStudyIdentity(readinessAfter.reopenedStudy)) !== canonicalSha256(studyIdentity)) {
            throw new Error("The approved generalized study/readiness changed while caption production was active");
          }
        } else {
          const readinessAfter = await reopenStudyReadiness(currentState, this.artifacts, approval.readiness.readinessId);
          const studyAfter = await reopenOwnedMediaStudy(currentState, this.artifacts, study!.record.id);
          if (canonicalSha256(approvalAfter.readiness) !== canonicalSha256(approval.readiness) ||
              canonicalSha256(readinessAfter.receipt) !== canonicalSha256(readiness!.receipt) ||
              canonicalSha256(captionStudyIdentity(studyAfter)) !== canonicalSha256(studyIdentity)) {
            throw new Error("The approved study/readiness changed while caption production was active");
          }
        }
      } catch (error) {
        throw new CaptionProductionHostError(
          "stored_lineage_invalid",
          "The current-run source, study/readiness, or approval authority changed while caption production was running",
          { cause: error },
        );
      }
      const derivation = "current_run_source_execution" as const;
      const captionLines: CaptionProductionArtifact["lines"] = generalizedStudy && generalizedReadiness
        ? await Promise.all(lines.map(async (line) => {
          if (line.source.state !== "available" || line.target.state !== "available" || line.source.text === null || line.target.text === null) {
            throw new Error("Generalized caption production requires current-run source and target text before causal authorization");
          }
          const covering = generalizedStudy.envelope.coverage.filter((entry) => entry.startMs <= line.startMs && entry.endMs >= line.endMs);
          if (covering.length !== 1) throw new Error("Generalized caption line has no unique study coverage range");
          const causality = await new GeneralizedCaptionCausalityHost(this.ledger.state(), this.artifacts).close({
            readiness: generalizedReadinessReference(generalizedRecord!),
            range: { artifactId: covering[0].artifactId, trackId: covering[0].trackId, startMs: line.startMs, endMs: line.endMs },
            sourceText: line.source.text,
            targetText: line.target.text,
          });
          return closeGeneralizedCaptionLineCausality({
            line, state: this.ledger.state(), study: generalizedStudy!, studyIdentity, causality,
            readiness: approval.readiness, approval: request.approval,
            source: { artifactId: input.sourceArtifactId, contentId: input.sourceContentId },
            executor: { jobId, id: executor.id, version: executor.version, executionScope: executor.executionScope, cognitionClaim: executor.cognitionClaim },
            derivation,
          });
        }))
        : lines.map((line) => enforceCaptionDialogueScope(closeCaptionLineCausality({
          line,
          study: study!,
          studyIdentity,
          readiness: approval.readiness,
          approval: request.approval,
          source: { artifactId: input.sourceArtifactId, contentId: input.sourceContentId },
          executor: {
            jobId,
            id: executor.id,
            version: executor.version,
            executionScope: executor.executionScope,
            cognitionClaim: executor.cognitionClaim,
          },
          derivation,
        }), readiness!.receipt.dialogueScopePolicy));
      const caption: CaptionProductionArtifact = {
        schema: generalizedStudy
          ? "studio.caption-production.artifact.v3"
          : readiness!.receipt.dialogueScopePolicy
          ? "studio.caption-production.artifact.v2"
          : "studio.caption-production.artifact.v1",
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
            readiness: structuredClone(approval.readiness),
            study: structuredClone(studyIdentity),
            unrevokedAtStart: true as const,
          },
        },
        input: structuredClone(input),
        producer: {
          id: "studio.host-caption-production" as const,
          version: generalizedStudy ? "3" as const : readiness!.receipt.dialogueScopePolicy ? "2" as const : "1" as const,
          policy: generalizedStudy
            ? "verified_unrevoked_approval_and_generalized_causality_v3_only" as const
            : readiness!.receipt.dialogueScopePolicy
              ? "verified_unrevoked_approval_and_dialogue_scope_only" as const
              : "verified_unrevoked_approval_only" as const,
          executor: structuredClone(executor),
        },
        limits: structuredClone(CAPTION_PRODUCTION_LIMITS),
        result: {
          ...structuredClone(caption.result),
          captionArtifactId,
          captionContentId: storedCaption.content.contentId,
          captionBytes: storedCaption.content.bytes,
          lines: captionLines.map(captionLineReceiptProjection),
        },
      };
      const receipt: CaptionProductionReceipt = {
        schema: generalizedStudy
          ? "studio.caption-production.receipt.v3"
          : readiness!.receipt.dialogueScopePolicy
          ? "studio.caption-production.receipt.v2"
          : "studio.caption-production.receipt.v1",
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
        ({ state: current }) => {
          if (Object.values(current.publishReviewRevocations).some((revocation) =>
            revocation.reviewId === approval.reviewId && revocation.status !== "failed")) {
            throw new CaptionProductionHostError(
              "verified_unrevoked_approval_required",
              "Caption production cannot complete after approval revocation has started",
            );
          }
          return { pending: [{
            type: "caption.production_completed",
            data: {
              jobId,
              captionArtifactId: built.captionArtifact.id,
              captionContentId: storedCaption.content.contentId,
              receiptArtifactId: built.receiptArtifact.id,
              receiptContentId: storedReceipt.content.contentId,
              receipt,
            },
          }] satisfies PendingRuntimeEvent[], result: undefined };
        },
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
