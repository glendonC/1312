import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { ContentAddressedArtifactStore } from "../src/studio/runtime/production/artifactStore.ts";
import {
  PRIVATE_PLAYBACK_GRANT_TTL_MS,
  type RuntimeHostPrivatePlaybackGrant,
} from "../src/studio/runtime/production/runtimeHost/model.ts";
import {
  RuntimePrivatePlaybackService,
  parsePrivatePlaybackRange,
} from "../src/studio/runtime/production/runtimeHost/privatePlayback.ts";
import {
  createRuntimeHostHttpServer,
  listenRuntimeHost,
} from "../src/studio/runtime/production/runtimeHost/httpServer.ts";
import { readValidatedRuntimeJournal } from "../src/studio/runtime/production/runtimeHost/journalPolling.ts";
import { browserPlaybackMimeType } from "../src/studio/runtime/production/runStart/sourceSessionLoader.ts";
import type { MediaProbeReceipt } from "../src/studio/types.ts";
import { cleanup, FIXTURE, hostHarness, waitForLifecycle } from "./studio/runtime-host/harness.ts";

const TOKEN = "t".repeat(64);
const ORIGIN = "http://127.0.0.1:4321";

function probe(container: string[], tracks: MediaProbeReceipt["tracks"]): MediaProbeReceipt {
  return { container, tracks } as MediaProbeReceipt;
}

function splitMediaPath(path: string): { grantId: string; secret: string } {
  const match = /^\/v1\/private-source-media\/([^/]+)\/([^/]+)$/.exec(path);
  assert.ok(match);
  return { grantId: decodeURIComponent(match[1]), secret: match[2] };
}

test("private playback range and MIME policy are closed and deterministic", () => {
  assert.deepEqual(parsePrivatePlaybackRange(undefined, 10), null);
  assert.deepEqual(parsePrivatePlaybackRange("bytes=0-0", 10), { start: 0, end: 0 });
  assert.deepEqual(parsePrivatePlaybackRange("bytes=2-", 10), { start: 2, end: 9 });
  assert.deepEqual(parsePrivatePlaybackRange("bytes=-3", 10), { start: 7, end: 9 });
  assert.deepEqual(parsePrivatePlaybackRange("bytes=8-99", 10), { start: 8, end: 9 });
  for (const value of ["bytes=-0", "bytes=", "bytes=10-", "bytes=4-3", "bytes=0-1,4-5", "items=0-1"]) {
    assert.throws(() => parsePrivatePlaybackRange(value, 10), /one satisfiable byte range/);
  }

  assert.equal(browserPlaybackMimeType(probe(["mov", "mp4", "m4a", "3gp", "3g2", "mj2"], [
    { index: 0, type: "audio", codec: "aac" },
  ])), "audio/mp4");
  assert.equal(browserPlaybackMimeType(probe(["matroska", "webm"], [
    { index: 0, type: "video", codec: "vp9" },
    { index: 1, type: "audio", codec: "opus" },
  ])), "video/webm");
  assert.equal(browserPlaybackMimeType(probe(["matroska"], [
    { index: 0, type: "video", codec: "h264" },
  ])), null);
  assert.equal(browserPlaybackMimeType(probe(["mp3", "ogg"], [
    { index: 0, type: "audio", codec: "mp3" },
  ])), null);
  assert.equal(browserPlaybackMimeType(probe(["mp3"], [
    { index: 0, type: "data", codec: "bin" },
  ])), null);
});

test("HTTP private playback mints exact grants and serves cold-verified full and ranged bytes", async () => {
  const runtime = await hostHarness();
  const server = createRuntimeHostHttpServer({
    service: runtime.service,
    token: TOKEN,
    allowedOrigins: [ORIGIN],
  });
  try {
    const acknowledgement = await runtime.service.start(runtime.request);
    await waitForLifecycle(runtime.service, acknowledgement.commandId, "terminal");
    const status = await runtime.service.statusByRuntime(acknowledgement.runtimeId);
    const start = status.runStartReceipt?.record;
    assert.ok(start);
    const request = {
      schema: "studio.private-playback-grant-request.v1",
      source: {
        revisionId: start.sourceSession.revisionId,
        artifactId: start.sourceArtifactId,
        contentId: start.sourceSession.source.contentId,
      },
    };
    const address = await listenRuntimeHost(server, { port: 0 });
    const base = `http://${address.host}:${address.port}`;
    const grantRoute = `${base}/v1/runtimes/${encodeURIComponent(status.runtimeId)}/private-playback-grants`;
    const authorized = {
      Authorization: `Bearer ${TOKEN}`,
      Origin: ORIGIN,
      "Content-Type": "application/json",
    };

    assert.equal((await fetch(grantRoute, {
      method: "POST",
      headers: { Origin: ORIGIN, "Content-Type": "application/json" },
      body: JSON.stringify(request),
    })).status, 401);
    assert.equal((await fetch(grantRoute, {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify(request),
    })).status, 403);
    for (const source of [
      { ...request.source, revisionId: "source-revision:wrong" },
      { ...request.source, artifactId: "artifact:wrong" },
      { ...request.source, contentId: `sha256:${"0".repeat(64)}` },
    ]) {
      assert.equal((await fetch(grantRoute, {
        method: "POST",
        headers: authorized,
        body: JSON.stringify({ ...request, source }),
      })).status, 409);
    }

    const minted = await fetch(grantRoute, {
      method: "POST",
      headers: authorized,
      body: JSON.stringify(request),
    });
    assert.equal(minted.status, 201);
    assert.equal(minted.headers.get("cache-control"), "no-store");
    const grant = await minted.json() as RuntimeHostPrivatePlaybackGrant;
    assert.equal(grant.schema, "studio.private-playback-grant.v1");
    assert.equal(grant.runtimeId, status.runtimeId);
    assert.equal(grant.source.artifactId, start.sourceArtifactId);
    assert.equal(grant.source.contentId, start.sourceSession.source.contentId);
    assert.equal(grant.mimeType, "audio/mp4");
    assert.deepEqual(grant.timestampOrigin, { kind: "source_media_zero", offsetMs: 0 });
    assert.equal(Date.parse(grant.expiresAt) - Date.parse(grant.issuedAt), PRIVATE_PLAYBACK_GRANT_TTL_MS);
    assert.doesNotMatch(grant.mediaPath, /(?:runtime:|artifact:|sha256:|token|\?|#|\/tmp\/)/);

    const sourceBytes = await readFile(join(FIXTURE, "clip.m4a"));
    const mediaUrl = `${base}${grant.mediaPath}`;
    const full = await fetch(mediaUrl, { headers: { Origin: ORIGIN } });
    assert.equal(full.status, 200);
    assert.equal(full.headers.get("content-type"), "audio/mp4");
    assert.equal(full.headers.get("content-length"), sourceBytes.byteLength.toString());
    assert.equal(full.headers.get("accept-ranges"), "bytes");
    assert.equal(full.headers.get("cache-control"), "private, no-store, max-age=0");
    assert.equal(full.headers.get("access-control-allow-origin"), ORIGIN);
    assert.equal(full.headers.get("content-encoding"), null);
    assert.deepEqual(Buffer.from(await full.arrayBuffer()), sourceBytes);

    const prefix = await fetch(mediaUrl, { headers: { Origin: ORIGIN, Range: "bytes=0-7" } });
    assert.equal(prefix.status, 206);
    assert.equal(prefix.headers.get("content-range"), `bytes 0-7/${sourceBytes.byteLength}`);
    assert.deepEqual(Buffer.from(await prefix.arrayBuffer()), sourceBytes.subarray(0, 8));

    const suffix = await fetch(mediaUrl, { headers: { Origin: ORIGIN, Range: "bytes=-5" } });
    assert.equal(suffix.status, 206);
    assert.deepEqual(Buffer.from(await suffix.arrayBuffer()), sourceBytes.subarray(-5));

    const head = await fetch(mediaUrl, { method: "HEAD", headers: { Origin: ORIGIN, Range: "bytes=2-9" } });
    assert.equal(head.status, 206);
    assert.equal(head.headers.get("content-length"), "8");
    assert.equal(await head.text(), "");

    const malformed = await fetch(mediaUrl, { headers: { Origin: ORIGIN, Range: "bytes=0-1,4-5" } });
    assert.equal(malformed.status, 416);
    assert.equal(malformed.headers.get("content-range"), `bytes */${sourceBytes.byteLength}`);
    assert.equal((await malformed.json() as { error: { code: string } }).error.code, "invalid_private_playback_range");

    assert.equal((await fetch(mediaUrl)).status, 403);
    assert.equal((await fetch(mediaUrl, { headers: { Origin: "http://evil.invalid" } })).status, 403);
    const { grantId, secret } = splitMediaPath(grant.mediaPath);
    const badSecretUrl = `${base}/v1/private-source-media/${encodeURIComponent(grantId)}/${"a".repeat(43)}`;
    assert.equal((await fetch(badSecretUrl, {
      headers: { Origin: ORIGIN, Authorization: `Bearer ${TOKEN}` },
    })).status, 404);
    assert.equal((await fetch(`${mediaUrl}?download=1`, { headers: { Origin: ORIGIN } })).status, 400);

    const revokeRoute = `${base}/v1/runtimes/${encodeURIComponent(status.runtimeId)}/private-playback-grants/${encodeURIComponent(grantId)}/revocations`;
    assert.equal((await fetch(revokeRoute, {
      method: "POST",
      headers: { Origin: ORIGIN, "Content-Type": "application/json" },
      body: JSON.stringify({ schema: "studio.private-playback-grant-revocation.v1" }),
    })).status, 401);
    const revoked = await fetch(revokeRoute, {
      method: "POST",
      headers: authorized,
      body: JSON.stringify({ schema: "studio.private-playback-grant-revocation.v1" }),
    });
    assert.equal(revoked.status, 200);
    assert.equal((await revoked.json() as { state: string }).state, "revoked");
    assert.equal((await fetch(mediaUrl, { headers: { Origin: ORIGIN } })).status, 410);
    assert.equal((await fetch(revokeRoute, {
      method: "POST",
      headers: authorized,
      body: JSON.stringify({ schema: "studio.private-playback-grant-revocation.v1" }),
    })).status, 404);
    assert.equal(secret.length, 43);

    const sources = await fetch(`${base}/v1/source-sessions`, { headers: { Origin: ORIGIN } });
    assert.equal(sources.status, 401, "the media exception must not weaken existing bearer routes");
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await cleanup(runtime);
  }
});

test("private playback grants expire, disappear across service restart, reject cross-origin replay, and fail on drift", async () => {
  const runtime = await hostHarness();
  try {
    const acknowledgement = await runtime.service.start(runtime.request);
    await waitForLifecycle(runtime.service, acknowledgement.commandId, "terminal");
    const status = await runtime.service.statusByRuntime(acknowledgement.runtimeId);
    const start = status.runStartReceipt?.record;
    assert.ok(start);
    let nowMs = Date.parse("2026-07-18T12:00:00.000Z");
    const service = new RuntimePrivatePlaybackService({
      store: runtime.store,
      sources: runtime.sources,
      status: (runtimeId) => runtime.service.statusByRuntime(runtimeId),
      now: () => new Date(nowMs),
    });
    const grant = await service.create(status.runtimeId, {
      schema: "studio.private-playback-grant-request.v1",
      source: {
        revisionId: start.sourceSession.revisionId,
        artifactId: start.sourceArtifactId,
        contentId: start.sourceSession.source.contentId,
      },
    }, ORIGIN);
    const presented = splitMediaPath(grant.mediaPath);
    const storedGrants = [...((service as unknown as {
      grants: Map<string, unknown>;
    }).grants).values()];
    assert.equal(JSON.stringify(storedGrants).includes(presented.secret), false, "the host stores only the secret digest");
    await assert.rejects(
      service.media(presented.grantId, presented.secret, "http://evil.invalid"),
      /origin is not allowed/,
    );
    assert.equal((await service.media(presented.grantId, presented.secret, ORIGIN)).bytes, grant.source.bytes);

    const restarted = new RuntimePrivatePlaybackService({
      store: runtime.store,
      sources: runtime.sources,
      status: (runtimeId) => runtime.service.statusByRuntime(runtimeId),
      now: () => new Date(nowMs),
    });
    await assert.rejects(
      restarted.media(presented.grantId, presented.secret, ORIGIN),
      /grant is unavailable/,
    );
    nowMs += PRIVATE_PLAYBACK_GRANT_TTL_MS;
    await assert.rejects(
      service.media(presented.grantId, presented.secret, ORIGIN),
      /expired or was revoked/,
    );

    nowMs -= PRIVATE_PLAYBACK_GRANT_TTL_MS;
    const fresh = await service.create(status.runtimeId, {
      schema: "studio.private-playback-grant-request.v1",
      source: {
        revisionId: start.sourceSession.revisionId,
        artifactId: start.sourceArtifactId,
        contentId: start.sourceSession.source.contentId,
      },
    }, ORIGIN);
    const freshPresented = splitMediaPath(fresh.mediaPath);
    const paths = runtime.store.paths(status.runtimeId);
    const journal = await readValidatedRuntimeJournal(paths.journalPath, status.runtimeId);
    const artifact = journal.state.artifacts[start.sourceArtifactId];
    assert.ok(artifact);
    const storedPath = await new ContentAddressedArtifactStore(paths.artifactStoreRoot).resolveVerified(artifact);
    await writeFile(storedPath, Buffer.from("tampered playback bytes"));
    await assert.rejects(
      service.media(freshPresented.grantId, freshPresented.secret, ORIGIN),
      /failed cold content revalidation/,
    );
  } finally {
    await cleanup(runtime);
  }
});
