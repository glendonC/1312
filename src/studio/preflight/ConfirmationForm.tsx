import type { RunBundle } from "../transport";
import {
  HOSTED_MAX_RANGE_S,
  RECOMMENDED_RANGE_S,
  formatSeconds,
  type AnalysisRequest,
  type PreflightSession,
  type RangeAssessment,
} from "./model";
import type { RecordedSourceFacts } from "./sourceAdapters";

const LANGUAGE_NAMES: Record<string, string> = { en: "English", ko: "Korean", ja: "Japanese" };

interface ConfirmationFormProps {
  bundle: RunBundle;
  session: PreflightSession;
  facts: RecordedSourceFacts;
  assessment: RangeAssessment | null;
  update: (request: Partial<AnalysisRequest>) => void;
  cancel: () => void;
  confirm: () => void;
}

export default function ConfirmationForm({
  bundle,
  session,
  facts,
  assessment,
  update,
  cancel,
  confirm,
}: ConfirmationFormProps) {
  const { request } = session;
  const recommendation =
    assessment?.recommendation === "recommended"
      ? "Within the recommended 30–60 second range."
      : assessment?.recommendation === "short"
        ? "Shorter than the recommended 30 seconds."
        : assessment?.recommendation === "long"
          ? `Longer than the recommended ${RECOMMENDED_RANGE_S.max} seconds.`
          : null;

  return (
    <form
      className="preflight-form"
      onSubmit={(event) => {
        event.preventDefault();
        confirm();
      }}
    >
      <fieldset className="preflight-group">
        <legend>Analysis range</legend>
        <Choice
          name="range"
          value="recorded"
          checked={request.rangeMode === "recorded"}
          onChange={() => update({ rangeMode: "recorded", start: 0, end: facts.selection.duration })}
          label={`Recorded selection · 0:00–${formatSeconds(facts.selection.duration)}`}
        />
        <Choice name="range" value="suggested" checked={false} disabled label="Suggested range · no recommender output" />
        <Choice
          name="range"
          value="detected"
          checked={false}
          disabled
          label={`Whole detected ${LANGUAGE_NAMES[facts.declaredLanguage] ?? facts.declaredLanguage} range · no language detector output`}
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
              max={facts.selection.duration}
              onChange={(start) => update({ start })}
            />
            <NumberField
              label="End, seconds"
              value={request.end}
              max={facts.selection.duration}
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
          <span>Target language</span>
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

      <div className="preflight-actions">
        <button type="button" className="ghost" onClick={cancel}>
          Cancel
        </button>
        <button type="submit" className="cta" disabled={!assessment?.canReplay}>
          Replay recorded analysis
        </button>
      </div>
    </form>
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
