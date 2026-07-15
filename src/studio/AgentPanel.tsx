/**
 * A spatial focus mode for one agent.
 *
 * Selection changes the canvas state rather than opening an inspector beside it: the topology
 * recedes, the chosen identity becomes the left-hand anchor, and its recorded working medium
 * occupies the main squircle. The activity glass is secondary and never calls itself reasoning.
 */

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";

import "../styles/studio/focus.css";
import AgentMark from "./AgentMark";
import { agentIdentityStyle, createAgentIdentityMap } from "./agentIdentity";
import { agentRoleTitle, agentState, agentTitle } from "./agentPresentation";
import { clock } from "./format";
import {
  useAgent,
  useAgentHistory,
  useAgentIds,
  useBundle,
  useStudio,
} from "./store";
import type { AgentView } from "./replay";
import type { AgentStatus, Role, Trace } from "./types";
import Workspace from "./Workspace";

const FOCUSABLE = [
  "button:not([disabled])",
  "a[href]",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "summary",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

const ENVIRONMENT_COPY: Record<Role, { title: string; description: string }> = {
  orchestrator: {
    title: "Run coordination",
    description: "Recorded dispatches and the workers currently present in the topology.",
  },
  segment: {
    title: "Recorded media",
    description: "The source clip, inspection controls, waveform, and the worker's recorded marks.",
  },
  context: {
    title: "Term resolution",
    description: "Transcript terms resolved into the job context during this run.",
  },
  translate: {
    title: "Translation draft",
    description: "The assigned clip window and the latest draft recorded for this worker.",
  },
  qc: {
    title: "Gate review",
    description: "Recorded measurements and dispositions from the verification pass.",
  },
};

function ActivityLog({ title, log }: { title: string; log: Trace[] }) {
  const newestFirst = useMemo(() => [...log].reverse(), [log]);
  const [expanded, setExpanded] = useState(true);

  useEffect(() => {
    const compact = window.matchMedia("(max-width: 720px)");
    const sync = () => setExpanded(!compact.matches);
    sync();
    compact.addEventListener("change", sync);
    return () => compact.removeEventListener("change", sync);
  }, []);

  return (
    <details
      className="agent-focus-activity"
      open={expanded}
      onToggle={(event) => setExpanded(event.currentTarget.open)}
    >
      <summary>
        <span>Recorded activity</span>
        <strong>{log.length} action{log.length === 1 ? "" : "s"}</strong>
      </summary>

      {newestFirst.length > 0 ? (
        <ol className="agent-focus-log" aria-label={`${title} activity, newest first`}>
          {newestFirst.map((trace, index) => (
            <li
              className="agent-focus-log-row"
              key={`${trace.t}-${trace.action}-${index}`}
              data-level={trace.level}
            >
              <time>{clock(trace.t, true)}</time>
              <span className="agent-focus-log-action">{trace.action}</span>
              {trace.target && <strong>{trace.target}</strong>}
              {trace.detail && <p>{trace.detail}</p>}
            </li>
          ))}
        </ol>
      ) : (
        <p className="agent-focus-empty">No recorded activity yet.</p>
      )}
    </details>
  );
}

function CoordinationEnvironment({
  note,
  agents,
  statuses,
}: {
  note: string;
  agents: { id: string; role: Role }[];
  statuses: Record<string, AgentView>;
}) {
  return (
    <div className="coordination-env">
      <section className="coordination-note">
        <span>Current coordination</span>
        <p>{note}</p>
      </section>

      <ol className="coordination-workers" aria-label="Workers in the recorded topology">
        {agents.map((spec) => {
          const worker = statuses[spec.id];
          return (
            <li key={spec.id} data-status={worker?.status ?? "idle"}>
              <span className="coordination-worker-role">{agentRoleTitle(spec.role)}</span>
              <strong>{agentTitle(spec.id, spec.role)}</strong>
              <span>{worker ? agentState(worker.status, spec.role) : "Not present yet"}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function AgentEnvironment({
  role,
  agent,
  orchestratorNote,
}: {
  role: Role;
  agent: AgentView | null;
  orchestratorNote: string;
}) {
  const bundle = useBundle();
  const statuses = useStudio((state) => state.state.agents);
  if (!bundle) return null;

  if (role === "orchestrator") {
    return (
      <CoordinationEnvironment
        note={orchestratorNote}
        agents={bundle.run.agents}
        statuses={statuses}
      />
    );
  }

  return agent ? <Workspace agent={agent} scale="focus" /> : null;
}

export default function AgentPanel() {
  const selected = useStudio((state) => state.selected);
  const select = useStudio((state) => state.select);
  const bundle = useBundle();
  const spawnedIds = useAgentIds();
  const agent = useAgent(selected ?? "");
  const history = useAgentHistory(selected);
  const orchestrator = useStudio((state) => state.state.orchestrator);
  const emitted = useStudio((state) => state.state.emitted);
  const cancelled = useStudio((state) => state.outcome?.kind === "cancelled");
  const paused = useStudio((state) => state.paused);
  const closeButton = useRef<HTMLButtonElement>(null);
  const priorFocus = useRef<HTMLElement | null>(null);
  const open = selected !== null;

  const identities = useMemo(
    () => createAgentIdentityMap(bundle?.run.agents ?? []),
    [bundle],
  );

  useEffect(() => {
    if (!open) return undefined;
    priorFocus.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const frame = window.requestAnimationFrame(() => closeButton.current?.focus());

    return () => {
      window.cancelAnimationFrame(frame);
      const previous = priorFocus.current;
      if (previous?.isConnected) {
        window.requestAnimationFrame(() => previous.focus());
      }
    };
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      select(null);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [open, select]);

  if (!selected || !bundle) return <AnimatePresence />;

  const isOrchestrator = selected === "orchestrator";
  if (!isOrchestrator && !agent) return <AnimatePresence />;

  const role = (isOrchestrator ? "orchestrator" : agent!.role) as Role;
  const status = (isOrchestrator ? orchestrator.status : agent!.status) as AgentStatus;
  const identity = identities[selected];
  if (!identity) return <AnimatePresence />;
  const title = agentTitle(selected, role);
  const state = agentState(status, role, cancelled);
  const log = isOrchestrator
    ? emitted.filter((trace) => trace.agent === "orchestrator")
    : history;
  const latest = log[log.length - 1];
  const inspectableIds = ["orchestrator", ...spawnedIds];
  const selectedIndex = inspectableIds.indexOf(selected);
  const environment = ENVIRONMENT_COPY[role];

  const move = (direction: -1 | 1) => {
    if (inspectableIds.length < 2) return;
    const next = (selectedIndex + direction + inspectableIds.length) % inspectableIds.length;
    select(inspectableIds[next]);
  };

  const trapFocus = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key !== "Tab") return;
    const controls = [...event.currentTarget.querySelectorAll<HTMLElement>(FOCUSABLE)]
      .filter((element) => element.offsetParent !== null);
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (!first || !last) return;

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <AnimatePresence>
      <motion.div
        key="agent-focus-backdrop"
        className="agent-focus-backdrop"
        aria-hidden="true"
        onClick={() => select(null)}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.24 }}
      />

      <motion.aside
        key="agent-focus-surface"
        className="agent-focus"
        data-role={role}
        data-status={status}
        role="dialog"
        aria-modal="true"
        aria-labelledby="agent-focus-title"
        aria-describedby="agent-focus-state"
        onKeyDown={trapFocus}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.24 }}
      >
        <div className="agent-focus-spatial" style={agentIdentityStyle(identity)}>
          <motion.section
            className="agent-focus-hero"
            key={`hero-${selected}`}
            initial={{ opacity: 0, x: -42, scale: 0.88 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            transition={{ type: "spring", stiffness: 250, damping: 30 }}
          >
            <div className="agent-focus-identity">
              <AgentMark
                identity={identity}
                status={status}
                fieldMotion={cancelled || paused ? "still" : "auto"}
              />
            </div>

            <div className="agent-focus-hero-copy">
              <span>{agentRoleTitle(role)}</span>
              <h2 id="agent-focus-title">{title}</h2>
              <p id="agent-focus-state" data-status={status}>{state}</p>
              <code>{selected}</code>
            </div>

            <div className="agent-focus-latest">
              <span>{latest ? "Latest recorded action" : "Current state"}</span>
              <strong>{latest?.target || state}</strong>
              <p>{latest?.detail || (isOrchestrator ? orchestrator.note : "No activity recorded yet.")}</p>
            </div>

            <nav className="agent-focus-switcher" aria-label="Choose focused agent">
              <button type="button" onClick={() => move(-1)} aria-label="Previous agent">←</button>
              <span>{selectedIndex + 1} / {inspectableIds.length}</span>
              <button type="button" onClick={() => move(1)} aria-label="Next agent">→</button>
            </nav>
          </motion.section>

          <motion.section
            className="agent-focus-environment"
            key={`environment-${selected}`}
            aria-labelledby="agent-environment-title"
            initial={{ opacity: 0, x: 48, scale: 0.94 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            transition={{ type: "spring", stiffness: 220, damping: 30, delay: 0.03 }}
          >
            <header className="agent-focus-environment-head">
              <div>
                <span>Agent environment</span>
                <h3 id="agent-environment-title">{environment.title}</h3>
                <p>{environment.description}</p>
              </div>
              <button
                ref={closeButton}
                type="button"
                className="agent-focus-close"
                onClick={() => select(null)}
                aria-label="Close agent focus"
              >
                ×
              </button>
            </header>

            <div className="agent-focus-workspace">
              <AgentEnvironment
                role={role}
                agent={isOrchestrator ? null : agent!}
                orchestratorNote={orchestrator.note}
              />
            </div>

            <footer className="agent-focus-environment-foot">
              Projected from this run's recorded artifacts and events
            </footer>
          </motion.section>

          <ActivityLog title={title} log={log} />
        </div>
      </motion.aside>
    </AnimatePresence>
  );
}
