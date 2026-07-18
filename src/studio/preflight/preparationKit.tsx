import { AnimatePresence, motion } from "motion/react";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
} from "react";

/**
 * One motion language for the whole preparation surface. The panel resizes, its content changes,
 * and the shelf welded to its underside all share this ease and layout timing so a stage change
 * reads as a single coordinated breath — not three elements animating past each other. See
 * `PreparationStagePanel` (content + panel resize) and `PreparationControlShelf` (`layout`), wrapped
 * together in a `LayoutGroup` by each form so the shelf tracks the panel's new height in lockstep.
 */
const PREP_EASE = [0.22, 1, 0.36, 1] as const;
export const PREP_LAYOUT_TRANSITION = { layout: { duration: 0.36, ease: PREP_EASE } };

/**
 * The stage body enters from the direction of travel and the outgoing one leaves the opposite way:
 * forward (Continue) rises up and in, back (Back) drops down and in. `dir` is +1 forward, -1 back.
 */
const STAGE_BODY_VARIANTS = {
  enter: (dir: number) => ({ opacity: 0, y: dir >= 0 ? 14 : -14 }),
  center: { opacity: 1, y: 0 },
  exit: (dir: number) => ({ opacity: 0, y: dir >= 0 ? -12 : 12 }),
};

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

/**
 * The resizing panel that holds one stage's body. The old sentence animates out in the direction of
 * travel, then the new one animates in — one body is ever mounted, so sentences never overlap or
 * pile up (a `wait` handoff). As the incoming body settles it drives a new height, which the panel
 * `layout`-animates instead of snapping; each form wraps this and the shelf in a `LayoutGroup` so the
 * shelf tracks that height in lockstep and stays welded to the panel's underside.
 *
 * Focus lands on the freshly-arrived heading once it settles, read from the *entering* body via a
 * null-ignoring callback ref that always points at the live one.
 */
export function PreparationStagePanel({
  stage,
  direction,
  children,
}: {
  stage: string;
  direction: number;
  children: ReactNode;
}) {
  const activeBody = useRef<HTMLDivElement | null>(null);

  return (
    <motion.section
      className="preflight-stage-panel"
      aria-labelledby="preflight-stage-title"
      layout
      transition={PREP_LAYOUT_TRANSITION}
    >
      <AnimatePresence mode="wait" initial={false} custom={direction}>
        <motion.div
          key={stage}
          ref={(node) => {
            if (node) activeBody.current = node;
          }}
          className="preflight-stage-body"
          custom={direction}
          variants={STAGE_BODY_VARIANTS}
          initial="enter"
          animate="center"
          exit="exit"
          transition={{ duration: 0.28, ease: PREP_EASE }}
          onAnimationComplete={(definition) => {
            if (definition !== "center") return;
            activeBody.current
              ?.querySelector<HTMLElement>("#preflight-stage-title")
              ?.focus({ preventScroll: true });
          }}
        >
          {children}
        </motion.div>
      </AnimatePresence>
    </motion.section>
  );
}

/**
 * An inline chip marking a live value inside a conversational sentence. When an
 * `onEdit` handler is supplied the chip becomes a button that opens the stage's
 * editor; without one it stays static text (used for read-only source facts).
 */
export function ConversationValue({
  children,
  onEdit,
  editLabel,
}: {
  children: ReactNode;
  onEdit?: (anchor: HTMLButtonElement) => void;
  editLabel?: string;
}) {
  if (!onEdit) {
    return <span className="preflight-conversation-value">{children}</span>;
  }
  return (
    <button
      type="button"
      className="preflight-conversation-value preflight-conversation-value-editable"
      aria-label={editLabel}
      aria-haspopup="dialog"
      onClick={(event) => onEdit(event.currentTarget)}
    >
      {children}
    </button>
  );
}

/**
 * The control shelf below the panel: Back · parameter-edit · Continue. The shelf
 * slides from behind the panel so its attachment seam is masked. `back` and
 * `parameter` are omitted on the source stage, leaving a single centered Continue.
 * The next control is always the form's submit button; its `actionLabel` is the
 * accessible name (e.g. "Continue to Range") the walk-through relies on.
 */
interface ShelfParameter {
  label: string;
  actionLabel: string;
  open: boolean;
  popoverId: string;
  triggerRef: RefObject<HTMLButtonElement | null>;
  onToggle: () => void;
}

export function PreparationControlShelf({
  visible,
  stage,
  back,
  parameter,
  parameters,
  next,
}: {
  visible: boolean;
  stage: PreparationStage;
  back?: { label: string; onClick: () => void };
  parameter?: ShelfParameter;
  /** Multiple popover buttons for a stage that tucks away more than one panel. */
  parameters?: ShelfParameter[];
  next: { label: string; actionLabel: string; disabled?: boolean };
}) {
  const paramList = parameters ?? (parameter ? [parameter] : []);
  return (
    <AnimatePresence initial={false}>
      {visible && (
        <motion.div
          className="preflight-control-shelf"
          data-stage={stage}
          data-parameters={paramList.length}
          role="group"
          aria-label="Preparation controls"
          layout
          initial={{ opacity: 0, y: -5, scale: 0.985 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -4, scale: 0.985 }}
          transition={{ duration: 0.2, ease: PREP_EASE, ...PREP_LAYOUT_TRANSITION }}
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
          {paramList.map((param) => (
            <button
              key={param.popoverId}
              ref={param.triggerRef}
              type="button"
              className="preflight-control preflight-control-parameter"
              aria-label={param.actionLabel}
              aria-haspopup="dialog"
              aria-expanded={param.open}
              aria-controls={param.popoverId}
              onClick={param.onToggle}
            >
              <span className="preflight-control-label">{param.label}</span>
              <span className="preflight-control-icon">
                <Edit />
              </span>
            </button>
          ))}
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
  title,
  onClose,
  children,
}: {
  id: string;
  stage: PreparationStage;
  open: boolean;
  triggerRef: RefObject<HTMLButtonElement | null>;
  currentValue?: string;
  /** Overrides the stage-derived head label for popovers that aren't a stage parameter. */
  title?: string;
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
        const lowerBoundary = lifecycleBounds && lifecycleBounds.top > viewportTop + edge
          ? Math.min(viewportBottom - edge, lifecycleBounds.top - 12)
          : viewportBottom - edge;
        const belowTop = shelfBounds.bottom + gap;
        const availableBelow = Math.max(0, lowerBoundary - belowTop);
        const availableAbove = Math.max(0, anchor.top - gap - (viewportTop + edge));

        popover.style.width = `${width}px`;
        // `scrollHeight` excludes the border while `max-height` uses the border box. Include the
        // border so a popover that naturally fits is not made a couple of pixels too short and
        // given a phantom scrollbar.
        const borderHeight = popover.offsetHeight - popover.clientHeight;
        const naturalHeight = Math.min(popover.scrollHeight + borderHeight, viewportHeight - edge * 2);
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
        popover.dataset.scrollable = maxHeight + 0.5 < naturalHeight ? "true" : "false";
        popover.style.left = `${left}px`;
        popover.style.top = `${top}px`;
        popover.dataset.placement = placement;
        popover.dataset.positioned = "true";
        return;
      }

      const preferredWidth = stage === "language" ? 390 : 350;
      const width = Math.min(preferredWidth, viewportWidth - edge * 2);
      const preferredMax = stage === "language" ? 460 : 320;
      const roomAbove = Math.max(0, anchor.top - gap - (viewportTop + edge));
      const roomBelow = Math.max(0, viewportBottom - edge - (anchor.bottom + gap));

      popover.style.width = `${width}px`;
      const borderHeight = popover.offsetHeight - popover.clientHeight;
      const naturalHeight = Math.min(
        popover.scrollHeight + borderHeight,
        preferredMax,
        viewportHeight - edge * 2,
      );
      // Anchored to a low control (the shelf pill) the popover rises above it; anchored
      // to a chip high in the card it drops below. Flip to below when above is cramped
      // and below has at least as much room.
      const placeBelow = naturalHeight > roomAbove && roomBelow >= roomAbove;
      const maxHeight = Math.min(naturalHeight, Math.max(72, placeBelow ? roomBelow : roomAbove));

      const measuredHeight = Math.min(popover.scrollHeight, maxHeight);
      const left = Math.min(
        viewportRight - width - edge,
        Math.max(viewportLeft + edge, anchor.left + anchor.width / 2 - width / 2),
      );
      const top = placeBelow
        ? anchor.bottom + gap
        : Math.max(viewportTop + edge, anchor.top - gap - measuredHeight);

      popover.style.maxHeight = `${maxHeight}px`;
      popover.dataset.scrollable = maxHeight + 0.5 < naturalHeight ? "true" : "false";
      popover.style.left = `${left}px`;
      popover.style.top = `${top}px`;
      popover.dataset.placement = placeBelow ? "below" : "above";
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
    // A constrained popover's border box does not resize when conditional editor content mounts;
    // its scroll area grows instead. Observe the subtree too so the popover is remeasured before
    // that temporary constraint can become a persistent scrollbar.
    const mutationObserver = new MutationObserver(positionPopover);
    mutationObserver.observe(popover, { childList: true, subtree: true, characterData: true });
    window.addEventListener("resize", positionPopover);
    window.addEventListener("scroll", positionPopover, true);
    window.visualViewport?.addEventListener("resize", positionPopover);
    window.visualViewport?.addEventListener("scroll", positionPopover);

    return () => {
      cancelAnimationFrame(focusFrame);
      resizeObserver.disconnect();
      mutationObserver.disconnect();
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
      aria-label={title ?? `${PREPARATION_STAGES[preparationStageIndex(stage)].label} options`}
    >
      <header className="preflight-popover-head">
        <span>{title ?? PREPARATION_STAGES[preparationStageIndex(stage)].label}</span>
        {stage !== "range" && currentValue && <strong>{currentValue}</strong>}
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
  meta?: ReactNode;
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
  accessibleLabel,
  value,
  max,
  describedBy,
  invalid,
  active,
  onActivate,
  onChange,
}: {
  label: string;
  accessibleLabel?: string;
  value: number;
  max: number;
  describedBy?: string;
  invalid: boolean;
  active?: boolean;
  onActivate?: () => void;
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
    <label className="preflight-range-time-field" data-active={active ? "true" : undefined}>
      <span>{label}</span>
      <input
        type="text"
        inputMode="numeric"
        autoComplete="off"
        spellCheck={false}
        value={draft}
        aria-label={accessibleLabel ?? `${label} timestamp`}
        aria-describedby={describedBy}
        aria-invalid={invalid}
        data-over-source={parsedDraft !== null && parsedDraft > max ? "true" : undefined}
        onFocus={() => {
          setFocused(true);
          onActivate?.();
        }}
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

/** Exact In/Out fields and directly owned trim grips for one submitted-source interval. */
export function RangeTrimControl({
  start,
  end,
  duration,
  maximumDuration,
  describedBy,
  invalid,
  onChange,
}: {
  start: number;
  end: number;
  duration: number;
  maximumDuration: number;
  describedBy?: string;
  invalid: boolean;
  onChange: (range: { start?: number; end?: number }) => void;
}) {
  const safeDuration = Math.max(1, duration);
  const [activeBoundary, setActiveBoundary] = useState<"start" | "end">("start");
  const trackRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    boundary: "start" | "end";
    pointerId: number;
    offsetX: number;
  } | null>(null);
  const startPlaced = Number.isFinite(start) && start >= 0 && start <= safeDuration;
  const endPlaced = Number.isFinite(end) && end >= 0 && end <= safeDuration;
  const ordered = startPlaced && endPlaced && end > start;
  const selectionDuration = Number.isFinite(start) && Number.isFinite(end) && end > start
    ? end - start
    : null;
  const startInvalid = !startPlaced || (Number.isFinite(end) && start >= end);
  const endInvalid = !endPlaced || (Number.isFinite(start) && end <= start);
  const durationInvalid = selectionDuration !== null && selectionDuration > maximumDuration;

  function position(value: number): number {
    return (value / safeDuration) * 100;
  }

  function boundaryValue(boundary: "start" | "end"): number {
    return boundary === "start" ? start : end;
  }

  function boundaryLimits(boundary: "start" | "end"): { minimum: number; maximum: number } {
    if (boundary === "start" && endPlaced) {
      return { minimum: 0, maximum: Math.max(0, end - Math.min(1, safeDuration)) };
    }
    if (boundary === "end" && startPlaced) {
      return { minimum: Math.min(safeDuration, start + Math.min(1, safeDuration)), maximum: safeDuration };
    }
    return { minimum: 0, maximum: safeDuration };
  }

  function selectBoundary(boundary: "start" | "end", value: number): void {
    const { minimum, maximum } = boundaryLimits(boundary);
    const nextValue = Math.min(maximum, Math.max(minimum, value));
    onChange({ [boundary]: Number(nextValue.toFixed(3)) });
  }

  function valueFromPointer(clientX: number, offsetX: number): number | null {
    const track = trackRef.current;
    if (!track) return null;
    const bounds = track.getBoundingClientRect();
    if (bounds.width <= 0) return null;
    const proportion = Math.min(1, Math.max(0, (clientX - offsetX - bounds.left) / bounds.width));
    if (proportion === 0) return 0;
    if (proportion === 1) return safeDuration;
    return Math.round(proportion * safeDuration);
  }

  function beginDrag(boundary: "start" | "end", event: ReactPointerEvent<HTMLDivElement>): void {
    if (event.button !== 0) return;
    const track = trackRef.current;
    if (!track) return;
    const bounds = track.getBoundingClientRect();
    const value = boundaryValue(boundary);
    const handleX = bounds.left + (value / safeDuration) * bounds.width;
    event.preventDefault();
    setActiveBoundary(boundary);
    event.currentTarget.focus({ preventScroll: true });
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      boundary,
      pointerId: event.pointerId,
      offsetX: event.clientX - handleX,
    };
  }

  function continueDrag(event: ReactPointerEvent<HTMLDivElement>): void {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const value = valueFromPointer(event.clientX, drag.offsetX);
    if (value !== null) selectBoundary(drag.boundary, value);
  }

  function endDrag(event: ReactPointerEvent<HTMLDivElement>): void {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function selectWithKeyboard(
    boundary: "start" | "end",
    event: ReactKeyboardEvent<HTMLDivElement>,
  ): void {
    const currentValue = boundaryValue(boundary);
    if (!Number.isFinite(currentValue)) return;
    let nextValue: number | null = null;
    const coarseStep = event.shiftKey ? 10 : 1;
    const { minimum, maximum } = boundaryLimits(boundary);
    if (event.key === "ArrowLeft" || event.key === "ArrowDown") nextValue = currentValue - coarseStep;
    if (event.key === "ArrowRight" || event.key === "ArrowUp") nextValue = currentValue + coarseStep;
    if (event.key === "PageDown") nextValue = currentValue - 10;
    if (event.key === "PageUp") nextValue = currentValue + 10;
    if (event.key === "Home") nextValue = minimum;
    if (event.key === "End") nextValue = maximum;
    if (nextValue === null) return;
    event.preventDefault();
    setActiveBoundary(boundary);
    selectBoundary(boundary, nextValue);
  }

  return (
    <div
      className="preflight-range-trim-control"
      data-invalid={invalid ? "true" : undefined}
      data-active-boundary={activeBoundary}
      role="group"
      aria-label="Custom range trim"
      aria-describedby={describedBy}
    >
      <div className="preflight-range-time-fields" role="group" aria-label="Range times">
        <TimestampField
          label="Start"
          accessibleLabel="Start timestamp"
          value={start}
          max={safeDuration}
          describedBy={describedBy}
          invalid={startInvalid}
          active={activeBoundary === "start"}
          onActivate={() => setActiveBoundary("start")}
          onChange={(nextStart) => onChange({ start: nextStart })}
        />
        <output
          className="preflight-range-duration"
          data-invalid={invalid || durationInvalid ? "true" : undefined}
          aria-label="Selected duration"
        >
          {selectionDuration === null ? "Range incomplete" : `${formatTimestamp(selectionDuration)} selected`}
        </output>
        <TimestampField
          label="End"
          accessibleLabel="End timestamp"
          value={end}
          max={safeDuration}
          describedBy={describedBy}
          invalid={endInvalid}
          active={activeBoundary === "end"}
          onActivate={() => setActiveBoundary("end")}
          onChange={(nextEnd) => onChange({ end: nextEnd })}
        />
      </div>
      <div className="preflight-range-source-strip" role="group" aria-label="Source range">
        <div
          ref={trackRef}
          className="preflight-range-trim-track"
          data-valid-geometry={ordered ? "true" : "false"}
          aria-hidden="true"
        >
          <span className="preflight-range-trim-rail" />
          {ordered && (
            <span
              className="preflight-range-trim-selection"
              data-invalid={invalid ? "true" : undefined}
              style={{ left: `${position(start)}%`, right: `${100 - position(end)}%` }}
            />
          )}
        </div>
        {(["start", "end"] as const).map((boundary) => {
          const value = boundaryValue(boundary);
          const placed = boundary === "start" ? startPlaced : endPlaced;
          const endpointInvalid = boundary === "start" ? startInvalid : endInvalid;
          if (!placed) return null;
          return (
            <div
              key={boundary}
              className="preflight-range-trim-handle"
              data-boundary={boundary}
              data-active={activeBoundary === boundary ? "true" : undefined}
              data-invalid={invalid || endpointInvalid ? "true" : undefined}
              style={{ left: `${position(value)}%` }}
              role="slider"
              tabIndex={0}
              aria-label={`${boundary === "start" ? "Start" : "End"} trim handle`}
              aria-orientation="horizontal"
              aria-valuemin={0}
              aria-valuemax={safeDuration}
              aria-valuenow={value}
              aria-valuetext={`${formatTimestamp(value)} ${boundary}`}
              aria-invalid={invalid || endpointInvalid}
              aria-describedby={describedBy}
              onFocus={() => setActiveBoundary(boundary)}
              onKeyDown={(event) => selectWithKeyboard(boundary, event)}
              onPointerDown={(event) => beginDrag(boundary, event)}
              onPointerMove={continueDrag}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
            >
              <span aria-hidden="true" />
            </div>
          );
        })}
      </div>
      <div className="preflight-range-source-scale" aria-hidden="true">
        <span>0:00</span>
        <span>{formatTimestamp(duration)} source</span>
      </div>
    </div>
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
