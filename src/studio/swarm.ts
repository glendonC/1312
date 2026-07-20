/**
 * The shapes the canvas and its nodes agree on.
 *
 * Kept apart from both so the node components and the canvas that mounts them do not have to
 * import each other.
 */

import type { Node } from "@xyflow/react";
import { Position } from "@xyflow/react";

import type { AgentIdentity } from "./agentIdentity";
import type { Layout, Point } from "./layout";

/** A node carries stable identity data. Live state is still read by id so one trace updates
 *  one agent rather than re-rendering the whole graph. */
export type AgentSwarmNode = Node<{ agent: string; identity: AgentIdentity }, "worker" | "hub">;

/**
 * The completed run's result artifact on the canvas. It is not an agent: it carries no identity
 * mesh and no live state, and it exists only as a projection of the receipted captions the run
 * actually produced — so its data is empty and its component reads the bundle directly.
 */
export type ArtifactSwarmNode = Node<Record<string, never>, "artifact">;

export type SwarmNode = AgentSwarmNode | ArtifactSwarmNode;

/** The one non-agent node id. Kept beside the node types so canvas and nodes agree on it. */
export const RESULT_ARTIFACT_NODE = "result-artifact";

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
