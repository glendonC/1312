import { useState } from "react";

import { inspectMemoryReviewArtifacts } from "./inspection";
import type { MemoryReviewInspection } from "./model";

const MAX_TOTAL_BYTES = 5 * 1024 * 1024;

function compact(value: string): string {
  return value.length <= 38 ? value : `${value.slice(0, 20)}…${value.slice(-12)}`;
}

function json(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

export default function MemoryReviewInspector() {
  const [inspection, setInspection] = useState<MemoryReviewInspection | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filenames, setFilenames] = useState<string[]>([]);

  const load = async (selected: FileList | null): Promise<void> => {
    setInspection(null);
    setError(null);
    const files = [...(selected ?? [])];
    setFilenames(files.map((file) => file.name));
    if (files.length === 0) return;
    const totalBytes = files.reduce((total, file) => total + file.size, 0);
    if (files.some((file) => file.size <= 0) || totalBytes > MAX_TOTAL_BYTES) {
      setError("Selected receipts must be non-empty and no larger than 5 MB in total.");
      return;
    }
    try {
      const artifacts = await Promise.all(
        files.map(async (file) => {
          try {
            return JSON.parse(await file.text()) as unknown;
          } catch (cause) {
            throw new Error(`${file.name} is not readable JSON`, { cause });
          }
        }),
      );
      setInspection(await inspectMemoryReviewArtifacts(artifacts));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The memory review receipts could not be validated.");
    }
  };

  return (
    <main className="runtime-inspector memory-inspector">
      <header className="runtime-hero">
        <nav className="memory-nav" aria-label="Studio inspectors">
          <a href="/studio/" className="runtime-back">1321 Studio</a>
          <a href="/studio/runtime/">Run Explorer</a>
        </nav>
        <p className="runtime-kicker">Memory review inspector</p>
        <h1>Inspect what may outlive a run</h1>
        <p className="runtime-lede">
          Select immutable memory review receipts together. This inspector derives proposal state,
          supersession, rollback, accepted materializations, and run consumption only from those
          receipts. It cannot accept a proposal or silently promote legacy glossary data.
        </p>
      </header>

      <section className="runtime-loader" aria-labelledby="memory-load-title">
        <div>
          <h2 id="memory-load-title">Choose review receipt JSON</h2>
          <p>Include every proposal, decision, legacy, materialization, and consumption receipt referenced by the view.</p>
        </div>
        <label className="runtime-file">
          <span>{filenames.length === 0 ? "Select review receipts" : `${filenames.length} receipt${filenames.length === 1 ? "" : "s"}`}</span>
          <input
            type="file"
            accept=".json,application/json"
            multiple
            onChange={(event) => void load(event.currentTarget.files)}
          />
        </label>
      </section>

      <aside className="memory-boundary">
        <strong>Inspection boundary</strong>
        <p>
          This is an operator-selected receipt set, not repository discovery. Referenced receipts
          must be present and cryptographically consistent. External evidence paths are displayed
          by their recorded content IDs; this browser view does not re-read those external bytes.
        </p>
      </aside>

      {error && <p className="runtime-error" role="alert">Rejected: {error}</p>}

      {!inspection && !error && (
        <section className="runtime-empty" aria-live="polite">
          <p>No memory review evidence is loaded.</p>
          <span>No receipt means no accepted snapshot or run consumption is inferred.</span>
        </section>
      )}

      {inspection && (
        <section className="runtime-projection memory-projection" aria-live="polite">
          <header className="runtime-summary">
            <div>
              <span className="runtime-proof">Validated selected receipts · no promotion controls</span>
              <h2>Review evidence</h2>
              <code>{filenames.join(" · ")}</code>
            </div>
            <dl>
              <div><dt>proposals</dt><dd>{inspection.counts.proposals}</dd></div>
              <div><dt>decisions</dt><dd>{inspection.counts.decisions}</dd></div>
              <div><dt>snapshots</dt><dd>{inspection.counts.materializations}</dd></div>
              <div><dt>consumed</dt><dd>{inspection.counts.consumptions}</dd></div>
            </dl>
          </header>

          <section className="memory-section" aria-labelledby="memory-proposals-title">
            <header className="runtime-section-heading">
              <div><span className="runtime-kicker">Proposal → decision</span><h2 id="memory-proposals-title">Review state</h2></div>
            </header>
            {inspection.proposals.length === 0 ? (
              <p className="runtime-unavailable">No proposal receipt is recorded in this selection.</p>
            ) : (
              <div className="memory-cards">
                {inspection.proposals.map((proposal) => (
                  <article className="memory-card" data-status={proposal.status} key={proposal.proposalId}>
                    <header>
                      <div><span>{proposal.kind} · {proposal.namespace}</span><h3>{proposal.key}</h3></div>
                      <b>{proposal.status}</b>
                    </header>
                    <dl>
                      <div><dt>proposal</dt><dd><code title={proposal.proposalId}>{compact(proposal.proposalId)}</code></dd></div>
                      <div><dt>content</dt><dd><code>{proposal.proposalContentId}</code></dd></div>
                      <div><dt>proposer</dt><dd>{proposal.proposedBy}</dd></div>
                      <div><dt>supersedes</dt><dd>{proposal.supersedes ? <code>{compact(proposal.supersedes)}</code> : "none"}</dd></div>
                      <div><dt>superseded by</dt><dd>{proposal.supersededBy ? <code>{compact(proposal.supersededBy)}</code> : "none"}</dd></div>
                    </dl>
                    {proposal.primaryDecision ? (
                      <div className="memory-decision">
                        <strong>{proposal.primaryDecision.action} · {proposal.primaryDecision.decided_by}</strong>
                        <p>{proposal.primaryDecision.reason}</p>
                        <code>{proposal.primaryDecision.decision_id}</code>
                      </div>
                    ) : <p className="runtime-unavailable">No primary decision receipt is recorded.</p>}
                    {proposal.revocation && (
                      <div className="memory-decision memory-revocation">
                        <strong>revoke · {proposal.revocation.decided_by}</strong>
                        <p>{proposal.revocation.reason}</p>
                        <code>{proposal.revocation.decision_id}</code>
                      </div>
                    )}
                    <details>
                      <summary>Value and evidence receipts</summary>
                      <pre>{json(proposal.value)}</pre>
                      {proposal.evidence.map((evidence) => (
                        <div className="memory-evidence" key={`${evidence.path}:${evidence.content_id}`}>
                          <b>{evidence.path}</b><code>{evidence.content_id}</code><small>{evidence.bytes} recorded bytes</small>
                        </div>
                      ))}
                    </details>
                  </article>
                ))}
              </div>
            )}
          </section>

          <section className="memory-section" aria-labelledby="memory-rollback-title">
            <header className="runtime-section-heading">
              <div><span className="runtime-kicker">Receipt-derived edges</span><h2 id="memory-rollback-title">Supersession and rollback</h2></div>
            </header>
            {inspection.transitions.length === 0 ? (
              <p className="runtime-unavailable">No accepted supersession or revocation receipt is recorded.</p>
            ) : (
              <div className="memory-timeline">
                {inspection.transitions.map((transition) => (
                  <article key={transition.decisionId}>
                    <span>{transition.type}</span>
                    <h3>{transition.type === "supersession" ? "Accepted replacement" : "Accepted head revoked"}</h3>
                    <p>
                      {transition.type === "supersession"
                        ? <><code>{compact(transition.priorProposalId ?? "missing")}</code> → <code>{compact(transition.proposalId)}</code></>
                        : <><code>{compact(transition.proposalId)}</code> → {transition.restoredProposalId ? <code>{compact(transition.restoredProposalId)}</code> : <b>no accepted head</b>}</>}
                    </p>
                    <small>{transition.createdAt}</small>
                    <code>{transition.decisionId}</code>
                  </article>
                ))}
              </div>
            )}
          </section>

          <section className="memory-section" aria-labelledby="memory-snapshots-title">
            <header className="runtime-section-heading">
              <div><span className="runtime-kicker">Accepted heads only</span><h2 id="memory-snapshots-title">Materialized snapshots</h2></div>
            </header>
            {inspection.materializations.length === 0 ? (
              <p className="runtime-unavailable">No accepted materialization receipt is recorded.</p>
            ) : inspection.materializations.map((snapshot) => (
              <article className="memory-snapshot" key={snapshot.materializationId}>
                <header><h3>{snapshot.entries.length} accepted entr{snapshot.entries.length === 1 ? "y" : "ies"}</h3><span>{snapshot.createdAt}</span></header>
                <dl>
                  <div><dt>materialization</dt><dd><code>{snapshot.materializationId}</code></dd></div>
                  <div><dt>accepted snapshot content ID</dt><dd><code>{snapshot.snapshotContentId}</code></dd></div>
                  <div><dt>receipt content ID</dt><dd><code>{snapshot.receiptContentId}</code></dd></div>
                  <div><dt>legacy inputs</dt><dd>{snapshot.legacyInputs.length} recorded · excluded from entries</dd></div>
                </dl>
                <details>
                  <summary>Accepted entries and provenance</summary>
                  <pre>{json(snapshot.entries)}</pre>
                </details>
              </article>
            ))}
          </section>

          <section className="memory-section memory-consumption" aria-labelledby="memory-consumption-title">
            <header className="runtime-section-heading">
              <div><span className="runtime-kicker">Run-input boundary</span><h2 id="memory-consumption-title">Recorded consumption</h2></div>
            </header>
            {inspection.consumptions.length === 0 ? (
              <div className="memory-no-consumption">
                <strong>Unavailable</strong>
                <p>No run consumption receipt is recorded. A materialization alone does not prove that a run received memory.</p>
              </div>
            ) : inspection.consumptions.map((receipt) => (
              <article className="memory-snapshot" key={receipt.consumptionId}>
                <header><h3>{receipt.runId}</h3><span>{receipt.consumedAt}</span></header>
                <dl>
                  <div><dt>consumption receipt</dt><dd><code>{receipt.consumptionId}</code></dd></div>
                  <div><dt>exact snapshot content ID</dt><dd><code>{receipt.snapshot.snapshot_content_id}</code></dd></div>
                  <div><dt>materialization receipt</dt><dd><code>{receipt.snapshot.materialization_receipt_content_id}</code></dd></div>
                  <div><dt>entry count</dt><dd>{receipt.snapshot.entry_count}</dd></div>
                </dl>
              </article>
            ))}
          </section>

          <section className="memory-section" aria-labelledby="memory-legacy-title">
            <header className="runtime-section-heading">
              <div><span className="runtime-kicker">Never silently promoted</span><h2 id="memory-legacy-title">Legacy inputs</h2></div>
            </header>
            {inspection.legacyInputs.length === 0 ? (
              <p className="runtime-unavailable">No legacy snapshot receipt is selected.</p>
            ) : inspection.legacyInputs.map((legacy) => (
              <article className="memory-legacy" key={legacy.snapshot_id}>
                <strong>{legacy.status}</strong><span>{legacy.namespace}</span>
                <code>{legacy.snapshot_id}</code><code>{legacy.source.content_id}</code>
                <small>{legacy.source.path} · {legacy.entry_count ?? "unknown"} recorded entries · none accepted by this receipt</small>
              </article>
            ))}
          </section>
        </section>
      )}
    </main>
  );
}
