import type { ReactNode } from "react";

import type { EvidenceAssessmentAudit } from "../runtime/production/assessmentAudit";
import type {
  ProductionStudioGrantView,
  ProductionStudioProjection,
} from "../runtime/production/studioProjection";

type ProductionIdentityKind = "task" | "worker" | "operation" | "execution" | "artifact" | "receipt" | "report";

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

function ProductionAssessmentScopeSummary({
  scope,
  renderedArtifactIds,
}: {
  scope: ProductionStudioGrantView["assessmentScope"];
  renderedArtifactIds: ReadonlySet<string>;
}) {
  if (!scope) return <>No assessment scope granted</>;
  return (
    <>
      <ProductionArtifactList
        identities={scope.evidenceArtifactIds}
        renderedArtifactIds={renderedArtifactIds}
        empty="No evidence artifacts"
      />
      {` · ${scope.maxAssessments} assessment / ${scope.maxReadReceipts} read receipts / ${scope.maxClaims} claims / ${scope.maxCitations} cited indexes / ${scope.maxTokens} structured tokens`}
    </>
  );
}

export function ProductionJournalFacts({
  projection,
  assessmentAudits,
}: {
  projection: ProductionStudioProjection;
  assessmentAudits: readonly EvidenceAssessmentAudit[];
}) {
  const outputArtifactIds = new Set(projection.outputArtifacts.map((artifact) => artifact.artifactId));
  const renderedArtifactIds = new Set([
    ...projection.sourceArtifacts.map((artifact) => artifact.artifactId),
    ...projection.evidenceArtifacts.map((artifact) => artifact.artifactId),
    ...projection.assessmentArtifacts.map((artifact) => artifact.artifactId),
    ...outputArtifactIds,
  ]);
  const operationIds = new Set([
    ...projection.operations.map((operation) => operation.operationId),
    ...projection.evidenceReads.map((operation) => operation.operationId),
    ...projection.evidenceAssessments.map((operation) => operation.operationId),
  ]);
  const taskIds = new Set(projection.tasks.map((task) => task.taskId));
  const workerIds = new Set(projection.workers.map((worker) => worker.agentId));
  const readReceiptIds = new Set(projection.evidenceReads.flatMap((read) =>
    read.receiptId && read.status === "completed" ? [read.receiptId] : []));
  const visibleAssessmentAudits = assessmentAudits.filter((audit) =>
    projection.evidenceAssessments.some((assessment) =>
      assessment.operationId === audit.operationId &&
      assessment.status === "completed" &&
      assessment.outputArtifactId === audit.artifactId &&
      assessment.receiptId === audit.receiptId &&
      assessment.receiptContentId === audit.receiptContentId) &&
    renderedArtifactIds.has(audit.artifactId));
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
                  <div>
                    <dt>Enforced assessment scope</dt>
                    <dd>
                      <ProductionAssessmentScopeSummary
                        scope={grant.assessmentScope}
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
                  <div>
                    <dt>Receipt</dt>
                    <dd>
                      {read.receiptId ? (
                        <span
                          id={productionIdentityTarget("receipt", read.receiptId)}
                          data-production-read-receipt-id={read.receiptId}
                        >
                          {read.receiptId}
                        </span>
                      ) : "Unavailable until completion"}
                    </dd>
                  </div>
                  <div><dt>Receipt content</dt><dd>{read.receiptContentId ?? "Unavailable until completion"}</dd></div>
                  <div><dt>Failure</dt><dd>{read.failure ?? (read.status === "failed" ? "Failure reason unavailable" : "Not recorded")}</dd></div>
                </dl>
              </article>
            ))}
          </div>
        )}
      </section>

      <section
        data-production-region="evidence-assessments"
        aria-labelledby="product-runtime-evidence-assessments-title"
      >
        <h4 id="product-runtime-evidence-assessments-title">Evidence assessments</h4>
        {projection.evidenceAssessments.length === 0 ? (
          <p className="product-runtime-unavailable" data-production-empty="evidence-assessments">
            Unavailable until an <code>analysis.evidence.assessment_started</code> event is validated.
            No assessment is inferred from an evidence artifact, read, or worker output.
          </p>
        ) : (
          <div className="product-runtime-fact-list">
            {projection.evidenceAssessments.map((assessment) => (
              <article
                key={assessment.operationId}
                id={productionIdentityTarget("operation", assessment.operationId)}
                data-production-evidence-assessment-id={assessment.operationId}
                data-status={assessment.status}
              >
                <header><h5>{assessment.capability}</h5><span>{assessment.status}</span></header>
                <dl>
                  <div><dt>Operation</dt><dd>{assessment.operationId}</dd></div>
                  <div><dt>Task / worker</dt><dd>{assessment.taskId} / {assessment.agentId}</dd></div>
                  <div><dt>Grant</dt><dd>{assessment.grantId}</dd></div>
                  <div><dt>Completed read receipts</dt><dd>{assessment.readReceiptIds.join(", ")}</dd></div>
                  <div><dt>Read receipt content</dt><dd>{assessment.readReceiptContentIds.join(", ")}</dd></div>
                  <div><dt>Hard bounds</dt><dd>{assessment.maxReadReceipts} receipts / {assessment.maxClaims} claims / {assessment.maxCitations} cited indexes / {assessment.maxTokens} structured tokens</dd></div>
                  <div><dt>Used</dt><dd>{assessment.claimCount === null || assessment.citationCount === null || assessment.tokenCount === null ? "Unavailable until assessment completion" : `${assessment.claimCount} claims / ${assessment.citationCount} cited indexes / ${assessment.tokenCount} structured tokens`}</dd></div>
                  <div>
                    <dt>Assessment artifact</dt>
                    <dd>
                      {assessment.outputArtifactId ? (
                        <ProductionArtifactReference
                          identity={assessment.outputArtifactId}
                          renderedArtifactIds={renderedArtifactIds}
                        />
                      ) : "Unavailable until assessment completion"}
                    </dd>
                  </div>
                  <div><dt>Receipt</dt><dd>{assessment.receiptId ?? "Unavailable until completion"}</dd></div>
                  <div><dt>Receipt content</dt><dd>{assessment.receiptContentId ?? "Unavailable until completion"}</dd></div>
                  <div><dt>Failure</dt><dd>{assessment.failure ?? (assessment.status === "failed" ? "Failure reason unavailable" : "Not recorded")}</dd></div>
                </dl>
              </article>
            ))}
          </div>
        )}
      </section>

      <section
        data-production-region="assessment-artifacts"
        aria-labelledby="product-runtime-assessment-artifacts-title"
      >
        <h4 id="product-runtime-assessment-artifacts-title">Assessment artifacts</h4>
        {projection.assessmentArtifacts.length === 0 ? (
          <p className="product-runtime-unavailable" data-production-empty="assessment-artifacts">
            Unavailable until a completed bounded assessment records its content-addressed receipt artifact.
          </p>
        ) : (
          <div className="product-runtime-fact-list">
            {projection.assessmentArtifacts.map((artifact) => (
              <article
                key={artifact.artifactId}
                id={productionIdentityTarget("artifact", artifact.artifactId)}
                data-production-assessment-artifact-id={artifact.artifactId}
              >
                <header><h5>{artifact.kind}</h5><span>structured opinion</span></header>
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
                    <dt>Assessment operation</dt>
                    <dd>
                      {operationIds.has(artifact.operationId)
                        ? <ProductionIdentityLink kind="operation" identity={artifact.operationId} />
                        : artifact.operationId}
                    </dd>
                  </div>
                  <div><dt>Receipt</dt><dd>{artifact.receiptId}</dd></div>
                  <div><dt>Receipt content</dt><dd>{artifact.receiptContentId}</dd></div>
                  <div><dt>Content</dt><dd>{artifact.contentId} · {artifact.bytes} bytes</dd></div>
                  <div><dt>Input read receipts</dt><dd>{artifact.readReceiptIds.join(", ")}</dd></div>
                  <div><dt>Input receipt content</dt><dd>{artifact.readReceiptContentIds.join(", ")}</dd></div>
                </dl>
              </article>
            ))}
          </div>
        )}
      </section>

      <section
        data-production-region="assessment-receipt-audits"
        aria-labelledby="product-runtime-assessment-audits-title"
      >
        <h4 id="product-runtime-assessment-audits-title">Assessment receipt audit</h4>
        <p>
          This reopens stored assessment and cited read receipts, verifies their content identities
          and journal lineage, and preserves structured evidence states. It does not certify the
          assessment meaning or the truth of the media.
        </p>
        {visibleAssessmentAudits.length === 0 ? (
          <p className="product-runtime-unavailable" data-production-empty="assessment-receipt-audits">
            Unavailable until a completed assessment receipt is reopened and validated. Failed,
            absent, V1, or stored-content/lineage-mismatch paths remain unavailable.
          </p>
        ) : (
          <div className="product-runtime-fact-list">
            {visibleAssessmentAudits.map((audit) => (
              <article
                key={audit.operationId}
                data-production-assessment-audit-id={audit.operationId}
                data-integrity={audit.integrity}
              >
                <header>
                  <h5>studio.evidence-assessment.receipt.v1</h5>
                  <span>integrity and citation closure verified</span>
                </header>
                <dl>
                  <div>
                    <dt>Assessment operation</dt>
                    <dd>
                      {operationIds.has(audit.operationId)
                        ? <ProductionIdentityLink kind="operation" identity={audit.operationId} />
                        : audit.operationId}
                    </dd>
                  </div>
                  <div>
                    <dt>Assessment artifact</dt>
                    <dd>
                      <ProductionArtifactReference
                        identity={audit.artifactId}
                        renderedArtifactIds={renderedArtifactIds}
                      />
                    </dd>
                  </div>
                  <div>
                    <dt>Task / worker</dt>
                    <dd>
                      {taskIds.has(audit.taskId)
                        ? <ProductionIdentityLink kind="task" identity={audit.taskId} />
                        : audit.taskId}
                      {" / "}
                      {workerIds.has(audit.agentId)
                        ? <ProductionIdentityLink kind="worker" identity={audit.agentId} />
                        : audit.agentId}
                    </dd>
                  </div>
                  <div><dt>Receipt</dt><dd>{audit.receiptId}</dd></div>
                  <div><dt>Stored content</dt><dd>{audit.receiptContentId}</dd></div>
                  <div><dt>Validation</dt><dd>Stored bytes rehashed; assessment, read-receipt, citation, and journal lineage closed</dd></div>
                </dl>
                <div className="product-runtime-fact-list" data-production-assessment-claims={audit.claims.length}>
                  {audit.claims.map((claim) => (
                    <article
                      key={claim.claimIndex}
                      data-production-assessment-claim-index={claim.claimIndex}
                      data-claim-kind={claim.kind}
                      data-claim-states={claim.states.join(" ")}
                    >
                      <header>
                        <h5>Claim {claim.claimIndex + 1} · {claim.kind}</h5>
                        <span>{claim.states.join(" + ")}</span>
                      </header>
                      <dl>
                        <div><dt>Kind</dt><dd>{claim.kind}</dd></div>
                        <div><dt>Value</dt><dd>{claim.value ?? "Unavailable (null)"}</dd></div>
                        <div><dt>Exact range</dt><dd>[{claim.range.startMs}, {claim.range.endMs}) ms</dd></div>
                        <div><dt>Preserved states</dt><dd>{claim.states.join(", ")}</dd></div>
                      </dl>
                      <div data-production-assessment-citations={claim.citations.length}>
                        <h6>Cited returned facts</h6>
                        <ul>
                          {claim.citations.map((citation) => (
                            <li
                              key={`${citation.receiptId}:${citation.receiptContentId}`}
                              data-production-assessment-citation-receipt-id={citation.receiptId}
                            >
                              <dl>
                                <div>
                                  <dt>Read receipt</dt>
                                  <dd>
                                    {readReceiptIds.has(citation.receiptId)
                                      ? <ProductionIdentityLink kind="receipt" identity={citation.receiptId} />
                                      : citation.receiptId}
                                  </dd>
                                </div>
                                <div><dt>Receipt content</dt><dd>{citation.receiptContentId}</dd></div>
                                <div>
                                  <dt>Read operation</dt>
                                  <dd>
                                    {operationIds.has(citation.readOperationId)
                                      ? <ProductionIdentityLink kind="operation" identity={citation.readOperationId} />
                                      : citation.readOperationId}
                                  </dd>
                                </div>
                                <div>
                                  <dt>Evidence artifact</dt>
                                  <dd>
                                    <ProductionArtifactReference
                                      identity={citation.evidenceArtifactId}
                                      renderedArtifactIds={renderedArtifactIds}
                                    />
                                  </dd>
                                </div>
                                <div><dt>Fact indexes</dt><dd>{citation.factIndexes.join(", ")}</dd></div>
                              </dl>
                            </li>
                          ))}
                        </ul>
                      </div>
                    </article>
                  ))}
                </div>
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
