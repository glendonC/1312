import type { ReactNode } from "react";

import type {
  ProductionStudioProjection,
  ProductionStudioSpawnView,
} from "../runtime/production/studioProjection";
import { seconds } from "./productLocalRuntimeShared";

function sentence(value: string): string {
  const normalized = value.replaceAll("_", " ").replaceAll(".", " ");
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function identity(value: string | null): ReactNode {
  return value ? <code>{value}</code> : <span className="processing-receipt-missing">Not recorded</span>;
}

function mediaScope(
  scopes: readonly { artifactId: string; trackId: string; startMs: number; endMs: number }[],
): ReactNode {
  if (scopes.length === 0) return <span className="processing-receipt-missing">No media scope in contract</span>;
  return scopes.map((scope) => (
    <span className="processing-receipt-scope" key={`${scope.artifactId}:${scope.trackId}:${scope.startMs}`}>
      {identity(scope.artifactId)} · {scope.trackId} · {seconds(scope.startMs)}–{seconds(scope.endMs)}
    </span>
  ));
}

function HandoffReceipt({
  spawn,
  production,
}: {
  spawn: ProductionStudioSpawnView;
  production: ProductionStudioProjection;
}) {
  const report = production.reports.find((candidate) =>
    candidate.taskId === spawn.taskId && candidate.agentId === spawn.agentId) ?? null;
  const disposition = report
    ? production.rootOutputDispositions.find((candidate) => candidate.reportId === report.reportId) ?? null
    : null;

  return (
    <article
      className="processing-handoff"
      data-production-live-spawn-id={spawn.requestId}
      data-spawn-decision={spawn.decision}
    >
      <header>
        <div>
          <span className="processing-receipt-eyebrow">Root → child</span>
          <h4>{spawn.workerLabel}</h4>
        </div>
        <span className="processing-receipt-state" data-state={spawn.decision}>{sentence(spawn.decision)}</span>
      </header>
      <ol className="processing-handoff-chain">
        <li data-state="recorded">
          <span>Spawn request</span>
          <b>{identity(spawn.requestId)}</b>
          <small>Producer {identity(spawn.requestedByAgentId)} · task {identity(spawn.requestedByTaskId)}</small>
        </li>
        <li data-state={spawn.decision}>
          <span>Scheduler decision</span>
          <b>{sentence(spawn.decision)}</b>
          <small>
            {spawn.decision === "accepted"
              ? <>Child {identity(spawn.agentId)} · task {identity(spawn.taskId)}</>
              : spawn.decision === "rejected"
                ? <>Reason {identity(spawn.rejection)}</>
                : "No spawn decision receipt recorded yet"}
          </small>
        </li>
        <li data-state={report?.status ?? "missing"}>
          <span>Child report</span>
          <b>{report ? sentence(report.status) : spawn.decision === "rejected" ? "Not created" : "Not recorded"}</b>
          <small>
            {report
              ? <>{identity(report.reportId)} · {report.outputArtifactIds.length} output artifact{report.outputArtifactIds.length === 1 ? "" : "s"}</>
              : spawn.decision === "rejected"
                ? "The rejected spawn created no child or report"
                : "No report receipt is present for this child"}
          </small>
        </li>
        <li data-state={disposition?.outcome ?? "missing"}>
          <span>Root disposition</span>
          <b>
            {disposition
              ? sentence(disposition.outcome)
              : report
                ? "Not recorded"
                : "No report to disposition"}
          </b>
          <small>
            {disposition
              ? <>{identity(disposition.receiptId)} · input {identity(disposition.inputArtifactId)}</>
              : report
                ? "No root promotion or rejection receipt is present"
                : "A root disposition requires a decided child report"}
          </small>
        </li>
      </ol>
      <dl>
        <div><dt>Objective</dt><dd>{spawn.objective}</dd></div>
        <div><dt>Requested capabilities</dt><dd>{spawn.requiredCapabilities.join(" · ") || "None in request"}</dd></div>
        <div><dt>Requested media scope</dt><dd>{mediaScope(spawn.mediaScope)}</dd></div>
        <div><dt>Report decision reason</dt><dd>{report?.decisionReason ?? "Not recorded"}</dd></div>
        <div><dt>Disposition receipt content</dt><dd>{identity(disposition?.receiptContentId ?? null)}</dd></div>
      </dl>
    </article>
  );
}

export default function ProductionCoordinationLedger({
  production,
}: {
  production: ProductionStudioProjection;
}) {
  const semanticEvidence = production.semanticEvidence ?? [];
  const unlinkedReports = production.reports.filter((report) =>
    !production.spawnRequests.some((spawn) =>
      spawn.taskId === report.taskId && spawn.agentId === report.agentId));

  return (
    <section
      className="processing-receipt-board"
      aria-labelledby="processing-receipt-board-title"
      data-production-live-region="coordination-ledger"
    >
      <header className="processing-receipt-board-header">
        <div>
          <span className="processing-kicker">Validated production projection</span>
          <h3 id="processing-receipt-board-title">Receipt-backed coordination</h3>
          <p>Current journal facts only · host-validated composition · no replay-agent state.</p>
        </div>
        <dl aria-label="Projection counts">
          <div><dt>Tasks</dt><dd>{production.counts.tasks}</dd></div>
          <div><dt>Workers</dt><dd>{production.counts.workers}</dd></div>
          <div><dt>Grants</dt><dd>{production.counts.grants}</dd></div>
          <div><dt>Operations</dt><dd>{production.counts.operations + semanticEvidence.length + production.counts.evidenceReads}</dd></div>
        </dl>
      </header>

      <div className="processing-receipt-grid">
        <section className="processing-receipt-panel" aria-labelledby="processing-task-ledger-title">
          <header>
            <span className="processing-receipt-index">01</span>
            <div><h4 id="processing-task-ledger-title">Tasks, workers, and grants</h4><p>Registered identities and enforced scope.</p></div>
          </header>
          {production.tasks.length === 0 ? (
            <p className="processing-receipt-empty" data-production-live-empty="tasks">
              No task creation receipt is present. Workers and grants remain absent.
            </p>
          ) : (
            <div className="processing-receipt-list">
              {production.tasks.map((task) => {
                const worker = production.workers.find((candidate) => candidate.taskId === task.taskId) ?? null;
                const grants = production.grants.filter((grant) => grant.taskId === task.taskId);
                return (
                  <article key={task.taskId} data-production-live-task-id={task.taskId} data-task-status={task.status}>
                    <header><h5>{task.label}</h5><span>{sentence(task.status)}</span></header>
                    <dl>
                      <div><dt>Task</dt><dd>{identity(task.taskId)}</dd></div>
                      <div><dt>Worker</dt><dd>{worker ? <>{worker.label} · {identity(worker.agentId)}</> : "No agent registration recorded"}</dd></div>
                      <div><dt>Worker state</dt><dd>{worker ? `${sentence(worker.status)} · task ${sentence(worker.taskStatus)}` : "Not recorded"}</dd></div>
                      <div><dt>Parent</dt><dd>{task.parentAgentId ? <>{identity(task.parentAgentId)} · task {identity(task.parentTaskId)}</> : "Root task"}</dd></div>
                      <div><dt>Scope</dt><dd>{mediaScope(task.mediaScope)}</dd></div>
                      <div>
                        <dt>Grants</dt>
                        <dd>
                          {grants.length > 0
                            ? grants.map((grant) => (
                                <span className="processing-receipt-grant" key={grant.grantId} data-production-live-grant-id={grant.grantId}>
                                  {grant.capability} · {identity(grant.grantId)}
                                </span>
                              ))
                            : <span className="processing-receipt-missing">No scheduler grant recorded</span>}
                        </dd>
                      </div>
                    </dl>
                  </article>
                );
              })}
            </div>
          )}
        </section>

        <section className="processing-receipt-panel processing-receipt-panel-wide" aria-labelledby="processing-handoffs-title">
          <header>
            <span className="processing-receipt-index">02</span>
            <div><h4 id="processing-handoffs-title">Root → child handoffs</h4><p>Request, scheduler decision, report, and root disposition.</p></div>
          </header>
          {production.spawnRequests.length === 0 ? (
            <p className="processing-receipt-empty" data-production-live-empty="handoffs">
              No root-to-child spawn request is recorded. No child handoff or promotion is implied.
            </p>
          ) : (
            <div className="processing-handoff-list">
              {production.spawnRequests.map((spawn) => (
                <HandoffReceipt key={spawn.requestId} spawn={spawn} production={production} />
              ))}
            </div>
          )}
          {unlinkedReports.map((report) => (
            <p className="processing-receipt-empty" key={report.reportId} data-production-live-unlinked-report={report.reportId}>
              Report {identity(report.reportId)} is recorded without a projected spawn association.
            </p>
          ))}
        </section>

        <section className="processing-receipt-panel" aria-labelledby="processing-media-ledger-title">
          <header>
            <span className="processing-receipt-index">03</span>
            <div><h4 id="processing-media-ledger-title">Media and perception receipts</h4><p>Only operations that reached the journal.</p></div>
          </header>
          {production.operations.length === 0 && semanticEvidence.length === 0 && production.evidenceReads.length === 0 ? (
            <p className="processing-receipt-empty" data-production-live-empty="media-operations">
              No media operation or bounded evidence read is recorded.
            </p>
          ) : (
            <div className="processing-receipt-list">
              {production.operations.map((operation) => (
                <article key={operation.operationId} data-production-live-operation-id={operation.operationId} data-operation-status={operation.status}>
                  <header><h5>{operation.capability}</h5><span>{sentence(operation.status)}</span></header>
                  <dl>
                    <div><dt>Operation</dt><dd>{identity(operation.operationId)}</dd></div>
                    <div><dt>Worker / task</dt><dd>{identity(operation.agentId)} · {identity(operation.taskId)}</dd></div>
                    <div><dt>Grant</dt><dd>{identity(operation.grantId)}</dd></div>
                    <div><dt>Requested range</dt><dd>{seconds(operation.startMs)}–{seconds(operation.endMs)} · {operation.trackId}</dd></div>
                    <div><dt>Receipt</dt><dd>{identity(operation.receiptId)}</dd></div>
                    <div>
                      <dt>Recorded finding</dt>
                      <dd>
                        {operation.observation
                          ? <>{sentence(operation.observation.kind)} · {sentence(operation.observation.value)} · {seconds(operation.observation.range.startMs)}–{seconds(operation.observation.range.endMs)}</>
                          : <span className="processing-receipt-missing">No perception observation recorded for this operation</span>}
                      </dd>
                    </div>
                    <div><dt>Output</dt><dd>{identity(operation.outputArtifactId)}</dd></div>
                    <div><dt>Failure</dt><dd>{operation.failure ?? "Not recorded"}</dd></div>
                  </dl>
                </article>
              ))}
              {semanticEvidence.map((operation) => (
                <article
                  key={operation.operationId}
                  data-production-live-operation-id={operation.operationId}
                  data-operation-status={operation.status}
                  data-operation-capability={operation.capability}
                  data-operation-audit={operation.audit}
                >
                  <header><h5>{operation.capability}</h5><span>{sentence(operation.status)}</span></header>
                  <dl>
                    <div><dt>Operation</dt><dd>{identity(operation.operationId)}</dd></div>
                    <div><dt>Worker / task</dt><dd>{identity(operation.executor.agentId)} · {identity(operation.executor.taskId)}</dd></div>
                    <div><dt>Grant</dt><dd>{identity(operation.executor.grantId)}</dd></div>
                    <div><dt>Requested range</dt><dd>{seconds(operation.source.range.startMs)}–{seconds(operation.source.range.endMs)} · {operation.source.trackId}</dd></div>
                    <div><dt>Returned range</dt><dd>{operation.returnedRange ? `${seconds(operation.returnedRange.startMs)}–${seconds(operation.returnedRange.endMs)}` : "Not recorded"}</dd></div>
                    <div><dt>Receipt</dt><dd>{identity(operation.receipt?.receiptId ?? null)} · {identity(operation.receipt?.contentId ?? null)}</dd></div>
                    <div><dt>Output</dt><dd>{identity(operation.artifact?.artifactId ?? null)} · {identity(operation.artifact?.contentId ?? null)}</dd></div>
                    <div><dt>Producer</dt><dd>{operation.producer.id} · {operation.producer.model ?? "model not recorded"} · {sentence(operation.producer.executionScope)}</dd></div>
                    <div><dt>Observations</dt><dd>{operation.observationCount === null ? "Not recorded" : `${operation.observationCount} · ${operation.availability ? sentence(operation.availability.state) : "availability not recorded"}`}</dd></div>
                    <div><dt>Failure</dt><dd>{operation.failure ?? "Not recorded"}</dd></div>
                  </dl>
                </article>
              ))}
              {production.evidenceReads.map((read) => (
                <article key={read.operationId} data-production-live-evidence-read-id={read.operationId} data-operation-status={read.status}>
                  <header><h5>{read.capability}</h5><span>{sentence(read.status)}</span></header>
                  <dl>
                    <div><dt>Operation</dt><dd>{identity(read.operationId)}</dd></div>
                    <div><dt>Evidence kind</dt><dd>{sentence(read.evidenceKind)}</dd></div>
                    <div><dt>Worker / task</dt><dd>{identity(read.agentId)} · {identity(read.taskId)}</dd></div>
                    <div><dt>Grant</dt><dd>{identity(read.grantId)}</dd></div>
                    <div><dt>Bounded range</dt><dd>{seconds(read.startMs)}–{seconds(read.endMs)}</dd></div>
                    <div><dt>Receipt</dt><dd>{identity(read.receiptId)} · {identity(read.receiptContentId)}</dd></div>
                    <div><dt>Returned facts</dt><dd>{read.returnedItems === null ? "Not recorded" : `${read.returnedItems} items · ${read.returnedFactBytes} bytes · ${read.truncated ? "truncated" : "not truncated"}`}</dd></div>
                    <div><dt>Failure</dt><dd>{read.failure ?? "Not recorded"}</dd></div>
                  </dl>
                </article>
              ))}
            </div>
          )}
        </section>

        <section className="processing-receipt-panel processing-receipt-panel-wide" aria-labelledby="processing-caption-ledger-title">
          <header>
            <span className="processing-receipt-index">04</span>
            <div><h4 id="processing-caption-ledger-title">Caption candidate lineage and QC</h4><p>Candidate production and independent structural disposition.</p></div>
          </header>
          {production.captionProductions.length === 0 ? (
            <p className="processing-receipt-empty" data-production-live-empty="caption-lineage">
              No caption-production start receipt is present. No candidate or QC decision exists.
            </p>
          ) : (
            <div className="processing-receipt-list processing-caption-ledger">
              {production.captionProductions.map((caption) => {
                const qc = production.captionQualityControls.find((candidate) => candidate.jobId === caption.jobId) ?? null;
                const fixture = caption.executorClassification === "recorded_real_pipeline_fixture";
                return (
                  <article
                    key={caption.jobId}
                    data-production-live-caption-job-id={caption.jobId}
                    data-caption-execution-scope={caption.executorExecutionScope}
                    data-caption-qc-outcome={qc?.outcome ?? "not_recorded"}
                  >
                    <header>
                      <div><h5>Caption candidate</h5><small>{identity(caption.jobId)}</small></div>
                      <span data-state={qc?.outcome ?? caption.status}>{qc ? `QC ${sentence(qc.outcome)}` : sentence(caption.status)}</span>
                    </header>
                    <p className="processing-caption-boundary">
                      {fixture
                        ? "Recorded fixture · test/demo only · QC cannot accept this executor class."
                        : "Current-run executor seam · structural QC only · no semantic quality score."}
                    </p>
                    <div className="processing-caption-lineage" aria-label="Caption candidate receipt lineage">
                      <span><b>Source</b>{identity(caption.sourceArtifactId)}<small>{identity(caption.sourceContentId)}</small></span>
                      <span><b>Owned study</b>{identity(caption.study.studyId)}<small>{identity(caption.study.contentId)}</small></span>
                      <span><b>Study readiness</b>{identity(caption.readiness.readinessId)}<small>{identity(caption.readiness.receiptId)}</small></span>
                      <span><b>Caption candidate</b>{identity(caption.captionArtifactId)}<small>{identity(caption.captionContentId)}</small></span>
                      <span><b>Independent QC</b>{identity(qc?.receiptId ?? null)}<small>{identity(qc?.receiptContentId ?? null)}</small></span>
                    </div>
                    <dl>
                      <div><dt>Range</dt><dd>{seconds(caption.range.startMs)}–{seconds(caption.range.endMs)}</dd></div>
                      <div><dt>Approval</dt><dd>{identity(caption.approvalReviewId)} · {identity(caption.approvalReceiptId)}</dd></div>
                      <div><dt>Executor</dt><dd>{caption.executorClassification} · {caption.executorExecutionScope} · cognition claim {caption.cognitionClaim}</dd></div>
                      <div><dt>Candidate result</dt><dd>{caption.resultStatus ? `${sentence(caption.resultStatus)} · ${caption.lineCount} lines` : "Not recorded"}</dd></div>
                      <div><dt>QC decision</dt><dd>{qc ? sentence(qc.outcome) : "No independent QC receipt recorded"}</dd></div>
                      <div><dt>QC reason codes</dt><dd>{qc?.reasonCodes.join(" · ") || "Not recorded"}</dd></div>
                      <div><dt>QC artifact</dt><dd>{identity(qc?.outputArtifactId ?? null)}</dd></div>
                      <div><dt>Failure</dt><dd>{caption.failure ?? "Not recorded"}</dd></div>
                    </dl>
                  </article>
                );
              })}
            </div>
          )}
          <p className="processing-receipt-boundary">
            QC acceptance certifies structural current-run completeness only. It does not certify transcription,
            translation quality, understanding, publication, or autonomous planning.
          </p>
        </section>
      </div>
    </section>
  );
}
