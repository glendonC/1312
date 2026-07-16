import { useEffect, useMemo, useRef, useState } from "react";

import AgentMark from "../AgentMark";
import {
  createAgentIdentity,
  ORCHESTRATOR_IDENTITY,
  type AgentIdentity,
} from "../agentIdentity";
import type { AgentStatus, Role } from "../types";
import type {
  ProductionStudioProjection,
  ProductionStudioWorkerView,
} from "../runtime/production/studioProjection";
import type { WorkerKind } from "../runtime/production/model";
import type { RuntimeHostSourceSummary } from "../runtime/production/runtimeHost/model";
import type { LocalRuntimeLifecycleProjection } from "./model";
import type { RuntimeStatusView } from "./productLocalRuntimeShared";
import { seconds } from "./productLocalRuntimeShared";
import ProductionCoordinationLedger from "./ProductionCoordinationLedger";

interface ProductionProcessingCanvasProps {
  source: RuntimeHostSourceSummary;
  lifecycle: LocalRuntimeLifecycleProjection;
  status: RuntimeStatusView;
  production: ProductionStudioProjection;
  cursor: number;
  eventCount: number;
  lastEventType: string | null;
  pollState: "idle" | "polling" | "healthy" | "complete" | "error";
  pollMessage: string;
  captionResultCount: number;
  onOpenEvidence: () => void;
  onRetryPolling?: () => void;
  onPrepareAnotherRun: () => void;
}

interface RecordedFact {
  key: string;
  label: string;
  state: string;
}

const KIND_ROLE: Record<WorkerKind, Role> = {
  orchestrator: "orchestrator",
  media: "segment",
  analysis: "context",
  translation: "translate",
  quality: "qc",
};

function sentence(value: string): string {
  const normalized = value.replaceAll("_", " ").replaceAll(".", " ");
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function compactIdentity(value: string): string {
  const separator = value.indexOf(":");
  const body = separator >= 0 ? value.slice(separator + 1) : value;
  return body.length > 12 ? `${body.slice(0, 6)}…${body.slice(-4)}` : body;
}

function workerAgentStatus(worker: ProductionStudioWorkerView): AgentStatus {
  if (worker.status === "working") return "working";
  if (worker.status === "reporting") return "reporting";
  if (worker.status === "retired") return "done";
  return "spawning";
}

function workerStatusLabel(worker: ProductionStudioWorkerView): string {
  if (worker.taskStatus === "failed") return "Failed";
  if (worker.taskStatus === "withheld") return "Withheld";
  if (worker.taskStatus === "completed") return "Complete";
  if (worker.status === "reporting") return "Reporting";
  if (worker.status === "working") return "Working";
  return "Registered";
}

function buildWorkerIdentities(
  workers: readonly ProductionStudioWorkerView[],
): Map<string, AgentIdentity> {
  const byId = new Map(workers.map((worker) => [worker.agentId, worker]));
  const identities = new Map<string, AgentIdentity>();
  const resolving = new Set<string>();

  function resolve(worker: ProductionStudioWorkerView): AgentIdentity {
    const existing = identities.get(worker.agentId);
    if (existing) return existing;
    if (resolving.has(worker.agentId)) return ORCHESTRATOR_IDENTITY;
    resolving.add(worker.agentId);
    const parentWorker = worker.parentAgentId ? byId.get(worker.parentAgentId) : null;
    const parent = parentWorker ? resolve(parentWorker) : undefined;
    const identity = createAgentIdentity({
      id: worker.agentId,
      role: KIND_ROLE[worker.kind],
      parent,
    });
    identities.set(worker.agentId, identity);
    resolving.delete(worker.agentId);
    return identity;
  }

  for (const worker of workers) resolve(worker);
  return identities;
}

function currentFacts(production: ProductionStudioProjection): RecordedFact[] {
  const facts: RecordedFact[] = [];
  const caption = production.captionProductions.at(-1);
  const captionQc = production.captionQualityControls.at(-1);
  const review = production.publishReviewDecisions.at(-1);
  const intake = production.publishReviewIntakes.at(-1);
  const decision = production.evidenceDecisions.at(-1);
  const assessment = production.evidenceAssessments.at(-1);
  const operation = production.operations.at(-1);

  if (captionQc) {
    facts.push({
      key: captionQc.qcId,
      label: "Caption QC",
      state: sentence(captionQc.outcome),
    });
  }
  if (caption) {
    facts.push({
      key: caption.jobId,
      label: "Caption production",
      state: caption.status === "completed" && caption.resultStatus
        ? sentence(caption.resultStatus)
        : sentence(caption.status),
    });
  }
  if (review) {
    facts.push({
      key: review.reviewId,
      label: "Human review",
      state: review.outcome ? sentence(review.outcome) : sentence(review.status),
    });
  }
  if (intake) {
    facts.push({
      key: intake.intakeId,
      label: "Review intake",
      state: intake.outcome ? sentence(intake.outcome) : sentence(intake.status),
    });
  }
  if (decision) {
    facts.push({
      key: decision.operationId,
      label: "Evidence decision",
      state: decision.outcome ? sentence(decision.outcome) : sentence(decision.status),
    });
  }
  if (assessment) {
    facts.push({
      key: assessment.operationId,
      label: "Evidence assessment",
      state: sentence(assessment.status),
    });
  }
  if (operation) {
    facts.push({
      key: operation.operationId,
      label: operation.capability,
      state: sentence(operation.status),
    });
  }

  return facts.slice(0, 4);
}

function artifactState(production: ProductionStudioProjection, captionResultCount: number): {
  label: string;
  detail: string;
  tone: "quiet" | "active" | "available" | "failed";
} {
  const job = production.captionProductions.at(-1);
  if (job?.status === "failed") {
    return {
      label: "Caption production failed",
      detail: job.failure ?? "The journal records a failed caption job without a returned artifact.",
      tone: "failed",
    };
  }
  if (job?.status === "started") {
    return {
      label: "Caption job recorded",
      detail: "No completed caption artifact has been verified yet.",
      tone: "active",
    };
  }
  if (job?.status === "completed") {
    const lineCount = job.lineCount === null ? "line count unavailable" : `${job.lineCount} timed lines`;
    const qualityControl = production.captionQualityControls.find((qc) => qc.jobId === job.jobId) ?? null;
    if (!qualityControl) {
      return {
        label: "Caption candidate awaiting QC",
        detail: `${sentence(job.resultStatus ?? "completed")} · ${lineCount}. No independent QC receipt is recorded.`,
        tone: "quiet",
      };
    }
    if (qualityControl.outcome === "withheld") {
      return {
        label: "Caption candidate withheld",
        detail: `${qualityControl.reasonCodes.map(sentence).join(" · ")}. The private candidate is not QC-accepted or published.`,
        tone: "quiet",
      };
    }
    return {
      label: captionResultCount > 0 ? "Structurally accepted private candidate" : "QC acceptance receipt recorded",
      detail: `${lineCount}. Structural current-run acceptance only; no semantic-quality or publication authority is present.`,
      tone: captionResultCount > 0 ? "available" : "quiet",
    };
  }

  const completedReview = production.publishReviewDecisions.find((review) =>
    review.status === "completed" && review.outcome === "approve_for_caption_production");
  if (completedReview) {
    return {
      label: "Caption production approved",
      detail: "Approval is verified. A separate caption job has not been started.",
      tone: "active",
    };
  }

  const queuedIntake = production.publishReviewIntakes.find((intake) =>
    intake.status === "completed" && intake.outcome === "queued");
  if (queuedIntake) {
    return {
      label: "Awaiting human review",
      detail: "The verified intake is queued. No caption artifact exists.",
      tone: "active",
    };
  }

  return {
    label: "No usable caption artifact",
    detail: "The runtime has not recorded a completed, host-verified caption result.",
    tone: "quiet",
  };
}

function evidenceActionLabel(production: ProductionStudioProjection, captionResultCount: number): string {
  if (captionResultCount > 0) return "Inspect caption lineage";
  if (production.captionProductions.some((job) => job.status === "started")) return "Inspect caption job";
  if (production.publishReviewDecisions.some((review) =>
    review.status === "completed" && review.outcome === "approve_for_caption_production")) {
    return "Continue to caption production";
  }
  if (production.publishReviewIntakes.some((intake) =>
    intake.status === "completed" && intake.outcome === "queued")) {
    return "Review queued intake";
  }
  return "Inspect recorded evidence";
}

function WorkerFocus({
  source,
  workers,
  identities,
  index,
  onIndex,
  onClose,
}: {
  source: RuntimeHostSourceSummary;
  workers: readonly ProductionStudioWorkerView[];
  identities: Map<string, AgentIdentity>;
  index: number;
  onIndex: (index: number) => void;
  onClose: () => void;
}) {
  const closeButton = useRef<HTMLButtonElement>(null);
  const worker = workers[index];
  const identity = identities.get(worker.agentId) ?? ORCHESTRATOR_IDENTITY;
  const workerIsActive = worker.status === "working" || worker.status === "reporting";

  useEffect(() => {
    closeButton.current?.focus();
    function keydown(event: KeyboardEvent): void {
      if (event.key === "Escape") onClose();
      if (event.key === "ArrowRight") onIndex((index + 1) % workers.length);
      if (event.key === "ArrowLeft") onIndex((index - 1 + workers.length) % workers.length);
    }
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [index, onClose, onIndex, workers.length]);

  const scope = worker.mediaScope.at(0);

  return (
    <div className="processing-focus-scrim">
      <section
        className="processing-focus"
        role="dialog"
        aria-modal="true"
        aria-labelledby="processing-focus-title"
      >
        <div className="processing-focus-identity">
          <span className="processing-focus-mark">
            <AgentMark
              identity={identity}
              status={workerAgentStatus(worker)}
              fieldMotion={workerIsActive ? "auto" : "still"}
            />
          </span>
          <span className="processing-kicker">Recorded worker</span>
          <h2 id="processing-focus-title">{worker.label}</h2>
          <p>
            {sentence(worker.kind)} ·{" "}
            <span className={workerIsActive ? "text-shimmer" : undefined}>
              {workerStatusLabel(worker)}
            </span>
          </p>
        </div>

        <div className="processing-focus-media" aria-label="Assigned source range">
          <div className="processing-focus-media-field">
            <span>Assigned source</span>
            <b>{source.label}</b>
            <small>
              {scope
                ? `${seconds(scope.startMs)}–${seconds(scope.endMs)} · ${scope.trackId}`
                : "No media scope recorded"}
            </small>
          </div>
          <p>This is recorded assignment scope, not an autonomous playback control.</p>
        </div>

        <div className="processing-focus-activity">
          <span className="processing-kicker">Recorded activity</span>
          <h3>{workerStatusLabel(worker)}</h3>
          <p>{worker.objective}</p>
          <dl>
            <div><dt>Agent</dt><dd>{worker.agentId}</dd></div>
            <div><dt>Task</dt><dd>{worker.taskId}</dd></div>
            <div><dt>Capabilities</dt><dd>{worker.capabilities.length > 0 ? worker.capabilities.join(" · ") : "None recorded"}</dd></div>
            <div>
              <dt>Execution</dt>
              <dd>{worker.execution ? `${worker.execution.status} · ${compactIdentity(worker.execution.id)}` : "No execution recorded"}</dd>
            </div>
            <div>
              <dt>Report</dt>
              <dd>{worker.report ? `${worker.report.status} · ${worker.report.summary}` : "No report recorded"}</dd>
            </div>
          </dl>
        </div>

        <div className="processing-focus-commands">
          <button
            type="button"
            onClick={() => onIndex((index - 1 + workers.length) % workers.length)}
            disabled={workers.length < 2}
          >
            Previous worker <kbd>←</kbd>
          </button>
          <span>{index + 1} of {workers.length}</span>
          <button
            type="button"
            onClick={() => onIndex((index + 1) % workers.length)}
            disabled={workers.length < 2}
          >
            Next worker <kbd>→</kbd>
          </button>
          <button ref={closeButton} type="button" onClick={onClose}>Close <kbd>Esc</kbd></button>
        </div>
      </section>
    </div>
  );
}

export default function ProductionProcessingCanvas({
  source,
  lifecycle,
  status,
  production,
  cursor,
  eventCount,
  lastEventType,
  pollState,
  pollMessage,
  captionResultCount,
  onOpenEvidence,
  onRetryPolling,
  onPrepareAnotherRun,
}: ProductionProcessingCanvasProps) {
  const [focusedWorker, setFocusedWorker] = useState<number | null>(null);
  const workerButtons = useRef<Array<HTMLButtonElement | null>>([]);
  const workers = production.workers;
  const identities = useMemo(() => buildWorkerIdentities(workers), [workers]);
  const facts = useMemo(() => currentFacts(production), [production]);
  const artifact = artifactState(production, captionResultCount);
  const activeWorkers = workers.filter((worker) =>
    worker.status === "working" || worker.status === "reporting");
  const failed = lifecycle.tone === "failed" || pollState === "error";

  function closeWorkerFocus(): void {
    const returningIndex = focusedWorker;
    setFocusedWorker(null);
    if (returningIndex !== null) {
      window.requestAnimationFrame(() => workerButtons.current[returningIndex]?.focus());
    }
  }

  return (
    <section
      className="processing-canvas"
      data-lifecycle={status.lifecycle}
      data-poll-state={pollState}
      aria-label="Processing canvas"
    >
      <header className="processing-source-bar">
        <div className="processing-source-glyph" aria-hidden="true">
          <span />
        </div>
        <div>
          <span className="processing-kicker">Registered owned source</span>
          <h2 id="processing-source-title">{source.label}</h2>
          <p>
            {seconds(source.durationMs)} · {source.trackCount} {source.trackCount === 1 ? "track" : "tracks"} · local processing
          </p>
        </div>
        <div className="processing-source-receipt">
          <span>Resolved</span>
          <b>{compactIdentity(source.sourceContentId)}</b>
        </div>
      </header>

      <div className="processing-stage">
        <section className="processing-system" aria-labelledby="processing-system-title">
          <span className="processing-kicker">System state</span>
          <div className="processing-state-heading">
            <span className="processing-state-indicator" aria-hidden="true" />
            <h3 id="processing-system-title">{pollState === "error" ? "Journal updates paused" : lifecycle.label}</h3>
          </div>
          <p>{pollState === "error" ? pollMessage : lifecycle.detail}</p>
          <dl>
            <div><dt>Runtime</dt><dd>{compactIdentity(status.runtimeId)}</dd></div>
            <div><dt>Journal</dt><dd>{eventCount} validated {eventCount === 1 ? "event" : "events"}</dd></div>
            <div><dt>Latest type</dt><dd>{lastEventType ?? "No event recorded"}</dd></div>
          </dl>
          {pollState !== "error" && <p className="processing-journal-note">{pollMessage}</p>}
          {pollState === "error" && onRetryPolling && (
            <button type="button" className="processing-inline-action" onClick={onRetryPolling}>
              Retry from cursor {cursor}
            </button>
          )}
        </section>

        <section className="processing-topology" aria-labelledby="processing-workers-title">
          <header>
            <div>
              <span className="processing-kicker">Recorded topology</span>
              <h3 id="processing-workers-title">
                {activeWorkers.length === 1
                  ? `${activeWorkers[0].label} is active`
                  : activeWorkers.length > 1
                    ? `${activeWorkers.length} workers are active`
                    : `${workers.length} recorded ${workers.length === 1 ? "worker" : "workers"}`}
              </h3>
            </div>
            <span>{production.counts.tasks} {production.counts.tasks === 1 ? "task" : "tasks"}</span>
          </header>

          {workers.length > 0 ? (
            <div className="processing-worker-field" data-worker-count={Math.min(workers.length, 6)}>
              {workers.map((worker, index) => {
                const identity = identities.get(worker.agentId) ?? ORCHESTRATOR_IDENTITY;
                return (
                  <button
                    ref={(element) => { workerButtons.current[index] = element; }}
                    key={worker.agentId}
                    type="button"
                    className="processing-worker"
                    data-active={activeWorkers.includes(worker)}
                    data-state={worker.taskStatus}
                    onClick={() => setFocusedWorker(index)}
                    aria-label={`Inspect ${worker.label}, ${workerStatusLabel(worker)}`}
                  >
                    <span className="processing-worker-mark">
                      <AgentMark
                        identity={identity}
                        status={workerAgentStatus(worker)}
                        fieldMotion={activeWorkers.includes(worker) ? "auto" : "still"}
                      />
                    </span>
                    <b>{worker.label}</b>
                    <small className={activeWorkers.includes(worker) ? "text-shimmer" : undefined}>
                      {workerStatusLabel(worker)}
                    </small>
                    <small className="processing-worker-parent">
                      {worker.parentAgentId ? `Child of ${compactIdentity(worker.parentAgentId)}` : "Root worker"}
                    </small>
                  </button>
                );
              })}
            </div>
          ) : (
            <p className="processing-empty-topology">
              No worker registration is present in the validated journal yet.
            </p>
          )}
        </section>

        <aside className="processing-activity" aria-labelledby="processing-activity-title">
          <span className="processing-kicker">Recorded activity</span>
          <h3 id="processing-activity-title">{lastEventType ?? "Waiting for journal evidence"}</h3>
          {facts.length > 0 ? (
            <ol>
              {facts.map((fact) => (
                <li key={fact.key}>
                  <span>{fact.label}</span>
                  <b>{fact.state}</b>
                </li>
              ))}
            </ol>
          ) : (
            <p>No production operation, assessment, decision, or artifact fact is recorded yet.</p>
          )}
        </aside>
      </div>

      <ProductionCoordinationLedger production={production} />

      <div className="processing-artifact" data-tone={artifact.tone}>
        <div>
          <span className="processing-kicker">Caption disposition</span>
          <h3>{artifact.label}</h3>
          <p>{artifact.detail}</p>
        </div>
        <button type="button" onClick={onOpenEvidence}>{evidenceActionLabel(production, captionResultCount)}</button>
      </div>

      <footer className="processing-dock-well">
        <div className="processing-control-boundary">
          This host exposes no pause or cancellation command. Leaving this view does not stop accepted work.
        </div>
        <div className="processing-dock" data-failed={failed} data-closed={lifecycle.closed}>
          <span className="processing-dock-state">
            <i aria-hidden="true" />
            <span>
              {pollState === "error" ? "Evidence connection interrupted" : lifecycle.label}
              <small>No pause or cancel command</small>
            </span>
          </span>
          <span className="processing-dock-evidence">Cursor {cursor} · head {status.journalHead}</span>
          <div className="processing-dock-actions">
            <button type="button" onClick={onOpenEvidence}>Evidence</button>
            {lifecycle.closed && (
              <button type="button" onClick={onPrepareAnotherRun}>Prepare another run</button>
            )}
          </div>
        </div>
      </footer>

      {focusedWorker !== null && workers[focusedWorker] && (
        <WorkerFocus
          source={source}
          workers={workers}
          identities={identities}
          index={focusedWorker}
          onIndex={setFocusedWorker}
          onClose={closeWorkerFocus}
        />
      )}
    </section>
  );
}
