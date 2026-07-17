import { motion } from "motion/react";
import { useCallback, useRef, useState, type RefObject } from "react";

import { Edit } from "../glyphs";
import { useStudio } from "../store";
import type { RunBundle } from "../transport";
import type { ForecastArtifact } from "../runtime/production/forecast/model.ts";
import { projectRecordedForecast } from "./recordedForecast.ts";
import {
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
  StageConversation,
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
  // The element the open editor popover anchors to — the shelf pill or the
  // clicked in-sentence chip, whichever opened it.
  const editorAnchor = useRef<HTMLButtonElement | null>(null);
  const currentStageIndex = preparationStageIndex(stage);
  const { request } = session;
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
                onEdit={(anchor) => openStageEditor("range", anchor)}
              />
            )}

            {stage === "language" && (
              <RecordedLanguageStage
                headingRef={stageHeading}
                facts={facts}
                request={request}
                onEdit={(anchor) => openStageEditor("language", anchor)}
              />
            )}

            {stage === "output" && (
              <RecordedOutputStage
                headingRef={stageHeading}
                request={request}
                onEdit={(anchor) => openStageEditor("output", anchor)}
              />
            )}

            {stage === "forecast" && (
              <RecordedForecast
                headingRef={stageHeading}
                facts={facts}
                request={request}
                forecast={bundle.forecast ?? null}
                selectStage={selectStage}
              />
            )}

            {stage === "confirm" && (
              <RecordedConfirmation
                headingRef={stageHeading}
                facts={facts}
                request={request}
                selectStage={selectStage}
              />
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
              onToggle: toggleStageEditor,
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
          triggerRef={editorAnchor}
          currentValue={recordedParameterLabel(stage, facts, request)}
          onClose={closeEditor}
        >
          {stage === "range" && <RecordedRangeEditor facts={facts} />}
          {stage === "language" && (
            <RecordedLanguageEditor
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
  onEdit,
}: {
  headingRef: RefObject<HTMLHeadingElement | null>;
  facts: RecordedPreflightFacts;
  request: AnalysisRequest;
  assessment: RangeAssessment | null;
  onEdit: (anchor: HTMLButtonElement) => void;
}) {
  return (
    <section className="preflight-preparation">
      <StageConversation headingRef={headingRef}>
        I’ll replay{" "}
        <ConversationValue onEdit={onEdit} editLabel={`Edit range: ${recordedRangeLabel(request)}`}>
          {recordedRangeLabel(request)}
        </ConversationValue>{" "}
        of the recorded selection — the one measured 0:00–{formatSeconds(facts.selection.duration)} window bundled
        with this demo. A different range would need a new producer run.
      </StageConversation>
      {assessment?.reason && <p className="preflight-block" role="status">{assessment.reason}</p>}
    </section>
  );
}

function RecordedLanguageStage({
  headingRef,
  facts,
  request,
  onEdit,
}: {
  headingRef: RefObject<HTMLHeadingElement | null>;
  facts: RecordedPreflightFacts;
  request: AnalysisRequest;
  onEdit: (anchor: HTMLButtonElement) => void;
}) {
  return (
    <section className="preflight-preparation">
      <StageConversation headingRef={headingRef}>
        I’ll keep the recorded <ConversationValue>{languageName(facts.declaredLanguage)}</ConversationValue> source
        and request{" "}
        <ConversationValue onEdit={onEdit} editLabel={`Edit target language: ${languageName(request.targetLanguage)}`}>
          {languageName(request.targetLanguage)}
        </ConversationValue>{" "}
        output. The clip’s language was declared when it was recorded, not freshly detected.
      </StageConversation>
    </section>
  );
}

function RecordedOutputStage({
  headingRef,
  request,
  onEdit,
}: {
  headingRef: RefObject<HTMLHeadingElement | null>;
  request: AnalysisRequest;
  onEdit: (anchor: HTMLButtonElement) => void;
}) {
  return (
    <section className="preflight-preparation">
      <StageConversation headingRef={headingRef}>
        I’ll surface{" "}
        <ConversationValue onEdit={onEdit} editLabel={`Edit output: ${recordedOutputSentence(request.outputDepth)}`}>
          {recordedOutputSentence(request.outputDepth)}
        </ConversationValue>.
      </StageConversation>
    </section>
  );
}

function RecordedForecast({
  headingRef,
  facts,
  request,
  forecast,
  selectStage,
}: {
  headingRef: RefObject<HTMLHeadingElement | null>;
  facts: RecordedPreflightFacts;
  request: AnalysisRequest;
  forecast: ForecastArtifact | null;
  selectStage: (stage: PreparationStage) => void;
}) {
  const view = projectRecordedForecast(forecast);

  return (
    <section className="preflight-preparation">
      <StageConversation headingRef={headingRef}>
        I’ve bound{" "}
        <ConversationValue onEdit={() => selectStage("range")} editLabel={`Edit range: ${recordedRangeLabel(request)}`}>
          {recordedRangeLabel(request)}
        </ConversationValue>,{" "}
        <ConversationValue onEdit={() => selectStage("language")} editLabel={`Edit language: ${recordedLanguageLabel(facts, request)}`}>
          {recordedLanguageLabel(facts, request)}
        </ConversationValue>, and{" "}
        <ConversationValue onEdit={() => selectStage("output")} editLabel={`Edit output: ${recordedOutputLabel(request)}`}>
          {recordedOutputLabel(request)}
        </ConversationValue>{" "}
        to the recorded clip.{" "}
        {view.kind === "floor"
          ? `A deterministic workload floor covers ${recordedForecastFloorLabel(view)} — that is workload volume, not elapsed time, which stays unavailable along with cost and runtime scale until a versioned backend estimate exists.`
          : "Processing time, cost, and runtime scale stay unavailable until a versioned backend estimate exists."}
      </StageConversation>
    </section>
  );
}

function recordedForecastFloorLabel(view: {
  operationCount: number;
  requestedOperationMediaDurationMs: number;
}): string {
  const operations = `${view.operationCount} ${view.operationCount === 1 ? "operation" : "operations"}`;
  return `${formatSeconds(view.requestedOperationMediaDurationMs / 1000)} of requested media across ${operations}`;
}

function RecordedConfirmation({
  headingRef,
  facts,
  request,
  selectStage,
}: {
  headingRef: RefObject<HTMLHeadingElement | null>;
  facts: RecordedPreflightFacts;
  request: AnalysisRequest;
  selectStage: (stage: PreparationStage) => void;
}) {
  return (
    <section className="preflight-preparation">
      <StageConversation headingRef={headingRef}>
        I’m ready to replay this recorded analysis with{" "}
        <ConversationValue onEdit={() => selectStage("range")} editLabel={`Edit range: ${recordedRangeLabel(request)}`}>
          {recordedRangeLabel(request)}
        </ConversationValue>,{" "}
        <ConversationValue onEdit={() => selectStage("language")} editLabel={`Edit language: ${recordedLanguageLabel(facts, request)}`}>
          {recordedLanguageLabel(facts, request)}
        </ConversationValue>, and{" "}
        <ConversationValue onEdit={() => selectStage("output")} editLabel={`Edit output: ${recordedOutputLabel(request)}`}>
          {recordedOutputLabel(request)}
        </ConversationValue>. This replays the bundled evidence; it won’t download or start new media processing.
      </StageConversation>
    </section>
  );
}

function RecordedRangeEditor({ facts }: { facts: RecordedPreflightFacts }) {
  const duration = facts.selection.duration;

  return (
    <div className="preflight-range-editor preflight-range-locked" aria-label="Recorded range selection">
      <div className="preflight-range-locked-selection">
        <span className="preflight-range-choice-indicator" aria-hidden="true" />
        <strong>Recorded selection</strong>
        <small>0:00–{formatSeconds(duration)}</small>
      </div>
      <p className="preflight-range-feedback">
        The only replayable window — a different range would need a new producer run. This recorded clip has no
        range recommender, detected-language sub-range, or custom-range output.
      </p>
    </div>
  );
}

function RecordedLanguageEditor({
  facts,
  request,
  update,
  relevance,
}: {
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
      <div className="preflight-recorded-language">
        <span>Translation target</span>
        <b>{languageName(request.targetLanguage)}</b>
        <small>The only output language bundled with this recorded clip</small>
      </div>
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
        label="Captions"
      />
      <Choice
        name="output"
        value="evidence"
        checked={request.outputDepth === "evidence"}
        onChange={() => update({ outputDepth: "evidence" })}
        label="Captions plus evidence and breakdown"
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
  return request.outputDepth === "evidence" ? "Captions + evidence" : "Captions";
}

function recordedOutputSentence(depth: AnalysisRequest["outputDepth"]): string {
  return depth === "evidence" ? "captions plus evidence and a breakdown" : "captions";
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
