import { useEffect, useRef, useState } from "react";

import { initialRequest, type AnalysisRequest } from "../preflight/model";
import type {
  RuntimeHostPlanResponse,
  RuntimeHostSourceSummary,
  RuntimeHostStartAcknowledgement,
  RuntimeHostStartRequest,
  RuntimeHostStatus,
} from "../runtime/production/runtimeHost/model";
import { LocalRuntimeHostClient } from "./client";
import {
  isLocalRuntimeLanguageTag,
  mapAnalysisRequestToRuntimeStart,
  projectLocalRuntimeLifecycle,
} from "./model";

import "./productLocalRuntime.css";

type Busy = "connect" | "plan" | "start" | null;
type RuntimeStatusView = Omit<RuntimeHostStatus, "schema">;

interface ReviewedPlan {
  request: RuntimeHostStartRequest;
  response: RuntimeHostPlanResponse;
}

interface RuntimeView {
  status: RuntimeStatusView;
  cursor: number;
  eventCount: number;
  lastEventType: string | null;
  pollState: "idle" | "polling" | "healthy" | "complete" | "error";
  pollMessage: string;
}

function defaultHostUrl(): string {
  if (typeof window === "undefined") return "http://127.0.0.1:4312";
  return new URLSearchParams(window.location.search).get("runtimeHost") ?? "http://127.0.0.1:4312";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "The local runtime operation failed closed.";
}

function statusView(value: RuntimeHostStatus | RuntimeHostStartAcknowledgement): RuntimeStatusView {
  const { schema: _schema, ...status } = value;
  return status;
}

function seconds(milliseconds: number): string {
  return `${(milliseconds / 1_000).toFixed(3).replace(/\.?(?:0+)$/, "")}s`;
}

export default function ProductLocalRuntime({ onClose }: { onClose: () => void }) {
  const [baseUrl, setBaseUrl] = useState(defaultHostUrl);
  const [token, setToken] = useState("");
  const [client, setClient] = useState<LocalRuntimeHostClient | null>(null);
  const [sources, setSources] = useState<RuntimeHostSourceSummary[]>([]);
  const [sourceId, setSourceId] = useState("");
  const [analysisRequest, setAnalysisRequest] = useState<AnalysisRequest>(() => initialRequest("en", 0));
  const [sourceLanguage, setSourceLanguage] = useState("");
  const [languagePackId, setLanguagePackId] = useState("");
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const [reviewed, setReviewed] = useState<ReviewedPlan | null>(null);
  const [runtime, setRuntime] = useState<RuntimeView | null>(null);
  const pollGeneration = useRef(0);

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

  useEffect(() => () => {
    pollGeneration.current += 1;
  }, []);

  function stopPolling(): void {
    pollGeneration.current += 1;
  }

  function clearReviewedState(): void {
    stopPolling();
    setReviewed(null);
    setRuntime(null);
    setError(null);
  }

  function disconnect(): void {
    clearReviewedState();
    setClient(null);
    setSources([]);
    setSourceId("");
  }

  async function connect(): Promise<void> {
    stopPolling();
    setBusy("connect");
    setError(null);
    setReviewed(null);
    setRuntime(null);
    try {
      const nextClient = new LocalRuntimeHostClient({ baseUrl, token });
      const nextSources = await nextClient.listSourceSessions();
      if (nextSources.length === 0) throw new Error("The local runtime host has no registered owned-source sessions.");
      const first = nextSources[0];
      setBaseUrl(nextClient.baseUrl);
      setClient(nextClient);
      setSources(nextSources);
      setSourceId(first.sourceSessionId);
      setAnalysisRequest(initialRequest("en", first.durationMs / 1_000));
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
        after = poll.nextCursor;
        setRuntime((current) => {
          if (!current || current.status.runtimeId !== identity.runtimeId) return current;
          return {
            ...current,
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
      const nextRuntime: RuntimeView = {
        status: statusView(acknowledgement),
        cursor: 0,
        eventCount: 0,
        lastEventType: null,
        pollState: "idle",
        pollMessage: acknowledgement.runStartReceipt
          ? "Start accepted and exact reviewed forecast frozen; event cursor begins at 0."
          : "Start was accepted, but no frozen forecast or journal was initialized.",
      };
      setRuntime(nextRuntime);
      if (acknowledgement.runStartReceipt) {
        void beginPolling(client, nextRuntime.status, 0);
      }
    } catch (nextError) {
      setError(errorMessage(nextError));
    } finally {
      setBusy(null);
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
        and starts the bounded one-child runtime proof. It does not produce captions, study output, or a multi-agent swarm.
        Submitted YouTube URLs remain unprocessed recorded previews.
      </p>

      <details className="product-runtime-operator" open>
        <summary>Prepare and register an owned source</summary>
        <ol>
          <li>
            Seal owned bytes, rights, and the real media probe:<br />
            <code>node scripts/preflight-owned-media.mjs --file /path/to/media.mov --run local-001 --label "Owned clip" --rights-holder "Your name" --rights-scope local --attest-rights</code>
          </li>
          <li>
            Start the deterministic host with that sealed directory:<br />
            <code>node scripts/run-runtime-host.ts --source-directory .studio/runs/local-001 --executor deterministic</code>
          </li>
          <li>Open Studio from the allowed origin, then paste the host token below.</li>
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
          {runtime.pollState === "error" && client && (
            <button type="button" onClick={() => void beginPolling(client, runtime.status, runtime.cursor)}>
              Retry polling from cursor {runtime.cursor}
            </button>
          )}
          <p>
            Audit the host journal separately in <a href="/studio/runtime/">Production Run Explorer</a>. These events are not inserted into the recorded RunBundle or agent graph.
          </p>
        </section>
      )}
    </section>
  );
}
