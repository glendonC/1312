import { useEffect, useRef, useState } from "react";

import { initialRequest, type AnalysisRequest } from "../preflight/model";
import type {
  RuntimeHostPollResponse,
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

import "./localRuntimeLab.css";

type RuntimeStatusView = Omit<RuntimeHostStatus, "schema">;
type PollHealth = "idle" | "polling" | "healthy" | "complete" | "error";

interface RuntimeView {
  status: RuntimeStatusView;
  request: RuntimeHostStartRequest;
  cursor: number;
  eventCount: number;
  lastEventType: string | null;
  pollHealth: PollHealth;
  pollMessage: string;
  idempotency: "unchecked" | "same" | "changed";
}

function statusView(value: RuntimeHostStatus | RuntimeHostStartAcknowledgement): RuntimeStatusView {
  const { schema: _schema, ...status } = value;
  return status;
}

function pollStatus(status: RuntimeHostStatus, poll: RuntimeHostPollResponse): RuntimeStatusView {
  return {
    ...statusView(status),
    lifecycle: poll.lifecycle,
    reason: poll.reason,
    journalHead: poll.journalHead,
    terminal: poll.terminal,
  };
}

function sameStart(
  left: RuntimeStatusView,
  right: RuntimeHostStartAcknowledgement,
): boolean {
  return left.commandId === right.commandId &&
    left.runtimeId === right.runtimeId &&
    left.journalId === right.journalId &&
    left.runStartReceipt?.contentId === right.runStartReceipt?.contentId &&
    left.forecast?.contentId === right.forecast?.contentId &&
    left.forecast?.frozenForecastId === right.forecast?.frozenForecastId;
}

function defaultHostUrl(): string {
  if (typeof window === "undefined") return "http://127.0.0.1:4312";
  return new URLSearchParams(window.location.search).get("runtimeHost") ?? "http://127.0.0.1:4312";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "The local runtime operation failed closed.";
}

export default function LocalRuntimeLab() {
  const [baseUrl, setBaseUrl] = useState(defaultHostUrl);
  const [token, setToken] = useState("");
  const [client, setClient] = useState<LocalRuntimeHostClient | null>(null);
  const [sources, setSources] = useState<RuntimeHostSourceSummary[]>([]);
  const [sourceId, setSourceId] = useState("");
  const [analysisRequest, setAnalysisRequest] = useState<AnalysisRequest>(() => initialRequest("en", 0));
  const [sourceLanguage, setSourceLanguage] = useState("ko");
  const [languagePackId, setLanguagePackId] = useState("");
  const [busy, setBusy] = useState<"connect" | "start" | "repeat" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [runtime, setRuntime] = useState<RuntimeView | null>(null);
  const pollGeneration = useRef(0);
  const resultRef = useRef<HTMLDivElement | null>(null);

  const selectedSource = sources.find((source) => source.sourceSessionId === sourceId) ?? null;
  const lifecycle = runtime
    ? projectLocalRuntimeLifecycle(runtime.status.lifecycle, runtime.status.reason)
    : null;
  const canStart = client !== null &&
    selectedSource !== null &&
    isLocalRuntimeLanguageTag(sourceLanguage) &&
    isLocalRuntimeLanguageTag(analysisRequest.targetLanguage) &&
    Number.isFinite(analysisRequest.start) &&
    Number.isFinite(analysisRequest.end) &&
    analysisRequest.end > analysisRequest.start &&
    Math.round(analysisRequest.end * 1_000) <= selectedSource.durationMs;

  useEffect(() => () => {
    pollGeneration.current += 1;
  }, []);

  useEffect(() => {
    if (!error && !runtime) return;
    resultRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [error, runtime?.status.commandId, runtime?.pollHealth]);

  function stopPolling(): void {
    pollGeneration.current += 1;
  }

  function disconnect(): void {
    stopPolling();
    setClient(null);
    setSources([]);
    setSourceId("");
    setRuntime(null);
    setError(null);
  }

  async function connect(): Promise<void> {
    stopPolling();
    setBusy("connect");
    setError(null);
    setRuntime(null);
    try {
      const nextClient = new LocalRuntimeHostClient({ baseUrl, token });
      const nextSources = await nextClient.listSourceSessions();
      if (nextSources.length === 0) throw new Error("The local runtime host has no registered source sessions.");
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

  async function beginPolling(
    activeClient: LocalRuntimeHostClient,
    identity: RuntimeStatusView,
    cursor: number,
  ): Promise<void> {
    const generation = ++pollGeneration.current;
    setRuntime((current) => current && current.status.runtimeId === identity.runtimeId
      ? { ...current, pollHealth: "polling", pollMessage: `Polling after cursor ${cursor}.` }
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
        setRuntime((current) => current && current.status.runtimeId === identity.runtimeId
          ? { ...current, status: statusView(status) }
          : current);
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
            status: pollStatus(status, poll),
            cursor: poll.nextCursor,
            eventCount: current.eventCount + poll.events.length,
            lastEventType: poll.events.at(-1)?.type ?? current.lastEventType,
            pollHealth: poll.terminal && poll.reachedHead ? "complete" : "healthy",
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
              pollHealth: "error",
              pollMessage: `Polling stopped after cursor ${current.cursor}: ${errorMessage(pollError)}`,
            }
          : current);
        return;
      }
    }
  }

  function buildStartRequest(): RuntimeHostStartRequest {
    if (!selectedSource) throw new Error("Select a registered source session first.");
    return mapAnalysisRequestToRuntimeStart({
      source: selectedSource,
      analysisRequest,
      requestedSourceLanguage: { mode: "declared", languages: [sourceLanguage], reason: null },
      selectedLanguagePackId: languagePackId.trim() || null,
    });
  }

  async function start(): Promise<void> {
    if (!client) return;
    stopPolling();
    setBusy("start");
    setError(null);
    try {
      const request = buildStartRequest();
      const acknowledgement = await client.start(request);
      const nextRuntime: RuntimeView = {
        status: statusView(acknowledgement),
        request,
        cursor: 0,
        eventCount: 0,
        lastEventType: null,
        pollHealth: "idle",
        pollMessage: "Start acknowledged; event cursor begins at 0.",
        idempotency: "unchecked",
      };
      setRuntime(nextRuntime);
      void beginPolling(client, nextRuntime.status, 0);
    } catch (nextError) {
      setError(errorMessage(nextError));
    } finally {
      setBusy(null);
    }
  }

  async function repeatStart(): Promise<void> {
    if (!client || !runtime) return;
    setBusy("repeat");
    setError(null);
    try {
      const acknowledgement = await client.start(runtime.request);
      const same = sameStart(runtime.status, acknowledgement);
      setRuntime((current) => current
        ? { ...current, idempotency: same ? "same" : "changed" }
        : current);
      if (!same) throw new Error("Repeated start returned different durable identities.");
    } catch (nextError) {
      setError(errorMessage(nextError));
    } finally {
      setBusy(null);
    }
  }

  function chooseSource(nextId: string): void {
    const next = sources.find((source) => source.sourceSessionId === nextId);
    if (!next) return;
    setSourceId(nextId);
    setAnalysisRequest((current) => ({
      ...current,
      rangeMode: "custom",
      start: 0,
      end: next.durationMs / 1_000,
    }));
  }

  return (
    <section className="local-runtime-lab" aria-labelledby="local-runtime-title">
      <header className="local-runtime-head">
        <span>
          <b id="local-runtime-title">Local runtime host</b>
          <small>development-only · separate from replay</small>
        </span>
      </header>

      <p className="local-runtime-boundary">
        Starts the deterministic one-child proof. It does not create captions, study output, or a multi-agent swarm.
      </p>

      <div className="local-runtime-connect">
        <label>
          <span>Host origin</span>
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

      <p className="local-runtime-operator-note">
        Terminal A: <code>npm run runtime:host</code>. Open Studio from an allowed origin (default <code>http://127.0.0.1:4321</code>), then paste the printed token here.
      </p>

      {client && selectedSource && (
        <div className="local-runtime-request">
          <label>
            <span>Registered source</span>
            <select value={sourceId} onChange={(event) => chooseSource(event.currentTarget.value)}>
              {sources.map((source) => (
                <option key={source.sourceSessionId} value={source.sourceSessionId}>
                  {source.sourceSessionId} · {(source.durationMs / 1_000).toFixed(1)}s
                </option>
              ))}
            </select>
          </label>
          <div className="local-runtime-range">
            <label>
              <span>Start, seconds</span>
              <input
                type="number"
                min={0}
                max={selectedSource.durationMs / 1_000}
                step={0.1}
                value={analysisRequest.start}
                onChange={(event) => {
                  const start = event.currentTarget.valueAsNumber;
                  setAnalysisRequest((current) => ({
                    ...current,
                    rangeMode: "custom",
                    start,
                  }));
                }}
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
                onChange={(event) => {
                  const end = event.currentTarget.valueAsNumber;
                  setAnalysisRequest((current) => ({
                    ...current,
                    rangeMode: "custom",
                    end,
                  }));
                }}
              />
            </label>
          </div>
          <div className="local-runtime-language">
            <label>
              <span>Declared source language</span>
              <input
                type="text"
                placeholder="ko"
                value={sourceLanguage}
                onChange={(event) => setSourceLanguage(event.currentTarget.value.trim())}
              />
            </label>
            <label>
              <span>Target language</span>
              <input
                type="text"
                value={analysisRequest.targetLanguage}
                onChange={(event) => {
                  const targetLanguage = event.currentTarget.value.trim();
                  setAnalysisRequest((current) => ({
                    ...current,
                    targetLanguage,
                  }));
                }}
              />
            </label>
          </div>
          <label>
            <span>Language-pack identity (optional)</span>
            <input
              type="text"
              placeholder="ko-v3"
              value={languagePackId}
              onChange={(event) => setLanguagePackId(event.currentTarget.value)}
            />
          </label>
          <label>
            <span>Proof output depth</span>
            <select
              value={analysisRequest.outputDepth}
              onChange={(event) => {
                const outputDepth = event.currentTarget.value as AnalysisRequest["outputDepth"];
                setAnalysisRequest((current) => ({
                  ...current,
                  outputDepth,
                }));
              }}
            >
              <option value="evidence">Evidence contract</option>
              <option value="captions">Captions request contract (no caption producer)</option>
            </select>
          </label>
          <button
            type="button"
            className="local-runtime-start"
            disabled={!canStart || busy !== null}
            onClick={() => void start()}
          >
            {busy === "start" ? "Starting local runtime…" : "Start local runtime"}
          </button>
          {!canStart && (
            <p className="local-runtime-operator-note">
              Start stays disabled until a registered source is selected, declared/target languages are
              BCP-47 tags like <code>ko</code>/<code>en</code>, and the end time is a finite value inside
              the source duration.
            </p>
          )}
        </div>
      )}

      <div ref={resultRef} className="local-runtime-result">
      {error && <p className="local-runtime-error" role="alert">{error}</p>}

      {runtime && lifecycle && (
        <div className="local-runtime-status" data-lifecycle={runtime.status.lifecycle}>
          <div className="local-runtime-lifecycle" data-tone={lifecycle.tone} role="status">
            <b>{lifecycle.label}</b>
            <span>{lifecycle.detail}</span>
          </div>
          <dl>
            <div><dt>Command</dt><dd>{runtime.status.commandId}</dd></div>
            <div><dt>Runtime</dt><dd>{runtime.status.runtimeId}</dd></div>
            <div><dt>Journal</dt><dd>{runtime.status.journalId}</dd></div>
            <div><dt>Analysis request</dt><dd>{runtime.status.analysisRequestId}</dd></div>
            <div><dt>Forecast</dt><dd>{runtime.status.forecast?.forecastId ?? "Initializing"}</dd></div>
            <div><dt>Forecast content</dt><dd>{runtime.status.forecast?.contentId ?? "Initializing"}</dd></div>
            <div><dt>Frozen forecast</dt><dd>{runtime.status.forecast?.frozenForecastId ?? "Initializing"}</dd></div>
            <div><dt>Start receipt</dt><dd>{runtime.status.runStartReceipt?.contentId ?? "Initializing"}</dd></div>
          </dl>
          <div className="local-runtime-poll" data-health={runtime.pollHealth}>
            <b>Journal poll</b>
            <span>{runtime.pollMessage}</span>
            <small>
              Last consumed cursor {runtime.cursor} · {runtime.eventCount} validated events consumed
              {runtime.lastEventType ? ` · last ${runtime.lastEventType}` : ""}
            </small>
            {runtime.pollHealth === "error" && client && (
              <button type="button" onClick={() => void beginPolling(client, runtime.status, runtime.cursor)}>
                Retry polling from cursor {runtime.cursor}
              </button>
            )}
          </div>
          <div className="local-runtime-idempotency">
            <button type="button" disabled={busy !== null} onClick={() => void repeatStart()}>
              {busy === "repeat" ? "Repeating identical start…" : "Repeat identical start"}
            </button>
            {runtime.idempotency === "same" && <span>Same command, runtime, journal, receipt, and forecast identities.</span>}
            {runtime.idempotency === "changed" && <span role="alert">Durable identities changed; the check failed closed.</span>}
          </div>
          <p className="local-runtime-inspect">
            Manual audit remains separate: open <a href="/studio/runtime/">/studio/runtime/</a> and choose this host journal from the local runtime root printed in Terminal A.
          </p>
        </div>
      )}
      </div>
    </section>
  );
}
