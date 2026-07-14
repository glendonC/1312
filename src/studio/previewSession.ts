const YOUTUBE_HOSTS = new Set(["youtube.com", "m.youtube.com", "youtu.be"]);

export interface SourcePresentation {
  kind: "youtube" | "web";
  displayUrl: string;
  compactUrl?: string;
  accessibleName: string;
}

export interface PreviewSource extends SourcePresentation {
  raw: string;
}

/**
 * UI-only context for exercising Studio with the recorded replay. It is deliberately
 * separate from RunBundle so a submitted URL can never be mistaken for recorded evidence.
 */
export interface StudioPreviewSession {
  mode: "submitted_source";
  dataSource: "recorded_run";
  source: PreviewSource;
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

export function createStudioPreviewSession(raw: string): StudioPreviewSession | null {
  const trimmed = raw.trim();
  const presentation = presentSource(trimmed);
  if (!presentation) return null;

  return {
    mode: "submitted_source",
    dataSource: "recorded_run",
    source: { ...presentation, raw: trimmed },
  };
}
