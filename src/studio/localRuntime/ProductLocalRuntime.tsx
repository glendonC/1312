import { useEffect, useRef, useState } from "react";

import { initialRequest, type AnalysisRequest } from "../preflight/model";
import type { EvidenceAssessmentAudit } from "../runtime/production/assessmentAudit";
import type { EvidenceDecisionReceiptVerification } from "../runtime/production/decisionReceiptAudit";
import type { PublishReviewIntakeVerification } from "../runtime/production/publishReviewIntakeAudit";
import type { PublishReviewDecisionVerification } from "../runtime/production/publishReviewDecisionAudit";
import type { CaptionProductionVerification } from "../runtime/production/captionProductionAudit";
import type {
  OwnedMediaIngestStatus,
  RuntimeHostCaptionProductionRequest,
  RuntimeHostPlanResponse,
  RuntimeHostPublishReviewDecisionRequest,
  RuntimeHostPublishReviewOperator,
  RuntimeHostPublishReviewRevocationRequest,
  RuntimeHostSourceSummary,
  RuntimeHostStartRequest,
} from "../runtime/production/runtimeHost/model";
import {
  ProductionStudioAdapter,
  type ProductionStudioProjection,
} from "../runtime/production/studioProjection";
import { LocalRuntimeHostClient } from "./client";
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

import "./productLocalRuntime.css";

type Busy = "connect" | "ingest" | "plan" | "start" | null;

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
  reviewOperator: RuntimeHostPublishReviewOperator | null;
  cursor: number;
  eventCount: number;
  lastEventType: string | null;
  pollState: "idle" | "polling" | "healthy" | "complete" | "error";
  pollMessage: string;
}

export default function ProductLocalRuntime({ onClose }: { onClose: () => void }) {
  const [baseUrl, setBaseUrl] = useState(defaultHostUrl);
  const [token, setToken] = useState("");
  const [client, setClient] = useState<LocalRuntimeHostClient | null>(null);
  const [sources, setSources] = useState<RuntimeHostSourceSummary[]>([]);
  const [sourceId, setSourceId] = useState("");
  const [ownedFile, setOwnedFile] = useState<File | null>(null);
  const [sourceLabel, setSourceLabel] = useState("");
  const [rightsHolder, setRightsHolder] = useState("");
  const [ownershipAttested, setOwnershipAttested] = useState(false);
  const [ingest, setIngest] = useState<OwnedMediaIngestStatus | null>(null);
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
  const pollGeneration = useRef(0);
  const ingestGeneration = useRef(0);
  const productionAdapter = useRef<ProductionStudioAdapter | null>(null);

  const selectedSource = sources.find((source) => source.sourceSessionId === sourceId) ?? null;
  const lifecycle = runtime
    ? projectLocalRuntimeLifecycle(runtime.status.lifecycle, runtime.status.reason)
    : null;
  const requestValid = client !== null &&
    selectedSource !== null &&
    isLocalRuntimeLanguageTag(sourceLanguage) &&
    isLocalRuntimeLanguageTag(analysisRequest.targetLanguage) &&
    Number.isFinite(analysisRequest.start) &&
    Number.isFinite(analysisRequest.end) &&
    analysisRequest.start >= 0 &&
    analysisRequest.end > analysisRequest.start &&
    Math.round(analysisRequest.end * 1_000) <= selectedSource.durationMs;
  const ingestValid = client !== null &&
    ownedFile !== null &&
    sourceLabel.trim().length > 0 &&
    rightsHolder.trim().length > 0 &&
    ownershipAttested &&
    (ingest === null || ingest.status === "failed") &&
    busy === null;

  useEffect(() => () => {
    pollGeneration.current += 1;
    ingestGeneration.current += 1;
  }, []);

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
      const first = nextSources[0] ?? null;
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
    const next = sources.find((source) => source.sourceSessionId === nextId);
    if (!next) return;
    clearReviewedState();
    setSourceId(nextId);
    setSourceLanguage("");
    setLanguagePackId("");
    setAnalysisRequest(initialRequest("en", next.durationMs / 1_000));
  }

  async function ingestOwnedMedia(): Promise<void> {
    if (!client || !ownedFile || !ingestValid) return;
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

  function updateRequest(update: Partial<AnalysisRequest>): void {
    clearReviewedState();
    setAnalysisRequest((current) => ({ ...current, ...update }));
  }

  function buildRequest(): RuntimeHostStartRequest {
    if (!selectedSource) throw new Error("Select a registered owned source first.");
    return mapAnalysisRequestToRuntimeStart({
      source: selectedSource,
      analysisRequest,
      requestedSourceLanguage: { mode: "declared", languages: [sourceLanguage], reason: null },
      selectedLanguagePackId: languagePackId.trim() || null,
    });
  }

  async function reviewPlan(): Promise<void> {
    if (!client) return;
    stopPolling();
    productionAdapter.current = null;
    setBusy("plan");
    setError(null);
    setRuntime(null);
    try {
      const request = buildRequest();
      const response = await client.plan(request);
      setReviewed({ request, response });
    } catch (nextError) {
      setReviewed(null);
      setError(errorMessage(nextError));
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
      const adapter = new ProductionStudioAdapter(acknowledgement.runtimeId);
      const nextRuntime: RuntimeView = {
        status: statusView(acknowledgement),
        production: adapter.view(),
        assessmentAudits: [],
        decisionReceipts: [],
        publishReviewIntakes: [],
        publishReviewDecisions: [],
        captionProductions: [],
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

  return (
    <section className="product-runtime" aria-labelledby="product-runtime-title">
      <header className="product-runtime-header">
        <div>
          <span>Local production path · separate from replay</span>
          <h1 id="product-runtime-title">Owned local source</h1>
        </div>
        <button type="button" onClick={onClose}>Back to source choices</button>
      </header>

      <p className="product-runtime-boundary" role="note">
        This path registers receipted local media with the host, reviews a real workload-floor forecast,
        and starts the bounded one-child runtime proof. After an exact verified human approval, a separate
        private caption job may be explicitly requested. Neither path uploads or publishes, and neither implies a multi-agent swarm.
        Submitted YouTube URLs remain unprocessed recorded previews.
      </p>

      <details className="product-runtime-operator">
        <summary>Local host setup and CLI escape hatch</summary>
        <ol>
          <li>
            Start the deterministic host (browser ingest is enabled under ignored <code>.studio/</code> storage):<br />
            <code>node scripts/run-runtime-host.ts --executor deterministic</code>
          </li>
          <li>Paste the printed bearer token, connect, then use the owned-media form below.</li>
          <li>Operator preflight directories remain supported with <code>--source-directory</code> as a CLI escape hatch.</li>
        </ol>
      </details>

      <div className="product-runtime-connect">
        <label>
          <span>Local host origin</span>
          <input
            type="url"
            value={baseUrl}
            disabled={client !== null}
            onChange={(event) => {
              disconnect();
              setBaseUrl(event.currentTarget.value);
            }}
          />
        </label>
        <label>
          <span>Paste-once bearer token</span>
          <input
            type="password"
            value={token}
            disabled={client !== null}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => {
              disconnect();
              setToken(event.currentTarget.value);
            }}
          />
        </label>
        {client ? (
          <button type="button" onClick={disconnect}>Disconnect local host</button>
        ) : (
          <button type="button" disabled={busy !== null || token.length === 0} onClick={() => void connect()}>
            {busy === "connect" ? "Connecting…" : "Connect to local host"}
          </button>
        )}
      </div>

      {client && (
        <fieldset className="product-runtime-ingest">
          <legend>Ingest media you own or control</legend>
          <p>
            The host preserves the selected bytes privately, runs the real media probe, seals a V1 preflight,
            and registers the resulting source. This path does not authorize redistribution.
          </p>
          <label>
            <span>Owned media file</span>
            <input
              type="file"
              accept="audio/*,video/*"
              disabled={busy === "ingest"}
              onChange={(event) => {
                setOwnedFile(event.currentTarget.files?.[0] ?? null);
                setIngest(null);
                setError(null);
              }}
            />
          </label>
          <label>
            <span>Source label</span>
            <input
              type="text"
              value={sourceLabel}
              maxLength={160}
              disabled={busy === "ingest"}
              onChange={(event) => setSourceLabel(event.currentTarget.value)}
            />
          </label>
          <label>
            <span>Rights holder</span>
            <input
              type="text"
              value={rightsHolder}
              maxLength={160}
              disabled={busy === "ingest"}
              onChange={(event) => setRightsHolder(event.currentTarget.value)}
            />
          </label>
          <label className="product-runtime-attestation">
            <input
              type="checkbox"
              checked={ownershipAttested}
              disabled={busy === "ingest"}
              onChange={(event) => setOwnershipAttested(event.currentTarget.checked)}
            />
            <span>I attest that I own or control this media and authorize local processing of this copy.</span>
          </label>
          <button type="button" disabled={!ingestValid} onClick={() => void ingestOwnedMedia()}>
            {busy === "ingest" ? "Ingesting owned media…" : "Confirm ownership and ingest"}
          </button>
          {ingest && (
            <div
              className="product-runtime-ingest-status"
              data-state={ingest.status}
              role="status"
              aria-live="polite"
              aria-label="Owned media ingest progress"
            >
              <b>{ingest.status}</b>
              {ingest.status === "queued" && <span> · The job is queued for bounded local upload and probe work.</span>}
              {ingest.status === "probing" && <span> · ffprobe is measuring the preserved media.</span>}
              {ingest.status === "sealing" && <span> · The host is sealing the immutable V1 preflight.</span>}
              {ingest.status === "registered" && <span> · The source is registered and selected below.</span>}
              {ingest.failure && <span> · {ingest.failure.code}: {ingest.failure.message}</span>}
            </div>
          )}
        </fieldset>
      )}

      {client && sources.length === 0 && !ingest && (
        <p className="product-runtime-empty-source" role="status">
          No owned source is registered yet. Choose a file and complete the ownership attestation above.
        </p>
      )}

      {client && selectedSource && (
        <div className="product-runtime-session">
          <label>
            <span>Registered owned source</span>
            <select value={sourceId} onChange={(event) => chooseSource(event.currentTarget.value)}>
              {sources.map((source) => (
                <option key={source.sourceSessionId} value={source.sourceSessionId}>
                  {source.label} · {seconds(source.durationMs)}
                </option>
              ))}
            </select>
          </label>

          <dl className="product-runtime-source-facts">
            <div><dt>Receipt</dt><dd>Owned/local · {selectedSource.rightsScope.replaceAll("_", " ")}</dd></div>
            <div><dt>Measured duration</dt><dd>{seconds(selectedSource.durationMs)}</dd></div>
            <div><dt>Measured tracks</dt><dd>{selectedSource.trackCount}</dd></div>
            <div><dt>Sealed preflight</dt><dd>{selectedSource.preflightSchema}</dd></div>
            <div><dt>Language evidence</dt><dd>{selectedSource.detectedLanguageEvidenceAvailable ? "Receipted ranges available" : "Unavailable"}</dd></div>
            <div><dt>Source content</dt><dd>{selectedSource.sourceContentId}</dd></div>
            <div><dt>Session</dt><dd>{selectedSource.sourceSessionId}</dd></div>
            <div><dt>Revision</dt><dd>{selectedSource.sourceRevisionId}</dd></div>
          </dl>

          <fieldset className="product-runtime-request">
            <legend>Analysis request for the bounded proof</legend>
            <div className="product-runtime-range">
              <label>
                <span>Start, seconds</span>
                <input
                  type="number"
                  min={0}
                  max={selectedSource.durationMs / 1_000}
                  step={0.1}
                  value={analysisRequest.start}
                  onChange={(event) => updateRequest({ rangeMode: "custom", start: event.currentTarget.valueAsNumber })}
                />
              </label>
              <label>
                <span>End, seconds</span>
                <input
                  type="number"
                  min={0}
                  max={selectedSource.durationMs / 1_000}
                  step={0.1}
                  value={analysisRequest.end}
                  onChange={(event) => updateRequest({ rangeMode: "custom", end: event.currentTarget.valueAsNumber })}
                />
              </label>
            </div>
            <div className="product-runtime-language">
              <label>
                <span>Declared source language</span>
                <input
                  type="text"
                  placeholder="ko"
                  value={sourceLanguage}
                  onChange={(event) => {
                    clearReviewedState();
                    setSourceLanguage(event.currentTarget.value.trim());
                  }}
                />
              </label>
              <label>
                <span>Target language</span>
                <input
                  type="text"
                  value={analysisRequest.targetLanguage}
                  onChange={(event) => updateRequest({ targetLanguage: event.currentTarget.value.trim() })}
                />
              </label>
            </div>
            <label>
              <span>Language-pack identity (optional)</span>
              <input
                type="text"
                placeholder="ko-v3"
                value={languagePackId}
                onChange={(event) => {
                  clearReviewedState();
                  setLanguagePackId(event.currentTarget.value);
                }}
              />
            </label>
            <label>
              <span>Requested output contract</span>
              <select
                value={analysisRequest.outputDepth}
                onChange={(event) => updateRequest({ outputDepth: event.currentTarget.value as AnalysisRequest["outputDepth"] })}
              >
                <option value="evidence">Evidence contract</option>
                <option value="captions">Captions request contract (no caption producer)</option>
              </select>
            </label>
            <button type="button" disabled={!requestValid || busy !== null} onClick={() => void reviewPlan()}>
              {busy === "plan" ? "Reviewing local plan…" : "Review local plan"}
            </button>
            {!requestValid && (
              <p role="status">
                Enter explicit BCP-47 language tags such as <code>ko</code>/<code>en</code> and a non-empty range inside the measured duration.
              </p>
            )}
          </fieldset>
        </div>
      )}

      {reviewed && workload && (
        <section className="product-runtime-plan" aria-labelledby="product-runtime-plan-title">
          <header>
            <span>studio.forecast.v1 · not started or frozen</span>
            <h2 id="product-runtime-plan-title">Local runtime plan</h2>
          </header>
          <dl>
            <div>
              <dt>Selected range</dt>
              <dd>
                {seconds(reviewed.response.forecast.inputs.selectedRange.startMs)}–{seconds(reviewed.response.forecast.inputs.selectedRange.endMs)} · {seconds(workload.selectedMediaDurationMs)}
              </dd>
            </div>
            <div>
              <dt>Workload floor</dt>
              <dd>
                {seconds(workload.requestedOperationMediaDurationMs)} across {workload.operationCount} explicit {workload.operationCount === 1 ? "operation" : "operations"}
              </dd>
            </div>
            <div><dt>Elapsed time</dt><dd>Unavailable</dd></div>
            <div><dt>Model usage</dt><dd>Unavailable</dd></div>
            <div><dt>Estimated API cost</dt><dd>Unavailable · amount and currency are null</dd></div>
            <div><dt>Forecast content</dt><dd>{reviewed.response.forecast.content.contentId}</dd></div>
          </dl>
          <div className="product-runtime-operations">
            <h3>Explicit work plan</h3>
            <ul>
              {workload.operations.map((operation) => (
                <li key={operation.operationId}>
                  <code>{operation.kind}</code> · {seconds(operation.requestedMediaDurationMs)}
                </li>
              ))}
            </ul>
          </div>
          <details>
            <summary>Forecast assumptions and exclusions</summary>
            <ul>
              {reviewed.response.forecast.assumptions.map((assumption) => (
                <li key={assumption.code}>{assumption.statement}</li>
              ))}
            </ul>
          </details>
          {!runtime && (
            <button
              type="button"
              className="product-runtime-start"
              disabled={busy !== null}
              onClick={() => void start()}
            >
              {busy === "start" ? "Accepting and starting local runtime…" : "Accept forecast and start local runtime"}
            </button>
          )}
        </section>
      )}

      {error && <p className="product-runtime-error" role="alert">{error}</p>}

      {runtime && lifecycle && (
        <section className="product-runtime-status" aria-labelledby="product-runtime-status-title">
          <header>
            <span>Production journal · not replay topology</span>
            <h2 id="product-runtime-status-title">Local runtime status</h2>
          </header>
          <p data-tone={lifecycle.tone} role="status"><b>{lifecycle.label}</b> · {lifecycle.detail}</p>
          <dl>
            <div><dt>Command</dt><dd>{runtime.status.commandId}</dd></div>
            <div><dt>Runtime</dt><dd>{runtime.status.runtimeId}</dd></div>
            <div><dt>Journal</dt><dd>{runtime.status.journalId}</dd></div>
            <div><dt>Frozen forecast</dt><dd>{runtime.status.forecast?.frozenForecastId ?? "Unavailable after initialization failure"}</dd></div>
            <div><dt>Start receipt</dt><dd>{runtime.status.runStartReceipt?.contentId ?? "Unavailable after initialization failure"}</dd></div>
            <div><dt>Journal poll</dt><dd>{runtime.pollMessage}</dd></div>
            <div><dt>Consumed evidence</dt><dd>Cursor {runtime.cursor} · {runtime.eventCount} validated events{runtime.lastEventType ? ` · last ${runtime.lastEventType}` : ""}</dd></div>
          </dl>
          {runtime.pollState === "error" && client && productionAdapter.current && (
            <button type="button" onClick={() => {
              const adapter = productionAdapter.current;
              if (adapter) void beginPolling(client, runtime.status, runtime.cursor, adapter);
            }}>
              Retry polling from cursor {runtime.cursor}
            </button>
          )}
          <p>
            Audit the host journal separately in <a href="/studio/runtime/">Production Run Explorer</a>. These events are not inserted into the recorded RunBundle or agent graph.
          </p>
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
        </section>
      )}
    </section>
  );
}
