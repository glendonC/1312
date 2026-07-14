import type { CSSProperties } from "react";

import type { Role } from "./types";

export type AgentRelation = "root" | "spawn" | "divide";

export interface AgentPalette {
  deep: string;
  currentA: string;
  currentB: string;
  bloom: string;
}

export interface AgentFieldGeometry {
  currentAX: number;
  currentAY: number;
  currentBX: number;
  currentBY: number;
  bloomX: number;
  bloomY: number;
  angle: number;
  phaseX: number;
  phaseY: number;
  driftSeconds: number;
}

/**
 * A visual identity is stable input data, not component state. Runtime status can animate the
 * field, but it cannot change who the agent is. Descendants inherit their parent's palette and
 * receive a deterministic change in topology, which makes lineage visible without assigning a
 * new arbitrary colour every time an agent appears.
 */
export interface AgentIdentity {
  key: string;
  role: Role;
  relation: AgentRelation;
  seed: number;
  lineageSeed: number;
  palette: AgentPalette;
  geometry: AgentFieldGeometry;
}

interface CreateAgentIdentityOptions {
  id: string;
  role: Role;
  parent?: AgentIdentity;
  relation?: Exclude<AgentRelation, "root">;
}

const ROOT_PALETTE: AgentPalette = {
  deep: "#0b1815",
  currentA: "#2f776e",
  currentB: "#729ca8",
  bloom: "#d4dfbf",
};

/** Role colours stay inside one mineral spectrum. They bend a lineage rather than replacing it. */
const ROLE_BRANCHES: Record<Role, AgentPalette> = {
  orchestrator: ROOT_PALETTE,
  segment: {
    deep: "#101a1c",
    currentA: "#356d75",
    currentB: "#718b9d",
    bloom: "#c4d1cb",
  },
  context: {
    deep: "#101a17",
    currentA: "#3f7164",
    currentB: "#708f7b",
    bloom: "#ced5af",
  },
  translate: {
    deep: "#1b1714",
    currentA: "#8b6047",
    currentB: "#a97757",
    bloom: "#d8c49f",
  },
  qc: {
    deep: "#191812",
    currentA: "#756b3d",
    currentB: "#9b8651",
    bloom: "#d5c99f",
  },
};

function hash(value: string): number {
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return result >>> 0;
}

function channel(seed: number, index: number): number {
  let value = (seed + Math.imul(index + 1, 0x9e3779b1)) >>> 0;
  value ^= value >>> 16;
  value = Math.imul(value, 0x21f0aaad);
  value ^= value >>> 15;
  value = Math.imul(value, 0x735a2d97);
  value ^= value >>> 15;
  return (value >>> 0) / 0xffffffff;
}

function parseHex(value: string): [number, number, number] {
  const hex = value.replace("#", "");
  return [
    Number.parseInt(hex.slice(0, 2), 16),
    Number.parseInt(hex.slice(2, 4), 16),
    Number.parseInt(hex.slice(4, 6), 16),
  ];
}

function mixHex(parent: string, branch: string, branchWeight: number): string {
  const a = parseHex(parent);
  const b = parseHex(branch);
  const channels = a.map((value, index) =>
    Math.round(value * (1 - branchWeight) + b[index] * branchWeight),
  );
  return `#${channels.map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

function inheritPalette(
  parent: AgentPalette | undefined,
  role: Role,
  relation: AgentRelation,
): AgentPalette {
  if (!parent) return ROLE_BRANCHES[role];

  const branch = ROLE_BRANCHES[role];
  const branchWeight = relation === "divide" ? 0.12 : 0.32;
  return {
    deep: mixHex(parent.deep, branch.deep, branchWeight * 0.55),
    currentA: mixHex(parent.currentA, branch.currentA, branchWeight),
    currentB: mixHex(parent.currentB, branch.currentB, branchWeight),
    bloom: mixHex(parent.bloom, branch.bloom, branchWeight * 0.72),
  };
}

function geometry(seed: number, parent: AgentIdentity | undefined, relation: AgentRelation): AgentFieldGeometry {
  const divided = relation === "divide" ? parent : undefined;
  const currentAX = divided ? 100 - divided.geometry.currentAX : 20 + channel(seed, 0) * 42;
  const currentAY = divided ? divided.geometry.currentAY + 4 : 17 + channel(seed, 1) * 38;
  const currentBX = divided ? 100 - divided.geometry.currentBX : 48 + channel(seed, 2) * 35;
  const currentBY = divided ? divided.geometry.currentBY - 4 : 48 + channel(seed, 3) * 32;

  return {
    currentAX,
    currentAY,
    currentBX,
    currentBY,
    bloomX: divided ? 100 - divided.geometry.bloomX : 27 + channel(seed, 4) * 52,
    bloomY: divided ? divided.geometry.bloomY : 18 + channel(seed, 5) * 42,
    angle: divided ? (360 - divided.geometry.angle) % 360 : channel(seed, 6) * 360,
    phaseX: -7 + channel(seed, 7) * 14,
    phaseY: -6 + channel(seed, 8) * 12,
    driftSeconds: 17 + channel(seed, 9) * 7,
  };
}

export function createAgentIdentity({
  id,
  role,
  parent,
  relation,
}: CreateAgentIdentityOptions): AgentIdentity {
  const resolvedRelation: AgentRelation = parent ? (relation ?? "spawn") : "root";
  const lineageSeed = parent?.lineageSeed ?? hash(`1321:${id}:${role}`);
  const seed = hash(`${parent?.seed ?? lineageSeed}:${resolvedRelation}:${role}:${id}`);

  return {
    key: parent ? `${parent.key}/${id}` : `${id}-root`,
    role,
    relation: resolvedRelation,
    seed,
    lineageSeed,
    palette: inheritPalette(parent?.palette, role, resolvedRelation),
    geometry: geometry(seed, parent, resolvedRelation),
  };
}

export const ORCHESTRATOR_IDENTITY = createAgentIdentity({
  id: "orchestrator",
  role: "orchestrator",
});

type AgentIdentityStyle = CSSProperties & {
  "--agent-deep": string;
  "--agent-current-a": string;
  "--agent-current-b": string;
  "--agent-bloom": string;
  "--agent-current-a-x": string;
  "--agent-current-a-y": string;
  "--agent-current-b-x": string;
  "--agent-current-b-y": string;
  "--agent-bloom-x": string;
  "--agent-bloom-y": string;
  "--agent-field-angle": string;
  "--agent-phase-x": string;
  "--agent-phase-y": string;
  "--agent-drift": string;
};

export function agentIdentityStyle(identity: AgentIdentity): AgentIdentityStyle {
  const { palette, geometry: field } = identity;
  return {
    "--agent-deep": palette.deep,
    "--agent-current-a": palette.currentA,
    "--agent-current-b": palette.currentB,
    "--agent-bloom": palette.bloom,
    "--agent-current-a-x": `${field.currentAX.toFixed(2)}%`,
    "--agent-current-a-y": `${field.currentAY.toFixed(2)}%`,
    "--agent-current-b-x": `${field.currentBX.toFixed(2)}%`,
    "--agent-current-b-y": `${field.currentBY.toFixed(2)}%`,
    "--agent-bloom-x": `${field.bloomX.toFixed(2)}%`,
    "--agent-bloom-y": `${field.bloomY.toFixed(2)}%`,
    "--agent-field-angle": `${field.angle.toFixed(2)}deg`,
    "--agent-phase-x": `${field.phaseX.toFixed(2)}%`,
    "--agent-phase-y": `${field.phaseY.toFixed(2)}%`,
    "--agent-drift": `${field.driftSeconds.toFixed(2)}s`,
  };
}
