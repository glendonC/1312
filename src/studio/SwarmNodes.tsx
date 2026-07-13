/**
 * The two kinds of node on the canvas.
 *
 * A worker gets a squircle carrying its own live workspace — the same renderer the drawer
 * uses, at cell scale. The orchestrator gets a disc, because it is the one agent with no
 * workspace to show: it reads the job and spawns the workers that do the work.
 *
 * Each card subscribes to its own agent and nothing else, so a trace landing on qc-01
 * re-renders qc-01 and leaves the other four workspaces and the layout alone.
 */

import { Handle, Position, type NodeProps } from "@xyflow/react";
import { memo, useEffect, useState } from "react";

import { useAgent, useStudio } from "./store";
import Workspace from "./Workspace";
import type { SwarmNode } from "./swarm";

/** How long a worker keeps its just-born look before it is simply another worker. */
const BIRTH_MS = 720;

const SIDES = [Position.Top, Position.Right, Position.Bottom, Position.Left];

/**
 * A wire can arrive at any face, so every face has a pin.
 *
 * This is what keeps a wire off a card's front: the graph engine routes to the pin on the
 * side that actually faces the other node, so a connector lands on an edge and stops there
 * instead of being drawn to the card's centre and straight across its contents.
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

/** One worker's live workspace, on the canvas. */
export const WorkerNode = memo(function WorkerNode({ data }: NodeProps<SwarmNode>) {
  const agent = useAgent(data.agent);
  const on = useStudio((s) => s.selected === data.agent);
  const born = useBorn();

  if (!agent) return null;

  return (
    <div
      className="cell"
      data-role={agent.role}
      data-status={agent.status}
      data-on={on}
      data-born={born}
      role="button"
      tabIndex={0}
      aria-label={`${agent.label}, ${agent.role}, ${agent.status}, ${agent.actions} actions`}
    >
      <Pins />

      <span className="cell-head">
        <span className="cell-dot" data-status={agent.status} aria-hidden="true" />
        <span className="cell-name">{agent.label}</span>
        <span className="cell-count">{agent.actions}</span>
      </span>

      <Workspace agent={agent} scale="cell" />
    </div>
  );
});

/** The orchestrator. No workspace, because it does not work — it divides the work. */
export const HubNode = memo(function HubNode() {
  const status = useStudio((s) => s.state.orchestrator.status);
  const note = useStudio((s) => s.state.orchestrator.note);
  const on = useStudio((s) => s.selected === "orchestrator");

  return (
    <div
      className="hub"
      data-status={status}
      data-on={on}
      role="button"
      tabIndex={0}
      aria-label={`orchestrator, ${status}. ${note}`}
      title={note}
    >
      <Pins />
      <span className="hub-disc" />
      <span className="node-name">orchestrator</span>
    </div>
  );
});
