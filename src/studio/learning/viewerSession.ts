import { create } from "zustand";

const ALLOWED_PLAYBACK_RATES = new Set([0.5, 0.75, 1, 1.25, 1.5, 2]);

export type CaptionScale = "sm" | "md" | "lg";

/**
 * How the captions read, shared by the on-video burn and the transcript so one control drives both:
 * both languages, one language, or Listen, a practice mode that blanks some of the caption's words
 * so the ear fills them in. Each blank reveals on tap or hover.
 */
export type CaptionMode = "both" | "source" | "target" | "listen";

/** How many words Listen blanks out: 1 a few, 2 about half, 3 most of the line. */
export type ClozeAmount = 1 | 2 | 3;

interface ViewerSessionState {
  /** The one mounted media surface allowed to drive playback and audio. */
  activePlayerId: string | null;
  muted: boolean;
  volume: number;
  playbackRate: number;
  /** How large the burned-in caption reads, and whether it shows at all. Viewer preference, not run data. */
  captionScale: CaptionScale;
  captionsVisible: boolean;
  /** Which languages the caption shows, and the Listen practice mode. Shared by video and transcript. */
  captionMode: CaptionMode;
  /** How many words Listen blanks, so practice is a dial, not all-or-nothing. */
  clozeAmount: ClozeAmount;
  activatePlayer: (playerId: string) => void;
  releasePlayer: (playerId: string) => void;
  setMuted: (muted: boolean) => void;
  setVolume: (volume: number) => void;
  setPlaybackRate: (playbackRate: number) => void;
  setCaptionScale: (captionScale: CaptionScale) => void;
  setCaptionsVisible: (captionsVisible: boolean) => void;
  setCaptionMode: (captionMode: CaptionMode) => void;
  setClozeAmount: (clozeAmount: ClozeAmount) => void;
}

/**
 * Page-session viewer preferences shared by every presentation of the same recorded media.
 * This store is deliberately not persisted to an account, browser storage, or a run artifact.
 */
export const useViewerSession = create<ViewerSessionState>((set) => ({
  activePlayerId: null,
  muted: false,
  volume: 0.8,
  playbackRate: 1,
  captionScale: "md",
  captionsVisible: true,
  captionMode: "both",
  clozeAmount: 2,
  activatePlayer: (activePlayerId) => set({ activePlayerId }),
  releasePlayer: (playerId) => set((state) => (
    state.activePlayerId === playerId ? { activePlayerId: null } : state
  )),
  setMuted: (muted) => set({ muted }),
  setVolume: (volume) => {
    if (!Number.isFinite(volume)) return;
    const safeVolume = Math.max(0, Math.min(1, volume));
    set((state) => ({
      volume: safeVolume,
      muted: safeVolume === 0 ? true : state.muted,
    }));
  },
  setPlaybackRate: (playbackRate) => {
    if (ALLOWED_PLAYBACK_RATES.has(playbackRate)) set({ playbackRate });
  },
  setCaptionScale: (captionScale) => set({ captionScale }),
  setCaptionsVisible: (captionsVisible) => set({ captionsVisible }),
  setCaptionMode: (captionMode) => set({ captionMode }),
  setClozeAmount: (clozeAmount) => set({ clozeAmount }),
}));
