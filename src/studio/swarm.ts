/**
 * The shapes the canvas and its nodes agree on.
 *
 * Kept apart from both so the node components and the canvas that mounts them do not have to
 * import each other.
 */

import type { Node } from "@xyflow/react";
import { Position } from "@xyflow/react";

import type { Layout, Point } from "./layout";

/** A node on the canvas carries only the id of the agent it is showing. The agent itself is
 *  read from the store by the card, so a trace re-renders one card and not the graph. */
export type SwarmNode = Node<{ agent: string }>;

/**
 * Which face a wire leaves by, and which face it arrives at.
 *
 * The tidy layouts have a growth direction, so the answer is the same for every wire in them.
 * On the ring it depends on where the two workers actually are, and picking the face that
 * genuinely points at the other card is what keeps a wire from being drawn across a workspace.
 */
export function sideOf(
  from: Point | undefined,
  to: Point | undefined,
  layout: Layout,
): { source: Position; target: Position } {
  if (layout === "down") return { source: Position.Bottom, target: Position.Top };
  if (layout === "right") return { source: Position.Right, target: Position.Left };

  if (!from || !to) return { source: Position.Bottom, target: Position.Top };

  const dx = to.x - from.x;
  const dy = to.y - from.y;

  if (Math.abs(dx) > Math.abs(dy)) {
    return dx > 0
      ? { source: Position.Right, target: Position.Left }
      : { source: Position.Left, target: Position.Right };
  }

  return dy > 0
    ? { source: Position.Bottom, target: Position.Top }
    : { source: Position.Top, target: Position.Bottom };
}
