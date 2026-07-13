import { AnimatePresence } from "motion/react";
import { useEffect } from "react";

import Dock from "./Dock";
import InputAct from "./InputAct";
import RunAct from "./RunAct";
import { replayTransport, useBundle, useStage, useStudio } from "./store";

export default function StudioApp({ runId }: { runId: string }) {
  const boot = useStudio((s) => s.boot);
  const stage = useStage();
  const bundle = useBundle();
  const error = useStudio((s) => s.error);

  useEffect(() => {
    void boot(replayTransport(runId));
  }, [boot, runId]);

  return (
    <main className="studio" data-stage={stage}>
      <header className="top">
        <a className="top-mark" href="/">
          1321
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

        <a className="top-link" href="/benchmarks/">
          Benchmarks
        </a>
      </header>

      <AnimatePresence mode="wait">
        {error ? (
          <section className="act act-input" key="error">
            <p className="prompt-help" data-tone="deny">
              {error}
            </p>
          </section>
        ) : stage === "input" ? (
          <InputAct key="input" />
        ) : (
          <RunAct key="run" />
        )}
      </AnimatePresence>

      <Dock />
    </main>
  );
}
