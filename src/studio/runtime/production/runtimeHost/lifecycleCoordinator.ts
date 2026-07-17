import { readFile, stat } from "node:fs/promises";

import { identifyFile } from "../artifactStore.ts";
import { FileEventJournal, RuntimeJournalConflict, RuntimeLedger } from "../journal.ts";
import type { RuntimeStartRecord } from "../model.ts";
import { interruptAmbiguousRuntime } from "../recovery.ts";
import { assertRuntimeStartRecord } from "../runStartValidation.ts";
import { RuntimeHostError } from "./errors.ts";
import { lifecycleFromRuntimeEvidence, readValidatedRuntimeJournal } from "./journalPolling.ts";
import type { RuntimeHostCommandRecord, RuntimeHostFailureReason, RuntimeHostStatus } from "./model.ts";
import { DurableRuntimeCommandStore } from "./commandStore.ts";

export function terminal(lifecycle: RuntimeHostCommandRecord["lifecycle"]): boolean {
  return lifecycle === "terminal" || lifecycle === "failed" || lifecycle === "interrupted";
}

async function exists(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

export class RuntimeHostLifecycleCoordinator {
  private readonly store: DurableRuntimeCommandStore;
  private readonly now: () => Date;
  private readonly transitionTails = new Map<string, Promise<RuntimeHostCommandRecord>>();

  constructor(
    store: DurableRuntimeCommandStore,
    now: () => Date,
  ) {
    this.store = store;
    this.now = now;
  }

  async replaceLifecycle(
    record: RuntimeHostCommandRecord,
    lifecycle: RuntimeHostCommandRecord["lifecycle"],
    reason: RuntimeHostFailureReason | null,
    journalHead = record.journalHead,
    receipt?: RuntimeStartRecord,
    receiptContentId?: string,
  ): Promise<RuntimeHostCommandRecord> {
    const previous = this.transitionTails.get(record.commandId) ?? Promise.resolve(record);
    const transition = previous.catch(() => record).then(async () => {
      const latest = (await this.store.read(record.commandId)) ?? record;
      if (terminal(latest.lifecycle) && (lifecycle === "accepted" || lifecycle === "initializing" || lifecycle === "running")) {
        return latest;
      }
      const next: RuntimeHostCommandRecord = {
        ...latest,
        lifecycle,
        lastTransitionAt: this.now().toISOString(),
        reason,
        journalHead: Math.max(latest.journalHead, journalHead),
        ...(receipt && receiptContentId
          ? {
              runStartReceiptContentId: receiptContentId,
              forecastContentId: receipt.forecast.content.contentId,
              frozenForecastId: receipt.frozenForecast.freezeId,
            }
          : {}),
      };
      return this.store.replace(next);
    });
    this.transitionTails.set(record.commandId, transition);
    try {
      return await transition;
    } finally {
      if (this.transitionTails.get(record.commandId) === transition) this.transitionTails.delete(record.commandId);
    }
  }

  async readStartReceipt(record: RuntimeHostCommandRecord): Promise<{
    record: RuntimeStartRecord;
    contentId: string;
  } | null> {
    const path = this.store.paths(record.runtimeId).runStartPath;
    if (!(await exists(path))) {
      if (record.runStartReceiptContentId === null) return null;
      throw new RuntimeHostError(
        "stored_content_inconsistent",
        "The durable command references a missing run-start receipt.",
        409,
      );
    }
    let value: unknown;
    try {
      value = JSON.parse(await readFile(path, "utf8")) as unknown;
      assertRuntimeStartRecord(value, "Runtime host run-start receipt");
    } catch (error) {
      throw new RuntimeHostError(
        "stored_content_inconsistent",
        "The stored run-start receipt is malformed or inconsistent.",
        409,
        { cause: error },
      );
    }
    const start = value;
    const content = await identifyFile(path);
    if (
      start.commandId !== record.commandId ||
      start.runtimeId !== record.runtimeId ||
      start.journalId !== record.journalId ||
      start.sourceSession.sessionId !== record.sourceSessionId ||
      start.sourceSession.revisionId !== record.sourceRevisionId ||
      start.analysisRequest.requestId !== record.analysisRequestId ||
      (record.runStartReceiptContentId !== null && record.runStartReceiptContentId !== content.contentId)
    ) {
      throw new RuntimeHostError(
        "stored_content_inconsistent",
        "The stored run-start receipt does not match its durable command mapping.",
        409,
      );
    }
    return { record: start, contentId: content.contentId };
  }

  async reconcile(
    recordValue: RuntimeHostCommandRecord,
    recovery: boolean,
  ): Promise<RuntimeHostCommandRecord> {
    let record = (await this.store.read(recordValue.commandId)) ?? recordValue;
    const paths = this.store.paths(record.runtimeId);
    const receipt = await this.readStartReceipt(record);
    if (!receipt) {
      if (recovery && !terminal(record.lifecycle)) {
        record = await this.replaceLifecycle(record, "interrupted", {
          code: "host_stopped_before_start_receipt",
          message: "The host stopped after command claim but before an immutable start receipt was proven.",
        });
      }
      return record;
    }
    if (record.runStartReceiptContentId === null) {
      record = await this.replaceLifecycle(
        record,
        record.lifecycle,
        record.reason,
        record.journalHead,
        receipt.record,
        receipt.contentId,
      );
    }
    if (!(await exists(paths.journalPath))) {
      if (recovery && !terminal(record.lifecycle)) {
        record = await this.replaceLifecycle(record, "interrupted", {
          code: "host_stopped_before_journal",
          message: "The immutable start receipt exists, but the production journal was not created.",
        });
      }
      return record;
    }
    let journal = await readValidatedRuntimeJournal(paths.journalPath, record.runtimeId);
    if (journal.head === 0) {
      if (recovery && !terminal(record.lifecycle)) {
        const launched = await this.store.hasLaunchClaim(record.commandId);
        record = await this.replaceLifecycle(record, "interrupted", launched
          ? {
              code: "executor_launch_unconfirmed",
              message: "The executor launch was claimed, but no runtime event proves execution began.",
            }
          : {
              code: "host_stopped_before_executor_launch",
              message: "The journal was initialized, but no executor launch was claimed.",
            });
      }
      return record;
    }
    const evidence = lifecycleFromRuntimeEvidence(journal.state);
    if (evidence.lifecycle === "terminal" || evidence.lifecycle === "failed" || evidence.lifecycle === "interrupted") {
      if (
        record.lifecycle !== evidence.lifecycle ||
        record.journalHead !== journal.head ||
        JSON.stringify(record.reason) !== JSON.stringify(evidence.reason)
      ) {
        record = await this.replaceLifecycle(record, evidence.lifecycle, evidence.reason, journal.head);
      }
      return record;
    }
    if (recovery && !terminal(record.lifecycle)) {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const ledger = await RuntimeLedger.open(record.runtimeId, new FileEventJournal(paths.journalPath), { now: this.now });
        try {
          await interruptAmbiguousRuntime(
            ledger,
            "The runtime host restarted while accepted task launch or model execution state remained ambiguous; no executor was relaunched and no report was invented.",
          );
          break;
        } catch (error) {
          if (!(error instanceof RuntimeJournalConflict) || attempt === 2) throw error;
        }
      }
      journal = await readValidatedRuntimeJournal(paths.journalPath, record.runtimeId);
      return this.replaceLifecycle(record, "interrupted", {
        code: "nonterminal_journal_after_restart",
        message: "The recovered journal records explicit interruption; this host will not launch a replacement model turn or child.",
      }, journal.head);
    }
    if (!terminal(record.lifecycle) && record.lifecycle !== evidence.lifecycle) {
      return this.replaceLifecycle(record, evidence.lifecycle, null, journal.head);
    }
    if (record.journalHead !== journal.head) {
      return this.replaceLifecycle(record, record.lifecycle, record.reason, journal.head);
    }
    return record;
  }

  async statusFromRecord(recordValue: RuntimeHostCommandRecord): Promise<RuntimeHostStatus> {
    const record = await this.reconcile(recordValue, false);
    const receipt = await this.readStartReceipt(record);
    return {
      schema: "studio.local-runtime-status.v1",
      commandId: record.commandId,
      runtimeId: record.runtimeId,
      journalId: record.journalId,
      lifecycle: record.lifecycle,
      acceptedAt: record.acceptedAt,
      lastTransitionAt: record.lastTransitionAt,
      reason: structuredClone(record.reason),
      sourceSessionId: record.sourceSessionId,
      sourceRevisionId: record.sourceRevisionId,
      analysisRequestId: record.analysisRequestId,
      forecast: receipt
        ? {
            forecastId: receipt.record.forecast.forecastId,
            contentId: receipt.record.forecast.content.contentId,
            frozenForecastId: receipt.record.frozenForecast.freezeId,
            baselineStatus: "floor_only",
          }
        : null,
      runStartReceipt: receipt
        ? { contentId: receipt.contentId, record: structuredClone(receipt.record) }
        : null,
      journalHead: record.journalHead,
      terminal: terminal(record.lifecycle),
    };
  }
}
