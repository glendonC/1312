import { useMemo, useState } from "react";

import type { TaskStatus } from "./model";
import { buildRuntimeObservabilityIndex } from "./observability/indexer";
import type {
  IndexedOperationCapability,
  ObservabilitySourceReferences,
  RuntimeObservabilityIndex,
} from "./observability/model";
import { ImmutableObservabilityQueryStore } from "./observability/query";
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

function measuredInteger(value: number | null): string {
  return value === null ? "unavailable" : integer(value);
}

function domId(kind: "event" | "receipt" | "artifact", id: string): string {
  return `runtime-source-${kind}-${id.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}

function compactIdentity(value: string): string {
  if (value.length <= 28) return value;
  return `${value.slice(0, 14)}…${value.slice(-10)}`;
}

function SourceLinks({ sources }: { sources: ObservabilitySourceReferences }) {
  return (
    <div className="runtime-source-links" aria-label="Source identities">
      <span>sources</span>
      {sources.eventIds.map((id) => (
        <a href={`#${domId("event", id)}`} key={`event:${id}`}>{id.split(":").at(-1)}</a>
      ))}
      {sources.receiptIds.map((id) => (
        <a href={`#${domId("receipt", id)}`} key={`receipt:${id}`}>{compactIdentity(id)}</a>
      ))}
      {sources.artifactIds.map((id) => (
        <a href={`#${domId("artifact", id)}`} key={`artifact:${id}`}>{compactIdentity(id)}</a>
      ))}
    </div>
  );
}

export default function ProductionRuntimeInspector() {
  const [projection, setProjection] = useState<ProductionStudioProjection | null>(null);
  const [index, setIndex] = useState<RuntimeObservabilityIndex | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filename, setFilename] = useState<string | null>(null);
  const [agentFilter, setAgentFilter] = useState("all");
  const [taskStatusFilter, setTaskStatusFilter] = useState("all");
  const [operationFilter, setOperationFilter] = useState("all");

  const store = useMemo(
    () => (index ? new ImmutableObservabilityQueryStore([index]) : null),
    [index],
  );
  const query = useMemo(() => {
    if (!store) return null;
    return store.query({
      agentIds: agentFilter === "all" ? undefined : [agentFilter],
      taskStatuses:
        taskStatusFilter === "all" ? undefined : [taskStatusFilter as TaskStatus],
      operationCapabilities:
        operationFilter === "all"
          ? undefined
          : [operationFilter as IndexedOperationCapability],
    });
  }, [agentFilter, operationFilter, store, taskStatusFilter]);

  const load = async (file: File | undefined): Promise<void> => {
    setProjection(null);
    setIndex(null);
    setError(null);
    setFilename(file?.name ?? null);
    setAgentFilter("all");
    setTaskStatusFilter("all");
    setOperationFilter("all");
    if (!file) return;
    if (file.size <= 0 || file.size > MAX_JOURNAL_BYTES) {
      setError("The journal must be non-empty and no larger than 5 MB.");
      return;
    }
    try {
      const raw = await file.text();
      const built = await buildRuntimeObservabilityIndex(raw);
      const events = raw
        .trimEnd()
        .split("\n")
        .map((line) => JSON.parse(line) as unknown);
      setProjection(projectProductionRuntimeJournal(events));
      setIndex(built);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The production journal could not be validated.");
    }
  };

  const agentOptions = index?.records.agents.map((agent) => agent.agentId) ?? [];
  const taskStatusOptions = [...new Set(index?.records.tasks.map((task) => task.status) ?? [])].sort();
  const operationOptions = [
    ...new Set(index?.records.operations.map((operation) => operation.capability) ?? []),
  ].sort();

  return (
    <main className="runtime-inspector">
      <header className="runtime-hero">
        <nav className="runtime-inspector-nav" aria-label="Studio inspectors">
          <a href="/studio/" className="runtime-back">1321 Studio</a>
          <a href="/studio/runtime/memory/">Memory review</a>
        </nav>
        <p className="runtime-kicker">Production Run Explorer</p>
        <h1>Inspect certified runtime exhaust</h1>
        <p className="runtime-lede">
          This page validates a local production journal, builds its content-addressed observability
          index, and queries only normalized facts. It does not start a worker, search raw logs, or
          insert activity into a recorded demo.
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

      {projection && index && query && (
        <section className="runtime-projection" aria-live="polite">
          <header className="runtime-summary">
            <div>
              <span className="runtime-proof">Validated immutable index · not a recorded demo</span>
              <h2>{projection.runId}</h2>
              <code title={index.indexId}>{compactIdentity(index.indexId)}</code>
            </div>
            <dl>
              <div><dt>events</dt><dd>{index.sourceJournal.eventCount}</dd></div>
              <div><dt>tasks</dt><dd>{index.summary.counts.tasks}</dd></div>
              <div><dt>agents</dt><dd>{index.summary.counts.agents}</dd></div>
              <div><dt>operations</dt><dd>{index.summary.counts.operations}</dd></div>
            </dl>
          </header>

          <section className="runtime-explorer" aria-labelledby="runtime-explorer-title">
            <header className="runtime-section-heading">
              <div>
                <span className="runtime-kicker">Structured query</span>
                <h2 id="runtime-explorer-title">Run Explorer</h2>
              </div>
              <div className="runtime-filters">
                <label>
                  <span>agent</span>
                  <select value={agentFilter} onChange={(event) => setAgentFilter(event.currentTarget.value)}>
                    <option value="all">all agents</option>
                    {agentOptions.map((agentId) => <option value={agentId} key={agentId}>{agentId}</option>)}
                  </select>
                </label>
                <label>
                  <span>task status</span>
                  <select value={taskStatusFilter} onChange={(event) => setTaskStatusFilter(event.currentTarget.value)}>
                    <option value="all">all statuses</option>
                    {taskStatusOptions.map((status) => <option value={status} key={status}>{status}</option>)}
                  </select>
                </label>
                <label>
                  <span>media operation</span>
                  <select value={operationFilter} onChange={(event) => setOperationFilter(event.currentTarget.value)}>
                    <option value="all">all operations</option>
                    {operationOptions.map((capability) => <option value={capability} key={capability}>{capability}</option>)}
                  </select>
                </label>
              </div>
            </header>

            <div className="runtime-metrics">
              <div><span>active duration</span><b>{duration(query.aggregate.measured.activeDurationMs)}</b><small>{query.aggregate.coverage.activeExecutionsMeasured}/{query.aggregate.coverage.totalExecutions} executions measured</small></div>
              <div><span>input tokens</span><b>{measuredInteger(query.aggregate.measured.inputTokens)}</b><small>{query.aggregate.coverage.usageExecutionsMeasured}/{query.aggregate.coverage.totalExecutions} executions measured</small></div>
              <div><span>output tokens</span><b>{measuredInteger(query.aggregate.measured.outputTokens)}</b><small>turn.completed only</small></div>
              <div><span>failures</span><b>{query.aggregate.counts.failures}</b><small>structured failure events</small></div>
            </div>

            <div className="runtime-unavailable-grid">
              <span>queue time · unavailable</span>
              <span>dependency wait · unavailable</span>
              <span>reporting time · unavailable</span>
              <span>critical path · unavailable</span>
              <span>provider units · unavailable</span>
              <span>billing · unavailable</span>
            </div>

            <section className="runtime-query-block" aria-labelledby="runtime-operations-title">
              <header><h3 id="runtime-operations-title">Media operations</h3><span>{query.records.operations.length} matched</span></header>
              {query.records.operations.length === 0 ? (
                <p className="runtime-unavailable">No media operation matched this structured filter.</p>
              ) : (
                <div className="runtime-table-wrap">
                  <table>
                    <thead><tr><th>operation</th><th>status</th><th>agent / task</th><th>scope</th><th>evidence</th></tr></thead>
                    <tbody>
                      {query.records.operations.map((operation) => (
                        <tr key={operation.operationId}>
                          <td><b>{operation.capability}</b><code>{operation.operationId}</code></td>
                          <td>{operation.status}</td>
                          <td><code>{operation.agentId}</code><code>{operation.taskId}</code></td>
                          <td>{operation.trackId} [{operation.startMs}, {operation.endMs}) ms</td>
                          <td><SourceLinks sources={operation.sources} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <section className="runtime-query-block" aria-labelledby="runtime-executions-title">
              <header><h3 id="runtime-executions-title">Executor and measured usage</h3><span>{query.records.executions.length} matched</span></header>
              {query.records.executions.length === 0 ? (
                <p className="runtime-unavailable">No executor span matched this structured filter.</p>
              ) : (
                <div className="runtime-table-wrap">
                  <table>
                    <thead><tr><th>execution</th><th>outcome</th><th>active</th><th>measured tokens</th><th>source</th></tr></thead>
                    <tbody>
                      {query.records.executions.map((execution) => (
                        <tr key={execution.executionId}>
                          <td><code>{execution.executionId}</code><small>model {execution.model ?? "unavailable"}</small></td>
                          <td>{execution.status}</td>
                          <td>{duration(execution.activeDurationMs)}</td>
                          <td>
                            {execution.tokens
                              ? `${integer(execution.tokens.inputTokens)} in · ${integer(execution.tokens.outputTokens)} out`
                              : "unavailable"}
                          </td>
                          <td><SourceLinks sources={execution.sources} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <div className="runtime-query-columns">
              <section className="runtime-query-block" aria-labelledby="runtime-handoffs-title">
                <header><h3 id="runtime-handoffs-title">Handoffs</h3><span>{query.records.handoffs.length}</span></header>
                {query.records.handoffs.length === 0 ? <p className="runtime-unavailable">No structured handoff matched.</p> : query.records.handoffs.map((handoff) => (
                  <article className="runtime-fact" key={handoff.reportId}>
                    <b>{handoff.status}</b><code>{handoff.reportId}</code>
                    <small>{handoff.taskId} → {handoff.parentTaskId}</small>
                    <SourceLinks sources={handoff.sources} />
                  </article>
                ))}
              </section>
              <section className="runtime-query-block" aria-labelledby="runtime-failures-title">
                <header><h3 id="runtime-failures-title">Failures and rejections</h3><span>{query.records.failures.length}</span></header>
                {query.records.failures.length === 0 ? <p className="runtime-unavailable">No structured failure matched.</p> : query.records.failures.map((failure) => (
                  <article className="runtime-fact" key={failure.failureId}>
                    <b>{failure.kind}</b><code>{failure.entityId}</code>
                    <small>{failure.agentId ?? "agent unavailable"}</small>
                    <SourceLinks sources={failure.sources} />
                  </article>
                ))}
              </section>
            </div>
          </section>

          <section className="runtime-worker-projection" aria-labelledby="runtime-workers-title">
            <header className="runtime-section-heading">
              <div><span className="runtime-kicker">Journal projection</span><h2 id="runtime-workers-title">Workers</h2></div>
            </header>
            <div className="runtime-workers">
              {projection.workers.map((worker) => (
                <article className="runtime-worker" key={worker.agentId} data-status={worker.taskStatus}>
                  <header>
                    <div><span className="runtime-kind">{worker.kind}</span><h3>{worker.label}</h3></div>
                    <span className="runtime-status">{worker.taskStatus}</span>
                  </header>
                  <p className="runtime-objective">{worker.objective}</p>
                  <dl className="runtime-detail">
                    <div><dt>agent</dt><dd>{worker.agentId}</dd></div>
                    <div><dt>parent</dt><dd>{worker.parentAgentId ?? "root"}</dd></div>
                    <div><dt>capabilities</dt><dd>{worker.capabilities.join(", ") || "none"}</dd></div>
                    <div><dt>scope</dt><dd>{worker.mediaScope.length === 0 ? "no media grant" : worker.mediaScope.map((scope) => `${scope.trackId} [${scope.startMs}, ${scope.endMs}) ms`).join("; ")}</dd></div>
                  </dl>
                  {worker.execution ? (
                    <div className="runtime-receipt">
                      <div><span>executor</span><b>{worker.execution.status} · {duration(worker.execution.activeDurationMs)}</b></div>
                      {worker.execution.usage ? (
                        <div><span>measured model usage</span><b>{integer(worker.execution.usage.inputTokens)} in · {integer(worker.execution.usage.outputTokens)} out</b><small>model {worker.execution.usage.model ?? "unavailable"} · billing unavailable</small></div>
                      ) : <div><span>measured model usage</span><b>unavailable</b></div>}
                    </div>
                  ) : <p className="runtime-unavailable">No executor span was recorded.</p>}
                  {worker.report && <blockquote className="runtime-report"><span>report {worker.report.status}</span><p>{worker.report.summary}</p></blockquote>}
                </article>
              ))}
            </div>
          </section>

          <details className="runtime-sources">
            <summary>Source identity registry</summary>
            <p>
              Exact journal <code>{index.sourceJournal.content.contentId}</code>. Canonical event
              identities and content-addressed receipt/artifact links follow; raw journal text is
              not a query surface.
            </p>
            <div className="runtime-source-registry">
              <section>
                <h3>Events</h3>
                {query.sources.events.map((source) => (
                  <article id={domId("event", source.eventId)} key={source.eventId}>
                    <b>{source.eventId} · {source.type}</b><code>{source.contentId}</code>
                  </article>
                ))}
              </section>
              <section>
                <h3>Receipts</h3>
                {query.sources.receipts.map((source) => (
                  <article id={domId("receipt", source.receiptId)} key={source.receiptId}>
                    <b>{source.receiptId} · {source.kind}</b><code>{source.contentId}</code>
                    {source.rawReceiptContentId && <small>raw {source.rawReceiptContentId}</small>}
                  </article>
                ))}
              </section>
              <section>
                <h3>Artifacts</h3>
                {query.sources.artifacts.map((source) => (
                  <article id={domId("artifact", source.artifactId)} key={source.artifactId}>
                    <b>{source.artifactId} · {source.kind}</b><code>{source.contentId}</code>
                  </article>
                ))}
              </section>
            </div>
          </details>
        </section>
      )}
    </main>
  );
}
