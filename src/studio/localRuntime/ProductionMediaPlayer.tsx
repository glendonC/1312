import { useEffect, useRef, useState, type ReactNode } from "react";

import type { ProductionPresentedMoment } from "../learning/model";
import type { LearningPlayback } from "../learning/presentation.ts";
import { useViewerSession } from "../learning/viewerSession";
import {
  CAPTION_SCALE_STEPS,
  CaptionBurn,
  type CaptionBurnLine,
  PlayerOverlayBar,
  PlayerSettingsPill,
} from "../viewer/playerChrome";
import type { ProductionPlaybackBinding } from "./productionPlaybackController.ts";

type PlaybackState =
  | { state: "loading"; detail: string }
  | { state: "ready"; detail: string }
  | { state: "unavailable"; detail: string };

const PLAYBACK_UNAVAILABLE: LearningPlayback = {
  state: "unavailable",
  reasonCode: "production_media_playback_unavailable",
};

function clock(timeMs: number): string {
  const totalSeconds = Math.max(0, timeMs) / 1_000;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds - minutes * 60;
  return `${minutes}:${seconds.toFixed(1).padStart(4, "0")}`;
}

function availablePlayback(
  binding: ProductionPlaybackBinding,
  currentTimeMs: number,
  onSeek: (timeMs: number) => void,
): LearningPlayback {
  return {
    state: "available",
    authority: "verified_production_caption",
    binding: {
      runtimeId: binding.runtimeId,
      sourceRevisionId: binding.sourceRevisionId,
      sourceArtifactId: binding.sourceArtifactId,
      sourceContentId: binding.sourceContentId,
      captionJobId: binding.captionJobId,
      captionArtifactId: binding.captionArtifactId,
      captionContentId: binding.captionContentId,
      timestampOrigin: binding.timestampOrigin,
    },
    currentTimeMs,
    onSeek,
  };
}

/**
 * The verified production clip in the same player chrome as the recorded demo. This component
 * still owns the private-grant lifecycle unchanged — content-bound src, expiry, fail-closed close,
 * dispose — and every transport action stays inside the verified analysis range. The shared chrome
 * only presents that state; it grants nothing. The burned caption line comes from the verified
 * caption moments, so withheld lines stay labelled gaps on the picture exactly as in the rail.
 */
export default function ProductionMediaPlayer({
  binding,
  onPlaybackChange,
  moments,
  active = true,
  modeControls,
  panelControls,
}: {
  binding: ProductionPlaybackBinding;
  onPlaybackChange: (playback: LearningPlayback) => void;
  /** Verified caption moments for the burned-in line. Presentation input, not new authority. */
  moments: readonly ProductionPresentedMoment[];
  /**
   * False while the composing surface shows another view of the same run. The player stays
   * mounted so the grant, clock, and session state survive, but the clip must not keep sounding
   * behind a view it is not on.
   */
  active?: boolean;
  modeControls?: ReactNode;
  panelControls?: ReactNode;
}) {
  const mediaRef = useRef<HTMLMediaElement | null>(null);
  const closeRef = useRef<(detail: string) => void>(() => undefined);
  const [playbackState, setPlaybackState] = useState<PlaybackState>({
    state: "loading",
    detail: "Loading the exact private source bytes.",
  });
  const [currentTimeMs, setCurrentTimeMs] = useState(binding.analysisRange.startMs);
  const [playing, setPlaying] = useState(false);

  // No activePlayerId arbitration: this player is never mounted beside the recorded or workbench
  // players (input act vs run act), so there is no playback ownership to contest.
  const muted = useViewerSession((state) => state.muted);
  const volume = useViewerSession((state) => state.volume);
  const playbackRate = useViewerSession((state) => state.playbackRate);
  const captionScale = useViewerSession((state) => state.captionScale);
  const captionsVisible = useViewerSession((state) => state.captionsVisible);
  const captionMode = useViewerSession((state) => state.captionMode);
  const clozeAmount = useViewerSession((state) => state.clozeAmount);
  const setMuted = useViewerSession((state) => state.setMuted);
  const setVolume = useViewerSession((state) => state.setVolume);
  const setPlaybackRate = useViewerSession((state) => state.setPlaybackRate);
  const setCaptionScale = useViewerSession((state) => state.setCaptionScale);
  const setCaptionsVisible = useViewerSession((state) => state.setCaptionsVisible);

  const ready = playbackState.state === "ready";

  const seek = (timeMs: number) => {
    const media = mediaRef.current;
    if (!media || media.readyState < HTMLMediaElement.HAVE_METADATA || binding.handle.disposed) return;
    const bounded = Math.min(
      Math.max(timeMs, binding.analysisRange.startMs),
      Math.min(binding.analysisRange.endMs, binding.handle.source.durationMs),
    );
    media.currentTime = bounded / 1_000;
    setCurrentTimeMs(bounded);
    onPlaybackChange(availablePlayback(binding, bounded, seek));
  };

  useEffect(() => {
    const media = mediaRef.current;
    const src = binding.handle.src;
    let closed = false;
    let expiryTimer: ReturnType<typeof setTimeout> | null = null;

    const clearElement = () => {
      media?.pause();
      if (media) {
        media.removeAttribute("src");
        media.load();
      }
      setPlaying(false);
    };
    const close = (detail: string) => {
      if (closed) return;
      closed = true;
      if (expiryTimer) clearTimeout(expiryTimer);
      clearElement();
      setPlaybackState({ state: "unavailable", detail });
      onPlaybackChange(PLAYBACK_UNAVAILABLE);
      void binding.handle.dispose().catch(() => undefined);
    };
    closeRef.current = close;

    onPlaybackChange(PLAYBACK_UNAVAILABLE);
    setPlaybackState({ state: "loading", detail: "Loading the exact private source bytes." });
    setCurrentTimeMs(binding.analysisRange.startMs);
    if (!media || !src || binding.handle.disposed) {
      close("The private playback grant is no longer available.");
      return () => undefined;
    }

    const onLoadedMetadata = () => {
      if (closed) return;
      const decodedDurationMs = media.duration * 1_000;
      if (!Number.isFinite(decodedDurationMs) || decodedDurationMs + 1 < binding.analysisRange.endMs) {
        close("The decoded source duration does not contain the verified caption timeline.");
        return;
      }
      media.currentTime = binding.analysisRange.startMs / 1_000;
      setCurrentTimeMs(binding.analysisRange.startMs);
    };
    const onCanPlay = () => {
      if (closed) return;
      setPlaybackState({ state: "ready", detail: "Private source ready on the verified source-zero timeline." });
      onPlaybackChange(availablePlayback(binding, media.currentTime * 1_000, seek));
    };
    const onTimeUpdate = () => {
      if (closed) return;
      const nextTimeMs = media.currentTime * 1_000;
      setCurrentTimeMs(nextTimeMs);
      if (media.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        onPlaybackChange(availablePlayback(binding, nextTimeMs, seek));
      }
    };
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onError = () => close("The browser could not decode the private source media.");

    media.addEventListener("loadedmetadata", onLoadedMetadata);
    media.addEventListener("canplay", onCanPlay);
    media.addEventListener("timeupdate", onTimeUpdate);
    media.addEventListener("play", onPlay);
    media.addEventListener("pause", onPause);
    media.addEventListener("error", onError);
    media.crossOrigin = "anonymous";
    media.preload = "metadata";
    media.src = src;
    media.load();

    const expiresInMs = Date.parse(binding.handle.expiresAt) - Date.now();
    if (expiresInMs <= 0) {
      close("The private playback grant expired before media became available.");
    } else {
      expiryTimer = setTimeout(() => {
        close("The private playback grant expired. Reload the active caption result to continue.");
      }, expiresInMs);
    }

    return () => {
      closed = true;
      closeRef.current = () => undefined;
      if (expiryTimer) clearTimeout(expiryTimer);
      media.removeEventListener("loadedmetadata", onLoadedMetadata);
      media.removeEventListener("canplay", onCanPlay);
      media.removeEventListener("timeupdate", onTimeUpdate);
      media.removeEventListener("play", onPlay);
      media.removeEventListener("pause", onPause);
      media.removeEventListener("error", onError);
      clearElement();
      onPlaybackChange(PLAYBACK_UNAVAILABLE);
      void binding.handle.dispose().catch(() => undefined);
    };
  }, [binding]);

  useEffect(() => {
    if (!active) mediaRef.current?.pause();
  }, [active]);

  useEffect(() => {
    const media = mediaRef.current;
    if (!media) return;
    media.muted = muted;
    media.volume = volume;
  }, [muted, volume, ready]);

  useEffect(() => {
    const media = mediaRef.current;
    if (media) media.playbackRate = playbackRate;
  }, [playbackRate, ready]);

  const togglePlay = (): void => {
    const media = mediaRef.current;
    if (!media || !ready) return;
    if (media.paused) {
      void media.play().catch(() => {
        closeRef.current("The browser refused private source playback.");
      });
    } else {
      media.pause();
    }
  };

  const toggleMuted = (): void => {
    if (muted || volume === 0) {
      if (volume === 0) setVolume(0.8);
      setMuted(false);
    } else {
      setMuted(true);
    }
  };

  const stepCaptionScale = (direction: -1 | 1): void => {
    const index = CAPTION_SCALE_STEPS.indexOf(captionScale);
    const next = CAPTION_SCALE_STEPS[Math.min(CAPTION_SCALE_STEPS.length - 1, Math.max(0, index + direction))];
    if (next !== captionScale) setCaptionScale(next);
  };

  const rangeStartMs = binding.analysisRange.startMs;
  const rangeEndMs = Math.min(binding.analysisRange.endMs, binding.handle.source.durationMs);
  const picture = binding.handle.mimeType.startsWith("video/");

  const activeMoment = captionsVisible && ready
    ? moments.find((moment) => currentTimeMs >= moment.startMs && currentTimeMs < moment.endMs)
    : undefined;
  const burnLine: CaptionBurnLine | null = activeMoment && activeMoment.source.state === "available"
    ? {
        lineId: activeMoment.lineId,
        source: activeMoment.source.text,
        sourceLanguage: activeMoment.sourceLanguage,
        targetLanguage: activeMoment.targetLanguage,
        target: activeMoment.target.state === "available"
          ? { state: "text", text: activeMoment.target.text }
          : activeMoment.target.state === "withheld"
            ? { state: "withheld", reason: activeMoment.target.detail }
            : null,
      }
    : null;

  const overlayBar = (
    <PlayerOverlayBar
      transport={{
        progress: {
          min: rangeStartMs / 1_000,
          max: rangeEndMs / 1_000,
          value: currentTimeMs / 1_000,
          disabled: !ready,
          ariaValueText: `${clock(currentTimeMs)} of ${clock(rangeEndMs)}`,
          onSeek: (seconds) => seek(seconds * 1_000),
        },
        play: {
          playing,
          disabled: !ready,
          playLabel: "Play private source",
          pauseLabel: "Pause private source",
          onToggle: togglePlay,
        },
        volume: {
          muted,
          volume,
          disabled: !ready,
          onToggleMuted: toggleMuted,
          onVolume: (nextVolume) => {
            setVolume(nextVolume);
            setMuted(nextVolume === 0);
          },
        },
        timeLabel: `${clock(currentTimeMs)} / ${clock(rangeEndMs)}`,
        speed: {
          rate: playbackRate,
          disabled: !ready,
          onRate: setPlaybackRate,
        },
      }}
      modeControls={modeControls}
    />
  );

  return (
    <section
      className="product-runtime-private-player"
      aria-label="Private production media playback"
      data-private-playback-state={playbackState.state}
      data-private-playback-runtime-id={binding.runtimeId}
      data-private-playback-source-artifact-id={binding.sourceArtifactId}
      data-private-playback-caption-artifact-id={binding.captionArtifactId}
      data-private-playback-timestamp-origin={binding.timestampOrigin.kind}
    >
      <div
        className="player"
        data-player-surface="production"
        data-overlay-controls={picture || undefined}
        data-playing={playing ? "true" : "false"}
      >
        {picture ? (
          <figure className="screen" data-caption-scale={captionScale}>
            <video
              ref={(element) => { mediaRef.current = element; }}
              className="screen-video"
              data-private-production-media="true"
              aria-label="Verified private source media"
              playsInline
              onClick={togglePlay}
            />
            <CaptionBurn line={burnLine} mode={captionMode} cloze={clozeAmount} />
            <PlayerSettingsPill
              captions={{
                visible: captionsVisible,
                scale: captionScale,
                onToggleVisible: () => setCaptionsVisible(!captionsVisible),
                onStepScale: stepCaptionScale,
              }}
              panelControls={panelControls}
            />
            <div className="player-controls">{overlayBar}</div>
          </figure>
        ) : (
          <>
            <audio
              ref={(element) => { mediaRef.current = element; }}
              data-private-production-media="true"
              aria-label="Verified private source media"
            />
            {modeControls}
            <div className="product-runtime-private-player-controls">
              <button
                type="button"
                disabled={!ready}
                aria-label={playing ? "Pause private source" : "Play private source"}
                onClick={togglePlay}
              >
                {playing ? "Pause" : "Play"}
              </button>
              <output aria-label="Private source current time">{clock(currentTimeMs)}</output>
              <span>
                Verified range {clock(rangeStartMs)} to {clock(rangeEndMs)}
              </span>
            </div>
          </>
        )}
      </div>
      <p role="status" data-private-playback-detail={playbackState.state}>{playbackState.detail}</p>
    </section>
  );
}
