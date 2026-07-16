import { randomUUID } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";

import {
  canonicalSha256,
  ContentAddressedArtifactStore,
  createSourceArtifactId,
  identifyFile,
} from "../artifactStore.ts";
import { reopenEvidenceAssessmentAudits } from "../assessmentAudit.ts";
import { reopenEvidenceDecisionReceipts } from "../decisionReceiptAudit.ts";
import { reopenPublishReviewIntakes } from "../publishReviewIntakeAudit.ts";
import { reopenPublishReviewDecisions } from "../publishReviewDecisionAudit.ts";
import {
  reopenCaptionProductionResults,
  reopenCaptionProductions,
} from "../captionProductionAudit.ts";
import {
  CaptionProductionHost,
  CaptionProductionHostError,
} from "../captionProductionHost.ts";
import {
  CaptionQualityControlHost,
  CaptionQualityControlHostError,
} from "../captionQualityControlHost.ts";
import { reopenCaptionQualityControls } from "../captionQualityControlAudit.ts";
import {
  RecordedCaptionFixtureExecutor,
  type CaptionProductionExecutor,
} from "../captionProductionExecutor.ts";
import {
  PublishReviewHost,
  PublishReviewHostError,
} from "../publishReviewHost.ts";
import { FileEventJournal, RuntimeJournalConflict, RuntimeLedger } from "../journal.ts";
import { interruptAmbiguousRuntime } from "../recovery.ts";
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
  RuntimeHostCaptionProductionResultsResponse,
  RuntimeHostCaptionProductionResponse,
  RuntimeHostCaptionQualityControlResponse,
  RuntimeHostDecisionReceiptResponse,
  RuntimeHostFailureReason,
  RuntimeHostPlanResponse,
  RuntimeHostPollResponse,
  RuntimeHostPublishReviewIntakeResponse,
  RuntimeHostPublishReviewDecisionResponse,
  RuntimeHostStartAcknowledgement,
  RuntimeHostSourceSummary,
  RuntimeHostStatus,
} from "./model.ts";
import {
  initializeRuntimeApplication,
  runBoundedRuntimeApplication,
  RuntimeApplicationInterrupted,
  type BoundedOrchestratorLauncherFactory,
  type BoundedWorkerLauncherFactory,
} from "./runtimeApplication.ts";
import { deterministicOrchestratorLauncherFactory } from "./deterministicOrchestrator.ts";
import { RuntimeSourceRegistry } from "./sourceRegistry.ts";
import { parseRuntimeHostStartRequest } from "./validation.ts";
import {
  assertPublishReviewDecisionRequest,
  assertPublishReviewRevocationRequest,
  PUBLISH_REVIEW_DECISION_ATTESTATION,
  PUBLISH_REVIEW_REVOCATION_ATTESTATION,
  validatePublishReviewOperator,
} from "../validation/publishReviewDecision.ts";
import type { PublishReviewOperator } from "../model.ts";
import { assertCaptionProductionRequest } from "../validation/captionProduction.ts";
import { assertCaptionQualityControlRequest } from "../validation/captionQualityControl.ts";

export interface RuntimeStartServiceOptions {
  store: DurableRuntimeCommandStore;
  sources: RuntimeSourceRegistry;
  launcherFactory: BoundedWorkerLauncherFactory;
  orchestratorLauncherFactory?: BoundedOrchestratorLauncherFactory;
  acceptedBy?: string;
  now?: () => Date;
  runtimeIdForCommand?: (commandId: string) => string;
  hostInstanceId?: string;
  recoverOnOpen?: boolean;
  reviewer?: PublishReviewOperator;
  captionExecutor?: CaptionProductionExecutor;
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
  private readonly orchestratorLauncherFactory: BoundedOrchestratorLauncherFactory;
  private readonly acceptedBy: string;
  private readonly now: () => Date;
  private readonly runtimeIdForCommand: (commandId: string) => string;
  private readonly hostInstanceId: string;
  private readonly reviewer: PublishReviewOperator;
  private readonly captionExecutor: CaptionProductionExecutor;
  private readonly initializing = new Map<string, Promise<RuntimeHostStartAcknowledgement>>();
  private readonly transitionTails = new Map<string, Promise<RuntimeHostCommandRecord>>();
  private readonly reviewMutationTails = new Map<string, Promise<unknown>>();

  private constructor(options: RuntimeStartServiceOptions) {
    this.store = options.store;
    this.sources = options.sources;
    this.launcherFactory = options.launcherFactory;
    this.orchestratorLauncherFactory = options.orchestratorLauncherFactory ?? deterministicOrchestratorLauncherFactory();
    this.acceptedBy = options.acceptedBy ?? "operator:local-runtime-host";
    this.now = options.now ?? (() => new Date());
    this.runtimeIdForCommand = options.runtimeIdForCommand ?? deterministicRuntimeId;
    this.hostInstanceId = options.hostInstanceId ?? `host:${randomUUID()}`;
    this.reviewer = validatePublishReviewOperator(
      options.reviewer ?? { id: "reviewer:local-operator", label: "Local review operator" },
    );
    this.captionExecutor = options.captionExecutor ?? new RecordedCaptionFixtureExecutor();
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
      await runBoundedRuntimeApplication(initialized, this.launcherFactory, this.orchestratorLauncherFactory);
      await this.reconcile(record, false);
    } catch (error) {
      const current = await this.store.read(record.commandId);
      if (!current) return;
      if (error instanceof RuntimeJournalConflict) {
        // A recovery writer advanced the durable journal. This stale executor must not overwrite
        // the recovery lifecycle or attempt another append from its stale projection.
        return;
      }
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

  private async withReviewMutation<T>(runtimeId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.reviewMutationTails.get(runtimeId) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(operation);
    this.reviewMutationTails.set(runtimeId, next);
    try {
      return await next;
    } finally {
      if (this.reviewMutationTails.get(runtimeId) === next) this.reviewMutationTails.delete(runtimeId);
    }
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
      if (error.code === "verified_accepted_child_output_required") {
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

  async publishReviewDecisions(runtimeId: string): Promise<RuntimeHostPublishReviewDecisionResponse> {
    const record = await this.store.findByRuntimeId(runtimeId);
    if (!record) throw new RuntimeHostError("unknown_runtime", "The runtime identity is unknown.", 404);
    const reconciled = await this.reconcile(record, false);
    const paths = this.store.paths(runtimeId);
    const journal = await readValidatedRuntimeJournal(paths.journalPath, runtimeId);
    let reviews;
    try {
      reviews = await reopenPublishReviewDecisions(
        journal.state,
        journal.events,
        new ContentAddressedArtifactStore(paths.artifactStoreRoot),
      );
    } catch (error) {
      throw new RuntimeHostError(
        "stored_content_inconsistent",
        "A stored publish-review decision, revocation, or verified intake lineage failed closed validation.",
        409,
        { cause: error },
      );
    }
    return {
      schema: "studio.local-runtime-publish-review-decisions.v1",
      commandId: reconciled.commandId,
      runtimeId,
      journalHead: journal.head,
      reviewer: {
        ...structuredClone(this.reviewer),
        decisionAttestation: PUBLISH_REVIEW_DECISION_ATTESTATION,
        revocationAttestation: PUBLISH_REVIEW_REVOCATION_ATTESTATION,
      },
      reviews,
    };
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
    return this.withReviewMutation(runtimeId, async () => {
      const record = await this.store.findByRuntimeId(runtimeId);
      if (!record) throw new RuntimeHostError("unknown_runtime", "The runtime identity is unknown.", 404);
      await this.reconcile(record, false);
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
      return this.publishReviewDecisions(runtimeId);
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
    return this.withReviewMutation(runtimeId, async () => {
      const record = await this.store.findByRuntimeId(runtimeId);
      if (!record) throw new RuntimeHostError("unknown_runtime", "The runtime identity is unknown.", 404);
      await this.reconcile(record, false);
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
      return this.publishReviewDecisions(runtimeId);
    });
  }

  async captionProductions(runtimeId: string): Promise<RuntimeHostCaptionProductionResponse> {
    const record = await this.store.findByRuntimeId(runtimeId);
    if (!record) throw new RuntimeHostError("unknown_runtime", "The runtime identity is unknown.", 404);
    const reconciled = await this.reconcile(record, false);
    const paths = this.store.paths(runtimeId);
    const journal = await readValidatedRuntimeJournal(paths.journalPath, runtimeId);
    let captions;
    try {
      captions = await reopenCaptionProductions(
        journal.state,
        journal.events,
        new ContentAddressedArtifactStore(paths.artifactStoreRoot),
      );
    } catch (error) {
      throw new RuntimeHostError(
        "stored_content_inconsistent",
        "A stored caption artifact, receipt, or approval lineage failed closed validation.",
        409,
        { cause: error },
      );
    }
    return {
      schema: "studio.local-runtime-caption-productions.v1",
      commandId: reconciled.commandId,
      runtimeId,
      journalHead: journal.head,
      captions,
    };
  }

  async captionProductionResults(
    runtimeId: string,
  ): Promise<RuntimeHostCaptionProductionResultsResponse> {
    const record = await this.store.findByRuntimeId(runtimeId);
    if (!record) throw new RuntimeHostError("unknown_runtime", "The runtime identity is unknown.", 404);
    const reconciled = await this.reconcile(record, false);
    const paths = this.store.paths(runtimeId);
    const journal = await readValidatedRuntimeJournal(paths.journalPath, runtimeId);
    let results;
    try {
      results = await reopenCaptionProductionResults(
        journal.state,
        journal.events,
        new ContentAddressedArtifactStore(paths.artifactStoreRoot),
      );
    } catch (error) {
      throw new RuntimeHostError(
        "stored_content_inconsistent",
        "A stored caption artifact, receipt, or approval lineage failed closed validation.",
        409,
        { cause: error },
      );
    }
    return {
      schema: "studio.local-runtime-caption-production-results.v1",
      commandId: reconciled.commandId,
      runtimeId,
      journalHead: journal.head,
      results,
    };
  }

  async captionQualityControls(runtimeId: string): Promise<RuntimeHostCaptionQualityControlResponse> {
    const record = await this.store.findByRuntimeId(runtimeId);
    if (!record) throw new RuntimeHostError("unknown_runtime", "The runtime identity is unknown.", 404);
    const reconciled = await this.reconcile(record, false);
    const paths = this.store.paths(runtimeId);
    const journal = await readValidatedRuntimeJournal(paths.journalPath, runtimeId);
    let qualityControls;
    try {
      qualityControls = await reopenCaptionQualityControls(
        journal.state,
        journal.events,
        new ContentAddressedArtifactStore(paths.artifactStoreRoot),
      );
    } catch (error) {
      throw new RuntimeHostError(
        "stored_content_inconsistent",
        "A stored caption QC receipt or current-run candidate lineage failed closed validation.",
        409,
        { cause: error },
      );
    }
    return {
      schema: "studio.local-runtime-caption-quality-controls.v1",
      commandId: reconciled.commandId,
      runtimeId,
      journalHead: journal.head,
      qualityControls,
    };
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
    return this.withReviewMutation(runtimeId, async () => {
      const record = await this.store.findByRuntimeId(runtimeId);
      if (!record) throw new RuntimeHostError("unknown_runtime", "The runtime identity is unknown.", 404);
      await this.reconcile(record, false);
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
      return this.captionQualityControls(runtimeId);
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
    return this.withReviewMutation(runtimeId, async () => {
      const record = await this.store.findByRuntimeId(runtimeId);
      if (!record) throw new RuntimeHostError("unknown_runtime", "The runtime identity is unknown.", 404);
      await this.reconcile(record, false);
      const start = await this.readStartReceipt(record);
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
      return this.captionProductions(runtimeId);
    });
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
