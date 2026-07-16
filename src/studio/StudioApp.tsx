import { AnimatePresence, MotionConfig } from "motion/react";
import { lazy, Suspense, useEffect, useState } from "react";

import Dock from "./Dock";
import InputAct from "./InputAct";
import { presentRecordedSource } from "./previewSession";
import RunAct from "./RunAct";
import SourceDisplay from "./SourceDisplay";
import { replayTransport, useBundle, usePaused, useStage, useStudio } from "./store";
import useShortcuts from "./useShortcuts";

const DevLab = import.meta.env.DEV ? lazy(() => import("./lab/Lab")) : null;

export default function StudioApp({ runId }: { runId: string }) {
  const boot = useStudio((s) => s.boot);
  const stage = useStage();
  const bundle = useBundle();
  const paused = usePaused();
  const previewSession = useStudio((s) => s.previewSession);
  const [lab, setLab] = useState(false);

  useShortcuts();

  useEffect(() => {
    void boot(replayTransport(runId));
  }, [boot, runId]);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    setLab(new URLSearchParams(window.location.search).get("lab") === "1");
  }, []);

  const recordedSource = bundle
    ? presentRecordedSource(bundle.run.clip.source, bundle.ingestReceipt)
    : null;
  const visibleSource = previewSession?.source ?? recordedSource;
  const submittedPreparation = previewSession?.preparation.status === "ready"
    ? previewSession.preparation.request
    : null;

  // Held is a property of the whole instrument, not of one control: everything that
  // animates to say "alive" reads this and stops.
  return (
    <MotionConfig reducedMotion="user">
      <main className="studio" data-stage={stage} data-paused={paused}>
      {/*
       * The header floats ON the canvas rather than sitting in a row above it. It used to be
       * a 56px grid track, which meant the canvas — the one thing on this screen that is
       * supposed to be endless — stopped short of the top edge of the window. Everything up
       * here is an overlay now, and the canvas runs under all of it.
       */}
      <header className="top">
        <a className="top-mark" href="/" aria-label="1321 home">
          <img src="/favicon.svg" alt="" width="30" height="30" />
        </a>

        {bundle && stage !== "input" && visibleSource && (
          <div className="top-source">
            <div
              className="top-mid"
              role="group"
              aria-label={`Source: ${visibleSource.accessibleName}`}
              aria-describedby={previewSession ? "top-source-provenance" : undefined}
            >
              <SourceDisplay
                source={visibleSource}
                title={previewSession?.source.raw ?? visibleSource.displayUrl}
              />
            </div>
            {previewSession && (
              <p
                id="top-source-provenance"
                className="top-source-provenance"
                role="note"
                data-submitted-preparation-request-id={submittedPreparation?.requestId}
              >
                This interface preview uses a recorded run. Your source was not processed.
                {submittedPreparation && " Its preparation request did not start a runtime."}
              </p>
            )}
          </div>
        )}

        {/*
         * Nothing in the third seat.
         *
         * A permanent link out of the instrument does not earn the loudest corner of the
         * canvas — and the studio already offers the bench at the only moment it means
         * anything, in Results, underneath the scores it is asking you to compare. The mark
         * is the way home. That is enough of an exit.
         */}
      </header>

      <AnimatePresence mode="wait">
        {stage === "input" ? (
          <InputAct key="input" />
        ) : (
          <RunAct key="run" />
        )}
      </AnimatePresence>

      {stage === "run" && <Dock />}
      {lab && DevLab && (
        <Suspense fallback={null}>
          <DevLab defaultRunId={runId} />
        </Suspense>
      )}
      </main>
    </MotionConfig>
  );
}
