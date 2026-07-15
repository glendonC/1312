import type { CSSProperties } from "react";

import type { AgentSpec, Role } from "./types";

export type AgentRelation = "root" | "spawn" | "divide";

export interface AgentPalette {
  absorption: string;
  body: string;
  current: string;
  counter: string;
  caustic: string;
}

export type AgentTopologyKind =
  "confluence" | "strata" | "basin" | "braid" | "interference";

export interface AgentFieldGeometry {
  angle: number;
  scale: number;
  bandWidth: number;
  warp: number;
  phaseX: number;
  phaseY: number;
  causticX: number;
  causticY: number;
  driftSeconds: number;
  mirror: 1 | -1;
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
  topology: AgentTopologyKind;
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
  absorption: "#071412",
  body: "#173f3a",
  current: "#3f8178",
  counter: "#7196a3",
  caustic: "#d4dfbf",
};

/**
 * Worker roles occupy distinct material families. A descendant still inherits enough of its
 * parent to read as lineage, while its role remains recognizable at canvas scale.
 */
const ROLE_BRANCHES: Record<Role, AgentPalette> = {
  orchestrator: ROOT_PALETTE,
  segment: {
    absorption: "#0b1430",
    body: "#183776",
    current: "#416fce",
    counter: "#8baee8",
    caustic: "#e4eff7",
  },
  context: {
    absorption: "#0b2118",
    body: "#1f5139",
    current: "#4b8c5e",
    counter: "#a7c86b",
    caustic: "#e7edbd",
  },
  translate: {
    absorption: "#261323",
    body: "#653047",
    current: "#c45f6f",
    counter: "#a58ad2",
    caustic: "#f4d1bc",
  },
  qc: {
    absorption: "#221b08",
    body: "#66511b",
    current: "#c49831",
    counter: "#6e944c",
    caustic: "#f2de93",
  },
};

const ROLE_TOPOLOGIES: Record<Role, AgentTopologyKind> = {
  orchestrator: "confluence",
  segment: "strata",
  context: "basin",
  translate: "braid",
  qc: "interference",
};

interface TopologyProfile {
  angle: number;
  angleVariance: number;
  scale: number;
  bandWidth: number;
  warp: number;
}

/**
 * Each role owns a coarse field composition. Seed variation may move or bend that composition,
 * but it cannot turn a segmenter's strata into a translator's braid.
 */
const TOPOLOGY_PROFILES: Record<AgentTopologyKind, TopologyProfile> = {
  confluence: {
    angle: 28,
    angleVariance: 44,
    scale: 0.92,
    bandWidth: 0.29,
    warp: 0.34,
  },
  strata: {
    angle: 338,
    angleVariance: 24,
    scale: 1.08,
    bandWidth: 0.2,
    warp: 0.18,
  },
  basin: {
    angle: 16,
    angleVariance: 36,
    scale: 0.84,
    bandWidth: 0.34,
    warp: 0.23,
  },
  braid: {
    angle: 42,
    angleVariance: 34,
    scale: 1.02,
    bandWidth: 0.22,
    warp: 0.29,
  },
  interference: {
    angle: 324,
    angleVariance: 30,
    scale: 1.14,
    bandWidth: 0.16,
    warp: 0.28,
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

function srgbToLinear(channel: number): number {
  const encoded = channel / 255;
  return encoded <= 0.04045
    ? encoded / 12.92
    : ((encoded + 0.055) / 1.055) ** 2.4;
}

function linearToSrgb(channel: number): number {
  const encoded =
    channel <= 0.0031308
      ? channel * 12.92
      : 1.055 * channel ** (1 / 2.4) - 0.055;
  return Math.round(Math.min(1, Math.max(0, encoded)) * 255);
}

function mixHex(parent: string, branch: string, branchWeight: number): string {
  const a = parseHex(parent);
  const b = parseHex(branch);
  const channels = a.map((value, index) =>
    linearToSrgb(
      srgbToLinear(value) * (1 - branchWeight) +
        srgbToLinear(b[index]) * branchWeight,
    ),
  );
  return `#${channels.map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

function inheritPalette(
  parent: AgentPalette | undefined,
  role: Role,
): AgentPalette {
  if (!parent) return ROLE_BRANCHES[role];

  const branch = ROLE_BRANCHES[role];
  return {
    absorption: mixHex(parent.absorption, branch.absorption, 0.66),
    body: mixHex(parent.body, branch.body, 0.66),
    current: mixHex(parent.current, branch.current, 0.78),
    counter: mixHex(parent.counter, branch.counter, 0.82),
    caustic: mixHex(parent.caustic, branch.caustic, 0.74),
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function geometry(
  seed: number,
  topology: AgentTopologyKind,
  parent: AgentIdentity | undefined,
  relation: AgentRelation,
): AgentFieldGeometry {
  const profile = TOPOLOGY_PROFILES[topology];
  const baseAngle =
    profile.angle + (channel(seed, 0) - 0.5) * profile.angleVariance;
  const scale = profile.scale * (0.92 + channel(seed, 1) * 0.16);
  const bandWidth = profile.bandWidth * (0.9 + channel(seed, 2) * 0.2);
  const warp = profile.warp * (0.88 + channel(seed, 3) * 0.24);
  const phaseX = -0.82 + channel(seed, 4) * 1.64;
  const phaseY = -0.76 + channel(seed, 5) * 1.52;
  const causticX = 22 + channel(seed, 6) * 56;
  const causticY = 15 + channel(seed, 7) * 49;
  const driftSeconds = 12 + channel(seed, 8) * 6;

  if (relation !== "divide" || !parent) {
    return {
      angle: (baseAngle + 360) % 360,
      scale,
      bandWidth,
      warp,
      phaseX,
      phaseY,
      causticX,
      causticY,
      driftSeconds,
      mirror: 1,
    };
  }

  const sharesTopology = parent.topology === topology;
  const source = parent.geometry;

  return {
    angle: sharesTopology
      ? (360 - source.angle) % 360
      : (360 - baseAngle + 360) % 360,
    scale: sharesTopology
      ? clamp(source.scale * (0.96 + channel(seed, 1) * 0.08), 0.64, 1.42)
      : scale,
    bandWidth: sharesTopology
      ? clamp(source.bandWidth * (0.94 + channel(seed, 2) * 0.12), 0.1, 0.42)
      : bandWidth,
    warp: sharesTopology
      ? clamp(source.warp * (0.94 + channel(seed, 3) * 0.12), 0.12, 0.48)
      : warp,
    phaseX: -source.phaseX + (channel(seed, 4) - 0.5) * 0.12,
    phaseY: source.phaseY + (channel(seed, 5) - 0.5) * 0.12,
    causticX: 100 - source.causticX,
    causticY: clamp(source.causticY + (channel(seed, 7) - 0.5) * 6, 12, 76),
    driftSeconds: sharesTopology
      ? clamp(source.driftSeconds + (channel(seed, 8) - 0.5) * 1.4, 11, 19)
      : driftSeconds,
    mirror: source.mirror === 1 ? -1 : 1,
  };
}

export function createAgentIdentity({
  id,
  role,
  parent,
  relation,
}: CreateAgentIdentityOptions): AgentIdentity {
  const resolvedRelation: AgentRelation = parent
    ? (relation ?? "spawn")
    : "root";
  const lineageSeed = parent?.lineageSeed ?? hash(`1321:${id}:${role}`);
  const seed = hash(
    `${parent?.seed ?? lineageSeed}:${resolvedRelation}:${role}:${id}`,
  );
  const topology = ROLE_TOPOLOGIES[role];

  return {
    key: parent ? `${parent.key}/${id}` : `${id}-root`,
    role,
    relation: resolvedRelation,
    seed,
    lineageSeed,
    topology,
    palette: inheritPalette(parent?.palette, role),
    geometry: geometry(seed, topology, parent, resolvedRelation),
  };
}

export const ORCHESTRATOR_IDENTITY = createAgentIdentity({
  id: "orchestrator",
  role: "orchestrator",
});

/** Build every worker identity once from the manifest's parentage, never from render order. */
export function createAgentIdentityMap(
  agents: readonly AgentSpec[],
): Record<string, AgentIdentity> {
  const specs = new Map(agents.map((agent) => [agent.id, agent]));
  const identities: Record<string, AgentIdentity> = {
    orchestrator: ORCHESTRATOR_IDENTITY,
  };
  const resolving = new Set<string>();

  function resolve(id: string): AgentIdentity {
    const existing = identities[id];
    if (existing) return existing;

    const spec = specs.get(id);
    if (!spec || resolving.has(id)) return ORCHESTRATOR_IDENTITY;

    resolving.add(id);
    const parentId = spec.divided_from ?? spec.parent ?? "orchestrator";
    const parent =
      parentId === "orchestrator" ? ORCHESTRATOR_IDENTITY : resolve(parentId);
    const identity = createAgentIdentity({
      id: spec.id,
      role: spec.role,
      parent,
      relation: spec.divided_from ? "divide" : "spawn",
    });
    resolving.delete(id);
    identities[id] = identity;
    return identity;
  }

  for (const agent of agents) resolve(agent.id);
  return identities;
}

type AgentIdentityStyle = CSSProperties & {
  "--agent-absorption": string;
  "--agent-body": string;
  "--agent-current": string;
  "--agent-counter": string;
  "--agent-caustic": string;
  "--agent-field-angle": string;
  "--agent-field-scale": string;
  "--agent-band-width": string;
  "--agent-warp": string;
  "--agent-phase-x": string;
  "--agent-phase-y": string;
  "--agent-caustic-x": string;
  "--agent-caustic-y": string;
  "--agent-drift": string;
  "--agent-field-mirror": string;
};

export function agentIdentityStyle(
  identity: AgentIdentity,
): AgentIdentityStyle {
  const { palette, geometry: field } = identity;
  return {
    "--agent-absorption": palette.absorption,
    "--agent-body": palette.body,
    "--agent-current": palette.current,
    "--agent-counter": palette.counter,
    "--agent-caustic": palette.caustic,
    "--agent-field-angle": `${field.angle.toFixed(2)}deg`,
    "--agent-field-scale": field.scale.toFixed(3),
    "--agent-band-width": field.bandWidth.toFixed(3),
    "--agent-warp": field.warp.toFixed(3),
    "--agent-phase-x": field.phaseX.toFixed(3),
    "--agent-phase-y": field.phaseY.toFixed(3),
    "--agent-caustic-x": `${field.causticX.toFixed(2)}%`,
    "--agent-caustic-y": `${field.causticY.toFixed(2)}%`,
    "--agent-drift": `${field.driftSeconds.toFixed(2)}s`,
    "--agent-field-mirror": `${field.mirror}`,
  };
}
