import { useEffect, useRef, useState, type RefObject } from "react";

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

const LANGUAGE_NAMES: Record<string, string> = { en: "English", ko: "Korean", ja: "Japanese" };

interface ConfirmationFormProps {
  bundle: RunBundle;
  session: PreflightSession;
  facts: RecordedPreflightFacts;
  assessment: RangeAssessment | null;
  update: (request: Partial<AnalysisRequest>) => void;
  cancel: () => void;
  confirm: () => void;
}

type PreparationStage = "configure" | "forecast" | "confirm";

export default function ConfirmationForm({
  bundle,
  session,
  facts,
  assessment,
  update,
  cancel,
  confirm,
}: ConfirmationFormProps) {
  const [stage, setStage] = useState<PreparationStage>("configure");
  const stageHeading = useRef<HTMLHeadingElement>(null);
  const stageHasMounted = useRef(false);
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
      if (assessment?.canReplay) setStage("forecast");
      return;
    }
    if (stage === "forecast") {
      setStage("confirm");
      return;
    }
    confirm();
  }

  return (
    <form
      className="preflight-form"
      data-preparation-stage={stage}
      onSubmit={(event) => {
        event.preventDefault();
        submitStage();
      }}
    >
      {stage === "configure" && (
        <section className="preflight-preparation" aria-labelledby="preflight-stage-title">
          <PreparationHeading
            headingRef={stageHeading}
            kicker="Request setup"
            title="Choose what Studio should prepare"
            detail="Confirm the measured selection, language target, and output before replaying the recorded processing sequence."
          />

          <fieldset className="preflight-group">
            <legend>Analysis range</legend>
            <>
              <Choice
                name="range"
                value="full-source"
                checked={false}
                disabled
                label="Entire source · the recorded demo contains only its selected window"
              />
              <Choice
                name="range"
                value="recorded"
                checked={request.rangeMode === "recorded"}
                onChange={() => update({ rangeMode: "recorded", start: 0, end: facts.selection.duration })}
                label={`Recorded selection · 0:00–${formatSeconds(facts.selection.duration)}`}
              />
            </>
            <Choice name="range" value="suggested" checked={false} disabled label="Suggested range · no recommender output" />
            <Choice
              name="range"
              value="detected"
              checked={false}
              disabled
              label={
                facts.languageRanges
                  ? "Measured language ranges · preflight evidence only; no replayable detected-language subrange"
                  : "Whole detected-language range · no language detector output"
              }
            />
            <Choice
              name="range"
              value="custom"
              checked={request.rangeMode === "custom"}
              onChange={() => update({ rangeMode: "custom" })}
              label="Custom start and end"
            />

            {request.rangeMode === "custom" && (
              <div className="preflight-range-fields">
                <NumberField
                  label="Start, seconds"
                  value={request.start}
                  max={selectableDuration}
                  onChange={(start) => update({ start })}
                />
                <NumberField
                  label="End, seconds"
                  value={request.end}
                  max={selectableDuration}
                  onChange={(end) => update({ end })}
                />
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

          <div className="preflight-primary">
            <label>
              <span>Translation target</span>
              <select value={request.targetLanguage} onChange={(event) => update({ targetLanguage: event.currentTarget.value })}>
                <option value={bundle.run.pair.target}>{languageName(bundle.run.pair.target)}</option>
              </select>
            </label>

            <fieldset className="preflight-group preflight-output">
              <legend>Result detail</legend>
              <Choice
                name="output"
                value="captions"
                checked={request.outputDepth === "captions"}
                onChange={() => update({ outputDepth: "captions" })}
                label="Captions only"
              />
              <Choice
                name="output"
                value="evidence"
                checked={request.outputDepth === "evidence"}
                onChange={() => update({ outputDepth: "evidence" })}
                label="Captions plus evidence and breakdown"
              />
            </fieldset>
          </div>

          <AdvancedFields request={request} update={update} relevance={session.relevance} />

          <details className="preflight-coverage">
            <summary>Producer coverage</summary>
            <p>
              Rights, raw source window, and duration: <code>{facts.producer}</code>.
              {facts.mediaProbe && (
                <>
                  {" "}Tracks and codecs: <code>{facts.mediaProbe.producer}</code>.
                </>
              )}
              {facts.content && (
                <>
                  {" "}Raw content identity and {facts.content.derivedArtifacts} derived receipt: <code>SHA-256</code>.
                </>
              )}
              {facts.speechActivity && (
                <>
                  {" "}Speech windows: <code>{facts.speechActivity.producer.id} {facts.speechActivity.producer.version}</code>.
                </>
              )}
              {facts.languageRanges && (
                <>
                  {" "}Language ranges: <code>{facts.languageRanges.producer.id} {facts.languageRanges.producer.version}</code>.
                </>
              )}
            </p>
            <ul>
              {session.missing.map((gap) => (
                <li key={gap.id}>
                  <b>{gap.label}</b>
                  <span>{gap.consequence}</span>
                </li>
              ))}
            </ul>
            <p>
              Speaker labels in this run are diarizer output, not human-confirmed identities. An empty <code>music[]</code> means no detector ran, not that the clip was proven music-free.
            </p>
          </details>

          {assessment?.reason && (
            <p className="preflight-block" role="status">
              {assessment.reason}
            </p>
          )}
        </section>
      )}

      {stage === "forecast" && (
        <ForecastReview
          headingRef={stageHeading}
          request={request}
          facts={facts}
          assessment={assessment}
        />
      )}

      {stage === "confirm" && (
        <ConfirmationReview
          headingRef={stageHeading}
          request={request}
          facts={facts}
        />
      )}

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
        <button type="submit" className="cta" disabled={stage === "configure" && !assessment?.canReplay}>
          {stage === "configure"
            ? "Continue to forecast"
            : stage === "forecast"
              ? "Review request"
              : "Replay recorded analysis"}
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
