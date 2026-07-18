import assert from "node:assert/strict";
import { copyFile, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import { resolveYouTubeSource } from "../../../scripts/lib/resolve-youtube-source.ts";
import {
  DurableRuntimeCommandStore,
  DeterministicRuntimeExecutor,
  RuntimeSourceRegistry,
  RuntimeStartService,
  YouTubeLocalIngestService,
  createRuntimeHostHttpServer,
  listenRuntimeHost,
} from "../../../src/studio/runtime/production/runtimeHost/index.ts";
import type {
  RuntimeHostStartRequest,
  YouTubeLocalIngestStatus,
} from "../../../src/studio/runtime/production/runtimeHost/model.ts";
import { runtimeIds, waitForLifecycle } from "./harness.ts";

const FIXTURE = resolve("public/demo/runs/run-005/clip.m4a");
const URL = "https://www.youtube.com/watch?v=LM02RealBytes";

function fakeResolution(raw: string) {
  return resolveYouTubeSource(raw, {
    now: () => new Date("2026-07-18T12:00:00.000Z"),
    command: async (_executable, args) => args.includes("--version")
      ? { stdout: "2026.07.04\n", stderr: "" }
      : {
          stdout: JSON.stringify({
            id: "LM02RealBytes",
            title: "Private YouTube local integration source",
            channel: "Integration channel",
            duration: 120,
          }),
          stderr: "",
        },
  });
}

test("YouTube-local ingest fails closed, seals real private bytes, and feeds the shared runtime spine", async () => {
  const directory = await mkdtemp(join(tmpdir(), "studio-youtube-local-ingest-test-"));
  const youtubeRoot = join(directory, "youtube-local-sources");
  const sources = await RuntimeSourceRegistry.open({ sourceDirectories: [] });
  const store = await DurableRuntimeCommandStore.open(join(directory, "runtime"));
  const executor = new DeterministicRuntimeExecutor();
  const service = await RuntimeStartService.open({
    store,
    sources,
    launcherFactory: executor.factory(),
    runtimeIdForCommand: runtimeIds(),
    recoverOnOpen: false,
  });
  const downloadCalls: Array<{ canonicalUrl: string; startMs: number; endMs: number; outputPath: string }> = [];
  const youtubeLocalIngest = await YouTubeLocalIngestService.open({
    root: youtubeRoot,
    repositoryRoot: resolve("."),
    sources,
    maximumRangeMs: 60_000,
    resolveSource: fakeResolution,
    download: async (input) => {
      downloadCalls.push(input);
      await copyFile(FIXTURE, input.outputPath);
    },
  });
  const token = "y".repeat(64);
  const origin = "http://127.0.0.1:4321";
  const server = createRuntimeHostHttpServer({
    service,
    youtubeLocalIngest,
    token,
    allowedOrigins: [origin],
  });
  try {
    const address = await listenRuntimeHost(server, { port: 0 });
    const base = `http://${address.host}:${address.port}`;
    const headers = {
      Authorization: `Bearer ${token}`,
      Origin: origin,
      "Content-Type": "application/json",
    };
    const request = { url: URL, startMs: 12_000, endMs: 59_200, localProcessingConfirmed: true };

    for (const hostile of [
      { ...request, localProcessingConfirmed: false },
      { ...request, destinationPath: "/tmp/escape" },
      { ...request, url: "https://example.com/video" },
      { ...request, endMs: 80_000 },
    ]) {
      const response = await fetch(`${base}/v1/youtube-local-ingests`, {
        method: "POST",
        headers,
        body: JSON.stringify(hostile),
      });
      assert.equal(response.status >= 400, true);
      assert.equal((await response.text()).includes("/tmp/escape"), false);
    }
    assert.equal(downloadCalls.length, 0);

    const created = await fetch(`${base}/v1/youtube-local-ingests`, {
      method: "POST",
      headers,
      body: JSON.stringify(request),
    });
    assert.equal(created.status, 202);
    const queued = await created.json() as YouTubeLocalIngestStatus;
    assert.equal(queued.status, "queued");
    assert.equal(queued.source, null);

    let status: YouTubeLocalIngestStatus = queued;
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      const response = await fetch(
        `${base}/v1/youtube-local-ingests/${encodeURIComponent(queued.ingestId)}`,
        { headers: { Authorization: `Bearer ${token}`, Origin: origin } },
      );
      assert.equal(response.status, 200);
      status = await response.json() as YouTubeLocalIngestStatus;
      if (status.status === "registered" || status.status === "failed") break;
      await new Promise((resolveWait) => setTimeout(resolveWait, 20));
    }
    assert.equal(status.status, "registered", status.failure?.message ?? "YouTube-local ingest did not register");
    assert.equal(status.failure, null);
    assert.equal(status.source?.sourceKind, "youtube_local");
    assert.equal(status.source?.rightsScope, "local_processing");
    assert.equal(status.source?.preflightSchema, "studio.preflight-bundle.v1");
    assert.equal(downloadCalls.length, 1);
    assert.deepEqual(
      { canonicalUrl: downloadCalls[0].canonicalUrl, startMs: downloadCalls[0].startMs, endMs: downloadCalls[0].endMs },
      { canonicalUrl: URL, startMs: 12_000, endMs: 59_200 },
    );

    const sourceDirectories = (await readdir(youtubeRoot, { withFileTypes: true })).filter((entry) => entry.isDirectory());
    assert.equal(sourceDirectories.length, 1);
    const sourceDirectory = join(youtubeRoot, sourceDirectories[0].name);
    assert.deepEqual(await readFile(join(sourceDirectory, "raw/youtube-local.mp4")), await readFile(FIXTURE));
    const receipt = JSON.parse(await readFile(join(sourceDirectory, "source.json"), "utf8")) as {
      schema: string;
      kind: string;
      receipt_id: string;
      origin: { canonical_url: string; external_id: string };
      rights: { scope: string; redistribution_allowed: boolean };
      selection: { provider_start_ms: number; provider_end_ms: number; local_start: number };
      raw_media: { path: string; content_id: string };
    };
    assert.equal(receipt.schema, "studio.ingest.youtube-local.v1");
    assert.equal(receipt.kind, "youtube_local");
    assert.equal(receipt.origin.canonical_url, URL);
    assert.equal(receipt.rights.scope, "local_processing");
    assert.equal(receipt.rights.redistribution_allowed, false);
    assert.deepEqual(
      [receipt.selection.provider_start_ms, receipt.selection.provider_end_ms, receipt.selection.local_start],
      [12_000, 59_200, 0],
    );
    assert.equal(receipt.raw_media.path, "raw/youtube-local.mp4");
    assert.equal(receipt.raw_media.content_id, status.source?.sourceContentId);
    assert.equal(JSON.stringify([queued, status, receipt]).includes("public/demo/runs/run-005"), false);
    assert.equal(JSON.stringify([queued, status]).includes(youtubeRoot), false);

    assert.ok(status.source);
    const runtimeRequest: RuntimeHostStartRequest = {
      sourceSessionId: status.source.sourceSessionId,
      sourceRevisionId: status.source.sourceRevisionId,
      range: { startMs: 0, endMs: 1_000 },
      requestedSourceLanguage: { mode: "declared", languages: ["ko"], reason: null },
      targetLanguage: "en",
      selectedLanguagePackId: null,
      outputDepth: "evidence",
    };
    const planned = await fetch(`${base}/v1/runtime-plans`, {
      method: "POST",
      headers,
      body: JSON.stringify(runtimeRequest),
    });
    assert.equal(planned.status, 200);
    const plan = await planned.json() as { commandId: string; runtimeId: string };
    const started = await fetch(`${base}/v1/runtime-starts`, {
      method: "POST",
      headers,
      body: JSON.stringify(runtimeRequest),
    });
    assert.equal(started.status, 202);
    const acknowledgement = await started.json() as { commandId: string; runtimeId: string };
    assert.equal(acknowledgement.commandId, plan.commandId);
    assert.equal(acknowledgement.runtimeId, plan.runtimeId);
    await waitForLifecycle(service, acknowledgement.commandId, "terminal");

    const reopenedSources = await RuntimeSourceRegistry.open({ sourceDirectories: [] });
    await YouTubeLocalIngestService.open({
      root: youtubeRoot,
      repositoryRoot: resolve("."),
      sources: reopenedSources,
      maximumRangeMs: 60_000,
      resolveSource: fakeResolution,
      download: async () => assert.fail("restart registration must not download"),
    });
    assert.equal(reopenedSources.list().length, 1);
    assert.equal(reopenedSources.list()[0].sourceSessionId, status.source.sourceSessionId);
  } finally {
    await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
  }
});

test("YouTube-local download failure never substitutes a recorded or owned source", async () => {
  const directory = await mkdtemp(join(tmpdir(), "studio-youtube-local-failure-test-"));
  const sources = await RuntimeSourceRegistry.open({ sourceDirectories: [] });
  try {
    const ingest = await YouTubeLocalIngestService.open({
      root: join(directory, "sources"),
      repositoryRoot: resolve("."),
      sources,
      resolveSource: fakeResolution,
      download: async () => { throw new Error("offline"); },
    });
    const queued = ingest.create({ url: URL, startMs: 0, endMs: 1_000, localProcessingConfirmed: true });
    let status = queued;
    const deadline = Date.now() + 2_000;
    while (Date.now() < deadline) {
      status = ingest.status(queued.ingestId);
      if (status.status === "failed") break;
      await new Promise((resolveWait) => setTimeout(resolveWait, 10));
    }
    assert.equal(status.status, "failed");
    assert.equal(status.failure?.code, "download_failed");
    assert.equal(status.source, null);
    assert.deepEqual(sources.list(), []);
  } finally {
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
  }
});
