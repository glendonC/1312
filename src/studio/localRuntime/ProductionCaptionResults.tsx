import { useEffect, useMemo, useRef, useState } from "react";

import LearningResults from "../learning/LearningResults";
import { projectProductionLearningPresentation } from "../learning/productionExplanationAdapter";
import { projectVerifiedProductionLearningSource } from "../learning/productionSourceAdapter";
import type { LearningPlayback } from "../learning/presentation.ts";
import { PRODUCTION_CAPTION_RESULTS_ID } from "../resultAccess";
import type { VerifiedCaptionProductionResult } from "../runtime/production/captionProductionAudit";
import type { LocalRuntimeHostClient } from "./client";
import ProductionMediaPlayer from "./ProductionMediaPlayer.tsx";
import {
  ProductionPlaybackController,
  type ProductionPlaybackLoadResult,
} from "./productionPlaybackController.ts";

const PLAYBACK_UNAVAILABLE: LearningPlayback = {
  state: "unavailable",
  reasonCode: "production_media_playback_unavailable",
};

function ProductionCaptionResult({
  client,
  runtimeId,
  sourceRevisionId,
  result,
  playbackEligible,
}: {
  client: LocalRuntimeHostClient | null;
  runtimeId: string;
  sourceRevisionId: string;
  result: VerifiedCaptionProductionResult;
  playbackEligible: boolean;
}) {
  const { verification, artifact } = result;
  const projectionKey = [
    runtimeId,
    sourceRevisionId,
    verification.jobId,
    verification.captionArtifactId,
    verification.captionContentId,
    verification.authorityState,
    verification.source.artifactId,
    verification.source.contentId,
    verification.source.range.startMs,
    verification.source.range.endMs,
  ].join("\u001f");
  const sourceProjection = useMemo(
    () => projectVerifiedProductionLearningSource(result),
    [projectionKey],
  );
  const controllerRef = useRef<ProductionPlaybackController | null>(null);
  if (!controllerRef.current) controllerRef.current = new ProductionPlaybackController();
  const [loadResult, setLoadResult] = useState<
    Exclude<ProductionPlaybackLoadResult, { state: "invalidated" }> | { state: "loading" }
  >(
    { state: "loading" },
  );
  const [playback, setPlayback] = useState<LearningPlayback>(PLAYBACK_UNAVAILABLE);

  useEffect(() => {
    const controller = controllerRef.current;
    if (!controller) return () => undefined;
    setPlayback(PLAYBACK_UNAVAILABLE);
    if (!playbackEligible || !client || sourceProjection.state !== "ready") {
      controller.invalidate();
      setLoadResult({
        state: "unavailable",
        reasonCode: "invalid_playback_binding",
        detail: playbackEligible
          ? "The active caption result does not close to one verified private source."
          : "Private playback requires exactly one active verified caption result.",
      });
      return () => controller.invalidate();
    }

    let active = true;
    setLoadResult({ state: "loading" });
    void controller.load({
      runtimeId,
      sourceRevisionId,
      source: sourceProjection.source,
      caption: {
        jobId: verification.jobId,
        artifactId: verification.captionArtifactId,
        contentId: verification.captionContentId,
      },
    }, client)
      .then((next) => {
        if (active && next.state !== "invalidated") setLoadResult(next);
      });
    return () => {
      active = false;
      controller.invalidate();
    };
  }, [client, playbackEligible, projectionKey, runtimeId, sourceRevisionId]);

  return (
    <article
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
        <>
          {loadResult.state === "available" ? (
            <ProductionMediaPlayer binding={loadResult.binding} onPlaybackChange={setPlayback} />
          ) : (
            <p
              className="product-runtime-unavailable"
              role="status"
              data-private-playback-load-state={loadResult.state}
              data-reason-code={loadResult.state === "unavailable" ? loadResult.reasonCode : undefined}
            >
              {loadResult.state === "loading"
                ? "Verifying one content-bound private playback handle."
                : loadResult.detail}
            </p>
          )}
          <LearningResults
            presentation={projectProductionLearningPresentation(sourceProjection.source, {
              playbackAvailable: playback.state === "available",
            })}
            playback={playback}
          />
        </>
      ) : (
        <p className="product-runtime-unavailable" data-reason-code={sourceProjection.reasonCode}>
          Verified production captions failed closed before learning projection. No fixture content was substituted.
        </p>
      )}
    </article>
  );
}

export default function ProductionCaptionResults({
  client,
  runtimeId,
  sourceRevisionId,
  results,
}: {
  client: LocalRuntimeHostClient | null;
  runtimeId: string;
  sourceRevisionId: string;
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
          {results.map((result) => (
            <ProductionCaptionResult
              key={result.verification.jobId}
              client={client}
              runtimeId={runtimeId}
              sourceRevisionId={sourceRevisionId}
              result={result}
              playbackEligible={results.length === 1}
            />
          ))}
        </div>
      )}

      <p className="product-runtime-caption-results-nonclaim">
        Private projection only: no upload, CDN delivery, or publication. Timed availability does not
        claim transcription accuracy, English quality, or a Bet G score.
      </p>
    </section>
  );
}
