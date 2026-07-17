import { motion } from "motion/react";

import {
  PREPARATION_STAGES,
  preparationStageIndex,
  type PreparationStage,
} from "./preflight/PreparationStages";

const SPRING = { type: "spring", stiffness: 280, damping: 32, mass: 0.7 } as const;

export type LifecycleBottomBarMode =
  | "resolving"
  | "preparation"
  | "initializing"
  | "failed"
  | "cancelled";

interface LifecycleBottomBarAction {
  label: string;
  onClick: () => void;
  emphasis?: "quiet" | "strong" | "danger";
  disabled?: boolean;
}

interface LifecycleBottomBarProps {
  mode: LifecycleBottomBarMode;
  title: string;
  stage?: PreparationStage;
  busy?: boolean;
  primaryAction?: LifecycleBottomBarAction;
  className?: string;
}

/**
 * The pre-run counterpart to Dock. It keeps Dock's fixed geometry and glass material,
 * but only projects lifecycle facts and actions that the current operation supports.
 */
export default function LifecycleBottomBar({
  mode,
  title,
  stage,
  busy = false,
  primaryAction,
  className = "",
}: LifecycleBottomBarProps) {
  const stageIndex = stage ? preparationStageIndex(stage) : -1;
  const palette = stageIndex >= 0 ? PREPARATION_STAGES[stageIndex].palette : "teal";
  const stageReadout = stage ? `${stageIndex + 1} / ${PREPARATION_STAGES.length}` : null;

  return (
    <motion.div
      className={`studio-bottom-bar-shell studio-lifecycle-bar${className ? ` ${className}` : ""}`}
      data-lifecycle-mode={mode}
      data-preparation-stage={stage}
      data-palette={palette}
      aria-label="Studio lifecycle"
      layout
      transition={SPRING}
    >
      <div className="dock-bar dock-bar-run studio-lifecycle-bar-content">
        <div className="dock-state">
          <span className="dock-status" role="status" aria-live="polite">
            <span
              className={busy ? "text-shimmer" : undefined}
              data-lifecycle-status={mode}
            >
              {title}{busy ? "…" : ""}
            </span>
          </span>
        </div>

        <span className="dock-pct studio-lifecycle-readout" aria-hidden={!stageReadout}>
          {stageReadout}
        </span>

        <div className="dock-actions">
          {primaryAction && (
            <button
              type="button"
              className="dock-stop"
              data-running={primaryAction.emphasis === "danger"}
              disabled={primaryAction.disabled}
              onClick={primaryAction.onClick}
            >
              {primaryAction.label}
            </button>
          )}
        </div>
      </div>
    </motion.div>
  );
}
