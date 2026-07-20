import type { ReactNode } from "react";

// Direct import so Vite invalidates player-chrome styles on every surface that composes it,
// including the production player, which never mounts RecordedMediaPlayer.
import "../../styles/studio/results.player.css";
import { Captions, Hold, Volume } from "../glyphs";
import { ClozeText } from "../learning/cloze";
import type { SpeakerDisplay } from "../learning/speakers";
import type { CaptionMode, CaptionScale, ClozeAmount } from "../learning/viewerSession";

export const CAPTION_SCALE_STEPS: readonly CaptionScale[] = ["sm", "md", "lg"];

/**
 * The one YouTube-familiar control surface for every results player. These components are pure
 * presentation: they render the exact chrome the recorded player established (progress bar, then
 * play / volume / time on the left and speed / viewing modes on the right; the top-right settings
 * pill with caption controls) and know nothing about where playback authority comes from. Each
 * player owns its media element, clock, and authority lifecycle and feeds this chrome its state,
 * so the recorded demo and a verified production clip read as the same instrument without either
 * borrowing the other's authority.
 */
export interface PlayerProgressChrome {
  /** Seconds domain. `min` is 0 for a recorded clip and the verified range start for production. */
  min: number;
  max: number;
  value: number;
  disabled: boolean;
  ariaValueText: string;
  onSeek: (seconds: number) => void;
  /** Recorded music/silence shading. Absent means an unshaded bar, never invented regions. */
  regions?: ReadonlyArray<{ kind: "music" | "silence"; start: number; end: number }>;
}

export interface PlayerTransportChrome {
  progress: PlayerProgressChrome;
  play: {
    playing: boolean;
    disabled: boolean;
    playLabel: string;
    pauseLabel: string;
    onToggle: () => void;
  };
  volume: {
    muted: boolean;
    volume: number;
    disabled: boolean;
    onToggleMuted: () => void;
    onVolume: (volume: number) => void;
  };
  timeLabel: string;
  speed: {
    rate: number;
    disabled: boolean;
    onRate: (rate: number) => void;
  };
}

export interface PlayerCaptionChrome {
  visible: boolean;
  scale: CaptionScale;
  onToggleVisible: () => void;
  onStepScale: (direction: -1 | 1) => void;
}

/** The active line burned over the picture: the source, and its translation or a labelled gap. */
export interface CaptionBurnLine {
  /** The caption line identity, so a selection on the burn binds to the same moment the transcript reads. */
  lineId: string;
  source: string;
  sourceLanguage: string;
  targetLanguage: string;
  target: { state: "text"; text: string } | { state: "withheld"; reason: string } | null;
  /** Recorded speaker attribution for this line, when the source carries one. Never invented. */
  speakers?: SpeakerDisplay[];
}

/**
 * The burned-in caption line over the picture, the immersive reading surface. It shows the source
 * and its translation together (or one language, or with words blanked for Listen practice), driven
 * by the shared caption mode so one control steers the video and the transcript alike. Withheld
 * stays a labelled gap, never a guess. The caption text is selectable: the language-learning
 * surface listens for selections on the [data-caption-side] spans and raises its action bar there.
 */
export function CaptionBurn({
  line,
  mode,
  cloze,
}: {
  line: CaptionBurnLine | null;
  mode: CaptionMode;
  cloze: ClozeAmount;
}) {
  if (!line) return null;
  const showSource = mode !== "target";
  const showTarget = mode !== "source";
  const withheld = line.target?.state === "withheld";
  return (
    <figcaption
      className="burn"
      data-path={withheld ? "withheld" : "prepped"}
      data-caption-mode={mode}
    >
      {line.speakers && line.speakers.length > 0 && (
        <span className="burn-speakers">
          {line.speakers.map((speaker) => (
            <span
              key={speaker.id}
              className="burn-speaker"
              data-speaker-index={speaker.colorIndex}
              title={speaker.label}
            >
              {speaker.shortLabel}
            </span>
          ))}
        </span>
      )}
      {showSource && (
        mode === "listen" ? (
          // Practice keeps the line selectable: the blanks preserve the full recorded text, so a
          // selection here binds to the same code-point span as the plain caption.
          <span
            className="burn-src"
            lang={line.sourceLanguage}
            data-caption-side="source"
            data-caption-line-id={line.lineId}
          >
            <ClozeText
              text={line.source}
              seed={`${line.lineId}:source`}
              amount={cloze}
              lang={line.sourceLanguage}
            />
          </span>
        ) : (
          <span
            className="burn-src"
            lang={line.sourceLanguage}
            data-caption-side="source"
            data-caption-line-id={line.lineId}
          >
            {line.source}
          </span>
        )
      )}
      {showTarget && line.target && (
        line.target.state === "withheld" ? (
          <span className="burn-withheld">
            <span className="burn-mark">withheld</span>
            {line.target.reason}
          </span>
        ) : (
          <span
            className="burn-tgt"
            lang={line.targetLanguage}
            data-caption-side="target"
            data-caption-line-id={line.lineId}
          >
            {line.target.text}
          </span>
        )
      )}
    </figcaption>
  );
}

/**
 * The top-right settings pill: caption show/hide and size, plus any panel-facing controls the
 * viewer shell contributes. It reveals with the rest of the hover chrome.
 */
export function PlayerSettingsPill({
  captions,
  panelControls,
}: {
  captions: PlayerCaptionChrome;
  panelControls?: ReactNode;
}) {
  return (
    <div className="player-settings-pill">
      <span className="pcap-group" role="group" aria-label="Caption display">
        <button
          type="button"
          className="pcap-btn pcap-cc"
          aria-label={captions.visible ? "Hide captions" : "Show captions"}
          aria-pressed={captions.visible}
          onClick={captions.onToggleVisible}
        >
          <Captions off={!captions.visible} />
          <span className="pm-tip" aria-hidden="true">{captions.visible ? "Hide captions" : "Show captions"}</span>
        </button>
        <button
          type="button"
          className="pcap-btn pcap-step"
          aria-label="Smaller captions"
          disabled={!captions.visible || captions.scale === "sm"}
          onClick={() => captions.onStepScale(-1)}
        >
          A<small>-</small>
        </button>
        <button
          type="button"
          className="pcap-btn pcap-step"
          aria-label="Larger captions"
          disabled={!captions.visible || captions.scale === "lg"}
          onClick={() => captions.onStepScale(1)}
        >
          A<small>+</small>
        </button>
      </span>
      {panelControls}
    </div>
  );
}

/**
 * The on-video transport: a full-width progress bar (played fill, draggable knob, optional
 * region shading), then one row of play, volume, time on the left and speed plus the viewing
 * modes on the right.
 */
export function PlayerOverlayBar({
  transport,
  modeControls,
}: {
  transport: PlayerTransportChrome;
  modeControls?: ReactNode;
}) {
  const { progress, play, volume, timeLabel, speed } = transport;
  const span = progress.max - progress.min;
  const pct = (seconds: number): number =>
    span > 0 ? Math.min(100, Math.max(0, ((seconds - progress.min) / span) * 100)) : 0;
  const progressPct = pct(progress.value);

  return (
    <div className="pbar-wrap">
      <div className="pbar" data-empty={span <= 0 || undefined}>
        <div className="pbar-track">
          {span > 0 && progress.regions && progress.regions.length > 0 && (
            <div className="pbar-regions" aria-hidden="true">
              {progress.regions.map((region, index) => (
                <span
                  key={`${region.kind}-${index}`}
                  className="pbar-region"
                  data-kind={region.kind}
                  style={{ left: `${pct(region.start)}%`, width: `${pct(region.end) - pct(region.start)}%` }}
                />
              ))}
            </div>
          )}
          <div className="pbar-fill" style={{ width: `${progressPct}%` }} aria-hidden="true" />
          <span className="pbar-knob" style={{ left: `${progressPct}%` }} aria-hidden="true" />
        </div>
        <input
          type="range"
          className="pbar-input"
          min={progress.min}
          max={span > 0 ? progress.max : progress.min}
          step={0.1}
          value={progress.value}
          onChange={(event) => progress.onSeek(event.currentTarget.valueAsNumber)}
          aria-label="Seek through clip"
          aria-valuetext={progress.ariaValueText}
          disabled={progress.disabled}
        />
      </div>
      <div className="pctl">
        <div className="pctl-left">
          <button
            type="button"
            className="pbtn pbtn-play"
            onClick={play.onToggle}
            disabled={play.disabled}
            aria-label={play.playing ? play.pauseLabel : play.playLabel}
          >
            <Hold paused={!play.playing} />
          </button>
          <div className="pvol">
            <button
              type="button"
              className="pbtn"
              onClick={volume.onToggleMuted}
              disabled={volume.disabled}
              aria-label={volume.muted || volume.volume === 0 ? "Unmute" : "Mute"}
              aria-pressed={volume.muted || volume.volume === 0}
            >
              <Volume muted={volume.muted || volume.volume === 0} />
            </button>
            <input
              type="range"
              className="pvol-slider"
              min={0}
              max={1}
              step={0.05}
              value={volume.muted ? 0 : volume.volume}
              aria-label="Volume"
              disabled={volume.disabled}
              onChange={(event) => volume.onVolume(event.currentTarget.valueAsNumber)}
            />
          </div>
          <span className="ptime">{timeLabel}</span>
        </div>
        <div className="pctl-right">
          <select
            className="pspeed"
            aria-label="Playback speed"
            value={speed.rate}
            disabled={speed.disabled}
            onChange={(event) => speed.onRate(Number(event.currentTarget.value))}
          >
            <option value={0.5}>0.5×</option>
            <option value={0.75}>0.75×</option>
            <option value={1}>1×</option>
            <option value={1.25}>1.25×</option>
            <option value={1.5}>1.5×</option>
            <option value={2}>2×</option>
          </select>
          {modeControls}
        </div>
      </div>
    </div>
  );
}
