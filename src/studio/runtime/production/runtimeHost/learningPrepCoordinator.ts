import { ContentAddressedArtifactStore } from "../artifactStore.ts";
import { FileEventJournal, RuntimeJournalConflict, RuntimeLedger } from "../journal.ts";
import {
  LearningPrepHost,
  LearningPrepHostError,
} from "../learningPrep/learningPrepHost.ts";
import type { LearningPrepExecutor } from "../learningPrep/executor.ts";
import { LEARNING_PREP_INTERRUPTED_REASON } from "../model.ts";
import type { PendingRuntimeEvent } from "../protocol.ts";
import { assertLearningPrepRequest } from "../validation/learningPrep.ts";
import { DurableRuntimeCommandStore } from "./commandStore.ts";
import { RuntimeHostError } from "./errors.ts";
import { RuntimeHostLifecycleCoordinator } from "./lifecycleCoordinator.ts";
import type { RuntimeHostLearningPrepResponse } from "./model.ts";
import { RuntimeMutationQueue } from "./runtimeMutationQueue.ts";
import { RuntimeHostQueries } from "./runtimeQueries.ts";
import { RuntimeSourceRegistry } from "./sourceRegistry.ts";

export interface RuntimeLearningPrepCoordinatorOptions {
  store: DurableRuntimeCommandStore;
  sources: RuntimeSourceRegistry;
  lifecycle: RuntimeHostLifecycleCoordinator;
  queries: RuntimeHostQueries;
  executor: LearningPrepExecutor;
  mutationQueue: RuntimeMutationQueue;
  now: () => Date;
}

/** Applies one typed fine-tune learning-prep request over host-reopened production caption authority. */
export class RuntimeLearningPrepCoordinator {
  private readonly options: RuntimeLearningPrepCoordinatorOptions;

  constructor(options: RuntimeLearningPrepCoordinatorOptions) {
    this.options = options;
  }

  private rethrow(error: unknown): never {
    if (error instanceof RuntimeHostError) throw error;
    if (error instanceof LearningPrepHostError) {
      if (error.code === "learning_prep_executor_unavailable") {
        throw new RuntimeHostError("learning_prep_unavailable", error.message, 409, { cause: error });
      }
      if (
        error.code === "verified_current_caption_required" ||
        error.code === "unrevoked_caption_authority_required"
      ) {
        throw new RuntimeHostError("learning_prep_caption_authority_required", error.message, 409, { cause: error });
      }
      if (error.code === "learning_prep_executor_failed") {
        throw new RuntimeHostError("learning_prep_executor_failed", error.message, 502, { cause: error });
      }
      throw new RuntimeHostError(
        error.code === "stored_learning_prep_lineage_invalid"
          ? "stored_content_inconsistent"
          : "illegal_learning_prep_transition",
        error.message,
        409,
        { cause: error },
      );
    }
    throw new RuntimeHostError(
      "stored_content_inconsistent",
      "Learning prep could not be recorded against verified stored caption lineage.",
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
      const jobIds = Object.values(ledger.state().learningPreps)
        .filter((attempt) => attempt.status === "started")
        .map((attempt) => attempt.jobId)
        .sort();
      if (jobIds.length === 0) return false;
      try {
        await ledger.transact(
          { producer: { kind: "recovery_host", id: "durable-learning-prep-recovery" }, causationId: "host-recovery" },
          ({ state }) => ({
            pending: jobIds
              .filter((jobId) => state.learningPreps[jobId]?.status === "started")
              .map((jobId) => ({
                type: "learning.prep_failed" as const,
                data: { jobId, reason: LEARNING_PREP_INTERRUPTED_REASON },
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

  async create(runtimeId: string, value: unknown): Promise<RuntimeHostLearningPrepResponse> {
    let request;
    try {
      request = assertLearningPrepRequest(value);
    } catch (error) {
      throw new RuntimeHostError(
        "invalid_learning_prep_request",
        "The learning-prep request is invalid or contains open fields.",
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
        await new LearningPrepHost(
          ledger,
          new ContentAddressedArtifactStore(paths.artifactStoreRoot),
          this.options.executor,
          source.operator.rightsScope,
        ).produce(request);
      } catch (error) {
        this.rethrow(error);
      }
      return this.options.queries.learningPreps(runtimeId);
    });
  }
}
