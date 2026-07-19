/**
 * A spatial focus mode for one agent.
 *
 * The recorded source remains fixed beside a neutral activity feed. The feed only renders
 * recorded events and never implies hidden model reasoning.
 */

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useRef } from "react";

// Direct leaf imports so Vite invalidates each sheet; a CSS @import barrel can serve stale CSS until HMR.
import "../styles/studio/focus/shell.css";
import "../styles/studio/focus/commands.css";
import "../styles/studio/focus/evidence.css";
import "../styles/studio/focus/activity.css";
import AgentMark from "./AgentMark";
import { agentIdentityStyle, createAgentIdentityMap } from "./agentIdentity";
import { isAgentThinking } from "./agentMeshRenderer";
import { agentRoleRemit, agentState, agentTitle } from "./agentPresentation";
import { clock } from "./format";
import { spawnLeadOf } from "./spawnLead";
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
  const stateIsActive = isAgentThinking(status) && !cancelled && !paused;
  const log = isOrchestrator
    ? emitted.filter((trace) => trace.agent === "orchestrator")
    : history;
  const inspectableIds = ["orchestrator", ...spawnedIds];
  const selectedIndex = inspectableIds.indexOf(selected);
  const sourceTitle = bundle.run.clip.title
    || bundle.run.clip.media
    || bundle.run.clip.source.label
    || "Recorded source";

  // The lineage header, every row a recorded fact: who this worker came out of, the clip window it
  // owns, and when the log actually brought it online. It reads the same lineage the canvas draws
  // (a divided worker's gold mitosis wire) and the same `spawnLeadOf` seam the handoff describes,
  // so a spawning or divided worker tells one story in both places. Absent facts are simply not
  // shown — a worker with no window or an orchestrator with no parent narrates nothing.
  const spec = isOrchestrator
    ? null
    : bundle.run.agents.find((candidate) => candidate.id === selected) ?? null;
  const nameOf = (id: string): string => {
    if (id === "orchestrator") return "Orchestrator";
    const parentSpec = bundle.run.agents.find((candidate) => candidate.id === id);
    return parentSpec ? agentTitle(parentSpec.id, parentSpec.role, parentSpec.label) : id;
  };
  const dividedFrom = agent?.dividedFrom ?? spec?.divided_from ?? null;
  const spawnedBy = dividedFrom ?? spec?.parent ?? (isOrchestrator ? null : "orchestrator");
  const clipWindow = agent?.window ?? spec?.window ?? null;
  const birth = isOrchestrator
    ? ({ kind: "unavailable" } as const)
    : spawnLeadOf(selected, bundle.run, bundle.traces);
  const lineage: { label: string; value: string }[] = [];
  if (!isOrchestrator) {
    if (dividedFrom) lineage.push({ label: "Lineage", value: `Divided from ${nameOf(dividedFrom)}` });
    else if (spawnedBy) lineage.push({ label: "Lineage", value: `Spawned by ${nameOf(spawnedBy)}` });
    if (clipWindow) {
      lineage.push({
        label: "Window",
        value: `${clock(clipWindow[0], true)}–${clock(clipWindow[1], true)}`,
      });
    }
    if (birth.kind === "instant") {
      lineage.push({ label: "Birth", value: `Joined at ${clock(birth.atS, true)}` });
    } else if (birth.kind === "intent") {
      lineage.push({
        label: "Birth",
        value: `Announced ${clock(birth.announcedAtS, true)}, joined ${clock(birth.readyAtS, true)}`,
      });
    }
  }

  const move = (direction: -1 | 1) => {
    if (inspectableIds.length < 2) return;
    const next = (selectedIndex + direction + inspectableIds.length) % inspectableIds.length;
    select(inspectableIds[next]);
    window.requestAnimationFrame(() => closeButton.current?.focus());
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

  const handleFocusKeys = (event: React.KeyboardEvent<HTMLElement>) => {
    trapFocus(event);
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;

    const target = event.target;
    if (
      target instanceof HTMLMediaElement ||
      (target instanceof HTMLElement && target.matches("input, textarea, select, [role='slider']"))
    ) {
      return;
    }

    event.preventDefault();
    move(event.key === "ArrowLeft" ? -1 : 1);
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
        onKeyDown={handleFocusKeys}
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
              <p
                id="agent-focus-state"
                className={`agent-focus-state${stateIsActive ? " text-shimmer" : ""}`}
                data-status={status}
              >
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

              {lineage.length > 0 && (
                <dl className="agent-focus-lineage" aria-label="Recorded lineage">
                  {lineage.map((row) => (
                    <div className="agent-focus-lineage-row" key={row.label}>
                      <dt>{row.label}</dt>
                      <dd>{row.value}</dd>
                    </div>
                  ))}
                </dl>
              )}

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
                  <button
                    type="button"
                    onClick={() => move(-1)}
                    aria-label="Previous agent"
                    aria-keyshortcuts="ArrowLeft"
                  >
                    <span aria-hidden="true">←</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => move(1)}
                    aria-label="Next agent"
                    aria-keyshortcuts="ArrowRight"
                  >
                    <span aria-hidden="true">→</span>
                  </button>
                </div>
                <span className="agent-focus-cycle-label">
                  <span className="agent-focus-cycle-eyebrow">Cycle agents</span>
                  <span className="agent-focus-cycle-position" aria-live="polite">
                    <span className="agent-focus-visually-hidden">Agent </span>
                    <span className="agent-focus-cycle-current">{selectedIndex + 1}</span>
                    <span className="agent-focus-cycle-of">of {inspectableIds.length}</span>
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
                <span className="agent-focus-escape-label">Close</span>
                <kbd aria-hidden="true">Esc</kbd>
              </button>
            </nav>
          </motion.div>
        </div>
      </motion.aside>
    </AnimatePresence>
  );
}
