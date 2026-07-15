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

/** A stable public title for the same agent wherever it appears. */
export function agentTitle(id: string, role: Role): string {
  if (role === "orchestrator") return ROLE_TITLES.orchestrator;
  const sequence = id.match(/(\d+)$/)?.[1];
  return sequence ? `${ROLE_TITLES[role]} ${sequence}` : ROLE_TITLES[role];
}

export function agentRoleTitle(role: Role): string {
  return ROLE_TITLES[role];
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
