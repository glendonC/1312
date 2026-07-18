import { LayoutGroup } from "motion/react";
import { useCallback, useRef, useState, type RefObject } from "react";

import { Edit } from "../glyphs";
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
import {
  Choice,
  ConversationValue,
  PreparationControlShelf,
  PreparationStagePanel,
  PreparationStagePopover,
  RangeModeChoice,
  StageConversation,
  TimestampField,
  continueActionLabel,
  formatTimestamp,
  languageName,
  movePopoverFocus,
} from "./preparationKit";
import PreparationStageNavigation, {
  PREPARATION_STAGES,
  preparationStageIndex,
  type PreparationStage,
} from "./PreparationStages";

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
  // +1 when moving toward Review, -1 when moving back; drives the stage body's directional entrance.
  const [direction, setDirection] = useState(1);
  const stageHeading = useRef<HTMLHeadingElement>(null);
  const parameterTrigger = useRef<HTMLButtonElement>(null);
  // The element the open editor popover anchors to — the shelf pill or the
  // clicked in-sentence chip, whichever opened it.
  const editorAnchor = useRef<HTMLButtonElement | null>(null);
  const durationSeconds = resolution.source.durationMs / 1_000;
  const preparation = previewSession.preparation;
  const currentStageIndex = preparationStageIndex(stage);
  const requestReady = assessment.canReplay && preparation.status === "ready";
  const blockingMessage = assessment.reason
    ?? (preparation.status === "invalid" ? preparation.message : null);
  const closeEditor = useCallback(() => setEditingStage(null), []);

  function openStageEditor(target: PreparationStage, anchor: HTMLButtonElement): void {
    editorAnchor.current = anchor;
    setEditingStage(target);
  }

  function toggleStageEditor(): void {
    if (editingStage === stage) {
      setEditingStage(null);
    } else if (parameterTrigger.current) {
      openStageEditor(stage, parameterTrigger.current);
    }
  }

  function selectStage(nextStage: PreparationStage): void {
    setEditingStage(null);
    setDirection(preparationStageIndex(nextStage) >= currentStageIndex ? 1 : -1);
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
    setDirection(1);
    advancePreparationStage();
  }

  function previousStage(): void {
    setEditingStage(null);
    setDirection(-1);
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

      <LayoutGroup>
        <PreparationStagePanel stage={stage} direction={direction}>
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
              onEdit={(anchor) => openStageEditor("range", anchor)}
            />
          )}

          {stage === "language" && (
            <SubmittedLanguageStage
              headingRef={stageHeading}
              previewSession={previewSession}
              session={session}
              blockingMessage={blockingMessage}
              onEdit={(anchor) => openStageEditor("language", anchor)}
            />
          )}

          {stage === "output" && (
            <SubmittedOutputStage
              headingRef={stageHeading}
              session={session}
              onEdit={(anchor) => openStageEditor("output", anchor)}
            />
          )}

          {stage === "forecast" && preparation.status === "ready" && (
            <SubmittedForecast
              headingRef={stageHeading}
              resolution={resolution}
              request={preparation.request}
              selectStage={selectStage}
            />
          )}

          {stage === "confirm" && preparation.status === "ready" && (
            <SubmittedConfirmation
              headingRef={stageHeading}
              resolution={resolution}
              request={preparation.request}
              selectStage={selectStage}
            />
          )}
        </PreparationStagePanel>

        <PreparationControlShelf
          visible={initialization === null}
          stage={stage}
          back={stage !== "source"
            ? { label: `Back to ${PREPARATION_STAGES[currentStageIndex - 1].label}`, onClick: previousStage }
            : undefined}
          parameter={stage !== "source"
            ? {
                label: stageParameterLabel(stage, previewSession, session, durationSeconds),
                actionLabel: stageParameterActionLabel(stage, previewSession, session, durationSeconds),
                open: editingStage === stage,
                popoverId: `preflight-${stage}-popover`,
                triggerRef: parameterTrigger,
                onToggle: toggleStageEditor,
              }
            : undefined}
          next={{
            label: stage === "confirm" ? "Preview" : "Continue",
            actionLabel: stage === "confirm" ? "Preview run-006 recorded processing" : continueActionLabel(stage),
            disabled: advanceDisabled,
          }}
        />
      </LayoutGroup>

      {stage !== "source" && initialization === null && (
        <PreparationStagePopover
          key={stage}
          id={`preflight-${stage}-popover`}
          stage={stage}
          open={editingStage === stage}
          triggerRef={editorAnchor}
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
  onEdit,
}: {
  headingRef: RefObject<HTMLHeadingElement | null>;
  durationSeconds: number;
  session: PreflightSession;
  preparationStatus: StudioPreviewSession["preparation"]["status"];
  blockingMessage: string | null;
  onEdit: (anchor: HTMLButtonElement) => void;
}) {
  const range = liveRangeLabel(session, durationSeconds);

  return (
    <section className="preflight-preparation">
      <StageConversation headingRef={headingRef}>
        I’ll prepare{" "}
        <ConversationValue onEdit={onEdit} editLabel={`Edit range: ${range}`}>{range}</ConversationValue>{" "}
        from this source. The current limit is{" "}
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
  onEdit,
}: {
  headingRef: RefObject<HTMLHeadingElement | null>;
  previewSession: StudioPreviewSession;
  session: PreflightSession;
  blockingMessage: string | null;
  onEdit: (anchor: HTMLButtonElement) => void;
}) {
  const sourceIntent = liveSourceLanguageSentence(previewSession.sourceLanguage);
  const target = languageName(session.request.targetLanguage);

  return (
    <section className="preflight-preparation">
      <StageConversation headingRef={headingRef}>
        I’ll{" "}
        <ConversationValue onEdit={onEdit} editLabel={`Edit source language: ${sourceIntent}`}>{sourceIntent}</ConversationValue>{" "}
        and request{" "}
        <ConversationValue onEdit={onEdit} editLabel={`Edit target language: ${target}`}>{target}</ConversationValue>{" "}
        output. Nothing has been detected yet.
      </StageConversation>
      {blockingMessage && <p className="preflight-block" role="status">{blockingMessage}</p>}
    </section>
  );
}

function SubmittedOutputStage({
  headingRef,
  session,
  onEdit,
}: {
  headingRef: RefObject<HTMLHeadingElement | null>;
  session: PreflightSession;
  onEdit: (anchor: HTMLButtonElement) => void;
}) {
  return (
    <section className="preflight-preparation">
      <StageConversation headingRef={headingRef}>
        I’ll request{" "}
        <ConversationValue onEdit={onEdit} editLabel={`Edit output: ${liveOutputLabel(session.request.outputDepth)}`}>
          {liveOutputLabel(session.request.outputDepth)}
        </ConversationValue>. Processing still hasn’t started.
      </StageConversation>
    </section>
  );
}

function SubmittedForecast({
  headingRef,
  resolution,
  request,
  selectStage,
}: {
  headingRef: RefObject<HTMLHeadingElement | null>;
  resolution: RemoteSourceResolutionReceipt;
  request: SubmittedSourcePreparationRequest;
  selectStage: (stage: PreparationStage) => void;
}) {
  return (
    <section className="preflight-preparation">
      <StageConversation headingRef={headingRef}>
        I’ve bound{" "}
        <ConversationValue onEdit={() => selectStage("range")} editLabel={`Edit range: ${rangeLabel(request)}`}>
          {rangeLabel(request)}
        </ConversationValue>,{" "}
        <ConversationValue onEdit={() => selectStage("language")} editLabel={`Edit language: ${compactLanguageLabel(request)}`}>
          {compactLanguageLabel(request)}
        </ConversationValue>, and{" "}
        <ConversationValue onEdit={() => selectStage("output")} editLabel={`Edit output: ${outputLabel(request)}`}>
          {outputLabel(request)}
        </ConversationValue>{" "}
        to {resolution.source.label}. I still can’t forecast processing time, cost, scale, or workload until a
        compatible producer runs.
      </StageConversation>
    </section>
  );
}

function SubmittedConfirmation({
  headingRef,
  resolution,
  request,
  selectStage,
}: {
  headingRef: RefObject<HTMLHeadingElement | null>;
  resolution: RemoteSourceResolutionReceipt;
  request: SubmittedSourcePreparationRequest;
  selectStage: (stage: PreparationStage) => void;
}) {
  return (
    <section className="preflight-preparation">
      <StageConversation headingRef={headingRef}>
        I’m ready to open the recorded run-006 interface preview with{" "}
        <ConversationValue onEdit={() => selectStage("range")} editLabel={`Edit range: ${rangeLabel(request)}`}>
          {rangeLabel(request)}
        </ConversationValue>,{" "}
        <ConversationValue onEdit={() => selectStage("language")} editLabel={`Edit language: ${compactLanguageLabel(request)}`}>
          {compactLanguageLabel(request)}
        </ConversationValue>, and{" "}
        <ConversationValue onEdit={() => selectStage("output")} editLabel={`Edit output: ${outputLabel(request)}`}>
          {outputLabel(request)}
        </ConversationValue>. This replays the bundled demonstration; it won’t download or process{" "}
        {resolution.source.label}, and it does not submit a runtime command.
      </StageConversation>
    </section>
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
  const maximumDuration = SUBMITTED_PREPARATION_POLICY.maximumDurationMs / 1_000;
  const entireUnavailable = durationSeconds > maximumDuration;
  const feedbackId = "preflight-range-feedback";
  const hasFeedback = !assessment.canReplay || entireUnavailable;

  return (
    <fieldset className="preflight-range-editor">
      <legend>Range selection</legend>
      <RangeModeChoice
        name="range"
        value="entire"
        checked={session.request.rangeMode === "entire"}
        disabled={entireUnavailable}
        onChange={() => update({ rangeMode: "entire", start: 0, end: durationSeconds })}
        label="Entire video"
        meta={entireUnavailable
          ? `${formatTimestamp(durationSeconds)} · exceeds ${formatTimestamp(maximumDuration)} limit`
          : formatTimestamp(durationSeconds)}
        accessibleLabel={entireUnavailable
          ? `Entire video · ${formatTimestamp(durationSeconds)} · exceeds ${formatTimestamp(maximumDuration)} limit`
          : `Entire video · ${formatTimestamp(durationSeconds)}`}
      />
      <RangeModeChoice
        name="range"
        value="custom"
        checked={session.request.rangeMode === "custom"}
        onChange={() => update({ rangeMode: "custom" })}
        label="Custom range"
        accessibleLabel="Custom range"
      />
      {session.request.rangeMode === "custom" && (
        <div className="preflight-range-time-fields">
          <TimestampField
            label="Start"
            value={session.request.start}
            max={durationSeconds}
            describedBy={hasFeedback ? feedbackId : undefined}
            invalid={!assessment.canReplay}
            onChange={(start) => update({ start })}
          />
          <TimestampField
            label="End"
            value={session.request.end}
            max={durationSeconds}
            describedBy={hasFeedback ? feedbackId : undefined}
            invalid={!assessment.canReplay}
            onChange={(end) => update({ end })}
          />
        </div>
      )}
      {!assessment.canReplay && assessment.reason ? (
        <p id={feedbackId} className="preflight-range-feedback" data-invalid="true" role="status">
          {assessment.reason}
        </p>
      ) : entireUnavailable ? (
        <p id={feedbackId} className="preflight-range-feedback">
          Select up to {formatTimestamp(maximumDuration)}. No section was recommended.
        </p>
      ) : null}
    </fieldset>
  );
}

function LanguageEditor({
  previewSession,
  session,
  updateSourceLanguage,
}: {
  previewSession: StudioPreviewSession;
  session: PreflightSession;
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
      <div className="preflight-recorded-language">
        <span>Requested target language</span>
        <b>{languageName(session.request.targetLanguage)}</b>
        <small>English is the only supported target today</small>
      </div>
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
        label="Captions"
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
    : "Captions";
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
  return depth === "evidence" ? "captions plus evidence and a breakdown" : "captions";
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
  return request.output.depth === "evidence" ? "Captions plus evidence" : "Captions";
}
