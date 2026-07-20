import type { ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { languageName } from "../preflight/preparationKit";
import type { SpeakerRef } from "../types";
import { ClozeText } from "./cloze";
import { LearningToolDrawers, LearningToolToggles } from "./LearningToolControls";
import SelectionBar, { type SelectionAnchor } from "./SelectionBar";
import {
  codePointSlice,
  fullCodePointSpan,
  type LearningReasonCode,
  type PresentedMoment,
  type SelectedLanguageSpan,
} from "./model";
import {
  availableMoments,
  LEARNING_LENS_LABELS,
  MomentBody,
  momentClock,
} from "./momentContent";
import { speakerDisplays } from "./speakers";
import type {
  AvailableLearningFacet,
  LearningExplanationState,
  LearningFacet,
  LearningFacetKind,
  LearningPlayback,
  LearningPresentation,
  LearningPrepInteraction,
  LearningPrototypeProjection,
  LearningSelectionRequest,
  PreparedLearningSelection,
  ProductionLearningInteraction,
  SpanTranslationState,
} from "./presentation.ts";
import { learningRequestKey } from "./presentation.ts";
import { savedSpanId, type LearningTools } from "./useLearningTools";
import { useViewerSession, type CaptionMode, type ClozeAmount } from "./viewerSession";

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

/**
 * A live text selection the learner raised the floating action bar on. It carries the span, the
 * matching prepared explanation if one exists, and the anchor rectangle the bar floats against.
 */
type FloatingSelection = {
  moment: PresentedMoment;
  span: SelectedLanguageSpan;
  side: "source" | "target";
  anchor: SelectionAnchor;
  trigger: HTMLElement;
  prepared: PreparedLearningSelection | null;
  canExplain: boolean;
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
  prepInteraction,
  tools,
  showBar,
  speakers,
  onExplainRequested,
}: {
  presentation: LearningPresentation;
  playback: LearningPlayback;
  productionInteraction?: ProductionLearningInteraction;
  prepInteraction: LearningPrepInteraction;
  /** The result session's study tools (Saved / Notes), owned above the transcript and shared with
   *  whichever surface places their controls. */
  tools: LearningTools;
  /** Standard viewers carry the study controls in the transcript's own bar. The watch room sets
   *  this false and places them on the video and the command bar instead. */
  showBar: boolean;
  /** The clip's recorded speaker legend, when the source carries one. Display only, never invented. */
  speakers?: readonly SpeakerRef[];
  /** The watch room reveals the reading panel before a pinned explanation opens, since the
   *  explanation lives in the transcript surface and that panel may be closed. */
  onExplainRequested?: () => void;
}) {
  const { source } = presentation;
  const [pinned, setPinned] = useState<PinnedSelection | null>(null);
  const [floating, setFloating] = useState<FloatingSelection | null>(null);
  /** Which prepared note is open inline in the transcript, as `lineId:index`. */
  const [openNote, setOpenNote] = useState<string | null>(null);
  const captionMode = useViewerSession((state) => state.captionMode);
  const setCaptionMode = useViewerSession((state) => state.setCaptionMode);
  const clozeAmount = useViewerSession((state) => state.clozeAmount);
  const setClozeAmount = useViewerSession((state) => state.setClozeAmount);
  const [returnFocus, setReturnFocus] = useState<HTMLElement | null>(null);
  const cuesRef = useRef<HTMLDivElement | null>(null);
  const lastActiveLineId = useRef<string | null>(null);
  const prototype = presentation.mode === "prototype" ? presentation.explanations : null;
  const productionReady = presentation.mode === "production" &&
    presentation.explanations.state === "ready" &&
    productionInteraction !== undefined &&
    productionPlaybackMatches(presentation, playback);
  const sourceKey = presentation.mode === "prototype"
    ? `${source.context.identities.runId}:${source.context.identities.captionContentId ?? "none"}`
    : `${source.context.identities.runId}:${source.context.identities.captionContentId}`;

  const selections = prototype?.state === "ready" ? prototype.selections : [];

  useEffect(() => {
    setPinned(null);
    setFloating(null);
    setReturnFocus(null);
    setOpenNote(null);
  }, [sourceKey]);

  useEffect(() => {
    if (presentation.mode === "production" && !productionReady) {
      setPinned(null);
      setFloating(null);
      setReturnFocus(null);
    }
  }, [presentation.mode, productionReady]);

  // The floating bar dismisses on any pointer that starts elsewhere (the bar stops its own pointer
  // events) and on Escape, so it never lingers over a stale highlight.
  const dismissFloating = useCallback(() => setFloating(null), []);
  useEffect(() => {
    if (!floating) return undefined;
    const onPointerDown = () => setFloating(null);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        // Consume the Escape so it dismisses only the bar, one layer at a time, and never also
        // steps the watch face back to the report.
        event.preventDefault();
        setFloating(null);
        window.getSelection()?.removeAllRanges();
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [floating]);

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

  // Selecting caption text raises the floating action bar over the highlight rather than jumping
  // straight to a side panel: the learner chooses Translate, Explain, or Save from where their eye
  // already is. The listener is document-level and reads the selection itself, so it works however
  // the selection was made (drag that releases anywhere, double-click, touch handles, keyboard) and
  // wherever the caption text lives: the transcript cues and the on-video caption both mark their
  // text with [data-caption-side] and [data-caption-line-id].
  const raiseFromSelection = useCallback(() => {
    if (!prototype && !productionReady) return;
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) return;
    const range = selection.getRangeAt(0);
    const anchorNode = range.commonAncestorContainer;
    const anchorElement = anchorNode instanceof Element ? anchorNode : anchorNode.parentElement;
    const container = anchorElement?.closest<HTMLElement>("[data-caption-side]") ??
      // A drag can overshoot the caption span; fall back to the element the selection started in.
      (range.startContainer.parentElement?.closest<HTMLElement>("[data-caption-side]") ?? null);
    if (!container) return;
    const side = container.dataset.captionSide === "target" ? "target" as const : "source" as const;
    const lineId = container.dataset.captionLineId;
    const moment = source.moments.find((candidate) => candidate.lineId === lineId);
    if (!moment) return;
    const selectedText = side === "source" ? moment.source : moment.target;
    if (selectedText.state !== "available") return;
    const span = selectedCodePointSpan(container, selectedText.text, side, range);
    if (!span) return;
    const rect = range.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return;
    const momentSelections = selections.filter((candidate) => candidate.lineId === moment.lineId);
    const prepared = side === "source" && prototype && prototype.state !== "failed"
      ? momentSelections.find((candidate) =>
          candidate.span.start === span.start &&
          candidate.span.end === span.end &&
          candidate.span.text === span.text) ?? null
      : null;
    setFloating({
      moment,
      span,
      side,
      anchor: { left: rect.left, top: rect.top, bottom: rect.bottom, width: rect.width },
      trigger: container,
      prepared,
      // Explain is offered for any source selection (the panel states honestly when nothing is
      // prepared) and for a live production run; the target side has no explanation path in the demo.
      canExplain: (Boolean(prototype) && side === "source") || productionReady,
    });
  }, [prototype, productionReady, source.moments, selections]);

  useEffect(() => {
    if (!prototype && !productionReady) return undefined;
    let settle: ReturnType<typeof setTimeout> | undefined;
    // pointerup catches mouse and pen; touch selection moves through handle drags that end without
    // a pointerup on the text, so a settled selectionchange raises the bar there too.
    const raiseSoon = (delay: number) => {
      clearTimeout(settle);
      settle = setTimeout(raiseFromSelection, delay);
    };
    const onPointerUp = () => raiseSoon(0);
    const onSelectionChange = () => raiseSoon(280);
    document.addEventListener("pointerup", onPointerUp);
    document.addEventListener("selectionchange", onSelectionChange);
    return () => {
      clearTimeout(settle);
      document.removeEventListener("pointerup", onPointerUp);
      document.removeEventListener("selectionchange", onSelectionChange);
    };
  }, [prototype, productionReady, raiseFromSelection]);

  // Explain opens the full facet explanation for the selection the bar sits on: the prepared
  // fixture explanation, the honest "not prepared" state, or a live production request. The
  // explanation lives in the reading surface, so a selection made on the video first asks the
  // composing room to reveal that panel.
  const explainFloating = () => {
    if (!floating) return;
    onExplainRequested?.();
    const { moment, span, side, prepared, trigger } = floating;
    if (prototype && side === "source") {
      if (prototype.state === "failed") {
        openPinned({ state: "failed", moment, span, reasonCode: prototype.reasonCode }, trigger);
      } else {
        openPinned(prepared
          ? { state: "prepared", selection: prepared, span: prepared.span }
          : { state: "unavailable", moment, span, reasonCode: "explanation_not_prepared" }, trigger);
      }
    } else if (productionReady) {
      requestProductionSelection(moment, span, trigger);
    }
    window.getSelection()?.removeAllRanges();
    setFloating(null);
  };

  const saveFloating = () => {
    if (floating) tools.keepSpan(floating.moment, floating.span);
  };

  const selectionRequestFor = (
    moment: PresentedMoment,
    span: SelectedLanguageSpan,
  ): LearningSelectionRequest => ({
    lineId: moment.lineId,
    startMs: moment.startMs,
    endMs: moment.endMs,
    sourceLanguage: moment.sourceLanguage,
    targetLanguage: moment.targetLanguage,
    source: moment.source,
    target: moment.target,
    span: { ...span },
  });

  const requestProductionSelection = (
    moment: PresentedMoment,
    span: SelectedLanguageSpan,
    trigger: HTMLElement,
  ) => {
    if (!productionReady || !productionInteraction) return;
    const request = selectionRequestFor(moment, span);
    productionInteraction.onRequest(request);
    openPinned({ state: "production", request }, trigger);
  };

  // The span translation for the bar's current selection: only the state whose request key matches
  // the exact floating span is shown, so a stale response never rides a new highlight.
  const floatingTranslation: SpanTranslationState | null = floating &&
      presentation.mode === "production" && productionReady && productionInteraction?.spanTranslation &&
      productionInteraction.spanTranslation.requestKey ===
        learningRequestKey(presentation.source, selectionRequestFor(floating.moment, floating.span))
    ? productionInteraction.spanTranslation
    : null;

  const translateFloating = (retry: boolean) => {
    if (!floating || !productionReady || !productionInteraction) return;
    const request = selectionRequestFor(floating.moment, floating.span);
    if (retry) productionInteraction.onTranslateRetry(request);
    else productionInteraction.onTranslate(request);
  };

  const closePinned = () => {
    const trigger = returnFocus;
    setPinned(null);
    setReturnFocus(null);
    requestAnimationFrame(() => trigger?.focus());
  };

  const showSaved = presentation.mode === "prototype";

  // The playhead line, for the karaoke-style highlight and the follow scroll. Line-level is what the
  // recorded timing supports: cues carry start and end, never per-word times, so no word is ever
  // claimed as "now" beyond what was measured.
  const activeLineId = playback.state === "available"
    ? source.moments.find((moment) =>
        playback.currentTimeMs >= moment.startMs && playback.currentTimeMs < moment.endMs)?.lineId ?? null
    : null;

  // Follow playback only while the reader is at the playhead: if the previous active line is still
  // on screen, bring the next one into view; if the reader scrolled away, never yank them back.
  useEffect(() => {
    const feed = cuesRef.current;
    if (!activeLineId || !feed) return;
    const previous = lastActiveLineId.current;
    lastActiveLineId.current = activeLineId;
    const next = feed.querySelector(`[data-learning-line-id="${CSS.escape(activeLineId)}"]`);
    if (!next) return;
    if (previous && previous !== activeLineId) {
      const previousElement = feed.querySelector(`[data-learning-line-id="${CSS.escape(previous)}"]`);
      if (previousElement) {
        const feedRect = feed.getBoundingClientRect();
        const previousRect = previousElement.getBoundingClientRect();
        const visible = previousRect.bottom > feedRect.top && previousRect.top < feedRect.bottom;
        if (!visible) return;
      }
    }
    next.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [activeLineId]);

  // Prepared notes, keyed by line: the visible result of the Notes depth wheel. Only available
  // notes appear; withheld and abstained help stays silent here exactly as everywhere else.
  const prep = prepInteraction.prep;
  const notesByLine = new Map<string, ReturnType<typeof availableMoments>>();
  for (const note of availableMoments(prep)) {
    const list = notesByLine.get(note.lineId);
    if (list) list.push(note);
    else notesByLine.set(note.lineId, [note]);
  }

  return (
    <section
      className="learning-workspace"
      aria-label="Language learning workspace"
      data-learning-mode={presentation.mode}
      data-caption-mode={captionMode}
    >
      {/* Standard viewers carry the study controls in the transcript's own bar. The watch room
          hands them to the dossier under the video, so here the transcript is a bare reading feed. */}
      {showBar && (
        <div className="learning-bar">
          <LearningToolToggles
            tools={tools}
            prepState={prepInteraction.prep.state}
            showSaved={showSaved}
          />
          {/* A one-line affordance cue, not an instruction paragraph: it names both gestures the
              transcript answers to. */}
          {presentation.mode === "prototype" && (
            <>
              <span className="learning-bar-hint" aria-hidden="true">
                Tap a highlighted word, or select any text, to translate, explain, or save it
              </span>
              <span className="learning-session-note">Session only</span>
            </>
          )}
        </div>
      )}

      {/* The standard viewer carries the caption control in the transcript; the watch room places it
          on the video (LearningResultExperience), where the captions now read. */}
      {showBar && source.moments.length > 0 && (
        <CaptionModeControl
          mode={captionMode}
          onMode={setCaptionMode}
          cloze={clozeAmount}
          onCloze={setClozeAmount}
          sourceLanguage={source.moments[0]?.sourceLanguage}
          targetLanguage={source.moments[0]?.targetLanguage}
        />
      )}

      <>
          {pinned && (
            <ExplanationPanel
              key={`${pinned.state}:${pinnedLineId(pinned)}:${pinnedSpan(pinned).start}:${pinnedSpan(pinned).end}`}
              pinned={pinned}
              kept={pinned.state === "prepared" && tools.savedIds.has(pinned.selection.selectionId)}
              onKeep={tools.keep}
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
            ref={cuesRef}
            aria-label={`${source.moments[0]?.sourceLanguage ?? "Source"} to ${source.moments[0]?.targetLanguage ?? "target"} transcript`}
          >
            {source.moments.length === 0 ? (
              <p className="cues-empty">No caption cues were recorded. No transcript or result is implied.</p>
            ) : source.moments.map((moment, index) => {
              const momentSelections = selections.filter((candidate) => candidate.lineId === moment.lineId);
              const fullPrepared = preparedSentence(moment, momentSelections);
              const active = moment.lineId === activeLineId;
              const selectedLineId = pinned?.state === "prepared"
                ? pinned.selection.lineId
                : pinned?.state === "production"
                  ? pinned.request.lineId
                  : pinned?.moment.lineId;
              // Speaker attribution, shown where the recorded speaker set changes: a turn chip in
              // the speaker's color, so a two-voice clip reads like the conversation it is.
              const momentSpeakers = speakerDisplays(speakers, moment.speakers);
              const previousSpeakers = index > 0 ? source.moments[index - 1].speakers ?? [] : [];
              const turnChange = momentSpeakers.length > 0 &&
                (moment.speakers ?? []).join(",") !== previousSpeakers.join(",");
              const lineNotes = notesByLine.get(moment.lineId) ?? [];
              return (
                <article
                  key={moment.lineId}
                  className={`cue${active ? " is-active" : ""}${selectedLineId === moment.lineId ? " is-pinned" : ""}`}
                  data-learning-line-id={moment.lineId}
                  data-production-results-line-id={presentation.mode === "production" ? moment.lineId : undefined}
                  data-learning-pinned={selectedLineId === moment.lineId ? "true" : undefined}
                  data-withheld={moment.target.state === "withheld" ? "true" : undefined}
                  data-silence={moment.source.reasonCode === "recorded_silence" ? "true" : undefined}
                  data-speakers={moment.speakers && moment.speakers.length > 0 ? moment.speakers.join(",") : undefined}
                  data-speaker-primary={momentSpeakers[0]?.colorIndex}
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
                    {turnChange && (
                      <span className="cue-speakers">
                        {momentSpeakers.map((speaker) => (
                          <span
                            key={speaker.id}
                            className="cue-speaker"
                            data-speaker-index={speaker.colorIndex}
                            title={speaker.label}
                          >
                            {speaker.shortLabel}
                          </span>
                        ))}
                      </span>
                    )}
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
                        {captionMode === "listen" ? (
                          // Practice: the source line renders with words blanked; the same
                          // deterministic blanking the on-video caption shows. The blanks preserve
                          // the full recorded text, so selection still works; only the
                          // prepared-word buttons stand down while the line is an exercise.
                          <span
                            className="cue-src"
                            lang={moment.sourceLanguage}
                            tabIndex={-1}
                            data-caption-side="source"
                            data-caption-line-id={moment.lineId}
                          >
                            <ClozeText
                              text={moment.source.text}
                              seed={`${moment.lineId}:source`}
                              amount={clozeAmount}
                              lang={moment.sourceLanguage}
                            />
                          </span>
                        ) : (
                          <span
                            className="cue-src"
                            lang={moment.sourceLanguage}
                            tabIndex={-1}
                            data-caption-side="source"
                            data-caption-line-id={moment.lineId}
                          >
                            {sourceText(moment, momentSelections, (selection, trigger) => {
                              openPinned({ state: "prepared", selection, span: selection.span }, trigger);
                            })}
                          </span>
                        )}
                        {moment.target.state === "available" ? (
                          <span
                            className="cue-tgt"
                            lang={moment.targetLanguage}
                            tabIndex={prototype || productionReady ? -1 : undefined}
                            data-caption-side="target"
                            data-caption-line-id={moment.lineId}
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
                        {lineNotes.length > 0 && (
                          // The prepared notes the depth wheel produced, marked on the line they
                          // belong to. Each mark names its kind and opens the note in place; nothing
                          // ever pops on its own.
                          <span className="cue-notes">
                            {lineNotes.map((note, noteIndex) => {
                              const noteKey = `${moment.lineId}:${noteIndex}`;
                              return (
                                <button
                                  key={noteKey}
                                  type="button"
                                  className="cue-note-mark"
                                  data-note-lens={note.lens}
                                  aria-expanded={openNote === noteKey}
                                  onClick={() => setOpenNote((current) => current === noteKey ? null : noteKey)}
                                >
                                  {LEARNING_LENS_LABELS[note.lens]}
                                </button>
                              );
                            })}
                          </span>
                        )}
                        {lineNotes.map((note, noteIndex) =>
                          openNote === `${moment.lineId}:${noteIndex}` ? (
                            <span
                              key={`open-${moment.lineId}:${noteIndex}`}
                              className="cue-note"
                              data-note-lens={note.lens}
                            >
                              <MomentBody moment={note} />
                            </span>
                          ) : null)}
                      </>
                    )}
                  </span>
                </article>
              );
            })}
          </div>
      </>

      {/* Portalled to the body: the bar answers selections made on the on-video captions too, and
          in the watch room this workspace subtree is display:none while the panel is closed, which
          would silently hide a fixed-position bar rendered in place. */}
      {floating && createPortal(
        <SelectionBar
          anchor={floating.anchor}
          canExplain={floating.canExplain}
          canSave={presentation.mode === "prototype"}
          translation={floating.moment.target}
          targetLanguage={floating.moment.targetLanguage}
          saved={tools.savedIds.has(savedSpanId(floating.moment, floating.span))}
          canTranslateSpan={presentation.mode === "production" && productionReady}
          spanTranslation={floatingTranslation}
          onTranslate={() => translateFloating(false)}
          onTranslateRetry={() => translateFloating(true)}
          onExplain={explainFloating}
          onSave={saveFloating}
          onDismiss={dismissFloating}
        />,
        document.body,
      )}

      {showBar && (
        <LearningToolDrawers tools={tools} prepInteraction={prepInteraction} showSaved={showSaved} />
      )}
    </section>
  );
}

/**
 * The caption display control: a compact segmented pill that says exactly what each choice does.
 * Both shows source and translation; each language name shows only that side; Practice is
 * fill-in-the-blank, hiding some of the words so the ear supplies them, with the amount as a
 * small dial. It reads as one instrument on the watch room's video and in the standard viewer
 * alike. (The mode key stays "listen" on the wire.)
 */
const CLOZE_LABELS: Record<ClozeAmount, string> = {
  1: "Blank a few words",
  2: "Blank about half the words",
  3: "Blank most words",
};

export function CaptionModeControl({
  mode,
  onMode,
  cloze,
  onCloze,
  sourceLanguage,
  targetLanguage,
}: {
  mode: CaptionMode;
  onMode: (mode: CaptionMode) => void;
  cloze: ClozeAmount;
  onCloze: (cloze: ClozeAmount) => void;
  sourceLanguage: string | undefined;
  targetLanguage: string | undefined;
}) {
  const options: Array<{ mode: CaptionMode; label: string; hint: string }> = [
    { mode: "both", label: "Both", hint: "Show both languages" },
    { mode: "source", label: sourceLanguage ? languageName(sourceLanguage) : "Source", hint: "Show the source only" },
    { mode: "target", label: targetLanguage ? languageName(targetLanguage) : "Target", hint: "Show the translation only" },
    { mode: "listen", label: "Practice", hint: "Fill in the blanks: some words are hidden so your ear supplies them. Tap a blank to reveal it" },
  ];
  const clozeLevels: ClozeAmount[] = [1, 2, 3];
  return (
    <div className="caption-mode" role="group" aria-label="Caption display">
      {options.map((option) => (
        <button
          key={option.mode}
          type="button"
          className="caption-mode-btn"
          data-caption-option={option.mode}
          aria-pressed={mode === option.mode}
          title={option.hint}
          onClick={() => onMode(option.mode)}
        >
          {option.label}
        </button>
      ))}
      {/* When Listen is on, how many words are blanked is a dial: more filled dots, more blanks.
          Every blank still reveals on tap or hover, so nothing is ever locked away. */}
      {mode === "listen" && (
        <span className="caption-cloze" role="group" aria-label="How many words to blank">
          {clozeLevels.map((level) => (
            <button
              key={level}
              type="button"
              className="caption-cloze-dot"
              data-cloze-level={level}
              data-active={cloze >= level ? "true" : undefined}
              aria-pressed={cloze === level}
              aria-label={CLOZE_LABELS[level]}
              title={CLOZE_LABELS[level]}
              onClick={() => onCloze(level)}
            />
          ))}
        </span>
      )}
    </div>
  );
}


/**
 * The selected code-point span within one caption element. Forgiving on purpose: a drag that starts
 * or ends outside the caption is clamped to the caption's own text instead of rejected, and edge
 * whitespace is trimmed, so the natural gesture of sweeping across a word or a sentence always
 * yields the span the learner meant. The returned text is always an exact slice of the recorded
 * caption; nothing outside it can enter the span.
 */
function selectedCodePointSpan(
  sourceElement: HTMLElement,
  sourceText: string,
  side: "source" | "target",
  range: Range,
): SelectedLanguageSpan | null {
  try {
    const bounds = document.createRange();
    bounds.selectNodeContents(sourceElement);
    const startPosition = bounds.comparePoint(range.startContainer, range.startOffset);
    const endPosition = bounds.comparePoint(range.endContainer, range.endOffset);
    // The selection must overlap the caption at all.
    if (startPosition === 1 || endPosition === -1) return null;

    const measure = (container: Node, offset: number): number => {
      const before = document.createRange();
      before.selectNodeContents(sourceElement);
      before.setEnd(container, offset);
      return Array.from(before.toString()).length;
    };
    const characters = Array.from(sourceText);
    let start = startPosition === -1 ? 0 : measure(range.startContainer, range.startOffset);
    let end = endPosition === 1 ? characters.length : measure(range.endContainer, range.endOffset);
    end = Math.min(end, characters.length);
    while (start < end && !/\S/u.test(characters[start])) start += 1;
    while (end > start && !/\S/u.test(characters[end - 1])) end -= 1;
    if (end <= start) return null;
    const text = codePointSlice(sourceText, start, end);
    if (!/\S/u.test(text)) return null;
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
