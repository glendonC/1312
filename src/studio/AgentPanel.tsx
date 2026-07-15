/**
 * A spatial focus mode for one agent.
 *
 * The recorded source remains fixed beside a neutral activity feed. The feed only renders
 * recorded events and never implies hidden model reasoning.
 */

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useRef } from "react";

import "../styles/studio/focus/index.css";
import AgentMark from "./AgentMark";
import { agentIdentityStyle, createAgentIdentityMap } from "./agentIdentity";
import { agentRoleRemit, agentState, agentTitle } from "./agentPresentation";
import AgentVisualEvidence from "./focus/AgentVisualEvidence";
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
  const title = agentTitle(selected, role, agent?.label);
  const state = agentState(status, role, cancelled);
  const log = isOrchestrator
    ? emitted.filter((trace) => trace.agent === "orchestrator")
    : history;
  const inspectableIds = ["orchestrator", ...spawnedIds];
  const selectedIndex = inspectableIds.indexOf(selected);
  const sourceTitle = bundle.run.clip.title
    || bundle.run.clip.media
    || bundle.run.clip.source.label
    || "Recorded source";

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
        transition={{ duration: 0.2 }}
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
        transition={{ duration: 0.2 }}
      >
        <div className="agent-focus-spatial" style={agentIdentityStyle(identity)}>
          <motion.section
            className="agent-focus-hero"
            key={`hero-${selected}`}
            initial={{ opacity: 0, x: -24, scale: 0.94 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
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
            className="agent-focus-shell"
            key={`focus-${selected}`}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
          >
            <section
              className="agent-focus-environment"
              aria-labelledby="agent-focus-source-title"
            >
              <header className="agent-focus-source-head">
                <h3 id="agent-focus-source-title">{sourceTitle}</h3>
              </header>

              <span className="agent-focus-stage-rule" data-edge="top" aria-hidden="true" />

              <div className="agent-focus-body">
                <div
                  className="agent-focus-media-instrument"
                >
                  <AgentVisualEvidence bundle={bundle} />
                </div>

                <aside
                  id="agent-focus-narrative"
                  className="agent-focus-activity-region"
                  aria-label="Recorded activity"
                >
                  <div className="agent-focus-activity-content">
                    <WorkbenchPanel
                      state={state}
                      log={log}
                    />
                  </div>
                </aside>
              </div>

              <span className="agent-focus-stage-rule" data-edge="bottom" aria-hidden="true" />
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
                ref={closeButton}
                type="button"
                className="agent-focus-command-escape"
                onClick={() => select(null)}
                aria-label="Close agent focus"
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
