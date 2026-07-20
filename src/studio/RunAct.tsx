import { motion } from "motion/react";
import { useEffect } from "react";

import AgentPanel from "./AgentPanel";
import { useComplete, useResultView, useStudio } from "./store";
import SwarmGraph from "./SwarmGraph";
import { AuthorityBadge } from "./viewer/ResultViewerShell";
import ResultWorkspace from "./viewer/ResultWorkspace";

export default function RunAct() {
  const complete = useComplete();
  const focused = useStudio((state) => state.selected !== null);
  const resultView = useResultView();
  const setResultView = useStudio((state) => state.setResultView);

  // Esc steps back from the open result workspace to the completed world under it. Deliberately
  // the last Escape listener in line: every layer inside the workspace (drawers, pinned panels,
  // popovers) prevents default when it consumes the key, and browser fullscreen owns Esc outright,
  // so this fires only when there is nothing left to close but the workspace itself.
  useEffect(() => {
    if (!complete || resultView !== "result") return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (document.fullscreenElement) return;
      setResultView("process");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [complete, resultView, setResultView]);

  // One persistent world. The stage never unmounts across completion: the run's swarm settles in
  // place, the golden result artifact forms at the terminus, and the result workspace opens OVER
  // the canvas rather than replacing it. Result/Process is the open/close of that terminal
  // workspace — same store state machine, two projections of one finished run.
  return (
    <motion.section
      className={complete ? "act act-run act-results" : "act act-run"}
      data-result-view={complete ? resultView : undefined}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
    >
      <div
        className={complete ? "stage stage-complete" : "stage"}
        data-agent-focus={focused ? "true" : undefined}
        aria-label={complete ? "Completed process graph" : undefined}
      >
        <SwarmGraph />
        <AgentPanel />
      </div>

      {complete && (
        <>
          {/* The workspace stays mounted while the completed graph is open: playback position,
              viewer mode, pinned explanations, saved items, and prep state all survive the
              round trip. The orb is the re-entry anchor, never a gate — there is no switch;
              opening and closing the workspace IS the only run-level navigation. */}
          <div className="act-results-viewer" hidden={resultView === "process"}>
            <ResultWorkspace />
          </div>
          {/* The open graph is never on screen without its recorded-evidence framing. A passive
              chip, not a toolbar: the one control on this view is the golden Result node itself. */}
          {resultView === "process" && (
            <div className="run-evidence-chip" data-agent-focus={focused ? "true" : undefined}>
              <AuthorityBadge authority="recorded_demo" />
              <p className="run-action-note">Recorded evidence · completed process graph</p>
            </div>
          )}
        </>
      )}
    </motion.section>
  );
}
