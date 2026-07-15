import { useEffect, useRef, useState, type ReactNode } from "react";

import { initialRequest, type AnalysisRequest } from "../preflight/model";
import type {
  OwnedMediaIngestStatus,
  RuntimeHostPlanResponse,
  RuntimeHostSourceSummary,
  RuntimeHostStartAcknowledgement,
  RuntimeHostStartRequest,
  RuntimeHostStatus,
} from "../runtime/production/runtimeHost/model";
import {
  ProductionStudioAdapter,
  type ProductionStudioGrantView,
  type ProductionStudioProjection,
} from "../runtime/production/studioProjection";
import { LocalRuntimeHostClient } from "./client";
import {
  isLocalRuntimeLanguageTag,
  mapAnalysisRequestToRuntimeStart,
  projectLocalRuntimeLifecycle,
} from "./model";

import "./productLocalRuntime.css";

type Busy = "connect" | "ingest" | "plan" | "start" | null;
type RuntimeStatusView = Omit<RuntimeHostStatus, "schema">;

interface ReviewedPlan {
  request: RuntimeHostStartRequest;
  response: RuntimeHostPlanResponse;
}

interface RuntimeView {
  status: RuntimeStatusView;
  production: ProductionStudioProjection;
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

type ProductionIdentityKind = "task" | "worker" | "operation" | "execution" | "artifact" | "report";

function productionIdentityTarget(kind: ProductionIdentityKind, identity: string): string {
  return `product-production-${kind}-${identity}`;
}

function ProductionIdentityLink({
  kind,
  identity,
  children,
}: {
  kind: ProductionIdentityKind;
  identity: string;
  children?: ReactNode;
}) {
  return (
    <a
      href={`#${productionIdentityTarget(kind, identity)}`}
      data-production-navigation={kind}
      data-production-target-id={identity}
    >
      {children ?? identity}
    </a>
  );
}

function ProductionArtifactReference({
  identity,
  renderedArtifactIds,
}: {
  identity: string;
  renderedArtifactIds: ReadonlySet<string>;
}) {
  return renderedArtifactIds.has(identity)
    ? <ProductionIdentityLink kind="artifact" identity={identity} />
    : <>{identity}</>;
}

function ProductionArtifactList({
  identities,
  renderedArtifactIds,
  empty,
}: {
  identities: readonly string[];
  renderedArtifactIds: ReadonlySet<string>;
  empty: string;
}) {
  if (identities.length === 0) return <>{empty}</>;
  return identities.map((identity, index) => (
    <span key={identity}>
      {index > 0 ? ", " : null}
      <ProductionArtifactReference identity={identity} renderedArtifactIds={renderedArtifactIds} />
    </span>
  ));
}

function ProductionScopeSummary({
  scopes,
  renderedArtifactIds,
}: {
  scopes: ProductionStudioGrantView["mediaScope"];
  renderedArtifactIds: ReadonlySet<string>;
}) {
  if (scopes.length === 0) return <>No media scope granted</>;
  return scopes.map((scope, index) => (
    <span key={`${scope.artifactId}:${scope.trackId}:${scope.startMs}:${scope.endMs}`}>
      {index > 0 ? "; " : null}
      <ProductionArtifactReference identity={scope.artifactId} renderedArtifactIds={renderedArtifactIds} />
      {` · ${scope.trackId} [${scope.startMs}, ${scope.endMs}) ms`}
    </span>
  ));
}

function ProductionEvidenceScopeSummary({
  scopes,
  renderedArtifactIds,
}: {
  scopes: ProductionStudioGrantView["evidenceScope"];
  renderedArtifactIds: ReadonlySet<string>;
}) {
  if (scopes.length === 0) return <>No evidence scope granted</>;
  return scopes.map((scope, index) => (
    <span key={`${scope.artifactId}:${scope.evidenceKind}`}>
      {index > 0 ? "; " : null}
      <ProductionArtifactReference identity={scope.artifactId} renderedArtifactIds={renderedArtifactIds} />
      {` · ${scope.evidenceKind} · ${scope.maxItems} items / ${scope.maxBytes} bytes`}
    </span>
  ));
}

function ProductionJournalFacts({ projection }: { projection: ProductionStudioProjection }) {
  const outputArtifactIds = new Set(projection.outputArtifacts.map((artifact) => artifact.artifactId));
  const renderedArtifactIds = new Set([
    ...projection.sourceArtifacts.map((artifact) => artifact.artifactId),
    ...projection.evidenceArtifacts.map((artifact) => artifact.artifactId),
    ...outputArtifactIds,
  ]);
  const operationIds = new Set(projection.operations.map((operation) => operation.operationId));
  const executionIds = new Set(
    projection.workers.flatMap((worker) => worker.execution ? [worker.execution.id] : []),
  );

  return (
    <section
      className="product-runtime-production"
      data-production-projection="journal"
      aria-labelledby="product-runtime-production-title"
    >
      <header>
        <span>Validated production adapter · never added to RunBundle</span>
        <h3 id="product-runtime-production-title">Production task and handoff facts</h3>
        <p>
          Latest validated journal facts, including source identity, scheduler decisions, and
          output lineage. They are recorded production evidence, not a presence signal, progress
          estimate, or replay topology.
        </p>
      </header>

      <section
        data-production-region="source-artifacts"
        aria-labelledby="product-runtime-source-artifacts-title"
      >
        <h4 id="product-runtime-source-artifacts-title">Source artifacts</h4>
        {projection.sourceArtifacts.length === 0 ? (
          <p className="product-runtime-unavailable" data-production-empty="source-artifacts">
            Unavailable until an ingest-origin <code>artifact.recorded</code> event is validated.
          </p>
        ) : (
          <div className="product-runtime-fact-list">
            {projection.sourceArtifacts.map((artifact) => (
              <article
                key={artifact.artifactId}
                id={productionIdentityTarget("artifact", artifact.artifactId)}
                data-production-source-artifact-id={artifact.artifactId}
              >
                <header><h5>{artifact.kind}</h5><span>{artifact.mediaClass}</span></header>
                <dl>
                  <div><dt>Artifact</dt><dd>{artifact.artifactId}</dd></div>
                  <div><dt>Content</dt><dd>{artifact.contentId} · {artifact.bytes} bytes</dd></div>
                  <div>
                    <dt>Duration</dt>
                    <dd>{artifact.durationMs === null ? "Unavailable in the validated artifact" : `${artifact.durationMs} ms`}</dd>
                  </div>
                  <div><dt>Tracks</dt><dd>{artifact.trackCount}</dd></div>
                  <div><dt>Publication</dt><dd>{artifact.publication}</dd></div>
                </dl>
              </article>
            ))}
          </div>
        )}
      </section>

      <section
        data-production-region="evidence-artifacts"
        aria-labelledby="product-runtime-evidence-artifacts-title"
      >
        <h4 id="product-runtime-evidence-artifacts-title">Evidence artifacts</h4>
        {projection.evidenceArtifacts.length === 0 ? (
          <p className="product-runtime-unavailable" data-production-empty="evidence-artifacts">
            Unavailable when the owned preflight has no pinned speech or language evidence receipt.
          </p>
        ) : (
          <div className="product-runtime-fact-list">
            {projection.evidenceArtifacts.map((artifact) => (
              <article
                key={artifact.artifactId}
                id={productionIdentityTarget("artifact", artifact.artifactId)}
                data-production-evidence-artifact-id={artifact.artifactId}
                data-evidence-kind={artifact.evidenceKind}
              >
                <header><h5>{artifact.kind}</h5><span>{artifact.evidenceKind}</span></header>
                <dl>
                  <div><dt>Artifact</dt><dd>{artifact.artifactId}</dd></div>
                  <div><dt>Receipt schema</dt><dd>{artifact.receiptSchema}</dd></div>
                  <div><dt>Existing producer</dt><dd>{artifact.producerId}</dd></div>
                  <div><dt>Content</dt><dd>{artifact.contentId} · {artifact.bytes} bytes</dd></div>
                  <div><dt>Preflight</dt><dd>{artifact.preflightId}</dd></div>
                  <div><dt>Preflight content</dt><dd>{artifact.preflightContentId}</dd></div>
                  <div>
                    <dt>Source lineage</dt>
                    <dd>
                      <ProductionArtifactList
                        identities={artifact.sourceArtifactIds}
                        renderedArtifactIds={renderedArtifactIds}
                        empty="Unavailable"
                      />
                    </dd>
                  </div>
                </dl>
              </article>
            ))}
          </div>
        )}
      </section>

      <section aria-labelledby="product-runtime-tasks-title">
        <h4 id="product-runtime-tasks-title">Production tasks</h4>
        {projection.tasks.length === 0 ? (
          <p className="product-runtime-unavailable" data-production-empty="tasks">
            Unavailable until a <code>task.created</code> event is validated.
          </p>
        ) : (
          <div className="product-runtime-fact-list">
            {projection.tasks.map((task) => (
              <article
                key={task.taskId}
                id={productionIdentityTarget("task", task.taskId)}
                data-production-task-id={task.taskId}
                data-status={task.status}
              >
                <header><h5>{task.label}</h5><span>{task.status}</span></header>
                <p>{task.objective}</p>
                <dl>
                  <div><dt>Task</dt><dd>{task.taskId}</dd></div>
                  <div><dt>Assigned worker</dt><dd>{task.assignedAgentId}</dd></div>
                  <div><dt>Registered owner</dt><dd>{task.ownerAgentId ?? "Unavailable until agent registration"}</dd></div>
                  <div><dt>Parent task</dt><dd>{task.parentTaskId ?? "Root task"}</dd></div>
                  <div>
                    <dt>Input artifacts</dt>
                    <dd>
                      <ProductionArtifactList
                        identities={task.inputArtifactIds}
                        renderedArtifactIds={renderedArtifactIds}
                        empty="None in task contract"
                      />
                    </dd>
                  </div>
                  <div>
                    <dt>Media scope</dt>
                    <dd>
                      <ProductionScopeSummary
                        scopes={task.mediaScope}
                        renderedArtifactIds={renderedArtifactIds}
                      />
                    </dd>
                  </div>
                  <div><dt>Dependencies</dt><dd>{task.dependencies.join(", ") || "None in task contract"}</dd></div>
                  <div>
                    <dt>Required outputs</dt>
                    <dd>
                      {task.requiredOutputs.map((output) => (
                        `${output.name} · ${output.artifactKind} · ${output.required ? "required" : "optional"}`
                      )).join("; ") || "None in task contract"}
                    </dd>
                  </div>
                </dl>
              </article>
            ))}
          </div>
        )}
      </section>

      <section
        data-production-region="spawn-requests"
        aria-labelledby="product-runtime-spawns-title"
      >
        <h4 id="product-runtime-spawns-title">Spawn requests and decisions</h4>
        {projection.spawnRequests.length === 0 ? (
          <p className="product-runtime-unavailable" data-production-empty="spawn-requests">
            Unavailable until a <code>spawn.requested</code> event is validated.
          </p>
        ) : (
          <div className="product-runtime-fact-list">
            {projection.spawnRequests.map((spawn) => {
              const decidedTarget = spawn.decision === "accepted"
                ? `${spawn.taskId} / ${spawn.agentId}`
                : spawn.decision === "rejected"
                  ? "Not created — request rejected"
                  : "Unavailable until spawn.decided is validated";
              const decisionReason = spawn.decision === "rejected"
                ? spawn.rejection
                : spawn.decision === "accepted"
                  ? "Not applicable — request accepted"
                  : "Unavailable until spawn.decided is validated";
              return (
                <article
                  key={spawn.requestId}
                  data-production-spawn-request-id={spawn.requestId}
                  data-decision={spawn.decision}
                >
                  <header><h5>{spawn.workerLabel}</h5><span>{spawn.decision}</span></header>
                  <p>{spawn.objective}</p>
                  <dl>
                    <div><dt>Request</dt><dd>{spawn.requestId}</dd></div>
                    <div><dt>Requested by</dt><dd>{spawn.requestedByTaskId} / {spawn.requestedByAgentId}</dd></div>
                    <div><dt>Requested worker kind</dt><dd>{spawn.workerKind}</dd></div>
                    <div><dt>Workload key</dt><dd>{spawn.workloadKey}</dd></div>
                    <div><dt>Requested capabilities</dt><dd>{spawn.requiredCapabilities.join(", ") || "None in request contract"}</dd></div>
                    <div>
                      <dt>Requested media scope</dt>
                      <dd>
                        <ProductionScopeSummary
                          scopes={spawn.mediaScope}
                          renderedArtifactIds={renderedArtifactIds}
                        />
                      </dd>
                    </div>
                    <div>
                      <dt>Requested input artifacts</dt>
                      <dd>
                        <ProductionArtifactList
                          identities={spawn.inputArtifactIds}
                          renderedArtifactIds={renderedArtifactIds}
                          empty="None in request contract"
                        />
                      </dd>
                    </div>
                    <div>
                      <dt>Required outputs</dt>
                      <dd>
                        {spawn.requiredOutputs.map((output) => (
                          `${output.name} · ${output.artifactKind} · ${output.required ? "required" : "optional"}`
                        )).join("; ") || "None in request contract"}
                      </dd>
                    </div>
                    <div><dt>Dependencies</dt><dd>{spawn.dependencies.join(", ") || "None in request contract"}</dd></div>
                    <div><dt>Decision target</dt><dd>{decidedTarget}</dd></div>
                    <div><dt>Decision reason</dt><dd>{decisionReason}</dd></div>
                  </dl>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section aria-labelledby="product-runtime-workers-title">
        <h4 id="product-runtime-workers-title">Registered workers</h4>
        {projection.workers.length === 0 ? (
          <p className="product-runtime-unavailable" data-production-empty="workers">
            Unavailable until an <code>agent.registered</code> event is validated.
          </p>
        ) : (
          <div className="product-runtime-fact-list">
            {projection.workers.map((worker) => (
              <article
                key={worker.agentId}
                id={productionIdentityTarget("worker", worker.agentId)}
                data-production-worker-id={worker.agentId}
                data-status={worker.status}
              >
                <header><h5>{worker.label}</h5><span>{worker.status}</span></header>
                <dl>
                  <div><dt>Worker</dt><dd>{worker.agentId}</dd></div>
                  <div><dt>Task</dt><dd>{worker.taskId}</dd></div>
                  <div><dt>Kind</dt><dd>{worker.kind}</dd></div>
                  <div><dt>Parent worker</dt><dd>{worker.parentAgentId ?? "Root worker"}</dd></div>
                  <div><dt>Journal task status</dt><dd>{worker.taskStatus}</dd></div>
                  {worker.execution ? (
                    <div>
                      <dt>Latest execution</dt>
                      <dd
                        id={productionIdentityTarget("execution", worker.execution.id)}
                        data-production-execution-id={worker.execution.id}
                      >
                        {worker.execution.id}
                      </dd>
                    </div>
                  ) : null}
                </dl>
              </article>
            ))}
          </div>
        )}
      </section>

      <section aria-labelledby="product-runtime-grants-title">
        <h4 id="product-runtime-grants-title">Capability grants</h4>
        {projection.grants.length === 0 ? (
          <p className="product-runtime-unavailable" data-production-empty="grants">
            Unavailable until scheduler-issued grants are validated.
          </p>
        ) : (
          <div className="product-runtime-fact-list">
            {projection.grants.map((grant) => (
              <article key={grant.grantId} data-production-grant-id={grant.grantId}>
                <header><h5>{grant.capability}</h5></header>
                <dl>
                  <div><dt>Grant</dt><dd>{grant.grantId}</dd></div>
                  <div><dt>Task / worker</dt><dd>{grant.taskId} / {grant.agentId}</dd></div>
                  <div>
                    <dt>Enforced media scope</dt>
                    <dd>
                      <ProductionScopeSummary
                        scopes={grant.mediaScope}
                        renderedArtifactIds={renderedArtifactIds}
                      />
                    </dd>
                  </div>
                  <div>
                    <dt>Enforced evidence scope</dt>
                    <dd>
                      <ProductionEvidenceScopeSummary
                        scopes={grant.evidenceScope}
                        renderedArtifactIds={renderedArtifactIds}
                      />
                    </dd>
                  </div>
                </dl>
              </article>
            ))}
          </div>
        )}
      </section>

      <section
        data-production-region="evidence-reads"
        aria-labelledby="product-runtime-evidence-reads-title"
      >
        <h4 id="product-runtime-evidence-reads-title">Evidence reads</h4>
        {projection.evidenceReads.length === 0 ? (
          <p className="product-runtime-unavailable" data-production-empty="evidence-reads">
            Unavailable until an <code>evidence.read_started</code> event is validated. No read is
            inferred from an evidence artifact or grant.
          </p>
        ) : (
          <div className="product-runtime-fact-list">
            {projection.evidenceReads.map((read) => (
              <article
                key={read.operationId}
                id={productionIdentityTarget("operation", read.operationId)}
                data-production-evidence-read-id={read.operationId}
                data-evidence-kind={read.evidenceKind}
                data-status={read.status}
              >
                <header><h5>{read.capability}</h5><span>{read.status}</span></header>
                <dl>
                  <div><dt>Operation</dt><dd>{read.operationId}</dd></div>
                  <div><dt>Task / worker</dt><dd>{read.taskId} / {read.agentId}</dd></div>
                  <div><dt>Grant</dt><dd>{read.grantId}</dd></div>
                  <div>
                    <dt>Existing evidence artifact</dt>
                    <dd>
                      <ProductionArtifactReference
                        identity={read.inputArtifactId}
                        renderedArtifactIds={renderedArtifactIds}
                      />
                    </dd>
                  </div>
                  <div><dt>Evidence kind</dt><dd>{read.evidenceKind}</dd></div>
                  <div><dt>Hard bounds</dt><dd>{read.maxItems} items / {read.maxBytes} bytes</dd></div>
                  <div><dt>Returned</dt><dd>{read.returnedItems === null || read.returnedFactBytes === null ? "Unavailable until evidence.read_completed is validated" : `${read.returnedItems} items / ${read.returnedFactBytes} bytes`}</dd></div>
                  <div><dt>Truncated</dt><dd>{read.truncated === null ? "Unavailable until completion" : read.truncated ? "Yes" : "No"}</dd></div>
                  <div><dt>Receipt</dt><dd>{read.receiptId ?? "Unavailable until completion"}</dd></div>
                  <div><dt>Receipt content</dt><dd>{read.receiptContentId ?? "Unavailable until completion"}</dd></div>
                  <div><dt>Failure</dt><dd>{read.failure ?? (read.status === "failed" ? "Failure reason unavailable" : "Not recorded")}</dd></div>
                </dl>
              </article>
            ))}
          </div>
        )}
      </section>

      <section
        data-production-region="operations"
        aria-labelledby="product-runtime-operations-title"
      >
        <h4 id="product-runtime-operations-title">Production operations</h4>
        {projection.operations.length === 0 ? (
          <p className="product-runtime-unavailable" data-production-empty="operations">
            Unavailable until a <code>media.operation_started</code> event is validated. No
            operation is inferred from a plan, grant, or worker claim.
          </p>
        ) : (
          <div className="product-runtime-fact-list">
            {projection.operations.map((operation) => (
              <article
                key={operation.operationId}
                id={productionIdentityTarget("operation", operation.operationId)}
                data-production-operation-id={operation.operationId}
                data-status={operation.status}
              >
                <header><h5>{operation.capability}</h5><span>{operation.status}</span></header>
                <dl>
                  <div><dt>Operation</dt><dd>{operation.operationId}</dd></div>
                  <div><dt>Task / worker</dt><dd>{operation.taskId} / {operation.agentId}</dd></div>
                  <div><dt>Grant</dt><dd>{operation.grantId}</dd></div>
                  <div>
                    <dt>Input artifact</dt>
                    <dd>
                      <ProductionArtifactReference
                        identity={operation.inputArtifactId}
                        renderedArtifactIds={renderedArtifactIds}
                      />
                    </dd>
                  </div>
                  <div><dt>Track</dt><dd>{operation.trackId}</dd></div>
                  <div><dt>Requested range</dt><dd>[{operation.startMs}, {operation.endMs}) ms · {operation.requestedDurationMs} ms</dd></div>
                  <div>
                    <dt>Output artifact</dt>
                    <dd>
                      {operation.outputArtifactId ? (
                        <ProductionArtifactReference
                          identity={operation.outputArtifactId}
                          renderedArtifactIds={renderedArtifactIds}
                        />
                      ) : "Unavailable until media.operation_completed is validated"}
                    </dd>
                  </div>
                  <div><dt>Receipt</dt><dd>{operation.receiptId ?? "Unavailable until media.operation_completed is validated"}</dd></div>
                  <div><dt>Failure</dt><dd>{operation.failure ?? (operation.status === "failed" ? "Failure reason unavailable" : "Not recorded")}</dd></div>
                </dl>
              </article>
            ))}
          </div>
        )}
      </section>

      <section
        data-production-region="output-artifacts"
        aria-labelledby="product-runtime-output-artifacts-title"
      >
        <h4 id="product-runtime-output-artifacts-title">Output artifact lineage</h4>
        {projection.outputArtifacts.length === 0 ? (
          <p className="product-runtime-unavailable" data-production-empty="output-artifacts">
            Unavailable until an output-producing <code>artifact.recorded</code> event is validated.
          </p>
        ) : (
          <div className="product-runtime-fact-list">
            {projection.outputArtifacts.map((artifact) => {
              const originIdentity = artifact.origin.kind === "worker_output"
                ? `Execution ${artifact.origin.executionId}`
                : `Operation ${artifact.origin.operationId}`;
              return (
                <article
                  key={artifact.artifactId}
                  id={productionIdentityTarget("artifact", artifact.artifactId)}
                  data-production-output-artifact-id={artifact.artifactId}
                  data-origin-kind={artifact.origin.kind}
                >
                  <header><h5>{artifact.kind}</h5><span>{artifact.mediaClass}</span></header>
                  <dl>
                    <div><dt>Artifact</dt><dd>{artifact.artifactId}</dd></div>
                    <div>
                      <dt>Produced by</dt>
                      <dd>
                        <ProductionIdentityLink kind="task" identity={artifact.producerTaskId} />
                        {" / "}
                        <ProductionIdentityLink kind="worker" identity={artifact.producerAgentId} />
                      </dd>
                    </div>
                    <div>
                      <dt>Origin</dt>
                      <dd>
                        {artifact.origin.kind} · {artifact.origin.kind === "worker_output" && executionIds.has(artifact.origin.executionId) ? (
                          <ProductionIdentityLink kind="execution" identity={artifact.origin.executionId}>{originIdentity}</ProductionIdentityLink>
                        ) : artifact.origin.kind !== "worker_output" && operationIds.has(artifact.origin.operationId) ? (
                          <ProductionIdentityLink kind="operation" identity={artifact.origin.operationId}>{originIdentity}</ProductionIdentityLink>
                        ) : originIdentity}
                      </dd>
                    </div>
                    <div><dt>Receipt</dt><dd>{artifact.origin.receiptId}</dd></div>
                    <div><dt>Receipt content</dt><dd>{artifact.origin.receiptContentId}</dd></div>
                    <div><dt>Content</dt><dd>{artifact.contentId} · {artifact.bytes} bytes</dd></div>
                    <div>
                      <dt>Upstream artifacts</dt>
                      <dd>
                        <ProductionArtifactList
                          identities={artifact.sourceArtifactIds}
                          renderedArtifactIds={renderedArtifactIds}
                          empty="No upstream artifact ids recorded"
                        />
                      </dd>
                    </div>
                    <div>
                      <dt>Report references</dt>
                      <dd>
                        {artifact.reportIds.length === 0
                          ? "No validated report references"
                          : artifact.reportIds.map((reportId, index) => (
                            <span key={reportId}>
                              {index > 0 ? ", " : null}
                              <ProductionIdentityLink kind="report" identity={reportId} />
                            </span>
                          ))}
                      </dd>
                    </div>
                    <div><dt>Publication</dt><dd>{artifact.publication}</dd></div>
                    <div><dt>Duration</dt><dd>{artifact.durationMs === null ? "Not applicable for this artifact" : `${artifact.durationMs} ms`}</dd></div>
                  </dl>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section aria-labelledby="product-runtime-reports-title">
        <h4 id="product-runtime-reports-title">Structured reports</h4>
        {projection.reports.length === 0 ? (
          <p className="product-runtime-unavailable" data-production-empty="reports">
            Unavailable until a <code>report.submitted</code> event is validated.
          </p>
        ) : (
          <div className="product-runtime-fact-list">
            {projection.reports.map((report) => (
              <article
                key={report.reportId}
                id={productionIdentityTarget("report", report.reportId)}
                data-production-report-id={report.reportId}
                data-status={report.status}
              >
                <header><h5>{report.reportId}</h5><span>{report.status}</span></header>
                <p>{report.summary}</p>
                <dl>
                  <div><dt>Reporter</dt><dd>{report.taskId} / {report.agentId}</dd></div>
                  <div><dt>Reports to</dt><dd>{report.parentTaskId} / {report.parentAgentId}</dd></div>
                  <div>
                    <dt>Output artifacts</dt>
                    <dd>
                      <ProductionArtifactList
                        identities={report.outputArtifactIds}
                        renderedArtifactIds={renderedArtifactIds}
                        empty="No output artifact ids recorded"
                      />
                    </dd>
                  </div>
                  <div><dt>Decision reason</dt><dd>{report.decisionReason ?? "Unavailable until report.decided is validated"}</dd></div>
                </dl>
              </article>
            ))}
          </div>
        )}
      </section>
    </section>
  );
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
        if (adapter.view().lastSeq !== after) {
          throw new Error("Production adapter cursor changed outside the validated poll path.");
        }
        const production = adapter.appendBatch(poll.events);
        if (production.lastSeq !== poll.nextCursor) {
          throw new Error("Production adapter cursor does not match the validated host cursor.");
        }
        after = poll.nextCursor;
        setRuntime((current) => {
          if (!current || current.status.runtimeId !== identity.runtimeId) return current;
          return {
            ...current,
            production,
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
      const adapter = new ProductionStudioAdapter(acknowledgement.runtimeId);
      const nextRuntime: RuntimeView = {
        status: statusView(acknowledgement),
        production: adapter.view(),
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
          <ProductionJournalFacts projection={runtime.production} />
        </section>
      )}
    </section>
  );
}
