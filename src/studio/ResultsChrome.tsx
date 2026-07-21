// Direct import so Vite invalidates chrome edits without the Studio route barrel.
import "../styles/studio/results.chrome.css";
import { clock, signed } from "./format";
import { Info, Method } from "./glyphs";
import { projectResultAccounting } from "./resultAccounting";
import { projectTechnicalRecord } from "./resultTechnicalRecord";
import type { MediaProbeTrack } from "./types";
import { useBundle, useStudio } from "./store";
import type { RunBundle } from "./transport";
import ChromePanel from "./viewer/chromePanel";

/**
 * The completed run's identity: the title, lifted into the studio's floating header centre seat.
 * The Source / Method disclosures live in the result workspace's command baseline
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
 * The recorded run's disclosure panels, named for what actually separates them: "Source" (what
 * was processed, and its attribution) and — at evidence depth only — "Method" (the one
 * technical record: per-line accounting, measured process, media identity, honest scoring
 * state, and the run files). The recorded-vs-live distinction is never hidden here: the Source
 * panel states the evidence class in full, and the Method panel labels replay as replay.
 */
export function ResultsRunPanels() {
  const bundle = useBundle();
  const outputDepth = useStudio((s) => s.outputDepth);
  if (!bundle) return null;

  return (
    <>
      <ChromePanel
        label="Source"
        icon={<Info />}
        panelLabel="Source and attribution"
        className="result-panel-details"
      >
        <SourcePanelBody bundle={bundle} />
      </ChromePanel>

      {outputDepth === "evidence" && (
        <ChromePanel
          label="Method"
          icon={<Method />}
          panelLabel="Method and technical record"
          className="result-panel-method"
        >
          <MethodPanelBody bundle={bundle} />
        </ChromePanel>
      )}
    </>
  );
}

/** What was processed and its attribution, projected from the run for the Source disclosure. */
function SourcePanelBody({ bundle }: { bundle: RunBundle }) {
  const { run } = bundle;
  const source = run.clip.source;
  const { pair, range } = projectResultAccounting(bundle);

  return (
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
        <dd>
          Recorded evidence
          <small>Honest demo replay, not a live run.</small>
        </dd>
      </div>
    </dl>
  );
}

/**
 * The one technical record of how the run processed and checked the clip, projected from typed
 * bundle fields only. Scoring stays honest: without gold the panel says so instead of turning
 * coverage or latency into a quality claim, and the recorded worker count is a manifest fact,
 * never reconstructed lineage.
 */
function MethodPanelBody({ bundle }: { bundle: RunBundle }) {
  const { run } = bundle;
  const { wallS, recordedWorkers, gates, corroboration, media, sourceWindow, proof, conveyor } =
    projectTechnicalRecord(bundle);
  const { counts, totalLines } = projectResultAccounting(bundle);
  const committed = corroboration.measured + corroboration.unmeasurable + corroboration.unchecked;

  return (
    <>
      <dl className="result-panel-list">
        <div><dt>Wall clock</dt><dd>{clock(wallS)}</dd></div>
        {proof.timeToUsableS !== null && (
          <div><dt>First line</dt><dd>{clock(proof.timeToUsableS)}</dd></div>
        )}
        <div>
          <dt>Workers</dt>
          <dd>
            {recordedWorkers} recorded
            <small>Replay animates them; it does not re-run them.</small>
          </dd>
        </div>
        <div>
          <dt>Gates</dt>
          <dd>
            {gates.checks} checks, {gates.failed} failed
            {gates.names.length > 0 && (
              <small className="result-panel-idents">
                {gates.names.map((name) => <code key={name}>{name}</code>)}
              </small>
            )}
          </dd>
        </div>
        <div>
          <dt>Cross-check</dt>
          <dd>
            {corroboration.checkers.length > 0
              ? `${corroboration.measured} of ${committed} lines`
              : "No second recogniser"}
            {corroboration.checkers.length > 0 && (
              <small>
                Checked against {corroboration.checkers.join(", ")}.
                {corroboration.unmeasurable > 0 &&
                  ` ${corroboration.unmeasurable} committed when the checker heard nothing to compare.`}
                {corroboration.unchecked > 0 &&
                  ` ${corroboration.unchecked} committed with no cross-check record.`}
              </small>
            )}
          </dd>
        </div>
        <div>
          <dt>Lines</dt>
          <dd>
            {counts.captioned} captioned, {counts.withheld} withheld, {counts.silent} silent
            <small>
              Of {totalLines} lines in range. Withheld lines are refusals with a recorded
              reason, shown as gaps.
            </small>
          </dd>
        </div>
      </dl>

      <dl className="result-panel-list result-panel-divide">
        <div>
          <dt>Identity</dt>
          {media ? (
            <dd>
              <code className="result-panel-hash" title={media.contentId}>
                {shortContentId(media.contentId)}
              </code>
              <small>{megabytes(media.bytes)}, {clock(media.durationS)}, measured by ffprobe.</small>
            </dd>
          ) : (
            <dd>No probe receipt was recorded</dd>
          )}
        </div>
        {media && media.tracks.length > 0 && (
          <div>
            <dt>Tracks</dt>
            <dd>{media.tracks.map(describeTrack).join(", ")}</dd>
          </div>
        )}
        {sourceWindow && (
          <div>
            <dt>Source window</dt>
            <dd>
              {sourceWindow.kind === "provider_timestamps"
                ? `${sourceWindow.start}–${sourceWindow.end}`
                : `${clock(sourceWindow.startS)}–${clock(sourceWindow.endS)}`}
              <small>The window cut from the original source.</small>
            </dd>
          </div>
        )}
      </dl>

      <dl className="result-panel-list result-panel-divide">
        <div>
          <dt>Accuracy</dt>
          <dd>
            {proof.deltaVsCold === null ? "Not scored" : `${signed(proof.deltaVsCold)} vs cold one-shot`}
            <small>
              {proof.deltaVsCold === null
                ? "No gold exists for this clip. Coverage and timing measure what the run did, not whether it was right."
                : "Scored against gold in the benchmark lane."}
            </small>
          </dd>
        </div>
        <div>
          <dt>Feeds back</dt>
          <dd>
            {conveyor.glossaryTerms} glossary terms, {conveyor.correctionRows} correction rows
            <small>{DISPOSITION_COPY[conveyor.glossaryDisposition]} Pack {conveyor.pack}.</small>
          </dd>
        </div>
        <div>
          <dt>Files</dt>
          {run.artifacts.length > 0 ? (
            <dd>
              <span className="result-panel-links">
                {run.artifacts.map((artifact) => (
                  <a key={artifact} href={`/demo/runs/${run.id}/${artifact}`}>{artifact}</a>
                ))}
                <a href={`/demo/packs/${run.pack}.json`}>{run.pack}.json</a>
                {bundle.evidence && (
                  <a href={`/demo/runs/${run.id}/evidence.json`}>evidence.json</a>
                )}
              </span>
              <small>
                {bundle.evidence
                  ? `${bundle.evidence.artifacts.length} artifacts hashed and indexed after the run; byte identity, not reconstructed lineage.`
                  : "Declared by the run manifest."}
              </small>
            </dd>
          ) : (
            <dd>No artifact links were declared by this run</dd>
          )}
        </div>
      </dl>
    </>
  );
}

const DISPOSITION_COPY = {
  promoted: "Glossary promoted to the cross-run glossary.",
  pending_review: "Glossary proposed for review; nothing promotes itself.",
  bench_only: "Glossary bench-only; kept out of cross-run memory.",
  run_scoped: "Glossary run-scoped; not promoted.",
} as const;

/** First and last hash characters with the algorithm prefix; the full identity sits in @title. */
function shortContentId(contentId: string): string {
  const [algorithm, digest] = contentId.split(":");
  if (!digest || digest.length <= 20) return contentId;
  return `${algorithm}:${digest.slice(0, 12)}…${digest.slice(-8)}`;
}

function megabytes(bytes: number): string {
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

function describeTrack(track: MediaProbeTrack): string {
  if (track.type === "video" && track.width && track.height) {
    return `${track.codec} ${track.width}×${track.height}`;
  }
  if (track.type === "audio" && track.sample_rate) {
    const channels =
      track.channels === 1 ? "mono" : track.channels === 2 ? "stereo" : track.channels ? `${track.channels} channels` : "";
    return [track.codec, `${track.sample_rate / 1000} kHz`, channels].filter(Boolean).join(" ");
  }
  return track.codec;
}
