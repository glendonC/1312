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
import { memo, useEffect, useState } from "react";

import AgentMark from "./AgentMark";
import { ORCHESTRATOR_IDENTITY } from "./agentIdentity";
import { agentState, agentTitle } from "./agentPresentation";
import { useAgent, useStudio } from "./store";
import type { SwarmNode } from "./swarm";
import type { Role } from "./types";

/** How long a worker keeps its just-born look before it is simply another worker. */
const BIRTH_MS = 720;

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
 * True for the first moments of a worker's life, and never again.
 *
 * A worker that appeared at full strength would be claiming a history it does not have. It
 * arrives as a dashed ghost on top of the parent it divided out of, travels to its own slot,
 * and fills in as it lands.
 */
function useBorn(): boolean {
  const [born, setBorn] = useState(true);

  useEffect(() => {
    const t = window.setTimeout(() => setBorn(false), BIRTH_MS);
    return () => clearTimeout(t);
  }, []);

  return born;
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
export const WorkerNode = memo(function WorkerNode({ data }: NodeProps<SwarmNode>) {
  const agent = useAgent(data.agent);
  const on = useStudio((s) => s.selected === data.agent);
  const cancelled = useStudio((s) => s.outcome?.kind === "cancelled");
  const paused = useStudio((s) => s.paused);
  const born = useBorn();
  const open = useOpen(data.agent);

  if (!agent) return null;

  const role = agent.role as Exclude<Role, "orchestrator">;
  const title = agentTitle(agent.id, role);
  const state = agentState(agent.status, role, cancelled);

  return (
    <div
      className="agent-node worker-node"
      data-role={agent.role}
      data-status={agent.status}
      data-run-state={cancelled ? "cancelled" : "active"}
      data-on={on}
      data-born={born}
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
      <span className="node-state">{state}</span>
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
      <span className="node-state">{state}</span>
    </div>
  );
});
