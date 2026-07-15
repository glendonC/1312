/**
 * Where the swarm sits.
 *
 * The swarm is a tree — the orchestrator spawns workers, and a divided worker hangs off the
 * worker it divided out of — so it gets a tree layout, not a force simulation. That is not a
 * taste call. A force sim is stochastic relaxation: it settles somewhere different every run,
 * it jitters on the way there, and the agent you are reading drifts out from under you. This
 * is d3-hierarchy's `tree`, the Reingold–Tilford tidy layout, and it is a pure function of
 * the swarm: same workers, same picture, every time, with no random seed anywhere in it.
 *
 * Nothing here knows how big an identity is. Sizes are MEASURED by the renderer and passed in,
 * so presentation can evolve and the geometry follows. The one constant is the air between
 * nodes, which is a design decision, not a measurement.
 */

import { hierarchy, tree, type HierarchyPointNode } from "d3-hierarchy";

import type { Role } from "./types";

/** Radial keeps the orchestrator at the centre. Down and right grow the tree outward. */
export type Layout = "radial" | "down" | "right";

export interface Spec {
  id: string;
  role: Role | "orchestrator";
  parent: string | null;
  /** Divided out of its parent rather than spawned fresh by the orchestrator. */
  mitosis: boolean;
}

export interface Size {
  w: number;
  h: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface Frame {
  /** Top-left corners, which is what the renderer positions by. */
  pos: Record<string, Point>;
  /** Centres, which is what the connectors reason about. */
  centre: Record<string, Point>;
}

/** The air between two workers. Everything else is measured. */
const AIR = { across: 36, along: 64 };

/** Only ever used for a node the renderer has not measured yet, on its very first frame. */
const UNMEASURED: Size = { w: 112, h: 100 };

/**
 * Place every spawned worker.
 *
 * `sizes` comes from the renderer's own measurements of the real nodes. Give this function
 * the same workers, the same sizes and the same orientation and it returns the same
 * coordinates — there is nothing to settle and nothing to converge.
 */
export function place(specs: Spec[], sizes: Record<string, Size>, layout: Layout): Frame {
  const hub = specs.find((s) => s.id === "orchestrator");
  if (!hub) return { pos: {}, centre: {} };

  const size = (id: string): Size => sizes[id] ?? UNMEASURED;
  const root = hierarchy<Spec>(hub, (s) => specs.filter((x) => x.id !== s.id && x.parent === s.id));

  const centre: Record<string, Point> = layout === "radial" ? ring(root, size) : tidy(root, size, layout);

  const pos: Record<string, Point> = {};
  for (const [id, c] of Object.entries(centre)) {
    const s = size(id);
    pos[id] = { x: c.x - s.w / 2, y: c.y - s.h / 2 };
  }

  return { pos, centre };
}

type Root = ReturnType<typeof hierarchy<Spec>>;

/** Reingold–Tilford, straight out of d3, with the generations pointed down or right. */
function tidy(root: Root, size: (id: string) => Size, layout: Layout): Record<string, Point> {
  const down = layout === "down";

  const all = root.descendants().map((n) => size(n.data.id));
  const widest = Math.max(...all.map((s) => s.w));
  const tallest = Math.max(...all.map((s) => s.h));

  // nodeSize is [across, along]: siblings are spaced across, generations along.
  const across = (down ? widest : tallest) + AIR.across;
  const along = (down ? tallest : widest) + AIR.along;

  const laid = tree<Spec>().nodeSize([across, along])(root) as HierarchyPointNode<Spec>;

  const out: Record<string, Point> = {};
  laid.each((n) => {
    out[n.data.id] = down ? { x: n.x, y: n.y } : { x: n.y, y: n.x };
  });
  return out;
}

/**
 * The orchestrator holds the centre and the workers take the ring around it.
 *
 * The radius is not a number someone liked the look of: it is the circumference the workers
 * actually need — the sum of their measured widths and the air between them — divided by 2π.
 * Add a sixth worker and the ring grows to hold it. A divided worker is walked in tree order,
 * so it lands next to the worker it came out of, and the short gold wire between them is
 * the mitosis.
 */
function ring(root: Root, size: (id: string) => Size): Record<string, Point> {
  const out: Record<string, Point> = { [root.data.id]: { x: 0, y: 0 } };

  // eachBefore, NOT descendants(): d3 walks descendants breadth-first, which files a divided
  // worker in with the other second-generation nodes and lands it on the far side of the ring
  // from the worker it came out of. Depth-first keeps a child beside its parent, which is the
  // one thing the ring has to get right.
  const workers: Root[] = [];
  root.eachBefore((n) => {
    if (n.depth > 0) workers.push(n);
  });
  if (workers.length === 0) return out;

  const span = (id: string): number => size(id).w + AIR.across;
  const total = workers.reduce((t, n) => t + span(n.data.id), 0);

  // Never tighter than the tallest worker needs to clear the hub, never tighter than the
  // circumference demands.
  const tallest = Math.max(...workers.map((n) => size(n.data.id).h));
  const radius = Math.max(tallest + AIR.along, total / (2 * Math.PI));

  let walked = 0;
  for (const n of workers) {
    const w = span(n.data.id);
    // Start at the top and go clockwise, so one worker sits dead centre-top.
    const angle = ((walked + w / 2) / total) * Math.PI * 2 - Math.PI / 2;
    walked += w;

    out[n.data.id] = {
      x: Math.cos(angle) * radius,
      y: Math.sin(angle) * radius,
    };
  }

  return out;
}
