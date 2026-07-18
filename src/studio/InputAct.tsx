import { AnimatePresence, LayoutGroup, motion } from "motion/react";
import {
  lazy,
  Suspense,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";

import AgentMark from "./AgentMark";
import { ORCHESTRATOR_IDENTITY } from "./agentIdentity";
import { Play } from "./glyphs";
import LifecycleBottomBar from "./LifecycleBottomBar";
import {
  isProcessingMockScenario,
  type ProcessingMockScenario,
} from "./localRuntime/ProductionProcessingMock";
import Preflight from "./preflight/Preflight";
import {
  PREPARATION_STAGES,
  preparationStageIndex,
} from "./preflight/PreparationStages";
import SourceEntry from "./SourceEntry";
import { useBundle, useStudio } from "./store";

const ProductLocalRuntime = lazy(() => import("./localRuntime/ProductLocalRuntime"));

type SourceGuideState = "welcome" | "recorded" | "resolving" | "resolved" | "unavailable" | "cancelled";

const SOURCE_GUIDE_COPY: Record<SourceGuideState, string> = {
  welcome:
    "Welcome to Studio. Add a source when you’re ready. We’ll take it from there, so you can sit back and watch it come together.",
  recorded:
    "The recorded demo is ready. Review its receipted source and replay request in the guided setup.",
  resolving:
    "One moment—I’m asking YouTube for the title, creator, and duration. The media itself remains untouched.",
  resolved:
    "I found the source. Choose a section of up to two minutes, then tell me what you’d like prepared.",
  unavailable:
    "I couldn’t verify this source’s metadata, so I’ve kept its duration and preparation controls unavailable.",
  cancelled:
    "Nothing was started. You can edit the source below or close this check and begin again when you’re ready.",
};

const KOREAN_SAMPLES = [
  {
    label: "Korean sample 01",
    url: "https://www.youtube.com/watch?v=hWxESR68Olg&list=RDhWxESR68Olg&start_radio=1&pp=oAcB",
  },
  {
    label: "Korean sample 02",
    url: "https://www.youtube.com/watch?v=XauBqFepc-s",
  },
] as const;

interface StudioWelcomeProps {
  openOwnedMedia: () => void;
  selectSample: (url: string) => void;
}

/** The orchestrator's invitation, before any runtime or evidence state exists. */
function StudioWelcome({ openOwnedMedia, selectSample }: StudioWelcomeProps) {
  const preflight = useStudio((state) => state.preflight);
  const previewSession = useStudio((state) => state.previewSession);
  const sourceGuideState: SourceGuideState = !previewSession
    ? preflight.status !== "idle" && preflight.provenance.kind !== "client_validation"
      ? "recorded"
      : "welcome"
    : preflight.status === "cancelled"
      ? "cancelled"
      : previewSession.resolutionFailure
        ? "unavailable"
        : previewSession.resolution
          ? "resolved"
          : "resolving";
  const sourceGuideActive = sourceGuideState !== "welcome";
  const showPreparation = sourceGuideActive && sourceGuideState !== "resolving";
  const guideMessage = SOURCE_GUIDE_COPY[sourceGuideState];
  const labelId = sourceGuideState === "resolved" || (sourceGuideState === "recorded" && preflight.status === "ready")
    ? "preflight-stage-title"
    : showPreparation
      ? "preflight-title"
      : "studio-welcome-title";

  return (
    <section
      className="studio-welcome"
      data-source-guide={sourceGuideActive ? "true" : undefined}
      data-source-guide-state={sourceGuideState}
      aria-labelledby={labelId}
    >
      <LayoutGroup id="studio-source-guide">
        <motion.div className="welcome-lockup" layout>
          <motion.div className="welcome-guide" layout>
            <div className="welcome-orchestrator-anchor" aria-hidden="true">
              <motion.div
                className="welcome-orchestrator-core"
                initial={{ opacity: 0, scale: 0.72 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
              >
                <AgentMark
                  identity={ORCHESTRATOR_IDENTITY}
                  status={sourceGuideState === "resolving" ? "working" : "idle"}
                />
              </motion.div>
            </div>

            <AnimatePresence initial={false}>
              {sourceGuideActive && (
                <motion.div
                  className="welcome-guide-copy"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 4 }}
                  transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                >
                  <strong>Source guide</strong>
                  <span
                    className={sourceGuideState === "resolving" ? "text-shimmer" : undefined}
                    role="status"
                    aria-live="polite"
                  >
                    {sourceGuideState === "resolving"
                      ? "Resolving provider metadata…"
                      : sourceGuideState === "recorded"
                        ? "Recorded source ready"
                        : sourceGuideState === "resolved"
                          ? "Metadata resolved"
                          : sourceGuideState === "cancelled"
                            ? "Request closed"
                            : "Metadata unavailable"}
                  </span>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>

          <motion.div className="welcome-content" layout>
            <AnimatePresence mode="popLayout" initial={false}>
              {showPreparation ? (
                <motion.div
                  key="preparation"
                  className="welcome-preparation"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 6 }}
                  transition={{ duration: 0.34, ease: [0.22, 1, 0.36, 1] }}
                >
                  <Preflight />
                </motion.div>
              ) : (
                <motion.div
                  key="message"
                  className="welcome-panel"
                  layoutId="studio-source-guide-panel"
                  initial={{ opacity: 0, y: -6, scaleY: 0.42 }}
                  animate={{ opacity: 1, y: 0, scaleY: 1 }}
                  exit={{ opacity: 0, y: -4, scale: 0.98 }}
                  transition={{ duration: 0.38, ease: [0.22, 1, 0.36, 1] }}
                >
                  <motion.h1
                    key={sourceGuideState}
                    id="studio-welcome-title"
                    initial={{ opacity: 0.35, y: 3 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.2, ease: "easeOut" }}
                  >
                    {guideMessage}
                  </motion.h1>
                </motion.div>
              )}
            </AnimatePresence>

            <AnimatePresence initial={false}>
              {!sourceGuideActive && (
                <StudioSourceOptions
                  openOwnedMedia={openOwnedMedia}
                  selectSample={selectSample}
                />
              )}
            </AnimatePresence>
          </motion.div>
        </motion.div>
      </LayoutGroup>
    </section>
  );
}

interface StudioSourceDockProps {
  sourceEntryOpen: boolean;
  sourceUrl: string;
  sourceFocusRequest: number;
  setSourceEntryOpen: (open: boolean) => void;
  setSourceUrl: (url: string) => void;
}

function StudioSourceDock({
  sourceEntryOpen,
  sourceUrl,
  sourceFocusRequest,
  setSourceEntryOpen,
  setSourceUrl,
}: StudioSourceDockProps) {
  const preflight = useStudio((state) => state.preflight);
  const preparationStage = useStudio((state) => state.preparationStage);
  const initialization = useStudio((state) => state.initialization);
  const cancelInitialization = useStudio((state) => state.cancelInitialization);
  const dismissPreflight = useStudio((state) => state.dismissPreflight);
  const retrySubmittedSource = useStudio((state) => state.retrySubmittedSource);
  const previewSession = useStudio((state) => state.previewSession);
  const notice =
    preflight.status !== "idle" && preflight.provenance.kind === "client_validation"
      ? preflight.message
      : null;
  const tone = preflight.status === "invalid_source" ? "deny" : "neutral";
  const preparationIndex = preparationStageIndex(preparationStage);
  const preparationItem = PREPARATION_STAGES[preparationIndex];
  const sourceEntryMode =
    initialization === null &&
    (preflight.status === "idle" || preflight.provenance.kind === "client_validation");
  const resolving =
    initialization === null &&
    preflight.status === "loading_source" &&
    preflight.provenance.kind === "remote_resolution";
  const preparing = initialization === null && preflight.status === "ready";
  const failed =
    initialization === null &&
    preflight.status !== "ready" &&
    preflight.status !== "idle" &&
    preflight.status !== "loading_source" &&
    preflight.status !== "cancelled" &&
    preflight.provenance.kind !== "client_validation";

  function returnToSource(): void {
    dismissPreflight();
    setSourceEntryOpen(true);
  }

  return (
    <div className="studio-source-dock">
      <AnimatePresence mode="wait">
        {notice && (
          <motion.p
            key={notice}
            className="source-check-note"
            data-tone={tone}
            role="alert"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 3 }}
            transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
          >
            {notice}
          </motion.p>
        )}
      </AnimatePresence>

      <motion.div
        className="source-dock-actions"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.32, delay: 0.48, ease: [0.22, 1, 0.36, 1] }}
      >
        <AnimatePresence mode="wait" initial={false}>
          {sourceEntryMode ? (
            <SourceEntry
              key="source-entry"
              open={sourceEntryOpen}
              url={sourceUrl}
              focusRequest={sourceFocusRequest}
              setOpen={setSourceEntryOpen}
              setUrl={setSourceUrl}
            />
          ) : initialization ? (
            <LifecycleBottomBar
              key="initializing"
              mode="initializing"
              title={initialization === "submitted-preview"
                ? "Initializing recorded preview"
                : "Initializing recorded replay"}
              busy
              primaryAction={{
                label: "Cancel start",
                emphasis: "danger",
                onClick: cancelInitialization,
              }}
            />
          ) : resolving ? (
            <LifecycleBottomBar
              key="resolving"
              mode="resolving"
              title="Resolving metadata"
              busy
              primaryAction={{ label: "Cancel", emphasis: "danger", onClick: returnToSource }}
            />
          ) : preparing ? (
            <LifecycleBottomBar
              key="preparation"
              mode="preparation"
              title={preparationItem.label}
              stage={preparationStage}
              busy={previewSession?.preparation.status === "building"}
              primaryAction={{ label: "Exit setup", emphasis: "danger", onClick: returnToSource }}
            />
          ) : failed ? (
            <LifecycleBottomBar
              key="failed"
              mode="failed"
              title={preflight.title}
              primaryAction={previewSession?.resolutionFailure?.retryable
                ? { label: "Retry", onClick: retrySubmittedSource }
                : { label: "Edit source", onClick: returnToSource }}
            />
          ) : (
            <LifecycleBottomBar
              key="cancelled"
              mode="cancelled"
              title="Request closed"
              primaryAction={{ label: "Edit source", onClick: returnToSource }}
            />
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}

function StudioSourceOptions({ openOwnedMedia, selectSample }: StudioWelcomeProps) {
  const bundle = useBundle();
  const openRecordedPreflight = useStudio((state) => state.openRecordedPreflight);
  const [samplesOpen, setSamplesOpen] = useState(false);
  const sampleMenuId = useId();
  const root = useRef<HTMLDivElement>(null);
  const sampleTrigger = useRef<HTMLButtonElement>(null);
  const sampleItems = useRef<Array<HTMLButtonElement | null>>([]);
  const initialSampleFocus = useRef(0);

  useEffect(() => {
    if (!samplesOpen) return;

    const frame = window.requestAnimationFrame(() => {
      sampleItems.current[initialSampleFocus.current]?.focus();
    });
    const closeFromOutside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setSamplesOpen(false);
    };
    document.addEventListener("pointerdown", closeFromOutside, true);

    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("pointerdown", closeFromOutside, true);
    };
  }, [samplesOpen]);

  function openSamples(focusIndex = 0): void {
    initialSampleFocus.current = focusIndex;
    setSamplesOpen(true);
  }

  function closeSamples(restoreTrigger: boolean): void {
    setSamplesOpen(false);
    if (restoreTrigger) {
      window.requestAnimationFrame(() => sampleTrigger.current?.focus());
    }
  }

  function handleSampleKeys(event: ReactKeyboardEvent<HTMLDivElement>): void {
    const activeIndex = sampleItems.current.findIndex((item) => item === document.activeElement);
    let nextIndex: number | null = null;

    if (event.key === "ArrowDown") nextIndex = (activeIndex + 1) % KOREAN_SAMPLES.length;
    if (event.key === "ArrowUp") {
      nextIndex = (activeIndex - 1 + KOREAN_SAMPLES.length) % KOREAN_SAMPLES.length;
    }
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = KOREAN_SAMPLES.length - 1;

    if (nextIndex !== null) {
      event.preventDefault();
      sampleItems.current[nextIndex]?.focus();
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeSamples(true);
    } else if (event.key === "Tab") {
      closeSamples(false);
    }
  }

  return (
    <motion.div
      ref={root}
      className="studio-source-options"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 4 }}
      transition={{ duration: 0.32, delay: 0.34, ease: [0.22, 1, 0.36, 1] }}
      layout="position"
    >
      <div
        className="studio-source-option-track"
        role="group"
        aria-label="More source options"
      >
        <button
          type="button"
          className="studio-source-option"
          data-palette="peach"
          onClick={openRecordedPreflight}
          disabled={!bundle}
        >
          <span>Explore recorded demo</span>
          <Play />
        </button>

        <button
          type="button"
          className="studio-source-option"
          data-palette="blue"
          onClick={openOwnedMedia}
        >
          Add owned media
        </button>

        <button
          ref={sampleTrigger}
          type="button"
          className="studio-source-option"
          data-palette="coral"
          aria-haspopup="menu"
          aria-expanded={samplesOpen}
          aria-controls={samplesOpen ? sampleMenuId : undefined}
          onClick={() => {
            if (samplesOpen) closeSamples(false);
            else openSamples();
          }}
          onKeyDown={(event) => {
            if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
            event.preventDefault();
            openSamples(event.key === "ArrowUp" ? KOREAN_SAMPLES.length - 1 : 0);
          }}
        >
          Korean samples
        </button>
      </div>

      <AnimatePresence>
        {samplesOpen && (
          <motion.div
            id={sampleMenuId}
            className="studio-sample-popover"
            role="menu"
            aria-label="Saved Korean samples"
            initial={{ opacity: 0, y: -5, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
            onKeyDown={handleSampleKeys}
          >
            <p>Choose a link to review in the source bar.</p>
            <div className="studio-sample-list">
              {KOREAN_SAMPLES.map((sample, index) => (
                <button
                  key={sample.label}
                  ref={(element) => {
                    sampleItems.current[index] = element;
                  }}
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setSamplesOpen(false);
                    selectSample(sample.url);
                  }}
                >
                  <span>{sample.label}</span>
                  <small>YouTube link</small>
                </button>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

export default function InputAct() {
  const [processingMock] = useState<ProcessingMockScenario | null>(() => {
    if (!import.meta.env.DEV || typeof window === "undefined") return null;
    const requested = new URLSearchParams(window.location.search).get("processingMock");
    return isProcessingMockScenario(requested) ? requested : null;
  });
  const [ownedSourceOpen, setOwnedSourceOpen] = useState(processingMock !== null);
  const [sourceEntryOpen, setSourceEntryOpen] = useState(false);
  const [sourceUrl, setSourceUrl] = useState("");
  const [sourceFocusRequest, setSourceFocusRequest] = useState(0);
  const loadStatus = useStudio((state) => state.loadStatus);
  const error = useStudio((state) => state.error);
  const retry = useStudio((state) => state.retry);
  const preflightStatus = useStudio((state) => state.preflight.status);
  const previewSession = useStudio((state) => state.previewSession);
  const dismissPreflight = useStudio((state) => state.dismissPreflight);
  const clientSourceCheck = useStudio(
    (state) =>
      state.preflight.status !== "idle" &&
      state.preflight.provenance.kind === "client_validation",
  );
  const submittedSourceGuide = previewSession !== null && preflightStatus !== "idle";
  const recordedSourceGuide = previewSession === null && preflightStatus !== "idle" && !clientSourceCheck;
  const showWelcome = preflightStatus === "idle" || clientSourceCheck || submittedSourceGuide || recordedSourceGuide;

  function selectSample(url: string): void {
    dismissPreflight();
    setSourceUrl(url);
    setSourceEntryOpen(true);
    setSourceFocusRequest((current) => current + 1);
  }

  return (
    <motion.section
      className="act act-input"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.4 }}
    >
      <div className="canvas" aria-hidden="true" />

      {ownedSourceOpen && loadStatus === "ready" && (
        <Suspense
          fallback={(
            <div className="input-status" role="status" aria-live="polite">
              <span className="input-status-kicker">Owned local source</span>
              <p>Opening the local production surface…</p>
            </div>
          )}
        >
          <ProductLocalRuntime
            processingMock={processingMock}
            onClose={() => setOwnedSourceOpen(false)}
          />
        </Suspense>
      )}

      {!ownedSourceOpen && showWelcome && loadStatus === "ready" && (
        <>
          <StudioWelcome
            openOwnedMedia={() => setOwnedSourceOpen(true)}
            selectSample={selectSample}
          />
          <StudioSourceDock
            sourceEntryOpen={sourceEntryOpen}
            sourceUrl={sourceUrl}
            sourceFocusRequest={sourceFocusRequest}
            setSourceEntryOpen={setSourceEntryOpen}
            setSourceUrl={setSourceUrl}
          />
        </>
      )}

      {!ownedSourceOpen && preflightStatus === "idle" && loadStatus === "loading" && (
        <div className="input-status" role="status" aria-live="polite">
          <span className="input-status-kicker">Recorded evidence</span>
          <p>Loading the run bundle…</p>
        </div>
      )}

      {!ownedSourceOpen && preflightStatus === "idle" && loadStatus === "failed" && (
        <div className="input-status" role="alert">
          <span className="input-status-kicker">Run unavailable</span>
          <p>The recorded evidence could not be loaded. Nothing has been replayed.</p>
          {error && <code>{error}</code>}
          <button type="button" className="ghost" onClick={() => void retry()}>
            Retry loading
          </button>
        </div>
      )}
    </motion.section>
  );
}
