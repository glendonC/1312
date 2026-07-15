import { agentRoleRemit } from "../agentPresentation";
import { clock } from "../format";
import type { AgentView } from "../replay";
import type { Role } from "../types";
import type { RunBundle } from "../transport";

export default function AssignmentPanel({
  selected,
  role,
  agent,
  bundle,
}: {
  selected: string;
  role: Role;
  agent: AgentView | null;
  bundle: RunBundle;
}) {
  const spec = bundle.run.agents.find((candidate) => candidate.id === selected);
  const range = agent?.window ?? spec?.window ?? null;
  const parent = role === "orchestrator" ? "Root coordination" : spec?.parent ?? "Not recorded";

  return (
    <section
      id="agent-focus-assignment-panel"
      className="agent-focus-detail-panel agent-focus-assignment"
      role="tabpanel"
      aria-labelledby="agent-focus-assignment-tab"
    >
      <div className="agent-focus-fact-group">
        <span>Recorded assignment</span>
        <dl className="agent-focus-fact-grid">
          <div>
            <dt>Role remit</dt>
            <dd>{agentRoleRemit(role)}</dd>
          </div>
          <div>
            <dt>Clip scope</dt>
            <dd>{range ? `${clock(range[0])}–${clock(range[1])}` : "Not recorded"}</dd>
          </div>
          <div>
            <dt>Parent agent</dt>
            <dd><code>{parent}</code></dd>
          </div>
          <div>
            <dt>Divided from</dt>
            <dd><code>{spec?.divided_from ?? "Not applicable"}</code></dd>
          </div>
          <div>
            <dt>Source</dt>
            <dd>{bundle.run.clip.title}</dd>
          </div>
          <div>
            <dt>Language path</dt>
            <dd>{bundle.run.pair.source} → {bundle.run.pair.target}</dd>
          </div>
        </dl>
        <p className="agent-focus-truth-note">
          The remit is compatibility presentation copy, not a scheduler-owned objective.
        </p>
      </div>

      <div className="agent-focus-unavailable-group">
        <span>Not recorded in this replay</span>
        <ul>
          <li>Production task objective</li>
          <li>Capability grants and enforced tool scope</li>
          <li>Dependencies and required output contract</li>
          <li>Reserved runtime or tool-call budget</li>
        </ul>
      </div>
    </section>
  );
}
