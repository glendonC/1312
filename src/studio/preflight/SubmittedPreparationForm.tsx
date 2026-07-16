import { useEffect, useRef, useState, type RefObject } from "react";

import type { StudioPreviewSession } from "../previewSession";
import type { RemoteSourceResolutionReceipt } from "../sourceResolution";
import SourceDisplay from "../SourceDisplay";
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

const LANGUAGE_NAMES: Record<string, string> = { en: "English", ko: "Korean", ja: "Japanese" };
type PreparationStage = "configure" | "forecast" | "confirm";

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
  const [stage, setStage] = useState<PreparationStage>("configure");
  const stageHeading = useRef<HTMLHeadingElement>(null);
  const stageHasMounted = useRef(false);
  const durationSeconds = resolution.source.durationMs / 1_000;
  const preparation = previewSession.preparation;

  useEffect(() => {
    if (!stageHasMounted.current) {
      stageHasMounted.current = true;
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      stageHeading.current?.focus();
      stageHeading.current?.scrollIntoView({ block: "start", inline: "nearest", behavior: "smooth" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [stage]);

  function submitStage(): void {
    if (stage === "configure") {
      if (assessment.canReplay && preparation.status === "ready") setStage("forecast");
      return;
    }
    if (stage === "forecast") {
      setStage("confirm");
      return;
    }
    confirm();
  }

  const blockingMessage = assessment.reason
    ?? (preparation.status === "invalid" ? preparation.message : null);

  return (
    <form
      className="preflight-form"
      data-preparation-stage={stage}
      data-preparation-status={preparation.status}
      data-submitted-preparation-request-id={
        preparation.status === "ready" ? preparation.request.requestId : undefined
      }
      onSubmit={(event) => {
        event.preventDefault();
        submitStage();
      }}
    >
      <div className="preflight-submitted-scroll">
        <header className="preflight-head preflight-submitted-head">
          <span className="preflight-kicker">Submitted source · metadata resolved</span>
          <h1 id="preflight-title">{resolution.source.label}</h1>
          <p>
            {resolution.source.creator ? `${resolution.source.creator} · ` : ""}
            {formatSeconds(resolution.source.durationMs / 1_000)} total. Provider metadata only; media bytes have not been retrieved or inspected.
          </p>
        </header>

        <div className="preflight-submitted-source" role="note" aria-label="Submitted source metadata boundary">
          <div>
            <span>Resolved YouTube source</span>
            <SourceDisplay source={previewSession.source} title={previewSession.source.raw} />
            <strong>{resolution.source.label}</strong>
            <small>{resolution.source.creator ?? "Creator unavailable from provider metadata"}</small>
          </div>
          <dl>
            <div><dt>Full duration</dt><dd>{formatSeconds(resolution.source.durationMs / 1_000)}</dd></div>
            <div><dt>Measurement</dt><dd>Provider metadata</dd></div>
            <div><dt>Resolver</dt><dd>{resolution.producer.tool.id} {resolution.producer.tool.version}</dd></div>
            <div><dt>Processing</dt><dd>Not started</dd></div>
          </dl>
        </div>

      {stage === "configure" && (
        <section className="preflight-preparation" aria-labelledby="preflight-stage-title">
          <PreparationHeading
            headingRef={stageHeading}
            kicker="Request setup"
            title="Choose the submitted-source request"
            detail="Only resolved provider metadata and choices you make here belong to this request. Media access, rights, tracks, speech, and language have not been measured."
          />

          <fieldset className="preflight-group">
            <legend>Analysis range</legend>
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
              This request contract rejects selections longer than {SUBMITTED_PREPARATION_POLICY.maximumDurationMs / 1_000} seconds.
              Studio never trims the range. No recommender or content detector has run.
            </p>
          </fieldset>

          <fieldset className="preflight-group preflight-language-intent">
            <legend>Source language</legend>
            <Choice
              name="source-language"
              value="automatic"
              checked={previewSession.sourceLanguage.mode === "automatic"}
              onChange={() => updateSourceLanguage({ mode: "automatic", language: null })}
              label="Automatic · request detection later; nothing is detected yet"
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

          <div className="preflight-primary">
            <label>
              <span>Requested target language</span>
              <select
                value={session.request.targetLanguage}
                onChange={(event) => update({ targetLanguage: event.currentTarget.value })}
              >
                <option value="en">English</option>
              </select>
            </label>

            <fieldset className="preflight-group preflight-output">
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
          </div>

          <dl className="preflight-unavailable-ledger" aria-label="Unavailable submitted-source facts">
            <div><dt>Media bytes</dt><dd>Not retrieved</dd></div>
            <div><dt>Rights</dt><dd>Not established</dd></div>
            <div><dt>Tracks</dt><dd>Not measured</dd></div>
            <div><dt>Detected language</dt><dd>Unavailable</dd></div>
          </dl>

          {preparation.status === "building" && (
            <p className="preflight-binding" role="status">Binding the exact choices to the validated metadata receipt…</p>
          )}
          {blockingMessage && <p className="preflight-block" role="status">{blockingMessage}</p>}
        </section>
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
      </div>

      <div className="preflight-actions" data-stage={stage}>
        {stage === "configure" ? (
          <button type="button" className="ghost" onClick={cancel}>Cancel</button>
        ) : (
          <button
            type="button"
            className="ghost"
            onClick={() => setStage(stage === "confirm" ? "forecast" : "configure")}
          >
            {stage === "confirm" ? "Back to forecast" : "Back to request"}
          </button>
        )}
        <button
          type="submit"
          className="cta"
          disabled={stage === "configure" && (!assessment.canReplay || preparation.status !== "ready")}
        >
          {stage === "configure"
            ? "Continue to forecast"
            : stage === "forecast"
              ? "Review request"
              : "Preview recorded processing"}
        </button>
      </div>
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
    <section className="preflight-preparation" aria-labelledby="preflight-stage-title">
      <PreparationHeading
        headingRef={headingRef}
        kicker="Request forecast"
        title="Known request, unavailable execution forecast"
        detail="This preparation identity records the source metadata and your choices. No runtime plan or processing estimate exists for the submitted URL."
      />
      <div className="preflight-forecast-ledger">
        <section aria-labelledby="forecast-known-title">
          <span>Bound request</span>
          <h3 id="forecast-known-title">What is known</h3>
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
          <span>No compatible producer contract</span>
          <h3 id="forecast-unavailable-title">Unavailable</h3>
          <dl>
            <div><dt>Processing time</dt><dd>Unavailable</dd></div>
            <div><dt>Estimated cost</dt><dd>Unavailable</dd></div>
            <div><dt>Runtime scale</dt><dd>Unavailable</dd></div>
            <div><dt>Workload facts</dt><dd>Unavailable</dd></div>
          </dl>
        </aside>
      </div>
      <RequestIdentity request={request} />
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
    <section className="preflight-preparation" aria-labelledby="preflight-stage-title">
      <PreparationHeading
        headingRef={headingRef}
        kicker="Final review"
        title="Preview the interface with a recorded run"
        detail="This final action does not submit a runtime command. It preserves this preparation identity while Studio replays the bundled demonstration."
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
      <div className="preflight-next-sequence">
        <span>What happens next</span>
        <ol>
          <li>Studio preserves this preparation request for the preview and Results boundary.</li>
          <li>The bundled run-006 activity and agents replay as a recorded interface demonstration.</li>
          <li>Results explicitly report that no submitted-source artifact was produced.</li>
        </ol>
      </div>
      <p className="preflight-preview-warning" role="note">
        <b>Submitted-link boundary</b>
        Your submitted link remains untouched. No media was downloaded, registered, analyzed, captioned, or translated.
      </p>
    </section>
  );
}

function RequestIdentity({ request }: { request: SubmittedSourcePreparationRequest }) {
  return (
    <p
      className="preflight-request-identity"
      data-submitted-preparation-request-id={request.requestId}
    >
      <span>Preparation identity</span>
      <code>{request.requestId}</code>
      <small>
        {request.schema} · policy {request.policy.id} v{request.policy.version} · no runtime-start semantics
      </small>
    </p>
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
