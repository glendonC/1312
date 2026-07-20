import { AnimatePresence, motion } from "motion/react";

import Results from "../Results";
import ResultArtifactMark from "../ResultArtifactMark";
import { projectResultAccounting } from "../resultAccounting";
import { ResultsRunPanels } from "../ResultsChrome";
import { useBundle, useResultFace, useStudio } from "../store";
import ResultBrief from "./ResultBrief";

/**
 * The terminal workspace of a completed run, in three faces of one room:
 *
 * "arrival" is the completion moment — a full-veil statement ("Your video has finished
 * processing.") over the result brief, shown once per run; continuing (or Esc) lands on
 * "report". "report" keeps the focus-panel grammar: the gold identity anchor beside a
 * source-titled environment holding the clip preview and the brief, with the Source and
 * Coverage disclosures and the one exit at the command baseline. "watch" hands the whole
 * viewport to the viewer — the clip beside the learning transcript — entered only through the
 * report's Watch & study action and left with Back or Esc.
 *
 * The viewer stays mounted across every face (CSS reshapes the room), so playback position,
 * prep state, pinned explanations, and saved items survive arrival, report, watch, and the
 * round trip through the completed graph. Closing (Esc or the pill) reveals the graph with the
 * golden Result orb, which is the sole way back in; re-entry resumes the last face, never
 * arrival. The evidence class is stated by the Source disclosure and preflight facts, never
 * worn as a label.
 */
export default function ResultWorkspace() {
  const bundle = useBundle();
  const face = useResultFace();
  const setResultFace = useStudio((s) => s.setResultFace);
  const setResultView = useStudio((s) => s.setResultView);
  if (!bundle) return null;

  const { run } = bundle;
  const { pair, range, counts } = projectResultAccounting(bundle);

  return (
    <div className="result-workspace" data-workspace-face={face}>
      {/* The arrival face floats over the (still-hidden) report and exits upward when the
          viewer continues, so the report reveals through the statement rather than after it. */}
      <AnimatePresence>
        {face === "arrival" && (
          <motion.section
            className="result-arrival"
            aria-labelledby="result-arrival-title"
            exit={{ opacity: 0, y: -22, transition: { duration: 0.32, ease: [0.22, 1, 0.36, 1] } }}
          >
            <motion.p
              className="result-arrival-kicker"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
            >
              Run complete
            </motion.p>
            <motion.h2
              id="result-arrival-title"
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.12, ease: [0.22, 1, 0.36, 1] }}
            >
              Your video has finished processing.
            </motion.h2>
            <motion.div
              className="result-arrival-brief"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.34, ease: [0.22, 1, 0.36, 1] }}
            >
              <ResultBrief bundle={bundle} />
            </motion.div>
            <motion.button
              type="button"
              className="result-arrival-continue"
              onClick={() => setResultFace("report")}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.45, delay: 0.58, ease: [0.22, 1, 0.36, 1] }}
            >
              View result
            </motion.button>
          </motion.section>
        )}
      </AnimatePresence>

      {/* The watch room's own bright chrome, on the room rather than the dimmed header beneath it:
          the gold result mark anchors the top-left as the run's identity, and the one exit is a
          squircle at the top-right, its height matched to the mark. Back steps to the report; the
          canvas orb is still the way back in. */}
      {face === "watch" && (
        <>
          <span className="watch-room-mark" aria-hidden="true">
            <ResultArtifactMark />
          </span>
          <button
            type="button"
            className="watch-room-escape"
            onClick={() => setResultFace("report")}
            aria-label="Back to the result report"
          >
            <span className="watch-room-escape-label">Back</span>
            <kbd aria-hidden="true">Esc</kbd>
          </button>
        </>
      )}

      <motion.aside
        className="result-workspace-hero"
        aria-label="Result summary"
        initial={false}
        animate={face === "arrival"
          ? { opacity: 0, x: -24, scale: 0.94 }
          : { opacity: 1, x: 0, scale: 1, transition: { duration: 0.5, delay: 0.08, ease: [0.22, 1, 0.36, 1] } }}
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
              <dd>{range}</dd>
            </div>
            <div className="result-workspace-fact">
              <dt>Lines</dt>
              <dd>
                {counts.captioned} captioned, {counts.withheld} withheld, {counts.silent} silent
              </dd>
            </div>
          </dl>
        </div>
      </motion.aside>

      <motion.div
        className="result-workspace-shell"
        initial={false}
        animate={face === "arrival"
          ? { opacity: 0, y: 16 }
          : { opacity: 1, y: 0, transition: { duration: 0.5, delay: 0.16, ease: [0.22, 1, 0.36, 1] } }}
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
            <Results />
            {/* The report's reading column: the run accounted for in sentences, with the study
                room's door beneath it. Hidden in the watch face, where the transcript takes
                this side of the room. */}
            <aside className="result-brief-rail" aria-label="Result breakdown">
              <ResultBrief bundle={bundle} />
              <button
                type="button"
                className="result-watch-entry"
                onClick={() => setResultFace("watch")}
              >
                Watch &amp; study
              </button>
            </aside>
          </div>

          <span className="result-workspace-stage-rule" data-edge="bottom" aria-hidden="true" />
        </section>

        {/* The focus-panel command baseline belongs to the report: Source and Coverage beside the
            one exit to the completed graph. The watch room commands from its own bottom bar and
            exits through the top-right Back, so this baseline stands down there. No view switch —
            the golden Result node on the canvas is the way back in. */}
        {face !== "watch" && (
          <nav className="result-workspace-commands" aria-label="Result commands">
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
        )}
      </motion.div>
    </div>
  );
}
