import { useState } from "react";

import {
  projectProductionRuntimeJournal,
  type ProductionStudioProjection,
} from "./studioProjection";

const MAX_JOURNAL_BYTES = 5 * 1024 * 1024;

function integer(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

function duration(milliseconds: number | null): string {
  return milliseconds === null ? "unavailable" : `${(milliseconds / 1_000).toFixed(2)} s active`;
}

export default function ProductionRuntimeInspector() {
  const [projection, setProjection] = useState<ProductionStudioProjection | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filename, setFilename] = useState<string | null>(null);

  const load = async (file: File | undefined): Promise<void> => {
    setProjection(null);
    setError(null);
    setFilename(file?.name ?? null);
    if (!file) return;
    if (file.size <= 0 || file.size > MAX_JOURNAL_BYTES) {
      setError("The journal must be non-empty and no larger than 5 MB.");
      return;
    }
    try {
      const raw = await file.text();
      const events = raw
        .trimEnd()
        .split("\n")
        .filter((line) => line.trim().length > 0)
        .map((line, index) => {
          try {
            return JSON.parse(line) as unknown;
          } catch (cause) {
            throw new Error(`Line ${index + 1} is not valid JSON.`, { cause });
          }
        });
      setProjection(projectProductionRuntimeJournal(events));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The production journal could not be validated.");
    }
  };

  return (
    <main className="runtime-inspector">
      <header className="runtime-hero">
        <a href="/studio/" className="runtime-back">1321 Studio</a>
        <p className="runtime-kicker">Production runtime projection</p>
        <h1>Inspect a local worker journal</h1>
        <p className="runtime-lede">
          This page validates and projects a journal created by the local production runtime. It does not
          start a worker, replay a recorded demo, or translate fixture-only contract events.
        </p>
      </header>

      <section className="runtime-loader" aria-labelledby="runtime-load-title">
        <div>
          <h2 id="runtime-load-title">Choose events.ndjson</h2>
          <p>The file stays in this browser session and is not added to run-005 or run-006.</p>
        </div>
        <label className="runtime-file">
          <span>{filename ?? "Select production journal"}</span>
          <input
            type="file"
            accept=".ndjson,.jsonl,application/x-ndjson,application/jsonl"
            onChange={(event) => void load(event.currentTarget.files?.[0])}
          />
        </label>
      </section>

      {error && <p className="runtime-error" role="alert">Rejected: {error}</p>}

      {!projection && !error && (
        <section className="runtime-empty" aria-live="polite">
          <p>No production evidence is loaded.</p>
          <span>A blank screen is preferable to inventing a live swarm.</span>
        </section>
      )}

      {projection && (
        <section className="runtime-projection" aria-live="polite">
          <header className="runtime-summary">
            <div>
              <span className="runtime-proof">Validated local journal · not a recorded demo</span>
              <h2>{projection.runId}</h2>
            </div>
            <dl>
              <div><dt>events</dt><dd>{projection.lastSeq}</dd></div>
              <div><dt>tasks</dt><dd>{projection.counts.tasks}</dd></div>
              <div><dt>workers</dt><dd>{projection.counts.workers}</dd></div>
              <div><dt>reports</dt><dd>{projection.counts.reports}</dd></div>
            </dl>
          </header>

          <div className="runtime-workers">
            {projection.workers.map((worker) => (
              <article className="runtime-worker" key={worker.agentId} data-status={worker.taskStatus}>
                <header>
                  <div>
                    <span className="runtime-kind">{worker.kind}</span>
                    <h3>{worker.label}</h3>
                  </div>
                  <span className="runtime-status">{worker.taskStatus}</span>
                </header>
                <p className="runtime-objective">{worker.objective}</p>
                <dl className="runtime-detail">
                  <div><dt>agent</dt><dd>{worker.agentId}</dd></div>
                  <div><dt>parent</dt><dd>{worker.parentAgentId ?? "root"}</dd></div>
                  <div><dt>capabilities</dt><dd>{worker.capabilities.join(", ") || "none"}</dd></div>
                  <div>
                    <dt>scope</dt>
                    <dd>
                      {worker.mediaScope.length === 0
                        ? "no media grant"
                        : worker.mediaScope
                            .map((scope) => `${scope.trackId} [${scope.startMs}, ${scope.endMs}) ms`)
                            .join("; ")}
                    </dd>
                  </div>
                </dl>

                {worker.execution ? (
                  <div className="runtime-receipt">
                    <div>
                      <span>executor</span>
                      <b>{worker.execution.status} · {duration(worker.execution.activeDurationMs)}</b>
                    </div>
                    {worker.execution.usage ? (
                      <div>
                        <span>measured model usage</span>
                        <b>
                          {integer(worker.execution.usage.inputTokens)} in · {integer(worker.execution.usage.outputTokens)} out
                        </b>
                        <small>
                          model {worker.execution.usage.model ?? "unavailable"} · billing unavailable
                        </small>
                      </div>
                    ) : (
                      <div><span>measured model usage</span><b>unavailable</b></div>
                    )}
                  </div>
                ) : (
                  <p className="runtime-unavailable">No executor span was recorded.</p>
                )}

                {worker.report && (
                  <blockquote className="runtime-report">
                    <span>report {worker.report.status}</span>
                    <p>{worker.report.summary}</p>
                  </blockquote>
                )}
              </article>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
