import { randomUUID } from "node:crypto";
import { readFile, stat } from "node:fs/promises";

import { canonicalSha256, identifyFile } from "../artifactStore.ts";
import { createProductionAnalysisRequest } from "../runStart/analysisRequest.ts";
import { createRuntimeStartCommand } from "../runStart/runtimeStart.ts";
import { assertRuntimeStartRecord } from "../runStartValidation.ts";
import type { RuntimeStartRecord } from "../model.ts";
import { DurableRuntimeCommandStore } from "./commandStore.ts";
import { RuntimeHostError } from "./errors.ts";
import {
  lifecycleFromRuntimeEvidence,
  readValidatedRuntimeJournal,
} from "./journalPolling.ts";
import type {
  InitializedRuntimeApplication,
  RuntimeHostCommandRecord,
  RuntimeHostFailureReason,
  RuntimeHostPollResponse,
  RuntimeHostStartAcknowledgement,
  RuntimeHostSourceSummary,
  RuntimeHostStatus,
} from "./model.ts";
import {
  initializeRuntimeApplication,
  runBoundedRuntimeApplication,
  RuntimeApplicationInterrupted,
  type BoundedWorkerLauncherFactory,
} from "./runtimeApplication.ts";
import { RuntimeSourceRegistry } from "./sourceRegistry.ts";
import { parseRuntimeHostStartRequest } from "./validation.ts";

export interface RuntimeStartServiceOptions {
  store: DurableRuntimeCommandStore;
  sources: RuntimeSourceRegistry;
  launcherFactory: BoundedWorkerLauncherFactory;
  acceptedBy?: string;
  now?: () => Date;
  nextRuntimeId?: () => string;
  hostInstanceId?: string;
  recoverOnOpen?: boolean;
}

function terminal(lifecycle: RuntimeHostCommandRecord["lifecycle"]): boolean {
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

/** Transport-independent validated start, lookup, recovery, and journal polling service. */
export class RuntimeStartService {
  private readonly store: DurableRuntimeCommandStore;
  private readonly sources: RuntimeSourceRegistry;
  private readonly launcherFactory: BoundedWorkerLauncherFactory;
  private readonly acceptedBy: string;
  private readonly now: () => Date;
  private readonly nextRuntimeId: () => string;
  private readonly hostInstanceId: string;
  private readonly initializing = new Map<string, Promise<RuntimeHostStartAcknowledgement>>();
  private readonly transitionTails = new Map<string, Promise<RuntimeHostCommandRecord>>();

  private constructor(options: RuntimeStartServiceOptions) {
    this.store = options.store;
    this.sources = options.sources;
    this.launcherFactory = options.launcherFactory;
    this.acceptedBy = options.acceptedBy ?? "operator:local-runtime-host";
    this.now = options.now ?? (() => new Date());
    this.nextRuntimeId = options.nextRuntimeId ?? (() => `runtime:${randomUUID()}`);
    this.hostInstanceId = options.hostInstanceId ?? `host:${randomUUID()}`;
  }

  static async open(options: RuntimeStartServiceOptions): Promise<RuntimeStartService> {
    const service = new RuntimeStartService(options);
    if (options.recoverOnOpen ?? true) await service.recover();
    return service;
  }

  listSources(): RuntimeHostSourceSummary[] {
    return this.sources.list();
  }

  private async replaceLifecycle(
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

  private ensureSameAcceptedCommand(
    stored: RuntimeHostCommandRecord,
    expected: RuntimeHostCommandRecord,
  ): void {
    if (
      stored.commandId !== expected.commandId ||
      stored.requestContentId !== expected.requestContentId ||
      stored.sourceSessionId !== expected.sourceSessionId ||
      stored.sourceRevisionId !== expected.sourceRevisionId ||
      stored.analysisRequestId !== expected.analysisRequestId
    ) {
      throw new RuntimeHostError(
        "stored_content_inconsistent",
        "The durable command identity is already bound to different accepted content.",
        409,
      );
    }
  }

  async start(value: unknown): Promise<RuntimeHostStartAcknowledgement> {
    let request;
    try {
      request = parseRuntimeHostStartRequest(value);
    } catch (error) {
      if (error instanceof RuntimeHostError) throw error;
      throw new RuntimeHostError(
        "invalid_start_request",
        `The runtime start request is invalid: ${error instanceof Error ? error.message : "validation failed"}`,
        400,
        { cause: error },
      );
    }
    const loadedSource = await this.sources.resolve(request.sourceSessionId, request.sourceRevisionId);
    let analysisRequest;
    try {
      analysisRequest = createProductionAnalysisRequest(loadedSource.session, {
        range: request.range,
        requestedSource: request.requestedSourceLanguage,
        targetLanguage: request.targetLanguage,
        selectedLanguagePackId: request.selectedLanguagePackId,
        outputDepth: request.outputDepth,
        options: request.options,
      });
    } catch (error) {
      throw new RuntimeHostError(
        "invalid_analysis_request",
        "The product inputs do not form a valid analysis request for this source revision.",
        400,
        { cause: error },
      );
    }
    const command = createRuntimeStartCommand(loadedSource.session, analysisRequest);
    const existing = this.initializing.get(command.commandId);
    if (existing) return existing;
    const acceptance = this.acceptStart(command.commandId, loadedSource, analysisRequest, command.workPlan);
    this.initializing.set(command.commandId, acceptance);
    try {
      return await acceptance;
    } finally {
      this.initializing.delete(command.commandId);
    }
  }

  private async acceptStart(
    commandId: string,
    loadedSource: Awaited<ReturnType<RuntimeSourceRegistry["resolve"]>>,
    analysisRequest: ReturnType<typeof createProductionAnalysisRequest>,
    workPlan: ReturnType<typeof createRuntimeStartCommand>["workPlan"],
  ): Promise<RuntimeHostStartAcknowledgement> {
    const acceptedAt = this.now().toISOString();
    const runtimeId = this.nextRuntimeId();
    const requestContentId = `sha256:${canonicalSha256({
      sourceRevisionId: loadedSource.session.revisionId,
      analysisRequest,
      workPlan,
    })}`;
    const proposed: RuntimeHostCommandRecord = {
      schema: "studio.local-runtime-command.v1",
      producer: { id: "studio.local-runtime-host", version: "1" },
      commandId,
      requestContentId,
      sourceSessionId: loadedSource.session.sessionId,
      sourceRevisionId: loadedSource.session.revisionId,
      analysisRequestId: analysisRequest.requestId,
      runtimeId,
      journalId: `journal:${runtimeId}`,
      acceptedAt,
      lifecycle: "accepted",
      lastTransitionAt: acceptedAt,
      reason: null,
      runStartReceiptContentId: null,
      forecastContentId: null,
      frozenForecastId: null,
      journalHead: 0,
    };
    const claim = await this.store.claim(proposed);
    this.ensureSameAcceptedCommand(claim.record, proposed);
    if (!claim.won) {
      let existingRecord = claim.record;
      for (let attempt = 0; attempt < 200; attempt += 1) {
        const status = await this.statusFromRecord(existingRecord);
        if (status.runStartReceipt !== null || status.terminal) return this.acknowledgement(status);
        await new Promise((resolve) => setTimeout(resolve, 10));
        existingRecord = (await this.store.read(commandId)) ?? existingRecord;
      }
      return this.acknowledgement(await this.statusFromRecord(existingRecord));
    }

    let record = await this.replaceLifecycle(claim.record, "initializing", null);
    let initialized: InitializedRuntimeApplication;
    try {
      const paths = await this.store.createRuntimeDirectory(record.runtimeId);
      initialized = await initializeRuntimeApplication({
        ...paths,
        runtimeId: record.runtimeId,
        journalId: record.journalId,
        acceptedBy: this.acceptedBy,
        startedAt: record.acceptedAt,
        loadedSource,
        analysisRequest,
      });
      const receiptContent = await identifyFile(paths.runStartPath);
      record = await this.replaceLifecycle(
        record,
        "initializing",
        null,
        0,
        initialized.runStart,
        receiptContent.contentId,
      );
    } catch (error) {
      record = await this.replaceLifecycle(record, "failed", {
        code: "initialization_failed",
        message: "The host could not durably initialize the accepted runtime.",
      });
      return this.acknowledgement(await this.statusFromRecord(record));
    }

    const launchWon = await this.store.claimLaunch(commandId, {
      schema: "studio.local-runtime-launch-claim.v1",
      hostInstanceId: this.hostInstanceId,
      processId: process.pid,
      claimedAt: this.now().toISOString(),
    });
    if (!launchWon) {
      record = await this.replaceLifecycle(record, "interrupted", {
        code: "executor_launch_unconfirmed",
        message: "A launch claim already exists and the host will not start another executor.",
      });
      return this.acknowledgement(await this.statusFromRecord(record));
    }

    void this.execute(record, initialized).catch(() => undefined);
    return this.acknowledgement(await this.statusFromRecord(record));
  }

  private async execute(
    record: RuntimeHostCommandRecord,
    initialized: InitializedRuntimeApplication,
  ): Promise<void> {
    try {
      await runBoundedRuntimeApplication(initialized, this.launcherFactory);
      await this.reconcile(record, false);
    } catch (error) {
      const current = await this.store.read(record.commandId);
      if (!current) return;
      if (error instanceof RuntimeApplicationInterrupted) {
        const journal = await readValidatedRuntimeJournal(
          this.store.paths(current.runtimeId).journalPath,
          current.runtimeId,
        );
        await this.replaceLifecycle(current, "interrupted", {
          code: "executor_interrupted",
          message: "The executor stopped without terminal runtime evidence and will not be relaunched automatically.",
        }, journal.head);
      } else {
        const journal = await readValidatedRuntimeJournal(
          this.store.paths(current.runtimeId).journalPath,
          current.runtimeId,
        ).catch(() => null);
        const evidence = journal ? lifecycleFromRuntimeEvidence(journal.state) : null;
        await this.replaceLifecycle(
          current,
          "failed",
          evidence?.reason ?? {
            code: "executor_failed",
            message: "The bounded executor failed; durable runtime evidence remains inspectable.",
          },
          journal?.head ?? current.journalHead,
        );
      }
    }
  }

  private async readStartReceipt(record: RuntimeHostCommandRecord): Promise<{
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

  private async reconcile(
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
    const journal = await readValidatedRuntimeJournal(paths.journalPath, record.runtimeId);
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
    if (evidence.lifecycle === "terminal" || evidence.lifecycle === "failed") {
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
      return this.replaceLifecycle(record, "interrupted", {
        code: "nonterminal_journal_after_restart",
        message: "The recovered journal is nonterminal; this host will not launch a replacement child.",
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

  private async statusFromRecord(recordValue: RuntimeHostCommandRecord): Promise<RuntimeHostStatus> {
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

  private acknowledgement(status: RuntimeHostStatus): RuntimeHostStartAcknowledgement {
    return { ...status, schema: "studio.local-runtime-start-ack.v1" };
  }

  async statusByCommand(commandId: string): Promise<RuntimeHostStatus> {
    const record = await this.store.read(commandId);
    if (!record) throw new RuntimeHostError("unknown_command", "The runtime command is unknown.", 404);
    return this.statusFromRecord(record);
  }

  async statusByRuntime(runtimeId: string): Promise<RuntimeHostStatus> {
    const record = await this.store.findByRuntimeId(runtimeId);
    if (!record) throw new RuntimeHostError("unknown_runtime", "The runtime identity is unknown.", 404);
    return this.statusFromRecord(record);
  }

  async poll(runtimeId: string, after: number, limit: number): Promise<RuntimeHostPollResponse> {
    const record = await this.store.findByRuntimeId(runtimeId);
    if (!record) throw new RuntimeHostError("unknown_runtime", "The runtime identity is unknown.", 404);
    const reconciled = await this.reconcile(record, false);
    const journal = await readValidatedRuntimeJournal(this.store.paths(runtimeId).journalPath, runtimeId);
    if (after > journal.head) {
      throw new RuntimeHostError(
        "cursor_past_head",
        "The requested cursor is beyond the validated journal head.",
        409,
      );
    }
    const events = journal.events.filter((event) => event.seq > after).slice(0, limit);
    const nextCursor = events.at(-1)?.seq ?? after;
    return {
      schema: "studio.local-runtime-events.v1",
      commandId: reconciled.commandId,
      runtimeId,
      lifecycle: reconciled.lifecycle,
      requestedCursor: after,
      nextCursor,
      journalHead: journal.head,
      events: structuredClone(events),
      reachedHead: nextCursor === journal.head,
      terminal: terminal(reconciled.lifecycle),
      reason: structuredClone(reconciled.reason),
    };
  }

  async recover(): Promise<void> {
    for (const record of await this.store.list()) {
      if (record.lifecycle === "terminal" || record.lifecycle === "failed") {
        await this.reconcile(record, true);
        continue;
      }
      await this.reconcile(record, true);
    }
  }
}
