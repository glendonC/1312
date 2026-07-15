import type { KeyboardEventHandler, Ref } from "react";

export const FOCUS_SECTIONS = ["workbench", "assignment", "history", "results"] as const;
export type FocusSection = (typeof FOCUS_SECTIONS)[number];

export const SECTION_LABELS: Record<FocusSection, string> = {
  workbench: "Workbench",
  assignment: "Assignment",
  history: "History",
  results: "Results",
};

export const SECTION_DESCRIPTIONS: Record<FocusSection, string> = {
  workbench: "Visual source evidence beside this agent's recorded work and latest actions.",
  assignment: "Recorded role, media scope, lineage, and the fields this replay does not contain.",
  history: "Event-derived actions for this agent, shown newest first.",
  results: "Recorded outputs, dispositions, and measured activity without inferred performance.",
};

function FocusSectionIcon({ section }: { section: FocusSection }) {
  if (section === "history") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="7.5" />
        <path d="M12 7.8v4.6l3.2 1.8" />
        <path d="M7.2 3.9 5.4 5.7M16.8 3.9l1.8 1.8" />
      </svg>
    );
  }

  if (section === "assignment") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M8 5.5h8M9.5 3.8h5v3.4h-5z" />
        <path d="M6 5.5H4.8v14.2h14.4V5.5H18M8 11h8M8 15h5" />
      </svg>
    );
  }

  if (section === "results") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M5 18.5h14M7.5 16V9.5M12 16V5.5M16.5 16v-3.5" />
        <path d="m6.5 7 3-2.5 3 1.8 4.8-3" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="4" y="4.5" width="16" height="15" rx="1.5" />
      <path d="M4 9h16M9 9v10.5" />
      <path d="M12.5 13h4M12.5 16h3" />
    </svg>
  );
}

export default function AgentFocusRail({
  section,
  closeButtonRef,
  onSectionChange,
  onSectionKeyDown,
  onClose,
}: {
  section: FocusSection;
  closeButtonRef: Ref<HTMLButtonElement>;
  onSectionChange: (section: FocusSection) => void;
  onSectionKeyDown: KeyboardEventHandler<HTMLElement>;
  onClose: () => void;
}) {
  return (
    <div className="agent-focus-side-rail">
      <nav
        className="agent-focus-section-rail"
        role="tablist"
        aria-label="Focused agent sections"
        onKeyDown={onSectionKeyDown}
      >
        {FOCUS_SECTIONS.map((candidate) => (
          <button
            id={`agent-focus-${candidate}-tab`}
            key={candidate}
            type="button"
            role="tab"
            aria-selected={section === candidate}
            aria-controls={`agent-focus-${candidate}-panel`}
            tabIndex={section === candidate ? 0 : -1}
            onClick={() => onSectionChange(candidate)}
          >
            <span className="agent-focus-section-icon" aria-hidden="true">
              <FocusSectionIcon section={candidate} />
            </span>
            <span className="agent-focus-section-label" aria-hidden="true">
              {SECTION_LABELS[candidate]}
            </span>
            <span className="agent-focus-visually-hidden">
              {SECTION_LABELS[candidate]}
            </span>
          </button>
        ))}
      </nav>
      <button
        ref={closeButtonRef}
        type="button"
        className="agent-focus-rail-close"
        onClick={onClose}
        aria-label="Close agent focus"
      >
        <span className="agent-focus-section-icon" aria-hidden="true">×</span>
        <span className="agent-focus-section-label" aria-hidden="true">Close focus</span>
      </button>
    </div>
  );
}
