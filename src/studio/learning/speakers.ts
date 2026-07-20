import type { SpeakerRef } from "../types";

/**
 * How a recorded speaker is shown: the clip's own label, a short display form of it, and a stable
 * color index from the speaker's position in the clip legend. Presentation of recorded diarization
 * only; a speaker id with no legend entry gets no display, never an invented identity.
 */
export interface SpeakerDisplay {
  id: string;
  label: string;
  shortLabel: string;
  colorIndex: number;
}

export function speakerDisplays(
  legend: readonly SpeakerRef[] | undefined,
  ids: readonly string[] | undefined,
): SpeakerDisplay[] {
  if (!legend || !ids) return [];
  const displays: SpeakerDisplay[] = [];
  for (const id of ids) {
    const index = legend.findIndex((speaker) => speaker.id === id);
    if (index < 0) continue;
    const label = legend[index].label;
    // Recorded labels may carry a provenance suffix ("speaker A · diarized"); the chip shows the
    // name and keeps the full recorded label on the title.
    const shortLabel = label.split("·")[0].trim() || id;
    displays.push({ id, label, shortLabel, colorIndex: index % 6 });
  }
  return displays;
}
