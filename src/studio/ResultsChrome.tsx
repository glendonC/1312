import { useEffect, useRef, useState, type ReactNode } from "react";

import RecordedEvidence from "./evidence/RecordedEvidence";
import { clock } from "./format";
import { Chevron, Coverage, Info } from "./glyphs";
import { useBundle, useStudio } from "./store";

/**
 * The completed run's identity and accounting, lifted into the studio's floating header so it sits in
 * the true top-right corner, aligned with the home mark, instead of crowding the viewer. Two glass
 * controls open on demand: "Details" (what this run is, and its attribution) and "Run details" (the
 * per-line accounting and evidence). The recorded-vs-live distinction is never hidden here: the frame
 * carries an always-on "recorded" bug, and the Details panel states the evidence class in full.
 */
export default function ResultsChrome() {
  const bundle = useBundle();
  const outputDepth = useStudio((s) => s.outputDepth);
  if (!bundle) return null;

  const { run, captions } = bundle;
  const source = run.clip.source;
  const pair = `${run.pair.source.toUpperCase()} → ${run.pair.target.toUpperCase()}`;
  const range = `${clock(0)}–${clock(run.clip.duration)}`;
  const showEvidence = outputDepth === "evidence";

  const counts = { captioned: 0, withheld: 0, silent: 0 };
  for (const cue of captions.cues) {
    if (cue.silence) {
      counts.silent += 1;
      continue;
    }
    const tgt = cue.targets.find((t) => t.lang === run.pair.target);
    if (tgt?.withheld) counts.withheld += 1;
    else if (tgt?.text) counts.captioned += 1;
  }

  return (
    <>
      <div className="results-title-seat">
        <p className="result-title-chip" title={run.clip.title}>
          <span className="result-title-text">{run.clip.title}</span>
        </p>
      </div>
      <div className="results-control-seat">
        <ChromePanel
          label="Details"
          icon={<Info />}
          panelLabel="Run details and attribution"
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
                  : "Recorded evidence"}
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
          label="Run details"
          icon={<Coverage />}
          panelLabel="Per-line run accounting"
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
                <small>of {captions.cues.length} lines in range</small>
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
      </div>
    </>
  );
}

function ChromePanel({
  label,
  icon,
  panelLabel,
  className,
  children,
}: {
  label: string;
  icon: ReactNode;
  panelLabel: string;
  className?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    panel.current?.focus();
    const closeOutside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [open]);

  const close = (): void => {
    setOpen(false);
    trigger.current?.focus();
  };

  return (
    <div
      className="result-chrome-control"
      ref={root}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <button
        ref={trigger}
        type="button"
        className="result-chrome-trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="result-chrome-icon" aria-hidden="true">{icon}</span>
        <span className="result-chrome-label">{label}</span>
        <span className="result-chrome-caret" aria-hidden="true"><Chevron /></span>
      </button>
      <div
        className={`result-chrome-panel${className ? ` ${className}` : ""}`}
        ref={panel}
        role="dialog"
        aria-label={panelLabel}
        tabIndex={-1}
        hidden={!open}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            close();
          }
        }}
      >
        {children}
      </div>
    </div>
  );
}
