import { agentRoleTitle, agentState, agentTitle } from "../agentPresentation";
import { clock } from "../format";
import type { AgentView } from "../replay";
import { useBundle, useStudio } from "../store";
import type { Role, Trace } from "../types";
import Workspace from "../Workspace";

function CoordinationEnvironment({
  note,
  agents,
  statuses,
}: {
  note: string;
  agents: { id: string; role: Role; label: string }[];
  statuses: Record<string, AgentView>;
}) {
  return (
    <div className="coordination-env">
      <section className="coordination-note">
        <span>Current coordination</span>
        <p>{note}</p>
      </section>

      <ol className="coordination-workers" aria-label="Agents in the recorded topology">
        {agents.map((spec) => {
          const worker = statuses[spec.id];
          return (
            <li key={spec.id} data-status={worker?.status ?? "idle"}>
              <span className="coordination-worker-role">{agentRoleTitle(spec.role)}</span>
              <strong>{agentTitle(spec.id, spec.role, spec.label)}</strong>
              <span>{worker ? agentState(worker.status, spec.role) : "Not present yet"}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function AgentEnvironment({
  role,
  agent,
  orchestratorNote,
}: {
  role: Role;
  agent: AgentView | null;
  orchestratorNote: string;
}) {
  const bundle = useBundle();
  const statuses = useStudio((state) => state.state.agents);
  if (!bundle) return null;

  if (role === "orchestrator") {
    return (
      <CoordinationEnvironment
        note={orchestratorNote}
        agents={bundle.run.agents}
        statuses={statuses}
      />
    );
  }

  return agent ? <Workspace agent={agent} scale="cell" /> : null;
}

export default function WorkbenchPanel({
  role,
  agent,
  state,
  log,
  environment,
  orchestratorNote,
}: {
  role: Role;
  agent: AgentView | null;
  state: string;
  log: Trace[];
  environment: { title: string; description: string };
  orchestratorNote: string;
}) {
  const latest = log.at(-1);
  const recent = log.slice(-3).reverse();

  return (
    <section
      id="agent-focus-workbench-panel"
      className="agent-focus-detail-panel agent-focus-workbench"
      role="tabpanel"
      aria-labelledby="agent-focus-workbench-tab"
    >
      <section className="agent-focus-now" aria-label="Current recorded state">
        <header>
          <span>Now</span>
          <strong>{state}</strong>
        </header>
        {latest ? (
          <div className="agent-focus-now-action" data-level={latest.level}>
            <time>{clock(latest.t, true)}</time>
            <strong>{latest.action}</strong>
            {latest.target && <span>{latest.target}</span>}
            {latest.detail && <p>{latest.detail}</p>}
          </div>
        ) : (
          <p className="agent-focus-empty">No recorded action yet.</p>
        )}
      </section>

      <section className="agent-focus-role-projection" aria-label={environment.title}>
        <header>
          <span>Role work</span>
          <div>
            <h4>{environment.title}</h4>
            <p>{environment.description}</p>
          </div>
        </header>
        <AgentEnvironment
          role={role}
          agent={agent}
          orchestratorNote={orchestratorNote}
        />
      </section>

      <section className="agent-focus-recent" aria-label="Recent recorded actions">
        <header>
          <span>Recent history</span>
          <strong>{log.length} action{log.length === 1 ? "" : "s"}</strong>
        </header>
        {recent.length > 0 ? (
          <ol>
            {recent.map((trace, index) => (
              <li key={`${trace.t}-${trace.action}-${index}`} data-level={trace.level}>
                <time>{clock(trace.t, true)}</time>
                <span>{trace.action}</span>
                <p>{trace.detail}</p>
              </li>
            ))}
          </ol>
        ) : (
          <p className="agent-focus-empty">No recorded history yet.</p>
        )}
        <p className="agent-focus-truth-note">
          Recorded actions and reportable detail—not private chain-of-thought.
        </p>
      </section>
    </section>
  );
}
