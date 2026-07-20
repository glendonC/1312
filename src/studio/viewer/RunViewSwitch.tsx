// Direct import so Vite invalidates the switch styles on every surface that composes it,
// including the completed process view, which never mounts the viewer shell.
import "../../styles/studio/results.viewer.css";
import { Play, ProcessTree } from "../glyphs";

export type RunView = "result" | "process";

/**
 * The one control that moves between the two views of a completed run: the finished result and
 * its read-only completed process view. Pure presentation over view state the composing surface
 * owns — choosing Process never starts, resumes, or replays anything; it only changes which
 * already-established projection is on screen.
 */
export default function RunViewSwitch({
  view,
  onView,
}: {
  view: RunView;
  onView: (view: RunView) => void;
}) {
  return (
    <div className="run-view-switch" role="group" aria-label="Run view">
      <button
        type="button"
        className="run-view-btn"
        aria-pressed={view === "result"}
        onClick={() => onView("result")}
      >
        <Play />
        <span>Result</span>
      </button>
      <button
        type="button"
        className="run-view-btn"
        aria-pressed={view === "process"}
        onClick={() => onView("process")}
      >
        <ProcessTree />
        <span>Process</span>
      </button>
    </div>
  );
}
