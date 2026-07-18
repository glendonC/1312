import type { ProductionStudioSemanticEvidenceView } from "../../runtime/production/studioProjection";
import type { ProductionFactsContext } from "./context";
import {
  ProductionArtifactReference,
  ProductionIdentityLink,
  productionIdentityTarget,
} from "./shared";

const AUDIT_COPY: Record<ProductionStudioSemanticEvidenceView["audit"], string> = {
  not_completed:
    "Not completed. No terminal event is validated, so no output, receipt, or observation identity exists yet.",
  verified_at_completion:
    "Verified at completion. The validated completion event carried the output artifact, receipt, observation count, and availability identities.",
  verified_on_reopen:
    "Verified on reopen. The host reopened and revalidated the stored artifact and receipt for this read.",
  absent_or_invalid:
    "Absent or invalid. The stored artifact or receipt failed reopening, so outputs are withheld from this projection.",
};

const PENDING_COMPLETION = "Unavailable until semantic.evidence_completed is validated";

export function ProductionSemanticEvidenceFacts({ context }: { context: ProductionFactsContext }) {
  const { projection, renderedArtifactIds, executionIds } = context;
  const semanticEvidence = projection.semanticEvidence ?? [];
  return (
    <section
      data-production-region="semantic-evidence"
      aria-labelledby="product-runtime-semantic-evidence-title"
    >
      <h4 id="product-runtime-semantic-evidence-title">Semantic media evidence operations</h4>
      <p>
        Receipted recognizer operations over the exact granted source range. Observation counts and
        availability describe receipted output identity only. They do not claim transcription
        accuracy, translation quality, meaning, or publication.
      </p>
      {semanticEvidence.length === 0 ? (
        <p className="product-runtime-unavailable" data-production-empty="semantic-evidence">
          Unavailable until a <code>semantic.evidence_started</code> event is validated. No
          transcription work is inferred from a plan, grant, worker claim, role label, or animation.
        </p>
      ) : (
        <div className="product-runtime-fact-list">
          {semanticEvidence.map((operation) => (
            <article
              key={operation.operationId}
              id={productionIdentityTarget("operation", operation.operationId)}
              data-production-semantic-evidence-id={operation.operationId}
              data-status={operation.status}
              data-operation-audit={operation.audit}
            >
              <header><h5>{operation.capability}</h5><span>{operation.status}</span></header>
              <dl>
                <div><dt>Operation</dt><dd>{operation.operationId}</dd></div>
                <div><dt>Completion audit</dt><dd>{AUDIT_COPY[operation.audit]}</dd></div>
                <div>
                  <dt>Task / worker</dt>
                  <dd>
                    <ProductionIdentityLink kind="task" identity={operation.executor.taskId} />
                    {" / "}
                    <ProductionIdentityLink kind="worker" identity={operation.executor.agentId} />
                  </dd>
                </div>
                <div>
                  <dt>Execution</dt>
                  <dd>
                    {executionIds.has(operation.executor.executionId)
                      ? <ProductionIdentityLink kind="execution" identity={operation.executor.executionId} />
                      : operation.executor.executionId}
                    {" · launch "}
                    {operation.executor.launchClaimId}
                  </dd>
                </div>
                <div><dt>Grant</dt><dd>{operation.executor.grantId}</dd></div>
                <div>
                  <dt>Source artifact</dt>
                  <dd>
                    <ProductionArtifactReference
                      identity={operation.source.artifactId}
                      renderedArtifactIds={renderedArtifactIds}
                    />
                    {" · "}
                    {operation.source.contentId}
                  </dd>
                </div>
                <div>
                  <dt>Requested range</dt>
                  <dd>[{operation.source.range.startMs}, {operation.source.range.endMs}) ms · {operation.source.trackId}</dd>
                </div>
                <div>
                  <dt>Returned range</dt>
                  <dd>
                    {operation.returnedRange
                      ? `[${operation.returnedRange.startMs}, ${operation.returnedRange.endMs}) ms`
                      : PENDING_COMPLETION}
                  </dd>
                </div>
                <div>
                  <dt>Producer</dt>
                  <dd>{operation.producer.id} {operation.producer.version} · {operation.producer.model ?? "model not recorded"} · scope {operation.producer.executionScope}</dd>
                </div>
                <div>
                  <dt>Producer runtime</dt>
                  <dd>{operation.producer.runtimeId} {operation.producer.runtimeVersion}</dd>
                </div>
                <div>
                  <dt>Producer configuration</dt>
                  <dd>{operation.producer.configurationId} · {operation.producer.configurationContentId}</dd>
                </div>
                <div>
                  <dt>Output artifact</dt>
                  <dd>
                    {operation.artifact
                      ? (
                        <>
                          <ProductionArtifactReference
                            identity={operation.artifact.artifactId}
                            renderedArtifactIds={renderedArtifactIds}
                          />
                          {" · "}
                          {operation.artifact.contentId}
                        </>
                      )
                      : PENDING_COMPLETION}
                  </dd>
                </div>
                <div>
                  <dt>Receipt</dt>
                  <dd>
                    {operation.receipt
                      ? `${operation.receipt.receiptId} · ${operation.receipt.contentId}`
                      : PENDING_COMPLETION}
                  </dd>
                </div>
                <div>
                  <dt>Observations</dt>
                  <dd>
                    {operation.observationCount !== null && operation.availability
                      ? `${operation.observationCount} · ${operation.availability.state} · ${operation.availability.truncated ? "truncated" : "not truncated"} · ${operation.availability.id}`
                      : PENDING_COMPLETION}
                  </dd>
                </div>
                <div><dt>Failure</dt><dd>{operation.failure ?? (operation.status === "failed" ? "Failure reason unavailable" : "Not recorded")}</dd></div>
              </dl>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
