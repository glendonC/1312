/**
 * The studio's keys. There is one, and it is the one you actually press.
 *
 * A shortcut earns its place by being something you do over and over while you are looking at
 * the canvas. Holding a run is that. Navigating away from the instrument is not, which is why
 * there is no key for it — a shortcut whose job is to leave is a shortcut nobody needed.
 *
 * The hint is printed on the rail because the key works. If one ever stops being true, both
 * go.
 */

import { useEffect } from "react";

import { useStudio } from "./store";

/** Typing beats every shortcut. The dock has a URL field, and a space is a space in a URL. */
function typing(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;

  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return target.isContentEditable;
}

/**
 * Space activates whatever control has focus — that is the browser's job, not ours.
 *
 * Only controls, though. The canvas itself is focusable so it can be panned from the
 * keyboard, and swallowing Space there would mean the hold key silently stopped working
 * the moment you clicked the canvas, which is most of the time.
 */
function onAControl(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.closest('button, a, [role="button"]') !== null;
}

export default function useShortcuts(): void {
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (typing(e.target)) return;

      if (e.key !== " ") return;
      if (onAControl(e.target)) return;

      // Only while there is a run to hold. Otherwise a space is just a space.
      const { stage, state, togglePause } = useStudio.getState();
      if (stage !== "run" || state.status !== "running") return;

      e.preventDefault();
      togglePause();
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
