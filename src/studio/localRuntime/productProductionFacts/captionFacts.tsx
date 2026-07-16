import type { RuntimeHostCaptionProductionRequest } from "../../runtime/production/runtimeHost/model";
import { seconds } from "../productLocalRuntimeShared";
import type { ProductionFactsContext } from "./context";
import { productionIdentityTarget } from "./shared";

export function ProductionCaptionFacts({
  context,
  captionBusy,
  captionError,
  reviewBusy,
  onCaptionProduction,
}: {
  context: ProductionFactsContext;
  captionBusy: boolean;
  captionError: string | null;
  reviewBusy: boolean;
  onCaptionProduction: (request: RuntimeHostCaptionProductionRequest) => Promise<void>;
}) {
  const { projection, visibleCaptionProductions, eligibleCaptionApprovals } = context;
  return (
    <>
      <section
        data-production-region="caption-production"
        aria-labelledby="product-runtime-caption-production-title"
      >
        <h4 id="product-runtime-caption-production-title">Caption production</h4>
        <p>
          This is a separate private KO + EN production authority. The host accepts only an exact,
          recursively verified, unrevoked approval identity and derives the media, range, and producer
          inputs itself. Coverage counts do not claim transcription or English quality. Withheld and
          unavailable lines remain first-class.
        </p>
        {captionError ? <p role="alert" data-production-caption-error>{captionError}</p> : null}
        {eligibleCaptionApprovals.map((review) => (
          <article key={review.reviewId} data-production-caption-approval-id={review.reviewId}>
            <header><h5>Eligible approval</h5><span>not captioned</span></header>
            <dl>
              <div><dt>Review</dt><dd>{review.reviewId}</dd></div>
              <div><dt>Approval receipt</dt><dd>{review.receiptId}</dd></div>
              <div><dt>Approval content</dt><dd>{review.receiptContentId}</dd></div>
            </dl>
            <button
              type="button"
              disabled={captionBusy || reviewBusy}
              data-production-caption-action="start"
              onClick={() => void onCaptionProduction({
                approval: {
                  reviewId: review.reviewId,
                  artifactId: review.artifactId,
                  receiptId: review.receiptId,
                  receiptContentId: review.receiptContentId,
                },
              })}
            >
              {captionBusy ? "Producing bounded captions…" : "Start bounded caption production"}
            </button>
            <p>Creates private artifacts only. It does not upload or publish.</p>
          </article>
        ))}
        {eligibleCaptionApprovals.length === 0 && projection.captionProductions.length === 0 ? (
          <p className="product-runtime-unavailable" data-production-caption-empty="no-eligible-approval">
            No exact unrevoked caption-production approval is currently eligible. Review alone never
            implies that captions exist.
          </p>
        ) : null}
        {projection.captionProductions.length > 0 ? (
          <div className="product-runtime-fact-list">
            {projection.captionProductions.map((job) => {
              const verified = visibleCaptionProductions.find((caption) => caption.jobId === job.jobId) ?? null;
              return (
                <article
                  key={job.jobId}
                  data-production-caption-job-id={job.jobId}
                  data-status={job.status}
                  data-caption-authority-state={verified?.authorityState ?? "unverified_or_incomplete"}
                >
                  <header><h5>studio.caption-production.receipt.v1</h5><span>{verified?.result.status ?? job.status}</span></header>
                  <dl>
                    <div><dt>Job</dt><dd>{job.jobId}</dd></div>
                    <div><dt>Approval</dt><dd>{job.approvalReviewId}</dd></div>
                    <div><dt>Approved range</dt><dd>{seconds(job.range.startMs)}–{seconds(job.range.endMs)}</dd></div>
                    <div><dt>Executor classification</dt><dd>{job.executorClassification}</dd></div>
                    <div><dt>Authority now</dt><dd>{verified?.authorityState ?? "Unavailable until full completion audit"}</dd></div>
                    <div><dt>Lines</dt><dd data-production-caption-line-count>{verified?.result.lineCount ?? "Unavailable until completion"}</dd></div>
                    <div><dt>Source available</dt><dd>{verified?.result.sourceAvailableCount ?? "Unavailable until completion"}</dd></div>
                    <div><dt>Target available</dt><dd>{verified?.result.targetAvailableCount ?? "Unavailable until completion"}</dd></div>
                    <div><dt>Withheld</dt><dd data-production-caption-withheld-count>{verified?.result.withheldCount ?? "Unavailable until completion"}</dd></div>
                    <div><dt>Unavailable</dt><dd data-production-caption-unavailable-count>{verified?.result.unavailableCount ?? "Unavailable until completion"}</dd></div>
                    <div><dt>Caption artifact</dt><dd>{verified?.captionArtifactId ?? "Unavailable until completion audit"}</dd></div>
                    <div><dt>Caption content</dt><dd>{verified?.captionContentId ?? "Unavailable until completion audit"}</dd></div>
                    <div><dt>Receipt artifact</dt><dd>{verified?.receiptArtifactId ?? "Unavailable until completion audit"}</dd></div>
                    <div><dt>Receipt content</dt><dd>{verified?.receiptContentId ?? "Unavailable until completion audit"}</dd></div>
                    <div><dt>Failure</dt><dd>{job.failure ?? "Not recorded"}</dd></div>
                  </dl>
                </article>
              );
            })}
          </div>
        ) : null}
        {projection.captionArtifacts.length > 0 ? (
          <div className="product-runtime-fact-list">
            {projection.captionArtifacts.map((artifact) => (
              <article
                key={artifact.artifactId}
                id={productionIdentityTarget("artifact", artifact.artifactId)}
                data-production-caption-artifact-id={artifact.artifactId}
                data-caption-artifact-role={artifact.role}
              >
                <header><h5>{artifact.kind}</h5><span>private · immutable</span></header>
                <dl>
                  <div><dt>Artifact</dt><dd>{artifact.artifactId}</dd></div>
                  <div><dt>Content</dt><dd>{artifact.contentId} · {artifact.bytes} bytes</dd></div>
                  <div><dt>Job</dt><dd>{artifact.jobId}</dd></div>
                  <div><dt>Approval</dt><dd>{artifact.approvalReviewId}</dd></div>
                </dl>
              </article>
            ))}
          </div>
        ) : null}
        <p data-production-caption-publish-boundary>
          Upload, CDN delivery, and public publication are absent and require a later separate authority.
        </p>
      </section>
    </>
  );
}
