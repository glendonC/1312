import type {
  RuntimeHostPublishReviewDecisionRequest,
  RuntimeHostPublishReviewOperator,
  RuntimeHostPublishReviewRevocationRequest,
} from "../../runtime/production/runtimeHost/model";
import type { ProductionFactsContext } from "./context";
import {
  PublishReviewDecisionControl,
  PublishReviewRevocationControl,
} from "./reviewControls";
import {
  ProductionArtifactReference,
  ProductionIdentityLink,
  productionIdentityTarget,
} from "./shared";

export function ProductionReviewFacts({
  context,
  reviewOperator,
  reviewBusy,
  reviewError,
  onPublishReviewDecision,
  onPublishReviewRevocation,
}: {
  context: ProductionFactsContext;
  reviewOperator: RuntimeHostPublishReviewOperator | null;
  reviewBusy: boolean;
  reviewError: string | null;
  onPublishReviewDecision: (request: RuntimeHostPublishReviewDecisionRequest) => Promise<void>;
  onPublishReviewRevocation: (request: RuntimeHostPublishReviewRevocationRequest) => Promise<void>;
}) {
  const { projection, renderedArtifactIds, operationIds, visiblePublishReviewIntakes, visiblePublishReviewDecisions, verifiedQueuedIntakes, verifiedRejectedIntakes, unreviewedQueuedIntakes, hasUnverifiedQueuedProjection } = context;
  return (
    <>
      <section
        data-production-region="publish-review-intakes"
        aria-labelledby="product-runtime-publish-review-intakes-title"
      >
        <h4 id="product-runtime-publish-review-intakes-title">Publish-review intake lineage</h4>
        <p>
          Host-produced queue or rejection lineage over one verified decision receipt. Queued means
          awaiting review only; it does not mean reviewed, captioned, uploaded, published, or public.
        </p>
        {projection.publishReviewIntakes.length === 0 ? (
          <p className="product-runtime-unavailable" data-production-empty="publish-review-intakes">
            Unavailable until the host verifies a completed decision receipt and records a closed
            publish-review intake. V1 and absent, failed, or tampered decision paths stay unavailable.
          </p>
        ) : (
          <div className="product-runtime-fact-list">
            {projection.publishReviewIntakes.map((intake) => (
              <article
                key={intake.intakeId}
                id={`product-production-intake-${intake.intakeId}`}
                data-production-publish-review-intake-id={intake.intakeId}
                data-status={intake.status}
                data-intake-outcome={intake.outcome ?? "unavailable"}
              >
                <header><h5>studio.publish-review-intake.receipt.v1</h5><span>{intake.outcome ?? intake.status}</span></header>
                <dl>
                  <div><dt>Intake</dt><dd>{intake.intakeId}</dd></div>
                  <div>
                    <dt>Verified decision operation</dt>
                    <dd>
                      {operationIds.has(intake.decisionOperationId)
                        ? <ProductionIdentityLink kind="operation" identity={intake.decisionOperationId} />
                        : intake.decisionOperationId}
                    </dd>
                  </div>
                  <div>
                    <dt>Verified decision artifact</dt>
                    <dd><ProductionArtifactReference identity={intake.decisionArtifactId} renderedArtifactIds={renderedArtifactIds} /></dd>
                  </div>
                  <div><dt>Verified decision receipt</dt><dd>{intake.decisionReceiptId}</dd></div>
                  <div><dt>Decision receipt content</dt><dd>{intake.decisionReceiptContentId}</dd></div>
                  <div><dt>Outcome</dt><dd>{intake.outcome ?? "Unavailable until intake completion"}</dd></div>
                  <div>
                    <dt>Decision reason codes</dt>
                    <dd>
                      {intake.reasonCodes.length === 0
                        ? "Unavailable until intake completion"
                        : intake.reasonCodes.map((reason, index) => (
                          <span key={reason} data-production-intake-reason-code={reason}>
                            {index > 0 ? ", " : null}{reason}
                          </span>
                        ))}
                    </dd>
                  </div>
                  <div>
                    <dt>Intake artifact</dt>
                    <dd>
                      {intake.outputArtifactId
                        ? <ProductionArtifactReference identity={intake.outputArtifactId} renderedArtifactIds={renderedArtifactIds} />
                        : "Unavailable until intake completion"}
                    </dd>
                  </div>
                  <div><dt>Receipt</dt><dd>{intake.receiptId ?? "Unavailable until intake completion"}</dd></div>
                  <div><dt>Receipt content</dt><dd>{intake.receiptContentId ?? "Unavailable until intake completion"}</dd></div>
                  <div><dt>Failure</dt><dd>{intake.failure ?? (intake.status === "failed" ? "Failure reason unavailable" : "Not recorded")}</dd></div>
                </dl>
              </article>
            ))}
          </div>
        )}
      </section>

      <section
        data-production-region="publish-review-intake-artifacts"
        aria-labelledby="product-runtime-publish-review-intake-artifacts-title"
      >
        <h4 id="product-runtime-publish-review-intake-artifacts-title">Publish-review intake artifacts</h4>
        {projection.publishReviewIntakeArtifacts.length === 0 ? (
          <p className="product-runtime-unavailable" data-production-empty="publish-review-intake-artifacts">
            Unavailable until a completed intake records its private content-addressed receipt artifact.
          </p>
        ) : (
          <div className="product-runtime-fact-list">
            {projection.publishReviewIntakeArtifacts.map((artifact) => (
              <article
                key={artifact.artifactId}
                id={productionIdentityTarget("artifact", artifact.artifactId)}
                data-production-publish-review-intake-artifact-id={artifact.artifactId}
              >
                <header><h5>{artifact.kind}</h5><span>private intake receipt</span></header>
                <dl>
                  <div><dt>Artifact</dt><dd>{artifact.artifactId}</dd></div>
                  <div><dt>Content</dt><dd>{artifact.contentId} · {artifact.bytes} bytes</dd></div>
                  <div><dt>Intake</dt><dd>{artifact.intakeId}</dd></div>
                  <div><dt>Receipt</dt><dd>{artifact.receiptId}</dd></div>
                  <div><dt>Receipt content</dt><dd>{artifact.receiptContentId}</dd></div>
                  <div>
                    <dt>Decision operation</dt>
                    <dd>
                      {operationIds.has(artifact.decisionOperationId)
                        ? <ProductionIdentityLink kind="operation" identity={artifact.decisionOperationId} />
                        : artifact.decisionOperationId}
                    </dd>
                  </div>
                  <div>
                    <dt>Decision artifact</dt>
                    <dd><ProductionArtifactReference identity={artifact.decisionArtifactId} renderedArtifactIds={renderedArtifactIds} /></dd>
                  </div>
                  <div><dt>Decision receipt</dt><dd>{artifact.decisionReceiptId}</dd></div>
                  <div><dt>Decision receipt content</dt><dd>{artifact.decisionReceiptContentId}</dd></div>
                </dl>
              </article>
            ))}
          </div>
        )}
      </section>

      <section
        data-production-region="publish-review-intake-receipts"
        aria-labelledby="product-runtime-publish-review-intake-receipts-title"
      >
        <h4 id="product-runtime-publish-review-intake-receipts-title">Verified publish-review intake receipts</h4>
        <p>
          The host reopens the intake, decision, assessment, and read receipts before returning this
          view. Rejected decision reasons remain visible; queued remains unreviewed and unpublished.
        </p>
        {visiblePublishReviewIntakes.length === 0 ? (
          <p className="product-runtime-unavailable" data-production-empty="publish-review-intake-receipts">
            Unavailable until stored intake bytes and the complete verified decision lineage agree.
          </p>
        ) : (
          <div className="product-runtime-fact-list">
            {visiblePublishReviewIntakes.map((intake) => (
              <article
                key={intake.intakeId}
                data-production-publish-review-intake-receipt-id={intake.intakeId}
                data-integrity={intake.integrity}
                data-intake-outcome={intake.outcome}
                data-intake-producer={intake.producer}
              >
                <header><h5>studio.publish-review-intake.receipt.v1</h5><span>{intake.outcome}</span></header>
                <dl>
                  <div><dt>Intake</dt><dd>{intake.intakeId}</dd></div>
                  <div>
                    <dt>Intake artifact</dt>
                    <dd><ProductionArtifactReference identity={intake.artifactId} renderedArtifactIds={renderedArtifactIds} /></dd>
                  </div>
                  <div><dt>Receipt</dt><dd>{intake.receiptId}</dd></div>
                  <div><dt>Stored content</dt><dd>{intake.receiptContentId}</dd></div>
                  <div><dt>Executor</dt><dd>{intake.producer}</dd></div>
                  <div><dt>Outcome</dt><dd>{intake.outcome}</dd></div>
                  <div>
                    <dt>Reason codes</dt>
                    <dd>
                      {intake.reasonCodes.map((reason, index) => (
                        <span key={reason} data-production-verified-intake-reason-code={reason}>
                          {index > 0 ? ", " : null}{reason}
                        </span>
                      ))}
                    </dd>
                  </div>
                  <div>
                    <dt>Decision operation</dt>
                    <dd>
                      {operationIds.has(intake.decision.operationId)
                        ? <ProductionIdentityLink kind="operation" identity={intake.decision.operationId} />
                        : intake.decision.operationId}
                    </dd>
                  </div>
                  <div>
                    <dt>Decision artifact</dt>
                    <dd><ProductionArtifactReference identity={intake.decision.artifactId} renderedArtifactIds={renderedArtifactIds} /></dd>
                  </div>
                  <div><dt>Decision receipt</dt><dd>{intake.decision.receiptId}</dd></div>
                  <div><dt>Decision receipt content</dt><dd>{intake.decision.receiptContentId}</dd></div>
                  <div><dt>Validation</dt><dd>Intake bytes rehashed; decision and all audited inputs reverified</dd></div>
                </dl>
              </article>
            ))}
          </div>
        )}
      </section>

      <section
        data-production-region="publish-review-human-review"
        aria-labelledby="product-runtime-publish-review-human-review-title"
      >
        <h4 id="product-runtime-publish-review-human-review-title">Queued intake human review</h4>
        <p>
          One host-configured, attested operator may review only a fully verified queued intake.
          The resulting receipt is separate and immutable. A queued intake remains unreviewed until
          that receipt exists.
        </p>
        {reviewError ? <p role="alert" data-production-review-error>{reviewError}</p> : null}
        {hasUnverifiedQueuedProjection ? (
          <p className="product-runtime-unavailable" data-production-review-empty="unverified">
            A queued journal intake is not reviewable because its stored receipt and complete
            decision lineage are not currently host-verified.
          </p>
        ) : null}
        {projection.publishReviewIntakes.length === 0 && visiblePublishReviewIntakes.length === 0 ? (
          <p className="product-runtime-unavailable" data-production-review-empty="v1-or-absent">
            No publish-review intake exists. V1 and runtimes without a completed verified decision
            have no review controls.
          </p>
        ) : null}
        {verifiedRejectedIntakes.length > 0 && verifiedQueuedIntakes.length === 0 ? (
          <p className="product-runtime-unavailable" data-production-review-empty="rejected-intake">
            The verified intake was rejected before queue admission. Its reasons remain visible;
            it cannot be human-approved without a new queued intake.
          </p>
        ) : null}
        {verifiedQueuedIntakes.length > 0 && unreviewedQueuedIntakes.length === 0 ? (
          <p data-production-review-empty="no-pending-intake">
            Every verified queued intake already has an immutable review decision receipt.
          </p>
        ) : null}
        {unreviewedQueuedIntakes.length > 0 && reviewOperator === null ? (
          <p className="product-runtime-unavailable" data-production-review-empty="reviewer-unavailable">
            The host review operator identity is unavailable, so no review action is enabled.
          </p>
        ) : null}
        {reviewOperator && unreviewedQueuedIntakes.length > 0 ? (
          <div className="product-runtime-fact-list">
            {unreviewedQueuedIntakes.map((intake) => (
              <PublishReviewDecisionControl
                key={intake.intakeId}
                intake={intake}
                reviewer={reviewOperator}
                busy={reviewBusy}
                onDecision={onPublishReviewDecision}
              />
            ))}
          </div>
        ) : null}
      </section>

      <section
        data-production-region="publish-review-decision-lineage"
        aria-labelledby="product-runtime-publish-review-decision-lineage-title"
      >
        <h4 id="product-runtime-publish-review-decision-lineage-title">Publish-review decision lineage</h4>
        {projection.publishReviewDecisions.length === 0 ? (
          <p className="product-runtime-unavailable" data-production-empty="publish-review-decision-lineage">
            No started, completed, or failed human review decision is recorded.
          </p>
        ) : (
          <div className="product-runtime-fact-list">
            {projection.publishReviewDecisions.map((review) => (
              <article
                key={review.reviewId}
                data-production-publish-review-decision-id={review.reviewId}
                data-status={review.status}
                data-review-outcome={review.outcome ?? "unavailable"}
              >
                <header><h5>studio.publish-review-decision.receipt.v1</h5><span>{review.outcome ?? review.status}</span></header>
                <dl>
                  <div><dt>Review</dt><dd>{review.reviewId}</dd></div>
                  <div><dt>Queued intake</dt><dd>{review.intakeId}</dd></div>
                  <div><dt>Reviewer</dt><dd>{review.reviewerLabel} · {review.reviewerId}</dd></div>
                  <div><dt>Outcome</dt><dd>{review.outcome ?? "Unavailable until completion"}</dd></div>
                  <div><dt>Reason codes</dt><dd>{review.reasonCodes.join(", ") || "Unavailable until completion"}</dd></div>
                  <div><dt>Optional note</dt><dd>{review.note ?? "Not recorded"}</dd></div>
                  <div><dt>Receipt</dt><dd>{review.receiptId ?? "Unavailable until completion"}</dd></div>
                  <div><dt>Receipt content</dt><dd>{review.receiptContentId ?? "Unavailable until completion"}</dd></div>
                  <div><dt>Failure</dt><dd>{review.failure ?? (review.status === "failed" ? "Failure reason unavailable" : "Not recorded")}</dd></div>
                </dl>
              </article>
            ))}
            {projection.publishReviewRevocations.map((revocation) => (
              <article
                key={revocation.revocationId}
                data-production-publish-review-revocation-id={revocation.revocationId}
                data-status={revocation.status}
              >
                <header><h5>studio.publish-review-revocation.receipt.v1</h5><span>{revocation.status}</span></header>
                <dl>
                  <div><dt>Revocation</dt><dd>{revocation.revocationId}</dd></div>
                  <div><dt>Superseded approval</dt><dd>{revocation.reviewId}</dd></div>
                  <div><dt>Reviewer</dt><dd>{revocation.reviewerLabel} · {revocation.reviewerId}</dd></div>
                  <div><dt>Reason codes</dt><dd>{revocation.reasonCodes.join(", ") || "Unavailable until completion"}</dd></div>
                  <div><dt>Optional note</dt><dd>{revocation.note ?? "Not recorded"}</dd></div>
                  <div><dt>Receipt</dt><dd>{revocation.receiptId ?? "Unavailable until completion"}</dd></div>
                  <div><dt>Receipt content</dt><dd>{revocation.receiptContentId ?? "Unavailable until completion"}</dd></div>
                  <div><dt>Failure</dt><dd>{revocation.failure ?? (revocation.status === "failed" ? "Failure reason unavailable" : "Not recorded")}</dd></div>
                </dl>
              </article>
            ))}
          </div>
        )}
      </section>

      <section
        data-production-region="publish-review-receipt-artifacts"
        aria-labelledby="product-runtime-publish-review-receipt-artifacts-title"
      >
        <h4 id="product-runtime-publish-review-receipt-artifacts-title">Publish-review receipt artifacts</h4>
        {projection.publishReviewDecisionArtifacts.length === 0 && projection.publishReviewRevocationArtifacts.length === 0 ? (
          <p className="product-runtime-unavailable" data-production-empty="publish-review-receipt-artifacts">
            No completed private review decision or revocation receipt artifact exists.
          </p>
        ) : (
          <div className="product-runtime-fact-list">
            {projection.publishReviewDecisionArtifacts.map((artifact) => (
              <article
                key={artifact.artifactId}
                id={productionIdentityTarget("artifact", artifact.artifactId)}
                data-production-publish-review-decision-artifact-id={artifact.artifactId}
              >
                <header><h5>{artifact.kind}</h5><span>private review receipt</span></header>
                <dl>
                  <div><dt>Artifact</dt><dd>{artifact.artifactId}</dd></div>
                  <div><dt>Content</dt><dd>{artifact.contentId} · {artifact.bytes} bytes</dd></div>
                  <div><dt>Review</dt><dd>{artifact.reviewId}</dd></div>
                  <div><dt>Verified intake</dt><dd>{artifact.intakeId}</dd></div>
                  <div><dt>Receipt</dt><dd>{artifact.receiptId}</dd></div>
                  <div><dt>Receipt content</dt><dd>{artifact.receiptContentId}</dd></div>
                </dl>
              </article>
            ))}
            {projection.publishReviewRevocationArtifacts.map((artifact) => (
              <article
                key={artifact.artifactId}
                id={productionIdentityTarget("artifact", artifact.artifactId)}
                data-production-publish-review-revocation-artifact-id={artifact.artifactId}
              >
                <header><h5>{artifact.kind}</h5><span>private revocation receipt</span></header>
                <dl>
                  <div><dt>Artifact</dt><dd>{artifact.artifactId}</dd></div>
                  <div><dt>Content</dt><dd>{artifact.contentId} · {artifact.bytes} bytes</dd></div>
                  <div><dt>Revocation</dt><dd>{artifact.revocationId}</dd></div>
                  <div><dt>Superseded approval</dt><dd>{artifact.reviewId}</dd></div>
                  <div><dt>Receipt</dt><dd>{artifact.receiptId}</dd></div>
                  <div><dt>Receipt content</dt><dd>{artifact.receiptContentId}</dd></div>
                </dl>
              </article>
            ))}
          </div>
        )}
      </section>

      <section
        data-production-region="publish-review-decision-receipts"
        aria-labelledby="product-runtime-publish-review-decision-receipts-title"
      >
        <h4 id="product-runtime-publish-review-decision-receipts-title">Verified human review receipts</h4>
        <p>
          The host reopens each review and optional revocation receipt, then repeats intake,
          decision, assessment, and read verification. Approval means only that the separate caption
          producer may consume this review receipt after another host verification. It creates no captions, upload, publication,
          media-truth, or English-correctness claim.
        </p>
        {visiblePublishReviewDecisions.length === 0 ? (
          <p className="product-runtime-unavailable" data-production-empty="publish-review-decision-receipts">
            No completed human review receipt passes the full stored-lineage verification path.
          </p>
        ) : (
          <div className="product-runtime-fact-list">
            {visiblePublishReviewDecisions.map((review) => {
              const visibleRevocation = review.revocation && projection.publishReviewRevocations.some((projected) =>
                projected.revocationId === review.revocation?.revocationId &&
                projected.status === "completed" &&
                projected.outputArtifactId === review.revocation.artifactId &&
                projected.receiptId === review.revocation.receiptId &&
                projected.receiptContentId === review.revocation.receiptContentId) &&
                renderedArtifactIds.has(review.revocation.artifactId)
                ? review.revocation
                : null;
              const visibleState = visibleRevocation ? "approval_revoked" : review.state;
              return (
                <article
                  key={review.reviewId}
                  data-production-publish-review-decision-receipt-id={review.reviewId}
                  data-integrity={review.integrity}
                  data-review-outcome={review.outcome}
                  data-review-state={visibleState}
                  data-reviewer-id={review.reviewer.id}
                >
                  <header><h5>studio.publish-review-decision.receipt.v1</h5><span>{visibleState}</span></header>
                  <dl>
                    <div><dt>Review</dt><dd>{review.reviewId}</dd></div>
                    <div><dt>Receipt</dt><dd>{review.receiptId}</dd></div>
                    <div><dt>Stored content</dt><dd>{review.receiptContentId}</dd></div>
                    <div><dt>Reviewer</dt><dd>{review.reviewer.label} · {review.reviewer.id}</dd></div>
                    <div><dt>Attestation</dt><dd>{review.reviewer.attestation}</dd></div>
                    <div><dt>Outcome</dt><dd>{review.outcome}</dd></div>
                    <div>
                      <dt>Reason codes</dt>
                      <dd>{review.reasonCodes.map((reason, index) => (
                        <span key={reason} data-production-review-reason-code={reason}>
                          {index > 0 ? ", " : null}{reason}
                        </span>
                      ))}</dd>
                    </div>
                    <div><dt>Optional note</dt><dd>{review.note ?? "Not recorded"}</dd></div>
                    <div><dt>Verified queued intake</dt><dd>{review.intake.intakeId}</dd></div>
                    <div><dt>Validation</dt><dd>Review bytes rehashed; intake and complete decision lineage reverified</dd></div>
                  </dl>
                  {visibleRevocation ? (
                    <div
                      data-production-publish-review-revocation-receipt-id={visibleRevocation.revocationId}
                      data-integrity={visibleRevocation.integrity}
                    >
                      <h6>Approval revocation receipt</h6>
                      <dl>
                        <div><dt>Revocation</dt><dd>{visibleRevocation.revocationId}</dd></div>
                        <div><dt>Receipt</dt><dd>{visibleRevocation.receiptId}</dd></div>
                        <div><dt>Stored content</dt><dd>{visibleRevocation.receiptContentId}</dd></div>
                        <div><dt>Reviewer</dt><dd>{visibleRevocation.reviewer.label} · {visibleRevocation.reviewer.id}</dd></div>
                        <div><dt>Attestation</dt><dd>{visibleRevocation.reviewer.attestation}</dd></div>
                        <div>
                          <dt>Reason codes</dt>
                          <dd>{visibleRevocation.reasonCodes.map((reason, index) => (
                            <span key={reason} data-production-review-revocation-reason-code={reason}>
                              {index > 0 ? ", " : null}{reason}
                            </span>
                          ))}</dd>
                        </div>
                        <div><dt>Optional note</dt><dd>{visibleRevocation.note ?? "Not recorded"}</dd></div>
                      </dl>
                    </div>
                  ) : review.outcome === "approve_for_caption_production" && reviewOperator ? (
                    <PublishReviewRevocationControl
                      review={review}
                      reviewer={reviewOperator}
                      busy={reviewBusy}
                      onRevoke={onPublishReviewRevocation}
                    />
                  ) : null}
                </article>
              );
            })}
          </div>
        )}
      </section>
    </>
  );
}
