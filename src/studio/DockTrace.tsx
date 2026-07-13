/**
 * The run's progress, drawn around the dock's own outline.
 *
 * A bar sitting on the inside floor of the pill reads as a foreign object dropped into the
 * glass. The border is already a closed loop the eye follows, so the progress just fills it.
 *
 * It is measured, not guessed: the path is rebuilt from the dock's real box, so the trace
 * stays exactly on the edge at whatever width the layout spring lands on.
 */

import { motion } from "motion/react";

/** Perimeter of a pill: the two straight runs plus the two round caps. */
function perimeterOf(w: number, h: number): number {
  return 2 * Math.max(0, w - h) + Math.PI * h;
}

export default function DockTrace({
  box,
  done,
}: {
  box: { w: number; h: number };
  done: number;
}) {
  // The dock clips to its padding box, so the 2px stroke is centred 2px in: any closer to the
  // edge and the border shaves half the trace off.
  const w = Math.max(0, box.w - 4);
  const h = Math.max(0, box.h - 4);
  const perimeter = perimeterOf(w, h);

  if (perimeter <= 0) return null;

  return (
    <svg className="dock-trace" width={box.w} height={box.h} aria-hidden="true">
      <rect className="dock-trace-bed" x={2} y={2} width={w} height={h} rx={h / 2} ry={h / 2} />
      <motion.rect
        className="dock-trace-run"
        x={2}
        y={2}
        width={w}
        height={h}
        rx={h / 2}
        ry={h / 2}
        strokeDasharray={perimeter}
        initial={{ strokeDashoffset: perimeter }}
        animate={{ strokeDashoffset: perimeter * (1 - done) }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      />
    </svg>
  );
}
