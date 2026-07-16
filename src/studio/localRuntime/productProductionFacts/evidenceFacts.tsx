import type { ProductionFactsContext } from "./context";
import {
  ProductionArtifactReference,
  ProductionIdentityLink,
  productionIdentityTarget,
} from "./shared";

export function ProductionEvidenceFacts({ context }: { context: ProductionFactsContext }) {
  const { projection, renderedArtifactIds, operationIds, taskIds, workerIds, readReceiptIds, visibleAssessmentAudits } = context;
  return (
    <>
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
    </>
  );
}
