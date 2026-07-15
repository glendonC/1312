import { randomUUID } from "node:crypto";
import { readFile, stat } from "node:fs/promises";

import {
  canonicalSha256,
  ContentAddressedArtifactStore,
  createSourceArtifactId,
  identifyFile,
} from "../artifactStore.ts";
import { reopenEvidenceAssessmentAudits } from "../assessmentAudit.ts";
import { reopenEvidenceDecisionReceipts } from "../decisionReceiptAudit.ts";
import { reopenPublishReviewIntakes } from "../publishReviewIntakeAudit.ts";
import { createProductionAnalysisRequest } from "../runStart/analysisRequest.ts";
import {
  createRuntimePlan,
  createRuntimeStartCommand,
} from "../runStart/runtimeStart.ts";
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
  RuntimeHostAssessmentAuditResponse,
  RuntimeHostDecisionReceiptResponse,
  RuntimeHostFailureReason,
  RuntimeHostPlanResponse,
  RuntimeHostPollResponse,
  RuntimeHostPublishReviewIntakeResponse,
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
  runtimeIdForCommand?: (commandId: string) => string;
  hostInstanceId?: string;
  recoverOnOpen?: boolean;
}

function terminal(lifecycle: RuntimeHostCommandRecord["lifecycle"]): boolean {
  return lifecycle === "terminal" || lifecycle === "failed" || lifecycle === "interrupted";
}

function deterministicRuntimeId(commandId: string): string {
  const digest = canonicalSha256({ allocator: "studio.local-runtime-host.v1", commandId });
  const uuid = [
    digest.slice(0, 8),
    digest.slice(8, 12),
    `4${digest.slice(13, 16)}`,
    `8${digest.slice(17, 20)}`,
    digest.slice(20, 32),
  ].join("-");
  return `runtime:${uuid}`;
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
  private readonly runtimeIdForCommand: (commandId: string) => string;
  private readonly hostInstanceId: string;
  private readonly initializing = new Map<string, Promise<RuntimeHostStartAcknowledgement>>();
  private readonly transitionTails = new Map<string, Promise<RuntimeHostCommandRecord>>();

  private constructor(options: RuntimeStartServiceOptions) {
    this.store = options.store;
    this.sources = options.sources;
    this.launcherFactory = options.launcherFactory;
    this.acceptedBy = options.acceptedBy ?? "operator:local-runtime-host";
    this.now = options.now ?? (() => new Date());
    this.runtimeIdForCommand = options.runtimeIdForCommand ?? deterministicRuntimeId;
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

  private async prepare(value: unknown): Promise<{
    loadedSource: Awaited<ReturnType<RuntimeSourceRegistry["resolve"]>>;
    analysisRequest: ReturnType<typeof createProductionAnalysisRequest>;
    plan: ReturnType<typeof createRuntimePlan>;
  }> {
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
    const runtimeId = this.runtimeIdForCommand(command.commandId);
    const sourceArtifactId = createSourceArtifactId(runtimeId, loadedSource.descriptor);
    const plan = createRuntimePlan({
      runtimeId,
      sourceSession: loadedSource.session,
      sourceArtifactId,
      analysisRequest,
    });
    return { loadedSource, analysisRequest, plan };
  }

  async plan(value: unknown): Promise<RuntimeHostPlanResponse> {
    const prepared = await this.prepare(value);
    return {
      schema: "studio.local-runtime-plan.v1",
      commandId: prepared.plan.commandId,
      runtimeId: prepared.plan.runtimeId,
      sourceSessionId: prepared.loadedSource.session.sessionId,
      sourceRevisionId: prepared.loadedSource.session.revisionId,
      analysisRequestId: prepared.analysisRequest.requestId,
      forecast: structuredClone(prepared.plan.forecast),
      acceptance: {
        status: "not_started",
        frozenForecastId: null,
      },
    };
  }

  async start(value: unknown): Promise<RuntimeHostStartAcknowledgement> {
    const prepared = await this.prepare(value);
    const existing = this.initializing.get(prepared.plan.commandId);
    if (existing) return existing;
    const acceptance = this.acceptStart(
      prepared.plan,
      prepared.loadedSource,
      prepared.analysisRequest,
    );
    this.initializing.set(prepared.plan.commandId, acceptance);
    try {
      return await acceptance;
    } finally {
      this.initializing.delete(prepared.plan.commandId);
    }
  }

  private async acceptStart(
    plan: ReturnType<typeof createRuntimePlan>,
    loadedSource: Awaited<ReturnType<RuntimeSourceRegistry["resolve"]>>,
    analysisRequest: ReturnType<typeof createProductionAnalysisRequest>,
  ): Promise<RuntimeHostStartAcknowledgement> {
    const acceptedAt = this.now().toISOString();
    const requestContentId = `sha256:${canonicalSha256({
      sourceRevisionId: loadedSource.session.revisionId,
      analysisRequest,
      workPlan: plan.workPlan,
      forecastContentId: plan.forecast.content.contentId,
    })}`;
    const proposed: RuntimeHostCommandRecord = {
      schema: "studio.local-runtime-command.v1",
      producer: { id: "studio.local-runtime-host", version: "1" },
      commandId: plan.commandId,
      requestContentId,
      sourceSessionId: loadedSource.session.sessionId,
      sourceRevisionId: loadedSource.session.revisionId,
      analysisRequestId: analysisRequest.requestId,
      runtimeId: plan.runtimeId,
      journalId: `journal:${plan.runtimeId}`,
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
        existingRecord = (await this.store.read(plan.commandId)) ?? existingRecord;
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
      if (
        initialized.sourceArtifact.id !== plan.sourceArtifactId ||
        initialized.runStart.forecast.content.contentId !== plan.forecast.content.contentId
      ) {
        throw new Error("The initialized runtime does not match its reviewed source artifact and forecast.");
      }
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

    const launchWon = await this.store.claimLaunch(plan.commandId, {
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

  async assessmentAudits(runtimeId: string): Promise<RuntimeHostAssessmentAuditResponse> {
    const record = await this.store.findByRuntimeId(runtimeId);
    if (!record) throw new RuntimeHostError("unknown_runtime", "The runtime identity is unknown.", 404);
    const reconciled = await this.reconcile(record, false);
    const paths = this.store.paths(runtimeId);
    const journal = await readValidatedRuntimeJournal(paths.journalPath, runtimeId);
    let audits;
    try {
      audits = await reopenEvidenceAssessmentAudits(
        journal.state,
        journal.events,
        new ContentAddressedArtifactStore(paths.artifactStoreRoot),
      );
    } catch (error) {
      throw new RuntimeHostError(
        "stored_content_inconsistent",
        "A stored assessment receipt or its cited read lineage failed closed audit validation.",
        409,
        { cause: error },
      );
    }
    return {
      schema: "studio.local-runtime-assessment-audits.v1",
      commandId: reconciled.commandId,
      runtimeId,
      journalHead: journal.head,
      audits,
    };
  }

  async decisionReceipts(runtimeId: string): Promise<RuntimeHostDecisionReceiptResponse> {
    const record = await this.store.findByRuntimeId(runtimeId);
    if (!record) throw new RuntimeHostError("unknown_runtime", "The runtime identity is unknown.", 404);
    const reconciled = await this.reconcile(record, false);
    const paths = this.store.paths(runtimeId);
    const journal = await readValidatedRuntimeJournal(paths.journalPath, runtimeId);
    let decisions;
    try {
      decisions = await reopenEvidenceDecisionReceipts(
        journal.state,
        journal.events,
        new ContentAddressedArtifactStore(paths.artifactStoreRoot),
      );
    } catch (error) {
      throw new RuntimeHostError(
        "stored_content_inconsistent",
        "A stored evidence decision or its audited assessment lineage failed closed validation.",
        409,
        { cause: error },
      );
    }
    return {
      schema: "studio.local-runtime-decision-receipts.v1",
      commandId: reconciled.commandId,
      runtimeId,
      journalHead: journal.head,
      decisions,
    };
  }

  async publishReviewIntakes(runtimeId: string): Promise<RuntimeHostPublishReviewIntakeResponse> {
    const record = await this.store.findByRuntimeId(runtimeId);
    if (!record) throw new RuntimeHostError("unknown_runtime", "The runtime identity is unknown.", 404);
    const reconciled = await this.reconcile(record, false);
    const paths = this.store.paths(runtimeId);
    const journal = await readValidatedRuntimeJournal(paths.journalPath, runtimeId);
    let intakes;
    try {
      intakes = await reopenPublishReviewIntakes(
        journal.state,
        journal.events,
        new ContentAddressedArtifactStore(paths.artifactStoreRoot),
      );
    } catch (error) {
      throw new RuntimeHostError(
        "stored_content_inconsistent",
        "A stored publish-review intake or its verified decision lineage failed closed validation.",
        409,
        { cause: error },
      );
    }
    return {
      schema: "studio.local-runtime-publish-review-intakes.v1",
      commandId: reconciled.commandId,
      runtimeId,
      journalHead: journal.head,
      intakes,
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
