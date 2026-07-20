import { useEffect, useId, useState } from "react";

import type { PresentedMoment, SelectedLanguageSpan } from "./model";
import type {
  LearningPresentation,
  PreparedLearningSelection,
  SessionSavedSelection,
} from "./presentation.ts";

/** The session-saved id for a raw selected span, stable per line and code-point range. */
export function savedSpanId(moment: PresentedMoment, span: SelectedLanguageSpan): string {
  return `${moment.lineId}:${span.side}:${span.start}:${span.end}`;
}

/**
 * Which source a learning session belongs to. Every piece of session-owned state resets when this
 * changes, so nothing a learner kept against one caption artifact can survive onto another.
 */
export function learningSourceKey(presentation: LearningPresentation): string {
  const { identities } = presentation.source.context;
  return `${identities.runId}:${identities.captionContentId ?? "none"}`;
}

/**
 * The learner's study tools for one result session: what they explicitly kept, and which of the
 * two tool disclosures is open. This is session state of the whole result experience, not of the
 * transcript that happens to sit beside it, so it is owned above both and handed to whichever
 * surface places the controls. The watch room puts them under the video; a standard viewer leaves
 * them in the transcript's own bar. Neither placement may keep a second copy of the truth.
 *
 * Nothing here outlives the session. Saved items are learner-owned session state with no store,
 * no network, and no persistence, which is what the "Session only" note on the rail states.
 */
export interface LearningTools {
  saved: SessionSavedSelection[];
  savedIds: ReadonlySet<string>;
  savedOpen: boolean;
  tuneOpen: boolean;
  savedId: string;
  tuneId: string;
  toggleSaved: () => void;
  toggleTune: () => void;
  closeSaved: () => void;
  closeTune: () => void;
  keep: (selection: PreparedLearningSelection) => void;
  /** Keep any selected span, prepared or not — the natural "add this to my study list" gesture. */
  keepSpan: (moment: PresentedMoment, span: SelectedLanguageSpan) => void;
  remove: (itemId: string) => void;
}

export function useLearningTools(presentation: LearningPresentation): LearningTools {
  const [saved, setSaved] = useState<SessionSavedSelection[]>([]);
  const [savedOpen, setSavedOpen] = useState(false);
  const [tuneOpen, setTuneOpen] = useState(false);
  const savedId = useId();
  const tuneId = useId();
  const sourceKey = learningSourceKey(presentation);

  useEffect(() => {
    setSaved([]);
    setSavedOpen(false);
    setTuneOpen(false);
  }, [sourceKey]);

  return {
    saved,
    savedIds: new Set(saved.map((item) => item.id)),
    savedOpen,
    tuneOpen,
    savedId,
    tuneId,
    // The two disclosures are mutually exclusive: one study tool is open at a time, so the shelf
    // beneath them never has to reflow around two stacked panels.
    toggleSaved: () => {
      setSavedOpen((open) => !open);
      setTuneOpen(false);
    },
    toggleTune: () => {
      setTuneOpen((open) => !open);
      setSavedOpen(false);
    },
    closeSaved: () => setSavedOpen(false),
    closeTune: () => setTuneOpen(false),
    // Only prepared fixture language can be kept, and only once. Production selections carry no
    // canonical saved-item shape yet, so they fail closed rather than landing in a session list.
    keep: (selection: PreparedLearningSelection) => {
      if (presentation.mode !== "prototype" || selection.authority.dataClass !== "design_fixture") return;
      setSaved((current) => {
        if (current.some((item) => item.id === selection.selectionId)) return current;
        return [...current, sessionItem(presentation.source, selection)];
      });
    },
    // Any selected span can be kept as a session vocabulary item — the word or phrase and the line's
    // translation — whether or not a prepared explanation exists for it. Prototype session only.
    keepSpan: (moment: PresentedMoment, span: SelectedLanguageSpan) => {
      if (presentation.mode !== "prototype") return;
      const id = savedSpanId(moment, span);
      setSaved((current) => {
        if (current.some((item) => item.id === id)) return current;
        return [...current, spanSessionItem(presentation.source, moment, span, id)];
      });
    },
    remove: (itemId: string) => setSaved((current) => current.filter((item) => item.id !== itemId)),
  };
}

function spanSessionItem(
  source: Extract<LearningPresentation, { mode: "prototype" }>["source"],
  moment: PresentedMoment,
  span: SelectedLanguageSpan,
  id: string,
): SessionSavedSelection {
  return {
    dataClass: "learner_owned_session_state",
    id,
    sourceOrigin: source.context.origin,
    lineId: moment.lineId,
    startMs: moment.startMs,
    endMs: moment.endMs,
    sourceLanguage: moment.sourceLanguage,
    targetLanguage: moment.targetLanguage,
    sourceText: span.text,
    target: moment.target,
    selection: span,
    facetKinds: [],
  };
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
