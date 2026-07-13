/**
 * The swarm, as it actually is: a topology.
 *
 * A grid of cards cannot say that translate-02 DIVIDED OUT OF translate-01 — that is
 * an edge, and mitosis is the whole point. Nodes are added as the orchestrator spawns
 * them, the simulation re-settles, and every worker stays on the canvas after the run
 * so its history remains open for inspection.
 */

import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  type Simulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from "d3-force";
import { useEffect, useRef, useState } from "react";

import { useAgentIds, useBundle, useStudio } from "./store";
import type { AgentStatus, Role } from "./types";

interface Node extends SimulationNodeDatum {
  id: string;
  role: Role | "orchestrator";
  label: string;
  parent: string | null;
  /** True when this worker was created by dividing another, not spawned fresh. */
  mitosis: boolean;
}

type Link = SimulationLinkDatum<Node>;

const R: Record<string, number> = {
  orchestrator: 26,
  segment: 19,
  context: 19,
  translate: 19,
  qc: 19,
};

export default function SwarmGraph() {
  const bundle = useBundle();
  const ids = useAgentIds();
  const agents = useStudio((s) => s.state.agents);
  const orchestrator = useStudio((s) => s.state.orchestrator);
  const selected = useStudio((s) => s.selected);
  const select = useStudio((s) => s.select);

  const box = useRef<HTMLDivElement>(null);
  const sim = useRef<Simulation<Node, Link> | null>(null);
  const nodes = useRef<Node[]>([]);
  const links = useRef<Link[]>([]);

  const [, tick] = useState(0);
  const [size, setSize] = useState({ w: 900, h: 420 });

  // Keep the canvas honest about its own size.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setSize({ w: Math.max(320, width), h: Math.max(280, height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Boot the simulation once. Nodes get pushed in as they spawn.
  useEffect(() => {
    const s = forceSimulation<Node, Link>(nodes.current)
      .force("charge", forceManyBody<Node>().strength(-420))
      .force(
        "link",
        forceLink<Node, Link>(links.current)
          .id((d) => d.id)
          .distance((l) => ((l as Link & { mitosis?: boolean }).mitosis ? 78 : 132))
          .strength(0.55),
      )
      .force("collide", forceCollide<Node>().radius((d) => R[d.role] + 22))
      .alphaDecay(0.045)
      .on("tick", () => tick((n) => n + 1));

    sim.current = s;
    return () => {
      s.stop();
    };
  }, []);

  useEffect(() => {
    const s = sim.current;
    if (!s) return;
    s.force("center", forceCenter(size.w / 2, size.h / 2)).alpha(0.5).restart();
  }, [size]);

  // Reconcile: add the orchestrator, then every worker the event log has spawned.
  useEffect(() => {
    if (!bundle) return;
    const s = sim.current;
    if (!s) return;

    const have = new Set(nodes.current.map((n) => n.id));
    let added = false;

    if (!have.has("orchestrator")) {
      nodes.current.push({
        id: "orchestrator",
        role: "orchestrator",
        label: "orchestrator",
        parent: null,
        mitosis: false,
        x: size.w / 2,
        y: size.h / 2,
        fx: size.w / 2,
        fy: size.h / 2,
      });
      have.add("orchestrator");
      added = true;
    }

    for (const id of ids) {
      if (have.has(id)) continue;
      const spec = bundle.run.agents.find((a) => a.id === id);
      if (!spec) continue;

      const parent = spec.divided_from ?? spec.parent ?? "orchestrator";
      const from = nodes.current.find((n) => n.id === parent);

      // A new worker is born ON its parent, then pushed out. That is the mitosis.
      nodes.current.push({
        id,
        role: spec.role,
        label: spec.id,
        parent,
        mitosis: Boolean(spec.divided_from),
        x: (from?.x ?? size.w / 2) + (Math.random() - 0.5) * 8,
        y: (from?.y ?? size.h / 2) + (Math.random() - 0.5) * 8,
      });
      links.current.push({ source: parent, target: id, mitosis: Boolean(spec.divided_from) } as Link);
      added = true;
    }

    if (added) {
      s.nodes(nodes.current);
      (s.force("link") as ReturnType<typeof forceLink<Node, Link>>).links(links.current);
      s.alpha(0.9).restart();
    }
  }, [ids, bundle, size]);

  const statusOf = (id: string): AgentStatus =>
    id === "orchestrator" ? orchestrator.status : (agents[id]?.status ?? "spawning");

  return (
    <div className="graph" ref={box}>
      <svg width={size.w} height={size.h} role="img" aria-label="Agent swarm topology">
        <g className="graph-edges">
          {links.current.map((l, i) => {
            const a = l.source as Node;
            const b = l.target as Node;
            if (typeof a !== "object" || typeof b !== "object") return null;
            const mitosis = Boolean((l as Link & { mitosis?: boolean }).mitosis);
            return (
              <line
                key={i}
                x1={a.x ?? 0}
                y1={a.y ?? 0}
                x2={b.x ?? 0}
                y2={b.y ?? 0}
                className="edge"
                data-mitosis={mitosis}
              />
            );
          })}
        </g>

        <g className="graph-nodes">
          {nodes.current.map((n) => {
            const status = statusOf(n.id);
            const on = selected === n.id;
            const actions = n.id === "orchestrator" ? null : agents[n.id]?.actions;

            return (
              <g
                key={n.id}
                className="node"
                data-status={status}
                data-role={n.role}
                data-on={on}
                transform={`translate(${n.x ?? 0},${n.y ?? 0})`}
                onClick={() => select(on ? null : n.id)}
                tabIndex={0}
                role="button"
                aria-label={`${n.label}, ${status}`}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") select(on ? null : n.id);
                }}
              >
                <circle className="node-halo" r={R[n.role] + 8} />
                <circle className="node-disc" r={R[n.role]} />
                <text className="node-label" y={R[n.role] + 17}>
                  {n.label}
                </text>
                {actions ? (
                  <text className="node-count" y={4}>
                    {actions}
                  </text>
                ) : null}
              </g>
            );
          })}
        </g>
      </svg>
    </div>
  );
}
