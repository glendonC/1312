import type { ReactNode } from "react";
import { useEffect, useId, useRef, useState } from "react";

import { Bookmark } from "../glyphs";
import {
  codePointSlice,
  fullCodePointSpan,
  type LearningReasonCode,
  type PresentedMoment,
  type SelectedLanguageSpan,
} from "./model";
import type {
  AvailableLearningFacet,
  LearningExplanationState,
  LearningFacet,
  LearningFacetKind,
  LearningPlayback,
  LearningPresentation,
  LearningPrototypeProjection,
  LearningSelectionRequest,
  PreparedLearningSelection,
  ProductionLearningInteraction,
  SessionSavedSelection,
} from "./presentation.ts";

type PinnedSelection =
  | { state: "prepared"; selection: PreparedLearningSelection; span: SelectedLanguageSpan }
  | { state: "production"; request: LearningSelectionRequest }
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

const INSIGHT_LABELS: Record<LearningFacetKind, string> = {
  meaning: "Meaning in this scene",
  word: "Word meaning",
  phrase: "Phrase function",
  grammar: "Sentence structure",
  translation_choice: "Why the English fits",
};

const PRESENTED_INSIGHT_ORDER = [
  "meaning",
  "word",
  "phrase",
  "grammar",
  "translation_choice",
] as const satisfies readonly LearningFacetKind[];

const REASON_LABELS: Record<LearningReasonCode, string> = {
  recorded_silence: "No language was recorded for this interval.",
  recorded_source_text_missing: "The recorded source caption is unavailable.",
  recorded_target_withheld: "The recorded target caption was withheld.",
  recorded_target_text_missing: "The recorded target caption is unavailable.",
  production_caption_withheld: "The verified production caption was withheld.",
  production_caption_unavailable: "The verified production caption is unavailable.",
  explanation_not_prepared: "No contextual explanation is prepared for this language moment.",
  production_media_playback_unavailable: "Private production media playback is not connected to the browser learning surface.",
  production_explanation_interaction_unavailable: "Private media playback is verified. Production explanation interaction is not connected yet.",
  production_explanation_executor_unavailable: "No production explanation executor is configured for this runtime host.",
  caption_authority_revoked: "Caption authority was revoked after completion, so no new explanation may be requested.",
  generator_abstained: "The production explanation generator abstained.",
  facet_not_applicable: "This facet does not apply to the selected span.",
  insufficient_caption_context: "The verified caption context is insufficient for this facet.",
  target_unavailable: "The verified target caption is unavailable for this facet.",
  explanation_request_failed: "The production explanation request failed closed.",
  explanation_retry_exhausted: "The fixed production explanation retry ceiling is exhausted.",
  canonical_saved_item_missing: "A canonical private saved-language item is not implemented.",
  export_adapter_missing: "No verified export adapter is implemented.",
  media_export_excluded_from_p0: "Media export is outside this prototype.",
  invalid_source_binding: "The prepared explanation does not bind to this recorded source.",
  invalid_fixture_binding: "The prepared explanation does not bind to this exact caption moment.",
  invalid_explanation_binding: "The production explanation does not bind to this exact verified caption span.",
  mixed_authority: "Recorded and production authority cannot be combined in one source projection.",
};

export default function LearningResults({
  presentation,
  playback,
  productionInteraction,
}: {
  presentation: LearningPresentation;
  playback: LearningPlayback;
  productionInteraction?: ProductionLearningInteraction;
}) {
  const { source } = presentation;
  const [pinned, setPinned] = useState<PinnedSelection | null>(null);
  const [saved, setSaved] = useState<SessionSavedSelection[]>([]);
  const [savedOpen, setSavedOpen] = useState(false);
  const [returnFocus, setReturnFocus] = useState<HTMLElement | null>(null);
  const captionGuideId = useId();
  const savedId = useId();
  const prototype = presentation.mode === "prototype" ? presentation.explanations : null;
  const productionReady = presentation.mode === "production" &&
    presentation.explanations.state === "ready" &&
    productionInteraction !== undefined &&
    productionPlaybackMatches(presentation, playback);
  const sourceKey = presentation.mode === "prototype"
    ? `${source.context.identities.runId}:${source.context.identities.captionContentId ?? "none"}`
    : `${source.context.identities.runId}:${source.context.identities.captionContentId}`;

  const selections = prototype?.state === "ready" ? prototype.selections : [];
  const savedSelectionIds = new Set(saved.map((item) => item.id));

  useEffect(() => {
    setPinned(null);
    setSaved([]);
    setSavedOpen(false);
    setReturnFocus(null);
  }, [sourceKey]);

  useEffect(() => {
    if (presentation.mode === "production" && !productionReady) {
      setPinned(null);
      setReturnFocus(null);
    }
  }, [presentation.mode, productionReady]);

  const openPinned = (next: PinnedSelection, trigger: HTMLElement) => {
    setReturnFocus(trigger);
    setPinned(next);
  };

  const selectSentence = (moment: PresentedMoment, trigger: HTMLElement) => {
    if (moment.source.state !== "available") return;
    const fullSpan = fullCodePointSpan(moment.source.text, "source");
    if (!prototype) {
      if (productionReady) requestProductionSelection(moment, fullSpan, trigger);
      return;
    }
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
    textElement: HTMLElement,
    side: "source" | "target",
  ) => {
    const selectedText = side === "source" ? moment.source : moment.target;
    if (selectedText.state !== "available") return;
    const span = selectedCodePointSpan(textElement, selectedText.text, side);
    if (!span) return;

    if (!prototype) {
      if (productionReady) requestProductionSelection(moment, span, textElement);
      window.getSelection()?.removeAllRanges();
      return;
    }
    if (side !== "source") return;
    if (prototype.state === "failed") {
      openPinned({ state: "failed", moment, span, reasonCode: prototype.reasonCode }, textElement);
    } else {
      const prepared = momentSelections.find((candidate) =>
        candidate.span.start === span.start &&
        candidate.span.end === span.end &&
        candidate.span.text === span.text);
      openPinned(prepared
        ? { state: "prepared", selection: prepared, span: prepared.span }
        : { state: "unavailable", moment, span, reasonCode: "explanation_not_prepared" }, textElement);
    }

    window.getSelection()?.removeAllRanges();
  };

  const requestProductionSelection = (
    moment: PresentedMoment,
    span: SelectedLanguageSpan,
    trigger: HTMLElement,
  ) => {
    if (!productionReady || !productionInteraction) return;
    const request: LearningSelectionRequest = {
      lineId: moment.lineId,
      startMs: moment.startMs,
      endMs: moment.endMs,
      sourceLanguage: moment.sourceLanguage,
      targetLanguage: moment.targetLanguage,
      source: moment.source,
      target: moment.target,
      span: { ...span },
    };
    productionInteraction.onRequest(request);
    openPinned({ state: "production", request }, trigger);
  };

  const closePinned = () => {
    const trigger = returnFocus;
    setPinned(null);
    setReturnFocus(null);
    requestAnimationFrame(() => trigger?.focus());
  };

  const keepSelection = (selection: PreparedLearningSelection) => {
    if (presentation.mode !== "prototype" || selection.authority.dataClass !== "design_fixture") return;
    setSaved((current) => {
      if (current.some((item) => item.id === selection.selectionId)) return current;
      return [...current, sessionItem(presentation.source, selection)];
    });
  };

  return (
    <section
      className="learning-workspace"
      aria-label="Language learning workspace"
      data-learning-mode={presentation.mode}
    >
      {presentation.mode === "prototype" && <div className="learning-bar">
        <button
          type="button"
          className="learning-saved-toggle"
          aria-expanded={savedOpen}
          aria-controls={savedId}
          onClick={() => setSavedOpen((open) => !open)}
        >
          <Bookmark filled={saved.length > 0} />
          <span>Saved{saved.length > 0 ? ` (${saved.length})` : ""}</span>
        </button>
        <span className="learning-session-note">Session only</span>
      </div>}

      <>
          <p className="learning-caption-guide" id={captionGuideId}>
            {presentation.mode === "prototype" ? (
              <><b>Prepared prototype.</b> Tap highlighted language, select a phrase, or choose Explain sentence.
                Selection does not seek or pause playback.</>
            ) : (
              productionReady ? (
                <><b>Verified production playback.</b> Caption seeking follows the exact private source timeline.
                  Select an available source or target span, or choose Explain source sentence. No prototype
                  explanation is substituted.</>
              ) : (
                <><b>Verified production captions.</b> Learning selection is unavailable until this private media can
                  play in the browser. No prototype explanation is substituted.</>
              )
            )}
          </p>
          {pinned && (
            <ExplanationPanel
              key={`${pinned.state}:${pinnedLineId(pinned)}:${pinnedSpan(pinned).start}:${pinnedSpan(pinned).end}`}
              pinned={pinned}
              kept={pinned.state === "prepared" && savedSelectionIds.has(pinned.selection.selectionId)}
              onKeep={keepSelection}
              onClose={closePinned}
              productionExplanation={productionInteraction?.explanation ?? null}
              onProductionRetry={(request) => productionInteraction?.onRetry(request)}
            />
          )}
          {prototype?.state === "failed" && (
            <div className="learning-workspace-failure" role="status" data-reason-code={prototype.reasonCode}>
              <b>Prepared explanation unavailable</b>
              <p>{REASON_LABELS[prototype.reasonCode]}</p>
              <code>{prototype.reasonCode}</code>
            </div>
          )}
          {presentation.mode === "production" && presentation.explanations.state === "unavailable" && (
            <div
              className="learning-workspace-failure"
              role="status"
              data-reason-code={presentation.explanations.reasonCode}
            >
              <b>Production learning unavailable</b>
              <p>{REASON_LABELS[presentation.explanations.reasonCode]}</p>
              <code>{presentation.explanations.reasonCode}</code>
            </div>
          )}
          <div
            className="cues"
            aria-label={`${source.moments[0]?.sourceLanguage ?? "Source"} to ${source.moments[0]?.targetLanguage ?? "target"} transcript`}
            aria-describedby={captionGuideId}
          >
            {source.moments.length === 0 ? (
              <p className="cues-empty">No caption cues were recorded. No transcript or result is implied.</p>
            ) : source.moments.map((moment) => {
              const momentSelections = selections.filter((candidate) => candidate.lineId === moment.lineId);
              const fullPrepared = preparedSentence(moment, momentSelections);
              const active = playback.state === "available" &&
                playback.currentTimeMs >= moment.startMs && playback.currentTimeMs < moment.endMs;
              const selectedLineId = pinned?.state === "prepared"
                ? pinned.selection.lineId
                : pinned?.state === "production"
                  ? pinned.request.lineId
                  : pinned?.moment.lineId;
              return (
                <article
                  key={moment.lineId}
                  className={`cue${active ? " is-active" : ""}${selectedLineId === moment.lineId ? " is-pinned" : ""}`}
                  data-learning-line-id={moment.lineId}
                  data-production-results-line-id={presentation.mode === "production" ? moment.lineId : undefined}
                  data-learning-pinned={selectedLineId === moment.lineId ? "true" : undefined}
                  data-withheld={moment.target.state === "withheld" ? "true" : undefined}
                  data-silence={moment.source.reasonCode === "recorded_silence" ? "true" : undefined}
                >
                  {playback.state === "available" ? (
                    <button
                      type="button"
                      className="cue-t cue-seek"
                      aria-label={`Seek to ${momentClock(moment.startMs)}`}
                      onClick={() => playback.onSeek(moment.startMs)}
                    >
                      {momentClock(moment.startMs)}
                    </button>
                  ) : <span className="cue-t">{momentClock(moment.startMs)}</span>}
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
                          onPointerUp={prototype || productionReady
                            ? (event) => selectCaptionRange(moment, momentSelections, event.currentTarget, "source")
                            : undefined}
                          onTouchEnd={prototype || productionReady
                            ? (event) => selectCaptionRange(moment, momentSelections, event.currentTarget, "source")
                            : undefined}
                        >
                          {sourceText(moment, momentSelections, (selection, trigger) => {
                            openPinned({ state: "prepared", selection, span: selection.span }, trigger);
                          })}
                        </span>
                        {moment.target.state === "available" ? (
                          <span
                            className="cue-tgt"
                            lang={moment.targetLanguage}
                            tabIndex={productionReady ? -1 : undefined}
                            onPointerUp={productionReady
                              ? (event) => selectCaptionRange(moment, momentSelections, event.currentTarget, "target")
                              : undefined}
                            onTouchEnd={productionReady
                              ? (event) => selectCaptionRange(moment, momentSelections, event.currentTarget, "target")
                              : undefined}
                          >
                            {moment.target.text}
                          </span>
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
                        {(fullPrepared || productionReady) && (
                          <button
                            type="button"
                            className="learning-sentence-action"
                            aria-label={`${presentation.mode === "prototype" ? "Explain Korean sentence" : "Explain source sentence"} at ${momentClock(moment.startMs)}`}
                            onClick={(event) => selectSentence(moment, event.currentTarget)}
                          >
                            Explain sentence
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

      {presentation.mode === "prototype" && savedOpen && (
        <SavedDrawer
          id={savedId}
          saved={saved}
          onRemove={(id) => setSaved((current) => current.filter((item) => item.id !== id))}
          onClose={() => setSavedOpen(false)}
        />
      )}
    </section>
  );
}

function selectedCodePointSpan(
  sourceElement: HTMLElement,
  sourceText: string,
  side: "source" | "target",
): SelectedLanguageSpan | null {
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
    return { side, unit: "unicode_code_point", start, end, text };
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
  productionExplanation,
  onProductionRetry,
}: {
  pinned: PinnedSelection;
  kept: boolean;
  onKeep: (selection: PreparedLearningSelection) => void;
  onClose: () => void;
  productionExplanation: LearningExplanationState | null;
  onProductionRetry: (request: LearningSelectionRequest) => void;
}) {
  const matchingProductionState = pinned.state === "production" && productionExplanation &&
    sameLearningRequest(
      pinned.request,
      "request" in productionExplanation ? productionExplanation.request : productionExplanation.selection,
    )
    ? productionExplanation
    : null;
  const productionSelection = matchingProductionState && "selection" in matchingProductionState
    ? matchingProductionState.selection
    : null;
  const preparedSelection = pinned.state === "prepared" ? pinned.selection : productionSelection;
  const moment = preparedSelection ?? (pinned.state === "production"
    ? pinned.request
    : pinned.state === "prepared"
      ? pinned.selection
      : pinned.moment);
  const span = preparedSelection?.span ?? (pinned.state === "production" ? pinned.request.span : pinned.span);
  const selectedText = span.text;
  const panelRef = useRef<HTMLElement>(null);
  const presentedInsights = preparedSelection
    ? orderedPresentedInsights(preparedSelection.facets)
    : [];
  const unavailableInsights = preparedSelection
    ? preparedSelection.facets.filter((facet) => facet.availability !== "available")
    : [];
  const isPrototype = preparedSelection?.authority.dataClass === "design_fixture";
  const panelState = pinned.state === "production"
    ? `production-${matchingProductionState?.state ?? "loading"}`
    : preparedSelection
      ? isPrototype ? "prototype" : "production"
      : pinned.state;

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
      data-learning-state={panelState}
      data-selected-side={span.side}
      data-selected-start={span.start}
      data-selected-end={span.end}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          onClose();
        }
      }}
    >
      <header className="learning-panel-head">
        <div>
          <span>{preparedSelection
            ? isPrototype ? "Prepared prototype" : "Verified production explanation"
            : pinned.state === "production"
              ? productionStateLabel(matchingProductionState)
              : pinned.state === "unavailable" || pinned.state === "failed"
                ? stateLabel(pinned.state)
                : "Verified production explanation"}</span>
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

      {preparedSelection ? (
        <>
          {pinned.state === "production" && matchingProductionState && "selection" in matchingProductionState ? (
            <p
              className="learning-panel-translation"
              role="status"
              data-production-explanation-result-state={matchingProductionState.state}
            >
              {productionResultStateCopy(matchingProductionState.state)}
            </p>
          ) : null}
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
          {isPrototype && <div className="learning-panel-actions">
            <button
              type="button"
              className="learning-keep"
              disabled={kept}
              onClick={() => onKeep(preparedSelection)}
            >
              {kept ? "Saved" : "Save"}
            </button>
          </div>}
          <details className="learning-prototype-boundary">
            <summary>About this explanation</summary>
            {isPrototype ? <p>
                This is prepared design-fixture content bound to the exact recorded cue and selected code-point span.
                It was not generated by the runtime and has no semantic-review receipt or evidence citations.
              </p> : <p>
                This private explanation is projected from a host-receipted runtime artifact bound to the exact
                verified production-caption span. Its semantic correctness has not been reviewed.
              </p>}
            <p>Only meaning, word or phrase, sentence structure, and translation rationale are shown.</p>
          </details>
        </>
      ) : pinned.state === "production" ? (
        <ProductionExplanationRequestState
          state={matchingProductionState}
          request={pinned.request}
          onRetry={onProductionRetry}
        />
      ) : pinned.state === "unavailable" || pinned.state === "failed" ? (
        <UnavailableState
          label={pinned.state === "failed" ? "Explanation failed closed" : "Explanation unavailable"}
          reasonCode={pinned.reasonCode}
        />
      ) : null}
    </aside>
  );
}

function ProductionExplanationRequestState({
  state,
  request,
  onRetry,
}: {
  state: LearningExplanationState | null;
  request: LearningSelectionRequest;
  onRetry: (request: LearningSelectionRequest) => void;
}) {
  if (!state || state.state === "loading") {
    return (
      <div className="learning-unavailable" role="status" data-explanation-request-state="loading">
        <b>Requesting production explanation</b>
        <p>The runtime host is reopening the exact caption and Unicode code-point span.</p>
      </div>
    );
  }
  if ("selection" in state) return null;
  return (
    <>
      <UnavailableState
        label={state.state === "failed" ? "Explanation failed closed" : "Explanation unavailable"}
        reasonCode={state.reasonCode}
        detail={state.detail}
      />
      {state.state === "failed" && state.retry === "available" ? (
        <div className="learning-panel-actions">
          <button type="button" onClick={() => onRetry(request)}>Retry explanation</button>
        </div>
      ) : null}
    </>
  );
}

function productionStateLabel(state: LearningExplanationState | null): string {
  if (!state || state.state === "loading") return "Requesting production explanation";
  if ("selection" in state) return "Verified production explanation";
  return state.state === "failed" ? "Production explanation failed closed" : "Production explanation unavailable";
}

function productionResultStateCopy(state: "available" | "partial" | "withheld" | "unavailable"): string {
  switch (state) {
    case "available": return "Production explanation available. All returned facets are shown below.";
    case "partial": return "Production explanation partial. Only available facets are shown as content.";
    case "withheld": return "Production explanation withheld. No withheld facet is presented as available content.";
    case "unavailable": return "Production explanation unavailable. No unavailable facet is presented as content.";
  }
}

function sameLearningRequest(left: LearningSelectionRequest, right: LearningSelectionRequest): boolean {
  return left.lineId === right.lineId && left.startMs === right.startMs && left.endMs === right.endMs &&
    left.sourceLanguage === right.sourceLanguage && left.targetLanguage === right.targetLanguage &&
    JSON.stringify(left.source) === JSON.stringify(right.source) &&
    JSON.stringify(left.target) === JSON.stringify(right.target) &&
    JSON.stringify(left.span) === JSON.stringify(right.span);
}

function pinnedLineId(pinned: PinnedSelection): string {
  if (pinned.state === "prepared") return pinned.selection.lineId;
  if (pinned.state === "production") return pinned.request.lineId;
  return pinned.moment.lineId;
}

function pinnedSpan(pinned: PinnedSelection): SelectedLanguageSpan {
  return pinned.state === "production" ? pinned.request.span : pinned.span;
}

function orderedPresentedInsights(facets: LearningFacet[]): AvailableLearningFacet[] {
  return PRESENTED_INSIGHT_ORDER.flatMap((kind) => {
    const facet = facets.find((candidate) => candidate.kind === kind && candidate.availability === "available");
    return facet ? [facet as AvailableLearningFacet] : [];
  });
}

function InsightBody({ insight }: { insight: AvailableLearningFacet }) {
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
    case "translation_choice":
      return (
        <dl>
          <div><dt>Source choice</dt><dd>{insight.content.sourceChoice}</dd></div>
          <div><dt>English choice</dt><dd>{insight.content.targetChoice}</dd></div>
          <div><dt>Rationale</dt><dd>{insight.content.rationale}</dd></div>
        </dl>
      );
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

function SavedDrawer({
  id,
  saved,
  onRemove,
  onClose,
}: {
  id: string;
  saved: SessionSavedSelection[];
  onRemove: (itemId: string) => void;
  onClose: () => void;
}) {
  const drawerRef = useRef<HTMLElement>(null);

  useEffect(() => {
    drawerRef.current?.focus();
  }, []);

  // Saved language slides over the transcript instead of replacing it, so the reading position is
  // never lost. It is a session-only collection, not a co-equal view, so it stays behind one chip.
  return (
    <section
      id={id}
      className="learning-saved"
      ref={drawerRef}
      tabIndex={-1}
      aria-labelledby="learning-saved-title"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          onClose();
        }
      }}
    >
      <header className="learning-saved-head">
        <div>
          <span>This session only</span>
          <h3 id="learning-saved-title">Saved</h3>
        </div>
        <button type="button" className="learning-saved-close" aria-label="Close saved" onClick={onClose}>
          Close
        </button>
      </header>
      <p className="learning-saved-note">Only language you explicitly keep appears here. Nothing is saved after this result session ends.</p>
      {saved.length === 0 ? (
        <p className="learning-saved-empty">Select a prepared word or sentence, then choose Save.</p>
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

function sessionItem(
  source: Extract<LearningPresentation, { mode: "prototype" }>["source"],
  selection: PreparedLearningSelection,
): SessionSavedSelection {
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
    facetKinds: selection.facets.map((facet) => facet.kind),
  };
}

function productionPlaybackMatches(
  presentation: Extract<LearningPresentation, { mode: "production" }>,
  playback: LearningPlayback,
): boolean {
  if (playback.state !== "available" || playback.authority !== "verified_production_caption") return false;
  const identity = presentation.source.context.identities;
  return playback.binding.runtimeId === identity.runId &&
    playback.binding.sourceArtifactId === identity.sourceArtifactId &&
    playback.binding.sourceContentId === identity.sourceContentId &&
    playback.binding.captionJobId === identity.captionJobId &&
    playback.binding.captionArtifactId === identity.captionArtifactId &&
    playback.binding.captionContentId === identity.captionContentId &&
    playback.binding.timestampOrigin.kind === "source_media_zero" &&
    playback.binding.timestampOrigin.offsetMs === 0;
}

function stateLabel(state: Exclude<PinnedSelection["state"], "prepared" | "production">): string {
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
