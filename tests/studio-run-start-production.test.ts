import assert from "node:assert/strict";
import { appendFile, cp, mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import { assertProductionAnalysisRequest } from "../src/studio/runtime/production/assertions.ts";
import { ContentAddressedArtifactStore } from "../src/studio/runtime/production/artifactStore.ts";
import type { RequestedSourceLanguage } from "../src/studio/runtime/production/model.ts";
import * as runStart from "../src/studio/runtime/production/runStart.ts";
import {
  createProductionAnalysisRequest,
  createRuntimeStart,
  loadOwnedSourceSession,
  writeRuntimeStartReceipt,
} from "../src/studio/runtime/production/runStart.ts";
import { assertRuntimeStartRecord } from "../src/studio/runtime/production/runStartValidation.ts";

const FIXTURE = resolve("public/demo/runs/run-005");

test("run-start facade preserves its exact runtime export surface", () => {
  assert.deepEqual(Object.keys(runStart).sort(), [
    "createProductionAnalysisRequest",
    "createRuntimeStart",
    "loadOwnedSourceSession",
    "writeRuntimeStartReceipt",
  ]);
});

test("owned preflight becomes a stable source session and frozen language-aware run start", async (suite) => {
  const directory = await mkdtemp(join(tmpdir(), "studio-run-start-test-"));
  suite.after(() => rm(directory, { recursive: true, force: true }));

  const loaded = await loadOwnedSourceSession(FIXTURE);
  const repeated = await loadOwnedSourceSession(FIXTURE);
  assert.deepEqual(repeated.session, loaded.session);
  assert.equal(loaded.session.schema, "studio.source-session.v1");
  assert.equal(loaded.session.preflight.schema, "studio.preflight-bundle.v3");
  assert.equal(loaded.session.detectedLanguageEvidenceContentIds.length, 1);
  assert.equal(loaded.descriptor.publication, "public");

  const request = createProductionAnalysisRequest(loaded.session, {
    range: { startMs: 1_000, endMs: 11_000 },
    requestedSource: { mode: "declared", languages: ["ko"], reason: null },
    targetLanguage: "en",
    selectedLanguagePackId: "ko-v3",
    outputDepth: "evidence",
  });
  assert.equal(request.language.languagePair.requestedSource.languages[0], "ko");
  assert.equal(request.language.languagePair.targetLanguage, "en");
  assert.equal(request.language.selectedLanguagePackId, "ko-v3");
  assert.deepEqual(
    request.language.detectedLanguageEvidenceContentIds,
    loaded.session.detectedLanguageEvidenceContentIds,
  );

  const store = new ContentAddressedArtifactStore(join(directory, "artifact-store"));
  const artifact = await store.registerSource("runtime:run-start-test", loaded.descriptor);
  const start = createRuntimeStart({
    runId: "runtime:run-start-test",
    journalId: "journal:runtime:run-start-test",
    acceptedBy: "operator:test",
    startedAt: "2026-07-14T12:00:00.000Z",
    sourceSession: loaded.session,
    sourceArtifactId: artifact.id,
    analysisRequest: request,
  });
  assert.equal(start.forecast.scenarios.baseline.status, "floor_only");
  assert.equal(start.forecast.scenarios.baseline.workload.requestedOperationMediaDurationMs, 10_000);
  assert.equal(start.forecast.scenarios.baseline.elapsedDurationMs, null);
  assert.equal(start.forecast.scenarios.baseline.modelUsage, null);
  assert.deepEqual(start.forecast.scenarios.baseline.apiCost, { amount: null, currency: null });
  assert.equal(start.frozenForecast.acceptance.runId, "runtime:run-start-test");
  assert.equal(start.frozenForecast.forecast.contentId, start.forecast.content.contentId);

  const path = join(directory, "run-start.json");
  const content = await writeRuntimeStartReceipt(path, start);
  assert.match(content.contentId, /^sha256:[a-f0-9]{64}$/);
  const reopened = JSON.parse(await readFile(path, "utf8")) as unknown;
  assertRuntimeStartRecord(reopened);
  assert.deepEqual(reopened, start);
});

test("source language modes stay explicit and detector evidence cannot rewrite them", async () => {
  const loaded = await loadOwnedSourceSession(FIXTURE);
  const inputs: RequestedSourceLanguage[] = [
    { mode: "automatic", languages: [], reason: null },
    { mode: "mixed", languages: ["ko", "en"], reason: null },
    { mode: "unknown", languages: [], reason: null },
    { mode: "withheld", languages: [], reason: "The operator withheld the source declaration." },
  ];

  for (const requestedSource of inputs) {
    const request = createProductionAnalysisRequest(loaded.session, {
      range: { startMs: 0, endMs: 1_000 },
      requestedSource,
      targetLanguage: "ja",
      selectedLanguagePackId: null,
      outputDepth: "captions",
    });
    assertProductionAnalysisRequest(request);
    assert.deepEqual(request.language.languagePair.requestedSource, requestedSource);
    assert.equal(request.language.languagePair.targetLanguage, "ja");
    assert.equal(request.language.selectedLanguagePackId, null);
    assert.deepEqual(
      request.language.detectedLanguageEvidenceContentIds,
      loaded.session.detectedLanguageEvidenceContentIds,
    );
  }
});

test("a newly ingested V1 owned preflight launches without inventing detector evidence", async (suite) => {
  const copied = await mkdtemp(join(tmpdir(), "studio-v1-source-test-"));
  suite.after(() => rm(copied, { recursive: true, force: true }));
  await cp(FIXTURE, copied, { recursive: true });
  await rm(join(copied, "preflight-v3.json"));
  await rm(join(copied, "preflight-v2.json"));

  const loaded = await loadOwnedSourceSession(copied);
  assert.equal(loaded.session.preflight.schema, "studio.preflight-bundle.v1");
  assert.deepEqual(loaded.session.detectedLanguageEvidenceContentIds, []);
  const request = createProductionAnalysisRequest(loaded.session, {
    range: { startMs: 0, endMs: 1_000 },
    requestedSource: { mode: "unknown", languages: [], reason: null },
    targetLanguage: "en",
    selectedLanguagePackId: null,
    outputDepth: "captions",
  });
  assert.equal(request.language.languagePair.requestedSource.mode, "unknown");
  assert.deepEqual(request.language.detectedLanguageEvidenceContentIds, []);
});

test("run-start input fails closed on range overflow, evidence substitution, and source drift", async (suite) => {
  const loaded = await loadOwnedSourceSession(FIXTURE);
  assert.throws(
    () => createProductionAnalysisRequest(loaded.session, {
      range: { startMs: 0, endMs: loaded.session.source.durationMs + 1 },
      requestedSource: { mode: "declared", languages: ["ko"], reason: null },
      targetLanguage: "en",
      selectedLanguagePackId: "ko-v3",
      outputDepth: "evidence",
    }),
    /selected range exceeds the measured source duration/,
  );

  const request = createProductionAnalysisRequest(loaded.session, {
    range: { startMs: 0, endMs: 1_000 },
    requestedSource: { mode: "automatic", languages: [], reason: null },
    targetLanguage: "en",
    selectedLanguagePackId: "ko-v3",
    outputDepth: "captions",
  });
  const changedEvidence = structuredClone(request);
  changedEvidence.language.detectedLanguageEvidenceContentIds = [`sha256:${"f".repeat(64)}`];
  assert.throws(
    () => createRuntimeStart({
      runId: "runtime:evidence-substitution",
      journalId: "journal:runtime:evidence-substitution",
      acceptedBy: "operator:test",
      startedAt: "2026-07-14T12:00:00.000Z",
      sourceSession: loaded.session,
      sourceArtifactId: "artifact:evidence-substitution",
      analysisRequest: changedEvidence,
    }),
    /changed the source session's detector evidence references/,
  );

  const copied = await mkdtemp(join(tmpdir(), "studio-source-drift-test-"));
  suite.after(() => rm(copied, { recursive: true, force: true }));
  await cp(FIXTURE, copied, { recursive: true });
  const source = JSON.parse(await readFile(join(copied, "source.json"), "utf8")) as {
    raw_media: { path: string };
  };
  await appendFile(join(copied, source.raw_media.path), Buffer.from([0]));
  await assert.rejects(
    loadOwnedSourceSession(copied),
    /does not match its preflight content identity/,
  );

  const linked = await mkdtemp(join(tmpdir(), "studio-source-link-test-"));
  suite.after(() => rm(linked, { recursive: true, force: true }));
  await cp(FIXTURE, linked, { recursive: true });
  const linkedSource = JSON.parse(await readFile(join(linked, "source.json"), "utf8")) as {
    raw_media: { path: string };
  };
  await rm(join(linked, linkedSource.raw_media.path));
  await symlink(join(FIXTURE, linkedSource.raw_media.path), join(linked, linkedSource.raw_media.path));
  await assert.rejects(
    loadOwnedSourceSession(linked),
    /resolves outside the source directory/,
  );
});
