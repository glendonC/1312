/**
 * The two kinds of node on the canvas.
 *
 * Every agent gets an identity field on the topology. Detailed tools and evidence belong in
 * focus mode, where they can be read without forcing the entire graph to zoom out.
 *
 * Each node subscribes to its own agent and nothing else, so a trace landing on qc-01
 * re-renders qc-01 and leaves every other identity and the layout alone.
 */

import { Handle, Position, type NodeProps } from "@xyflow/react";
import { memo } from "react";

import AgentMark from "./AgentMark";
import { ORCHESTRATOR_IDENTITY } from "./agentIdentity";
import { isAgentThinking } from "./agentMeshRenderer";
import { agentState, agentTitle } from "./agentPresentation";
import { projectResultAccounting } from "./resultAccounting";
import ResultArtifactMark from "./ResultArtifactMark";
import { useAgent, useBundle, useComplete, useStudio } from "./store";
import { RESULT_ARTIFACT_NODE, type AgentSwarmNode } from "./swarm";
import type { Role } from "./types";

const SIDES = [Position.Top, Position.Right, Position.Bottom, Position.Left];

/**
 * A wire can arrive at any face, so every face has a pin.
 *
 * This is what keeps a wire from cutting through an identity: the graph engine routes to the
 * pin on the side that faces the other node, so a connector lands at the material edge.
 */
function Pins() {
  return (
    <>
      {SIDES.map((side) => (
        <span key={side}>
          <Handle className="pin" type="source" id={side} position={side} isConnectable={false} />
          <Handle
            className="pin"
            type="target"
            id={`${side}-in`}
            position={side}
            isConnectable={false}
          />
        </span>
      ))}
    </>
  );
}

/**
 * Enter and Space open a worker.
 *
 * The graph engine handles the click, but a node is a div, so the keyboard is ours to wire —
 * and an agent you can tab to but not open is worse than one you cannot reach at all.
 */
function useOpen(id: string): {
  onKeyDown: (e: React.KeyboardEvent) => void;
} {
  const select = useStudio((s) => s.select);

  return {
    onKeyDown: (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      e.preventDefault();
      e.stopPropagation();
      select(useStudio.getState().selected === id ? null : id);
    },
  };
}

/** One worker identity on the canvas. Its readable workspace opens in focus mode. */
export const WorkerNode = memo(function WorkerNode({ data }: NodeProps<AgentSwarmNode>) {
  const agent = useAgent(data.agent);
  const on = useStudio((s) => s.selected === data.agent);
  const cancelled = useStudio((s) => s.outcome?.kind === "cancelled");
  const paused = useStudio((s) => s.paused);
  const open = useOpen(data.agent);

  if (!agent) return null;

  const role = agent.role as Exclude<Role, "orchestrator">;
  const title = agentTitle(agent.id, role);
  const state = agentState(agent.status, role, cancelled);
  const stateIsActive = isAgentThinking(agent.status) && !cancelled && !paused;

  return (
    <div
      className="agent-node worker-node"
      data-role={agent.role}
      // The forming look is bound to the recorded `spawning` status, never a UI timer: a worker
      // that mounts already working (a mid-run seek) is settled at once, and one caught mid-birth
      // by a cursor step stays a dashed ghost until the log itself moves it to working.
      data-status={agent.status}
      data-run-state={cancelled ? "cancelled" : "active"}
      data-on={on}
      data-agent-node={agent.id}
      role="button"
      tabIndex={0}
      onKeyDown={open.onKeyDown}
      aria-label={`${title}, ${state}, ${agent.actions} actions`}
      aria-haspopup="dialog"
      aria-expanded={on}
    >
      <span className="agent-node-identity">
        <Pins />
        <AgentMark
          identity={data.identity}
          status={agent.status}
          fieldMotion={cancelled || paused ? "still" : "auto"}
        />
      </span>
      <span className="node-name">{title}</span>
      <span className={`node-state${stateIsActive ? " text-shimmer" : ""}`}>{state}</span>
    </div>
  );
});

/** The orchestrator. No workspace, because it does not work — it divides the work. */
export const HubNode = memo(function HubNode() {
  const status = useStudio((s) => s.state.orchestrator.status);
  const note = useStudio((s) => s.state.orchestrator.note);
  const on = useStudio((s) => s.selected === "orchestrator");
  const cancelled = useStudio((s) => s.outcome?.kind === "cancelled");
  const paused = useStudio((s) => s.paused);
  const open = useOpen("orchestrator");
  const state = agentState(status, "orchestrator", cancelled);
  const stateIsActive = isAgentThinking(status) && !cancelled && !paused;

  return (
    <div
      className="hub"
      data-status={status}
      data-run-state={cancelled ? "cancelled" : "active"}
      data-on={on}
      data-agent-node="orchestrator"
      role="button"
      tabIndex={0}
      onKeyDown={open.onKeyDown}
      aria-label={`orchestrator, ${state}. ${note}`}
      aria-haspopup="dialog"
      aria-expanded={on}
      title={note}
    >
      <span className="agent-node-identity">
        <Pins />
        <AgentMark
          identity={ORCHESTRATOR_IDENTITY}
          status={status}
          fieldMotion={cancelled || paused ? "still" : "auto"}
        />
      </span>
      <span className="node-name">Orchestrator</span>
      <span className={`node-state${stateIsActive ? " text-shimmer" : ""}`}>{state}</span>
    </div>
  );
});

/**
 * The run's result on the completed topology: the receipted captions artifact, at the terminus,
 * linked from the orchestrator. It is a projection of the artifact the run actually produced —
 * it mounts only once the fold is complete, it never emits or receives a trace, and it is drawn
 * as a settled gold medallion rather than an agent identity, because it is a thing the swarm
 * made and not a member of the swarm. Opening it opens the result workspace: the orb is the
 * re-entry anchor to a result that has already been shown once.
 */
export const ArtifactNode = memo(function ArtifactNode() {
  const complete = useComplete();
  const bundle = useBundle();
  const on = useStudio((s) => s.resultView === "result");
  const setResultView = useStudio((s) => s.setResultView);

  if (!complete || !bundle) return null;

  const state = `${projectResultAccounting(bundle).pair} captions`;

  return (
    <div
      className="artifact-node"
      data-agent-node={RESULT_ARTIFACT_NODE}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key !== "Enter" && e.key !== " ") return;
        e.preventDefault();
        e.stopPropagation();
        setResultView("result");
      }}
      aria-label={`Result, ${state}. Open the result.`}
      aria-expanded={on}
    >
      <span className="agent-node-identity">
        <Pins />
        <ResultArtifactMark />
      </span>
      <span className="node-name">Result</span>
      <span className="node-state">{state}</span>
    </div>
  );
});
