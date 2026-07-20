import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";

import AgentMark from "../AgentMark";
import { ORCHESTRATOR_IDENTITY } from "../agentIdentity";
import LifecycleBottomBar from "../LifecycleBottomBar";
import { initialRequest, type AnalysisRequest } from "../preflight/model";
import {
  ConversationValue,
  PreparationControlShelf,
  PreparationStagePopover,
  StageConversation,
  TimestampField,
  continueActionLabel,
  formatTimestamp,
} from "../preflight/preparationKit";
import PreparationStageNavigation, {
  PREPARATION_STAGES,
  preparationStageIndex,
  type PreparationStage,
} from "../preflight/PreparationStages";
import {
  focusResultTarget,
  PRODUCTION_CAPTION_RESULTS_ID,
} from "../resultAccess";
import type { EvidenceAssessmentAudit } from "../runtime/production/assessmentAudit";
import type { EvidenceDecisionReceiptVerification } from "../runtime/production/decisionReceiptAudit";
import type { PublishReviewIntakeVerification } from "../runtime/production/publishReviewIntakeAudit";
import type { PublishReviewDecisionVerification } from "../runtime/production/publishReviewDecisionAudit";
import type {
  CaptionProductionVerification,
  VerifiedCaptionProductionResult,
} from "../runtime/production/captionProductionAudit";
import type {
  OwnedMediaIngestStatus,
  RuntimeHostCaptionProductionRequest,
  RuntimeHostPlanResponse,
  RuntimeHostPublishReviewDecisionRequest,
  RuntimeHostPublishReviewOperator,
  RuntimeHostPublishReviewRevocationRequest,
  RuntimeHostSourceSummary,
  RuntimeHostStartRequest,
  YouTubeLocalIngestStatus,
} from "../runtime/production/runtimeHost/model";
// Type-only: the ProductionStudioAdapter *value* pulls the server runtime (node:crypto via the
// artifact store) which cannot load in the browser. It is instantiated behind a dynamic import at
// its single call site so it never enters the client's initial bundle and StudioApp can hydrate.
import type {
  ProductionStudioAdapter,
  ProductionStudioProjection,
} from "../runtime/production/studioProjection";
import { LocalRuntimeHostClient } from "./client";
import ProductionProcessingCanvas from "./ProductionProcessingCanvas";
import ProductionProcessingMock, { type ProcessingMockScenario } from "./ProductionProcessingMock";
import ProductionCaptionResults from "./ProductionCaptionResults";
import RunViewSwitch, { type RunView } from "../viewer/RunViewSwitch";
import {
  isLocalRuntimeLanguageTag,
  mapAnalysisRequestToRuntimeStart,
  projectLocalRuntimeLifecycle,
} from "./model";
import { ProductionJournalFacts } from "./productProductionFacts";
import {
  defaultHostUrl,
  errorMessage,
  seconds,
  statusView,
  type RuntimeStatusView,
} from "./productLocalRuntimeShared";

// Direct leaf imports so Vite invalidates each sheet; a CSS @import barrel can serve stale CSS until HMR.
import "./productLocalRuntime.shell.css";
import "./productLocalRuntime.ingest.css";
import "./productLocalRuntime.forecast.css";
import "./productLocalRuntime.processing-canvas.css";
import "./productLocalRuntime.coordination-ledger.css";
import "./productLocalRuntime.captions-qc.css";
import "./productLocalRuntime.responsive.css";

type Busy = "connect" | "ingest" | "plan" | "start" | null;
export type ProductLocalSourceMode = "owned" | "youtube";

interface ReviewedPlan {
  request: RuntimeHostStartRequest;
  response: RuntimeHostPlanResponse;
}
interface RuntimeView {
  status: RuntimeStatusView;
  production: ProductionStudioProjection;
  assessmentAudits: EvidenceAssessmentAudit[];
  decisionReceipts: EvidenceDecisionReceiptVerification[];
  publishReviewIntakes: PublishReviewIntakeVerification[];
  publishReviewDecisions: PublishReviewDecisionVerification[];
  captionProductions: CaptionProductionVerification[];
  captionResults: VerifiedCaptionProductionResult[];
  reviewOperator: RuntimeHostPublishReviewOperator | null;
  cursor: number;
  eventCount: number;
  lastEventType: string | null;
  pollState: "idle" | "polling" | "healthy" | "complete" | "error";
  pollMessage: string;
}

export default function ProductLocalRuntime({
  onClose,
  processingMock = null,
  sourceMode = "owned",
}: {
  onClose: () => void;
  processingMock?: ProcessingMockScenario | null;
  sourceMode?: ProductLocalSourceMode;
}) {
  const [baseUrl, setBaseUrl] = useState(defaultHostUrl);
  const [token, setToken] = useState("");
  const [client, setClient] = useState<LocalRuntimeHostClient | null>(null);
  const [sources, setSources] = useState<RuntimeHostSourceSummary[]>([]);
  const [sourceId, setSourceId] = useState("");
  const [ownedFile, setOwnedFile] = useState<File | null>(null);
  const [sourceLabel, setSourceLabel] = useState("");
  const [rightsHolder, setRightsHolder] = useState("");
  const [ownershipAttested, setOwnershipAttested] = useState(false);
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [youtubeStartSeconds, setYoutubeStartSeconds] = useState(0);
  const [youtubeEndSeconds, setYoutubeEndSeconds] = useState(120);
  const [youtubeLocalProcessingConfirmed, setYoutubeLocalProcessingConfirmed] = useState(false);
  const [ingest, setIngest] = useState<OwnedMediaIngestStatus | YouTubeLocalIngestStatus | null>(null);
  const [analysisRequest, setAnalysisRequest] = useState<AnalysisRequest>(() => initialRequest("en", 0));
  const [sourceLanguage, setSourceLanguage] = useState("");
  const [languagePackId, setLanguagePackId] = useState("");
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const [reviewed, setReviewed] = useState<ReviewedPlan | null>(null);
  const [runtime, setRuntime] = useState<RuntimeView | null>(null);
  const [reviewBusy, setReviewBusy] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [captionBusy, setCaptionBusy] = useState(false);
  const [captionError, setCaptionError] = useState<string | null>(null);
  const [setupStage, setSetupStage] = useState<PreparationStage>("source");
  const [furthestSetupStage, setFurthestSetupStage] = useState(0);
  const pollGeneration = useRef(0);
  const ingestGeneration = useRef(0);
  const productionAdapter = useRef<ProductionStudioAdapter | null>(null);
  const evidenceDetails = useRef<HTMLDetailsElement | null>(null);
  const runtimeRoot = useRef<HTMLElement | null>(null);
  const setupHeading = useRef<HTMLHeadingElement | null>(null);
  // The source stage keeps only its spoken heading in the panel; the path note and the
  // host connect/ingest controls open as popovers from the shelf, matching the standard flow.
  const [openSourcePopover, setOpenSourcePopover] = useState<"about" | "host" | null>(null);
  const aboutTrigger = useRef<HTMLButtonElement>(null);
  const hostTrigger = useRef<HTMLButtonElement>(null);
  const [runtimeView, setRuntimeView] = useState<RunView>("process");
  const focusedResultOnArrival = useRef(false);

  const requiredSourceKind = sourceMode === "youtube" ? "youtube_local" : "owned_local";
  const visibleSources = sources.filter((source) => source.sourceKind === requiredSourceKind);
  const selectedSource = visibleSources.find((source) => source.sourceSessionId === sourceId) ?? null;
  const lifecycle = runtime
    ? projectLocalRuntimeLifecycle(runtime.status.lifecycle, runtime.status.reason)
    : null;
  const hasCaptionResults = runtime !== null && runtime.captionResults.length > 0;

  // Result becomes the default exactly once, when the first host-verified caption result of this
  // runtime arrives; a learner who then chooses Process is not yanked back by later results.
  useEffect(() => {
    if (!hasCaptionResults) {
      focusedResultOnArrival.current = false;
      setRuntimeView("process");
      return;
    }
    if (!focusedResultOnArrival.current) {
      focusedResultOnArrival.current = true;
      setRuntimeView("result");
    }
  }, [hasCaptionResults]);
  const rangeValid = client !== null &&
    selectedSource !== null &&
    Number.isFinite(analysisRequest.start) &&
    Number.isFinite(analysisRequest.end) &&
    analysisRequest.start >= 0 &&
    analysisRequest.end > analysisRequest.start &&
    Math.round(analysisRequest.end * 1_000) <= selectedSource.durationMs;
  const languageValid = isLocalRuntimeLanguageTag(sourceLanguage) &&
    isLocalRuntimeLanguageTag(analysisRequest.targetLanguage);
  const requestValid = rangeValid && languageValid;
  const ownedIngestValid = sourceMode === "owned" && client !== null &&
    ownedFile !== null &&
    sourceLabel.trim().length > 0 &&
    rightsHolder.trim().length > 0 &&
    ownershipAttested &&
    (ingest === null || ingest.status === "failed") &&
    busy === null;
  let youtubeUrlValid = false;
  try {
    const parsed = new URL(youtubeUrl);
    youtubeUrlValid = parsed.protocol === "https:" &&
      new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"]).has(parsed.hostname);
  } catch {
    youtubeUrlValid = false;
  }
  const youtubeIngestValid = sourceMode === "youtube" && client !== null && youtubeUrlValid &&
    Number.isFinite(youtubeStartSeconds) && Number.isFinite(youtubeEndSeconds) &&
    youtubeStartSeconds >= 0 && youtubeEndSeconds > youtubeStartSeconds &&
    youtubeEndSeconds - youtubeStartSeconds <= 120 &&
    youtubeLocalProcessingConfirmed &&
    (ingest === null || ingest.status === "failed") && busy === null;

  useEffect(() => () => {
    pollGeneration.current += 1;
    ingestGeneration.current += 1;
  }, []);

  useEffect(() => {
    if (!runtime?.status.runtimeId) return;
    runtimeRoot.current?.scrollTo({ top: 0, behavior: "auto" });
  }, [runtime?.status.runtimeId]);

  function stopPolling(): void {
    pollGeneration.current += 1;
  }

  function clearReviewedState(): void {
    stopPolling();
    productionAdapter.current = null;
    setReviewed(null);
    setRuntime(null);
    setError(null);
    setReviewBusy(false);
    setReviewError(null);
    setCaptionBusy(false);
    setCaptionError(null);
  }

  function disconnect(): void {
    clearReviewedState();
    ingestGeneration.current += 1;
    setClient(null);
    setSources([]);
    setSourceId("");
    setIngest(null);
    setBusy(null);
    setSetupStage("source");
    setFurthestSetupStage(0);
  }

  async function connect(): Promise<void> {
    stopPolling();
    productionAdapter.current = null;
    setBusy("connect");
    setError(null);
    setReviewed(null);
    setRuntime(null);
    try {
      const nextClient = new LocalRuntimeHostClient({ baseUrl, token });
      const nextSources = await nextClient.listSourceSessions();
      setBaseUrl(nextClient.baseUrl);
      setClient(nextClient);
      setSources(nextSources);
      const first = nextSources.find((source) => source.sourceKind === requiredSourceKind) ?? null;
      setSourceId(first?.sourceSessionId ?? "");
      setAnalysisRequest(initialRequest("en", (first?.durationMs ?? 0) / 1_000));
    } catch (nextError) {
      setClient(null);
      setSources([]);
      setSourceId("");
      setError(errorMessage(nextError));
    } finally {
      setBusy(null);
    }
  }

  function chooseSource(nextId: string): void {
    const next = visibleSources.find((source) => source.sourceSessionId === nextId);
    if (!next) return;
    clearReviewedState();
    setSourceId(nextId);
    setSourceLanguage("");
    setLanguagePackId("");
    setAnalysisRequest(initialRequest("en", next.durationMs / 1_000));
  }

  async function ingestOwnedMedia(): Promise<void> {
    if (!client || !ownedFile || !ownedIngestValid) return;
    stopPolling();
    productionAdapter.current = null;
    const generation = ++ingestGeneration.current;
    setBusy("ingest");
    setError(null);
    setReviewed(null);
    setRuntime(null);
    setIngest(null);
    try {
      let status = await client.createOwnedMediaIngest({
        filename: ownedFile.name,
        declaredBytes: ownedFile.size,
        label: sourceLabel.trim(),
        rightsHolder: rightsHolder.trim(),
        rightsScope: "local_processing",
        ownershipAttested: true,
      });
      if (generation !== ingestGeneration.current) return;
      setIngest(status);
      status = await client.uploadOwnedMedia(status.ingestId, ownedFile);
      if (generation !== ingestGeneration.current) return;
      setIngest(status);

      while (status.status !== "registered" && status.status !== "failed") {
        await new Promise((resolve) => window.setTimeout(resolve, 150));
        status = await client.ownedMediaIngestStatus(status.ingestId);
        if (generation !== ingestGeneration.current) return;
        setIngest(status);
      }
      if (status.status === "failed" || !status.source) return;
      if (status.source.sourceKind !== "owned_local") {
        throw new Error("The owned ingest returned a different source authority.");
      }

      const nextSources = await client.listSourceSessions();
      if (generation !== ingestGeneration.current) return;
      const registered = nextSources.find((source) =>
        source.sourceSessionId === status.source?.sourceSessionId &&
        source.sourceRevisionId === status.source?.sourceRevisionId
      );
      if (!registered) throw new Error("The registered ingest is absent from the host source list.");
      setSources(nextSources);
      setSourceId(registered.sourceSessionId);
      setSourceLanguage("");
      setLanguagePackId("");
      setAnalysisRequest(initialRequest("en", registered.durationMs / 1_000));
    } catch (nextError) {
      if (generation === ingestGeneration.current) setError(errorMessage(nextError));
    } finally {
      if (generation === ingestGeneration.current) setBusy(null);
    }
  }

  async function ingestYouTubeLocal(): Promise<void> {
    if (!client || !youtubeIngestValid) return;
    stopPolling();
    productionAdapter.current = null;
    const generation = ++ingestGeneration.current;
    setBusy("ingest");
    setError(null);
    setReviewed(null);
    setRuntime(null);
    setIngest(null);
    try {
      let status = await client.createYouTubeLocalIngest({
        url: youtubeUrl,
        startMs: Math.round(youtubeStartSeconds * 1_000),
        endMs: Math.round(youtubeEndSeconds * 1_000),
        localProcessingConfirmed: true,
      });
      if (generation !== ingestGeneration.current) return;
      setIngest(status);
      while (status.status !== "registered" && status.status !== "failed") {
        await new Promise((resolve) => window.setTimeout(resolve, 150));
        status = await client.youtubeLocalIngestStatus(status.ingestId);
        if (generation !== ingestGeneration.current) return;
        setIngest(status);
      }
      if (status.status === "failed" || !status.source) return;
      if (status.source.sourceKind !== "youtube_local") {
        throw new Error("The YouTube-local ingest returned a different source authority.");
      }
      const nextSources = await client.listSourceSessions();
      if (generation !== ingestGeneration.current) return;
      const registered = nextSources.find((source) =>
        source.sourceKind === "youtube_local" &&
        source.sourceSessionId === status.source?.sourceSessionId &&
        source.sourceRevisionId === status.source?.sourceRevisionId
      );
      if (!registered) throw new Error("The registered YouTube ingest is absent from the host source list.");
      setSources(nextSources);
      setSourceId(registered.sourceSessionId);
      setSourceLanguage("");
      setLanguagePackId("");
      setAnalysisRequest(initialRequest("en", registered.durationMs / 1_000));
    } catch (nextError) {
      if (generation === ingestGeneration.current) setError(errorMessage(nextError));
    } finally {
      if (generation === ingestGeneration.current) setBusy(null);
    }
  }

  function updateRequest(update: Partial<AnalysisRequest>): void {
    clearReviewedState();
    setAnalysisRequest((current) => ({ ...current, ...update }));
  }

  function buildRequest(): RuntimeHostStartRequest {
    if (!selectedSource) throw new Error("Select a registered local source first.");
    return mapAnalysisRequestToRuntimeStart({
      source: selectedSource,
      analysisRequest,
      requestedSourceLanguage: { mode: "declared", languages: [sourceLanguage], reason: null },
      selectedLanguagePackId: languagePackId.trim() || null,
    });
  }

  async function reviewPlan(): Promise<boolean> {
    if (!client) return false;
    stopPolling();
    productionAdapter.current = null;
    setBusy("plan");
    setError(null);
    setRuntime(null);
    try {
      const request = buildRequest();
      const response = await client.plan(request);
      setReviewed({ request, response });
      return true;
    } catch (nextError) {
      setReviewed(null);
      setError(errorMessage(nextError));
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function beginPolling(
    activeClient: LocalRuntimeHostClient,
    identity: RuntimeStatusView,
    cursor: number,
    adapter: ProductionStudioAdapter,
  ): Promise<void> {
    const generation = ++pollGeneration.current;
    setRuntime((current) => current && current.status.runtimeId === identity.runtimeId
      ? { ...current, pollState: "polling", pollMessage: `Polling after cursor ${cursor}.` }
      : current);
    let after = cursor;
    while (generation === pollGeneration.current) {
      try {
        const status = await activeClient.status(identity.runtimeId);
        if (generation !== pollGeneration.current) return;
        if (
          status.commandId !== identity.commandId ||
          status.runtimeId !== identity.runtimeId ||
          status.journalId !== identity.journalId
        ) {
          throw new Error("Runtime host status identities changed while polling.");
        }
        const poll = await activeClient.poll(identity.runtimeId, after);
        if (generation !== pollGeneration.current) return;
        if (poll.commandId !== identity.commandId) {
          throw new Error("Runtime host event polling returned another command identity.");
        }
        const [assessmentAudit, decisionReceiptResponse, publishReviewIntakeResponse, publishReviewDecisionResponse, captionProductionResponse] = await Promise.all([
          activeClient.assessmentAudits(identity.runtimeId),
          activeClient.decisionReceipts(identity.runtimeId),
          activeClient.publishReviewIntakes(identity.runtimeId),
          activeClient.publishReviewDecisions(identity.runtimeId),
          activeClient.captionProductions(identity.runtimeId),
        ]);
        const captionProductionResultsResponse = captionProductionResponse.captions.length > 0
          ? await activeClient.captionProductionResults(identity.runtimeId)
          : null;
        if (
          assessmentAudit.commandId !== identity.commandId ||
          assessmentAudit.runtimeId !== identity.runtimeId ||
          assessmentAudit.journalHead < poll.nextCursor
        ) {
          throw new Error("Runtime host assessment audit identities changed while polling.");
        }
        if (
          decisionReceiptResponse.commandId !== identity.commandId ||
          decisionReceiptResponse.runtimeId !== identity.runtimeId ||
          decisionReceiptResponse.journalHead < poll.nextCursor
        ) {
          throw new Error("Runtime host decision receipt identities changed while polling.");
        }
        if (
          publishReviewIntakeResponse.commandId !== identity.commandId ||
          publishReviewIntakeResponse.runtimeId !== identity.runtimeId ||
          publishReviewIntakeResponse.journalHead < poll.nextCursor
        ) {
          throw new Error("Runtime host publish-review intake identities changed while polling.");
        }
        if (
          publishReviewDecisionResponse.commandId !== identity.commandId ||
          publishReviewDecisionResponse.runtimeId !== identity.runtimeId ||
          publishReviewDecisionResponse.journalHead < poll.nextCursor
        ) {
          throw new Error("Runtime host publish-review decision identities changed while polling.");
        }
        if (
          captionProductionResponse.commandId !== identity.commandId ||
          captionProductionResponse.runtimeId !== identity.runtimeId ||
          captionProductionResponse.journalHead < poll.nextCursor
        ) {
          throw new Error("Runtime host caption-production identities changed while polling.");
        }
        if (
          captionProductionResultsResponse &&
          (
            captionProductionResultsResponse.commandId !== identity.commandId ||
            captionProductionResultsResponse.runtimeId !== identity.runtimeId ||
            captionProductionResultsResponse.journalHead < poll.nextCursor
          )
        ) {
          throw new Error("Runtime host production-caption result identities changed while polling.");
        }
        if (adapter.view().lastSeq !== after) {
          throw new Error("Production adapter cursor changed outside the validated poll path.");
        }
        const production = adapter.appendBatch(poll.events);
        if (production.lastSeq !== poll.nextCursor) {
          throw new Error("Production adapter cursor does not match the validated host cursor.");
        }
        const completedAssessments = production.evidenceAssessments.filter((assessment) =>
          assessment.status === "completed");
        const visibleAssessmentAudits = assessmentAudit.audits.filter((audit) =>
          completedAssessments.some((assessment) => assessment.operationId === audit.operationId));
        if (visibleAssessmentAudits.length !== completedAssessments.length) {
          throw new Error("A completed assessment has no reopened fail-closed receipt audit.");
        }
        const completedDecisions = production.evidenceDecisions.filter((decision) =>
          decision.status === "completed");
        const visibleDecisionReceipts = decisionReceiptResponse.decisions.filter((decision) =>
          completedDecisions.some((projected) => projected.operationId === decision.operationId));
        if (visibleDecisionReceipts.length !== completedDecisions.length) {
          throw new Error("A completed evidence decision has no reopened fail-closed receipt verification.");
        }
        const completedIntakes = production.publishReviewIntakes.filter((intake) =>
          intake.status === "completed");
        const visiblePublishReviewIntakes = publishReviewIntakeResponse.intakes.filter((intake) =>
          completedIntakes.some((projected) => projected.intakeId === intake.intakeId));
        if (visiblePublishReviewIntakes.length !== completedIntakes.length) {
          throw new Error("A completed publish-review intake has no reopened fail-closed receipt verification.");
        }
        const completedReviews = production.publishReviewDecisions.filter((review) =>
          review.status === "completed");
        const visiblePublishReviewDecisions = publishReviewDecisionResponse.reviews.filter((review) =>
          completedReviews.some((projected) => projected.reviewId === review.reviewId));
        if (visiblePublishReviewDecisions.length !== completedReviews.length) {
          throw new Error("A completed publish-review decision has no reopened fail-closed receipt verification.");
        }
        const completedRevocations = production.publishReviewRevocations.filter((revocation) =>
          revocation.status === "completed");
        const visibleRevocations = visiblePublishReviewDecisions.flatMap((review) =>
          review.revocation ? [review.revocation] : []);
        if (
          visibleRevocations.length !== completedRevocations.length ||
          completedRevocations.some((projected) =>
            !visibleRevocations.some((revocation) => revocation.revocationId === projected.revocationId))
        ) {
          throw new Error("A completed publish-review revocation has no reopened fail-closed receipt verification.");
        }
        const completedCaptions = production.captionProductions.filter((job) => job.status === "completed");
        const visibleCaptionProductions = captionProductionResponse.captions.filter((caption) =>
          completedCaptions.some((job) =>
            job.jobId === caption.jobId &&
            job.captionArtifactId === caption.captionArtifactId &&
            job.captionContentId === caption.captionContentId &&
            job.receiptArtifactId === caption.receiptArtifactId &&
            job.receiptId === caption.receiptId &&
            job.receiptContentId === caption.receiptContentId));
        if (visibleCaptionProductions.length !== completedCaptions.length) {
          throw new Error("A completed caption job has no reopened fail-closed artifact and receipt verification.");
        }
        const visibleCaptionResults = (captionProductionResultsResponse?.results ?? []).filter((result) =>
          visibleCaptionProductions.some((caption) =>
            JSON.stringify(caption) === JSON.stringify(result.verification)));
        if (
          visibleCaptionResults.length !== visibleCaptionProductions.length ||
          visibleCaptionResults.length !== (captionProductionResultsResponse?.results.length ?? 0)
        ) {
          throw new Error("A verified caption job has no matching host-verified timed production result.");
        }
        after = poll.nextCursor;
        setRuntime((current) => {
          if (!current || current.status.runtimeId !== identity.runtimeId) return current;
          return {
            ...current,
            production,
            assessmentAudits: visibleAssessmentAudits,
            decisionReceipts: visibleDecisionReceipts,
            publishReviewIntakes: visiblePublishReviewIntakes,
            publishReviewDecisions: visiblePublishReviewDecisions,
            captionProductions: visibleCaptionProductions,
            captionResults: visibleCaptionResults,
            reviewOperator: publishReviewDecisionResponse.reviewer,
            status: {
              ...statusView(status),
              lifecycle: poll.lifecycle,
              reason: poll.reason,
              journalHead: poll.journalHead,
              terminal: poll.terminal,
            },
            cursor: poll.nextCursor,
            eventCount: current.eventCount + poll.events.length,
            lastEventType: poll.events.at(-1)?.type ?? current.lastEventType,
            pollState: poll.terminal && poll.reachedHead ? "complete" : "healthy",
            pollMessage: poll.terminal && poll.reachedHead
              ? `Closed at validated journal head ${poll.journalHead}.`
              : poll.reachedHead
                ? `Healthy at validated journal head ${poll.journalHead}.`
                : `Consumed through cursor ${poll.nextCursor}; journal head is ${poll.journalHead}.`,
          };
        });
        if (poll.terminal && poll.reachedHead) return;
        await new Promise((resolve) => window.setTimeout(resolve, poll.reachedHead ? 700 : 80));
      } catch (pollError) {
        if (generation !== pollGeneration.current) return;
        setRuntime((current) => current && current.status.runtimeId === identity.runtimeId
          ? {
              ...current,
              assessmentAudits: [],
              decisionReceipts: [],
              publishReviewIntakes: [],
              publishReviewDecisions: [],
              captionProductions: [],
              captionResults: [],
              pollState: "error",
              pollMessage: `Polling stopped after cursor ${current.cursor}: ${errorMessage(pollError)}`,
            }
          : current);
        return;
      }
    }
  }

  async function start(): Promise<void> {
    if (!client || !reviewed) return;
    stopPolling();
    setBusy("start");
    setError(null);
    try {
      const acknowledgement = await client.start(reviewed.request);
      if (
        acknowledgement.commandId !== reviewed.response.commandId ||
        acknowledgement.runtimeId !== reviewed.response.runtimeId ||
        acknowledgement.analysisRequestId !== reviewed.response.analysisRequestId
      ) {
        throw new Error("Accepted runtime identities do not match the reviewed plan.");
      }
      if (
        acknowledgement.forecast &&
        acknowledgement.forecast.contentId !== reviewed.response.forecast.content.contentId
      ) {
        throw new Error("The frozen runtime forecast does not match the reviewed forecast content.");
      }
      const { ProductionStudioAdapter } = await import("../runtime/production/studioProjection");
      const adapter = new ProductionStudioAdapter(acknowledgement.runtimeId);
      const nextRuntime: RuntimeView = {
        status: statusView(acknowledgement),
        production: adapter.view(),
        assessmentAudits: [],
        decisionReceipts: [],
        publishReviewIntakes: [],
        publishReviewDecisions: [],
        captionProductions: [],
        captionResults: [],
        reviewOperator: null,
        cursor: 0,
        eventCount: 0,
        lastEventType: null,
        pollState: "idle",
        pollMessage: acknowledgement.runStartReceipt
          ? "Start accepted and exact reviewed forecast frozen; event cursor begins at 0."
          : "Start was accepted, but no frozen forecast or journal was initialized.",
      };
      productionAdapter.current = adapter;
      setRuntime(nextRuntime);
      if (acknowledgement.runStartReceipt) {
        void beginPolling(client, nextRuntime.status, 0, adapter);
      }
    } catch (nextError) {
      setError(errorMessage(nextError));
    } finally {
      setBusy(null);
    }
  }

  async function submitPublishReviewDecision(
    request: RuntimeHostPublishReviewDecisionRequest,
  ): Promise<void> {
    const current = runtime;
    const adapter = productionAdapter.current;
    if (!client || !current || !adapter || reviewBusy) return;
    setReviewBusy(true);
    setReviewError(null);
    try {
      const response = await client.createPublishReviewDecision(current.status.runtimeId, request);
      if (
        response.commandId !== current.status.commandId ||
        response.runtimeId !== current.status.runtimeId ||
        response.journalHead < current.cursor
      ) throw new Error("Runtime host review decision identities changed after submission.");
      setRuntime((value) => value && value.status.runtimeId === current.status.runtimeId
        ? { ...value, publishReviewDecisions: response.reviews, reviewOperator: response.reviewer }
        : value);
      await beginPolling(client, current.status, current.cursor, adapter);
    } catch (nextError) {
      setReviewError(errorMessage(nextError));
    } finally {
      setReviewBusy(false);
    }
  }

  async function submitPublishReviewRevocation(
    request: RuntimeHostPublishReviewRevocationRequest,
  ): Promise<void> {
    const current = runtime;
    const adapter = productionAdapter.current;
    if (!client || !current || !adapter || reviewBusy) return;
    setReviewBusy(true);
    setReviewError(null);
    try {
      const response = await client.createPublishReviewRevocation(current.status.runtimeId, request);
      if (
        response.commandId !== current.status.commandId ||
        response.runtimeId !== current.status.runtimeId ||
        response.journalHead < current.cursor
      ) throw new Error("Runtime host review revocation identities changed after submission.");
      setRuntime((value) => value && value.status.runtimeId === current.status.runtimeId
        ? { ...value, publishReviewDecisions: response.reviews, reviewOperator: response.reviewer }
        : value);
      await beginPolling(client, current.status, current.cursor, adapter);
    } catch (nextError) {
      setReviewError(errorMessage(nextError));
    } finally {
      setReviewBusy(false);
    }
  }

  async function submitCaptionProduction(
    request: RuntimeHostCaptionProductionRequest,
  ): Promise<void> {
    const current = runtime;
    const adapter = productionAdapter.current;
    if (!client || !current || !adapter || captionBusy || reviewBusy) return;
    setCaptionBusy(true);
    setCaptionError(null);
    try {
      const response = await client.createCaptionProduction(current.status.runtimeId, request);
      if (
        response.commandId !== current.status.commandId ||
        response.runtimeId !== current.status.runtimeId ||
        response.journalHead < current.cursor
      ) throw new Error("Runtime host caption-production identities changed after submission.");
      setRuntime((value) => value && value.status.runtimeId === current.status.runtimeId
        ? { ...value, captionProductions: response.captions }
        : value);
      await beginPolling(client, current.status, current.cursor, adapter);
    } catch (nextError) {
      setCaptionError(errorMessage(nextError));
    } finally {
      setCaptionBusy(false);
    }
  }

  const workload = reviewed?.response.forecast.scenarios.baseline.workload ?? null;

  function openRecordedEvidence(): void {
    const details = evidenceDetails.current;
    const hasCaptionResults = (runtime?.captionResults.length ?? 0) > 0;
    window.requestAnimationFrame(() => {
      if (hasCaptionResults && focusResultTarget(PRODUCTION_CAPTION_RESULTS_ID)) return;
      if (!details) return;
      details.open = true;
      details.scrollIntoView({ block: "start", behavior: "smooth" });
    });
  }

  const currentSetupStageIndex = preparationStageIndex(setupStage);

  function selectSetupStage(nextStage: PreparationStage): void {
    if (preparationStageIndex(nextStage) <= furthestSetupStage) setSetupStage(nextStage);
  }

  function previousSetupStage(): void {
    if (currentSetupStageIndex === 0) {
      onClose();
      return;
    }
    setSetupStage(PREPARATION_STAGES[currentSetupStageIndex - 1].id);
  }

  async function submitSetupStage(): Promise<void> {
    if (setupStage === "confirm") {
      await start();
      return;
    }
    if (setupStage === "source" && !selectedSource) return;
    if (setupStage === "range" && !rangeValid) return;
    if (setupStage === "language" && !languageValid) return;
    if (setupStage === "output") {
      if (!requestValid || !(await reviewPlan())) return;
    }
    if (setupStage === "forecast" && !reviewed) return;

    const nextIndex = currentSetupStageIndex + 1;
    const nextStage = PREPARATION_STAGES[nextIndex]?.id;
    if (!nextStage) return;
    setFurthestSetupStage((current) => Math.max(current, nextIndex));
    setSetupStage(nextStage);
  }

  const setupAdvanceDisabled =
    (setupStage === "source" && !selectedSource) ||
    (setupStage === "range" && !rangeValid) ||
    (setupStage === "language" && !languageValid) ||
    (setupStage === "output" && (!requestValid || busy !== null)) ||
    (setupStage === "forecast" && !reviewed) ||
    (setupStage === "confirm" && busy !== null);

  const setupBusyCopy = busy === "connect"
    ? "Connecting local host"
    : busy === "ingest"
      ? sourceMode === "youtube" ? "Ingesting YouTube range" : "Ingesting owned media"
      : busy === "plan"
        ? "Reviewing local plan"
        : busy === "start"
          ? "Initializing local runtime"
          : null;

  if (processingMock) {
    return <ProductionProcessingMock scenario={processingMock} onClose={onClose} />;
  }

  return (
    <section
      ref={runtimeRoot}
      className="product-runtime"
      data-runtime={runtime !== null}
      data-source-mode={sourceMode}
      aria-label={runtime ? undefined : sourceMode === "youtube" ? "YouTube local source" : "Owned local source"}
      aria-labelledby={runtime ? "product-runtime-title" : undefined}
    >
      {runtime ? (
        <>
          <header className="product-runtime-header">
            <div>
              <span>Local production path · separate from replay</span>
              <h1 id="product-runtime-title">{sourceMode === "youtube" ? "YouTube local source" : "Owned local source"}</h1>
            </div>
            <button type="button" onClick={onClose}>Back to source choices</button>
          </header>
          {lifecycle && selectedSource && (
        <section
          className="product-runtime-status"
          aria-labelledby="product-runtime-status-title"
          data-production-view={hasCaptionResults ? runtimeView : undefined}
        >
          <h2 id="product-runtime-status-title" className="product-runtime-visually-hidden">Local runtime status</h2>
          {hasCaptionResults && (
            <div className="run-action-bar">
              {runtimeView === "process" && (
                <p className="run-action-note">Validated runtime state · completed local run</p>
              )}
              <RunViewSwitch view={runtimeView} onView={setRuntimeView} />
            </div>
          )}
          {/* Both views stay mounted: hiding rather than unmounting keeps the private playback
              grant, explanation, and prep session state alive without any new host request. */}
          <div className="product-runtime-process-view" hidden={hasCaptionResults && runtimeView === "result"}>
            <ProductionProcessingCanvas
              source={selectedSource}
              lifecycle={lifecycle}
              status={runtime.status}
              production={runtime.production}
              cursor={runtime.cursor}
              eventCount={runtime.eventCount}
              lastEventType={runtime.lastEventType}
              pollState={runtime.pollState}
              pollMessage={runtime.pollMessage}
              captionResultCount={runtime.captionResults.length}
              onOpenEvidence={openRecordedEvidence}
              onRetryPolling={runtime.pollState === "error" && client && productionAdapter.current
                ? () => {
                    const adapter = productionAdapter.current;
                    if (adapter) void beginPolling(client, runtime.status, runtime.cursor, adapter);
                  }
                : undefined}
              onPrepareAnotherRun={clearReviewedState}
            />

            <details
              ref={evidenceDetails}
              id="product-processing-evidence"
              className="product-runtime-evidence"
              open
            >
              <summary>
                <span>
                  <b>Recorded evidence and review controls</b>
                  <small>{runtime.eventCount} validated events · separate from replay</small>
                </span>
              </summary>
              <div className="product-runtime-evidence-boundary">
                <p>
                  Audit the host journal separately in <a href="/studio/runtime/">Production Run Explorer</a>.
                  These events are not inserted into the recorded RunBundle or its agent graph.
                </p>
                <dl>
                  <div><dt>Command</dt><dd>{runtime.status.commandId}</dd></div>
                  <div><dt>Runtime</dt><dd>{runtime.status.runtimeId}</dd></div>
                  <div><dt>Journal</dt><dd>{runtime.status.journalId}</dd></div>
                  <div><dt>Frozen forecast</dt><dd>{runtime.status.forecast?.frozenForecastId ?? "Unavailable after initialization failure"}</dd></div>
                  <div><dt>Start receipt</dt><dd>{runtime.status.runStartReceipt?.contentId ?? "Unavailable after initialization failure"}</dd></div>
                </dl>
            </div>
            <ProductionJournalFacts
              projection={runtime.production}
              assessmentAudits={runtime.assessmentAudits}
              decisionReceipts={runtime.decisionReceipts}
              publishReviewIntakes={runtime.publishReviewIntakes}
              publishReviewDecisions={runtime.publishReviewDecisions}
              captionProductions={runtime.captionProductions}
              reviewOperator={runtime.reviewOperator}
              reviewBusy={reviewBusy}
              reviewError={reviewError}
              captionBusy={captionBusy}
              captionError={captionError}
              onPublishReviewDecision={submitPublishReviewDecision}
              onPublishReviewRevocation={submitPublishReviewRevocation}
              onCaptionProduction={submitCaptionProduction}
            />
          </details>
          </div>

          <div className="product-runtime-result-view" hidden={hasCaptionResults && runtimeView === "process"}>
            <ProductionCaptionResults
              client={client}
              runtimeId={runtime.status.runtimeId}
              sourceRevisionId={runtime.status.sourceRevisionId}
              results={runtime.captionResults}
              playbackActive={!hasCaptionResults || runtimeView === "result"}
            />
          </div>
        </section>
          )}
        </>
      ) : (
        <div className="product-runtime-setup-lockup">
          <div className="product-runtime-setup-guide">
            <div className="welcome-orchestrator-anchor" aria-hidden="true">
              <div className="welcome-orchestrator-core">
                <AgentMark identity={ORCHESTRATOR_IDENTITY} status={busy ? "working" : "idle"} />
              </div>
            </div>
            <div className="welcome-guide-copy">
              <strong>{sourceMode === "youtube" ? "YouTube local guide" : "Owned media guide"}</strong>
              <span role="status" aria-live="polite">
                {client ? selectedSource ? "Source ready" : "Add a source" : "Connect local host"}
              </span>
            </div>
          </div>

          <form
            className="preflight-form product-runtime-setup-form"
            data-preparation-stage={setupStage}
            data-palette={PREPARATION_STAGES[currentSetupStageIndex].palette}
            data-furthest-stage={PREPARATION_STAGES[furthestSetupStage].id}
            onSubmit={(event) => {
              event.preventDefault();
              void submitSetupStage();
            }}
          >
            <PreparationStageNavigation currentStage={setupStage} furthestStage={furthestSetupStage} selectStage={selectSetupStage} />
            <motion.section
              className="preflight-stage-panel"
              aria-labelledby="preflight-stage-title"
              layout
              transition={{ layout: { duration: 0.32, ease: [0.22, 1, 0.36, 1] } }}
            >
              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={setupStage}
                  className="preflight-stage-body"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -5 }}
                  transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
                  onAnimationComplete={() => setupHeading.current?.focus({ preventScroll: true })}
                >
                  {setupStage === "source" && (
                    <section className="preflight-preparation preflight-source-stage product-runtime-source">
                      <div className="preflight-source-conversation" role="note" aria-label={sourceMode === "youtube" ? "YouTube local source boundary" : "Owned local source boundary"}>
                        <h2 ref={setupHeading} id="preflight-stage-title" tabIndex={-1}>
                          {client
                            ? selectedSource
                              ? <>I’ve registered <ConversationValue>{selectedSource.label}</ConversationValue>. Open <b>Local host</b> to choose or replace this {sourceMode === "youtube" ? "YouTube-local" : "owned"} source, or continue.</>
                              : sourceMode === "youtube"
                                ? <>Submit a bounded YouTube range from <b>Local host</b>, confirm local processing only, then continue.</>
                                : <>Register media you own or control from <b>Local host</b>, then continue.</>
                            : <>Connect the local source host with a paste-once bearer token — open <b>Connect host</b> to begin. Nothing is uploaded to a 1321 remote service.</>}
                        </h2>
                      </div>
                    </section>
                  )}

                  {setupStage === "range" && selectedSource && (
                    <section className="preflight-preparation">
                      <StageConversation headingRef={setupHeading}>
                        I’ll process <ConversationValue>{formatTimestamp(analysisRequest.start)}–{formatTimestamp(analysisRequest.end)}</ConversationValue> of{" "}
                        <ConversationValue>{selectedSource.label}</ConversationValue>. Stay inside the measured {seconds(selectedSource.durationMs)}; I haven’t inspected the content to choose a section.
                      </StageConversation>
                      <div className="preflight-range-time-fields">
                        <TimestampField
                          label="Start"
                          value={analysisRequest.start}
                          max={selectedSource.durationMs / 1_000}
                          invalid={!rangeValid}
                          onChange={(start) => updateRequest({ rangeMode: "custom", start })}
                        />
                        <TimestampField
                          label="End"
                          value={analysisRequest.end}
                          max={selectedSource.durationMs / 1_000}
                          invalid={!rangeValid}
                          onChange={(end) => updateRequest({ rangeMode: "custom", end })}
                        />
                      </div>
                      {!rangeValid && <p className="preflight-range-feedback" data-invalid="true" role="status">Choose a non-empty range inside {seconds(selectedSource.durationMs)}.</p>}
                    </section>
                  )}

                  {setupStage === "language" && (
                    <section className="preflight-preparation">
                      <StageConversation headingRef={setupHeading}>
                        I’ll treat the source as <ConversationValue>{sourceLanguage || "a language you declare"}</ConversationValue> and request{" "}
                        <ConversationValue>{analysisRequest.targetLanguage || "a target"}</ConversationValue> output. Use explicit BCP-47 tags.
                      </StageConversation>
                      <div className="product-runtime-language-fields">
                        <label className="preflight-declared-language"><span>Declared source language</span><input type="text" placeholder="ko" value={sourceLanguage} onChange={(event) => { clearReviewedState(); setSourceLanguage(event.currentTarget.value.trim()); }} /></label>
                        <label className="preflight-target-language"><span>Target language</span><input type="text" value={analysisRequest.targetLanguage} onChange={(event) => updateRequest({ targetLanguage: event.currentTarget.value.trim() })} /></label>
                        <label className="preflight-declared-language"><span>Language-pack identity (optional)</span><input type="text" placeholder="ko-v3" value={languagePackId} onChange={(event) => { clearReviewedState(); setLanguagePackId(event.currentTarget.value); }} /></label>
                      </div>
                      {!languageValid && <p className="preflight-block" role="status">Enter explicit BCP-47 language tags such as <code>ko</code> and <code>en</code>.</p>}
                    </section>
                  )}

                  {setupStage === "output" && (
                    <section className="preflight-preparation">
                      <StageConversation headingRef={setupHeading}>
                        I’ll request the <ConversationValue>{analysisRequest.outputDepth === "evidence" ? "evidence contract" : "caption request contract"}</ConversationValue>. Caption production still needs its separate verified review.
                      </StageConversation>
                      <label className="product-runtime-output"><span>Requested output contract</span><select value={analysisRequest.outputDepth} onChange={(event) => updateRequest({ outputDepth: event.currentTarget.value as AnalysisRequest["outputDepth"] })}><option value="evidence">Evidence contract</option><option value="captions">Caption request contract (production requires verified review)</option></select></label>
                    </section>
                  )}

                  {setupStage === "forecast" && reviewed && workload && (
                    <section className="preflight-preparation product-runtime-plan" aria-label="Review the local runtime plan">
                      <StageConversation headingRef={setupHeading}>
                        I’ve reviewed a <ConversationValue>studio.forecast.v1</ConversationValue> workload floor of{" "}
                        <ConversationValue>{seconds(workload.requestedOperationMediaDurationMs)} across {workload.operationCount} {workload.operationCount === 1 ? "operation" : "operations"}</ConversationValue> for{" "}
                        <ConversationValue>{selectedSource?.label ?? "the local source"}</ConversationValue>. Elapsed time, model usage, and cost stay unavailable rather than invented.
                      </StageConversation>
                      <p className="product-runtime-forecast-kicker">studio.forecast.v1 · not started or frozen</p>
                      <dl><div><dt>Selected range</dt><dd>{seconds(reviewed.response.forecast.inputs.selectedRange.startMs)}–{seconds(reviewed.response.forecast.inputs.selectedRange.endMs)} · {seconds(workload.selectedMediaDurationMs)}</dd></div><div><dt>Workload floor</dt><dd>{seconds(workload.requestedOperationMediaDurationMs)} across {workload.operationCount} explicit {workload.operationCount === 1 ? "operation" : "operations"}</dd></div><div><dt>Elapsed time</dt><dd>Unavailable</dd></div><div><dt>Model usage</dt><dd>Unavailable</dd></div><div><dt>Estimated API cost</dt><dd>Unavailable · amount and currency are null</dd></div><div><dt>Forecast content</dt><dd>{reviewed.response.forecast.content.contentId}</dd></div></dl>
                      <details><summary>Forecast assumptions and explicit work</summary><ul>{workload.operations.map((operation) => <li key={operation.operationId}><code>{operation.kind}</code> · {seconds(operation.requestedMediaDurationMs)}</li>)}{reviewed.response.forecast.assumptions.map((assumption) => <li key={assumption.code}>{assumption.statement}</li>)}</ul></details>
                    </section>
                  )}

                  {setupStage === "confirm" && reviewed && workload && selectedSource && (
                    <section className="preflight-preparation">
                      <StageConversation headingRef={setupHeading}>
                        I’m ready to start the bounded local runtime with <ConversationValue>{selectedSource.label}</ConversationValue>,{" "}
                        <ConversationValue>{seconds(reviewed.response.forecast.inputs.selectedRange.startMs)}–{seconds(reviewed.response.forecast.inputs.selectedRange.endMs)}</ConversationValue>,{" "}
                        <ConversationValue>{sourceLanguage} → {analysisRequest.targetLanguage}</ConversationValue>, and{" "}
                        <ConversationValue>{analysisRequest.outputDepth === "evidence" ? "the evidence contract" : "the caption request contract"}</ConversationValue>. The host keeps this copy private; starting won’t upload or publish.
                      </StageConversation>
                      <dl className="preflight-confirmation-summary"><div><dt>Source</dt><dd>{selectedSource.label}</dd></div><div><dt>Range</dt><dd>{seconds(reviewed.response.forecast.inputs.selectedRange.startMs)}–{seconds(reviewed.response.forecast.inputs.selectedRange.endMs)}</dd></div><div><dt>Language</dt><dd>{sourceLanguage} → {analysisRequest.targetLanguage}</dd></div><div><dt>Output</dt><dd>{analysisRequest.outputDepth === "evidence" ? "Evidence contract" : "Caption request contract"}</dd></div></dl>
                    </section>
                  )}
                </motion.div>
              </AnimatePresence>

              {error && <p className="product-runtime-error" role="alert">{error}</p>}
            </motion.section>

            <PreparationControlShelf
              visible={busy === null}
              stage={setupStage}
              back={setupStage !== "source"
                ? { label: `Back to ${PREPARATION_STAGES[currentSetupStageIndex - 1].label}`, onClick: previousSetupStage }
                : undefined}
              parameters={setupStage === "source" ? [
                {
                  label: "About this path",
                  actionLabel: "Open about this local production path",
                  open: openSourcePopover === "about",
                  popoverId: "product-runtime-about-popover",
                  triggerRef: aboutTrigger,
                  onToggle: () => setOpenSourcePopover((open) => (open === "about" ? null : "about")),
                },
                {
                  label: client ? "Local host" : "Connect host",
                  actionLabel: client ? `Open local host and ${sourceMode === "youtube" ? "YouTube ingest" : "owned media"}` : "Open connect to local host",
                  open: openSourcePopover === "host",
                  popoverId: "product-runtime-host-popover",
                  triggerRef: hostTrigger,
                  onToggle: () => setOpenSourcePopover((open) => (open === "host" ? null : "host")),
                },
              ] : undefined}
              next={{
                label: setupStage === "confirm" ? "Start" : "Continue",
                actionLabel: setupStage === "confirm" ? "Accept forecast and start local runtime" : continueActionLabel(setupStage),
                disabled: setupAdvanceDisabled,
              }}
            />

            {setupStage === "source" && (
              <>
                <PreparationStagePopover
                  id="product-runtime-about-popover"
                  stage="source"
                  open={openSourcePopover === "about"}
                  triggerRef={aboutTrigger}
                  title="About this path"
                  onClose={() => setOpenSourcePopover(null)}
                >
                  <p className="product-runtime-popover-note">
                    {sourceMode === "owned"
                      ? "This path registers receipted local media, reviews a real workload-floor forecast, and starts a bounded local runtime. After an exact verified human approval, a separate private caption job may be explicitly requested. Neither path uploads or publishes. Submitted YouTube URLs remain unprocessed recorded previews."
                      : "This path downloads only the explicitly confirmed bounded YouTube range into private local storage, reviews a real workload-floor forecast, and starts the same bounded local runtime. A later caption request stays private. The recorded-preview URL field remains a separate replay-only path; no upload or publication authority is granted."}
                  </p>
                </PreparationStagePopover>

                <PreparationStagePopover
                  id="product-runtime-host-popover"
                  stage="source"
                  open={openSourcePopover === "host"}
                  triggerRef={hostTrigger}
                  title={client ? "Local host" : "Connect local host"}
                  onClose={() => setOpenSourcePopover(null)}
                >
                  <div className="product-runtime-host-panel">
                    <details className="product-runtime-operator">
                      <summary>Local host setup and CLI escape hatch</summary>
                      <ol>
                        <li>Start the deterministic host: <code>node scripts/run-runtime-host.ts --executor deterministic</code></li>
                        <li>Paste the printed bearer token, connect, then add {sourceMode === "youtube" ? "one bounded YouTube range" : "owned media"} below.</li>
                        <li>Operator preflight directories remain supported with <code>--source-directory</code>.</li>
                      </ol>
                    </details>
                    <div className="product-runtime-connect">
                      <label><span>Local host origin</span><input type="url" value={baseUrl} disabled={client !== null} onChange={(event) => { disconnect(); setBaseUrl(event.currentTarget.value); }} /></label>
                      <label><span>Paste-once bearer token</span><input type="password" value={token} disabled={client !== null} autoComplete="off" spellCheck={false} onChange={(event) => { disconnect(); setToken(event.currentTarget.value); }} /></label>
                      {client
                        ? <button type="button" onClick={disconnect}>Disconnect local host</button>
                        : <button type="button" disabled={busy !== null || token.length === 0} onClick={() => void connect()}>{busy === "connect" ? "Connecting…" : "Connect to local host"}</button>}
                    </div>
                    {client && sourceMode === "owned" && (
                      <fieldset className="product-runtime-ingest">
                        <legend>Ingest media you own or control</legend>
                        <p>The host preserves the selected bytes privately, measures the media, and seals a V1 preflight. This does not authorize redistribution.</p>
                        <label><span>Owned media file</span><input type="file" accept="audio/*,video/*" disabled={busy === "ingest"} onChange={(event) => { setOwnedFile(event.currentTarget.files?.[0] ?? null); setIngest(null); setError(null); }} /></label>
                        <div className="product-runtime-ingest-fields">
                          <label><span>Source label</span><input type="text" value={sourceLabel} maxLength={160} disabled={busy === "ingest"} onChange={(event) => setSourceLabel(event.currentTarget.value)} /></label>
                          <label><span>Rights holder</span><input type="text" value={rightsHolder} maxLength={160} disabled={busy === "ingest"} onChange={(event) => setRightsHolder(event.currentTarget.value)} /></label>
                        </div>
                        <label className="product-runtime-attestation"><input type="checkbox" checked={ownershipAttested} disabled={busy === "ingest"} onChange={(event) => setOwnershipAttested(event.currentTarget.checked)} /><span>I attest that I own or control this media and authorize local processing of this copy.</span></label>
                        <button type="button" disabled={!ownedIngestValid} onClick={() => void ingestOwnedMedia()}>{busy === "ingest" ? "Ingesting owned media…" : "Confirm ownership and ingest"}</button>
                        {ingest && <div className="product-runtime-ingest-status" data-state={ingest.status} role="status" aria-live="polite" aria-label="Owned media ingest progress"><b>{ingest.status}</b>{ingest.status === "queued" && <span>Queued for bounded local upload and probe work.</span>}{ingest.status === "probing" && <span>Measuring the preserved media.</span>}{ingest.status === "sealing" && <span>Sealing the immutable V1 preflight.</span>}{ingest.status === "registered" && <span>The source is registered and selected below.</span>}{ingest.failure && <span>{ingest.failure.code}: {ingest.failure.message}</span>}</div>}
                      </fieldset>
                    )}
                    {client && sourceMode === "youtube" && (
                      <fieldset className="product-runtime-ingest">
                        <legend>Ingest a private YouTube range</legend>
                        <p>The host resolves only this URL, downloads at most 120 seconds into private ignored storage, and grants no redistribution or public-demo authority.</p>
                        <label><span>YouTube URL for local processing</span><input type="url" value={youtubeUrl} disabled={busy === "ingest"} onChange={(event) => { setYoutubeUrl(event.currentTarget.value); setIngest(null); setError(null); }} /></label>
                        <div className="product-runtime-ingest-fields">
                          <label><span>YouTube start seconds</span><input type="number" min="0" step="0.001" value={youtubeStartSeconds} disabled={busy === "ingest"} onChange={(event) => { setYoutubeStartSeconds(event.currentTarget.valueAsNumber); setIngest(null); }} /></label>
                          <label><span>YouTube end seconds</span><input type="number" min="0.001" step="0.001" value={youtubeEndSeconds} disabled={busy === "ingest"} onChange={(event) => { setYoutubeEndSeconds(event.currentTarget.valueAsNumber); setIngest(null); }} /></label>
                        </div>
                        <label className="product-runtime-attestation"><input type="checkbox" checked={youtubeLocalProcessingConfirmed} disabled={busy === "ingest"} onChange={(event) => setYoutubeLocalProcessingConfirmed(event.currentTarget.checked)} /><span>I confirm this exact YouTube range is authorized for local processing only. I am not authorizing redistribution or publication.</span></label>
                        <button type="button" disabled={!youtubeIngestValid} onClick={() => void ingestYouTubeLocal()}>{busy === "ingest" ? "Ingesting YouTube range…" : "Confirm local processing and ingest"}</button>
                        {ingest && <div className="product-runtime-ingest-status" data-state={ingest.status} role="status" aria-live="polite" aria-label="YouTube local ingest progress"><b>{ingest.status}</b>{ingest.status === "queued" && <span>Queued under the host’s bounded private policy.</span>}{ingest.status === "resolving" && <span>Resolving provider metadata with yt-dlp.</span>}{ingest.status === "downloading" && <span>Preserving the bounded provider bytes privately.</span>}{ingest.status === "probing" && <span>Measuring the downloaded media.</span>}{ingest.status === "sealing" && <span>Sealing source, rights, tool, range, and V1 preflight receipts.</span>}{ingest.status === "registered" && <span>The YouTube-local source is registered and selected below.</span>}{ingest.failure && <span>{ingest.failure.code}: {ingest.failure.message}</span>}</div>}
                      </fieldset>
                    )}
                    {client && visibleSources.length === 0 && !ingest && <p className="product-runtime-empty-source" role="status">{sourceMode === "youtube" ? "No YouTube-local source is registered yet. Submit a bounded URL range and confirm local processing above." : "No owned source is registered yet. Choose a file and complete the ownership attestation above."}</p>}
                    {client && selectedSource && (
                      <div className="product-runtime-session">
                        <label><span>{sourceMode === "youtube" ? "Registered YouTube local source" : "Registered owned source"}</span><select value={sourceId} onChange={(event) => chooseSource(event.currentTarget.value)}>{visibleSources.map((source) => <option key={source.sourceSessionId} value={source.sourceSessionId}>{source.label} ({seconds(source.durationMs)})</option>)}</select></label>
                        <dl className="product-runtime-source-facts">
                          <div><dt>Receipt</dt><dd>{selectedSource.sourceKind === "youtube_local" ? "YouTube / local" : "Owned / local"} ({selectedSource.rightsScope.replaceAll("_", " ")})</dd></div>
                          <div><dt>Measured duration</dt><dd>{seconds(selectedSource.durationMs)}</dd></div>
                          <div><dt>Measured tracks</dt><dd>{selectedSource.trackCount}</dd></div>
                          <div><dt>Sealed preflight</dt><dd>{selectedSource.preflightSchema}</dd></div>
                          <div><dt>Language evidence</dt><dd>{selectedSource.detectedLanguageEvidenceAvailable ? "Receipted ranges available" : "Unavailable"}</dd></div>
                        </dl>
                      </div>
                    )}
                  </div>
                </PreparationStagePopover>
              </>
            )}
          </form>

          <div className="studio-source-dock product-runtime-setup-dock">
            {setupBusyCopy ? (
              <LifecycleBottomBar
                mode={busy === "start" ? "initializing" : "resolving"}
                title={setupBusyCopy}
                busy
              />
            ) : error ? (
              <LifecycleBottomBar
                mode="failed"
                title="Local setup needs attention"
                primaryAction={{ label: "Exit setup", emphasis: "danger", onClick: onClose }}
              />
            ) : (
              <LifecycleBottomBar
                mode="preparation"
                title={PREPARATION_STAGES[currentSetupStageIndex].label}
                stage={setupStage}
                primaryAction={{ label: "Exit setup", emphasis: "danger", onClick: onClose }}
              />
            )}
          </div>
        </div>
      )}
    </section>
  );
}
