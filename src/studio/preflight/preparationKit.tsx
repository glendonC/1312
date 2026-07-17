import { AnimatePresence, motion } from "motion/react";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";

import { Check, CornerDownLeft, CornerDownRight, Edit } from "../glyphs";
import {
  PREPARATION_STAGES,
  preparationStageIndex,
  type PreparationStage,
} from "./PreparationStages";

/**
 * Shared preparation kit. Every source-preparation surface — submitted YouTube
 * previews, the recorded demo, and owned local media — narrates each stage as one
 * conversational sentence, edits its parameters inside a glass popover, and drives
 * the flow from a single control shelf. These primitives live here so the three
 * surfaces stay one instrument instead of drifting apart.
 */

export const LANGUAGE_NAMES: Record<string, string> = { en: "English", ko: "Korean", ja: "Japanese" };

export function languageName(code: string): string {
  return LANGUAGE_NAMES[code] ?? code;
}

/** The stage body: a single spoken sentence with the focusable stage heading. */
export function StageConversation({
  headingRef,
  children,
}: {
  headingRef: RefObject<HTMLHeadingElement | null>;
  children: ReactNode;
}) {
  return (
    <div className="preflight-stage-conversation">
      <h2 ref={headingRef} id="preflight-stage-title" tabIndex={-1}>{children}</h2>
    </div>
  );
}

/** An inline chip marking a live, editable value inside a conversational sentence. */
export function ConversationValue({ children }: { children: ReactNode }) {
  return <span className="preflight-conversation-value">{children}</span>;
}

/**
 * The control shelf below the panel: Back · parameter-edit · Continue. The shelf
 * slides from behind the panel so its attachment seam is masked. `back` and
 * `parameter` are omitted on the source stage, leaving a single centered Continue.
 * The next control is always the form's submit button; its `actionLabel` is the
 * accessible name (e.g. "Continue to Range") the walk-through relies on.
 */
export function PreparationControlShelf({
  visible,
  stage,
  back,
  parameter,
  next,
}: {
  visible: boolean;
  stage: PreparationStage;
  back?: { label: string; onClick: () => void };
  parameter?: {
    label: string;
    actionLabel: string;
    open: boolean;
    popoverId: string;
    triggerRef: RefObject<HTMLButtonElement | null>;
    onToggle: () => void;
  };
  next: { label: string; actionLabel: string; disabled?: boolean };
}) {
  return (
    <AnimatePresence initial={false}>
      {visible && (
        <motion.div
          className="preflight-control-shelf"
          data-stage={stage}
          role="group"
          aria-label="Preparation controls"
          initial={{ opacity: 0, y: -5, scale: 0.985 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -4, scale: 0.985 }}
          transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
        >
          {back && (
            <button
              type="button"
              className="preflight-control preflight-control-previous"
              aria-label={back.label}
              onClick={back.onClick}
            >
              <span className="preflight-control-icon">
                <CornerDownLeft />
              </span>
              <span className="preflight-control-label">Back</span>
            </button>
          )}
          {parameter && (
            <button
              ref={parameter.triggerRef}
              type="button"
              className="preflight-control preflight-control-parameter"
              aria-label={parameter.actionLabel}
              aria-haspopup="dialog"
              aria-expanded={parameter.open}
              aria-controls={parameter.popoverId}
              onClick={parameter.onToggle}
            >
              <span className="preflight-control-label">{parameter.label}</span>
              <span className="preflight-control-icon">
                <Edit />
              </span>
            </button>
          )}
          <button
            type="submit"
            className="preflight-control preflight-control-next"
            aria-label={next.actionLabel}
            disabled={next.disabled}
          >
            <span className="preflight-control-label">{next.label}</span>
            <span className="preflight-control-icon">
              <CornerDownRight />
            </span>
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/**
 * The parameter editor popover, anchored to its shelf trigger. It fixes itself to
 * the viewport and re-measures on resize/scroll; the range stage gets bespoke
 * placement so its taller body can flip above, below, or become a bottom sheet.
 */
export function PreparationStagePopover({
  id,
  stage,
  open,
  triggerRef,
  currentValue,
  onClose,
  children,
}: {
  id: string;
  stage: PreparationStage;
  open: boolean;
  triggerRef: RefObject<HTMLButtonElement | null>;
  currentValue: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const popoverRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const popover = popoverRef.current;
    const trigger = triggerRef.current;
    if (!popover || !trigger) return;

    const isOpen = () => popover.matches(":popover-open");
    if (!open) {
      if (isOpen()) popover.hidePopover();
      popover.dataset.positioned = "false";
      return;
    }

    const positionPopover = () => {
      const anchor = trigger.getBoundingClientRect();
      const visualViewport = window.visualViewport;
      const viewportLeft = visualViewport?.offsetLeft ?? 0;
      const viewportTop = visualViewport?.offsetTop ?? 0;
      const viewportWidth = visualViewport?.width ?? document.documentElement.clientWidth;
      const viewportHeight = visualViewport?.height ?? window.innerHeight;
      const viewportRight = viewportLeft + viewportWidth;
      const viewportBottom = viewportTop + viewportHeight;
      const edge = stage === "range" && viewportWidth <= 720 ? 16 : 8;
      const gap = stage === "range" ? 8 : 10;

      if (stage === "range") {
        const form = trigger.closest<HTMLElement>(".preflight-form");
        const panel = form?.querySelector<HTMLElement>(".preflight-stage-panel");
        const shelf = trigger.closest<HTMLElement>(".preflight-control-shelf");
        const lifecycle = document.querySelector<HTMLElement>(".studio-lifecycle-bar");
        const panelBounds = panel?.getBoundingClientRect();
        const shelfBounds = shelf?.getBoundingClientRect() ?? anchor;
        const lifecycleBounds = lifecycle?.getBoundingClientRect();
        const horizontalStart = Math.max(viewportLeft + edge, panelBounds?.left ?? viewportLeft + edge);
        const horizontalEnd = Math.min(viewportRight - edge, panelBounds?.right ?? viewportRight - edge);
        const width = Math.max(0, Math.min(372, horizontalEnd - horizontalStart));
        const left = Math.min(
          horizontalEnd - width,
          Math.max(horizontalStart, anchor.left + anchor.width / 2 - width / 2),
        );
        const lowerBoundary = lifecycleBounds && lifecycleBounds.top > shelfBounds.bottom
          ? Math.min(viewportBottom - edge, lifecycleBounds.top - 12)
          : viewportBottom - edge;
        const belowTop = shelfBounds.bottom + gap;
        const availableBelow = Math.max(0, lowerBoundary - belowTop);
        const availableAbove = Math.max(0, anchor.top - gap - (viewportTop + edge));

        popover.style.width = `${width}px`;
        const naturalHeight = Math.min(popover.scrollHeight, viewportHeight - edge * 2);
        let maxHeight = naturalHeight;
        let top = belowTop;
        let placement: "below" | "above" | "sheet" = "below";

        if (naturalHeight > availableBelow) {
          if (viewportWidth <= 720) {
            placement = "sheet";
            const sheetHeight = Math.min(
              naturalHeight,
              Math.max(0, lowerBoundary - (viewportTop + edge)),
            );
            maxHeight = sheetHeight;
            top = lowerBoundary - sheetHeight;
          } else if (availableAbove > availableBelow) {
            placement = "above";
            maxHeight = Math.min(naturalHeight, availableAbove);
            top = Math.max(viewportTop + edge, anchor.top - gap - maxHeight);
          } else {
            maxHeight = availableBelow;
          }
        }

        popover.style.maxHeight = `${Math.max(0, maxHeight)}px`;
        popover.style.left = `${left}px`;
        popover.style.top = `${top}px`;
        popover.dataset.placement = placement;
        popover.dataset.positioned = "true";
        return;
      }

      const preferredWidth = stage === "language" ? 390 : 350;
      const width = Math.min(preferredWidth, viewportWidth - edge * 2);
      const availableAbove = Math.max(72, anchor.top - gap - (viewportTop + edge));
      const maxHeight = Math.min(
        stage === "language" ? 460 : 320,
        viewportHeight - edge * 2,
        availableAbove,
      );

      popover.style.width = `${width}px`;
      popover.style.maxHeight = `${maxHeight}px`;

      const measuredHeight = Math.min(popover.scrollHeight, maxHeight);
      const left = Math.min(
        viewportRight - width - edge,
        Math.max(viewportLeft + edge, anchor.left + anchor.width / 2 - width / 2),
      );
      const top = Math.max(viewportTop + edge, anchor.top - gap - measuredHeight);

      popover.style.left = `${left}px`;
      popover.style.top = `${top}px`;
      popover.dataset.placement = "above";
      popover.dataset.positioned = "true";
    };

    const handleToggle = (event: Event) => {
      const toggle = event as Event & { newState?: "open" | "closed" };
      if (toggle.newState !== "closed") return;
      onClose();
      requestAnimationFrame(() => triggerRef.current?.focus({ preventScroll: true }));
    };

    popover.addEventListener("toggle", handleToggle);
    if (!isOpen()) popover.showPopover();
    positionPopover();

    const focusFrame = requestAnimationFrame(() => {
      const initialFocus = popover.querySelector<HTMLElement>(
        'input:checked, [data-popover-selected="true"], button, input, select',
      );
      initialFocus?.focus({ preventScroll: true });
    });
    const resizeObserver = new ResizeObserver(positionPopover);
    resizeObserver.observe(popover);
    window.addEventListener("resize", positionPopover);
    window.addEventListener("scroll", positionPopover, true);
    window.visualViewport?.addEventListener("resize", positionPopover);
    window.visualViewport?.addEventListener("scroll", positionPopover);

    return () => {
      cancelAnimationFrame(focusFrame);
      resizeObserver.disconnect();
      window.removeEventListener("resize", positionPopover);
      window.removeEventListener("scroll", positionPopover, true);
      window.visualViewport?.removeEventListener("resize", positionPopover);
      window.visualViewport?.removeEventListener("scroll", positionPopover);
      popover.removeEventListener("toggle", handleToggle);
    };
  }, [onClose, open, stage, triggerRef]);

  return (
    <div
      ref={popoverRef}
      id={id}
      className="preflight-stage-popover"
      data-popover-stage={stage}
      data-positioned="false"
      popover="auto"
      role="dialog"
      aria-label={`${PREPARATION_STAGES[preparationStageIndex(stage)].label} options`}
    >
      <header className="preflight-popover-head">
        <span>{PREPARATION_STAGES[preparationStageIndex(stage)].label}</span>
        {stage !== "range" && <strong>{currentValue}</strong>}
      </header>
      {children}
    </div>
  );
}

/** A radio option rendered as a check-marked row (language / output editors). */
export function Choice({
  label,
  ...input
}: {
  label: string;
  name: string;
  value: string;
  checked: boolean;
  disabled?: boolean;
  onChange?: () => void;
}) {
  return (
    <label className="preflight-choice" data-selected={input.checked ? "true" : undefined}>
      <input type="radio" {...input} />
      <span className="preflight-choice-label">{label}</span>
      <span className="preflight-choice-check" aria-hidden="true"><Check /></span>
    </label>
  );
}

/** A radio option with a leading dot indicator and trailing meta (range editor). */
export function RangeModeChoice({
  label,
  meta,
  accessibleLabel,
  disabled = false,
  ...input
}: {
  label: string;
  meta?: string;
  accessibleLabel: string;
  name: string;
  value: string;
  checked: boolean;
  disabled?: boolean;
  onChange: () => void;
}) {
  return (
    <label
      className="preflight-range-choice"
      data-selected={input.checked ? "true" : undefined}
      data-disabled={disabled ? "true" : undefined}
    >
      <input type="radio" aria-label={accessibleLabel} disabled={disabled} {...input} />
      <span className="preflight-range-choice-indicator" aria-hidden="true" />
      <strong>{label}</strong>
      {meta && <small>{meta}</small>}
    </label>
  );
}

/** A timestamp text field that stays editable as free text and normalizes on blur. */
export function TimestampField({
  label,
  value,
  max,
  describedBy,
  invalid,
  onChange,
}: {
  label: string;
  value: number;
  max: number;
  describedBy?: string;
  invalid: boolean;
  onChange: (value: number) => void;
}) {
  const [draft, setDraft] = useState(() => formatTimestamp(value));
  const [focused, setFocused] = useState(false);
  const parsedDraft = parseTimestamp(draft);

  useEffect(() => {
    if (!focused) setDraft(formatTimestamp(value));
  }, [focused, value]);

  function updateDraft(nextDraft: string): void {
    setDraft(nextDraft);
    const parsed = parseTimestamp(nextDraft);
    onChange(parsed ?? Number.NaN);
  }

  function normalizeDraft(): void {
    setFocused(false);
    const parsed = parseTimestamp(draft);
    if (parsed !== null) setDraft(formatTimestamp(parsed));
  }

  return (
    <label className="preflight-range-time-field">
      <span>{label}</span>
      <input
        type="text"
        inputMode="numeric"
        autoComplete="off"
        spellCheck={false}
        value={draft}
        aria-label={`${label} timestamp`}
        aria-describedby={describedBy}
        aria-invalid={invalid}
        data-over-source={parsedDraft !== null && parsedDraft > max ? "true" : undefined}
        onFocus={() => setFocused(true)}
        onChange={(event) => updateDraft(event.currentTarget.value)}
        onBlur={normalizeDraft}
        onKeyDown={(event) => {
          if (event.key !== "Enter") return;
          event.preventDefault();
          event.currentTarget.blur();
        }}
      />
    </label>
  );
}

/** Roving focus for the current-setup editor's list of parameter buttons. */
export function movePopoverFocus(event: ReactKeyboardEvent<HTMLElement>): void {
  if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
  const controls = [...event.currentTarget.querySelectorAll<HTMLElement>("[data-popover-option='true']")]
    .filter((control) => !control.hasAttribute("disabled"));
  if (controls.length === 0) return;

  event.preventDefault();
  const currentIndex = controls.indexOf(document.activeElement as HTMLElement);
  if (event.key === "Home") {
    controls[0].focus();
    return;
  }
  if (event.key === "End") {
    controls[controls.length - 1].focus();
    return;
  }
  const direction = event.key === "ArrowDown" ? 1 : -1;
  const nextIndex = currentIndex < 0
    ? direction > 0 ? 0 : controls.length - 1
    : (currentIndex + direction + controls.length) % controls.length;
  controls[nextIndex].focus();
}

export function parseTimestamp(input: string): number | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const parts = trimmed.split(":");
  if (parts.length > 3 || parts.some((part) => !/^\d+(?:\.\d+)?$/.test(part))) return null;

  const values = parts.map(Number);
  if (values.some((part) => !Number.isFinite(part))) return null;
  if (parts.length === 1) return values[0];
  if (values.at(-1)! >= 60) return null;
  if (parts.length === 2) return values[0] * 60 + values[1];
  if (values[1] >= 60) return null;
  return values[0] * 3_600 + values[1] * 60 + values[2];
}

export function formatTimestamp(value: number): string {
  if (!Number.isFinite(value)) return "";
  const safe = Math.max(0, value);
  const hours = Math.floor(safe / 3_600);
  const minutes = hours > 0 ? Math.floor((safe % 3_600) / 60) : Math.floor(safe / 60);
  const seconds = safe % 60;
  const shownSeconds = Number.isInteger(seconds)
    ? String(seconds).padStart(2, "0")
    : seconds.toFixed(1).padStart(4, "0");
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${shownSeconds}`
    : `${minutes}:${shownSeconds}`;
}

/** The accessible name for the shelf's Continue control on a non-terminal stage. */
export function continueActionLabel(stage: PreparationStage): string {
  return `Continue to ${PREPARATION_STAGES[preparationStageIndex(stage) + 1].label}`;
}
