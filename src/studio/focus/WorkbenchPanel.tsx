import { clock, rate } from "../format";
import type { Trace } from "../types";
import {
  activityCounter,
  projectActivityEntry,
  type ActivityEntry,
  type ActivityFacet,
} from "./activityProjection";

/**
 * The recorded activity feed for one focused agent.
 *
 * Each recorded trace is projected into a typed entry (see activityProjection.ts) and rendered by
 * facet, so a draft reads as source -> target with its agreement, a gate reads as a measured value
 * against its limit, a resolved term reads as a gloss — instead of one flat prose line. The header
 * carries a real time/event counter (recorded `t`, never tokens). Only the event list scrolls, so
 * the fade masks in activity.css bite the events, not the heading.
 */
export default function WorkbenchPanel({
  state,
  log,
  active,
}: {
  state: string;
  log: Trace[];
  active: boolean;
}) {
  const records = [...log].reverse();
  const groups = records.reduce<Array<{ t: number; entries: ActivityEntry[] }>>((current, trace) => {
    const entry = projectActivityEntry(trace);
    const previous = current.at(-1);
    if (previous?.t === trace.t) {
      previous.entries.push(entry);
    } else {
      current.push({ t: trace.t, entries: [entry] });
    }
    return current;
  }, []);
  const counter = activityCounter(log);

  return (
    <section
      className="agent-focus-activity-feed"
      aria-label="Recorded activity"
    >
      <header className="agent-focus-activity-head">
        <h3 className={active ? "text-shimmer" : undefined}>{state}</h3>
        {counter && (
          <dl className="agent-focus-activity-counter" aria-label="Recorded activity totals">
            {counter.mediaFromS !== null && counter.mediaToS !== null && (
              <div>
                <dt>Clip</dt>
                <dd>
                  {counter.mediaFromS === counter.mediaToS
                    ? clock(counter.mediaFromS)
                    : `${clock(counter.mediaFromS)}–${clock(counter.mediaToS)}`}
                </dd>
              </div>
            )}
            <div>
              <dt>Events</dt>
              <dd>{counter.events}</dd>
            </div>
          </dl>
        )}
      </header>

      <div className="agent-focus-activity-scroll">
        {groups.length > 0 ? (
          <ol className="agent-focus-activity-groups" aria-label="Recorded agent events">
            {groups.map((group, groupIndex) => (
              <li className="agent-focus-activity-group" key={`${group.t}-${groupIndex}`}>
                <time>{clock(group.t, true)}</time>
                <ol>
                  {group.entries.map((entry, entryIndex) => (
                    <li key={`${entry.action}-${entryIndex}`} data-level={entry.level}>
                      <ActivityRow entry={entry} />
                    </li>
                  ))}
                </ol>
              </li>
            ))}
          </ol>
        ) : (
          <p className="agent-focus-empty">No recorded events.</p>
        )}
      </div>
    </section>
  );
}

function ActivityRow({ entry }: { entry: ActivityEntry }) {
  return (
    <>
      <p className="activity-head">
        <strong>{entry.action}</strong>
        {entry.clipT !== null && (
          <span className="activity-clip" title="Media time">
            {clock(entry.clipT, true)}
          </span>
        )}
      </p>
      {entry.target && <code className="activity-target">{entry.target}</code>}
      {entry.facets.map((facet, facetIndex) => (
        <ActivityFacetView key={`${facet.kind}-${facetIndex}`} facet={facet} />
      ))}
      {entry.detail.chips.length > 0 && (
        <ul className="activity-chips">
          {entry.detail.chips.map((chip, chipIndex) => (
            <li key={`${chip}-${chipIndex}`}>{chip}</li>
          ))}
        </ul>
      )}
      {entry.detail.lines.map((line, lineIndex) => (
        <p className="activity-note" key={`${line}-${lineIndex}`}>{line}</p>
      ))}
    </>
  );
}

function ActivityFacetView({ facet }: { facet: ActivityFacet }) {
  switch (facet.kind) {
    case "gloss":
      return (
        <p className="activity-facet activity-gloss">
          <span className="activity-gloss-term" lang="ko">{facet.term}</span>
          <span className="activity-arrow" aria-hidden="true">→</span>
          <span className="activity-gloss-value">{facet.gloss}</span>
        </p>
      );
    case "draft":
      return (
        <div className="activity-facet activity-draft">
          <p className="activity-draft-line">
            <span className="activity-draft-source" lang="ko">{facet.source}</span>
            <span className="activity-arrow" aria-hidden="true">→</span>
            <span className="activity-draft-target">{facet.target}</span>
          </p>
          <span
            className="activity-draft-agreement"
            data-measurable={facet.agreement !== null}
          >
            {facet.agreement === null
              ? "agreement not measurable"
              : `agreement ${rate(facet.agreement)}`}
          </span>
        </div>
      );
    case "mark":
      return (
        <p className="activity-facet activity-mark" data-hard={facet.hard}>
          {/* The marked cue id already shows as the target, so a hard mark shows only its flag. */}
          {facet.hard
            ? <span className="activity-mark-hard">hard line</span>
            : <span className="activity-mark-label">{facet.label}</span>}
        </p>
      );
    case "gate":
      return (
        <p className="activity-facet activity-gate" data-failed={facet.failed}>
          <span className="activity-gate-name">{facet.name}</span>
          <span className="activity-gate-measure">
            {rate(facet.value)}
            <span className="activity-gate-limit" aria-label={`limit ${rate(facet.limit)}`}>
              {" / "}
              {rate(facet.limit)}
            </span>
          </span>
        </p>
      );
    case "stamp":
      return (
        <p className="activity-facet activity-stamp" data-verdict={facet.verdict}>
          {facet.verdict}
        </p>
      );
  }
}
