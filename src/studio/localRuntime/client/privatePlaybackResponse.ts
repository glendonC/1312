import {
  PRIVATE_PLAYBACK_GRANT_TTL_MS,
  PRIVATE_PLAYBACK_MIME_TYPES,
  type PrivatePlaybackMimeType,
  type RuntimeHostPrivatePlaybackGrant,
  type RuntimeHostPrivatePlaybackGrantRevocationResponse,
} from "../../runtime/production/runtimeHost/model.ts";
import {
  contentId,
  exact,
  fail,
  identity,
  integer,
  object,
  string,
  timestamp,
} from "./responseGuards.ts";

export interface PrivatePlaybackExpectation {
  runtimeId: string;
  sourceRevisionId: string;
  sourceArtifactId: string;
  sourceContentId: string;
}

export interface PrivatePlaybackHandle {
  readonly schema: "studio.private-playback-handle.v1";
  readonly grantId: string;
  readonly runtimeId: string;
  readonly source: RuntimeHostPrivatePlaybackGrant["source"];
  readonly mimeType: PrivatePlaybackMimeType;
  readonly timestampOrigin: { kind: "source_media_zero"; offsetMs: 0 };
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly src: string | null;
  readonly disposed: boolean;
  dispose(): Promise<void>;
}

export type PrivatePlaybackRevoke = (
  runtimeId: string,
  grantId: string,
) => Promise<RuntimeHostPrivatePlaybackGrantRevocationResponse>;

function playbackMimeType(value: unknown): PrivatePlaybackMimeType {
  if (typeof value !== "string" || !(PRIVATE_PLAYBACK_MIME_TYPES as readonly string[]).includes(value)) {
    fail("Private playback grant mimeType", "has an unsupported browser media type.");
  }
  return value as PrivatePlaybackMimeType;
}

function validatedMediaUrl(baseUrl: string, mediaPathValue: unknown, grantId: string): string {
  const mediaPath = string(mediaPathValue, "Private playback grant mediaPath");
  if (!mediaPath.startsWith("/") || mediaPath.includes("?") || mediaPath.includes("#")) {
    fail("Private playback grant mediaPath", "must be a query-free same-host absolute path.");
  }
  let url: URL;
  try {
    url = new URL(mediaPath, baseUrl);
  } catch {
    fail("Private playback grant mediaPath", "is not a valid URL path.");
  }
  if (url.origin !== baseUrl || url.pathname !== mediaPath || url.search || url.hash || url.username || url.password) {
    fail("Private playback grant mediaPath", "must remain on the exact runtime-host origin.");
  }
  const match = /^\/v1\/private-source-media\/([^/]+)\/([A-Za-z0-9_-]{43})$/.exec(url.pathname);
  if (!match) fail("Private playback grant mediaPath", "does not match the private media route.");
  let decodedGrantId: string;
  try {
    decodedGrantId = decodeURIComponent(match[1]);
  } catch {
    fail("Private playback grant mediaPath", "contains a malformed grant identity.");
  }
  if (decodedGrantId !== grantId || encodeURIComponent(grantId) !== match[1]) {
    fail("Private playback grant mediaPath", "does not close to the returned grant identity.");
  }
  return url.href;
}

class ValidatedPrivatePlaybackHandle implements PrivatePlaybackHandle {
  readonly schema = "studio.private-playback-handle.v1" as const;
  readonly grantId: string;
  readonly runtimeId: string;
  readonly source: RuntimeHostPrivatePlaybackGrant["source"];
  readonly mimeType: PrivatePlaybackMimeType;
  readonly timestampOrigin = { kind: "source_media_zero", offsetMs: 0 } as const;
  readonly issuedAt: string;
  readonly expiresAt: string;
  private mediaSource: string | null;
  private readonly revoke: PrivatePlaybackRevoke;
  private disposal: Promise<void> | null = null;

  constructor(grant: RuntimeHostPrivatePlaybackGrant, src: string, revoke: PrivatePlaybackRevoke) {
    this.grantId = grant.grantId;
    this.runtimeId = grant.runtimeId;
    this.source = structuredClone(grant.source);
    this.mimeType = grant.mimeType;
    this.issuedAt = grant.issuedAt;
    this.expiresAt = grant.expiresAt;
    this.mediaSource = src;
    this.revoke = revoke;
  }

  get src(): string | null {
    return this.mediaSource;
  }

  get disposed(): boolean {
    return this.mediaSource === null;
  }

  dispose(): Promise<void> {
    if (this.disposal) return this.disposal;
    this.mediaSource = null;
    this.disposal = this.revoke(this.runtimeId, this.grantId).then(() => undefined);
    return this.disposal;
  }
}

export function privatePlaybackGrantResponse(
  value: unknown,
  options: {
    baseUrl: string;
    expected: PrivatePlaybackExpectation;
    revoke: PrivatePlaybackRevoke;
    now?: () => Date;
  },
): PrivatePlaybackHandle {
  const item = object(value, "Private playback grant");
  exact(item, [
    "schema", "grantId", "runtimeId", "source", "mimeType", "timestampOrigin", "mediaPath", "issuedAt", "expiresAt",
  ], "Private playback grant");
  if (item.schema !== "studio.private-playback-grant.v1") {
    fail("Private playback grant", "schema is unsupported.");
  }
  const source = object(item.source, "Private playback grant source");
  exact(source, ["sessionId", "revisionId", "artifactId", "contentId", "bytes", "durationMs"], "Private playback grant source");
  const timestampOrigin = object(item.timestampOrigin, "Private playback timestamp origin");
  exact(timestampOrigin, ["kind", "offsetMs"], "Private playback timestamp origin");
  if (timestampOrigin.kind !== "source_media_zero" || timestampOrigin.offsetMs !== 0) {
    fail("Private playback timestamp origin", "must be exact full-source time zero.");
  }
  const grant: RuntimeHostPrivatePlaybackGrant = {
    schema: "studio.private-playback-grant.v1",
    grantId: identity(item.grantId, "Private playback grant id"),
    runtimeId: identity(item.runtimeId, "Private playback runtime id"),
    source: {
      sessionId: identity(source.sessionId, "Private playback source session id"),
      revisionId: identity(source.revisionId, "Private playback source revision id"),
      artifactId: identity(source.artifactId, "Private playback source artifact id"),
      contentId: contentId(source.contentId, "Private playback source content id"),
      bytes: integer(source.bytes, "Private playback source bytes", 1),
      durationMs: integer(source.durationMs, "Private playback source duration", 1),
    },
    mimeType: playbackMimeType(item.mimeType),
    timestampOrigin: { kind: "source_media_zero", offsetMs: 0 },
    mediaPath: string(item.mediaPath, "Private playback media path"),
    issuedAt: timestamp(item.issuedAt, "Private playback issue time"),
    expiresAt: timestamp(item.expiresAt, "Private playback expiry time"),
  };
  if (
    grant.runtimeId !== options.expected.runtimeId ||
    grant.source.revisionId !== options.expected.sourceRevisionId ||
    grant.source.artifactId !== options.expected.sourceArtifactId ||
    grant.source.contentId !== options.expected.sourceContentId
  ) fail("Private playback grant", "runtime or source identities do not match the requested authority.");
  const issuedAt = Date.parse(grant.issuedAt);
  const expiresAt = Date.parse(grant.expiresAt);
  const now = (options.now ?? (() => new Date()))().getTime();
  if (
    expiresAt - issuedAt !== PRIVATE_PLAYBACK_GRANT_TTL_MS ||
    issuedAt > now + 5_000 || expiresAt <= now
  ) fail("Private playback grant", "issue or expiry time is outside the accepted lifetime.");
  const src = validatedMediaUrl(options.baseUrl, grant.mediaPath, grant.grantId);
  return new ValidatedPrivatePlaybackHandle(grant, src, options.revoke);
}

export function privatePlaybackRevocationResponse(
  value: unknown,
  runtimeId: string,
  grantId: string,
): RuntimeHostPrivatePlaybackGrantRevocationResponse {
  const item = object(value, "Private playback revocation");
  exact(item, ["schema", "grantId", "runtimeId", "state", "revokedAt"], "Private playback revocation");
  if (
    item.schema !== "studio.private-playback-grant-revoked.v1" || item.state !== "revoked" ||
    identity(item.runtimeId, "Private playback revoked runtime id") !== runtimeId ||
    identity(item.grantId, "Private playback revoked grant id") !== grantId
  ) fail("Private playback revocation", "does not close to the disposed grant.");
  return {
    schema: "studio.private-playback-grant-revoked.v1",
    grantId,
    runtimeId,
    state: "revoked",
    revokedAt: timestamp(item.revokedAt, "Private playback revocation time"),
  };
}
