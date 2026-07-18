import { useEffect, useRef, useState } from "react";

import type { LearningPlayback } from "../learning/presentation.ts";
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

export default function ProductionMediaPlayer({
  binding,
  onPlaybackChange,
}: {
  binding: ProductionPlaybackBinding;
  onPlaybackChange: (playback: LearningPlayback) => void;
}) {
  const mediaRef = useRef<HTMLMediaElement | null>(null);
  const closeRef = useRef<(detail: string) => void>(() => undefined);
  const [playbackState, setPlaybackState] = useState<PlaybackState>({
    state: "loading",
    detail: "Loading the exact private source bytes.",
  });
  const [currentTimeMs, setCurrentTimeMs] = useState(binding.analysisRange.startMs);
  const [playing, setPlaying] = useState(false);

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

  const MediaElement = binding.handle.mimeType.startsWith("video/") ? "video" : "audio";

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
      <header>
        <div>
          <span>Content-bound private source</span>
          <h5>Verified production playback</h5>
        </div>
        <code>{binding.handle.mimeType}</code>
      </header>
      <MediaElement
        ref={(element) => { mediaRef.current = element; }}
        data-private-production-media="true"
        aria-label="Verified private source media"
      />
      <div className="product-runtime-private-player-controls">
        <button
          type="button"
          disabled={playbackState.state !== "ready"}
          aria-label={playing ? "Pause private source" : "Play private source"}
          onClick={() => {
            const media = mediaRef.current;
            if (!media) return;
            if (media.paused) {
              void media.play().catch(() => {
                closeRef.current("The browser refused private source playback.");
              });
            } else {
              media.pause();
            }
          }}
        >
          {playing ? "Pause" : "Play"}
        </button>
        <output aria-label="Private source current time">{clock(currentTimeMs)}</output>
        <span>
          Verified range {clock(binding.analysisRange.startMs)} to {clock(binding.analysisRange.endMs)}
        </span>
      </div>
      <p role="status" data-private-playback-detail={playbackState.state}>{playbackState.detail}</p>
    </section>
  );
}
