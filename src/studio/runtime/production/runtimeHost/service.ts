import { randomUUID } from "node:crypto";
import { join } from "node:path";

import {
  canonicalSha256,
  createSourceArtifactId,
  identifyFile,
} from "../artifactStore.ts";
import {
  RecordedCaptionFixtureExecutor,
  type CaptionProductionExecutor,
} from "../captions/captionProductionExecutor.ts";
import { RuntimeJournalConflict } from "../journal.ts";
import {
  loadMemoryReviewArtifacts,
  recordMemoryConsumptionReceipt,
} from "../memory/ledgerStore.ts";
import type { MemoryConsumptionReceipt } from "../memory/model.ts";
import { createProductionAnalysisRequest } from "../runStart/analysisRequest.ts";
import {
  createRuntimePlan,
  createRuntimeStartCommand,
} from "../runStart/runtimeStart.ts";
import { DurableRuntimeCommandStore } from "./commandStore.ts";
import { RuntimeHostLifecycleCoordinator, terminal } from "./lifecycleCoordinator.ts";
import { RuntimeHostQueries } from "./runtimeQueries.ts";
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
  RuntimeHostPlanResponse,
  RuntimeHostPollResponse,
  RuntimeHostPrivatePlaybackGrant,
  RuntimeHostPrivatePlaybackGrantRevocationResponse,
  RuntimeHostPublishReviewIntakeResponse,
  RuntimeHostLanguageExplanationResponse,
  RuntimeHostSpanTranslationResponse,
  RuntimeHostLearningPrepResponse,
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
  type StudyContractVersion,
} from "./runtimeApplication.ts";
import { deterministicOrchestratorLauncherFactory } from "./deterministicOrchestrator.ts";
import { RuntimeSourceRegistry } from "./sourceRegistry.ts";
import { parseRuntimeHostStartRequest } from "./validation.ts";
import { validatePublishReviewOperator } from "../validation/publishReviewDecision.ts";
import type { PublishReviewOperator } from "../model.ts";
import { RuntimeReviewCaptionCoordinator } from "./reviewCaptionCoordinator.ts";
import type { LanguageExplanationExecutor } from "../languageExplanations/executor.ts";
import { UnavailableLanguageExplanationExecutor } from "../languageExplanations/executor.ts";
import { RuntimeLanguageExplanationCoordinator } from "./languageExplanationCoordinator.ts";
import type { SpanTranslationExecutor } from "../spanTranslations/executor.ts";
import { UnavailableSpanTranslationExecutor } from "../spanTranslations/executor.ts";
import { RuntimeSpanTranslationCoordinator } from "./spanTranslationCoordinator.ts";
import type { LearningPrepExecutor } from "../learningPrep/executor.ts";
import { UnavailableLearningPrepExecutor } from "../learningPrep/executor.ts";
import { RuntimeLearningPrepCoordinator } from "./learningPrepCoordinator.ts";
import { RuntimeMutationQueue } from "./runtimeMutationQueue.ts";
import { RuntimePrivatePlaybackService, type PrivatePlaybackMediaResource } from "./privatePlayback.ts";

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
  languageExplanationExecutor?: LanguageExplanationExecutor;
  spanTranslationExecutor?: SpanTranslationExecutor;
  learningPrepExecutor?: LearningPrepExecutor;
  /** Explicit compatibility selector; omitted means the U3 generalized production spine. */
  studyContractVersion?: StudyContractVersion;
  /** Host-owned memory/review store root. Defaults to cwd `memory/review`. */
  reviewedMemoryStore?: string;
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
  private readonly lifecycle: RuntimeHostLifecycleCoordinator;
  private readonly queries: RuntimeHostQueries;
  private readonly reviewCaption: RuntimeReviewCaptionCoordinator;
  private readonly languageExplanation: RuntimeLanguageExplanationCoordinator;
  private readonly spanTranslation: RuntimeSpanTranslationCoordinator;
  private readonly learningPrep: RuntimeLearningPrepCoordinator;
  private readonly privatePlayback: RuntimePrivatePlaybackService;
  private readonly studyContractVersion: StudyContractVersion;
  private readonly reviewedMemoryStore: string;
  private readonly initializing = new Map<string, Promise<RuntimeHostStartAcknowledgement>>();

  private constructor(options: RuntimeStartServiceOptions) {
    this.store = options.store;
    this.sources = options.sources;
    this.launcherFactory = options.launcherFactory;
    this.orchestratorLauncherFactory = options.orchestratorLauncherFactory ?? deterministicOrchestratorLauncherFactory();
    this.studyContractVersion = options.studyContractVersion ?? "v2";
    this.reviewedMemoryStore = options.reviewedMemoryStore ?? join(process.cwd(), "memory/review");
    this.acceptedBy = options.acceptedBy ?? "operator:local-runtime-host";
    this.now = options.now ?? (() => new Date());
    this.runtimeIdForCommand = options.runtimeIdForCommand ?? deterministicRuntimeId;
    this.hostInstanceId = options.hostInstanceId ?? `host:${randomUUID()}`;
    const reviewer = validatePublishReviewOperator(
      options.reviewer ?? { id: "reviewer:local-operator", label: "Local review operator" },
    );
    this.lifecycle = new RuntimeHostLifecycleCoordinator(this.store, this.now);
    this.queries = new RuntimeHostQueries(
      this.store,
      reviewer,
      (record, recovery) => this.lifecycle.reconcile(record, recovery),
    );
    const mutationQueue = new RuntimeMutationQueue();
    this.reviewCaption = new RuntimeReviewCaptionCoordinator({
      store: this.store,
      sources: this.sources,
      lifecycle: this.lifecycle,
      queries: this.queries,
      reviewer,
      captionExecutor: options.captionExecutor ?? new RecordedCaptionFixtureExecutor(),
      now: this.now,
      mutationQueue,
    });
    this.languageExplanation = new RuntimeLanguageExplanationCoordinator({
      store: this.store,
      sources: this.sources,
      lifecycle: this.lifecycle,
      queries: this.queries,
      executor: options.languageExplanationExecutor ?? new UnavailableLanguageExplanationExecutor(),
      mutationQueue,
      now: this.now,
    });
    this.learningPrep = new RuntimeLearningPrepCoordinator({
      store: this.store,
      sources: this.sources,
      lifecycle: this.lifecycle,
      queries: this.queries,
      executor: options.learningPrepExecutor ?? new UnavailableLearningPrepExecutor(),
      mutationQueue,
      now: this.now,
    });
    this.spanTranslation = new RuntimeSpanTranslationCoordinator({
      store: this.store,
      sources: this.sources,
      lifecycle: this.lifecycle,
      queries: this.queries,
      executor: options.spanTranslationExecutor ?? new UnavailableSpanTranslationExecutor(),
      mutationQueue,
      now: this.now,
    });
    this.privatePlayback = new RuntimePrivatePlaybackService({
      store: this.store,
      sources: this.sources,
      status: (runtimeId) => this.statusByRuntime(runtimeId),
      now: this.now,
    });
  }

  static async open(options: RuntimeStartServiceOptions): Promise<RuntimeStartService> {
    const service = new RuntimeStartService(options);
    if (options.recoverOnOpen ?? true) await service.recover();
    return service;
  }

  listSources(): RuntimeHostSourceSummary[] {
    return this.sources.list();
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
    materializationId: string | null;
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
    const materializationId = request.materializationId ?? null;
    if (materializationId !== null) {
      const artifacts = await loadMemoryReviewArtifacts(this.reviewedMemoryStore);
      const present = artifacts.some(
        (artifact) =>
          artifact !== null &&
          typeof artifact === "object" &&
          !Array.isArray(artifact) &&
          (artifact as { materialization_id?: unknown }).materialization_id === materializationId,
      );
      if (!present) {
        throw new RuntimeHostError(
          "invalid_start_request",
          "The requested memory materialization is not present in the host memory review store.",
          400,
        );
      }
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
    const command = createRuntimeStartCommand(loadedSource.session, analysisRequest, { materializationId });
    const runtimeId = this.runtimeIdForCommand(command.commandId);
    const sourceArtifactId = createSourceArtifactId(runtimeId, loadedSource.descriptor);
    const plan = createRuntimePlan({
      runtimeId,
      sourceSession: loadedSource.session,
      sourceArtifactId,
      analysisRequest,
      materializationId,
    });
    return { loadedSource, analysisRequest, plan, materializationId };
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
      prepared.materializationId,
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
    materializationId: string | null,
  ): Promise<RuntimeHostStartAcknowledgement> {
    const acceptedAt = this.now().toISOString();
    const requestContentId = `sha256:${canonicalSha256({
      sourceRevisionId: loadedSource.session.revisionId,
      analysisRequest,
      workPlan: plan.workPlan,
      forecastContentId: plan.forecast.content.contentId,
      materializationId,
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
        const status = await this.lifecycle.statusFromRecord(existingRecord);
        if (status.runStartReceipt !== null || status.terminal) return this.acknowledgement(status);
        await new Promise((resolve) => setTimeout(resolve, 10));
        existingRecord = (await this.store.read(plan.commandId)) ?? existingRecord;
      }
      return this.acknowledgement(await this.lifecycle.statusFromRecord(existingRecord));
    }

    let record = await this.lifecycle.replaceLifecycle(claim.record, "initializing", null);
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
        materializationId,
      });
      if (
        initialized.sourceArtifact.id !== plan.sourceArtifactId ||
        initialized.runStart.forecast.content.contentId !== plan.forecast.content.contentId
      ) {
        throw new Error("The initialized runtime does not match its reviewed source artifact and forecast.");
      }
      const receiptContent = await identifyFile(paths.runStartPath);
      record = await this.lifecycle.replaceLifecycle(
        record,
        "initializing",
        null,
        0,
        initialized.runStart,
        receiptContent.contentId,
      );
    } catch (error) {
      record = await this.lifecycle.replaceLifecycle(record, "failed", {
        code: "initialization_failed",
        message: "The host could not durably initialize the accepted runtime.",
      });
      return this.acknowledgement(await this.lifecycle.statusFromRecord(record));
    }

    const launchWon = await this.store.claimLaunch(plan.commandId, {
      schema: "studio.local-runtime-launch-claim.v1",
      hostInstanceId: this.hostInstanceId,
      processId: process.pid,
      claimedAt: this.now().toISOString(),
    });
    if (!launchWon) {
      record = await this.lifecycle.replaceLifecycle(record, "interrupted", {
        code: "executor_launch_unconfirmed",
        message: "A launch claim already exists and the host will not start another executor.",
      });
      return this.acknowledgement(await this.lifecycle.statusFromRecord(record));
    }

    void this.execute(record, initialized, materializationId).catch(() => undefined);
    return this.acknowledgement(await this.lifecycle.statusFromRecord(record));
  }

  private async execute(
    record: RuntimeHostCommandRecord,
    initialized: InitializedRuntimeApplication,
    materializationId: string | null,
  ): Promise<void> {
    try {
      const reviewedMemory = materializationId === null
        ? undefined
        : {
          artifacts: await loadMemoryReviewArtifacts(this.reviewedMemoryStore),
          materializationId,
          consumedAt: this.now().toISOString(),
          record: async (receipt: MemoryConsumptionReceipt) => {
            await recordMemoryConsumptionReceipt(this.reviewedMemoryStore, receipt);
          },
        };
      await runBoundedRuntimeApplication(
        initialized,
        this.launcherFactory,
        this.orchestratorLauncherFactory,
        this.studyContractVersion,
        reviewedMemory ? { reviewedMemory } : {},
      );
      await this.lifecycle.reconcile(record, false);
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
        await this.lifecycle.replaceLifecycle(current, "interrupted", {
          code: "executor_interrupted",
          message: "The executor stopped without terminal runtime evidence and will not be relaunched automatically.",
        }, journal.head);
      } else {
        const journal = await readValidatedRuntimeJournal(
          this.store.paths(current.runtimeId).journalPath,
          current.runtimeId,
        ).catch(() => null);
        const evidence = journal ? lifecycleFromRuntimeEvidence(journal.state) : null;
        await this.lifecycle.replaceLifecycle(
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

  private acknowledgement(status: RuntimeHostStatus): RuntimeHostStartAcknowledgement {
    return { ...status, schema: "studio.local-runtime-start-ack.v1" };
  }

  async statusByCommand(commandId: string): Promise<RuntimeHostStatus> {
    const record = await this.store.read(commandId);
    if (!record) throw new RuntimeHostError("unknown_command", "The runtime command is unknown.", 404);
    return this.lifecycle.statusFromRecord(record);
  }

  async statusByRuntime(runtimeId: string): Promise<RuntimeHostStatus> {
    const record = await this.store.findByRuntimeId(runtimeId);
    if (!record) throw new RuntimeHostError("unknown_runtime", "The runtime identity is unknown.", 404);
    return this.lifecycle.statusFromRecord(record);
  }

  async poll(runtimeId: string, after: number, limit: number): Promise<RuntimeHostPollResponse> {
    const record = await this.store.findByRuntimeId(runtimeId);
    if (!record) throw new RuntimeHostError("unknown_runtime", "The runtime identity is unknown.", 404);
    const reconciled = await this.lifecycle.reconcile(record, false);
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
    return this.queries.assessmentAudits(runtimeId);
  }

  async decisionReceipts(runtimeId: string): Promise<RuntimeHostDecisionReceiptResponse> {
    return this.queries.decisionReceipts(runtimeId);
  }

  async publishReviewIntakes(runtimeId: string): Promise<RuntimeHostPublishReviewIntakeResponse> {
    return this.queries.publishReviewIntakes(runtimeId);
  }

  async publishReviewDecisions(runtimeId: string): Promise<RuntimeHostPublishReviewDecisionResponse> {
    return this.queries.publishReviewDecisions(runtimeId);
  }

  async createPublishReviewDecision(
    runtimeId: string,
    value: unknown,
  ): Promise<RuntimeHostPublishReviewDecisionResponse> {
    return this.reviewCaption.createPublishReviewDecision(runtimeId, value);
  }

  async createPublishReviewRevocation(
    runtimeId: string,
    value: unknown,
  ): Promise<RuntimeHostPublishReviewDecisionResponse> {
    return this.reviewCaption.createPublishReviewRevocation(runtimeId, value);
  }

  async captionProductions(runtimeId: string): Promise<RuntimeHostCaptionProductionResponse> {
    return this.queries.captionProductions(runtimeId);
  }

  async captionProductionResults(
    runtimeId: string,
  ): Promise<RuntimeHostCaptionProductionResultsResponse> {
    return this.queries.captionProductionResults(runtimeId);
  }

  async captionQualityControls(runtimeId: string): Promise<RuntimeHostCaptionQualityControlResponse> {
    return this.queries.captionQualityControls(runtimeId);
  }

  async createCaptionQualityControl(
    runtimeId: string,
    value: unknown,
  ): Promise<RuntimeHostCaptionQualityControlResponse> {
    return this.reviewCaption.createCaptionQualityControl(runtimeId, value);
  }

  async createCaptionProduction(
    runtimeId: string,
    value: unknown,
  ): Promise<RuntimeHostCaptionProductionResponse> {
    return this.reviewCaption.createCaptionProduction(runtimeId, value);
  }

  async languageExplanations(runtimeId: string): Promise<RuntimeHostLanguageExplanationResponse> {
    return this.queries.languageExplanations(runtimeId);
  }

  async createLanguageExplanation(
    runtimeId: string,
    value: unknown,
  ): Promise<RuntimeHostLanguageExplanationResponse> {
    return this.languageExplanation.create(runtimeId, value);
  }

  async spanTranslations(runtimeId: string): Promise<RuntimeHostSpanTranslationResponse> {
    return this.queries.spanTranslations(runtimeId);
  }

  async createSpanTranslation(
    runtimeId: string,
    value: unknown,
  ): Promise<RuntimeHostSpanTranslationResponse> {
    return this.spanTranslation.create(runtimeId, value);
  }

  async learningPreps(runtimeId: string): Promise<RuntimeHostLearningPrepResponse> {
    return this.queries.learningPreps(runtimeId);
  }

  async createLearningPrep(
    runtimeId: string,
    value: unknown,
  ): Promise<RuntimeHostLearningPrepResponse> {
    return this.learningPrep.create(runtimeId, value);
  }

  async createPrivatePlaybackGrant(
    runtimeId: string,
    value: unknown,
    origin: string,
  ): Promise<RuntimeHostPrivatePlaybackGrant> {
    return this.privatePlayback.create(runtimeId, value, origin);
  }

  async revokePrivatePlaybackGrant(
    runtimeId: string,
    grantId: string,
    value: unknown,
    origin: string,
  ): Promise<RuntimeHostPrivatePlaybackGrantRevocationResponse> {
    return this.privatePlayback.revoke(runtimeId, grantId, value, origin);
  }

  async privatePlaybackMedia(
    grantId: string,
    secret: string,
    origin: string,
  ): Promise<PrivatePlaybackMediaResource> {
    return this.privatePlayback.media(grantId, secret, origin);
  }

  async recover(): Promise<void> {
    for (const record of await this.store.list()) {
      const reconciled = await this.lifecycle.reconcile(record, true);
      // Unreadable journals are quarantined as failed; do not open them for language recovery.
      if (reconciled.lifecycle === "failed" && reconciled.reason?.code === "malformed_journal") {
        continue;
      }
      if (reconciled.journalHead > 0) {
        await this.languageExplanation.recoverInterrupted(record.runtimeId);
        await this.learningPrep.recoverInterrupted(record.runtimeId);
        await this.spanTranslation.recoverInterrupted(record.runtimeId);
      }
    }
  }
}
