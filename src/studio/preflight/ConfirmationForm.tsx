import { motion } from "motion/react";
import { useCallback, useRef, useState, type RefObject } from "react";

import { Edit } from "../glyphs";
import { useStudio } from "../store";
import type { RunBundle } from "../transport";
import {
  HOSTED_MAX_RANGE_S,
  RECOMMENDED_RANGE_S,
  formatSeconds,
  type AnalysisRequest,
  type RecordedPreflightFacts,
  type PreflightSession,
  type RangeAssessment,
} from "./model";
import {
  Choice,
  ConversationValue,
  PreparationControlShelf,
  PreparationStagePopover,
  RangeModeChoice,
  StageConversation,
  TimestampField,
  continueActionLabel,
  languageName,
  movePopoverFocus,
} from "./preparationKit";
import PreparationStageNavigation, {
  PREPARATION_STAGES,
  preparationStageIndex,
  type PreparationStage,
} from "./PreparationStages";

interface ConfirmationFormProps {
  bundle: RunBundle;
  session: PreflightSession;
  facts: RecordedPreflightFacts;
  assessment: RangeAssessment | null;
  update: (request: Partial<AnalysisRequest>) => void;
  confirm: () => void;
}

export default function ConfirmationForm({
  bundle,
  session,
  facts,
  assessment,
  update,
  confirm,
}: ConfirmationFormProps) {
  const stage = useStudio((state) => state.preparationStage);
  const furthestStage = useStudio((state) => state.preparationFurthestStage);
  const initialization = useStudio((state) => state.initialization);
  const selectPreparationStage = useStudio((state) => state.selectPreparationStage);
  const advancePreparationStage = useStudio((state) => state.advancePreparationStage);
  const [editingStage, setEditingStage] = useState<PreparationStage | null>(null);
  const stageHeading = useRef<HTMLHeadingElement>(null);
  const parameterTrigger = useRef<HTMLButtonElement>(null);
  const currentStageIndex = preparationStageIndex(stage);
  const { request } = session;
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
    if (stage === "range" && !assessment?.canReplay) return;
    setEditingStage(null);
    advancePreparationStage();
  }

  function previousStage(): void {
    setEditingStage(null);
    selectPreparationStage(PREPARATION_STAGES[currentStageIndex - 1].id);
  }

  const advanceDisabled = (stage === "range" && !assessment?.canReplay) || initialization !== null;

  return (
    <form
      className="preflight-form"
      data-preparation-stage={stage}
      data-palette={PREPARATION_STAGES[currentStageIndex].palette}
      data-furthest-stage={PREPARATION_STAGES[furthestStage].id}
      data-recorded-preparation="true"
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
        transition={{ layout: { duration: 0.32, ease: [0.22, 1, 0.36, 1] } }}
      >
          <motion.div
            key={stage}
            className="preflight-stage-body"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            onAnimationComplete={() => stageHeading.current?.focus({ preventScroll: true })}
          >
            {stage === "source" && <RecordedSourceStage headingRef={stageHeading} facts={facts} />}

            {stage === "range" && (
              <RecordedRangeStage
                headingRef={stageHeading}
                facts={facts}
                request={request}
                assessment={assessment}
              />
            )}

            {stage === "language" && (
              <RecordedLanguageStage headingRef={stageHeading} facts={facts} request={request} />
            )}

            {stage === "output" && (
              <RecordedOutputStage headingRef={stageHeading} request={request} />
            )}

            {stage === "forecast" && (
              <RecordedForecast headingRef={stageHeading} facts={facts} request={request} />
            )}

            {stage === "confirm" && (
              <RecordedConfirmation headingRef={stageHeading} facts={facts} request={request} />
            )}
          </motion.div>
      </motion.section>

      <PreparationControlShelf
        visible={initialization === null}
        stage={stage}
        back={stage !== "source"
          ? { label: `Back to ${PREPARATION_STAGES[currentStageIndex - 1].label}`, onClick: previousStage }
          : undefined}
        parameter={stage !== "source"
          ? {
              label: recordedParameterLabel(stage, facts, request),
              actionLabel: recordedParameterActionLabel(stage, facts, request),
              open: editingStage === stage,
              popoverId: `preflight-${stage}-popover`,
              triggerRef: parameterTrigger,
              onToggle: () => setEditingStage((current) => current === stage ? null : stage),
            }
          : undefined}
        next={{
          label: stage === "confirm" ? "Replay" : "Continue",
          actionLabel: stage === "confirm" ? "Replay recorded analysis" : continueActionLabel(stage),
          disabled: advanceDisabled,
        }}
      />

      {stage !== "source" && initialization === null && (
        <PreparationStagePopover
          key={stage}
          id={`preflight-${stage}-popover`}
          stage={stage}
          open={editingStage === stage}
          triggerRef={parameterTrigger}
          currentValue={recordedParameterLabel(stage, facts, request)}
          onClose={closeEditor}
        >
          {stage === "range" && (
            <RecordedRangeEditor facts={facts} request={request} assessment={assessment} update={update} />
          )}
          {stage === "language" && (
            <RecordedLanguageEditor
              bundle={bundle}
              facts={facts}
              request={request}
              update={update}
              relevance={session.relevance}
            />
          )}
          {stage === "output" && <RecordedOutputEditor request={request} update={update} />}
          {(stage === "forecast" || stage === "confirm") && (
            <RecordedSetupEditor facts={facts} request={request} selectStage={selectStage} />
          )}
        </PreparationStagePopover>
      )}
    </form>
  );
}

function RecordedSourceStage({
  headingRef,
  facts,
}: {
  headingRef: RefObject<HTMLHeadingElement | null>;
  facts: RecordedPreflightFacts;
}) {
  const owned = facts.rights.basis === "ownership_attestation";
  const origin = owned ? "receipted from owned local bytes" : "receipted from a recorded remote source";

  return (
    <section className="preflight-preparation preflight-source-stage">
      <div className="preflight-source-conversation" role="note" aria-label="Recorded source boundary">
        <h2 ref={headingRef} id="preflight-stage-title" tabIndex={-1}>
          I found <ConversationValue>{facts.title}</ConversationValue>
          {facts.creator ? ` by ${facts.creator}` : ""}. It’s {formatSeconds(facts.selection.duration)} long,{" "}
          {origin}. I haven’t replayed the analysis yet.
        </h2>
      </div>
    </section>
  );
}

function RecordedRangeStage({
  headingRef,
  facts,
  request,
  assessment,
}: {
  headingRef: RefObject<HTMLHeadingElement | null>;
  facts: RecordedPreflightFacts;
  request: AnalysisRequest;
  assessment: RangeAssessment | null;
}) {
  return (
    <section className="preflight-preparation">
      <StageConversation headingRef={headingRef}>
        I’ll replay <ConversationValue>{recordedRangeLabel(request)}</ConversationValue> of the recorded selection.
        The demo holds one measured 0:00–{formatSeconds(facts.selection.duration)} window; replay it whole or narrow
        it locally.
      </StageConversation>
      {assessment?.reason && <p className="preflight-block" role="status">{assessment.reason}</p>}
    </section>
  );
}

function RecordedLanguageStage({
  headingRef,
  facts,
  request,
}: {
  headingRef: RefObject<HTMLHeadingElement | null>;
  facts: RecordedPreflightFacts;
  request: AnalysisRequest;
}) {
  return (
    <section className="preflight-preparation">
      <StageConversation headingRef={headingRef}>
        I’ll keep the recorded <ConversationValue>{languageName(facts.declaredLanguage)}</ConversationValue> source
        and request <ConversationValue>{languageName(request.targetLanguage)}</ConversationValue> output. The clip’s
        language was declared when it was recorded, not freshly detected.
      </StageConversation>
    </section>
  );
}

function RecordedOutputStage({
  headingRef,
  request,
}: {
  headingRef: RefObject<HTMLHeadingElement | null>;
  request: AnalysisRequest;
}) {
  return (
    <section className="preflight-preparation">
      <StageConversation headingRef={headingRef}>
        I’ll surface <ConversationValue>{recordedOutputSentence(request.outputDepth)}</ConversationValue>.
      </StageConversation>
    </section>
  );
}

function RecordedForecast({
  headingRef,
  facts,
  request,
}: {
  headingRef: RefObject<HTMLHeadingElement | null>;
  facts: RecordedPreflightFacts;
  request: AnalysisRequest;
}) {
  return (
    <section className="preflight-preparation">
      <StageConversation headingRef={headingRef}>
        I’ve bound <ConversationValue>{recordedRangeLabel(request)}</ConversationValue>,{" "}
        <ConversationValue>{recordedLanguageLabel(facts, request)}</ConversationValue>, and{" "}
        <ConversationValue>{recordedOutputLabel(request)}</ConversationValue> to the recorded clip. Processing time,
        cost, and runtime scale stay unavailable until a versioned backend estimate exists.
      </StageConversation>
    </section>
  );
}

function RecordedConfirmation({
  headingRef,
  facts,
  request,
}: {
  headingRef: RefObject<HTMLHeadingElement | null>;
  facts: RecordedPreflightFacts;
  request: AnalysisRequest;
}) {
  return (
    <section className="preflight-preparation">
      <StageConversation headingRef={headingRef}>
        I’m ready to replay this recorded analysis with{" "}
        <ConversationValue>{recordedRangeLabel(request)}</ConversationValue>,{" "}
        <ConversationValue>{recordedLanguageLabel(facts, request)}</ConversationValue>, and{" "}
        <ConversationValue>{recordedOutputLabel(request)}</ConversationValue>. This replays the bundled evidence; it
        won’t download or start new media processing.
      </StageConversation>
    </section>
  );
}

function RecordedRangeEditor({
  facts,
  request,
  assessment,
  update,
}: {
  facts: RecordedPreflightFacts;
  request: AnalysisRequest;
  assessment: RangeAssessment | null;
  update: (request: Partial<AnalysisRequest>) => void;
}) {
  const duration = facts.selection.duration;
  const feedbackId = "preflight-range-feedback";
  const recommendation =
    assessment?.recommendation === "recommended"
      ? "Within the recommended 30–60 second range."
      : assessment?.recommendation === "short"
        ? "Shorter than the recommended 30 seconds."
        : assessment?.recommendation === "long"
          ? `Longer than the recommended ${RECOMMENDED_RANGE_S.max} seconds.`
          : null;
  const showLongLocal =
    assessment?.duration != null && assessment.duration > HOSTED_MAX_RANGE_S && import.meta.env.DEV;

  return (
    <fieldset className="preflight-range-editor">
      <legend>Range selection</legend>
      <RangeModeChoice
        name="range"
        value="full-source"
        checked={false}
        disabled
        onChange={() => {}}
        label="Entire source"
        meta="the recorded demo contains only its selected window"
        accessibleLabel="Entire source · the recorded demo contains only its selected window"
      />
      <RangeModeChoice
        name="range"
        value="recorded"
        checked={request.rangeMode === "recorded"}
        onChange={() => update({ rangeMode: "recorded", start: 0, end: duration })}
        label="Recorded selection"
        meta={`0:00–${formatSeconds(duration)}`}
        accessibleLabel={`Recorded selection · 0:00–${formatSeconds(duration)}`}
      />
      <RangeModeChoice
        name="range"
        value="custom"
        checked={request.rangeMode === "custom"}
        onChange={() => update({ rangeMode: "custom" })}
        label="Custom range"
        accessibleLabel="Custom range"
      />
      <RangeModeChoice
        name="range"
        value="detected"
        checked={false}
        disabled
        onChange={() => {}}
        label="Detected-language range"
        meta={facts.languageRanges ? "preflight evidence only" : "no language detector output"}
        accessibleLabel={facts.languageRanges
          ? "Measured language ranges · preflight evidence only; no replayable detected-language subrange"
          : "Whole detected-language range · no language detector output"}
      />
      {request.rangeMode === "custom" && (
        <div className="preflight-range-time-fields">
          <TimestampField
            label="Start"
            value={request.start}
            max={duration}
            describedBy={feedbackId}
            invalid={!assessment?.canReplay}
            onChange={(start) => update({ start })}
          />
          <TimestampField
            label="End"
            value={request.end}
            max={duration}
            describedBy={feedbackId}
            invalid={!assessment?.canReplay}
            onChange={(end) => update({ end })}
          />
        </div>
      )}
      {!assessment?.canReplay && assessment?.reason ? (
        <p id={feedbackId} className="preflight-range-feedback" data-invalid="true" role="status">
          {assessment.reason}
        </p>
      ) : (
        <p id={feedbackId} className="preflight-range-feedback">
          Recommend {RECOMMENDED_RANGE_S.min}–{RECOMMENDED_RANGE_S.max}s · hosted maximum {HOSTED_MAX_RANGE_S}s.
          {recommendation && ` ${recommendation}`}
        </p>
      )}
      {showLongLocal && (
        <Choice
          name="long-local"
          value="accept"
          checked={request.acceptLongLocal}
          onChange={() => update({ acceptLongLocal: !request.acceptLongLocal })}
          label="Allow this longer local run with slower processing"
        />
      )}
    </fieldset>
  );
}

function RecordedLanguageEditor({
  bundle,
  facts,
  request,
  update,
  relevance,
}: {
  bundle: RunBundle;
  facts: RecordedPreflightFacts;
  request: AnalysisRequest;
  update: (request: Partial<AnalysisRequest>) => void;
  relevance: PreflightSession["relevance"];
}) {
  return (
    <div className="preflight-language-stage">
      <div className="preflight-recorded-language">
        <span>Recorded source language</span>
        <b>{languageName(facts.declaredLanguage)}</b>
        <small>Declared in the recorded clip · not newly detected</small>
      </div>
      <label className="preflight-target-language">
        <span>Translation target</span>
        <select
          value={request.targetLanguage}
          onChange={(event) => update({ targetLanguage: event.currentTarget.value })}
        >
          <option value={bundle.run.pair.target}>{languageName(bundle.run.pair.target)}</option>
        </select>
      </label>
      <AdvancedFields request={request} update={update} relevance={relevance} />
    </div>
  );
}

function RecordedOutputEditor({
  request,
  update,
}: {
  request: AnalysisRequest;
  update: (request: Partial<AnalysisRequest>) => void;
}) {
  return (
    <fieldset className="preflight-group preflight-output-stage">
      <legend>Result detail</legend>
      <Choice
        name="output"
        value="captions"
        checked={request.outputDepth === "captions"}
        onChange={() => update({ outputDepth: "captions" })}
        label="Watch aids"
      />
      <Choice
        name="output"
        value="evidence"
        checked={request.outputDepth === "evidence"}
        onChange={() => update({ outputDepth: "evidence" })}
        label="Watch aids plus evidence and breakdown"
      />
    </fieldset>
  );
}

function RecordedSetupEditor({
  facts,
  request,
  selectStage,
}: {
  facts: RecordedPreflightFacts;
  request: AnalysisRequest;
  selectStage: (stage: PreparationStage) => void;
}) {
  const parameters: Array<{ stage: PreparationStage; label: string; value: string }> = [
    { stage: "range", label: "Range", value: recordedRangeLabel(request) },
    { stage: "language", label: "Language", value: recordedLanguageLabel(facts, request) },
    { stage: "output", label: "Output", value: recordedOutputLabel(request) },
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

function recordedParameterLabel(
  stage: PreparationStage,
  facts: RecordedPreflightFacts,
  request: AnalysisRequest,
): string {
  if (stage === "range") return recordedRangeLabel(request);
  if (stage === "language") return recordedLanguageLabel(facts, request);
  if (stage === "output") return recordedOutputLabel(request);
  return "Current setup";
}

function recordedParameterActionLabel(
  stage: PreparationStage,
  facts: RecordedPreflightFacts,
  request: AnalysisRequest,
): string {
  if (stage === "forecast" || stage === "confirm") return "Review current setup";
  return `Update ${stage}: ${recordedParameterLabel(stage, facts, request)}`;
}

function recordedRangeLabel(request: AnalysisRequest): string {
  return `${formatSeconds(request.start)}–${formatSeconds(request.end)}`;
}

function recordedLanguageLabel(facts: RecordedPreflightFacts, request: AnalysisRequest): string {
  return `${languageName(facts.declaredLanguage)} → ${languageName(request.targetLanguage)}`;
}

function recordedOutputLabel(request: AnalysisRequest): string {
  return request.outputDepth === "evidence" ? "Watch aids + evidence" : "Watch aids";
}

function recordedOutputSentence(depth: AnalysisRequest["outputDepth"]): string {
  return depth === "evidence" ? "watch aids plus evidence and a breakdown" : "watch aids";
}

export function AdvancedFields({
  request,
  update,
  relevance,
}: {
  request: AnalysisRequest;
  update: (request: Partial<AnalysisRequest>) => void;
  relevance: PreflightSession["relevance"];
}) {
  if (!relevance.backgroundSpeech && !relevance.music && !relevance.speakerFocus) return null;
  return (
    <details className="preflight-advanced" open>
      <summary>Relevant advanced controls</summary>
      {relevance.backgroundSpeech && (
        <label>
          <span>Speech scope</span>
          <select
            value={request.speechScope}
            onChange={(event) => update({ speechScope: event.currentTarget.value as AnalysisRequest["speechScope"] })}
          >
            <option value="foreground">Foreground speakers only</option>
            <option value="all">Include background speech</option>
          </select>
        </label>
      )}
      {relevance.music && (
        <label className="preflight-check">
          <input
            type="checkbox"
            checked={request.includeLyrics}
            onChange={(event) => update({ includeLyrics: event.currentTarget.checked })}
          />
          <span>Include song lyrics</span>
        </label>
      )}
      {relevance.speakerFocus && (
        <label>
          <span>Detected speaker focus</span>
          <select
            value={request.speaker ?? "all"}
            onChange={(event) => update({ speaker: event.currentTarget.value === "all" ? null : event.currentTarget.value })}
          >
            <option value="all">All detected labels</option>
            <option value="fixture-speaker">Fixture speaker label</option>
          </select>
        </label>
      )}
      <label>
        <span>Honorifics</span>
        <select
          value={request.honorifics}
          onChange={(event) => update({ honorifics: event.currentTarget.value as AnalysisRequest["honorifics"] })}
        >
          <option value="preserve">Preserve</option>
          <option value="naturalize">Naturalize</option>
        </select>
      </label>
      <label>
        <span>Translation style</span>
        <select
          value={request.translationStyle}
          onChange={(event) => update({ translationStyle: event.currentTarget.value as AnalysisRequest["translationStyle"] })}
        >
          <option value="natural">Natural</option>
          <option value="literal">Literal</option>
        </select>
      </label>
      <label>
        <span>Caption density</span>
        <select
          value={request.captionDensity}
          onChange={(event) => update({ captionDensity: event.currentTarget.value as AnalysisRequest["captionDensity"] })}
        >
          <option value="compact">Compact</option>
          <option value="balanced">Balanced</option>
          <option value="relaxed">Relaxed</option>
        </select>
      </label>
      <label className="preflight-check">
        <input
          type="checkbox"
          checked={request.slowAnalysis}
          onChange={(event) => update({ slowAnalysis: event.currentTarget.checked })}
        />
        <span>Allow a longer, slower analysis</span>
      </label>
    </details>
  );
}
