import type { AgentStatus, Role } from "./types";

const ROLE_TITLES: Record<Role, string> = {
  orchestrator: "Orchestrator",
  segment: "Segmenter",
  context: "Context",
  translate: "Translator",
  qc: "Verifier",
};

const ACTIVE_LABELS: Record<Role, string> = {
  orchestrator: "Coordinating",
  segment: "Mapping media",
  context: "Reading context",
  translate: "Translating",
  qc: "Checking evidence",
};

const ROLE_REMITS: Record<Role, string> = {
  orchestrator: "Coordinates the recorded run and its projected workers.",
  segment: "Maps the recorded source into inspectable ranges and marks.",
  context: "Resolves transcript terms against the recorded job context.",
  translate: "Drafts the assigned clip window in the target language.",
  qc: "Checks recorded measurements and publication gates.",
};

/**
 * The manifest label is the run-scoped public name when it differs from the machine id.
 * Older recorded runs used the id as their label, so they retain the role-title fallback.
 */
export function agentTitle(id: string, role: Role, label?: string): string {
  const publicLabel = label?.trim();
  if (publicLabel && publicLabel !== id) return publicLabel;
  if (role === "orchestrator") return ROLE_TITLES.orchestrator;
  const sequence = id.match(/(\d+)$/)?.[1];
  return sequence ? `${ROLE_TITLES[role]} ${sequence}` : ROLE_TITLES[role];
}

export function agentRoleTitle(role: Role): string {
  return ROLE_TITLES[role];
}

/** Compatibility presentation copy for recorded roles; never a runtime task objective. */
export function agentRoleRemit(role: Role): string {
  return ROLE_REMITS[role];
}

/** Status copy is role-aware, but never implies work the event stream has not recorded. */
export function agentState(
  status: AgentStatus,
  role: Role,
  stopped = false,
): string {
  if (stopped) return "Stopped";
  if (status === "spawning") return role === "orchestrator" ? "Starting" : "Joining";
  if (status === "working") return ACTIVE_LABELS[role];
  if (status === "reporting") {
    return role === "orchestrator" ? "Gathering reports" : "Reporting";
  }
  if (status === "gating") {
    return role === "orchestrator" ? "Resolving a gate" : "Testing a gate";
  }
  if (status === "retired" || status === "done") return "Complete";
  return "Waiting";
}
