import { useMemo } from "react";

import { clock } from "../format";
import type { Trace } from "../types";

export default function HistoryPanel({
  title,
  log,
}: {
  title: string;
  log: Trace[];
}) {
  const newestFirst = useMemo(() => [...log].reverse(), [log]);

  return (
    <section
      id="agent-focus-history-panel"
      className="agent-focus-activity"
      role="tabpanel"
      aria-labelledby="agent-focus-history-tab"
    >
      <header className="agent-focus-activity-head">
        <span>Newest first</span>
        <strong>{log.length} action{log.length === 1 ? "" : "s"}</strong>
      </header>

      {newestFirst.length > 0 ? (
        <ol className="agent-focus-log" aria-label={`${title} activity, newest first`}>
          {newestFirst.map((trace, index) => (
            <li
              className="agent-focus-log-row"
              key={`${trace.t}-${trace.action}-${index}`}
              data-level={trace.level}
            >
              <time>{clock(trace.t, true)}</time>
              <span className="agent-focus-log-action">{trace.action}</span>
              {trace.target && <strong>{trace.target}</strong>}
              {trace.detail && <p>{trace.detail}</p>}
            </li>
          ))}
        </ol>
      ) : (
        <p className="agent-focus-empty">No recorded activity yet.</p>
      )}
    </section>
  );
}
