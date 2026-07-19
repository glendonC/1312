import type { ProductionFactsContext } from "./context";
import {
  ProductionArtifactList,
  ProductionAssessmentScopeSummary,
  ProductionDecisionScopeSummary,
  ProductionEvidenceScopeSummary,
  productionIdentityTarget,
  ProductionScopeSummary,
} from "./shared";

export function ProductionSourceWorkFacts({ context }: { context: ProductionFactsContext }) {
  const { projection, renderedArtifactIds } = context;
  return (
    <>
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
                  <div>
                    <dt>Reviewed memory</dt>
                    <dd>
                      {task.jobContext.reviewedMemory === null
                        ? "Unavailable for this task"
                        : `${task.jobContext.reviewedMemory.consumptionId} · ${task.jobContext.reviewedMemory.entryCount} entries`}
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
                  <div>
                    <dt>Enforced decision scope</dt>
                    <dd><ProductionDecisionScopeSummary scope={grant.decisionScope} /></dd>
                  </div>
                </dl>
              </article>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
