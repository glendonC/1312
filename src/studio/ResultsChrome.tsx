// Direct import so Vite invalidates chrome edits without the Studio route barrel.
import "../styles/studio/results.chrome.css";
import RecordedEvidence from "./evidence/RecordedEvidence";
import { Coverage, Info } from "./glyphs";
import { projectResultAccounting } from "./resultAccounting";
import { useBundle, useStudio } from "./store";
import ChromePanel from "./viewer/chromePanel";

/**
 * The completed run's identity: the title, lifted into the studio's floating header centre seat.
 * The Source / Coverage disclosures live in the result workspace's command baseline
 * (ResultsRunPanels), so the header stays mark + title and the workspace commands are the one
 * home for everything a finished run can disclose.
 */
export default function ResultsChrome() {
  const bundle = useBundle();
  if (!bundle) return null;

  return (
    <div className="results-title-seat">
      <p className="result-title-chip" title={bundle.run.clip.title}>
        <span className="result-title-text">{bundle.run.clip.title}</span>
      </p>
    </div>
  );
}

/**
 * The recorded run's two disclosure panels, named for what actually separates them: "Source"
 * (what was processed, and its attribution) and "Coverage" (the per-line accounting and
 * evidence). The recorded-vs-live distinction is never hidden here: the Source panel states the
 * evidence class in full.
 */
export function ResultsRunPanels() {
  const bundle = useBundle();
  const outputDepth = useStudio((s) => s.outputDepth);
  if (!bundle) return null;

  const { run } = bundle;
  const source = run.clip.source;
  const { pair, range, counts, totalLines } = projectResultAccounting(bundle);
  const showEvidence = outputDepth === "evidence";

  return (
    <>
      <ChromePanel
        label="Source"
        icon={<Info />}
        panelLabel="Source and attribution"
        className="result-panel-details"
      >
        <dl className="result-panel-list">
          <div><dt>Title</dt><dd>{run.clip.title}</dd></div>
          <div><dt>Languages</dt><dd>{pair}</dd></div>
          <div><dt>Time range</dt><dd>{range}</dd></div>
          <div>
            <dt>Source</dt>
            <dd>
              {source.url ? (
                <a href={source.url} target="_blank" rel="noreferrer noopener">{source.label}</a>
              ) : source.label}
            </dd>
          </div>
          <div>
            <dt>License</dt>
            <dd>
              {source.licence
                ? source.url
                  ? <a href={source.url} target="_blank" rel="noreferrer noopener">{source.licence}</a>
                  : source.licence
                : "No licence was recorded"}
            </dd>
          </div>
          <div>
            <dt>Evidence</dt>
            <dd className="result-panel-stacked">
              <span>Recorded evidence</span>
              <small>Honest demo replay, not a live run.</small>
            </dd>
          </div>
        </dl>
      </ChromePanel>

      <ChromePanel
        label="Coverage"
        icon={<Coverage />}
        panelLabel="Per-line coverage and evidence"
        className="result-panel-run"
      >
        <p className="result-panel-counts">
          <span>{counts.captioned} captioned</span>
          <span>{counts.withheld} withheld</span>
          <span>{counts.silent} silent</span>
        </p>
        <dl className="result-panel-list">
          <div>
            <dt>Coverage</dt>
            <dd className="result-panel-stacked">
              <span>{counts.captioned} captioned, {counts.withheld} withheld, {counts.silent} silent</span>
              <small>of {totalLines} lines in range</small>
            </dd>
          </div>
          <div>
            <dt>Withheld</dt>
            <dd className="result-panel-stacked">
              <span>Refusals with a recorded reason</span>
              <small>Shown as gaps, not errors or a translation-quality score</small>
            </dd>
          </div>
        </dl>
        {showEvidence && (
          <section className="result-panel-provenance" aria-label="Evidence and run files">
            <RecordedEvidence />
            {run.artifacts.length > 0 ? (
              <p className="result-panel-links">
                {run.artifacts.map((artifact) => (
                  <a key={artifact} href={`/demo/runs/${run.id}/${artifact}`}>{artifact}</a>
                ))}
                <a href={`/demo/packs/${run.pack}.json`}>{run.pack}.json</a>
              </p>
            ) : (
              <p className="result-panel-empty">No artifact links were declared by this run.</p>
            )}
          </section>
        )}
      </ChromePanel>
    </>
  );
}
