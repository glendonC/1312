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

/**
 * Where the run's finished artifact lands: on the orchestrator's FREE face, so its delivery wire
 * can never intersect another wire or pass through a worker. That freedom is a property of each
 * layout, not a tuning constant:
 *
 *   - the tidy layouts grow away from the root in one direction, so the space behind the root is
 *     guaranteed empty — above it when the tree grows down, left of it when it grows right;
 *   - the ring surrounds the hub, so the free direction is the bisector of the widest angular
 *     gap between workers. Every worker wire is a spoke from the hub, and two spokes only ever
 *     meet at the hub itself, so a spoke through the widest gap crosses nothing and clears the
 *     ring by the most room available.
 *
 * The artifact is not a worker, so it never joins the tree or the ring — and like everything
 * else here this is a pure function of the laid-out frame: same swarm, same terminus. The frame
 * alone carries enough geometry (a node's size is twice the distance from its top-left corner to
 * its centre), so no second size map is needed.
 */
export function terminus(frame: Frame, artifact: Size, layout: Layout): Point {
  const hub = frame.centre.orchestrator ?? { x: 0, y: 0 };
  const hubCorner = frame.pos.orchestrator ?? hub;

  if (layout === "down") {
    const hubTop = hubCorner.y;
    return { x: hub.x, y: hubTop - AIR.along - artifact.h / 2 };
  }
  if (layout === "right") {
    const hubLeft = hubCorner.x;
    return { x: hubLeft - AIR.along - artifact.w / 2, y: hub.y };
  }

  const workers = Object.entries(frame.centre).filter(([id]) => id !== "orchestrator");
  const clearance = AIR.along + Math.max(artifact.w, artifact.h) / 2;
  if (workers.length === 0) {
    return { x: hub.x, y: hub.y + (hub.y - hubCorner.y) + clearance };
  }

  let reach = 0;
  const angles = workers
    .map(([, c]) => {
      reach = Math.max(reach, Math.hypot(c.x - hub.x, c.y - hub.y));
      return Math.atan2(c.y - hub.y, c.x - hub.x);
    })
    .sort((a, b) => a - b);

  let gapStart = angles[angles.length - 1];
  let gapSize = angles[0] + Math.PI * 2 - gapStart;
  for (let i = 1; i < angles.length; i += 1) {
    const size = angles[i] - angles[i - 1];
    if (size > gapSize) {
      gapSize = size;
      gapStart = angles[i - 1];
    }
  }
  const bisector = gapStart + gapSize / 2;
  const radius = reach + clearance;

  return {
    x: hub.x + Math.cos(bisector) * radius,
    y: hub.y + Math.sin(bisector) * radius,
  };
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
