import { useEffect } from "react";

import { useStudio } from "./store";

function typing(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
}

function onControl(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.closest('button, a, [role="button"]') !== null;
}

/** Space pauses or resumes a run unless the browser is handling text or an actual control. */
export default function useShortcuts(): void {
  useEffect(() => {
    function onKey(event: KeyboardEvent): void {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key !== " " || typing(event.target) || onControl(event.target)) return;

      const { stage, state, togglePause } = useStudio.getState();
      if (stage !== "run" || state.status !== "running") return;

      event.preventDefault();
      togglePause();
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
