import { clock } from "../format";
import type { Trace } from "../types";

export default function WorkbenchPanel({
  state,
  log,
}: {
  state: string;
  log: Trace[];
}) {
  const records = [...log].reverse();
  const groups = records.reduce<Array<{ t: number; records: Trace[] }>>((current, trace) => {
    const previous = current.at(-1);
    if (previous?.t === trace.t) {
      previous.records.push(trace);
    } else {
      current.push({ t: trace.t, records: [trace] });
    }
    return current;
  }, []);

  return (
    <section
      id="agent-focus-activity-feed"
      className="agent-focus-activity-feed"
      aria-label="Recorded activity"
    >
      <header className="agent-focus-activity-state">
        <h3>{state}</h3>
      </header>

      {groups.length > 0 ? (
        <ol className="agent-focus-activity-groups" aria-label="Recorded agent events">
          {groups.map((group, groupIndex) => (
            <li className="agent-focus-activity-group" key={`${group.t}-${groupIndex}`}>
              <time>{clock(group.t, true)}</time>
              <ol>
                {group.records.map((trace, recordIndex) => (
                  <li
                    key={`${trace.action}-${recordIndex}`}
                    data-level={trace.level}
                  >
                    <strong>{trace.action}</strong>
                    {trace.target && <code>{trace.target}</code>}
                    {trace.detail && <p>{trace.detail}</p>}
                  </li>
                ))}
              </ol>
            </li>
          ))}
        </ol>
      ) : (
        <p className="agent-focus-empty">No recorded events.</p>
      )}
    </section>
  );
}
