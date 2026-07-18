import type { VerifiedCaptionProductionResult } from "../runtime/production/captionProductionAudit";
import LearningResults from "../learning/LearningResults";
import { projectProductionLearningPresentation } from "../learning/productionExplanationAdapter";
import { projectVerifiedProductionLearningSource } from "../learning/productionSourceAdapter";
import { PRODUCTION_CAPTION_RESULTS_ID } from "../resultAccess";

export default function ProductionCaptionResults({
  runtimeId,
  results,
}: {
  runtimeId: string;
  results: readonly VerifiedCaptionProductionResult[];
}) {
  return (
    <section
      id={PRODUCTION_CAPTION_RESULTS_ID}
      className="product-runtime-caption-results"
      data-production-results-region="caption-lineage"
      aria-labelledby="product-runtime-caption-results-title"
      tabIndex={-1}
    >
      <header>
        <span>Host-verified private artifacts</span>
        <h3 id="product-runtime-caption-results-title">Production caption results</h3>
      </header>
      <p className="product-runtime-caption-results-boundary" role="note">
        This is production-caption lineage for the active local runtime <code>{runtimeId}</code>.
        These identities are not replay Results identity and do not replace or join the recorded
        {" "}<code>run-006</code> RunBundle.
      </p>

      {results.length === 0 ? (
        <p
          className="product-runtime-unavailable"
          data-production-results-empty="no-verified-caption-job"
        >
          No completed host-verified production caption artifact is available for this local runtime.
          No caption text or identity is inferred.
        </p>
      ) : (
        <div className="product-runtime-caption-result-list">
          {results.map((result) => {
            const { verification, artifact } = result;
            const sourceProjection = projectVerifiedProductionLearningSource(result);
            return (
              <article
                key={verification.jobId}
                data-production-results-job-id={verification.jobId}
                data-caption-authority-state={verification.authorityState}
                data-caption-integrity={verification.integrity}
              >
                <header>
                  <div>
                    <span>studio.caption-production.artifact.v1</span>
                    <h4>Timed KO / EN projection</h4>
                  </div>
                  <b>{verification.authorityState}</b>
                </header>
                {verification.authorityState === "revoked_after_completion" ? (
                  <p role="note">
                    Approval was revoked after completion. The already-completed private artifact remains
                    visible; the revocation grants no new production authority.
                  </p>
                ) : null}
                <dl className="product-runtime-caption-result-identities">
                  <div><dt>Local runtime</dt><dd>{artifact.runId}</dd></div>
                  <div><dt>Caption job</dt><dd>{verification.jobId}</dd></div>
                  <div><dt>Caption artifact</dt><dd>{verification.captionArtifactId}</dd></div>
                  <div><dt>Caption content</dt><dd>{verification.captionContentId}</dd></div>
                  <div><dt>Receipt artifact</dt><dd>{verification.receiptArtifactId}</dd></div>
                  <div><dt>Receipt</dt><dd>{verification.receiptId}</dd></div>
                  <div><dt>Receipt content</dt><dd>{verification.receiptContentId}</dd></div>
                  <div><dt>Executor classification</dt><dd>{verification.executor.classification}</dd></div>
                </dl>
                {sourceProjection.state === "ready" ? (
                  <LearningResults
                    presentation={projectProductionLearningPresentation(sourceProjection.source)}
                    playback={{ state: "unavailable", reasonCode: "production_media_playback_unavailable" }}
                  />
                ) : (
                  <p className="product-runtime-unavailable" data-reason-code={sourceProjection.reasonCode}>
                    Verified production captions failed closed before learning projection. No fixture content was substituted.
                  </p>
                )}
              </article>
            );
          })}
        </div>
      )}

      <p className="product-runtime-caption-results-nonclaim">
        Private projection only: no upload, CDN delivery, or publication. Timed availability does not
        claim transcription accuracy, English quality, or a Bet G score.
      </p>
    </section>
  );
}
