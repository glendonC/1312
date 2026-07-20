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

type SourceGuideState = "welcome" | "recorded" | "cancelled";

const SOURCE_GUIDE_COPY: Record<SourceGuideState, string> = {
  welcome:
    "Welcome to Studio. Add a source when you’re ready. We’ll take it from there, so you can sit back and watch it come together.",
  recorded:
    "The recorded demo is ready. Review its receipted source and replay request in the guided setup.",
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
  openLocalSource: (mode: LocalSourceMode, seedUrl?: string) => void;
  selectSample: (url: string) => void;
}

type LocalSourceMode = "owned" | "youtube";

/** The orchestrator's invitation, before any runtime or evidence state exists. */
function StudioWelcome({
  openLocalSource,
  selectSample,
}: StudioWelcomeProps) {
  const preflight = useStudio((state) => state.preflight);
  const sourceGuideState: SourceGuideState = preflight.status === "cancelled"
    ? "cancelled"
    : preflight.status !== "idle" && preflight.provenance.kind !== "client_validation"
      ? "recorded"
      : "welcome";
  const sourceGuideActive = sourceGuideState !== "welcome";
  const showPreparation = sourceGuideActive && sourceGuideState === "recorded";
  const guideMessage = SOURCE_GUIDE_COPY[sourceGuideState];
  const labelId = sourceGuideState === "recorded" && preflight.status === "ready"
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
                  status="idle"
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
                  <span role="status" aria-live="polite">
                    {sourceGuideState === "recorded"
                      ? "Recorded source ready"
                      : "Request closed"}
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
          </motion.div>
        </motion.div>
      </LayoutGroup>

      <AnimatePresence initial={false}>
        {!sourceGuideActive && (
          <StudioSourceControl
            openLocalSource={openLocalSource}
            selectSample={selectSample}
          />
        )}
      </AnimatePresence>
    </section>
  );
}

interface StudioSourceDockProps {
  sourceEntryOpen: boolean;
  sourceUrl: string;
  sourceFocusRequest: number;
  setSourceEntryOpen: (open: boolean) => void;
  setSourceUrl: (url: string) => void;
  submitSource: (url: string) => void;
}

function StudioSourceDock({
  sourceEntryOpen,
  sourceUrl,
  sourceFocusRequest,
  setSourceEntryOpen,
  setSourceUrl,
  submitSource,
}: StudioSourceDockProps) {
  const preflight = useStudio((state) => state.preflight);
  const preparationStage = useStudio((state) => state.preparationStage);
  const initialization = useStudio((state) => state.initialization);
  const cancelInitialization = useStudio((state) => state.cancelInitialization);
  const dismissPreflight = useStudio((state) => state.dismissPreflight);
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
              submitSource={submitSource}
            />
          ) : initialization ? (
            <LifecycleBottomBar
              key="initializing"
              mode="initializing"
              title="Initializing recorded replay"
              busy
              primaryAction={{
                label: "Cancel start",
                emphasis: "danger",
                onClick: cancelInitialization,
              }}
            />
          ) : preparing ? (
            <LifecycleBottomBar
              key="preparation"
              mode="preparation"
              title={preparationItem.label}
              stage={preparationStage}
              primaryAction={{ label: "Exit setup", emphasis: "danger", onClick: returnToSource }}
            />
          ) : failed ? (
            <LifecycleBottomBar
              key="failed"
              mode="failed"
              title={preflight.title}
              primaryAction={{ label: "Edit source", onClick: returnToSource }}
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

function StudioSourceControl({
  openLocalSource,
  selectSample,
}: StudioWelcomeProps) {
  const bundle = useBundle();
  const openRecordedPreflight = useStudio((state) => state.openRecordedPreflight);
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const closeFromOutside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", closeFromOutside, true);
    return () => document.removeEventListener("pointerdown", closeFromOutside, true);
  }, [open]);

  function choose(action: () => void): void {
    setOpen(false);
    action();
  }

  function handleKeys(event: ReactKeyboardEvent<HTMLDivElement>): void {
    if (event.key !== "Escape" || !open) return;
    event.preventDefault();
    event.stopPropagation();
    setOpen(false);
    window.requestAnimationFrame(() => trigger.current?.focus());
  }

  return (
    <motion.div
      ref={root}
      className="studio-source-control"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.32, delay: 0.34, ease: [0.22, 1, 0.36, 1] }}
      onKeyDown={handleKeys}
    >
      <button
        ref={trigger}
        type="button"
        className="top-mark studio-source-trigger"
        aria-label="Choose source: local or recorded"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((current) => !current)}
      >
        <svg viewBox="0 0 18 18" width="18" height="18" aria-hidden="true">
          <path d="M4 5.5h10M4 9h6M4 12.5h4M12.5 10.5v4M10.5 12.5h4" />
        </svg>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            id={panelId}
            className="studio-source-panel"
            role="dialog"
            aria-label="Choose a Studio source"
            aria-modal="false"
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
          >
            <header className="studio-source-panel-head">Other ways to start</header>

            <section
              className="studio-source-group"
              data-source-authority="live-local"
              role="group"
              aria-labelledby={`${panelId}-local`}
            >
              <div className="studio-source-group-head">
                <h2 id={`${panelId}-local`}>Process locally</h2>
                <span>Private local host</span>
              </div>
              <div className="studio-source-choice-list">
                <button
                  type="button"
                  className="studio-source-choice"
                  data-source-kind="youtube"
                  data-source-authority="live-local"
                  aria-label="Process a YouTube range locally"
                  onClick={() => choose(() => openLocalSource("youtube"))}
                >
                  <SourceChoiceIcon kind="youtube" />
                  <span><b>YouTube range</b><small>Up to 2 minutes</small></span>
                  <span className="studio-source-choice-arrow" aria-hidden="true">›</span>
                </button>
                <button
                  type="button"
                  className="studio-source-choice"
                  data-source-kind="file"
                  data-source-authority="live-local"
                  aria-label="Process a file I own locally"
                  onClick={() => choose(() => openLocalSource("owned"))}
                >
                  <SourceChoiceIcon kind="file" />
                  <span><b>Owned file</b><small>You own or control it</small></span>
                  <span className="studio-source-choice-arrow" aria-hidden="true">›</span>
                </button>
              </div>

              <div className="studio-source-examples" role="group" aria-label="Example link presets">
                <SourceChoiceIcon kind="link" />
                <span><b>Example links</b><small>Fill the source bar only</small></span>
                <div>
                  {KOREAN_SAMPLES.map((sample) => (
                    <button
                      key={sample.label}
                      type="button"
                      data-source-example-authority="live-local"
                      aria-label={`Fill the source bar with ${sample.label}`}
                      onClick={() => choose(() => selectSample(sample.url))}
                    >
                      {sample.label.slice(-2)}
                    </button>
                  ))}
                </div>
              </div>
            </section>

            <section
              className="studio-source-group"
              data-source-authority="recorded"
              role="group"
              aria-labelledby={`${panelId}-recorded`}
            >
              <div className="studio-source-group-head">
                <h2 id={`${panelId}-recorded`}>Explore a recording</h2>
                <span>No new processing</span>
              </div>
              <div className="studio-source-choice-list">
                <button
                  type="button"
                  className="studio-source-choice"
                  data-source-kind="replay"
                  data-source-authority="recorded"
                  aria-label="Explore the recorded run-006 demo"
                  disabled={!bundle}
                  onClick={() => choose(openRecordedPreflight)}
                >
                  <SourceChoiceIcon kind="replay" />
                  <span><b>run-006 demo</b><small>Replay saved evidence</small></span>
                  <span className="studio-source-choice-arrow" aria-hidden="true">›</span>
                </button>
              </div>
            </section>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function SourceChoiceIcon({ kind }: { kind: "youtube" | "file" | "replay" | "link" }) {
  return (
    <span className="studio-source-choice-icon" data-kind={kind} aria-hidden="true">
      <svg viewBox="0 0 18 18">
        {kind === "youtube" && <path d="M4.2 5.2h9.6a2 2 0 0 1 2 2v3.6a2 2 0 0 1-2 2H4.2a2 2 0 0 1-2-2V7.2a2 2 0 0 1 2-2Zm3.3 1.9 4 1.9-4 1.9Z" />}
        {kind === "file" && <path d="M5 2.5h5l3 3v10H5Zm5 0v3h3" />}
        {kind === "replay" && <path d="M4.4 6.2H1.8V3.6m.2 2.5a7 7 0 1 1-.1 5.7" />}
        {kind === "link" && <path d="m7.2 10.8 3.6-3.6M6 12.8l-1 1a2.5 2.5 0 0 1-3.5-3.5l2.3-2.3a2.5 2.5 0 0 1 3.5 0m4.7-2.8 1-1a2.5 2.5 0 0 1 3.5 3.5L14.2 10a2.5 2.5 0 0 1-3.5 0" />}
      </svg>
    </span>
  );
}

/** Development replay controls stay outside the product welcome and source composition. */
function StudioDevShortcuts() {
  const bundle = useBundle();
  const dismissPreflight = useStudio((state) => state.dismissPreflight);
  const start = useStudio((state) => state.start);
  const seekCursor = useStudio((state) => state.seekCursor);

  return (
    <div className="studio-dev-skip" role="group" aria-label="Developer shortcuts">
      <span className="studio-dev-skip-label">Dev</span>
      <button
        type="button"
        className="studio-dev-skip-btn"
        disabled={!bundle}
        onClick={() => {
          if (!bundle) return;
          dismissPreflight();
          seekCursor(bundle.traces.length);
        }}
      >
        Skip to results
      </button>
      <button
        type="button"
        className="studio-dev-skip-btn"
        disabled={!bundle}
        onClick={() => {
          if (!bundle) return;
          dismissPreflight();
          start();
        }}
      >
        Skip to processing
      </button>
    </div>
  );
}

export default function InputAct() {
  const [processingMock] = useState<ProcessingMockScenario | null>(() => {
    if (!import.meta.env.DEV || typeof window === "undefined") return null;
    const requested = new URLSearchParams(window.location.search).get("processingMock");
    return isProcessingMockScenario(requested) ? requested : null;
  });
  const [localSourceMode, setLocalSourceMode] = useState<LocalSourceMode | null>(
    processingMock === null ? null : "owned",
  );
  const [localSourceSeedUrl, setLocalSourceSeedUrl] = useState("");
  const [sourceEntryOpen, setSourceEntryOpen] = useState(false);
  const [sourceUrl, setSourceUrl] = useState("");
  const [sourceFocusRequest, setSourceFocusRequest] = useState(0);
  const loadStatus = useStudio((state) => state.loadStatus);
  const error = useStudio((state) => state.error);
  const retry = useStudio((state) => state.retry);
  const preflightStatus = useStudio((state) => state.preflight.status);
  const dismissPreflight = useStudio((state) => state.dismissPreflight);
  const clientSourceCheck = useStudio(
    (state) =>
      state.preflight.status !== "idle" &&
      state.preflight.provenance.kind === "client_validation",
  );
  const recordedSourceGuide = preflightStatus !== "idle" && !clientSourceCheck;
  const showWelcome = preflightStatus === "idle" || clientSourceCheck || recordedSourceGuide;

  function selectSample(url: string): void {
    dismissPreflight();
    setSourceUrl(url);
    setSourceEntryOpen(true);
    setSourceFocusRequest((current) => current + 1);
  }

  function openLocalSource(mode: LocalSourceMode, seedUrl = ""): void {
    setLocalSourceSeedUrl(seedUrl);
    setLocalSourceMode(mode);
  }

  /**
   * The pasted link is a request to process that source, so it opens the local YouTube
   * ingest authority rather than the recorded bundle. Nothing about the paste is treated as
   * processing evidence: the ingest still has to clear its own range and confirmation gates.
   */
  function submitPastedSource(url: string): void {
    dismissPreflight();
    openLocalSource("youtube", url);
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

      {import.meta.env.DEV && localSourceMode === null && loadStatus === "ready" && <StudioDevShortcuts />}

      {localSourceMode !== null && loadStatus === "ready" && (
        <Suspense
          fallback={(
            <div className="input-status" role="status" aria-live="polite">
              <span className="input-status-kicker">{localSourceMode === "youtube" ? "YouTube local source" : "Owned local source"}</span>
              <p>Opening the local production surface…</p>
            </div>
          )}
        >
          <ProductLocalRuntime
            processingMock={processingMock}
            sourceMode={localSourceMode}
            initialYoutubeUrl={localSourceSeedUrl}
            onClose={() => setLocalSourceMode(null)}
          />
        </Suspense>
      )}

      {localSourceMode === null && showWelcome && loadStatus === "ready" && (
        <>
          <StudioWelcome
            openLocalSource={openLocalSource}
            selectSample={selectSample}
          />
          <StudioSourceDock
            sourceEntryOpen={sourceEntryOpen}
            sourceUrl={sourceUrl}
            sourceFocusRequest={sourceFocusRequest}
            setSourceEntryOpen={setSourceEntryOpen}
            setSourceUrl={setSourceUrl}
            submitSource={submitPastedSource}
          />
        </>
      )}

      {localSourceMode === null && preflightStatus === "idle" && loadStatus === "loading" && (
        <div className="input-status" role="status" aria-live="polite">
          <span className="input-status-kicker">Recorded evidence</span>
          <p>Loading the run bundle…</p>
        </div>
      )}

      {localSourceMode === null && preflightStatus === "idle" && loadStatus === "failed" && (
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
