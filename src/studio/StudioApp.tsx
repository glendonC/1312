import { AnimatePresence, MotionConfig } from "motion/react";
import { lazy, Suspense, useEffect, useState } from "react";

import Dock from "./Dock";
import InputAct from "./InputAct";
import { presentRecordedSource } from "./previewSession";
import ResultsChrome from "./ResultsChrome";
import RunAct from "./RunAct";
import SourceDisplay from "./SourceDisplay";
import { replayTransport, useBundle, useComplete, usePaused, useResultView, useStage, useStudio } from "./store";
import useShortcuts from "./useShortcuts";

const DevLab = import.meta.env.DEV ? lazy(() => import("./lab/Lab")) : null;

export default function StudioApp({ runId }: { runId: string }) {
  const boot = useStudio((s) => s.boot);
  const stage = useStage();
  const bundle = useBundle();
  const complete = useComplete();
  const resultView = useResultView();
  const paused = usePaused();
  const [lab, setLab] = useState(false);
  const resultOpen = complete && resultView === "result";

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
      <header className="top" inert={resultOpen ? true : undefined}>
        <a className="top-mark" href="/" aria-label="1321 home">
          <img src="/favicon.svg" alt="" width="30" height="30" />
        </a>

        {bundle && stage !== "input" && !complete && recordedSource && (
          <div className="top-source">
            <div
              className="top-mid"
              role="group"
              aria-label={`Source: ${recordedSource.accessibleName}`}
            >
              <SourceDisplay
                source={recordedSource}
                title={recordedSource.displayUrl}
              />
            </div>
          </div>
        )}

        {/*
         * On a completed run the header carries only the result's identity: the title in the
         * centre seat. Every run-level action, including Details and Run details, lives in the
         * floating run action bar. While a run is still going the centre seat stays empty.
         */}
        {complete && <ResultsChrome />}
      </header>

      <AnimatePresence mode="wait">
        {stage === "input" ? (
          <InputAct key="input" />
        ) : (
          <RunAct key="run" />
        )}
      </AnimatePresence>

      {/* The run's global bar stays through completion on the process graph — status updates to Done
          with Open Results and Clear — and stands down only when the result workspace is open, where
          the watch room owns the bottom bar. */}
      {stage === "run" && (!complete || resultView === "process") && <Dock />}
      {lab && DevLab && (
        <div className="studio-lab-host" inert={resultOpen ? true : undefined}>
          <Suspense fallback={null}>
            <DevLab defaultRunId={runId} />
          </Suspense>
        </div>
      )}
      </main>
    </MotionConfig>
  );
}
