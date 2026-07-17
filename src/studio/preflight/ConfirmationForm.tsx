import { AnimatePresence, motion } from "motion/react";
import { useRef, type ReactNode, type RefObject } from "react";

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
import PreparationStageNavigation, {
  PREPARATION_STAGES,
  preparationStageIndex,
  type PreparationStage,
} from "./PreparationStages";

const LANGUAGE_NAMES: Record<string, string> = { en: "English", ko: "Korean", ja: "Japanese" };

interface ConfirmationFormProps {
  bundle: RunBundle;
  session: PreflightSession;
  facts: RecordedPreflightFacts;
  assessment: RangeAssessment | null;
  sourceDetails: ReactNode;
  update: (request: Partial<AnalysisRequest>) => void;
  cancel: () => void;
  confirm: () => void;
}

export default function ConfirmationForm({
  bundle,
  session,
  facts,
  assessment,
  sourceDetails,
  update,
  cancel,
  confirm,
}: ConfirmationFormProps) {
  const stage = useStudio((state) => state.preparationStage);
  const furthestStage = useStudio((state) => state.preparationFurthestStage);
  const initialization = useStudio((state) => state.initialization);
  const selectPreparationStage = useStudio((state) => state.selectPreparationStage);
  const advancePreparationStage = useStudio((state) => state.advancePreparationStage);
  const stageHeading = useRef<HTMLHeadingElement>(null);
  const currentStageIndex = preparationStageIndex(stage);
  const { request } = session;
  const selectableDuration = facts.selection.duration;
  const recommendation =
    assessment?.recommendation === "recommended"
      ? "Within the recommended 30–60 second range."
      : assessment?.recommendation === "short"
        ? "Shorter than the recommended 30 seconds."
        : assessment?.recommendation === "long"
          ? `Longer than the recommended ${RECOMMENDED_RANGE_S.max} seconds.`
          : null;

  function selectStage(nextStage: PreparationStage): void {
    selectPreparationStage(nextStage);
  }

  function submitStage(): void {
    if (stage === "confirm") {
      confirm();
      return;
    }
    if (stage === "range" && !assessment?.canReplay) return;
    advancePreparationStage();
  }

  function previousStage(): void {
    if (currentStageIndex === 0) {
      cancel();
      return;
    }
    selectPreparationStage(PREPARATION_STAGES[currentStageIndex - 1].id);
  }

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
              <section className="preflight-preparation">
                <PreparationHeading
                  headingRef={stageHeading}
                  kicker="Recorded source"
                  title={facts.title}
                  detail="Review the receipted source boundary before choosing the replay request."
                />
                {sourceDetails}
                <details className="preflight-coverage">
                  <summary>Producer coverage</summary>
                  <p>
                    Rights, raw source window, and duration: <code>{facts.producer}</code>.
                    {facts.mediaProbe && <> Tracks and codecs: <code>{facts.mediaProbe.producer}</code>.</>}
                    {facts.content && <> Raw content identity and {facts.content.derivedArtifacts} derived receipt: <code>SHA-256</code>.</>}
                    {facts.speechActivity && <> Speech windows: <code>{facts.speechActivity.producer.id} {facts.speechActivity.producer.version}</code>.</>}
                    {facts.languageRanges && <> Language ranges: <code>{facts.languageRanges.producer.id} {facts.languageRanges.producer.version}</code>.</>}
                  </p>
                  <ul>{session.missing.map((gap) => <li key={gap.id}><b>{gap.label}</b><span>{gap.consequence}</span></li>)}</ul>
                </details>
              </section>
            )}

            {stage === "range" && (
              <section className="preflight-preparation">
                <PreparationHeading
                  headingRef={stageHeading}
                  kicker="Analysis range"
                  title="Choose the recorded section to replay"
                  detail="The demo contains one measured source window. You can replay it as recorded or narrow it locally."
                />
                <fieldset className="preflight-group preflight-range-stage">
                  <legend>Requested section</legend>
                  <Choice name="range" value="full-source" checked={false} disabled label="Entire source · the recorded demo contains only its selected window" />
                  <Choice
                    name="range"
                    value="recorded"
                    checked={request.rangeMode === "recorded"}
                    onChange={() => update({ rangeMode: "recorded", start: 0, end: facts.selection.duration })}
                    label={`Recorded selection · 0:00–${formatSeconds(facts.selection.duration)}`}
                  />
                  <Choice
                    name="range"
                    value="custom"
                    checked={request.rangeMode === "custom"}
                    onChange={() => update({ rangeMode: "custom" })}
                    label="Custom start and end"
                  />
                  <Choice name="range" value="suggested" checked={false} disabled label="Suggested range · no recommender output" />
                  <Choice
                    name="range"
                    value="detected"
                    checked={false}
                    disabled
                    label={facts.languageRanges
                      ? "Measured language ranges · preflight evidence only; no replayable detected-language subrange"
                      : "Whole detected-language range · no language detector output"}
                  />
                  {request.rangeMode === "custom" && (
                    <div className="preflight-range-fields">
                      <NumberField label="Start, seconds" value={request.start} max={selectableDuration} onChange={(start) => update({ start })} />
                      <NumberField label="End, seconds" value={request.end} max={selectableDuration} onChange={(end) => update({ end })} />
                    </div>
                  )}
                  <p className="preflight-policy">
                    Recommend {RECOMMENDED_RANGE_S.min}–{RECOMMENDED_RANGE_S.max}s · hosted maximum {HOSTED_MAX_RANGE_S}s.
                    {recommendation && ` ${recommendation}`}
                  </p>
                  {assessment?.duration != null && assessment.duration > HOSTED_MAX_RANGE_S && import.meta.env.DEV && (
                    <Choice
                      name="long-local"
                      value="accept"
                      checked={request.acceptLongLocal}
                      onChange={() => update({ acceptLongLocal: !request.acceptLongLocal })}
                      label="Allow this longer local run with slower processing"
                    />
                  )}
                </fieldset>
                {assessment?.reason && <p className="preflight-block" role="status">{assessment.reason}</p>}
              </section>
            )}

            {stage === "language" && (
              <section className="preflight-preparation">
                <PreparationHeading
                  headingRef={stageHeading}
                  kicker="Language direction"
                  title="Confirm how the recorded run handles language"
                  detail="The source declaration and language pack belong to the recorded receipt; only the translation target and relevant controls are replay inputs."
                />
                <div className="preflight-language-stage">
                  <div className="preflight-recorded-language">
                    <span>Recorded source language</span>
                    <b>{languageName(facts.declaredLanguage)}</b>
                    <small>Declared in the recorded clip · not newly detected</small>
                  </div>
                  <label className="preflight-target-language">
                    <span>Translation target</span>
                    <select value={request.targetLanguage} onChange={(event) => update({ targetLanguage: event.currentTarget.value })}>
                      <option value={bundle.run.pair.target}>{languageName(bundle.run.pair.target)}</option>
                    </select>
                  </label>
                </div>
                <AdvancedFields request={request} update={update} relevance={session.relevance} />
              </section>
            )}

            {stage === "output" && (
              <section className="preflight-preparation">
                <PreparationHeading
                  headingRef={stageHeading}
                  kicker="Requested output"
                  title="Choose the replay detail"
                  detail="This selects which recorded result surfaces will be shown after the replay completes."
                />
                <fieldset className="preflight-group preflight-output-stage">
                  <legend>Result detail</legend>
                  <Choice name="output" value="captions" checked={request.outputDepth === "captions"} onChange={() => update({ outputDepth: "captions" })} label="Captions only" />
                  <Choice name="output" value="evidence" checked={request.outputDepth === "evidence"} onChange={() => update({ outputDepth: "evidence" })} label="Captions plus evidence and breakdown" />
                </fieldset>
              </section>
            )}

            {stage === "forecast" && <ForecastReview headingRef={stageHeading} request={request} facts={facts} assessment={assessment} />}
            {stage === "confirm" && <ConfirmationReview headingRef={stageHeading} request={request} facts={facts} />}
          </motion.div>
        </AnimatePresence>

        <div className="preflight-actions" data-stage={stage}>
          <button type="button" className="ghost" onClick={previousStage}>
            {stage === "source" ? "Back to source choices" : `Back to ${PREPARATION_STAGES[currentStageIndex - 1].label}`}
          </button>
          <button
            type="submit"
            className="cta"
            disabled={(stage === "range" && !assessment?.canReplay) || initialization !== null}
          >
            {stage === "confirm"
              ? initialization ? "Initializing recorded replay…" : "Replay recorded analysis"
              : `Continue to ${PREPARATION_STAGES[currentStageIndex + 1].label}`}
          </button>
        </div>
      </motion.section>
    </form>
  );
}

function PreparationHeading({
  headingRef,
  kicker,
  title,
  detail,
}: {
  headingRef: RefObject<HTMLHeadingElement | null>;
  kicker: string;
  title: string;
  detail: string;
}) {
  return (
    <header className="preflight-stage-head">
      <span>{kicker}</span>
      <h2 ref={headingRef} id="preflight-stage-title" tabIndex={-1}>{title}</h2>
      <p>{detail}</p>
    </header>
  );
}

function ForecastReview({
  headingRef,
  request,
  facts,
  assessment,
}: {
  headingRef: RefObject<HTMLHeadingElement | null>;
  request: AnalysisRequest;
  facts: RecordedPreflightFacts;
  assessment: RangeAssessment | null;
}) {
  return (
    <section className="preflight-preparation" aria-labelledby="preflight-stage-title">
      <PreparationHeading
        headingRef={headingRef}
        kicker="Request forecast"
        title="Review what can be known before starting"
        detail="Selected media and requested output are measurable. Time, price, and runtime scale stay unavailable until the backend returns those contracts."
      />
      <div className="preflight-forecast-grid">
        <ForecastFact
          label="Selected media"
          value={`${formatSeconds(request.start)}–${formatSeconds(request.end)}`}
          detail={`${formatSeconds(assessment?.duration ?? 0)} requested from the recorded selection`}
        />
        <ForecastFact
          label="Requested output"
          value={request.outputDepth === "evidence" ? "Captions + evidence" : "Captions"}
          detail={`${facts.declaredLanguage} → ${languageName(request.targetLanguage)}`}
        />
        <ForecastFact
          label="Processing time"
          value="Unavailable"
          detail="No duration estimate contract is supplied."
          unavailable
        />
        <ForecastFact
          label="Estimated cost"
          value="Unavailable"
          detail="No pricing or billing contract is supplied."
          unavailable
        />
        <ForecastFact
          label="Runtime scale"
          value="Unavailable"
          detail="No worker-count or execution-plan contract is supplied."
          unavailable
        />
        <ForecastFact
          label="Source resolution"
          value="Recorded receipt loaded"
          detail="These values belong to the recorded demo source."
        />
      </div>
      <p className="preflight-contract-gap" role="note">
        The forecast surface is intentionally present now, but it will not show invented numbers. Future time and cost values need versioned backend estimates tied to this exact request.
      </p>
    </section>
  );
}

function ForecastFact({
  label,
  value,
  detail,
  unavailable = false,
}: {
  label: string;
  value: string;
  detail: string;
  unavailable?: boolean;
}) {
  return (
    <div className="preflight-forecast-fact" data-unavailable={unavailable || undefined}>
      <span>{label}</span>
      <b>{value}</b>
      <p>{detail}</p>
    </div>
  );
}

function ConfirmationReview({
  headingRef,
  request,
  facts,
}: {
  headingRef: RefObject<HTMLHeadingElement | null>;
  request: AnalysisRequest;
  facts: RecordedPreflightFacts;
}) {
  return (
    <section className="preflight-preparation" aria-labelledby="preflight-stage-title">
      <PreparationHeading
        headingRef={headingRef}
        kicker="Final review"
        title="Replay this recorded processing request"
        detail="Review the exact request before leaving setup. The final action is the future handoff point for a real runtime start receipt."
      />
      <dl className="preflight-confirmation-summary">
        <div><dt>Range</dt><dd>{formatSeconds(request.start)}–{formatSeconds(request.end)}</dd></div>
        <div><dt>Translation</dt><dd>{facts.declaredLanguage} → {languageName(request.targetLanguage)}</dd></div>
        <div><dt>Output</dt><dd>{request.outputDepth === "evidence" ? "Captions plus evidence and breakdown" : "Captions only"}</dd></div>
        <div><dt>Forecast</dt><dd>Time and cost unavailable</dd></div>
      </dl>
      <div className="preflight-next-sequence">
        <span>What happens next</span>
        <ol>
          <li>Studio leaves preparation and opens the processing canvas.</li>
          <li>The existing recorded agent and activity sequence replays.</li>
          <li>Recorded Results becomes available when that replay completes.</li>
        </ol>
      </div>
      <p className="preflight-preview-warning" role="note">
        <b>Recorded-run boundary</b>
        This final action replays existing evidence; it does not start new media processing.
      </p>
    </section>
  );
}

function languageName(code: string): string {
  return LANGUAGE_NAMES[code] ?? code;
}

function Choice({
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
    <label className="preflight-choice">
      <input type="radio" {...input} />
      <span>{label}</span>
    </label>
  );
}

function NumberField({ label, value, max, onChange }: { label: string; value: number; max: number; onChange: (value: number) => void }) {
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
