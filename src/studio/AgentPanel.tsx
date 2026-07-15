/**
 * A spatial focus mode for one agent.
 *
 * Selection changes the canvas state rather than opening an inspector beside it: the topology
 * recedes, the chosen identity becomes the left-hand anchor, and its recorded working medium
 * occupies the main glass plane. Recorded activity stays inside that environment as evidence and
 * never calls itself reasoning.
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
  'button:not([disabled]):not([tabindex="-1"])',
  "a[href]",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "summary",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

type FocusSection = "workspace" | "activity";

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

function FocusSectionIcon({ section }: { section: FocusSection }) {
  if (section === "activity") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="7.5" />
        <path d="M12 7.8v4.6l3.2 1.8" />
        <path d="M7.2 3.9 5.4 5.7M16.8 3.9l1.8 1.8" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="4" y="4.5" width="16" height="15" rx="1.5" />
      <path d="M4 9h16M9 9v10.5" />
      <path d="M12.5 13h4M12.5 16h3" />
    </svg>
  );
}

function ActivityLog({
  title,
  log,
}: {
  title: string;
  log: Trace[];
}) {
  const newestFirst = useMemo(() => [...log].reverse(), [log]);

  return (
    <section
      id="agent-focus-activity-panel"
      className="agent-focus-activity"
      role="tabpanel"
      aria-labelledby="agent-focus-activity-tab"
    >
      <header className="agent-focus-activity-head">
        <span>Newest first</span>
        <strong>{log.length} action{log.length === 1 ? "" : "s"}</strong>
      </header>

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
    </section>
  );
}

function CoordinationEnvironment({
  note,
  agents,
  statuses,
}: {
  note: string;
  agents: { id: string; role: Role; label: string }[];
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
              <strong>{agentTitle(spec.id, spec.role, spec.label)}</strong>
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
  const previewSession = useStudio((state) => state.previewSession);
  const closeButton = useRef<HTMLButtonElement>(null);
  const priorFocus = useRef<HTMLElement | null>(null);
  const [section, setSection] = useState<FocusSection>("workspace");
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

  useEffect(() => {
    setSection("workspace");
  }, [selected]);

  if (!selected || !bundle) return <AnimatePresence />;

  const isOrchestrator = selected === "orchestrator";
  if (!isOrchestrator && !agent) return <AnimatePresence />;

  const role = (isOrchestrator ? "orchestrator" : agent!.role) as Role;
  const status = (isOrchestrator ? orchestrator.status : agent!.status) as AgentStatus;
  const identity = identities[selected];
  if (!identity) return <AnimatePresence />;
  const title = agentTitle(selected, role, agent?.label);
  const state = agentState(status, role, cancelled);
  const log = isOrchestrator
    ? emitted.filter((trace) => trace.agent === "orchestrator")
    : history;
  const inspectableIds = ["orchestrator", ...spawnedIds];
  const selectedIndex = inspectableIds.indexOf(selected);
  const environment = ENVIRONMENT_COPY[role];
  const environmentTitle = section === "workspace" ? environment.title : "Recorded activity";
  const environmentDescription = section === "workspace"
    ? environment.description
    : "Event-derived actions for this worker, shown newest first.";

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

  const changeSection = (next: FocusSection, moveFocus = false) => {
    setSection(next);
    if (moveFocus) {
      window.requestAnimationFrame(() => {
        document.getElementById(`agent-focus-${next}-tab`)?.focus();
      });
    }
  };

  const moveSectionFocus = (event: React.KeyboardEvent<HTMLElement>) => {
    let next: FocusSection | null = null;
    if (event.key === "Home") next = "workspace";
    if (event.key === "End") next = "activity";
    if (["ArrowLeft", "ArrowUp", "ArrowRight", "ArrowDown"].includes(event.key)) {
      next = section === "workspace" ? "activity" : "workspace";
    }
    if (!next) return;
    event.preventDefault();
    changeSection(next, true);
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
              <h2 id="agent-focus-title">{title}</h2>
              <p id="agent-focus-state" data-status={status}>
                <span className="agent-focus-visually-hidden">Recorded state: </span>
                {state}
              </p>
            </div>

          </motion.section>

          <motion.div
            className="agent-focus-environment-frame"
            key={`environment-${selected}`}
            initial={{ opacity: 0, x: 48, scale: 0.94 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            transition={{ type: "spring", stiffness: 220, damping: 30, delay: 0.03 }}
          >
            <nav
              className="agent-focus-section-rail"
              role="tablist"
              aria-label="Focused worker sections"
              onKeyDown={moveSectionFocus}
            >
              <button
                id="agent-focus-workspace-tab"
                type="button"
                role="tab"
                aria-selected={section === "workspace"}
                aria-controls="agent-focus-workspace-panel"
                tabIndex={section === "workspace" ? 0 : -1}
                onClick={() => changeSection("workspace")}
                title="Workspace"
              >
                <FocusSectionIcon section="workspace" />
                <span className="agent-focus-visually-hidden">Workspace</span>
              </button>
              <button
                id="agent-focus-activity-tab"
                type="button"
                role="tab"
                aria-selected={section === "activity"}
                aria-controls="agent-focus-activity-panel"
                tabIndex={section === "activity" ? 0 : -1}
                onClick={() => changeSection("activity")}
                title="Recorded activity"
              >
                <FocusSectionIcon section="activity" />
                <span className="agent-focus-visually-hidden">Recorded activity</span>
              </button>
            </nav>

            <section className="agent-focus-environment" aria-labelledby="agent-environment-title">
              <header className="agent-focus-environment-head">
                <div>
                  <span>Recorded focus</span>
                  <h3 id="agent-environment-title">{environmentTitle}</h3>
                  <p>{environmentDescription}</p>
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

              {section === "workspace" ? (
                <div
                  id="agent-focus-workspace-panel"
                  className="agent-focus-workspace"
                  role="tabpanel"
                  aria-labelledby="agent-focus-workspace-tab"
                >
                  <AgentEnvironment
                    role={role}
                    agent={isOrchestrator ? null : agent!}
                    orchestratorNote={orchestrator.note}
                  />
                </div>
              ) : (
                <ActivityLog title={title} log={log} />
              )}

              <footer className="agent-focus-environment-foot">
                <p role={previewSession ? "note" : undefined}>
                  {previewSession
                    ? "Recorded preview · The submitted source was not processed"
                    : "Recorded preview · Projected from this run's artifacts and events"}
                </p>
                <dl aria-label="Recorded worker identity">
                  <div>
                    <dt>Role</dt>
                    <dd>{agentRoleTitle(role)}</dd>
                  </div>
                  <div>
                    <dt>ID</dt>
                    <dd><code>{selected}</code></dd>
                  </div>
                </dl>
              </footer>
            </section>

            <nav className="agent-focus-commands" aria-label="Agent focus commands">
              <div>
                <button type="button" onClick={() => move(-1)} aria-label="Previous agent">
                  <span aria-hidden="true">←</span>
                  Previous worker
                </button>
                <span className="agent-focus-command-position">
                  {selectedIndex + 1} / {inspectableIds.length}
                </span>
                <button type="button" onClick={() => move(1)} aria-label="Next agent">
                  Next worker
                  <span aria-hidden="true">→</span>
                </button>
              </div>
              <button type="button" onClick={() => select(null)} aria-label="Close focus">
                <kbd>Esc</kbd>
                Close
              </button>
            </nav>
          </motion.div>
        </div>
      </motion.aside>
    </AnimatePresence>
  );
}
