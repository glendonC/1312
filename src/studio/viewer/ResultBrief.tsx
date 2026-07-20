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
 */
export default function ResultBrief({ bundle }: { bundle: RunBundle }) {
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
            {counts.withheld === 1 ? "was" : "were"} held back instead of guessed — each line
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
            , shared under its <Value palette="coral">{source.licence}</Value>
          </>
        ) : null}
        .
      </p>
    </div>
  );
}
