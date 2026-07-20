import type { ReactNode } from "react";

import { languageName } from "../preflight/preparationKit";
import { projectResultAccounting } from "../resultAccounting";
import type { RunBundle } from "../transport";

/**
 * A parameter value inside the brief's prose, tinted with the same stage palette the
 * preparation conversation used to ask for it: source facts coral, range citron, languages
 * blue, coverage lilac. The completion answers in the colors of the request.
 */
function Value({ palette, children }: { palette: string; children: ReactNode }) {
  return (
    <span className="result-brief-value" data-palette={palette}>
      {children}
    </span>
  );
}

/**
 * The finished run, accounted for in sentences: the terminal mirror of the preflight's
 * conversational stages. Every value is read from the bundle through the shared accounting
 * projection — the brief has no numbers or names of its own.
 *
 * The `detailed` variant is the watch room's Details tab: the same prose plus the honest evidence
 * class and, at evidence depth, the run's declared files. It is what the report's separate Source
 * and Coverage disclosures say, folded into one plain-language read.
 */
export default function ResultBrief({
  bundle,
  detailed = false,
  showEvidence = false,
}: {
  bundle: RunBundle;
  detailed?: boolean;
  /** Evidence depth only: append the run's declared artifact files. Ignored unless `detailed`. */
  showEvidence?: boolean;
}) {
  const { run } = bundle;
  const { range, counts, totalLines } = projectResultAccounting(bundle);
  const source = run.clip.source;

  return (
    <div className="result-brief">
      <p>
        I prepared <Value palette="citron">{range}</Value> of{" "}
        <Value palette="blue">{languageName(run.pair.source)}</Value> speech from{" "}
        {source.url ? (
          <a
            className="result-brief-value result-brief-source"
            data-palette="coral"
            href={source.url}
            target="_blank"
            rel="noreferrer noopener"
          >
            {run.clip.title}
          </a>
        ) : (
          <Value palette="coral">{run.clip.title}</Value>
        )}{" "}
        as timed <Value palette="blue">{languageName(run.pair.target)}</Value> captions.
      </p>
      <p>
        <Value palette="lilac">
          {counts.captioned} of its {totalLines} lines
        </Value>{" "}
        have captions.
        {counts.withheld > 0 && (
          <>
            {" "}
            <Value palette="lilac">{counts.withheld}</Value>{" "}
            {counts.withheld === 1 ? "was" : "were"} held back instead of guessed; each line
            shows why.
          </>
        )}
        {counts.silent > 0 && (
          <>
            {" "}
            <Value palette="lilac">{counts.silent}</Value>{" "}
            {counts.silent === 1 ? "is" : "are"} silence, with nothing to caption.
          </>
        )}
      </p>
      <p>
        The source is <Value palette="coral">{source.label}</Value>
        {source.licence ? (
          <>
            , shared under its{" "}
            {source.url ? (
              <a
                className="result-brief-value"
                data-palette="coral"
                href={source.url}
                target="_blank"
                rel="noreferrer noopener"
              >
                {source.licence}
              </a>
            ) : (
              <Value palette="coral">{source.licence}</Value>
            )}
          </>
        ) : null}
        .
      </p>
      {detailed && (
        <>
          <p>
            This is <Value palette="coral">recorded evidence</Value>: an honest demo replay, not a
            live run. Its language decisions are shown as they were recorded, never scored.
          </p>
          {showEvidence && run.artifacts.length > 0 && (
            <p className="result-brief-files">
              The run’s files:{" "}
              {run.artifacts.map((artifact, index) => (
                <span key={artifact}>
                  {index > 0 && ", "}
                  <a href={`/demo/runs/${run.id}/${artifact}`}>{artifact}</a>
                </span>
              ))}
              , and <a href={`/demo/packs/${run.pack}.json`}>{run.pack}.json</a>.
            </p>
          )}
        </>
      )}
    </div>
  );
}
