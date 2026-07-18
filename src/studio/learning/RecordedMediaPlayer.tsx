import { useEffect, useId, useRef, useState } from "react";

import { clock } from "../format";
import { useStudio } from "../store";
import type { RunBundle } from "../transport";
import { useViewerSession } from "./viewerSession";

const HAS_PICTURE = /\.(mp4|webm|mov|m4v)$/i;

function CaptionOverlay({ bundle }: { bundle: RunBundle }) {
  const clipT = useStudio((state) => state.clipT);
  const cue = bundle.captions.cues.find((candidate) => clipT >= candidate.t_start && clipT < candidate.t_end);
  if (!cue || cue.silence) return null;

  const target = cue.targets.find((candidate) => candidate.lang === bundle.run.pair.target);
  if (target?.withheld) {
    return (
      <figcaption className="burn" data-path="withheld">
        <span className="burn-mark">withheld</span>
        {target.withheld.reason}
      </figcaption>
    );
  }
  if (!target?.text) return null;

  return (
    <figcaption className="burn" data-path="prepped">
      {target.text}
    </figcaption>
  );
}

export default function RecordedMediaPlayer({
  bundle,
  surface,
}: {
  bundle: RunBundle;
  surface: "results" | "workbench";
}) {
  const playerId = useId();
  const clipT = useStudio((state) => state.clipT);
  const setClipT = useStudio((state) => state.setClipT);
  const playing = useStudio((state) => state.playing);
  const setPlaying = useStudio((state) => state.setPlaying);
  const activePlayerId = useViewerSession((state) => state.activePlayerId);
  const muted = useViewerSession((state) => state.muted);
  const volume = useViewerSession((state) => state.volume);
  const playbackRate = useViewerSession((state) => state.playbackRate);
  const activatePlayer = useViewerSession((state) => state.activatePlayer);
  const releasePlayer = useViewerSession((state) => state.releasePlayer);
  const setMuted = useViewerSession((state) => state.setMuted);
  const setVolume = useViewerSession((state) => state.setVolume);
  const setPlaybackRate = useViewerSession((state) => state.setPlaybackRate);

  const mediaRef = useRef<HTMLMediaElement | null>(null);
  const raf = useRef(0);
  const [mediaFailed, setMediaFailed] = useState(false);
  const duration = bundle.run.clip.duration;
  const media = bundle.run.clip.media;
  const src = media ? `/demo/runs/${bundle.run.id}/${media}` : null;
  const picture = Boolean(media && HAS_PICTURE.test(media));
  const ownsPlayback = activePlayerId === playerId;
  const activelyPlaying = ownsPlayback && playing;

  useEffect(() => setMediaFailed(false), [src]);

  useEffect(() => {
    const element = mediaRef.current;
    if (!element) return;
    element.muted = muted;
    element.volume = volume;
  }, [muted, volume, src]);

  useEffect(() => {
    const element = mediaRef.current;
    if (element) element.playbackRate = playbackRate;
  }, [playbackRate, src]);

  // The recorded replay store owns time. Every mounted presentation follows the same position.
  useEffect(() => {
    const element = mediaRef.current;
    if (element && Math.abs(element.currentTime - clipT) > 0.3) element.currentTime = clipT;
  }, [clipT]);

  useEffect(() => {
    const element = mediaRef.current;
    if (!activelyPlaying || !src || mediaFailed) {
      element?.pause();
      cancelAnimationFrame(raf.current);
      if (ownsPlayback && playing && (!src || mediaFailed)) setPlaying(false);
      return;
    }

    if (element) void element.play().catch(() => setPlaying(false));
    let last = performance.now();
    const tick = (now: number): void => {
      const elapsed = (now - last) / 1_000;
      last = now;
      const next = element?.currentTime ?? useStudio.getState().clipT + elapsed;
      if (next >= duration) {
        setClipT(duration);
        setPlaying(false);
        return;
      }
      setClipT(next);
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [activelyPlaying, duration, mediaFailed, ownsPlayback, playing, setClipT, setPlaying, src]);

  useEffect(() => () => {
    if (useViewerSession.getState().activePlayerId !== playerId) return;
    releasePlayer(playerId);
    useStudio.getState().setPlaying(false);
  }, [playerId, releasePlayer]);

  const attach = (element: HTMLMediaElement | null): void => {
    mediaRef.current = element;
    if (!element) return;
    element.muted = muted;
    element.volume = volume;
    element.playbackRate = playbackRate;
  };

  const togglePlayback = (): void => {
    if (!ownsPlayback) {
      activatePlayer(playerId);
      setPlaying(true);
      return;
    }
    setPlaying(!playing);
  };

  const seek = (nextTime: number): void => {
    activatePlayer(playerId);
    setClipT(nextTime);
  };

  const toggleMuted = (): void => {
    if (muted || volume === 0) {
      if (volume === 0) setVolume(0.8);
      setMuted(false);
    } else {
      setMuted(true);
    }
  };

  const { peaks } = bundle.wave;
  const { music, silence, source, title } = bundle.run.clip;

  return (
    <div className="player" data-player-surface={surface} data-playback-owner={ownsPlayback || undefined}>
      {src && (picture ? (
        <figure className="screen">
          <video
            ref={attach}
            className="screen-video"
            src={src}
            preload="auto"
            playsInline
            onClick={togglePlayback}
            onError={() => {
              setMediaFailed(true);
              setPlaying(false);
            }}
          />
          <CaptionOverlay bundle={bundle} />
        </figure>
      ) : (
        <audio
          ref={attach}
          src={src}
          preload="auto"
          onError={() => {
            setMediaFailed(true);
            setPlaying(false);
          }}
        />
      ))}

      {!src && <p className="media-empty">No playable media artifact was recorded for this run.</p>}
      {mediaFailed && <p className="media-empty">The recorded media could not be loaded. Captions remain inspectable.</p>}

      <div className="transport">
        <button
          type="button"
          className="play"
          onClick={togglePlayback}
          disabled={!src || mediaFailed}
          aria-label={activelyPlaying ? "Pause" : "Play"}
        >
          {activelyPlaying ? "❚❚" : "▶"}
        </button>

        {peaks.length > 0 && duration > 0 ? (
          <div className="wave">
            <svg className="wave-svg" viewBox="0 0 1000 100" preserveAspectRatio="none" aria-hidden="true">
              {peaks.map((peak, index) => {
                const step = 1000 / peaks.length;
                const height = Math.max(2, peak * 88);
                return (
                  <rect
                    key={index}
                    x={index * step}
                    y={(100 - height) / 2}
                    width={step * 0.6}
                    height={height}
                    rx={0.6}
                  />
                );
              })}
            </svg>
            <div className="wave-regions" aria-hidden="true">
              {music.map(([start, end], index) => (
                <div
                  key={`music-${index}`}
                  className="wave-region"
                  data-kind="music"
                  style={{ left: `${(start / duration) * 100}%`, width: `${((end - start) / duration) * 100}%` }}
                />
              ))}
              {silence.map(([start, end], index) => (
                <div
                  key={`silence-${index}`}
                  className="wave-region"
                  data-kind="silence"
                  style={{ left: `${(start / duration) * 100}%`, width: `${((end - start) / duration) * 100}%` }}
                />
              ))}
            </div>
            <div className="wave-head" style={{ left: `${(clipT / duration) * 100}%` }} aria-hidden="true" />
            <input
              type="range"
              className="wave-hit"
              min={0}
              max={duration}
              step={0.1}
              value={clipT}
              onChange={(event) => seek(event.currentTarget.valueAsNumber)}
              aria-label="Seek through clip"
              aria-valuetext={`${clock(clipT)} of ${clock(duration)}`}
            />
          </div>
        ) : (
          <p className="wave-empty">No waveform samples were recorded.</p>
        )}

        <span className="player-time">{clock(clipT)} / {clock(duration)}</span>
        <div className="player-sound">
          <button
            type="button"
            className="player-control"
            aria-label={muted || volume === 0 ? "Unmute" : "Mute"}
            aria-pressed={muted || volume === 0}
            disabled={!src || mediaFailed}
            onClick={toggleMuted}
          >
            {muted || volume === 0 ? "Muted" : "Sound"}
          </button>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={muted ? 0 : volume}
            aria-label="Volume"
            disabled={!src || mediaFailed}
            onChange={(event) => {
              const nextVolume = event.currentTarget.valueAsNumber;
              setVolume(nextVolume);
              setMuted(nextVolume === 0);
            }}
          />
        </div>
        <label className="player-rate">
          <span>Speed</span>
          <select
            aria-label="Playback speed"
            value={playbackRate}
            disabled={!src || mediaFailed}
            onChange={(event) => setPlaybackRate(Number(event.currentTarget.value))}
          >
            <option value={0.5}>0.5×</option>
            <option value={0.75}>0.75×</option>
            <option value={1}>1×</option>
            <option value={1.25}>1.25×</option>
            <option value={1.5}>1.5×</option>
            <option value={2}>2×</option>
          </select>
        </label>
      </div>

      {source.licence && (
        <p className="credit">
          <span className="credit-work">
            <span className="credit-title">{title}</span> by {source.label}
          </span>
          <span className="credit-licence">
            {source.url ? (
              <a href={source.url} target="_blank" rel="noreferrer noopener">
                {source.licence}
              </a>
            ) : source.licence}
          </span>
        </p>
      )}
    </div>
  );
}
