/**
 * The swarm, as it actually is: a topology of live workspaces on an open canvas.
 *
 * A grid of cards cannot say that translate-02 DIVIDED OUT OF translate-01 — that is an edge,
 * and mitosis is the whole point. So this is a real node graph on a real graph engine, and the
 * engine owns everything that should never be hand-written: it measures the cards, it routes
 * the wires between their faces, and it owns the viewport. Nothing in this file computes a
 * bezier, a bounding box or a zoom level, which is exactly why none of that can rot.
 *
 * What is ours is what is actually about this product:
 *   - the tree layout (layout.ts), because a swarm that divides has a shape, and that shape
 *     is a function of the swarm — not something a solver relaxes its way toward
 *   - the card (SwarmNodes.tsx), which is a worker's live workspace, not a labelled dot
 *   - the birth, because a worker is born on the worker it came out of and travels from there
 */

import {
  Background,
  BackgroundVariant,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesInitialized,
  useNodesState,
  useReactFlow,
  type Edge,
} from "@xyflow/react";
import { useCallback, useEffect, useMemo } from "react";

import { place, type Layout, type Size, type Spec } from "./layout";
import { useAgentIds, useBundle, useLayout, usePaused, useStudio } from "./store";
import { sideOf, type SwarmNode } from "./swarm";
import { HubNode, WorkerNode } from "./SwarmNodes";

import "@xyflow/react/dist/base.css";

const LAYOUTS: { id: Layout; label: string; hint: string }[] = [
  { id: "radial", label: "Ring", hint: "The orchestrator holds the centre" },
  { id: "down", label: "Down", hint: "Grow the tree downward" },
  { id: "right", label: "Right", hint: "Grow the tree rightward" },
];

export default function SwarmGraph() {
  return (
    <ReactFlowProvider>
      <Swarm />
    </ReactFlowProvider>
  );
}

function Swarm() {
  const bundle = useBundle();
  const ids = useAgentIds();
  const paused = usePaused();
  const layout = useLayout();
  const setLayout = useStudio((s) => s.setLayout);
  const select = useStudio((s) => s.select);

  // The engine has to be able to write its measurements back, or it never reports a node as
  // measured and the layout below has nothing real to lay out.
  const [nodes, setNodes, onNodesChange] = useNodesState<SwarmNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  const { getNodes, fitView } = useReactFlow<SwarmNode>();
  const measured = useNodesInitialized();

  /**
   * The swarm the event log has actually spawned — never the manifest's full roster. A worker
   * appears on the canvas when it emits, not when a file says it might.
   */
  const specs = useMemo<Spec[]>(() => {
    if (!bundle) return [];

    const live = new Set(ids);
    return [
      { id: "orchestrator", role: "orchestrator" as const, parent: null, mitosis: false },
      ...bundle.run.agents
        .filter((a) => live.has(a.id))
        .map((a) => ({
          id: a.id,
          role: a.role,
          parent: a.divided_from ?? a.parent ?? "orchestrator",
          mitosis: Boolean(a.divided_from),
        })),
    ];
  }, [bundle, ids]);

  // A newborn is placed ON the parent it came out of. The layout below then gives it a slot of
  // its own and it travels there — that flight is the mitosis, and it is why a worker is never
  // seen to appear somewhere it was never spawned.
  useEffect(() => {
    setNodes((prev) => {
      const have = new Set(prev.map((n) => n.id));
      const born = specs.filter((s) => !have.has(s.id));
      if (born.length === 0) return prev;

      const next = [...prev];
      for (const s of born) {
        const parent = next.find((n) => n.id === s.parent);
        next.push({
          id: s.id,
          type: s.id === "orchestrator" ? "hub" : "worker",
          position: parent ? { ...parent.position } : { x: 0, y: 0 },
          data: { agent: s.id },
          draggable: false,
          selectable: false,
          connectable: false,
        });
      }
      return next;
    });
  }, [specs, setNodes]);

  // Lay the tree out from the cards' own measured sizes, wire it up, and fit it to the canvas.
  useEffect(() => {
    if (!measured || specs.length === 0) return;

    const sizes: Record<string, Size> = {};
    for (const n of getNodes()) {
      if (n.measured?.width && n.measured?.height) {
        sizes[n.id] = { w: n.measured.width, h: n.measured.height };
      }
    }

    const frame = place(specs, sizes, layout);

    setNodes((prev) => prev.map((n) => (frame.pos[n.id] ? { ...n, position: frame.pos[n.id] } : n)));

    setEdges(
      specs
        .filter((s) => s.parent)
        .map((s) => {
          const side = sideOf(frame.centre[s.parent as string], frame.centre[s.id], layout);

          return {
            id: `${s.parent}-${s.id}`,
            source: s.parent as string,
            target: s.id,
            sourceHandle: side.source,
            targetHandle: `${side.target}-in`,
            type: layout === "radial" ? "default" : "smoothstep",
            className: s.mitosis ? "wire wire-mitosis" : "wire",
            focusable: false,
          } satisfies Edge;
        }),
    );

    const t = window.setTimeout(() => {
      void fitView({ padding: 0.16, duration: 420, maxZoom: 1, minZoom: 0.45 });
    }, 30);
    return () => clearTimeout(t);
  }, [specs, layout, measured, getNodes, fitView, setNodes, setEdges]);

  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: SwarmNode) => {
      const open = useStudio.getState().selected;
      select(open === node.id ? null : node.id);
    },
    [select],
  );

  const types = useMemo(() => ({ worker: WorkerNode, hub: HubNode }), []);

  return (
    <div className="graph" data-paused={paused}>
      {paused && (
        <span className="graph-hold" aria-live="polite">
          Paused
        </span>
      )}

      <div className="seg graph-seg" role="group" aria-label="Swarm layout">
        {LAYOUTS.map((l) => (
          <button
            key={l.id}
            type="button"
            className={`seg-btn${layout === l.id ? " is-on" : ""}`}
            onClick={() => setLayout(l.id)}
            title={l.hint}
            aria-pressed={layout === l.id}
          >
            {l.label}
          </button>
        ))}
      </div>

      <ReactFlow<SwarmNode>
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={types}
        onNodeClick={onNodeClick}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        zoomOnScroll={false}
        zoomOnDoubleClick={false}
        preventScrolling={false}
        panOnDrag
        minZoom={0.45}
        maxZoom={1.4}
        aria-label="Agent swarm topology"
      >
        {/* the canvas is a canvas: it pans, and the grid is what tells you so */}
        <Background variant={BackgroundVariant.Dots} gap={26} size={1} className="grid" />
      </ReactFlow>
    </div>
  );
}
