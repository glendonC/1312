import { motion } from "motion/react";
import { useState } from "react";

import { clock } from "../format";
import Results from "../Results";
import ResultArtifactMark from "../ResultArtifactMark";
import { ResultsRunPanels } from "../ResultsChrome";
import { useBundle, useStudio } from "../store";
import { ResultCommandSeat } from "./resultCommandSeat";

/**
 * The terminal workspace of a completed run, composed EXACTLY like an agent focus panel: the
 * world dims and blurs beneath, an identity anchor holds the left column, and the workspace
 * shell on the right carries a source-titled environment between two stage rules with the
 * command baseline underneath. Same spatial grammar, same geometry — the run's result is one
 * more inhabitant of the focus idiom, not a separate screen with its own rules.
 *
 * Where an agent's anchor narrates lineage and remit, the artifact's anchor accounts for what
 * the run actually produced — language pair, range, per-line coverage, and the evidence class —
 * every value read from the bundle. The environment houses the unchanged
 * LearningResultExperience (selectable transcript, pinned explanations, Saved, Tune, viewing
 * modes all intact); the commands hold the Source and Coverage disclosures and the one exit.
 * Closing (Esc or the pill) reveals the completed graph with the golden Result orb, which is the
 * sole way back in.
 */
export default function ResultWorkspace() {
  const bundle = useBundle();
  const setResultView = useStudio((s) => s.setResultView);
  // The command baseline's seat for the learning toggles: state (not a ref) so providing it
  // re-renders the workspace tree and the portal lands once the element exists.
  const [commandSeat, setCommandSeat] = useState<HTMLElement | null>(null);
  if (!bundle) return null;

  const { run, captions } = bundle;
  const pair = `${run.pair.source.toUpperCase()} → ${run.pair.target.toUpperCase()}`;

  const counts = { captioned: 0, withheld: 0, silent: 0 };
  for (const cue of captions.cues) {
    if (cue.silence) {
      counts.silent += 1;
      continue;
    }
    const target = cue.targets.find((t) => t.lang === run.pair.target);
    if (target?.withheld) counts.withheld += 1;
    else if (target?.text) counts.captioned += 1;
  }

  return (
    <div className="result-workspace">
      <motion.aside
        className="result-workspace-hero"
        aria-label="Result summary"
        initial={{ opacity: 0, x: -24, scale: 0.94 }}
        animate={{ opacity: 1, x: 0, scale: 1 }}
        transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
      >
        <div className="result-workspace-identity">
          <ResultArtifactMark />
        </div>
        <div className="result-workspace-hero-copy">
          <p className="result-workspace-state">Run complete</p>
          <span className="result-workspace-material-rule" aria-hidden="true" />
          <h2>Result</h2>
          <span className="result-workspace-nameplate-rule" aria-hidden="true" />
          <p className="result-workspace-remit">
            Timed {pair} captions with per-line accounting.
          </p>
          <dl className="result-workspace-facts" aria-label="Artifact accounting">
            <div className="result-workspace-fact">
              <dt>Languages</dt>
              <dd>{pair}</dd>
            </div>
            <div className="result-workspace-fact">
              <dt>Range</dt>
              <dd>
                {clock(0)}–{clock(run.clip.duration)}
              </dd>
            </div>
            <div className="result-workspace-fact">
              <dt>Lines</dt>
              <dd>
                {counts.captioned} captioned, {counts.withheld} withheld, {counts.silent} silent
              </dd>
            </div>
            <div className="result-workspace-fact">
              <dt>Evidence</dt>
              <dd>Recorded demo</dd>
            </div>
          </dl>
        </div>
      </motion.aside>

      <motion.div
        className="result-workspace-shell"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
      >
        <section
          className="result-workspace-environment"
          aria-labelledby="result-workspace-source-title"
        >
          <header className="result-workspace-source-head">
            <h3 id="result-workspace-source-title">{run.clip.title}</h3>
          </header>

          <span className="result-workspace-stage-rule" data-edge="top" aria-hidden="true" />

          <div className="result-workspace-body">
            <ResultCommandSeat.Provider value={commandSeat}>
              <Results />
            </ResultCommandSeat.Provider>
          </div>

          <span className="result-workspace-stage-rule" data-edge="bottom" aria-hidden="true" />
        </section>

        {/* The focus-panel command baseline: the learning toggles (Saved / Tune, portalled in by
            the workspace they control), the Source and Coverage disclosures, and the one exit.
            No view switch — the golden Result node on the canvas is the way back in. */}
        <nav className="result-workspace-commands" aria-label="Result commands">
          <div className="result-workspace-command-group" ref={setCommandSeat} />
          <div className="result-workspace-command-group">
            <ResultsRunPanels />
          </div>
          <button
            type="button"
            className="result-workspace-escape"
            onClick={() => setResultView("process")}
            aria-label="Close the result and show the completed process graph"
          >
            <span className="result-workspace-escape-label">Close</span>
            <kbd aria-hidden="true">Esc</kbd>
          </button>
        </nav>
      </motion.div>
    </div>
  );
}
