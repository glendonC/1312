import { AnimatePresence, MotionConfig } from "motion/react";
import { useEffect } from "react";

import Dock from "./Dock";
import InputAct from "./InputAct";
import RunAct from "./RunAct";
import { replayTransport, useBundle, usePaused, useStage, useStudio } from "./store";
import useShortcuts from "./useShortcuts";

export default function StudioApp({ runId }: { runId: string }) {
  const boot = useStudio((s) => s.boot);
  const stage = useStage();
  const bundle = useBundle();
  const paused = usePaused();

  useShortcuts();

  useEffect(() => {
    void boot(replayTransport(runId));
  }, [boot, runId]);

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

        <div className="top-mid">
          {bundle && stage !== "input" && (
            <>
              <span className="top-clip">{bundle.run.clip.title_target}</span>
              <span className="top-pair">
                {bundle.run.pair.source} &rarr; {bundle.run.pair.target} · {bundle.run.pack}
              </span>
            </>
          )}
        </div>

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

      <Dock />
      </main>
    </MotionConfig>
  );
}
