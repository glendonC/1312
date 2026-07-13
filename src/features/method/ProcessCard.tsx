import { motion, useTransform, type MotionValue } from "motion/react";
import { steps, type MethodStep } from "./steps";

export default function ProcessCard({
  step,
  index,
  progress,
  active,
  desktop,
  onSelect,
}: {
  step: MethodStep;
  index: number;
  progress: MotionValue<number>;
  active: boolean;
  desktop: boolean;
  onSelect: () => void;
}) {
  const openness = useTransform(progress, (value) =>
    Math.max(0, 1 - Math.abs(value * (steps.length - 1) - index)),
  );
  const grow = useTransform(openness, [0, 1], [0.001, 1]);
  const panelOpacity = useTransform(openness, [0, 0.22, 1], [0, 0.08, 1]);
  const panelY = useTransform(openness, [0, 1], [22, 0]);

  return (
    <motion.li
      className={`process-card ${step.className}${active ? " is-active" : ""}`}
      style={{ flexGrow: desktop ? grow : active ? 1 : 0.001 }}
    >
      <button
        className="card-heading"
        type="button"
        aria-expanded={active}
        aria-controls={`process-panel-${index + 1}`}
        onClick={onSelect}
      >
        <span>
          <span className="card-index">[{String(index + 1).padStart(2, "0")}]</span>
          <span className="card-title">{step.title}</span>
        </span>
        <span className="card-state" aria-hidden="true">
          <span />
          <motion.span animate={{ rotate: active ? 0 : 90 }} transition={{ duration: 0.2 }} />
        </span>
      </button>

      <motion.div
        className="card-panel"
        id={`process-panel-${index + 1}`}
        aria-hidden={!active}
        style={{
          opacity: desktop ? panelOpacity : active ? 1 : 0,
          y: desktop ? panelY : active ? 0 : 22,
        }}
      >
        {step.graphic}
        <footer>{step.description}</footer>
      </motion.div>
    </motion.li>
  );
}
