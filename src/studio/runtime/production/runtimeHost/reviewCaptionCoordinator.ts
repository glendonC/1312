import { join } from "node:path";

import { ContentAddressedArtifactStore } from "../artifactStore.ts";
import {
  CaptionProductionHost,
  CaptionProductionHostError,
} from "../captions/captionProductionHost.ts";
import type { CaptionProductionExecutor } from "../captions/captionProductionExecutor.ts";
import {
  CaptionQualityControlHost,
  CaptionQualityControlHostError,
} from "../captions/captionQualityControlHost.ts";
import { FileEventJournal, RuntimeLedger } from "../journal.ts";
import type { PublishReviewOperator } from "../model.ts";
import {
  PublishReviewHost,
  PublishReviewHostError,
} from "../review/publishReviewHost.ts";
import { assertCaptionProductionRequest } from "../validation/captionProduction.ts";
import { assertCaptionQualityControlRequest } from "../validation/captionQualityControl.ts";
import {
  assertPublishReviewDecisionRequest,
  assertPublishReviewRevocationRequest,
} from "../validation/publishReviewDecision.ts";
import type {
  RuntimeHostCaptionProductionResponse,
  RuntimeHostCaptionQualityControlResponse,
  RuntimeHostPublishReviewDecisionResponse,
} from "./model.ts";
import { DurableRuntimeCommandStore } from "./commandStore.ts";
import { RuntimeHostError } from "./errors.ts";
import { RuntimeHostLifecycleCoordinator } from "./lifecycleCoordinator.ts";
import { RuntimeHostQueries } from "./runtimeQueries.ts";
import { RuntimeSourceRegistry } from "./sourceRegistry.ts";
import { RuntimeMutationQueue } from "./runtimeMutationQueue.ts";

export interface RuntimeReviewCaptionCoordinatorOptions {
  store: DurableRuntimeCommandStore;
  sources: RuntimeSourceRegistry;
  lifecycle: RuntimeHostLifecycleCoordinator;
  queries: RuntimeHostQueries;
  reviewer: PublishReviewOperator;
  captionExecutor: CaptionProductionExecutor;
  now: () => Date;
  mutationQueue?: RuntimeMutationQueue;
}

/** Serializes and applies review/caption mutations over verified runtime lineage. */
export class RuntimeReviewCaptionCoordinator {
  private readonly store: DurableRuntimeCommandStore;
  private readonly sources: RuntimeSourceRegistry;
  private readonly lifecycle: RuntimeHostLifecycleCoordinator;
  private readonly queries: RuntimeHostQueries;
  private readonly reviewer: PublishReviewOperator;
  private readonly captionExecutor: CaptionProductionExecutor;
  private readonly now: () => Date;
  private readonly mutationQueue: RuntimeMutationQueue;

  constructor(options: RuntimeReviewCaptionCoordinatorOptions) {
    this.store = options.store;
    this.sources = options.sources;
    this.lifecycle = options.lifecycle;
    this.queries = options.queries;
    this.reviewer = options.reviewer;
    this.captionExecutor = options.captionExecutor;
    this.now = options.now;
    this.mutationQueue = options.mutationQueue ?? new RuntimeMutationQueue();
  }

  private async withMutation<T>(runtimeId: string, operation: () => Promise<T>): Promise<T> {
    return this.mutationQueue.run(runtimeId, operation);
  }

  private rethrowReviewHostError(error: unknown): never {
    if (error instanceof PublishReviewHostError) {
      if (error.code === "reviewer_identity_mismatch") {
        throw new RuntimeHostError(
          "reviewer_identity_mismatch",
          "The attested reviewer identity does not match this host's configured review operator.",
          403,
          { cause: error },
        );
      }
      if (error.code === "stored_lineage_invalid") {
        throw new RuntimeHostError(
          "stored_content_inconsistent",
          "Stored publish-review lineage failed closed verification.",
          409,
          { cause: error },
        );
      }
      throw new RuntimeHostError(
        "illegal_review_transition",
        error.message,
        409,
        { cause: error },
      );
    }
    throw new RuntimeHostError(
      "stored_content_inconsistent",
      "The publish-review receipt could not be recorded against verified stored lineage.",
      409,
      { cause: error },
    );
  }

  private rethrowCaptionHostError(error: unknown): never {
    if (error instanceof RuntimeHostError) throw error;
    if (error instanceof CaptionProductionHostError) {
      if (error.code === "stored_lineage_invalid") {
        throw new RuntimeHostError(
          "stored_content_inconsistent",
          "Stored caption authority or source lineage failed closed verification.",
          409,
          { cause: error },
        );
      }
      if (error.code === "verified_unrevoked_approval_required") {
        throw new RuntimeHostError(
          "caption_authority_required",
          error.message,
          409,
          { cause: error },
        );
      }
      if (error.code === "verified_study_readiness_required" || error.code === "current_run_caption_executor_required") {
        throw new RuntimeHostError(
          "caption_current_run_causality_required",
          error.message,
          409,
          { cause: error },
        );
      }
      throw new RuntimeHostError(
        "illegal_caption_transition",
        error.message,
        409,
        { cause: error },
      );
    }
    throw new RuntimeHostError(
      "stored_content_inconsistent",
      "Caption production could not be recorded against verified stored lineage.",
      409,
      { cause: error },
    );
  }

  private rethrowCaptionQualityControlHostError(error: unknown): never {
    if (error instanceof CaptionQualityControlHostError) {
      throw new RuntimeHostError(
        error.code === "stored_lineage_invalid" ? "stored_content_inconsistent" : "illegal_caption_qc_transition",
        error.message,
        409,
        { cause: error },
      );
    }
    throw new RuntimeHostError(
      "stored_content_inconsistent",
      "Caption QC could not be recorded against verified stored candidate lineage.",
      409,
      { cause: error },
    );
  }

  async createPublishReviewDecision(
    runtimeId: string,
    value: unknown,
  ): Promise<RuntimeHostPublishReviewDecisionResponse> {
    let request;
    try {
      request = assertPublishReviewDecisionRequest(value);
    } catch (error) {
      throw new RuntimeHostError(
        "invalid_review_request",
        "The publish-review decision request is invalid or contains open fields.",
        400,
        { cause: error },
      );
    }
    return this.withMutation(runtimeId, async () => {
      const record = await this.store.findByRuntimeId(runtimeId);
      if (!record) throw new RuntimeHostError("unknown_runtime", "The runtime identity is unknown.", 404);
      await this.lifecycle.reconcile(record, false);
      const paths = this.store.paths(runtimeId);
      try {
        const ledger = await RuntimeLedger.open(runtimeId, new FileEventJournal(paths.journalPath), { now: this.now });
        await new PublishReviewHost(
          ledger,
          new ContentAddressedArtifactStore(paths.artifactStoreRoot),
          this.reviewer,
        ).decide(request);
      } catch (error) {
        this.rethrowReviewHostError(error);
      }
      return this.queries.publishReviewDecisions(runtimeId);
    });
  }

  async createPublishReviewRevocation(
    runtimeId: string,
    value: unknown,
  ): Promise<RuntimeHostPublishReviewDecisionResponse> {
    let request;
    try {
      request = assertPublishReviewRevocationRequest(value);
    } catch (error) {
      throw new RuntimeHostError(
        "invalid_review_request",
        "The publish-review revocation request is invalid or contains open fields.",
        400,
        { cause: error },
      );
    }
    return this.withMutation(runtimeId, async () => {
      const record = await this.store.findByRuntimeId(runtimeId);
      if (!record) throw new RuntimeHostError("unknown_runtime", "The runtime identity is unknown.", 404);
      await this.lifecycle.reconcile(record, false);
      const paths = this.store.paths(runtimeId);
      try {
        const ledger = await RuntimeLedger.open(runtimeId, new FileEventJournal(paths.journalPath), { now: this.now });
        await new PublishReviewHost(
          ledger,
          new ContentAddressedArtifactStore(paths.artifactStoreRoot),
          this.reviewer,
        ).revoke(request);
      } catch (error) {
        this.rethrowReviewHostError(error);
      }
      return this.queries.publishReviewDecisions(runtimeId);
    });
  }

  async createCaptionQualityControl(
    runtimeId: string,
    value: unknown,
  ): Promise<RuntimeHostCaptionQualityControlResponse> {
    let request;
    try {
      request = assertCaptionQualityControlRequest(value);
    } catch (error) {
      throw new RuntimeHostError(
        "invalid_caption_qc_request",
        "The caption QC request is invalid or contains open fields.",
        400,
        { cause: error },
      );
    }
    return this.withMutation(runtimeId, async () => {
      const record = await this.store.findByRuntimeId(runtimeId);
      if (!record) throw new RuntimeHostError("unknown_runtime", "The runtime identity is unknown.", 404);
      await this.lifecycle.reconcile(record, false);
      const paths = this.store.paths(runtimeId);
      try {
        const ledger = await RuntimeLedger.open(runtimeId, new FileEventJournal(paths.journalPath), { now: this.now });
        await new CaptionQualityControlHost(
          ledger,
          new ContentAddressedArtifactStore(paths.artifactStoreRoot),
        ).decide(request);
      } catch (error) {
        this.rethrowCaptionQualityControlHostError(error);
      }
      return this.queries.captionQualityControls(runtimeId);
    });
  }

  async createCaptionProduction(
    runtimeId: string,
    value: unknown,
  ): Promise<RuntimeHostCaptionProductionResponse> {
    let request;
    try {
      request = assertCaptionProductionRequest(value);
    } catch (error) {
      throw new RuntimeHostError(
        "invalid_caption_request",
        "The caption-production request is invalid or contains open fields.",
        400,
        { cause: error },
      );
    }
    return this.withMutation(runtimeId, async () => {
      const record = await this.store.findByRuntimeId(runtimeId);
      if (!record) throw new RuntimeHostError("unknown_runtime", "The runtime identity is unknown.", 404);
      await this.lifecycle.reconcile(record, false);
      const start = await this.lifecycle.readStartReceipt(record);
      if (!start) {
        throw new RuntimeHostError(
          "stored_content_inconsistent",
          "Caption production requires an immutable runtime-start receipt.",
          409,
        );
      }
      const loadedSource = await this.sources.resolve(record.sourceSessionId, record.sourceRevisionId);
      const paths = this.store.paths(runtimeId);
      try {
        const ledger = await RuntimeLedger.open(runtimeId, new FileEventJournal(paths.journalPath), { now: this.now });
        const artifacts = new ContentAddressedArtifactStore(paths.artifactStoreRoot);
        const source = ledger.state().artifacts[start.record.sourceArtifactId];
        if (!source || source.origin.kind !== "ingest") {
          throw new Error("The runtime source artifact is missing from the production ledger");
        }
        const sourcePath = await artifacts.resolveVerified(source);
        const produced = await new CaptionProductionHost(
          ledger,
          artifacts,
          this.captionExecutor,
          {
            sourcePath,
            fixtureCaptionPath: join(loadedSource.directory, "captions.json"),
            sourceArtifactId: source.id,
            sourceContentId: source.content.contentId,
            analysisRequest: start.record.analysisRequest,
          },
        ).produce(request);
        try {
          await new CaptionQualityControlHost(ledger, artifacts).decide({
            candidate: {
              jobId: produced.caption.jobId,
              captionArtifactId: produced.captionArtifactId,
              captionContentId: produced.captionContentId,
              captionReceiptId: produced.receipt.receiptId,
              captionReceiptContentId: produced.receiptContentId,
            },
          });
        } catch (error) {
          this.rethrowCaptionQualityControlHostError(error);
        }
      } catch (error) {
        this.rethrowCaptionHostError(error);
      }
      return this.queries.captionProductions(runtimeId);
    });
  }
}
