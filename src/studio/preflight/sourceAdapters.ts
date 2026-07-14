import type { RunBundle } from "../transport";
import type { MediaProbeTrack, YouTubeIngestReceipt } from "../types";

/** Provider-neutral facts consumed by preflight. Provider wire fields stop at this adapter. */
export interface RecordedSourceFacts {
  producer: string;
  title: string;
  creator: string | null;
  locator: {
    kind: string;
    url: string | null;
    externalId: string | null;
  };
  rights: {
    basis: "redistribution_licence";
    label: string;
    attribution: string;
  };
  selection: {
    sourceStart: string;
    sourceEnd: string;
    duration: number;
  };
  playableMedia: boolean;
  waveformSamples: number;
  mediaProbe: {
    producer: string;
    container: string[];
    tracks: MediaProbeTrack[];
  } | null;
  /** This is the job declaration, not output from a language detector. */
  declaredLanguage: string;
}

interface ReceiptAdapter<Receipt> {
  kind: string;
  producer: string;
  normalize(receipt: Receipt, bundle: RunBundle): RecordedSourceFacts;
}

interface UrlSourceAdapter {
  kind: string;
  producer: string;
  acceptsUrl(url: URL): boolean;
}

const YOUTUBE_HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"]);

const youtubeReceiptAdapter: ReceiptAdapter<YouTubeIngestReceipt> = {
  kind: "youtube",
  producer: "scripts/ingest-clip.mjs",
  normalize: (receipt, bundle) => ({
    producer: "scripts/ingest-clip.mjs",
    title: receipt.label,
    creator: receipt.channel,
    locator: { kind: receipt.kind, url: receipt.url, externalId: receipt.video_id },
    rights: {
      basis: "redistribution_licence",
      label: receipt.licence,
      attribution: receipt.attribution,
    },
    selection: {
      sourceStart: receipt.window.start,
      sourceEnd: receipt.window.end,
      duration: receipt.duration,
    },
    playableMedia: bundle.run.clip.media !== null,
    waveformSamples: bundle.wave.peaks.length,
    mediaProbe: bundle.mediaProbe
      ? {
          producer: bundle.mediaProbe.producer,
          container: bundle.mediaProbe.container,
          tracks: bundle.mediaProbe.tracks,
        }
      : null,
    declaredLanguage: bundle.run.clip.lang,
  }),
};

const URL_ADAPTERS: readonly UrlSourceAdapter[] = [
  {
    kind: "youtube",
    producer: youtubeReceiptAdapter.producer,
    acceptsUrl: (url) => YOUTUBE_HOSTS.has(url.hostname),
  },
];

export function normalizeIngestReceipt(bundle: RunBundle): RecordedSourceFacts | null {
  const receipt = bundle.ingestReceipt;
  if (!receipt) return null;
  if (receipt.kind === "youtube") return youtubeReceiptAdapter.normalize(receipt, bundle);
  return null;
}

export type SourceUrlClassification =
  | { kind: "invalid"; label: string }
  | { kind: "unsupported"; label: string }
  | { kind: "supported"; adapter: string; producer: string };

export function classifySourceUrl(raw: string): SourceUrlClassification {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return { kind: "invalid", label: "Enter a complete http or https link." };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { kind: "invalid", label: "Enter a complete http or https link." };
  }
  const adapter = URL_ADAPTERS.find((candidate) => candidate.acceptsUrl(url));
  if (!adapter) return { kind: "unsupported", label: `${url.hostname} has no registered source adapter.` };
  return { kind: "supported", adapter: adapter.kind, producer: adapter.producer };
}
