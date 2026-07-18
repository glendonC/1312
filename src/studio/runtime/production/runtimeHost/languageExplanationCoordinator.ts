import { ContentAddressedArtifactStore } from "../artifactStore.ts";
import { FileEventJournal, RuntimeJournalConflict, RuntimeLedger } from "../journal.ts";
import {
  LanguageExplanationHost,
  LanguageExplanationHostError,
} from "../languageExplanations/languageExplanationHost.ts";
import type { LanguageExplanationExecutor } from "../languageExplanations/executor.ts";
import { LANGUAGE_EXPLANATION_INTERRUPTED_REASON } from "../model.ts";
import type { PendingRuntimeEvent } from "../protocol.ts";
import { assertLanguageExplanationRequest } from "../validation/languageExplanations.ts";
import { DurableRuntimeCommandStore } from "./commandStore.ts";
import { RuntimeHostError } from "./errors.ts";
import { RuntimeHostLifecycleCoordinator } from "./lifecycleCoordinator.ts";
import type { RuntimeHostLanguageExplanationResponse } from "./model.ts";
import { RuntimeMutationQueue } from "./runtimeMutationQueue.ts";
import { RuntimeHostQueries } from "./runtimeQueries.ts";
import { RuntimeSourceRegistry } from "./sourceRegistry.ts";

export interface RuntimeLanguageExplanationCoordinatorOptions {
  store: DurableRuntimeCommandStore;
  sources: RuntimeSourceRegistry;
  lifecycle: RuntimeHostLifecycleCoordinator;
  queries: RuntimeHostQueries;
  executor: LanguageExplanationExecutor;
  mutationQueue: RuntimeMutationQueue;
  now: () => Date;
}

/** Applies one exact-span explanation request over host-reopened production caption authority. */
export class RuntimeLanguageExplanationCoordinator {
  private readonly options: RuntimeLanguageExplanationCoordinatorOptions;

  constructor(options: RuntimeLanguageExplanationCoordinatorOptions) {
    this.options = options;
  }

  private rethrow(error: unknown): never {
    if (error instanceof RuntimeHostError) throw error;
    if (error instanceof LanguageExplanationHostError) {
      if (error.code === "language_explanation_executor_unavailable") {
        throw new RuntimeHostError("language_explanation_unavailable", error.message, 409, { cause: error });
      }
      if (error.code === "invalid_language_selection") {
        throw new RuntimeHostError("invalid_language_selection", error.message, 409, { cause: error });
      }
      if (
        error.code === "verified_current_caption_required" ||
        error.code === "unrevoked_caption_authority_required"
      ) {
        throw new RuntimeHostError("language_explanation_caption_authority_required", error.message, 409, { cause: error });
      }
      if (error.code === "language_explanation_executor_failed") {
        throw new RuntimeHostError("language_explanation_executor_failed", error.message, 502, { cause: error });
      }
      throw new RuntimeHostError(
        error.code === "stored_language_explanation_lineage_invalid"
          ? "stored_content_inconsistent"
          : "illegal_language_explanation_transition",
        error.message,
        409,
        { cause: error },
      );
    }
    throw new RuntimeHostError(
      "stored_content_inconsistent",
      "Language explanation could not be recorded against verified stored caption lineage.",
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
      const jobIds = Object.values(ledger.state().languageExplanations)
        .filter((attempt) => attempt.status === "started")
        .map((attempt) => attempt.jobId)
        .sort();
      if (jobIds.length === 0) return false;
      try {
        await ledger.transact(
          { producer: { kind: "recovery_host", id: "durable-language-explanation-recovery" }, causationId: "host-recovery" },
          ({ state }) => ({
            pending: jobIds
              .filter((jobId) => state.languageExplanations[jobId]?.status === "started")
              .map((jobId) => ({
                type: "language.explanation_failed" as const,
                data: { jobId, reason: LANGUAGE_EXPLANATION_INTERRUPTED_REASON },
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

  async create(runtimeId: string, value: unknown): Promise<RuntimeHostLanguageExplanationResponse> {
    let request;
    try {
      request = assertLanguageExplanationRequest(value);
    } catch (error) {
      throw new RuntimeHostError(
        "invalid_language_explanation_request",
        "The language-explanation request is invalid or contains open fields.",
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
        await new LanguageExplanationHost(
          ledger,
          new ContentAddressedArtifactStore(paths.artifactStoreRoot),
          this.options.executor,
          source.operator.rightsScope,
        ).produce(request);
      } catch (error) {
        this.rethrow(error);
      }
      return this.options.queries.languageExplanations(runtimeId);
    });
  }
}
