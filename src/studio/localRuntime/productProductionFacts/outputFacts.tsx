import type { ProductionFactsContext } from "./context";
import {
  ProductionArtifactList,
  ProductionArtifactReference,
  ProductionIdentityLink,
  productionIdentityTarget,
} from "./shared";

export function ProductionOutputFacts({ context }: { context: ProductionFactsContext }) {
  const { projection, renderedArtifactIds, operationIds, executionIds } = context;
  return (
    <>
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
    </>
  );
}
