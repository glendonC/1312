import type { ProductionFactsContext } from "./context";
import {
  ProductionArtifactList,
  ProductionArtifactReference,
  ProductionIdentityLink,
  productionIdentityTarget,
} from "./shared";

export function ProductionDecisionFacts({ context }: { context: ProductionFactsContext }) {
  const { projection, renderedArtifactIds, operationIds, taskIds, workerIds, visibleDecisionReceipts } = context;
  return (
    <>
      <section
        data-production-region="evidence-decisions"
        aria-labelledby="product-runtime-evidence-decisions-title"
      >
        <h4 id="product-runtime-evidence-decisions-title">Evidence decisions</h4>
        <p>
          Journal facts for the deterministic gate over audited assessment identities. A completed
          decision is neither a caption nor a publication event.
        </p>
        {projection.evidenceDecisions.length === 0 ? (
          <p className="product-runtime-unavailable" data-production-empty="evidence-decisions">
            Unavailable until an <code>analysis.evidence.decision_started</code> event is validated.
            No decision is inferred from an assessment, audit response, grant, or worker report.
          </p>
        ) : (
          <div className="product-runtime-fact-list">
            {projection.evidenceDecisions.map((decision) => (
              <article
                key={decision.operationId}
                id={productionIdentityTarget("operation", decision.operationId)}
                data-production-evidence-decision-id={decision.operationId}
                data-status={decision.status}
                data-decision-outcome={decision.outcome ?? "unavailable"}
              >
                <header><h5>{decision.capability}</h5><span>{decision.status}</span></header>
                <dl>
                  <div><dt>Operation</dt><dd>{decision.operationId}</dd></div>
                  <div><dt>Task / worker</dt><dd>{decision.taskId} / {decision.agentId}</dd></div>
                  <div><dt>Grant</dt><dd>{decision.grantId}</dd></div>
                  <div><dt>Hard bound</dt><dd>{decision.maxAuditedAssessments} audited assessments</dd></div>
                  <div>
                    <dt>Assessment operations</dt>
                    <dd>
                      {decision.assessmentOperationIds.map((operationId, index) => (
                        <span key={operationId}>
                          {index > 0 ? ", " : null}
                          {operationIds.has(operationId)
                            ? <ProductionIdentityLink kind="operation" identity={operationId} />
                            : operationId}
                        </span>
                      ))}
                    </dd>
                  </div>
                  <div>
                    <dt>Assessment artifacts</dt>
                    <dd>
                      <ProductionArtifactList
                        identities={decision.assessmentArtifactIds}
                        renderedArtifactIds={renderedArtifactIds}
                        empty="No audited assessment artifacts"
                      />
                    </dd>
                  </div>
                  <div><dt>Assessment receipts</dt><dd>{decision.assessmentReceiptIds.join(", ")}</dd></div>
                  <div><dt>Assessment receipt content</dt><dd>{decision.assessmentReceiptContentIds.join(", ")}</dd></div>
                  <div><dt>Outcome</dt><dd>{decision.outcome ?? "Unavailable until decision completion"}</dd></div>
                  <div><dt>Reason codes</dt><dd>{decision.reasonCodes.join(", ") || "Unavailable until decision completion"}</dd></div>
                  <div><dt>Audited claims</dt><dd>{decision.auditedClaimCount ?? "Unavailable until decision completion"}</dd></div>
                  <div>
                    <dt>Decision artifact</dt>
                    <dd>
                      {decision.outputArtifactId
                        ? <ProductionArtifactReference identity={decision.outputArtifactId} renderedArtifactIds={renderedArtifactIds} />
                        : "Unavailable until decision completion"}
                    </dd>
                  </div>
                  <div><dt>Receipt</dt><dd>{decision.receiptId ?? "Unavailable until completion"}</dd></div>
                  <div><dt>Receipt content</dt><dd>{decision.receiptContentId ?? "Unavailable until completion"}</dd></div>
                  <div><dt>Failure</dt><dd>{decision.failure ?? (decision.status === "failed" ? "Failure reason unavailable" : "Not recorded")}</dd></div>
                </dl>
              </article>
            ))}
          </div>
        )}
      </section>

      <section
        data-production-region="decision-artifacts"
        aria-labelledby="product-runtime-decision-artifacts-title"
      >
        <h4 id="product-runtime-decision-artifacts-title">Decision artifacts</h4>
        {projection.decisionArtifacts.length === 0 ? (
          <p className="product-runtime-unavailable" data-production-empty="decision-artifacts">
            Unavailable until a completed audited decision records its private content-addressed receipt artifact.
          </p>
        ) : (
          <div className="product-runtime-fact-list">
            {projection.decisionArtifacts.map((artifact) => (
              <article
                key={artifact.artifactId}
                id={productionIdentityTarget("artifact", artifact.artifactId)}
                data-production-decision-artifact-id={artifact.artifactId}
              >
                <header><h5>{artifact.kind}</h5><span>deterministic audit-state gate</span></header>
                <dl>
                  <div><dt>Artifact</dt><dd>{artifact.artifactId}</dd></div>
                  <div>
                    <dt>Produced by</dt>
                    <dd>
                      {taskIds.has(artifact.producerTaskId)
                        ? <ProductionIdentityLink kind="task" identity={artifact.producerTaskId} />
                        : artifact.producerTaskId}
                      {" / "}
                      {workerIds.has(artifact.producerAgentId)
                        ? <ProductionIdentityLink kind="worker" identity={artifact.producerAgentId} />
                        : artifact.producerAgentId}
                    </dd>
                  </div>
                  <div>
                    <dt>Decision operation</dt>
                    <dd>
                      {operationIds.has(artifact.operationId)
                        ? <ProductionIdentityLink kind="operation" identity={artifact.operationId} />
                        : artifact.operationId}
                    </dd>
                  </div>
                  <div><dt>Receipt</dt><dd>{artifact.receiptId}</dd></div>
                  <div><dt>Receipt content</dt><dd>{artifact.receiptContentId}</dd></div>
                  <div><dt>Content</dt><dd>{artifact.contentId} · {artifact.bytes} bytes</dd></div>
                  <div>
                    <dt>Audited assessment artifacts</dt>
                    <dd>
                      <ProductionArtifactList
                        identities={artifact.assessmentArtifactIds}
                        renderedArtifactIds={renderedArtifactIds}
                        empty="No audited assessment artifacts"
                      />
                    </dd>
                  </div>
                  <div><dt>Assessment operations</dt><dd>{artifact.assessmentOperationIds.join(", ")}</dd></div>
                  <div><dt>Assessment receipts</dt><dd>{artifact.assessmentReceiptIds.join(", ")}</dd></div>
                  <div><dt>Assessment receipt content</dt><dd>{artifact.assessmentReceiptContentIds.join(", ")}</dd></div>
                </dl>
              </article>
            ))}
          </div>
        )}
      </section>

      <section
        data-production-region="decision-receipts"
        aria-labelledby="product-runtime-decision-receipts-title"
      >
        <h4 id="product-runtime-decision-receipts-title">Publish-review decision receipts</h4>
        <p>
          The host reopens the stored decision and every assessment/read receipt, re-runs citation
          closure, and derives the same deterministic outcome. <code>proceed_to_publish_review</code>
          permits only host intake to an unreviewed queue; it does not mean captions exist or anything was published.
        </p>
        {visibleDecisionReceipts.length === 0 ? (
          <p className="product-runtime-unavailable" data-production-empty="decision-receipts">
            Unavailable until a completed decision receipt and all audited assessment lineage are
            reopened and verified. V1, absent, failed, skipped, or tampered paths remain unavailable.
          </p>
        ) : (
          <div className="product-runtime-fact-list">
            {visibleDecisionReceipts.map((decision) => (
              <article
                key={decision.operationId}
                data-production-decision-receipt-id={decision.operationId}
                data-integrity={decision.integrity}
                data-decision-outcome={decision.outcome}
                data-decision-producer={decision.producer}
              >
                <header>
                  <h5>studio.evidence-decision.receipt.v1</h5>
                  <span>{decision.outcome}</span>
                </header>
                <dl>
                  <div>
                    <dt>Decision operation</dt>
                    <dd>
                      {operationIds.has(decision.operationId)
                        ? <ProductionIdentityLink kind="operation" identity={decision.operationId} />
                        : decision.operationId}
                    </dd>
                  </div>
                  <div>
                    <dt>Decision artifact</dt>
                    <dd><ProductionArtifactReference identity={decision.artifactId} renderedArtifactIds={renderedArtifactIds} /></dd>
                  </div>
                  <div><dt>Receipt</dt><dd>{decision.receiptId}</dd></div>
                  <div><dt>Stored content</dt><dd>{decision.receiptContentId}</dd></div>
                  <div><dt>Executor</dt><dd>{decision.producer}</dd></div>
                  <div><dt>Outcome</dt><dd>{decision.outcome}</dd></div>
                  <div>
                    <dt>Reason codes</dt>
                    <dd>
                      {decision.reasonCodes.map((reason, index) => (
                        <span key={reason} data-production-decision-reason-code={reason}>
                          {index > 0 ? ", " : null}{reason}
                        </span>
                      ))}
                    </dd>
                  </div>
                  <div><dt>Audited inputs</dt><dd>{decision.auditedAssessmentCount} assessments / {decision.auditedClaimCount} claims</dd></div>
                  <div><dt>Validation</dt><dd>Decision bytes rehashed; assessment audits and deterministic outcome re-derived</dd></div>
                </dl>
                <ul data-production-decision-inputs={decision.inputs.length}>
                  {decision.inputs.map((input) => (
                    <li key={input.operationId} data-production-decision-input-operation-id={input.operationId}>
                      {operationIds.has(input.operationId)
                        ? <ProductionIdentityLink kind="operation" identity={input.operationId} />
                        : input.operationId}
                      {" · "}
                      <ProductionArtifactReference identity={input.artifactId} renderedArtifactIds={renderedArtifactIds} />
                      {` · ${input.receiptId} · ${input.receiptContentId}`}
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
