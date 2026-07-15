/**
 * The swarm, as it actually is: a topology of live agents on an open canvas.
 *
 * A grid of cards cannot say that translate-02 DIVIDED OUT OF translate-01 — that is an edge,
 * and mitosis is the whole point. So this is a real node graph on a real graph engine, and the
 * engine owns everything that should never be hand-written: it measures the nodes, it routes
 * the wires between their faces, and it owns the viewport. Nothing in this file computes a
 * bezier, a bounding box or a zoom level, which is exactly why none of that can rot.
 *
 * What is ours is what is actually about this product:
 *   - the tree layout (layout.ts), because a swarm that divides has a shape, and that shape
 *     is a function of the swarm — not something a solver relaxes its way toward
 *   - the identity node (SwarmNodes.tsx), which carries role, state, and lineage at canvas scale
 *   - the birth, because a worker is born on the worker it came out of and travels from there
 */

import {
  Background,
  BackgroundVariant,
  MiniMap,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesInitialized,
  useNodesState,
  useReactFlow,
  type Edge,
  type Viewport,
} from "@xyflow/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";

import { createAgentIdentityMap, ORCHESTRATOR_IDENTITY } from "./agentIdentity";
import { Overview } from "./glyphs";
import { place, type Size, type Spec } from "./layout";
import { useAgentIds, useBundle, useLayout, useStudio } from "./store";
import { sideOf, type SwarmNode } from "./swarm";
import { HubNode, WorkerNode } from "./SwarmNodes";

import "@xyflow/react/dist/base.css";

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
  const reduceMotion = useReducedMotion();
  const layout = useLayout();
  const focused = useStudio((s) => s.selected !== null);
  const select = useStudio((s) => s.select);
  const graph = useRef<HTMLDivElement>(null);
  const [overviewOpen, setOverviewOpen] = useState(false);
  const [overview, setOverview] = useState({ needed: false, offscreen: 0 });

  // The engine has to be able to write its measurements back, or it never reports a node as
  // measured and the layout below has nothing real to lay out.
  const [nodes, setNodes, onNodesChange] = useNodesState<SwarmNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  const { fitView, getNodes, getViewport, setCenter } = useReactFlow<SwarmNode>();
  const measured = useNodesInitialized();
  const identities = useMemo(
    () => createAgentIdentityMap(bundle?.run.agents ?? []),
    [bundle],
  );

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

  const inspectViewport = useCallback(
    (nextViewport?: Viewport) => {
      const element = graph.current;
      const visibleNodes = getNodes().filter((node) => !node.hidden);
      if (!element || visibleNodes.length === 0 || focused) {
        setOverview({ needed: false, offscreen: 0 });
        return;
      }

      const viewport = nextViewport ?? getViewport();
      const compact = element.clientWidth <= 720;
      const safe = {
        left: compact ? 16 : 24,
        right: element.clientWidth - (compact ? 16 : 24),
        top: compact ? 68 : 80,
        bottom: Math.max(compact ? 128 : 104, element.clientHeight - (compact ? 142 : 112)),
      };

      let totalArea = 0;
      let visibleArea = 0;
      let offscreen = 0;
      let rootVisibility = 1;

      for (const node of visibleNodes) {
        const width = node.measured?.width ?? node.width ?? 112;
        const height = node.measured?.height ?? node.height ?? 100;
        const left = node.position.x * viewport.zoom + viewport.x;
        const top = node.position.y * viewport.zoom + viewport.y;
        const right = left + width * viewport.zoom;
        const bottom = top + height * viewport.zoom;
        const area = Math.max(1, (right - left) * (bottom - top));
        const intersection =
          Math.max(0, Math.min(right, safe.right) - Math.max(left, safe.left)) *
          Math.max(0, Math.min(bottom, safe.bottom) - Math.max(top, safe.top));
        const visibility = intersection / area;

        totalArea += area;
        visibleArea += intersection;
        if (visibility < 0.75) offscreen += 1;
        if (node.id === "orchestrator") rootVisibility = visibility;
      }

      const fraction = totalArea > 0 ? visibleArea / totalArea : 1;
      const cramped = viewport.zoom < 0.65 && visibleNodes.length >= 6;

      setOverview((current) => {
        const visibilityFloor = current.needed ? 0.92 : 0.75;
        const needed = rootVisibility < 0.65 || fraction < visibilityFloor || cramped;
        if (current.needed === needed && current.offscreen === offscreen) return current;
        return { needed, offscreen };
      });
    },
    [focused, getNodes, getViewport],
  );

  const fitSwarm = useCallback(async () => {
    const onlyOrchestrator = specs.length === 1;
    await fitView({
      padding: onlyOrchestrator ? 0.28 : 0.2,
      duration: reduceMotion ? 0 : 520,
      maxZoom: onlyOrchestrator ? 1.34 : 1.08,
      minZoom: 0.45,
    });
    inspectViewport();
  }, [fitView, inspectViewport, reduceMotion, specs.length]);

  useEffect(() => {
    if (!overview.needed) setOverviewOpen(false);
  }, [overview.needed]);

  useEffect(() => {
    const element = graph.current;
    if (!element) return undefined;
    const observer = new ResizeObserver(() => inspectViewport());
    observer.observe(element);
    return () => observer.disconnect();
  }, [inspectViewport]);

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
          data: { agent: s.id, identity: identities[s.id] ?? ORCHESTRATOR_IDENTITY },
          draggable: false,
          selectable: false,
          connectable: false,
        });
      }
      return next;
    });
  }, [identities, specs, setNodes]);

  // Lay the tree out from the nodes' measured sizes, wire it up, and fit it to the canvas.
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

    const t = window.setTimeout(() => void fitSwarm(), 30);
    return () => clearTimeout(t);
  }, [specs, layout, measured, getNodes, fitSwarm, setNodes, setEdges]);

  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: SwarmNode) => {
      const open = useStudio.getState().selected;
      select(open === node.id ? null : node.id);
    },
    [select],
  );

  const types = useMemo(() => ({ worker: WorkerNode, hub: HubNode }), []);

  return (
    <div className="graph" ref={graph}>
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
        onMoveEnd={(_, viewport) => inspectViewport(viewport)}
        attributionPosition="bottom-left"
        aria-label="Agent swarm topology"
      >
        {/* the canvas is a canvas: it pans, and the grid is what tells you so */}
        <Background variant={BackgroundVariant.Dots} gap={26} size={1} className="grid" />

        {overviewOpen && overview.needed && (
          <MiniMap<SwarmNode>
            className="graph-overview-map"
            style={{ width: 168, height: 104 }}
            position="bottom-right"
            pannable
            nodeColor={(node) => (node.id === "orchestrator" ? "#2a6b66" : "#91a5a0")}
            nodeStrokeColor="rgba(255, 255, 255, 0.88)"
            nodeStrokeWidth={2}
            nodeBorderRadius={8}
            bgColor="rgba(247, 250, 248, 0.9)"
            maskColor="rgba(225, 235, 232, 0.68)"
            maskStrokeColor="rgba(42, 107, 102, 0.72)"
            maskStrokeWidth={1.2}
            ariaLabel="Swarm overview map. Drag to pan the canvas."
            onClick={(_, position) => {
              void setCenter(position.x, position.y, { duration: reduceMotion ? 0 : 320 });
            }}
          />
        )}

        <AnimatePresence initial={false}>
          {overview.needed && (
            <Panel position="bottom-right" className="graph-overview-control">
              <motion.div
                className="graph-overview-actions"
                initial={{ opacity: 0, y: 6, scale: 0.94 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 6, scale: 0.94 }}
                transition={{ duration: reduceMotion ? 0 : 0.18 }}
              >
                {overviewOpen && (
                  <button type="button" className="graph-overview-fit" onClick={() => void fitSwarm()}>
                    Fit all
                  </button>
                )}
                <button
                  type="button"
                  className="graph-overview-trigger"
                  aria-label={
                    overviewOpen
                      ? "Hide swarm overview"
                      : overview.offscreen > 0
                        ? `Show swarm overview. ${overview.offscreen} ${overview.offscreen === 1 ? "agent is" : "agents are"} off canvas.`
                        : "Show swarm overview. The topology is below the readable zoom."
                  }
                  aria-expanded={overviewOpen}
                  title={overviewOpen ? "Hide overview" : "Show overview"}
                  onClick={() => setOverviewOpen((current) => !current)}
                >
                  <Overview />
                  {overview.offscreen > 0 && (
                    <span className="graph-overview-count" aria-hidden="true">
                      {overview.offscreen}
                    </span>
                  )}
                </button>
              </motion.div>
            </Panel>
          )}
        </AnimatePresence>
      </ReactFlow>
    </div>
  );
}
