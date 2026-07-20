import type { ReactNode } from "react";

// Direct import so Vite invalidates player-chrome styles on every surface that composes it,
// including the production player, which never mounts RecordedMediaPlayer.
import "../../styles/studio/results.player.css";
import { Captions, Hold, Volume } from "../glyphs";
import type { CaptionScale } from "../learning/viewerSession";

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
/** A prepared point of interest on the timeline: where it sits (seconds domain) and which kind
 *  of preparation put it there (machine-readable, like a region's kind). The chrome draws it;
 *  only a surface that owns a prepared projection may supply it. The dots are decorative to
 *  assistive tech — the supplying surface owns an accessible statement of the same facts. */
export interface PlayerProgressMarker {
  start: number;
  kind: string;
}

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
  /** Prepared-moment dots. Absent means an unmarked bar, never invented moments. */
  markers?: ReadonlyArray<PlayerProgressMarker>;
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

export type CaptionBurnState =
  | { path: "prepped"; text: string }
  | { path: "withheld"; reason: string };

/** The burned-in caption line over the picture. Withheld stays a labelled gap, never a guess. */
export function CaptionBurn({ burn }: { burn: CaptionBurnState | null }) {
  if (!burn) return null;
  if (burn.path === "withheld") {
    return (
      <figcaption className="burn" data-path="withheld">
        <span className="burn-mark">withheld</span>
        {burn.reason}
      </figcaption>
    );
  }
  return (
    <figcaption className="burn" data-path="prepped">
      {burn.text}
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
        {/* Outside the clipped track so the dots can stand slightly proud of it. The slider
            keeps all interaction; the dots are waypoints, stated accessibly by the surface
            that supplied them. */}
        {span > 0 && progress.markers && progress.markers.length > 0 && (
          <div className="pbar-markers" aria-hidden="true">
            {progress.markers.map((marker, index) => (
              <span
                key={`${marker.start}-${index}`}
                className="pbar-marker"
                data-kind={marker.kind}
                style={{ left: `${pct(marker.start)}%` }}
              />
            ))}
          </div>
        )}
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
