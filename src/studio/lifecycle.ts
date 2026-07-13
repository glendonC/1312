/**
 * Agent lifecycle.
 *
 * A worker's status is a small state machine with an explicit transition table.
 * The orchestrator owns the real behaviour; this table is how the client refuses
 * to believe an impossible sequence (a retired worker cannot go back to work).
 * Illegal transitions are dropped and reported rather than silently applied, so a
 * malformed stream shows up as a bug instead of a plausible-looking UI.
 */

import type { AgentStatus } from "./types";

const LEGAL: Record<AgentStatus, AgentStatus[]> = {
  idle: ["spawning", "working"],
  spawning: ["working", "retired"],
  working: ["reporting", "gating", "working", "retired"],
  gating: ["working", "reporting", "gating", "retired"],
  reporting: ["working", "retired", "done"],
  retired: [],
  done: [],
};

export function canTransition(from: AgentStatus, to: AgentStatus): boolean {
  return LEGAL[from].includes(to);
}

/** Returns the next status, or the current one if the transition is illegal. */
export function transition(from: AgentStatus, to: AgentStatus): AgentStatus {
  if (from === to) return to;
  if (canTransition(from, to)) return to;

  if (import.meta.env.DEV) {
    console.warn(`[studio] illegal agent transition ${from} -> ${to}; ignoring`);
  }
  return from;
}

export const TERMINAL: AgentStatus[] = ["retired", "done"];

export function isTerminal(status: AgentStatus): boolean {
  return TERMINAL.includes(status);
}
