import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";

import { useStudio } from "../store";
import {
  codePointSlice,
  fullCodePointSpan,
  type AvailableLearningInsight,
  type LearningInsight,
  type LearningInsightKind,
  type LearningPrototypeProjection,
  type LearningReasonCode,
  type LearningViewingSource,
  type PreparedLearningSelection,
  type PresentedMoment,
  type SessionSavedSelection,
  type SelectedLanguageSpan,
} from "./model";
import {
  bindLearningPrototypeFixture,
  type LearningPrototypeFixtureV1,
} from "./prototypeFixture.ts";

type PinnedSelection =
  | { state: "prepared"; selection: PreparedLearningSelection; span: SelectedLanguageSpan }
  | {
      state: "unavailable";
      moment: PresentedMoment;
      span: SelectedLanguageSpan;
      reasonCode: "explanation_not_prepared";
    }
  | {
      state: "failed";
      moment: PresentedMoment;
      span: SelectedLanguageSpan;
      reasonCode: Extract<LearningPrototypeProjection, { state: "failed" }>["reasonCode"];
    };

const INSIGHT_LABELS: Record<LearningInsightKind, string> = {
  meaning: "Meaning in this scene",
  word: "Word meaning",
  phrase: "Phrase function",
  grammar: "Sentence structure",
  register: "Register",
  pragmatics: "Pragmatics",
  relationship: "Relationship implication",
  translation_choice: "Why the English fits",
  listening_difficulty: "Why this is difficult to hear",
  culture: "Cultural context",
  reference: "Reference context",
};

const PRESENTED_INSIGHT_ORDER = [
  "meaning",
  "word",
  "phrase",
  "grammar",
  "translation_choice",
] as const satisfies readonly LearningInsightKind[];

const REASON_LABELS: Record<LearningReasonCode, string> = {
  recorded_silence: "No language was recorded for this interval.",
  recorded_source_text_missing: "The recorded source caption is unavailable.",
  recorded_target_withheld: "The recorded target caption was withheld.",
  recorded_target_text_missing: "The recorded target caption is unavailable.",
  production_caption_withheld: "The verified production caption was withheld.",
  production_caption_unavailable: "The verified production caption is unavailable.",
  explanation_not_prepared: "No contextual explanation is prepared for this language moment.",
  prototype_facet_not_prepared: "This explanation facet was not prepared for the prototype.",
  follow_up_producer_missing: "Grounded follow-up answers are not implemented.",
  practice_checker_missing: "Response checking is not implemented.",
  canonical_saved_item_missing: "A canonical private saved-language item is not implemented.",
  export_adapter_missing: "No verified export adapter is implemented.",
  media_export_excluded_from_p0: "Media export is outside this prototype.",
  invalid_source_binding: "The prepared explanation does not bind to this recorded source.",
  invalid_fixture_binding: "The prepared explanation does not bind to this exact caption moment.",
  mixed_authority: "Recorded and production authority cannot be combined in one source projection.",
};

export default function LearningResults({
  source,
  prototypeFixture,
}: {
  source: LearningViewingSource;
  prototypeFixture: LearningPrototypeFixtureV1;
}) {
  const clipT = useStudio((state) => state.clipT);
  const setClipT = useStudio((state) => state.setClipT);
  const [pinned, setPinned] = useState<PinnedSelection | null>(null);
  const [saved, setSaved] = useState<SessionSavedSelection[]>([]);
  const [view, setView] = useState<"captions" | "my_set">("captions");
  const [returnFocus, setReturnFocus] = useState<HTMLElement | null>(null);
  const prototype = bindLearningPrototypeFixture(source, prototypeFixture);

  const selections = prototype.state === "ready" ? prototype.selections : [];
  const savedSelectionIds = new Set(saved.map((item) => item.id));

  const openPinned = (next: PinnedSelection, trigger: HTMLElement) => {
    setReturnFocus(trigger);
    setPinned(next);
  };

  const selectSentence = (moment: PresentedMoment, trigger: HTMLElement) => {
    if (moment.source.state !== "available") return;
    const fullSpan = fullCodePointSpan(moment.source.text, "source");
    if (prototype.state === "failed") {
      openPinned({ state: "failed", moment, span: fullSpan, reasonCode: prototype.reasonCode }, trigger);
      return;
    }
    const prepared = selections.find((candidate) =>
      candidate.lineId === moment.lineId &&
      candidate.span.start === fullSpan.start &&
      candidate.span.end === fullSpan.end &&
      candidate.span.text === fullSpan.text);
    openPinned(prepared
      ? { state: "prepared", selection: prepared, span: prepared.span }
      : { state: "unavailable", moment, span: fullSpan, reasonCode: "explanation_not_prepared" }, trigger);
  };

  const selectCaptionRange = (
    moment: PresentedMoment,
    momentSelections: PreparedLearningSelection[],
    sourceElement: HTMLElement,
  ) => {
    if (moment.source.state !== "available") return;
    const span = selectedCodePointSpan(sourceElement, moment.source.text);
    if (!span) return;

    if (prototype.state === "failed") {
      openPinned({ state: "failed", moment, span, reasonCode: prototype.reasonCode }, sourceElement);
    } else {
      const prepared = momentSelections.find((candidate) =>
        candidate.span.start === span.start &&
        candidate.span.end === span.end &&
        candidate.span.text === span.text);
      openPinned(prepared
        ? { state: "prepared", selection: prepared, span: prepared.span }
        : { state: "unavailable", moment, span, reasonCode: "explanation_not_prepared" }, sourceElement);
    }

    window.getSelection()?.removeAllRanges();
  };

  const closePinned = () => {
    const trigger = returnFocus;
    setPinned(null);
    setReturnFocus(null);
    requestAnimationFrame(() => trigger?.focus());
  };

  const keepSelection = (selection: PreparedLearningSelection) => {
    setSaved((current) => {
      if (current.some((item) => item.id === selection.selectionId)) return current;
      return [...current, sessionItem(source, selection)];
    });
  };

  return (
    <section className="learning-workspace" aria-label="Language learning workspace">
      <nav className="learning-view-switch" aria-label="Language workspace views">
        <button
          type="button"
          aria-pressed={view === "captions"}
          onClick={() => setView("captions")}
        >
          Captions
        </button>
        <button
          type="button"
          aria-pressed={view === "my_set"}
          onClick={() => setView("my_set")}
        >
          My Set ({saved.length})
        </button>
        <span className="learning-session-note">Session only</span>
      </nav>

      {view === "captions" ? (
        <>
          <p className="learning-caption-guide" id="learning-caption-guide">
            <b>Prepared prototype.</b> Tap highlighted language, select a phrase, or choose Explain sentence.
            Selection does not seek or pause playback.
          </p>
          {pinned && (
            <ExplanationPanel
              key={`${pinned.state}:${pinned.state === "prepared" ? pinned.selection.lineId : pinned.moment.lineId}:${pinned.span.start}:${pinned.span.end}`}
              pinned={pinned}
              kept={pinned.state === "prepared" && savedSelectionIds.has(pinned.selection.selectionId)}
              onKeep={keepSelection}
              onClose={closePinned}
            />
          )}
          {prototype.state === "failed" && (
            <div className="learning-workspace-failure" role="status" data-reason-code={prototype.reasonCode}>
              <b>Prepared explanation unavailable</b>
              <p>{REASON_LABELS[prototype.reasonCode]}</p>
              <code>{prototype.reasonCode}</code>
            </div>
          )}
          <div
            className="cues"
            aria-label="Korean to English transcript"
            aria-describedby="learning-caption-guide"
          >
            {source.moments.length === 0 ? (
              <p className="cues-empty">No caption cues were recorded. No transcript or result is implied.</p>
            ) : source.moments.map((moment) => {
              const momentSelections = selections.filter((candidate) => candidate.lineId === moment.lineId);
              const fullPrepared = preparedSentence(moment, momentSelections);
              const unavailableDemonstration = prototype.state === "ready" &&
                prototype.unavailableDemonstrationLineId === moment.lineId;
              const active = clipT * 1_000 >= moment.startMs && clipT * 1_000 < moment.endMs;
              const selectedLineId = pinned?.state === "prepared"
                ? pinned.selection.lineId
                : pinned?.moment.lineId;
              return (
                <article
                  key={moment.lineId}
                  className={`cue${active ? " is-active" : ""}${selectedLineId === moment.lineId ? " is-pinned" : ""}`}
                  data-learning-line-id={moment.lineId}
                  data-learning-pinned={selectedLineId === moment.lineId ? "true" : undefined}
                  data-withheld={moment.target.state === "withheld" ? "true" : undefined}
                  data-silence={moment.source.reasonCode === "recorded_silence" ? "true" : undefined}
                >
                  <button
                    type="button"
                    className="cue-t cue-seek"
                    aria-label={`Seek to ${momentClock(moment.startMs)}`}
                    onClick={() => setClipT(moment.startMs / 1_000)}
                  >
                    {momentClock(moment.startMs)}
                  </button>
                  <span className="cue-body">
                    {moment.source.state !== "available" ? (
                      <span className="cue-silence">
                        <span className="cue-silence-mark">
                          {moment.source.reasonCode === "recorded_silence" ? "silence" : "unavailable"}
                        </span>
                        <span className="cue-silence-dur">
                          {((moment.endMs - moment.startMs) / 1_000).toFixed(1)}s
                        </span>
                        <span className="cue-silence-note">{moment.source.detail}</span>
                      </span>
                    ) : (
                      <>
                        <span
                          className="cue-src"
                          lang={moment.sourceLanguage}
                          tabIndex={-1}
                          onPointerUp={(event) => selectCaptionRange(moment, momentSelections, event.currentTarget)}
                          onTouchEnd={(event) => selectCaptionRange(moment, momentSelections, event.currentTarget)}
                        >
                          {sourceText(moment, momentSelections, (selection, trigger) => {
                            openPinned({ state: "prepared", selection, span: selection.span }, trigger);
                          })}
                        </span>
                        {moment.target.state === "available" ? (
                          <span className="cue-tgt" lang={moment.targetLanguage}>{moment.target.text}</span>
                        ) : moment.target.state === "withheld" ? (
                          <span className="cue-withheld">
                            <span className="cue-withheld-mark">withheld</span>
                            {moment.target.detail}
                          </span>
                        ) : (
                          <span className="cue-unavailable">
                            <span>Target unavailable</span>
                            {moment.target.detail}
                          </span>
                        )}
                        {(fullPrepared || unavailableDemonstration) && (
                          <button
                            type="button"
                            className={`learning-sentence-action${unavailableDemonstration && !fullPrepared ? " is-unavailable" : ""}`}
                            aria-label={fullPrepared
                              ? `Explain Korean sentence at ${momentClock(moment.startMs)}`
                              : `View unavailable explanation at ${momentClock(moment.startMs)}`}
                            onClick={(event) => selectSentence(moment, event.currentTarget)}
                          >
                            {fullPrepared ? "Explain sentence" : "Explanation unavailable"}
                          </button>
                        )}
                      </>
                    )}
                  </span>
                </article>
              );
            })}
          </div>
        </>
      ) : (
        <MySet saved={saved} onRemove={(id) => setSaved((current) => current.filter((item) => item.id !== id))} />
      )}
    </section>
  );
}

function selectedCodePointSpan(sourceElement: HTMLElement, sourceText: string): SelectedLanguageSpan | null {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount !== 1) return null;
  const range = selection.getRangeAt(0);
  if (!sourceElement.contains(range.startContainer) || !sourceElement.contains(range.endContainer)) return null;

  try {
    const beforeStart = document.createRange();
    beforeStart.selectNodeContents(sourceElement);
    beforeStart.setEnd(range.startContainer, range.startOffset);
    const beforeEnd = document.createRange();
    beforeEnd.selectNodeContents(sourceElement);
    beforeEnd.setEnd(range.endContainer, range.endOffset);
    const start = Array.from(beforeStart.toString()).length;
    const end = Array.from(beforeEnd.toString()).length;
    const text = codePointSlice(sourceText, start, end);
    if (end <= start || !/\S/u.test(text) || text !== range.toString()) return null;
    return { side: "source", unit: "unicode_code_point", start, end, text };
  } catch {
    return null;
  }
}

function sourceText(
  moment: PresentedMoment,
  selections: PreparedLearningSelection[],
  onSelect: (selection: PreparedLearningSelection, trigger: HTMLButtonElement) => void,
): ReactNode[] | string {
  if (moment.source.state !== "available") return "";
  const text = moment.source.text;
  const fullLength = Array.from(text).length;
  const inlineSelections = selections
    .filter((selection) => selection.span.start !== 0 || selection.span.end !== fullLength)
    .sort((left, right) => left.span.start - right.span.start);
  if (inlineSelections.length === 0) return text;

  const nodes: ReactNode[] = [];
  let cursor = 0;
  for (const selection of inlineSelections) {
    if (selection.span.start < cursor) continue;
    const before = codePointSlice(text, cursor, selection.span.start);
    if (before) nodes.push(before);
    nodes.push(
      <button
        key={selection.selectionId}
        type="button"
        className="learning-span"
        aria-label={`Explain ${selection.span.text} at ${momentClock(selection.startMs)}`}
        onClick={(event) => onSelect(selection, event.currentTarget)}
      >
        {selection.span.text}
      </button>,
    );
    cursor = selection.span.end;
  }
  const after = codePointSlice(text, cursor, fullLength);
  if (after) nodes.push(after);
  return nodes;
}

function preparedSentence(
  moment: PresentedMoment,
  selections: PreparedLearningSelection[],
): PreparedLearningSelection | null {
  if (moment.source.state !== "available") return null;
  const fullSpan = fullCodePointSpan(moment.source.text, "source");
  return selections.find((selection) =>
    selection.span.start === fullSpan.start &&
    selection.span.end === fullSpan.end &&
    selection.span.text === fullSpan.text) ?? null;
}

function ExplanationPanel({
  pinned,
  kept,
  onKeep,
  onClose,
}: {
  pinned: PinnedSelection;
  kept: boolean;
  onKeep: (selection: PreparedLearningSelection) => void;
  onClose: () => void;
}) {
  const moment = pinned.state === "prepared" ? pinned.selection : pinned.moment;
  const selectedText = pinned.span.text;
  const panelRef = useRef<HTMLElement>(null);
  const presentedInsights = pinned.state === "prepared"
    ? orderedPresentedInsights(pinned.selection.insights)
    : [];
  const unavailableInsights = pinned.state === "prepared"
    ? pinned.selection.insights.filter((insight) => insight.availability !== "available")
    : [];

  useEffect(() => {
    panelRef.current?.focus();
  }, []);

  return (
    <aside
      className="learning-panel"
      ref={panelRef}
      tabIndex={-1}
      aria-label="Pinned language explanation"
      data-pinned-line-id={moment.lineId}
      data-learning-state={pinned.state === "prepared" ? "prototype" : pinned.state}
      data-selected-side={pinned.span.side}
      data-selected-start={pinned.span.start}
      data-selected-end={pinned.span.end}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          onClose();
        }
      }}
    >
      <header className="learning-panel-head">
        <div>
          <span>{pinned.state === "prepared" ? "Prepared prototype" : stateLabel(pinned.state)}</span>
          <h3 lang={moment.sourceLanguage}>{selectedText}</h3>
          <p>{momentClock(moment.startMs)} to {momentClock(moment.endMs)}</p>
        </div>
        <button type="button" className="learning-panel-close" aria-label="Close explanation" onClick={onClose}>
          Close
        </button>
      </header>

      {moment.target.state === "available" ? (
        <p className="learning-panel-translation" lang={moment.targetLanguage}>{moment.target.text}</p>
      ) : (
        <UnavailableState
          label={moment.target.state === "withheld" ? "Target withheld" : "Target unavailable"}
          reasonCode={moment.target.reasonCode}
          detail={moment.target.detail}
        />
      )}

      {pinned.state === "prepared" ? (
        <>
          <div className="learning-insights">
            {presentedInsights.map((insight) => (
              <section key={insight.kind} className="learning-insight" data-availability="available">
                <h4>{INSIGHT_LABELS[insight.kind]}</h4>
                <InsightBody insight={insight} />
              </section>
            ))}
          </div>
          {unavailableInsights.length > 0 && (
            <details className="learning-unavailable-facets">
              <summary>
                {unavailableInsights.length} unavailable {unavailableInsights.length === 1 ? "facet" : "facets"}
              </summary>
              {unavailableInsights.map((insight) => (
                <section key={insight.kind} className="learning-insight" data-availability={insight.availability}>
                  <h4>{INSIGHT_LABELS[insight.kind]}</h4>
                  <UnavailableState
                    label={insight.availability === "withheld" ? "Withheld" : "Unavailable"}
                    reasonCode={insight.reasonCode}
                  />
                </section>
              ))}
            </details>
          )}
          <div className="learning-panel-actions">
            <button
              type="button"
              className="learning-keep"
              disabled={kept}
              onClick={() => onKeep(pinned.selection)}
            >
              {kept ? "Kept in My Set" : "Keep in My Set"}
            </button>
          </div>
          <details className="learning-prototype-boundary">
            <summary>About this explanation</summary>
            <p>
              This is prepared design-fixture content bound to the exact recorded cue and selected code-point span.
              It was not generated by the runtime and has no semantic-review receipt or evidence citations.
            </p>
            <p>Only meaning, word or phrase, sentence structure, and translation rationale are shown.</p>
          </details>
        </>
      ) : (
        <UnavailableState
          label={pinned.state === "failed" ? "Explanation failed closed" : "Explanation unavailable"}
          reasonCode={pinned.reasonCode}
        />
      )}
    </aside>
  );
}

function orderedPresentedInsights(insights: LearningInsight[]): AvailableLearningInsight[] {
  return PRESENTED_INSIGHT_ORDER.flatMap((kind) => {
    const insight = insights.find((candidate) => candidate.kind === kind && candidate.availability === "available");
    return insight ? [insight as AvailableLearningInsight] : [];
  });
}

function InsightBody({ insight }: { insight: AvailableLearningInsight }) {
  switch (insight.kind) {
    case "meaning":
      return <p>{insight.content.sceneMeaning}</p>;
    case "word":
      return (
        <dl>
          <div><dt>Form</dt><dd>{insight.content.form}</dd></div>
          <div><dt>Sense here</dt><dd>{insight.content.sense}</dd></div>
          <div><dt>Role</dt><dd>{insight.content.role}</dd></div>
        </dl>
      );
    case "phrase":
      return <dl><div><dt>Form</dt><dd>{insight.content.form}</dd></div><div><dt>Function</dt><dd>{insight.content.function}</dd></div></dl>;
    case "grammar":
      return (
        <>
          <p><b>{insight.content.construction}</b></p>
          <p>{insight.content.explanation}</p>
          <dl>
            {insight.content.segments.map((segment) => (
              <div key={segment.form}><dt>{segment.form}</dt><dd>{segment.role}</dd></div>
            ))}
          </dl>
        </>
      );
    case "register":
    case "pragmatics":
    case "relationship":
      return <><p>{insight.content.observation}</p><p>{insight.content.implication}</p></>;
    case "translation_choice":
      return (
        <dl>
          <div><dt>Source choice</dt><dd>{insight.content.sourceChoice}</dd></div>
          <div><dt>English choice</dt><dd>{insight.content.targetChoice}</dd></div>
          <div><dt>Rationale</dt><dd>{insight.content.rationale}</dd></div>
        </dl>
      );
    case "listening_difficulty":
      return (
        <dl>
          <div><dt>Signal</dt><dd>{insight.content.signal}</dd></div>
          <div><dt>Difficulty</dt><dd>{insight.content.difficulty}</dd></div>
          <div><dt>Listen for</dt><dd>{insight.content.listeningCue}</dd></div>
        </dl>
      );
    case "culture":
      return <><p>{insight.content.context}</p>{insight.content.sourceLabel && <p>Source: {insight.content.sourceLabel}</p>}</>;
    case "reference":
      return <><p>{insight.content.context}</p><p>Source: {insight.content.sourceLabel}</p></>;
  }
}

function UnavailableState({
  label,
  reasonCode,
  detail,
}: {
  label: string;
  reasonCode: LearningReasonCode;
  detail?: string;
}) {
  return (
    <div className="learning-unavailable" data-reason-code={reasonCode}>
      <b>{label}</b>
      <p>{detail ?? REASON_LABELS[reasonCode]}</p>
      <code>{reasonCode}</code>
    </div>
  );
}

function MySet({ saved, onRemove }: { saved: SessionSavedSelection[]; onRemove: (id: string) => void }) {
  return (
    <section className="learning-my-set" aria-labelledby="learning-my-set-title">
      <header>
        <span>This session only</span>
        <h3 id="learning-my-set-title">My Set</h3>
        <p>Only language you explicitly keep appears here. Nothing is saved after this result session ends.</p>
      </header>
      {saved.length === 0 ? (
        <p className="learning-my-set-empty">Select a prepared word or sentence, then choose Keep in My Set.</p>
      ) : (
        <ul>
          {saved.map((item) => (
            <li key={item.id}>
              <div>
                <b lang={item.sourceLanguage}>{item.selection.text}</b>
                <span>{momentClock(item.startMs)} to {momentClock(item.endMs)}</span>
                {item.target.state === "available" && <p lang={item.targetLanguage}>{item.target.text}</p>}
              </div>
              <button type="button" onClick={() => onRemove(item.id)}>Remove</button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function sessionItem(source: LearningViewingSource, selection: PreparedLearningSelection): SessionSavedSelection {
  return {
    dataClass: "learner_owned_session_state",
    id: selection.selectionId,
    sourceOrigin: source.context.origin,
    lineId: selection.lineId,
    startMs: selection.startMs,
    endMs: selection.endMs,
    sourceLanguage: selection.sourceLanguage,
    targetLanguage: selection.targetLanguage,
    sourceText: selection.source.state === "available" ? selection.source.text : "",
    target: selection.target,
    selection: selection.span,
    insightKinds: selection.insights.map((insight) => insight.kind),
    practice: { state: "unavailable", reasonCode: "practice_checker_missing" },
    export: { state: "unavailable", reasonCode: "canonical_saved_item_missing" },
  };
}

function stateLabel(state: Exclude<PinnedSelection["state"], "prepared">): string {
  return state === "failed" ? "Failed closed" : "Unavailable";
}

function momentClock(milliseconds: number): string {
  const safe = Math.max(0, Math.trunc(milliseconds));
  const totalSeconds = Math.floor(safe / 1_000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const tenths = Math.floor((safe % 1_000) / 100);
  return `${minutes}:${String(seconds).padStart(2, "0")}.${tenths}`;
}
