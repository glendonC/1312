import type { ClipSource, IngestReceipt } from "./types";

const YOUTUBE_HOSTS = new Set(["youtube.com", "m.youtube.com", "youtu.be"]);

export interface SourcePresentation {
  kind: "youtube" | "web";
  displayUrl: string;
  compactUrl?: string;
  accessibleName: string;
}

export function presentSource(raw: string): SourcePresentation | null {
  let source: URL;

  try {
    source = new URL(raw.trim());
  } catch {
    return null;
  }

  if (source.protocol !== "https:" && source.protocol !== "http:") return null;

  const host = source.hostname.toLowerCase().replace(/^www\./, "");
  const pathParts = source.pathname.split("/").filter(Boolean);

  if (YOUTUBE_HOSTS.has(host)) {
    const videoId = host === "youtu.be"
      ? pathParts[0]
      : source.searchParams.get("v")
        ?? (["embed", "live", "shorts"].includes(pathParts[0] ?? "") ? pathParts[1] : undefined);

    if (videoId) {
      return {
        kind: "youtube",
        displayUrl: `youtube.com/watch?v=${videoId}`,
        compactUrl: `youtu.be/${videoId}`,
        accessibleName: `YouTube video link ${videoId}`,
      };
    }
  }

  let path = source.pathname;
  try {
    path = decodeURI(path);
  } catch {
    // Keep the encoded path when a valid URL contains an incomplete escape sequence.
  }
  path = path.replace(/\/$/, "");
  const identifier = path || "Home";

  return {
    kind: "web",
    displayUrl: `${host}${identifier === "Home" ? "" : identifier}`,
    accessibleName: `Web source ${host} ${identifier}`,
  };
}

/**
 * Name a recorded source from its producer-backed receipt when one exists.
 */
export function presentRecordedSource(
  source: ClipSource,
  receipt?: IngestReceipt | null,
): SourcePresentation | null {
  const normalized = source.url ? presentSource(source.url) : null;

  if (
    receipt?.kind === "youtube"
    && receipt.url === source.url
    && normalized?.kind === "youtube"
  ) {
    return {
      ...normalized,
      displayUrl: receipt.label,
      accessibleName: `YouTube source ${receipt.label}`,
    };
  }

  if (normalized) return normalized;

  const label = receipt?.kind === "owned_local" ? receipt.label.trim() : source.label.trim();
  if (!label) return null;

  return {
    kind: "web",
    displayUrl: label,
    accessibleName: `${receipt?.kind === "owned_local" ? "Local" : "Recorded"} source ${label}`,
  };
}
