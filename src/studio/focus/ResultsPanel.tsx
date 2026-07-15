import type { AgentView } from "../replay";
import type { Role, Trace } from "../types";

export default function ResultsPanel({
  role,
  agent,
  log,
  orchestratorNote,
}: {
  role: Role;
  agent: AgentView | null;
  log: Trace[];
  orchestratorNote: string;
}) {
  const mediaReferences = log.filter((trace) => typeof trace.clip_t === "number").length;
  const flaggedActions = log.filter(
    (trace) => trace.level === "warn" || trace.level === "error",
  ).length;

  return (
    <section
      id="agent-focus-results-panel"
      className="agent-focus-detail-panel agent-focus-results"
      role="tabpanel"
      aria-labelledby="agent-focus-results-tab"
    >
      <div className="agent-focus-recorded-output">
        <span>Recorded result projection</span>
        {role === "orchestrator" && <p>{orchestratorNote}</p>}
        {role === "segment" && (
          agent && agent.marks.length > 0
            ? <ul>{agent.marks.map((mark, index) => <li key={`${mark.label}-${index}`}>{mark.label}</li>)}</ul>
            : <p>No recorded marks yet.</p>
        )}
        {role === "context" && (
          agent && agent.gloss.length > 0
            ? <dl>{agent.gloss.map((entry, index) => (
              <div key={`${entry.term}-${index}`}><dt>{entry.term}</dt><dd>{entry.gloss}</dd></div>
            ))}</dl>
            : <p>No recorded term resolutions yet.</p>
        )}
        {role === "translate" && (
          agent?.draft
            ? <div className="agent-focus-result-draft"><p>{agent.draft.source}</p><strong>{agent.draft.target}</strong></div>
            : <p>No recorded draft yet.</p>
        )}
        {role === "qc" && (
          agent && (agent.gates.length > 0 || agent.stamp)
            ? (
              <div className="agent-focus-result-gates">
                <ul>{agent.gates.map((gate, index) => (
                  <li key={`${gate.name}-${index}`} data-fail={gate.fail}>
                    <span>{gate.name}</span>
                    <strong>{gate.value.toFixed(2)} / {gate.limit.toFixed(2)}</strong>
                  </li>
                ))}</ul>
                {agent.stamp && <strong className="agent-focus-result-stamp">{agent.stamp.text}</strong>}
              </div>
            )
            : <p>No recorded gate result yet.</p>
        )}
      </div>

      <dl className="agent-focus-measures" aria-label="Recorded activity measures">
        <div><dt>Actions</dt><dd>{log.length}</dd></div>
        <div><dt>Media-linked</dt><dd>{mediaReferences}</dd></div>
        <div><dt>Warnings / errors</dt><dd>{flaggedActions}</dd></div>
        <div><dt>Gate events</dt><dd>{log.filter((trace) => trace.level === "gate").length}</dd></div>
      </dl>

      <div className="agent-focus-unavailable-group">
        <span>Production result fields unavailable</span>
        <p>Agent-owned artifacts, handoff acceptance, measured execution duration, and usage were not recorded in this legacy replay.</p>
      </div>
    </section>
  );
}
