import { AnimatePresence, motion } from "motion/react";
import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";

import { Check, CornerDownLeft, CornerDownRight, Edit } from "../glyphs";
import type { StudioPreviewSession } from "../previewSession";
import type { RemoteSourceResolutionReceipt } from "../sourceResolution";
import { useStudio } from "../store";
import {
  SUBMITTED_PREPARATION_POLICY,
  type SubmittedSourceLanguageIntent,
  type SubmittedSourcePreparationRequest,
} from "../submittedPreparation";
import {
  formatSeconds,
  type AnalysisRequest,
  type PreflightSession,
  type RangeAssessment,
} from "./model";
import PreparationStageNavigation, {
  PREPARATION_STAGES,
  preparationStageIndex,
  type PreparationStage,
} from "./PreparationStages";

const LANGUAGE_NAMES: Record<string, string> = { en: "English", ko: "Korean", ja: "Japanese" };

interface SubmittedPreparationFormProps {
  resolution: RemoteSourceResolutionReceipt;
  previewSession: StudioPreviewSession;
  session: PreflightSession;
  assessment: RangeAssessment;
  update: (request: Partial<AnalysisRequest>) => void;
  updateSourceLanguage: (intent: SubmittedSourceLanguageIntent) => void;
  confirm: () => void;
}

export default function SubmittedPreparationForm({
  resolution,
  previewSession,
  session,
  assessment,
  update,
  updateSourceLanguage,
  confirm,
}: SubmittedPreparationFormProps) {
  const stage = useStudio((state) => state.preparationStage);
  const furthestStage = useStudio((state) => state.preparationFurthestStage);
  const initialization = useStudio((state) => state.initialization);
  const selectPreparationStage = useStudio((state) => state.selectPreparationStage);
  const advancePreparationStage = useStudio((state) => state.advancePreparationStage);
  const [editingStage, setEditingStage] = useState<PreparationStage | null>(null);
  const stageHeading = useRef<HTMLHeadingElement>(null);
  const parameterTrigger = useRef<HTMLButtonElement>(null);
  const durationSeconds = resolution.source.durationMs / 1_000;
  const preparation = previewSession.preparation;
  const currentStageIndex = preparationStageIndex(stage);
  const requestReady = assessment.canReplay && preparation.status === "ready";
  const blockingMessage = assessment.reason
    ?? (preparation.status === "invalid" ? preparation.message : null);
  const closeEditor = useCallback(() => setEditingStage(null), []);

  function selectStage(nextStage: PreparationStage): void {
    setEditingStage(null);
    selectPreparationStage(nextStage);
  }

  function submitStage(): void {
    if (stage === "confirm") {
      setEditingStage(null);
      confirm();
      return;
    }

    if ((stage === "range" || stage === "language" || stage === "output") && !requestReady) {
      return;
    }

    setEditingStage(null);
    advancePreparationStage();
  }

  function previousStage(): void {
    setEditingStage(null);
    selectPreparationStage(PREPARATION_STAGES[currentStageIndex - 1].id);
  }

  const advanceDisabled = initialization !== null ||
    ((stage === "range" || stage === "language" || stage === "output") && !requestReady);

  return (
    <form
      className="preflight-form"
      data-preparation-stage={stage}
      data-palette={PREPARATION_STAGES[currentStageIndex].palette}
      data-furthest-stage={PREPARATION_STAGES[furthestStage].id}
      data-preparation-status={preparation.status}
      data-submitted-preparation-request-id={
        preparation.status === "ready" ? preparation.request.requestId : undefined
      }
      onSubmit={(event) => {
        event.preventDefault();
        submitStage();
      }}
    >
      <PreparationStageNavigation
        currentStage={stage}
        furthestStage={furthestStage}
        selectStage={selectStage}
      />

      <motion.section
        className="preflight-stage-panel"
        aria-labelledby="preflight-stage-title"
        layout
        layoutId="studio-source-guide-panel"
        transition={{ layout: { duration: 0.32, ease: [0.22, 1, 0.36, 1] } }}
      >
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={stage}
            className="preflight-stage-body"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -5 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            onAnimationComplete={() => stageHeading.current?.focus({ preventScroll: true })}
          >
            {stage === "source" && (
              <SubmittedSourceStage
                headingRef={stageHeading}
                resolution={resolution}
              />
            )}

            {stage === "range" && (
              <SubmittedRangeStage
                headingRef={stageHeading}
                durationSeconds={durationSeconds}
                session={session}
                preparationStatus={preparation.status}
                blockingMessage={blockingMessage}
              />
            )}

            {stage === "language" && (
              <SubmittedLanguageStage
                headingRef={stageHeading}
                previewSession={previewSession}
                session={session}
                blockingMessage={blockingMessage}
              />
            )}

            {stage === "output" && (
              <SubmittedOutputStage
                headingRef={stageHeading}
                session={session}
              />
            )}

            {stage === "forecast" && preparation.status === "ready" && (
              <SubmittedForecast
                headingRef={stageHeading}
                resolution={resolution}
                request={preparation.request}
              />
            )}

            {stage === "confirm" && preparation.status === "ready" && (
              <SubmittedConfirmation
                headingRef={stageHeading}
                resolution={resolution}
                request={preparation.request}
              />
            )}
          </motion.div>
        </AnimatePresence>
      </motion.section>

      <AnimatePresence initial={false}>
        {initialization === null && (
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
            {stage !== "source" && (
              <button
                type="button"
                className="preflight-control preflight-control-previous"
                aria-label={`Back to ${PREPARATION_STAGES[currentStageIndex - 1].label}`}
                onClick={previousStage}
              >
                <span className="preflight-control-icon">
                  <CornerDownLeft />
                </span>
                <span className="preflight-control-label">Back</span>
              </button>
            )}
            {stage !== "source" && (
              <button
                ref={parameterTrigger}
                type="button"
                className="preflight-control preflight-control-parameter"
                aria-label={stageParameterActionLabel(stage, previewSession, session, durationSeconds)}
                aria-haspopup="dialog"
                aria-expanded={editingStage === stage}
                aria-controls={`preflight-${stage}-popover`}
                onClick={() => setEditingStage((current) => current === stage ? null : stage)}
              >
                <span className="preflight-control-label">
                  {stageParameterLabel(stage, previewSession, session, durationSeconds)}
                </span>
                <span className="preflight-control-icon">
                  <Edit />
                </span>
              </button>
            )}
            <button
              type="submit"
              className="preflight-control preflight-control-next"
              aria-label={advanceLabel(stage)}
              disabled={advanceDisabled}
            >
              <span className="preflight-control-label">
                {stage === "confirm" ? "Preview" : "Continue"}
              </span>
              <span className="preflight-control-icon">
                <CornerDownRight />
              </span>
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {stage !== "source" && initialization === null && (
        <PreparationStagePopover
          key={stage}
          id={`preflight-${stage}-popover`}
          stage={stage}
          open={editingStage === stage}
          triggerRef={parameterTrigger}
          currentValue={stageParameterLabel(stage, previewSession, session, durationSeconds)}
          onClose={closeEditor}
        >
          {stage === "range" && (
            <RangeEditor
              durationSeconds={durationSeconds}
              session={session}
              assessment={assessment}
              update={update}
            />
          )}
          {stage === "language" && (
            <LanguageEditor
              previewSession={previewSession}
              session={session}
              update={update}
              updateSourceLanguage={updateSourceLanguage}
            />
          )}
          {stage === "output" && <OutputEditor session={session} update={update} />}
          {(stage === "forecast" || stage === "confirm") && preparation.status === "ready" && (
            <CurrentSetupEditor request={preparation.request} selectStage={selectStage} />
          )}
        </PreparationStagePopover>
      )}
    </form>
  );
}

function SubmittedSourceStage({
  headingRef,
  resolution,
}: {
  headingRef: RefObject<HTMLHeadingElement | null>;
  resolution: RemoteSourceResolutionReceipt;
}) {
  const duration = formatSeconds(resolution.source.durationMs / 1_000);

  return (
    <section className="preflight-preparation preflight-source-stage">
      <div
        className="preflight-source-conversation"
        role="note"
        aria-label="Submitted source metadata boundary"
      >
        <h2 ref={headingRef} id="preflight-stage-title" tabIndex={-1}>
          I found{" "}
          <a
            className="preflight-source-link"
            href={resolution.source.canonicalUrl}
            target="_blank"
            rel="noreferrer"
            aria-label={resolution.source.label}
            title="Open on YouTube in a new tab"
          >
            {resolution.source.label}
          </a>
          {resolution.source.creator ? ` by ${resolution.source.creator}` : ""}. It’s {duration} long. I haven’t
          downloaded or processed the media.
        </h2>
      </div>
    </section>
  );
}

function SubmittedRangeStage({
  headingRef,
  durationSeconds,
  session,
  preparationStatus,
  blockingMessage,
}: {
  headingRef: RefObject<HTMLHeadingElement | null>;
  durationSeconds: number;
  session: PreflightSession;
  preparationStatus: StudioPreviewSession["preparation"]["status"];
  blockingMessage: string | null;
}) {
  const range = liveRangeLabel(session, durationSeconds);

  return (
    <section className="preflight-preparation">
      <StageConversation headingRef={headingRef}>
        I’ll prepare <ConversationValue>{range}</ConversationValue> from this source. The current limit is{" "}
        {formatSeconds(SUBMITTED_PREPARATION_POLICY.maximumDurationMs / 1_000)}, and I haven’t inspected the
        content to choose a section for you.
      </StageConversation>
      {preparationStatus === "building" && (
        <p className="preflight-binding" role="status">Updating the exact request…</p>
      )}
      {blockingMessage && <p className="preflight-block" role="status">{blockingMessage}</p>}
    </section>
  );
}

function SubmittedLanguageStage({
  headingRef,
  previewSession,
  session,
  blockingMessage,
}: {
  headingRef: RefObject<HTMLHeadingElement | null>;
  previewSession: StudioPreviewSession;
  session: PreflightSession;
  blockingMessage: string | null;
}) {
  const sourceIntent = liveSourceLanguageSentence(previewSession.sourceLanguage);
  const target = languageName(session.request.targetLanguage);

  return (
    <section className="preflight-preparation">
      <StageConversation headingRef={headingRef}>
        I’ll <ConversationValue>{sourceIntent}</ConversationValue> and request{" "}
        <ConversationValue>{target}</ConversationValue> output. Nothing has been detected yet.
      </StageConversation>
      {blockingMessage && <p className="preflight-block" role="status">{blockingMessage}</p>}
    </section>
  );
}

function SubmittedOutputStage({
  headingRef,
  session,
}: {
  headingRef: RefObject<HTMLHeadingElement | null>;
  session: PreflightSession;
}) {
  return (
    <section className="preflight-preparation">
      <StageConversation headingRef={headingRef}>
        I’ll request <ConversationValue>{liveOutputLabel(session.request.outputDepth)}</ConversationValue>.
        Processing still hasn’t started.
      </StageConversation>
    </section>
  );
}

function SubmittedForecast({
  headingRef,
  resolution,
  request,
}: {
  headingRef: RefObject<HTMLHeadingElement | null>;
  resolution: RemoteSourceResolutionReceipt;
  request: SubmittedSourcePreparationRequest;
}) {
  return (
    <section className="preflight-preparation">
      <StageConversation headingRef={headingRef}>
        I’ve bound <ConversationValue>{rangeLabel(request)}</ConversationValue>,{" "}
        <ConversationValue>{compactLanguageLabel(request)}</ConversationValue>, and{" "}
        <ConversationValue>{outputLabel(request)}</ConversationValue> to {resolution.source.label}. I still can’t
        forecast processing time, cost, scale, or workload until a compatible producer runs.
      </StageConversation>
    </section>
  );
}

function SubmittedConfirmation({
  headingRef,
  resolution,
  request,
}: {
  headingRef: RefObject<HTMLHeadingElement | null>;
  resolution: RemoteSourceResolutionReceipt;
  request: SubmittedSourcePreparationRequest;
}) {
  return (
    <section className="preflight-preparation">
      <StageConversation headingRef={headingRef}>
        I’m ready to open the recorded run-006 interface preview with{" "}
        <ConversationValue>{rangeLabel(request)}</ConversationValue>,{" "}
        <ConversationValue>{compactLanguageLabel(request)}</ConversationValue>, and{" "}
        <ConversationValue>{outputLabel(request)}</ConversationValue>. This replays the bundled demonstration; it
        won’t download or process {resolution.source.label}, and it does not submit a runtime command.
      </StageConversation>
    </section>
  );
}

function StageConversation({
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

function ConversationValue({ children }: { children: ReactNode }) {
  return <span className="preflight-conversation-value">{children}</span>;
}

function PreparationStagePopover({
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
      const viewportWidth = document.documentElement.clientWidth;
      const viewportHeight = window.innerHeight;
      const edge = 8;
      const gap = 10;
      const preferredWidth = stage === "range" ? 460 : stage === "language" ? 390 : 350;
      const width = Math.min(preferredWidth, viewportWidth - edge * 2);
      const availableAbove = Math.max(72, anchor.top - gap - edge);
      const maxHeight = Math.min(
        stage === "range" || stage === "language" ? 460 : 320,
        viewportHeight - edge * 2,
        availableAbove,
      );

      popover.style.width = `${width}px`;
      popover.style.maxHeight = `${maxHeight}px`;

      const measuredHeight = Math.min(popover.scrollHeight, maxHeight);
      const left = Math.min(
        viewportWidth - width - edge,
        Math.max(edge, anchor.left + anchor.width / 2 - width / 2),
      );
      const top = Math.max(edge, anchor.top - gap - measuredHeight);

      popover.style.left = `${left}px`;
      popover.style.top = `${top}px`;
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

    return () => {
      cancelAnimationFrame(focusFrame);
      resizeObserver.disconnect();
      window.removeEventListener("resize", positionPopover);
      window.removeEventListener("scroll", positionPopover, true);
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
        <strong>{currentValue}</strong>
      </header>
      {children}
    </div>
  );
}

function RangeEditor({
  durationSeconds,
  session,
  assessment,
  update,
}: {
  durationSeconds: number;
  session: PreflightSession;
  assessment: RangeAssessment;
  update: (request: Partial<AnalysisRequest>) => void;
}) {
  return (
    <fieldset className="preflight-group preflight-range-stage">
      <legend>Requested section</legend>
      <RangeInstrument
        durationSeconds={durationSeconds}
        start={session.request.start}
        end={session.request.end}
        overLimit={(assessment.duration ?? 0) > SUBMITTED_PREPARATION_POLICY.maximumDurationMs / 1_000}
      />
      <Choice
        name="range"
        value="entire"
        checked={session.request.rangeMode === "entire"}
        onChange={() => update({ rangeMode: "entire", start: 0, end: durationSeconds })}
        label={`Entire video · 0:00–${formatSeconds(durationSeconds)}`}
      />
      <Choice
        name="range"
        value="custom"
        checked={session.request.rangeMode === "custom"}
        onChange={() => update({ rangeMode: "custom" })}
        label="Custom start and end"
      />
      {session.request.rangeMode === "custom" && (
        <div className="preflight-range-fields">
          <NumberField
            label="Start, seconds"
            value={session.request.start}
            max={durationSeconds}
            onChange={(start) => update({ start })}
          />
          <NumberField
            label="End, seconds"
            value={session.request.end}
            max={durationSeconds}
            onChange={(end) => update({ end })}
          />
        </div>
      )}
      <p className="preflight-policy">
        {durationSeconds > SUBMITTED_PREPARATION_POLICY.maximumDurationMs / 1_000
          && "The visible 0:00–2:00 selection is an editable request default, not a content recommendation. "}
        No recommender or content detector has run.
      </p>
    </fieldset>
  );
}

function LanguageEditor({
  previewSession,
  session,
  update,
  updateSourceLanguage,
}: {
  previewSession: StudioPreviewSession;
  session: PreflightSession;
  update: (request: Partial<AnalysisRequest>) => void;
  updateSourceLanguage: (intent: SubmittedSourceLanguageIntent) => void;
}) {
  return (
    <div className="preflight-language-stage">
      <fieldset className="preflight-group preflight-language-intent">
        <legend>Source language request</legend>
        <Choice
          name="source-language"
          value="automatic"
          checked={previewSession.sourceLanguage.mode === "automatic"}
          onChange={() => updateSourceLanguage({ mode: "automatic", language: null })}
          label="Automatic · request detection later"
        />
        <Choice
          name="source-language"
          value="declared"
          checked={previewSession.sourceLanguage.mode === "declared"}
          onChange={() => updateSourceLanguage({ mode: "declared", language: "" })}
          label="Declare the source language"
        />
        {previewSession.sourceLanguage.mode === "declared" && (
          <label className="preflight-declared-language">
            <span>Declared BCP-47 language</span>
            <input
              type="text"
              autoComplete="off"
              placeholder="ko"
              value={previewSession.sourceLanguage.language}
              onChange={(event) => updateSourceLanguage({
                mode: "declared",
                language: event.currentTarget.value.trim(),
              })}
            />
          </label>
        )}
      </fieldset>
      <label className="preflight-target-language">
        <span>Requested target language</span>
        <select
          value={session.request.targetLanguage}
          onChange={(event) => update({ targetLanguage: event.currentTarget.value })}
        >
          <option value="en">English</option>
        </select>
      </label>
    </div>
  );
}

function OutputEditor({
  session,
  update,
}: {
  session: PreflightSession;
  update: (request: Partial<AnalysisRequest>) => void;
}) {
  return (
    <fieldset className="preflight-group preflight-output-stage">
      <legend>Requested output</legend>
      <Choice
        name="output"
        value="captions"
        checked={session.request.outputDepth === "captions"}
        onChange={() => update({ outputDepth: "captions" })}
        label="Captions only"
      />
      <Choice
        name="output"
        value="evidence"
        checked={session.request.outputDepth === "evidence"}
        onChange={() => update({ outputDepth: "evidence" })}
        label="Captions plus evidence and breakdown"
      />
    </fieldset>
  );
}

function CurrentSetupEditor({
  request,
  selectStage,
}: {
  request: SubmittedSourcePreparationRequest;
  selectStage: (stage: PreparationStage) => void;
}) {
  const parameters: Array<{ stage: PreparationStage; label: string; value: string }> = [
    { stage: "range", label: "Range", value: rangeLabel(request) },
    { stage: "language", label: "Language", value: compactLanguageLabel(request) },
    { stage: "output", label: "Output", value: outputLabel(request) },
  ];

  return (
    <div
      className="preflight-current-setup"
      role="group"
      aria-label="Current setup parameters"
      onKeyDown={movePopoverFocus}
    >
      {parameters.map((parameter) => (
        <button
          key={parameter.stage}
          type="button"
          data-palette={PREPARATION_STAGES[preparationStageIndex(parameter.stage)].palette}
          data-popover-option="true"
          onClick={() => selectStage(parameter.stage)}
          aria-label={`Edit ${parameter.label.toLowerCase()}: ${parameter.value}`}
        >
          <span>{parameter.label}</span>
          <strong>{parameter.value}</strong>
          <i aria-hidden="true"><Edit /></i>
        </button>
      ))}
    </div>
  );
}

function RangeInstrument({
  durationSeconds,
  start,
  end,
  overLimit,
}: {
  durationSeconds: number;
  start: number;
  end: number;
  overLimit: boolean;
}) {
  const safeDuration = Math.max(0.1, durationSeconds);
  const safeStart = Math.max(0, Math.min(start, safeDuration));
  const safeEnd = Math.max(safeStart, Math.min(end, safeDuration));
  const style = {
    "--range-start": `${(safeStart / safeDuration) * 100}%`,
    "--range-width": `${((safeEnd - safeStart) / safeDuration) * 100}%`,
    "--range-limit": `${Math.min(1, (SUBMITTED_PREPARATION_POLICY.maximumDurationMs / 1_000) / safeDuration) * 100}%`,
  } as CSSProperties;

  return (
    <div className="preflight-range-instrument" data-over-limit={overLimit ? "true" : undefined}>
      <div className="preflight-range-track" style={style} aria-hidden="true">
        <span />
      </div>
      <div className="preflight-range-readout" aria-hidden="true">
        <span>0:00</span>
        <b>{formatSeconds(safeStart)}–{formatSeconds(safeEnd)}</b>
        <span>{formatSeconds(durationSeconds)}</span>
      </div>
    </div>
  );
}

function Choice({
  label,
  ...input
}: {
  label: string;
  name: string;
  value: string;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <label className="preflight-choice" data-selected={input.checked ? "true" : undefined}>
      <input type="radio" {...input} />
      <span className="preflight-choice-label">{label}</span>
      <span className="preflight-choice-check" aria-hidden="true"><Check /></span>
    </label>
  );
}

function movePopoverFocus(event: ReactKeyboardEvent<HTMLElement>): void {
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

function NumberField({
  label,
  value,
  max,
  onChange,
}: {
  label: string;
  value: number;
  max: number;
  onChange: (value: number) => void;
}) {
  return (
    <label>
      <span>{label}</span>
      <input
        type="number"
        min={0}
        max={max}
        step={0.1}
        value={value}
        onChange={(event) => onChange(event.currentTarget.valueAsNumber)}
      />
    </label>
  );
}

function advanceLabel(stage: PreparationStage): string {
  if (stage === "confirm") return "Preview run-006 recorded processing";
  return `Continue to ${PREPARATION_STAGES[preparationStageIndex(stage) + 1].label}`;
}

function stageParameterLabel(
  stage: PreparationStage,
  previewSession: StudioPreviewSession,
  session: PreflightSession,
  durationSeconds: number,
): string {
  if (stage === "range") return liveRangeCompactLabel(session, durationSeconds);
  if (stage === "language") return liveLanguageCompactLabel(previewSession, session);
  if (stage === "output") return session.request.outputDepth === "evidence"
    ? "Captions + evidence"
    : "Captions only";
  return "Current setup";
}

function stageParameterActionLabel(
  stage: PreparationStage,
  previewSession: StudioPreviewSession,
  session: PreflightSession,
  durationSeconds: number,
): string {
  const current = stageParameterLabel(stage, previewSession, session, durationSeconds);
  if (stage === "forecast" || stage === "confirm") return "Review current setup";
  return `Update ${stage}: ${current}`;
}

function liveRangeLabel(session: PreflightSession, durationSeconds: number): string {
  if (session.request.rangeMode === "entire") {
    return `the entire ${formatSeconds(durationSeconds)} video`;
  }
  return `the ${liveRangeCompactLabel(session, durationSeconds)} selection`;
}

function liveRangeCompactLabel(session: PreflightSession, durationSeconds: number): string {
  const start = Number.isFinite(session.request.start) ? session.request.start : 0;
  const end = Number.isFinite(session.request.end) ? session.request.end : durationSeconds;
  return `${formatSeconds(start)}–${formatSeconds(end)}`;
}

function liveSourceLanguageSentence(intent: SubmittedSourceLanguageIntent): string {
  if (intent.mode === "automatic") return "ask processing to detect the source language later";
  if (!intent.language) return "use the source language you declare";
  return `use your declared ${languageName(intent.language)} source language`;
}

function liveLanguageCompactLabel(previewSession: StudioPreviewSession, session: PreflightSession): string {
  const target = languageName(session.request.targetLanguage);
  const source = previewSession.sourceLanguage.mode === "automatic"
    ? "Detect later"
    : previewSession.sourceLanguage.language
      ? languageName(previewSession.sourceLanguage.language)
      : "Declare source";
  return `${source} → ${target}`;
}

function liveOutputLabel(depth: AnalysisRequest["outputDepth"]): string {
  return depth === "evidence" ? "captions plus evidence and a breakdown" : "captions only";
}

function languageName(code: string): string {
  return LANGUAGE_NAMES[code] ?? code;
}

function rangeLabel(request: SubmittedSourcePreparationRequest): string {
  return `${formatSeconds(request.range.startMs / 1_000)}–${formatSeconds(request.range.endMs / 1_000)} · ${formatSeconds((request.range.endMs - request.range.startMs) / 1_000)}`;
}

function compactLanguageLabel(request: SubmittedSourcePreparationRequest): string {
  const source = request.language.source.mode === "automatic"
    ? "detect later"
    : languageName(request.language.source.language);
  return `${source} → ${languageName(request.language.target)}`;
}

function outputLabel(request: SubmittedSourcePreparationRequest): string {
  return request.output.depth === "evidence" ? "Captions plus evidence" : "Captions only";
}
