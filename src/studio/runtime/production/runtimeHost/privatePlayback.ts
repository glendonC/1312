import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";

import { ContentAddressedArtifactStore } from "../artifactStore.ts";
import type { RuntimeArtifact } from "../model.ts";
import type { BrowserPlaybackMimeType } from "../runStart/sourceSessionLoader.ts";
import { RuntimeHostError } from "./errors.ts";
import { readValidatedRuntimeJournal } from "./journalPolling.ts";
import type {
  PrivatePlaybackMimeType,
  RuntimeHostPrivatePlaybackGrant,
  RuntimeHostPrivatePlaybackGrantRequest,
  RuntimeHostPrivatePlaybackGrantRevocationResponse,
  RuntimeHostStatus,
} from "./model.ts";
import { PRIVATE_PLAYBACK_GRANT_TTL_MS, PRIVATE_PLAYBACK_MIME_TYPES } from "./model.ts";
import { DurableRuntimeCommandStore } from "./commandStore.ts";
import { RuntimeSourceRegistry } from "./sourceRegistry.ts";

export const MAXIMUM_ACTIVE_PRIVATE_PLAYBACK_GRANTS = 64;

interface StoredPrivatePlaybackGrant {
  grant: Omit<RuntimeHostPrivatePlaybackGrant, "mediaPath">;
  origin: string;
  secretDigest: Buffer;
  state: "active" | "revoked";
}

export interface PrivatePlaybackMediaResource {
  path: string;
  bytes: number;
  contentId: string;
  mimeType: PrivatePlaybackMimeType;
}

export interface PrivatePlaybackByteRange {
  start: number;
  end: number;
}

interface ClosedPlaybackSource {
  artifact: RuntimeArtifact;
  path: string;
  mimeType: PrivatePlaybackMimeType;
  status: RuntimeHostStatus;
}

function digestSecret(secret: string): Buffer {
  return createHash("sha256").update(secret, "utf8").digest();
}

function exactObject(value: unknown, fields: readonly string[], code: string, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new RuntimeHostError(code, `${label} must be an object.`);
  }
  const item = value as Record<string, unknown>;
  const expected = new Set(fields);
  if (Object.keys(item).some((field) => !expected.has(field)) || fields.some((field) => !(field in item))) {
    throw new RuntimeHostError(code, `${label} contains missing or unsupported fields.`);
  }
  return item;
}

function stableIdentity(value: unknown, code: string, label: string): string {
  if (
    typeof value !== "string" || value.length === 0 || value.trim() !== value || value.length > 160 ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value)
  ) throw new RuntimeHostError(code, `${label} is invalid.`);
  return value;
}

function contentIdentity(value: unknown, code: string, label: string): string {
  if (typeof value !== "string" || !/^sha256:[a-f0-9]{64}$/.test(value)) {
    throw new RuntimeHostError(code, `${label} is invalid.`);
  }
  return value;
}

function parseGrantRequest(value: unknown): RuntimeHostPrivatePlaybackGrantRequest {
  const code = "invalid_private_playback_grant_request";
  const item = exactObject(value, ["schema", "source"], code, "Private playback grant request");
  if (item.schema !== "studio.private-playback-grant-request.v1") {
    throw new RuntimeHostError(code, "Private playback grant request schema is unsupported.");
  }
  const source = exactObject(
    item.source,
    ["revisionId", "artifactId", "contentId"],
    code,
    "Private playback source identity",
  );
  return {
    schema: "studio.private-playback-grant-request.v1",
    source: {
      revisionId: stableIdentity(source.revisionId, code, "Source revision identity"),
      artifactId: stableIdentity(source.artifactId, code, "Source artifact identity"),
      contentId: contentIdentity(source.contentId, code, "Source content identity"),
    },
  };
}

function parseRevocationRequest(value: unknown): void {
  const code = "invalid_private_playback_revocation";
  const item = exactObject(value, ["schema"], code, "Private playback revocation request");
  if (item.schema !== "studio.private-playback-grant-revocation.v1") {
    throw new RuntimeHostError(code, "Private playback revocation schema is unsupported.");
  }
}

function privatePlaybackMimeType(value: BrowserPlaybackMimeType | null): PrivatePlaybackMimeType | null {
  return value !== null && (PRIVATE_PLAYBACK_MIME_TYPES as readonly string[]).includes(value) ? value : null;
}

function rangeFailure(): never {
  throw new RuntimeHostError(
    "invalid_private_playback_range",
    "Private playback accepts one satisfiable byte range.",
    416,
  );
}

export function parsePrivatePlaybackRange(value: string | undefined, bytes: number): PrivatePlaybackByteRange | null {
  if (!Number.isSafeInteger(bytes) || bytes <= 0) rangeFailure();
  if (value === undefined) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(value);
  if (!match || (match[1] === "" && match[2] === "")) rangeFailure();
  if (match[1] === "") {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) rangeFailure();
    return { start: Math.max(0, bytes - suffix), end: bytes - 1 };
  }
  const start = Number(match[1]);
  if (!Number.isSafeInteger(start) || start < 0 || start >= bytes) rangeFailure();
  if (match[2] === "") return { start, end: bytes - 1 };
  const requestedEnd = Number(match[2]);
  if (!Number.isSafeInteger(requestedEnd) || requestedEnd < start) rangeFailure();
  return { start, end: Math.min(requestedEnd, bytes - 1) };
}

/** Host-owned, in-memory private media grants and cold source closure. */
export class RuntimePrivatePlaybackService {
  private readonly store: DurableRuntimeCommandStore;
  private readonly sources: RuntimeSourceRegistry;
  private readonly status: (runtimeId: string) => Promise<RuntimeHostStatus>;
  private readonly now: () => Date;
  private readonly grants = new Map<string, StoredPrivatePlaybackGrant>();

  constructor(options: {
    store: DurableRuntimeCommandStore;
    sources: RuntimeSourceRegistry;
    status: (runtimeId: string) => Promise<RuntimeHostStatus>;
    now?: () => Date;
  }) {
    this.store = options.store;
    this.sources = options.sources;
    this.status = options.status;
    this.now = options.now ?? (() => new Date());
  }

  private activeGrantCount(nowMs: number): number {
    let active = 0;
    for (const stored of this.grants.values()) {
      if (stored.state === "active" && Date.parse(stored.grant.expiresAt) > nowMs) active += 1;
    }
    return active;
  }

  private async closeSource(
    runtimeId: string,
    expected: { revisionId: string; artifactId: string; contentId: string },
  ): Promise<ClosedPlaybackSource> {
    const status = await this.status(runtimeId);
    const start = status.runStartReceipt?.record;
    if (!start) {
      throw new RuntimeHostError(
        "private_playback_source_unavailable",
        "The runtime has no cold-validated source authority for private playback.",
        409,
      );
    }
    if (
      start.runtimeId !== runtimeId ||
      start.sourceSession.revisionId !== expected.revisionId ||
      start.sourceArtifactId !== expected.artifactId ||
      start.sourceSession.source.contentId !== expected.contentId ||
      start.analysisRequest.sourceContentId !== expected.contentId
    ) {
      throw new RuntimeHostError(
        "private_playback_source_mismatch",
        "The requested private playback source does not match the runtime authority.",
        409,
      );
    }
    const paths = this.store.paths(runtimeId);
    const journal = await readValidatedRuntimeJournal(paths.journalPath, runtimeId);
    const artifact = journal.state.artifacts[expected.artifactId];
    if (
      !artifact || artifact.runId !== runtimeId || artifact.kind !== "source-media" ||
      artifact.mediaClass !== "raw" || artifact.origin.kind !== "ingest" ||
      artifact.sourceArtifactIds.length !== 0 || artifact.content.contentId !== expected.contentId ||
      artifact.content.bytes !== start.sourceSession.source.bytes ||
      artifact.durationMs !== start.sourceSession.source.durationMs
    ) {
      throw new RuntimeHostError(
        "stored_content_inconsistent",
        "The runtime source artifact no longer closes to its stored playback authority.",
        409,
      );
    }
    const loaded = await this.sources.resolve(start.sourceSession.sessionId, expected.revisionId);
    const mimeType = privatePlaybackMimeType(loaded.playbackMimeType);
    if (
      loaded.session.source.contentId !== expected.contentId ||
      loaded.session.source.bytes !== artifact.content.bytes ||
      loaded.session.source.durationMs !== artifact.durationMs ||
      loaded.descriptor.content.contentId !== expected.contentId ||
      loaded.descriptor.content.bytes !== artifact.content.bytes
    ) {
      throw new RuntimeHostError(
        "private_playback_source_mismatch",
        "The registered source revision no longer matches the runtime playback artifact.",
        409,
      );
    }
    if (!mimeType) {
      throw new RuntimeHostError(
        "private_playback_mime_unsupported",
        "The validated source container has no accepted browser playback MIME type.",
        415,
      );
    }
    let path: string;
    try {
      path = await new ContentAddressedArtifactStore(paths.artifactStoreRoot).resolveVerified(artifact);
    } catch (error) {
      throw new RuntimeHostError(
        "stored_content_inconsistent",
        "The private playback source bytes failed cold content revalidation.",
        409,
        { cause: error },
      );
    }
    return { artifact, path, mimeType, status };
  }

  async create(
    runtimeId: string,
    value: unknown,
    origin: string,
  ): Promise<RuntimeHostPrivatePlaybackGrant> {
    const request = parseGrantRequest(value);
    const closed = await this.closeSource(runtimeId, request.source);
    const now = this.now();
    if (this.activeGrantCount(now.getTime()) >= MAXIMUM_ACTIVE_PRIVATE_PLAYBACK_GRANTS) {
      throw new RuntimeHostError(
        "private_playback_grant_capacity",
        "The private playback grant capacity is exhausted.",
        429,
      );
    }
    const grantId = `private-playback-grant:${randomUUID()}`;
    const secret = randomBytes(32).toString("base64url");
    const expiresAt = new Date(now.getTime() + PRIVATE_PLAYBACK_GRANT_TTL_MS).toISOString();
    const start = closed.status.runStartReceipt!.record;
    const grant: RuntimeHostPrivatePlaybackGrant = {
      schema: "studio.private-playback-grant.v1",
      grantId,
      runtimeId,
      source: {
        sessionId: start.sourceSession.sessionId,
        revisionId: start.sourceSession.revisionId,
        artifactId: closed.artifact.id,
        contentId: closed.artifact.content.contentId,
        bytes: closed.artifact.content.bytes,
        durationMs: closed.artifact.durationMs!,
      },
      mimeType: closed.mimeType,
      timestampOrigin: { kind: "source_media_zero", offsetMs: 0 },
      mediaPath: `/v1/private-source-media/${encodeURIComponent(grantId)}/${secret}`,
      issuedAt: now.toISOString(),
      expiresAt,
    };
    const { mediaPath: _discardedSecretPath, ...storedGrant } = grant;
    this.grants.set(grantId, {
      grant: storedGrant,
      origin,
      secretDigest: digestSecret(secret),
      state: "active",
    });
    return structuredClone(grant);
  }

  async revoke(
    runtimeId: string,
    grantId: string,
    value: unknown,
    origin: string,
  ): Promise<RuntimeHostPrivatePlaybackGrantRevocationResponse> {
    parseRevocationRequest(value);
    const stored = this.grants.get(grantId);
    const now = this.now();
    if (
      !stored || stored.grant.runtimeId !== runtimeId || stored.origin !== origin ||
      stored.state !== "active" || Date.parse(stored.grant.expiresAt) <= now.getTime()
    ) {
      throw new RuntimeHostError(
        "private_playback_grant_unavailable",
        "The private playback grant is unavailable.",
        404,
      );
    }
    stored.state = "revoked";
    return {
      schema: "studio.private-playback-grant-revoked.v1",
      grantId,
      runtimeId,
      state: "revoked",
      revokedAt: now.toISOString(),
    };
  }

  async media(grantId: string, secret: string, origin: string): Promise<PrivatePlaybackMediaResource> {
    const stored = this.grants.get(grantId);
    if (
      !stored || !/^[A-Za-z0-9_-]{43}$/.test(secret) ||
      !timingSafeEqual(stored.secretDigest, digestSecret(secret))
    ) {
      throw new RuntimeHostError(
        "private_playback_grant_unavailable",
        "The private playback grant is unavailable.",
        404,
      );
    }
    if (stored.origin !== origin) {
      throw new RuntimeHostError("origin_not_allowed", "The request origin is not allowed.", 403);
    }
    if (stored.state !== "active" || Date.parse(stored.grant.expiresAt) <= this.now().getTime()) {
      throw new RuntimeHostError(
        "private_playback_grant_expired",
        "The private playback grant expired or was revoked.",
        410,
      );
    }
    const closed = await this.closeSource(stored.grant.runtimeId, {
      revisionId: stored.grant.source.revisionId,
      artifactId: stored.grant.source.artifactId,
      contentId: stored.grant.source.contentId,
    });
    return {
      path: closed.path,
      bytes: closed.artifact.content.bytes,
      contentId: closed.artifact.content.contentId,
      mimeType: closed.mimeType,
    };
  }
}
