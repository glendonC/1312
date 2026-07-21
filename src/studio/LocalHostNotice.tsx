import { useEffect, useId, useRef, useState } from "react";

import { GitHubLogo } from "./glyphs";
import "../styles/studio/local-host-notice.css";

const STORAGE_KEY = "1321.studio.localHostNotice.dismissed";
/** Public product repo. Same URL as SECURITY.md / github.com/glendonC/1321. */
const REPO_URL = "https://github.com/glendonC/1321";

/**
 * One-shot glass note for first Studio visits: live processing is local, not cloud.
 * Dismissed state is remembered in localStorage.
 */
export default function LocalHostNotice() {
  const titleId = useId();
  const bodyId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    try {
      if (window.localStorage.getItem(STORAGE_KEY) === "1") return;
    } catch {
      // Private mode or blocked storage: still show once this session.
    }
    setOpen(true);
  }, []);

  const dismiss = (): void => {
    try {
      window.localStorage.setItem(STORAGE_KEY, "1");
    } catch {
      // Ignore write failures; closing still clears this session.
    }
    setOpen(false);
  };

  useEffect(() => {
    if (!open) return undefined;
    closeRef.current?.focus();

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        try {
          window.localStorage.setItem(STORAGE_KEY, "1");
        } catch {
          // Ignore write failures; closing still clears this session.
        }
        setOpen(false);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  if (!open) return null;

  return (
    <div className="local-host-notice" role="presentation">
      <button
        type="button"
        className="local-host-notice-backdrop"
        aria-label="Dismiss notice"
        onClick={dismiss}
      />
      <div
        className="local-host-notice-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
      >
        <p className="local-host-notice-kicker" id={titleId}>
          Studio
        </p>
        <p className="local-host-notice-body" id={bodyId}>
          Live processing runs on your machine. This site has no cloud ingest yet.
          Clone the repo to run it locally.
        </p>
        <div className="local-host-notice-actions">
          <a
            className="ghost local-host-notice-link"
            href={REPO_URL}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Open 1321 on GitHub"
          >
            <GitHubLogo />
          </a>
          <button
            ref={closeRef}
            type="button"
            className="cta local-host-notice-dismiss"
            onClick={dismiss}
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}
