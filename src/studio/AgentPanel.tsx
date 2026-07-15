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

import "../styles/studio/focus/index.css";
import AgentMark from "./AgentMark";
import { agentIdentityStyle, createAgentIdentityMap } from "./agentIdentity";
import { agentRoleRemit, agentRoleTitle, agentState, agentTitle } from "./agentPresentation";
import AgentFocusRail, {
  FOCUS_SECTIONS,
  SECTION_DESCRIPTIONS,
  SECTION_LABELS,
  type FocusSection,
} from "./focus/AgentFocusRail";
import AgentVisualEvidence from "./focus/AgentVisualEvidence";
import AssignmentPanel from "./focus/AssignmentPanel";
import HistoryPanel from "./focus/HistoryPanel";
import ResultsPanel from "./focus/ResultsPanel";
import WorkbenchPanel from "./focus/WorkbenchPanel";
import {
  useAgent,
  useAgentHistory,
  useAgentIds,
  useBundle,
  useStudio,
} from "./store";
import type { AgentStatus, Role } from "./types";

const FOCUSABLE = [
  'button:not([disabled]):not([tabindex="-1"])',
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
    description: "Recorded dispatches and the agents currently present in the topology.",
  },
  segment: {
    title: "Recorded media",
    description: "The source clip, inspection controls, waveform, and the agent's recorded marks.",
  },
  context: {
    title: "Term resolution",
    description: "Transcript terms resolved into the job context during this run.",
  },
  translate: {
    title: "Translation draft",
    description: "The assigned clip window and the latest draft recorded for this agent.",
  },
  qc: {
    title: "Gate review",
    description: "Recorded measurements and dispositions from the verification pass.",
  },
};

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
  const [section, setSection] = useState<FocusSection>("workbench");
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
    setSection("workbench");
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
  const environmentTitle = SECTION_LABELS[section];
  const environmentDescription = SECTION_DESCRIPTIONS[section];

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
    const currentIndex = FOCUS_SECTIONS.indexOf(section);
    let next: FocusSection | null = null;
    if (event.key === "Home") next = FOCUS_SECTIONS[0];
    if (event.key === "End") next = FOCUS_SECTIONS[FOCUS_SECTIONS.length - 1];
    if (["ArrowRight", "ArrowDown"].includes(event.key)) {
      next = FOCUS_SECTIONS[(currentIndex + 1) % FOCUS_SECTIONS.length];
    }
    if (["ArrowLeft", "ArrowUp"].includes(event.key)) {
      next = FOCUS_SECTIONS[(currentIndex - 1 + FOCUS_SECTIONS.length) % FOCUS_SECTIONS.length];
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
              <p id="agent-focus-state" className="agent-focus-state" data-status={status}>
                <span className="agent-focus-visually-hidden">Recorded state: </span>
                {state}
              </p>
              <span className="agent-focus-material-rule" aria-hidden="true" />
              <h2 id="agent-focus-title">{title}</h2>
              <span className="agent-focus-nameplate-rule" aria-hidden="true" />
              <p className="agent-focus-role-remit">
                <span className="agent-focus-visually-hidden">Recorded role remit: </span>
                {agentRoleRemit(role)}
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
            <AgentFocusRail
              section={section}
              closeButtonRef={closeButton}
              onSectionChange={changeSection}
              onSectionKeyDown={moveSectionFocus}
              onClose={() => select(null)}
            />

            <section className="agent-focus-environment" aria-labelledby="agent-environment-title">
              <header className="agent-focus-environment-head">
                <div>
                  <span>Recorded focus</span>
                  <h3 id="agent-environment-title">{environmentTitle}</h3>
                  <p>{environmentDescription}</p>
                </div>
              </header>

              <div className="agent-focus-body">
                <AgentVisualEvidence
                  title={title}
                  bundle={bundle}
                  agent={isOrchestrator ? null : agent!}
                  log={log}
                />

                <div className="agent-focus-detail">
                  {section === "workbench" && (
                    <WorkbenchPanel
                      role={role}
                      agent={isOrchestrator ? null : agent!}
                      state={state}
                      log={log}
                      environment={environment}
                      orchestratorNote={orchestrator.note}
                    />
                  )}
                  {section === "assignment" && (
                    <AssignmentPanel
                      selected={selected}
                      role={role}
                      agent={isOrchestrator ? null : agent!}
                      bundle={bundle}
                    />
                  )}
                  {section === "history" && <HistoryPanel title={title} log={log} />}
                  {section === "results" && (
                    <ResultsPanel
                      role={role}
                      agent={isOrchestrator ? null : agent!}
                      log={log}
                      orchestratorNote={orchestrator.note}
                    />
                  )}
                </div>
              </div>

              <footer className="agent-focus-environment-foot">
                <p role={previewSession ? "note" : undefined}>
                  {previewSession
                    ? "Recorded preview · The submitted source was not processed"
                    : "Recorded preview · Projected from this run's artifacts and events"}
                </p>
                <dl aria-label="Recorded agent identity">
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
              <div className="agent-focus-command-group">
                <div className="agent-focus-cycle-buttons">
                  <button type="button" onClick={() => move(-1)} aria-label="Previous agent">
                    <span aria-hidden="true">←</span>
                  </button>
                  <button type="button" onClick={() => move(1)} aria-label="Next agent">
                    <span aria-hidden="true">→</span>
                  </button>
                </div>
                <span className="agent-focus-cycle-label">
                  Cycle agents
                  <span aria-hidden="true">·</span>
                  <span className="agent-focus-command-position" aria-live="polite">
                    {selectedIndex + 1}/{inspectableIds.length}
                  </span>
                </span>
              </div>
              <button
                type="button"
                className="agent-focus-command-escape"
                onClick={() => select(null)}
                aria-label="Close focus"
              >
                <kbd aria-hidden="true">Esc</kbd>
                <span>Close</span>
              </button>
            </nav>
          </motion.div>
        </div>
      </motion.aside>
    </AnimatePresence>
  );
}
