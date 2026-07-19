import { useEffect, useMemo, useRef, useState } from "react";

import { Coverage } from "../glyphs";
import type { ProductionPresentedMoment } from "../learning/model";
import { projectProductionLearningPresentation } from "../learning/productionExplanationAdapter";
import { projectVerifiedProductionLearningSource } from "../learning/productionSourceAdapter";
import {
  LEARNING_LENS_KINDS,
  learningPrepKey,
  learningRequestKey,
  type LearningExplanationState,
  type LearningFineTuneDraft,
  type LearningPlayback,
  type LearningPrepProjection,
  type LearningSelectionRequest,
  type LearningPrepInteraction,
} from "../learning/presentation.ts";
import { PRODUCTION_CAPTION_RESULTS_ID } from "../resultAccess";
import type { VerifiedCaptionProductionResult } from "../runtime/production/captionProductionAudit";
import ChromePanel from "../viewer/chromePanel";
import LearningResultExperience from "../viewer/LearningResultExperience";
import type { LocalRuntimeHostClient } from "./client";
import ProductionMediaPlayer from "./ProductionMediaPlayer.tsx";
import { ProductionLearningController } from "./productionLearningController.ts";
import { ProductionLearningPrepController } from "./productionLearningPrepController.ts";
import {
  ProductionPlaybackController,
  type ProductionPlaybackLoadResult,
} from "./productionPlaybackController.ts";

const PLAYBACK_UNAVAILABLE: LearningPlayback = {
  state: "unavailable",
  reasonCode: "production_media_playback_unavailable",
};

function rangeClock(timeMs: number): string {
  const totalSeconds = Math.max(0, timeMs) / 1_000;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds - minutes * 60;
  return `${minutes}:${seconds.toFixed(1).padStart(4, "0")}`;
}

/**
 * The wired strip beneath the verified clip: line coverage of the verified caption moments and the
 * verified analysis range. Both are facts of the host-verified artifact — the production mirror of
 * the recorded surface's coverage + attribution strip, with no attribution invented for a private
 * source.
 */
function ProductionMediaMeta({
  moments,
  rangeStartMs,
  rangeEndMs,
}: {
  moments: readonly ProductionPresentedMoment[];
  rangeStartMs: number;
  rangeEndMs: number;
}) {
  const counts = { captioned: 0, withheld: 0, unavailable: 0, silent: 0 };
  for (const moment of moments) {
    if (moment.source.state !== "available") {
      counts.silent += 1;
    } else if (moment.target.state === "available") {
      counts.captioned += 1;
    } else if (moment.target.state === "withheld") {
      counts.withheld += 1;
    } else {
      counts.unavailable += 1;
    }
  }

  return (
    <div className="result-media-meta">
      <dl className="result-coverage" aria-label="Line coverage in range">
        <div data-kind="captioned"><dt>Captioned</dt><dd>{counts.captioned}</dd></div>
        <div data-kind="withheld"><dt>Withheld</dt><dd>{counts.withheld}</dd></div>
        {counts.unavailable > 0 && (
          <div data-kind="unavailable"><dt>Unavailable</dt><dd>{counts.unavailable}</dd></div>
        )}
        <div data-kind="silent"><dt>Silent</dt><dd>{counts.silent}</dd></div>
        <p className="result-coverage-total">
          of {moments.length} {moments.length === 1 ? "line" : "lines"} in range
        </p>
      </dl>
      <p className="result-attribution">
        <span className="result-attribution-title">Verified range</span>
        <span className="result-attribution-source">
          {rangeClock(rangeStartMs)} to {rangeClock(rangeEndMs)}
        </span>
      </p>
    </div>
  );
}

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
  const learningController = useMemo(
    () => client ? new ProductionLearningController(client) : null,
    [client],
  );
  const prepController = useMemo(
    () => client ? new ProductionLearningPrepController(client) : null,
    [client],
  );
  const [explanation, setExplanation] = useState<LearningExplanationState | null>(null);
  const [fineTuneDraft, setFineTuneDraft] = useState<LearningFineTuneDraft>({ armedLenses: [], temperature: "medium" });
  const [prep, setPrep] = useState<LearningPrepProjection>({ state: "not_requested" });
  const playbackAvailable = playback.state === "available";

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

  useEffect(() => {
    setExplanation(null);
    learningController?.invalidate();
    return () => learningController?.invalidate();
  }, [learningController, playbackAvailable, projectionKey]);

  useEffect(() => {
    setFineTuneDraft({ armedLenses: [], temperature: "medium" });
    setPrep({ state: "not_requested" });
    prepController?.invalidate();
    return () => prepController?.invalidate();
  }, [prepController, projectionKey]);

  const updateFineTune = (next: LearningFineTuneDraft) => {
    setFineTuneDraft(next);
    setPrep({ state: "not_requested" });
    prepController?.invalidate();
  };

  const updatePrep = (retry: boolean) => {
    if (!prepController || sourceProjection.state !== "ready" || fineTuneDraft.armedLenses.length === 0) return;
    const fineTune: LearningFineTuneDraft = {
      armedLenses: [...fineTuneDraft.armedLenses],
      temperature: fineTuneDraft.temperature,
    };
    const prepKey = learningPrepKey(sourceProjection.source, fineTune);
    if (!retry && (prep.state === "loading" || (prep.state === "ready" && prep.prepKey === prepKey))) return;
    if (retry && !(prep.state === "failed" && prep.prepKey === prepKey && prep.retry === "available")) return;
    setPrep({ state: "loading", prepKey, fineTune });
    const input = { runtimeId, source: sourceProjection.source, fineTune };
    const pending = retry ? prepController.retry(input) : prepController.request(input);
    void pending.then((next) => {
      setPrep((current) => current.state !== "not_requested" && current.prepKey === prepKey ? next : current);
    });
  };

  const prepInteraction: LearningPrepInteraction = {
    sourceAuthority: "verified_production_caption",
    draft: fineTuneDraft,
    prep,
    availability: sourceProjection.state === "ready" && sourceProjection.source.context.authorityState !== "unrevoked"
      ? { state: "unavailable", reasonCode: "caption_authority_revoked" }
      : prepController
        ? { state: "available" }
        : { state: "unavailable", reasonCode: "prep_interaction_unavailable" },
    onToggleLens: (lens) => updateFineTune({
      armedLenses: LEARNING_LENS_KINDS.filter((candidate) =>
        candidate === lens
          ? !fineTuneDraft.armedLenses.includes(lens)
          : fineTuneDraft.armedLenses.includes(candidate)),
      temperature: fineTuneDraft.temperature,
    }),
    onTemperature: (temperature) => updateFineTune({ armedLenses: fineTuneDraft.armedLenses, temperature }),
    onPrepare: () => updatePrep(false),
    onRetry: () => updatePrep(true),
  };

  const updateExplanation = (request: LearningSelectionRequest, retry: boolean) => {
    if (!learningController || !playbackAvailable || sourceProjection.state !== "ready") return;
    const requestKey = learningRequestKey(sourceProjection.source, request);
    if (!retry && explanation?.requestKey === requestKey) return;
    if (
      retry &&
      (
        explanation?.requestKey !== requestKey ||
        explanation.state !== "failed" ||
        explanation.retry !== "available"
      )
    ) return;
    setExplanation({ state: "loading", requestKey, request });
    const input = { runtimeId, source: sourceProjection.source, request };
    const pending = retry ? learningController.retry(input) : learningController.request(input);
    void pending.then((next) => {
      setExplanation((current) => current?.requestKey === requestKey ? next : current);
    });
  };

  // Authority loss is never folded behind a disclosure; only identities and receipts are.
  const runDetails = (
    <ChromePanel
      label="Run details"
      icon={<Coverage />}
      panelLabel="Production run details"
      className="result-panel-run"
    >
      <dl className="result-panel-list">
        <div><dt>Projection</dt><dd>Timed KO / EN projection</dd></div>
        <div><dt>Artifact schema</dt><dd>studio.caption-production.artifact.v1</dd></div>
        <div><dt>Authority state</dt><dd>{verification.authorityState}</dd></div>
        <div><dt>Local runtime</dt><dd>{artifact.runId}</dd></div>
        <div><dt>Caption job</dt><dd>{verification.jobId}</dd></div>
        <div><dt>Caption artifact</dt><dd>{verification.captionArtifactId}</dd></div>
        <div><dt>Caption content</dt><dd>{verification.captionContentId}</dd></div>
        <div><dt>Receipt artifact</dt><dd>{verification.receiptArtifactId}</dd></div>
        <div><dt>Receipt</dt><dd>{verification.receiptId}</dd></div>
        <div><dt>Receipt content</dt><dd>{verification.receiptContentId}</dd></div>
        <div><dt>Executor classification</dt><dd>{verification.executor.classification}</dd></div>
      </dl>
    </ChromePanel>
  );

  return (
    <article
      data-production-results-job-id={verification.jobId}
      data-caption-authority-state={verification.authorityState}
      data-caption-integrity={verification.integrity}
    >
      {verification.authorityState === "revoked_after_completion" ? (
        <p role="note">
          Approval was revoked after completion. The already-completed private artifact remains
          visible; the revocation grants no new production authority.
        </p>
      ) : null}
      {sourceProjection.state === "ready" ? (
        <LearningResultExperience
            authority="production_clip"
            chrome={runDetails}
            media={({ modeControls, panelControls }) => (
              loadResult.state === "available" ? (
                <ProductionMediaPlayer
                  binding={loadResult.binding}
                  onPlaybackChange={setPlayback}
                  moments={sourceProjection.source.moments}
                  modeControls={modeControls}
                  panelControls={panelControls}
                />
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
              )
            )}
            mediaMeta={
              <ProductionMediaMeta
                moments={sourceProjection.source.moments}
                rangeStartMs={sourceProjection.source.context.timeline.analysisRange.startMs}
                rangeEndMs={sourceProjection.source.context.timeline.analysisRange.endMs}
              />
            }
            presentation={projectProductionLearningPresentation(sourceProjection.source, {
              playbackAvailable,
              interactionAvailable: learningController !== null,
            })}
            playback={playback}
            learningInteraction={playbackAvailable && learningController ? {
              explanation,
              onRequest: (request) => updateExplanation(request, false),
              onRetry: (request) => updateExplanation(request, true),
            } : undefined}
            prepInteraction={prepInteraction}
          />
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
