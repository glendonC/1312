import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import { loadRuntimeInspectorJournal } from "../../../src/studio/runtime/production/runtimeInspector/journalLoader.ts";
import {
  DurableRuntimeCommandStore,
  DeterministicRuntimeExecutor,
  OwnedMediaIngestService,
  RuntimeSourceRegistry,
  RuntimeStartService,
  createRuntimeHostHttpServer,
  listenRuntimeHost,
} from "../../../src/studio/runtime/production/runtimeHost/index.ts";
import type {
  OwnedMediaIngestStatus,
  RuntimeHostStartRequest,
} from "../../../src/studio/runtime/production/runtimeHost/model.ts";
import { runtimeIds, waitForLifecycle } from "./harness.ts";

test("browser-owned ingest fails closed on rights and paths, preserves bytes, hot-registers, and feeds plan/start", async () => {
  const directory = await mkdtemp(join(tmpdir(), "studio-owned-ingest-test-"));
  const ownedRoot = join(directory, "owned-sources");
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
  const ownedMediaIngest = await OwnedMediaIngestService.open({
    root: ownedRoot,
    repositoryRoot: resolve("."),
    sources,
    maximumBytes: 1024 * 1024,
  });
  const token = "i".repeat(64);
  const origin = "http://127.0.0.1:4321";
  const server = createRuntimeHostHttpServer({
    service,
    ownedMediaIngest,
    token,
    allowedOrigins: [origin],
  });
  try {
    const address = await listenRuntimeHost(server, { port: 0 });
    const base = `http://${address.host}:${address.port}`;
    const authorized = {
      Authorization: `Bearer ${token}`,
      Origin: origin,
      "Content-Type": "application/json",
    };
    const media = await readFile(resolve("public/demo/runs/run-005/clip.m4a"));
    const metadata = {
      filename: "owned-clip.m4a",
      declaredBytes: media.length,
      label: "Browser-owned integration clip",
      rightsHolder: "Integration Test Studio",
      rightsScope: "local_processing",
      ownershipAttested: true,
    };

    const missingRights = await fetch(`${base}/v1/owned-media-ingests`, {
      method: "POST",
      headers: authorized,
      body: JSON.stringify({ ...metadata, ownershipAttested: false }),
    });
    assert.equal(missingRights.status, 400);
    assert.equal((await missingRights.json() as { error: { code: string } }).error.code, "invalid_rights_attestation");

    const redistribution = await fetch(`${base}/v1/owned-media-ingests`, {
      method: "POST",
      headers: authorized,
      body: JSON.stringify({ ...metadata, rightsScope: "redistribution" }),
    });
    assert.equal(redistribution.status, 400);

    const arbitraryDestination = await fetch(`${base}/v1/owned-media-ingests`, {
      method: "POST",
      headers: authorized,
      body: JSON.stringify({ ...metadata, destinationPath: "/tmp/client-chosen" }),
    });
    assert.equal(arbitraryDestination.status, 400);
    assert.equal((await arbitraryDestination.json() as { error: { code: string } }).error.code, "invalid_ingest_request");

    const pathFilename = await fetch(`${base}/v1/owned-media-ingests`, {
      method: "POST",
      headers: authorized,
      body: JSON.stringify({ ...metadata, filename: "/private/operator/clip.m4a" }),
    });
    assert.equal(pathFilename.status, 400);
    assert.equal((await pathFilename.text()).includes("/private/operator"), false);

    const argumentLikeLabel = await fetch(`${base}/v1/owned-media-ingests`, {
      method: "POST",
      headers: authorized,
      body: JSON.stringify({ ...metadata, label: "--rights-holder" }),
    });
    assert.equal(argumentLikeLabel.status, 400);

    const invalidMediaBytes = Buffer.from([1, 2, 3, 4]);
    const invalidMediaCreate = await fetch(`${base}/v1/owned-media-ingests`, {
      method: "POST",
      headers: authorized,
      body: JSON.stringify({
        ...metadata,
        filename: "not-media.wav",
        declaredBytes: invalidMediaBytes.length,
        label: "Invalid owned media",
      }),
    });
    const invalidMediaJob = await invalidMediaCreate.json() as { ingestId: string };
    const invalidMediaUpload = await fetch(
      `${base}/v1/owned-media-ingests/${encodeURIComponent(invalidMediaJob.ingestId)}/media`,
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          Origin: origin,
          "Content-Type": "application/octet-stream",
        },
        body: invalidMediaBytes,
      },
    );
    assert.equal(invalidMediaUpload.status, 202);
    let invalidMediaStatus: OwnedMediaIngestStatus | null = null;
    const invalidDeadline = Date.now() + 5_000;
    while (Date.now() < invalidDeadline) {
      const response = await fetch(
        `${base}/v1/owned-media-ingests/${encodeURIComponent(invalidMediaJob.ingestId)}`,
        { headers: { Authorization: `Bearer ${token}`, Origin: origin } },
      );
      invalidMediaStatus = await response.json() as OwnedMediaIngestStatus;
      if (invalidMediaStatus.status === "failed") break;
      await new Promise((resolveWait) => setTimeout(resolveWait, 20));
    }
    assert.equal(invalidMediaStatus?.status, "failed");
    assert.equal(invalidMediaStatus?.failure?.code, "probe_failed");
    assert.equal(JSON.stringify(invalidMediaStatus).includes(directory), false);

    const created = await fetch(`${base}/v1/owned-media-ingests`, {
      method: "POST",
      headers: authorized,
      body: JSON.stringify(metadata),
    });
    assert.equal(created.status, 202);
    const queued = await created.json() as {
      ingestId: string;
      status: string;
      source: null;
      failure: null;
    };
    assert.equal(queued.status, "queued");
    assert.equal(queued.source, null);
    assert.equal(queued.failure, null);

    const uploaded = await fetch(
      `${base}/v1/owned-media-ingests/${encodeURIComponent(queued.ingestId)}/media`,
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          Origin: origin,
          "Content-Type": "application/octet-stream",
        },
        body: media,
      },
    );
    assert.equal(uploaded.status, 202);
    assert.equal((await uploaded.json() as { status: string }).status, "queued");

    let status: OwnedMediaIngestStatus | null = null;
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      const response = await fetch(
        `${base}/v1/owned-media-ingests/${encodeURIComponent(queued.ingestId)}`,
        { headers: { Authorization: `Bearer ${token}`, Origin: origin } },
      );
      assert.equal(response.status, 200);
      status = await response.json() as OwnedMediaIngestStatus;
      if (status?.status === "registered" || status?.status === "failed") break;
      await new Promise((resolveWait) => setTimeout(resolveWait, 20));
    }
    assert.equal(status?.status, "registered", status?.failure?.message ?? "ingest did not register");
    assert.equal(status?.failure, null);
    assert.equal(status?.source?.preflightSchema, "studio.preflight-bundle.v1");
    assert.equal(status?.source?.detectedLanguageEvidenceAvailable, false);

    const listed = await fetch(`${base}/v1/source-sessions`, {
      headers: { Authorization: `Bearer ${token}`, Origin: origin },
    });
    const listedBody = await listed.json() as { sourceSessions: Array<{ sourceSessionId: string; sourceRevisionId: string }> };
    assert.equal(listedBody.sourceSessions.length, 1);
    assert.equal(listedBody.sourceSessions[0].sourceSessionId, status?.source?.sourceSessionId);
    assert.equal(listedBody.sourceSessions[0].sourceRevisionId, status?.source?.sourceRevisionId);
    const publicBodies = JSON.stringify([queued, status, listedBody]);
    assert.equal(publicBodies.includes(ownedRoot), false);
    assert.equal(publicBodies.includes("public/demo/runs"), false);
    assert.equal(publicBodies.includes("/private/operator"), false);

    const sourceDirectories = (await readdir(ownedRoot, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && entry.name !== ".uploads");
    assert.equal(sourceDirectories.length, 1);
    const sourceDirectory = join(ownedRoot, sourceDirectories[0].name);
    const sourceReceipt = JSON.parse(await readFile(join(sourceDirectory, "source.json"), "utf8")) as {
      raw_media: { path: string };
    };
    assert.deepEqual(await readFile(join(sourceDirectory, sourceReceipt.raw_media.path)), media);

    assert.ok(status?.source);
    const runtimeRequest: RuntimeHostStartRequest = {
      sourceSessionId: status.source.sourceSessionId,
      sourceRevisionId: status.source.sourceRevisionId,
      range: { startMs: 0, endMs: Math.min(1_000, status.source.durationMs) },
      requestedSourceLanguage: { mode: "declared", languages: ["ko"], reason: null },
      targetLanguage: "en",
      selectedLanguagePackId: null,
      outputDepth: "evidence",
    };
    const planned = await fetch(`${base}/v1/runtime-plans`, {
      method: "POST",
      headers: authorized,
      body: JSON.stringify(runtimeRequest),
    });
    assert.equal(planned.status, 200);
    const plan = await planned.json() as { commandId: string; runtimeId: string };
    const started = await fetch(`${base}/v1/runtime-starts`, {
      method: "POST",
      headers: authorized,
      body: JSON.stringify(runtimeRequest),
    });
    assert.equal(started.status, 202);
    const acknowledgement = await started.json() as { commandId: string; runtimeId: string };
    assert.equal(acknowledgement.commandId, plan.commandId);
    assert.equal(acknowledgement.runtimeId, plan.runtimeId);
    await waitForLifecycle(service, acknowledgement.commandId, "terminal");
    const v1Inspector = await loadRuntimeInspectorJournal(
      await readFile(store.paths(acknowledgement.runtimeId).journalPath, "utf8"),
    );
    assert.equal(v1Inspector.projection.grants.some((grant) => grant.capability === "evidence.read"), false);
    assert.equal(v1Inspector.projection.grants.some((grant) => grant.capability === "analysis.evidence.assess"), false);
    assert.equal(v1Inspector.projection.grants.some((grant) => grant.capability === "analysis.evidence.decide"), false);
    assert.equal(v1Inspector.projection.evidenceArtifacts.length, 0);
    assert.equal(v1Inspector.projection.evidenceReads.length, 0);
    assert.equal(v1Inspector.projection.evidenceAssessments.length, 0);
    assert.equal(v1Inspector.projection.assessmentArtifacts.length, 0);
    assert.equal(v1Inspector.projection.evidenceDecisions.length, 0);
    assert.equal(v1Inspector.projection.decisionArtifacts.length, 0);
    assert.deepEqual((await service.assessmentAudits(acknowledgement.runtimeId)).audits, []);
    assert.deepEqual((await service.decisionReceipts(acknowledgement.runtimeId)).decisions, []);
    assert.equal(v1Inspector.projection.publishReviewIntakes.length, 1);
    assert.equal(v1Inspector.projection.publishReviewIntakeArtifacts.length, 1);
    const studyIntakes = (await service.publishReviewIntakes(acknowledgement.runtimeId)).intakes;
    assert.equal(studyIntakes.length, 1);
    assert.equal(studyIntakes[0].integrity, "stored_intake_and_verified_study_readiness");
    assert.deepEqual((await service.publishReviewDecisions(acknowledgement.runtimeId)).reviews, []);
    assert.deepEqual((await service.captionProductions(acknowledgement.runtimeId)).captions, []);

    const reopenedSources = await RuntimeSourceRegistry.open({ sourceDirectories: [] });
    await OwnedMediaIngestService.open({
      root: ownedRoot,
      repositoryRoot: resolve("."),
      sources: reopenedSources,
      maximumBytes: 1024 * 1024,
    });
    assert.equal(reopenedSources.list().length, 1);
    assert.equal(reopenedSources.list()[0].sourceSessionId, status.source.sourceSessionId);
  } finally {
    await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
  }
});
