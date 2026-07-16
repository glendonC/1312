import { AnimatePresence, motion } from "motion/react";
import { useRef, useState, type CSSProperties, type RefObject } from "react";

import type { StudioPreviewSession } from "../previewSession";
import type { RemoteSourceResolutionReceipt } from "../sourceResolution";
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
  cancel: () => void;
  confirm: () => void;
}

export default function SubmittedPreparationForm({
  resolution,
  previewSession,
  session,
  assessment,
  update,
  updateSourceLanguage,
  cancel,
  confirm,
}: SubmittedPreparationFormProps) {
  const [stage, setStage] = useState<PreparationStage>("source");
  const [furthestStage, setFurthestStage] = useState(0);
  const stageHeading = useRef<HTMLHeadingElement>(null);
  const durationSeconds = resolution.source.durationMs / 1_000;
  const preparation = previewSession.preparation;
  const currentStageIndex = preparationStageIndex(stage);
  const requestReady = assessment.canReplay && preparation.status === "ready";
  const blockingMessage = assessment.reason
    ?? (preparation.status === "invalid" ? preparation.message : null);

  function selectStage(nextStage: PreparationStage): void {
    if (preparationStageIndex(nextStage) <= furthestStage) setStage(nextStage);
  }

  function submitStage(): void {
    if (stage === "confirm") {
      confirm();
      return;
    }

    if ((stage === "range" || stage === "language" || stage === "output") && !requestReady) {
      return;
    }

    const nextIndex = currentStageIndex + 1;
    const nextStage = PREPARATION_STAGES[nextIndex]?.id;
    if (!nextStage) return;
    setFurthestStage((current) => Math.max(current, nextIndex));
    setStage(nextStage);
  }

  function previousStage(): void {
    if (currentStageIndex === 0) {
      cancel();
      return;
    }
    setStage(PREPARATION_STAGES[currentStageIndex - 1].id);
  }

  const advanceDisabled =
    (stage === "range" || stage === "language" || stage === "output") && !requestReady;

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
                assessment={assessment}
                preparationStatus={preparation.status}
                blockingMessage={blockingMessage}
                update={update}
              />
            )}

            {stage === "language" && (
              <SubmittedLanguageStage
                headingRef={stageHeading}
                previewSession={previewSession}
                session={session}
                blockingMessage={blockingMessage}
                update={update}
                updateSourceLanguage={updateSourceLanguage}
              />
            )}

            {stage === "output" && (
              <SubmittedOutputStage
                headingRef={stageHeading}
                session={session}
                update={update}
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

        <div className="preflight-actions" data-stage={stage}>
          <button type="button" className="ghost" onClick={previousStage}>
            {stage === "source" ? "Cancel" : `Back to ${PREPARATION_STAGES[currentStageIndex - 1].label}`}
          </button>
          <button type="submit" className="cta" disabled={advanceDisabled}>
            {advanceLabel(stage)}
          </button>
        </div>
      </motion.section>
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
  return (
    <section className="preflight-preparation">
      <PreparationHeading
        headingRef={headingRef}
        kicker="Source ready"
        title={`I found the source. It’s ${formatSeconds(resolution.source.durationMs / 1_000)} long.`}
        detail="I only asked the provider for its title, creator, and duration. The media itself remains untouched."
      />
      <div
        className="preflight-submitted-source"
        role="note"
        aria-label="Submitted source metadata boundary"
      >
        <div className="preflight-submitted-source-copy">
          <span>Resolved source</span>
          <h2>{resolution.source.label}</h2>
          <small>{resolution.source.creator ?? "Creator unavailable from provider metadata"}</small>
        </div>
        <p className="preflight-submitted-boundary">
          Provider metadata only <span aria-hidden="true">·</span> media not retrieved
        </p>
        <details className="preflight-submitted-details">
          <summary>Source details</summary>
          <dl>
            <div><dt>Full duration</dt><dd>{formatSeconds(resolution.source.durationMs / 1_000)}</dd></div>
            <div><dt>Measurement</dt><dd>Provider metadata</dd></div>
            <div><dt>Resolver</dt><dd>{resolution.producer.tool.id} {resolution.producer.tool.version}</dd></div>
            <div><dt>Processing</dt><dd>Not started</dd></div>
            <div><dt>Media bytes</dt><dd>Not retrieved</dd></div>
            <div><dt>Rights</dt><dd>Not established</dd></div>
            <div><dt>Tracks</dt><dd>Not measured</dd></div>
            <div><dt>Detected language</dt><dd>Unavailable</dd></div>
          </dl>
        </details>
      </div>
    </section>
  );
}

function SubmittedRangeStage({
  headingRef,
  durationSeconds,
  session,
  assessment,
  preparationStatus,
  blockingMessage,
  update,
}: {
  headingRef: RefObject<HTMLHeadingElement | null>;
  durationSeconds: number;
  session: PreflightSession;
  assessment: RangeAssessment;
  preparationStatus: StudioPreviewSession["preparation"]["status"];
  blockingMessage: string | null;
  update: (request: Partial<AnalysisRequest>) => void;
}) {
  return (
    <section className="preflight-preparation">
      <PreparationHeading
        headingRef={headingRef}
        kicker="Analysis range"
        title="Choose the section to prepare"
        detail={`Studio can prepare up to ${formatSeconds(SUBMITTED_PREPARATION_POLICY.maximumDurationMs / 1_000)} and never trims your selection.`}
      />
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
  update,
  updateSourceLanguage,
}: {
  headingRef: RefObject<HTMLHeadingElement | null>;
  previewSession: StudioPreviewSession;
  session: PreflightSession;
  blockingMessage: string | null;
  update: (request: Partial<AnalysisRequest>) => void;
  updateSourceLanguage: (intent: SubmittedSourceLanguageIntent) => void;
}) {
  return (
    <section className="preflight-preparation">
      <PreparationHeading
        headingRef={headingRef}
        kicker="Language direction"
        title="Tell Studio how to handle language"
        detail="You can request automatic detection later or declare the source language yourself. Nothing has been detected yet."
      />
      <div className="preflight-language-stage">
        <fieldset className="preflight-group preflight-language-intent">
          <legend>Source language</legend>
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
      {blockingMessage && <p className="preflight-block" role="status">{blockingMessage}</p>}
    </section>
  );
}

function SubmittedOutputStage({
  headingRef,
  session,
  update,
}: {
  headingRef: RefObject<HTMLHeadingElement | null>;
  session: PreflightSession;
  update: (request: Partial<AnalysisRequest>) => void;
}) {
  return (
    <section className="preflight-preparation">
      <PreparationHeading
        headingRef={headingRef}
        kicker="Requested output"
        title="Choose what Studio should prepare"
        detail="This sets the request depth. Processing still has not started."
      />
      <fieldset className="preflight-group preflight-output-stage">
        <legend>Output depth</legend>
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
    </section>
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
      <PreparationHeading
        headingRef={headingRef}
        kicker="Request forecast"
        title="Here’s what Studio knows so far"
        detail="Your choices are bound to the resolved metadata. Runtime timing and cost remain unavailable until a compatible producer runs."
      />
      <div className="preflight-forecast-ledger">
        <section aria-labelledby="forecast-known-title">
          <span>Bound request</span>
          <h3 id="forecast-known-title">Known</h3>
          <dl>
            <div><dt>Source</dt><dd>{resolution.source.label}</dd></div>
            <div><dt>Creator</dt><dd>{resolution.source.creator ?? "Unavailable from provider metadata"}</dd></div>
            <div><dt>Selected range</dt><dd>{rangeLabel(request)}</dd></div>
            <div><dt>Source language</dt><dd>{sourceLanguageLabel(request)}</dd></div>
            <div><dt>Target</dt><dd>{languageName(request.language.target)}</dd></div>
            <div><dt>Output</dt><dd>{outputLabel(request)}</dd></div>
          </dl>
        </section>
        <aside aria-labelledby="forecast-unavailable-title">
          <span>Not measured</span>
          <h3 id="forecast-unavailable-title">Unavailable</h3>
          <dl>
            <div><dt>Processing time</dt><dd>Unavailable</dd></div>
            <div><dt>Estimated cost</dt><dd>Unavailable</dd></div>
            <div><dt>Runtime scale</dt><dd>Unavailable</dd></div>
            <div><dt>Workload facts</dt><dd>Unavailable</dd></div>
          </dl>
        </aside>
      </div>
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
      <PreparationHeading
        headingRef={headingRef}
        kicker="Final review"
        title="Preview the interface with a recorded run"
        detail="This final action preserves your request while Studio replays the bundled demonstration. It does not submit a runtime command."
      />
      <dl className="preflight-confirmation-summary">
        <div><dt>Source</dt><dd>{resolution.source.label}</dd></div>
        <div><dt>Full duration</dt><dd>{formatSeconds(resolution.source.durationMs / 1_000)}</dd></div>
        <div><dt>Range</dt><dd>{rangeLabel(request)}</dd></div>
        <div><dt>Source language</dt><dd>{sourceLanguageLabel(request)}</dd></div>
        <div><dt>Target</dt><dd>{languageName(request.language.target)}</dd></div>
        <div><dt>Output</dt><dd>{outputLabel(request)}</dd></div>
      </dl>
      <RequestIdentity request={request} />
      <p className="preflight-preview-warning" role="note">
        <b>Submitted-link boundary</b>
        Your submitted link remains untouched. No media was downloaded, registered, analyzed, captioned, or translated.
      </p>
    </section>
  );
}

function RequestIdentity({ request }: { request: SubmittedSourcePreparationRequest }) {
  const shortIdentity = request.requestId.replace("submitted-preparation:", "").slice(0, 12);
  return (
    <details
      className="preflight-request-identity"
      data-submitted-preparation-request-id={request.requestId}
    >
      <summary>
        <span>Preparation identity</span>
        <code>{shortIdentity}…</code>
      </summary>
      <code>{request.requestId}</code>
      <small>
        {request.schema} · policy {request.policy.id} v{request.policy.version} · no runtime-start semantics
      </small>
    </details>
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
    <label className="preflight-choice">
      <input type="radio" {...input} />
      <span>{label}</span>
    </label>
  );
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

function languageName(code: string): string {
  return LANGUAGE_NAMES[code] ?? code;
}

function rangeLabel(request: SubmittedSourcePreparationRequest): string {
  return `${formatSeconds(request.range.startMs / 1_000)}–${formatSeconds(request.range.endMs / 1_000)} · ${formatSeconds((request.range.endMs - request.range.startMs) / 1_000)}`;
}

function sourceLanguageLabel(request: SubmittedSourcePreparationRequest): string {
  return request.language.source.mode === "automatic"
    ? "Automatic requested · detection not started"
    : `${languageName(request.language.source.language)} · user declared`;
}

function outputLabel(request: SubmittedSourcePreparationRequest): string {
  return request.output.depth === "evidence" ? "Captions plus evidence" : "Captions only";
}
