import AgentMark from "./AgentMark";
import { createAgentIdentity, type AgentIdentity } from "./agentIdentity";

/**
 * The result's one visual identity: the same generative field material every agent carries,
 * struck in gold. It appears exactly twice — as the terminus node on the completed canvas and as
 * the identity anchor of the result workspace — and it is the same mark in both places, so the
 * orb on the graph and the workspace it opens read as one object.
 *
 * The identity is built through the agent identity system (confluence topology, deterministic
 * geometry) and then given the one palette no agent can have: gold, because gold is earned and
 * this mark exists only once the run has finished and its captions exist. The aura around it is
 * what says "output, not worker" at canvas scale — it breathes continuously while the field
 * drifts, and both still under prefers-reduced-motion.
 */
const RESULT_ARTIFACT_IDENTITY: AgentIdentity = {
  ...createAgentIdentity({ id: "result-artifact", role: "orchestrator" }),
  key: "result-artifact",
  palette: {
    absorption: "#1f1704",
    body: "#6e5619",
    current: "#cfa544",
    counter: "#a3925c",
    caustic: "#f8ecc0",
  },
};

export default function ResultArtifactMark() {
  return (
    <span className="result-artifact-mark" aria-hidden="true">
      <span className="result-artifact-aura" />
      <AgentMark identity={RESULT_ARTIFACT_IDENTITY} status="working" fieldMotion="auto" />
    </span>
  );
}
