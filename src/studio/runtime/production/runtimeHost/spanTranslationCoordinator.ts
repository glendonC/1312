import { ContentAddressedArtifactStore } from "../artifactStore.ts";
import { FileEventJournal, RuntimeJournalConflict, RuntimeLedger } from "../journal.ts";
import {
  SpanTranslationHost,
  SpanTranslationHostError,
} from "../spanTranslations/spanTranslationHost.ts";
import type { SpanTranslationExecutor } from "../spanTranslations/executor.ts";
import { SPAN_TRANSLATION_INTERRUPTED_REASON } from "../model.ts";
import type { PendingRuntimeEvent } from "../protocol.ts";
import { assertSpanTranslationRequest } from "../validation/spanTranslations.ts";
import { DurableRuntimeCommandStore } from "./commandStore.ts";
import { RuntimeHostError } from "./errors.ts";
import { RuntimeHostLifecycleCoordinator } from "./lifecycleCoordinator.ts";
import type { RuntimeHostSpanTranslationResponse } from "./model.ts";
import { RuntimeMutationQueue } from "./runtimeMutationQueue.ts";
import { RuntimeHostQueries } from "./runtimeQueries.ts";
import { RuntimeSourceRegistry } from "./sourceRegistry.ts";

export interface RuntimeSpanTranslationCoordinatorOptions {
  store: DurableRuntimeCommandStore;
  sources: RuntimeSourceRegistry;
  lifecycle: RuntimeHostLifecycleCoordinator;
  queries: RuntimeHostQueries;
  executor: SpanTranslationExecutor;
  mutationQueue: RuntimeMutationQueue;
  now: () => Date;
}

/** Applies one exact-span translation request over host-reopened production caption authority. */
export class RuntimeSpanTranslationCoordinator {
  private readonly options: RuntimeSpanTranslationCoordinatorOptions;

  constructor(options: RuntimeSpanTranslationCoordinatorOptions) {
    this.options = options;
  }

  private rethrow(error: unknown): never {
    if (error instanceof RuntimeHostError) throw error;
    if (error instanceof SpanTranslationHostError) {
      if (error.code === "span_translation_executor_unavailable") {
        throw new RuntimeHostError("span_translation_unavailable", error.message, 409, { cause: error });
      }
      if (error.code === "invalid_span_selection") {
        throw new RuntimeHostError("invalid_span_translation_selection", error.message, 409, { cause: error });
      }
      if (
        error.code === "verified_current_caption_required" ||
        error.code === "unrevoked_caption_authority_required"
      ) {
        throw new RuntimeHostError("span_translation_caption_authority_required", error.message, 409, { cause: error });
      }
      if (error.code === "span_translation_executor_failed") {
        throw new RuntimeHostError("span_translation_executor_failed", error.message, 502, { cause: error });
      }
      throw new RuntimeHostError(
        error.code === "stored_span_translation_lineage_invalid"
          ? "stored_content_inconsistent"
          : "illegal_span_translation_transition",
        error.message,
        409,
        { cause: error },
      );
    }
    throw new RuntimeHostError(
      "stored_content_inconsistent",
      "Span translation could not be recorded against verified stored caption lineage.",
      409,
      { cause: error },
    );
  }

  async recoverInterrupted(runtimeId: string): Promise<boolean> {
    const record = await this.options.store.findByRuntimeId(runtimeId);
    if (!record) return false;
    const paths = this.options.store.paths(runtimeId);
    for (let recoveryAttempt = 0; recoveryAttempt < 3; recoveryAttempt += 1) {
      const ledger = await RuntimeLedger.open(
        runtimeId,
        new FileEventJournal(paths.journalPath),
        { now: this.options.now },
      );
      const jobIds = Object.values(ledger.state().spanTranslations)
        .filter((attempt) => attempt.status === "started")
        .map((attempt) => attempt.jobId)
        .sort();
      if (jobIds.length === 0) return false;
      try {
        await ledger.transact(
          { producer: { kind: "recovery_host", id: "durable-span-translation-recovery" }, causationId: "host-recovery" },
          ({ state }) => ({
            pending: jobIds
              .filter((jobId) => state.spanTranslations[jobId]?.status === "started")
              .map((jobId) => ({
                type: "translation.span_failed" as const,
                data: { jobId, reason: SPAN_TRANSLATION_INTERRUPTED_REASON },
              })) satisfies PendingRuntimeEvent[],
            result: undefined,
          }),
        );
        return true;
      } catch (error) {
        if (!(error instanceof RuntimeJournalConflict) || recoveryAttempt === 2) throw error;
      }
    }
    return false;
  }

  async create(runtimeId: string, value: unknown): Promise<RuntimeHostSpanTranslationResponse> {
    let request;
    try {
      request = assertSpanTranslationRequest(value);
    } catch (error) {
      throw new RuntimeHostError(
        "invalid_span_translation_request",
        "The span-translation request is invalid or contains open fields.",
        400,
        { cause: error },
      );
    }
    return this.options.mutationQueue.run(runtimeId, async () => {
      const record = await this.options.store.findByRuntimeId(runtimeId);
      if (!record) throw new RuntimeHostError("unknown_runtime", "The runtime identity is unknown.", 404);
      await this.options.lifecycle.reconcile(record, false);
      const source = await this.options.sources.resolve(record.sourceSessionId, record.sourceRevisionId);
      const paths = this.options.store.paths(runtimeId);
      try {
        const ledger = await RuntimeLedger.open(
          runtimeId,
          new FileEventJournal(paths.journalPath),
          { now: this.options.now },
        );
        await new SpanTranslationHost(
          ledger,
          new ContentAddressedArtifactStore(paths.artifactStoreRoot),
          this.options.executor,
          source.operator.rightsScope,
        ).produce(request);
      } catch (error) {
        this.rethrow(error);
      }
      return this.options.queries.spanTranslations(runtimeId);
    });
  }
}
