import assert from "node:assert/strict";
import { appendFile, cp, mkdtemp, mkdir, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import { identifyFile } from "../../../src/studio/runtime/production/artifactStore.ts";
import { FileEventJournal, RuntimeLedger } from "../../../src/studio/runtime/production/journal.ts";
import { parseRuntimeHostStartRequest } from "../../../src/studio/runtime/production/runtimeHost/validation.ts";
import {
  DurableRuntimeCommandStore,
  DeterministicExecutionControl,
  DeterministicRuntimeExecutor,
  RuntimeSourceRegistry,
  RuntimeStartService,
} from "../../../src/studio/runtime/production/runtimeHost/index.ts";
import type { RuntimeHostStartRequest } from "../../../src/studio/runtime/production/runtimeHost/model.ts";
import { cleanup, FIXTURE, hostHarness, waitForLifecycle } from "./harness.ts";

async function copyReviewedMemoryStore(destination: string): Promise<string> {
  const sourceRoot = resolve("memory/review");
  for (const collection of ["proposals", "decisions", "legacy", "materializations"] as const) {
    await cp(join(sourceRoot, collection), join(destination, collection), { recursive: true });
  }
  await mkdir(join(destination, "consumptions"), { recursive: true });
  return destination;
}

test("reviewed plan is read-only and start freezes the exact studio.forecast.v1 content", async () => {
  const runtime = await hostHarness();
  try {
    const plan = await runtime.service.plan(runtime.request);
    assert.equal(plan.schema, "studio.local-runtime-plan.v1");
    assert.equal(plan.acceptance.status, "not_started");
    assert.equal(plan.acceptance.frozenForecastId, null);
    assert.equal(plan.forecast.schema, "studio.forecast.v1");
    assert.equal(plan.forecast.scenarios.baseline.status, "floor_only");
    assert.equal(plan.forecast.scenarios.baseline.workload.selectedMediaDurationMs, 1_000);
    assert.equal(plan.forecast.scenarios.baseline.workload.requestedOperationMediaDurationMs, 1_000);
    assert.equal(plan.forecast.scenarios.baseline.elapsedDurationMs, null);
    assert.equal(plan.forecast.scenarios.baseline.modelUsage, null);
    assert.deepEqual(plan.forecast.scenarios.baseline.apiCost, { amount: null, currency: null });
    assert.equal((await runtime.store.list()).length, 0);
    assert.equal(runtime.executor.launchInvocations, 0);

    const acknowledgement = await runtime.service.start(runtime.request);
    assert.equal(acknowledgement.commandId, plan.commandId);
    assert.equal(acknowledgement.runtimeId, plan.runtimeId);
    assert.equal(acknowledgement.analysisRequestId, plan.analysisRequestId);
    assert.equal(acknowledgement.forecast?.contentId, plan.forecast.content.contentId);
    assert.equal(
      acknowledgement.runStartReceipt?.record.forecast.content.contentId,
      plan.forecast.content.contentId,
    );
    assert.notEqual(acknowledgement.forecast?.frozenForecastId, null);
    await waitForLifecycle(runtime.service, acknowledgement.commandId, "terminal");
  } finally {
    await cleanup(runtime);
  }
});

test("ten identical starts durably acknowledge one runtime and invoke one bounded two-child execution", async () => {
  const control = new DeterministicExecutionControl({ pauseBeforeFirstEvent: true });
  const runtime = await hostHarness({ control });
  try {
    const acknowledgements = await Promise.all(
      Array.from({ length: 10 }, () => runtime.service.start(structuredClone(runtime.request))),
    );
    assert.equal(new Set(acknowledgements.map((ack) => ack.commandId)).size, 1);
    assert.equal(new Set(acknowledgements.map((ack) => ack.runtimeId)).size, 1);
    assert.equal(new Set(acknowledgements.map((ack) => ack.journalId)).size, 1);
    assert.equal(new Set(acknowledgements.map((ack) => ack.acceptedAt)).size, 1);
    assert.equal(new Set(acknowledgements.map((ack) => ack.runStartReceipt?.contentId)).size, 1);
    assert.equal(new Set(acknowledgements.map((ack) => ack.forecast?.contentId)).size, 1);
    assert.equal((await runtime.store.list()).length, 1);
    const launchDeadline = Date.now() + 3_000;
    while (runtime.executor.launchInvocations === 0 && Date.now() < launchDeadline) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(runtime.executor.launchInvocations, 1);

    const first = acknowledgements[0];
    const receiptPath = runtime.store.paths(first.runtimeId).runStartPath;
    const receiptBefore = await identifyFile(receiptPath);
    const modifiedBefore = (await stat(receiptPath)).mtimeMs;
    const repeated = await runtime.service.start(structuredClone(runtime.request));
    assert.equal(repeated.runtimeId, first.runtimeId);
    assert.equal(repeated.runStartReceipt?.contentId, first.runStartReceipt?.contentId);
    assert.equal((await stat(receiptPath)).mtimeMs, modifiedBefore);
    assert.deepEqual(await identifyFile(receiptPath), receiptBefore);

    control.releaseBeforeFirstEvent();
    await waitForLifecycle(runtime.service, first.commandId, "terminal");
    assert.equal(runtime.executor.launchInvocations, 2);

    const restartedExecutor = new DeterministicRuntimeExecutor();
    const restarted = await RuntimeStartService.open({
      store: runtime.store,
      sources: runtime.sources,
      launcherFactory: restartedExecutor.factory(),
      recoverOnOpen: true,
    });
    const afterRestart = await restarted.statusByCommand(first.commandId);
    assert.equal(afterRestart.runtimeId, first.runtimeId);
    assert.equal(afterRestart.lifecycle, "terminal");
    assert.equal(restartedExecutor.launchInvocations, 0);
  } finally {
    await cleanup(runtime);
  }
});

test("two service instances sharing one store select one durable command owner for its two-child execution", async () => {
  const directory = await mkdtemp(join(tmpdir(), "studio-runtime-multiprocess-test-"));
  try {
    const root = join(directory, "host");
    const [storeA, storeB] = await Promise.all([
      DurableRuntimeCommandStore.open(root),
      DurableRuntimeCommandStore.open(root),
    ]);
    const sources = await RuntimeSourceRegistry.open({ sourceDirectories: [FIXTURE] });
    const controlA = new DeterministicExecutionControl({ pauseBeforeFirstEvent: true, pauseMidRun: true });
    const controlB = new DeterministicExecutionControl({ pauseBeforeFirstEvent: true, pauseMidRun: true });
    const executorA = new DeterministicRuntimeExecutor({ control: controlA });
    const executorB = new DeterministicRuntimeExecutor({ control: controlB });
    const serviceA = await RuntimeStartService.open({
      store: storeA,
      sources,
      launcherFactory: executorA.factory(),
      recoverOnOpen: false,
    });
    const serviceB = await RuntimeStartService.open({
      store: storeB,
      sources,
      launcherFactory: executorB.factory(),
      recoverOnOpen: false,
    });
    const source = sources.list()[0];
    const request: RuntimeHostStartRequest = {
      sourceSessionId: source.sourceSessionId,
      sourceRevisionId: source.sourceRevisionId,
      range: { startMs: 0, endMs: 1_000 },
      requestedSourceLanguage: { mode: "declared", languages: ["ko"], reason: null },
      targetLanguage: "en",
      selectedLanguagePackId: "ko-v3",
      outputDepth: "evidence",
    };
    const [left, right] = await Promise.all([serviceA.start(request), serviceB.start(request)]);
    assert.equal(left.commandId, right.commandId);
    assert.equal(left.runtimeId, right.runtimeId);
    assert.equal(left.journalId, right.journalId);
    assert.equal(left.acceptedAt, right.acceptedAt);
    assert.equal(left.runStartReceipt?.contentId, right.runStartReceipt?.contentId);
    const deadline = Date.now() + 3_000;
    while (executorA.launchInvocations + executorB.launchInvocations < 2 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(executorA.launchInvocations + executorB.launchInvocations, 2);
    assert.equal((await storeA.list()).length, 1);
    assert.equal(
      (await readdir(join(root, "commands"))).filter((name) => name.endsWith(".launch.json")).length,
      1,
    );
    controlA.releaseBeforeFirstEvent();
    controlB.releaseBeforeFirstEvent();
    await waitForLifecycle(serviceA, left.commandId, "running");
    controlA.releaseMidRun();
    controlB.releaseMidRun();
    await waitForLifecycle(serviceA, left.commandId, "terminal");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("changed product inputs derive different commands while stale source input fails before acceptance", async () => {
  const runtime = await hostHarness();
  try {
    const variants: RuntimeHostStartRequest[] = [
      runtime.request,
      { ...runtime.request, range: { startMs: 1_000, endMs: 2_000 } },
      { ...runtime.request, targetLanguage: "ja" },
      { ...runtime.request, outputDepth: "captions" },
    ];
    const acknowledgements = [];
    for (const request of variants) acknowledgements.push(await runtime.service.start(request));
    assert.equal(new Set(acknowledgements.map((ack) => ack.commandId)).size, 4);
    await Promise.all(acknowledgements.map((ack) => waitForLifecycle(runtime.service, ack.commandId, "terminal")));
    assert.equal(runtime.executor.launchInvocations, 8);

    await assert.rejects(
      runtime.service.start({ ...runtime.request, sourceRevisionId: `source-revision:${"f".repeat(64)}` }),
      (error: Error) => error.message === "The requested source revision is stale or no longer registered.",
    );
    assert.equal((await runtime.store.list()).length, 4);
  } finally {
    await cleanup(runtime);
  }
});

test("host validation rejects invalid language shapes, detector substitution, paths, and unknown fields", async () => {
  const runtime = await hostHarness();
  try {
    await assert.rejects(
      runtime.service.start({ ...runtime.request, range: { startMs: 1_000, endMs: 1_000 } }),
      /non-empty half-open range/,
    );
    await assert.rejects(
      runtime.service.start({ ...runtime.request, targetLanguage: "not_a_language" }),
      /BCP-47/,
    );
    await assert.rejects(
      runtime.service.start({
        ...runtime.request,
        requestedSourceLanguage: { mode: "automatic", languages: ["ko"], reason: null },
      }),
      /automatic mode requires no languages/,
    );
    await assert.rejects(
      runtime.service.start({ ...runtime.request, detectedLanguageEvidenceContentIds: [`sha256:${"a".repeat(64)}`] }),
      /detectedLanguageEvidenceContentIds is not allowed/,
    );
    await assert.rejects(
      runtime.service.start({ ...runtime.request, outputRoot: "/tmp/caller-path" }),
      /outputRoot is not allowed/,
    );
    await assert.rejects(
      runtime.service.start({ ...runtime.request, arbitrary: true }),
      /arbitrary is not allowed/,
    );
    await assert.rejects(
      runtime.service.start({ ...runtime.request, sourceSessionId: "source-session:unknown" }),
      /source session is not registered/,
    );
    assert.equal((await runtime.store.list()).length, 0);
  } finally {
    await cleanup(runtime);
  }
});

test("source bytes changed after registration fail revalidation before command acceptance", async () => {
  const source = await mkdtemp(join(tmpdir(), "studio-runtime-host-source-drift-"));
  await cp(FIXTURE, source, { recursive: true });
  const runtime = await hostHarness({ sourceDirectory: source });
  try {
    const receipt = JSON.parse(await readFile(join(source, "source.json"), "utf8")) as { raw_media: { path: string } };
    await appendFile(join(source, receipt.raw_media.path), "drift");
    await assert.rejects(runtime.service.start(runtime.request), /no longer passes local-source/);
    assert.equal((await runtime.store.list()).length, 0);
  } finally {
    await cleanup(runtime);
    await rm(source, { recursive: true, force: true });
  }
});

test("start request accepts optional null materializationId and rejects malformed identities", () => {
  const base = {
    sourceSessionId: "source-session:test",
    sourceRevisionId: "source-revision:test",
    range: { startMs: 0, endMs: 1_000 },
    requestedSourceLanguage: { mode: "declared" as const, languages: ["ko"] as [string], reason: null },
    targetLanguage: "en",
    selectedLanguagePackId: "ko-v3",
    outputDepth: "evidence" as const,
  };
  assert.equal(parseRuntimeHostStartRequest({ ...base, materializationId: null }).materializationId, null);
  assert.equal(parseRuntimeHostStartRequest(base).materializationId, undefined);
  assert.throws(
    () => parseRuntimeHostStartRequest({ ...base, materializationId: "memory-materialization:missing" }),
    /materializationId/,
  );
});

test("host start consumes a reviewed materialization into root jobContext and durable consumptions", async () => {
  const memoryStore = await mkdtemp(join(tmpdir(), "studio-runtime-memory-store-"));
  await copyReviewedMemoryStore(memoryStore);
  const materializationNames = await readdir(join(memoryStore, "materializations"));
  assert.ok(materializationNames.length >= 1);
  const materialization = JSON.parse(
    await readFile(join(memoryStore, "materializations", materializationNames[0]), "utf8"),
  ) as { materialization_id: string; entries: Array<{ key: string }> };
  const runtime = await hostHarness({
    reviewedMemoryStore: memoryStore,
    orchestratorMode: "empty_research_synthesis_only",
  });
  try {
    const acknowledgement = await runtime.service.start({
      ...runtime.request,
      materializationId: materialization.materialization_id,
    });
    await waitForLifecycle(runtime.service, acknowledgement.commandId, "terminal");
    const journalPath = runtime.store.paths(acknowledgement.runtimeId).journalPath;
    const ledger = await RuntimeLedger.open(
      acknowledgement.runtimeId,
      new FileEventJournal(journalPath),
    );
    const root = Object.values(ledger.state().tasks).find((task) => task.parentTaskId === null)!;
    assert.equal(root.jobContext.reviewedMemory?.materializationId, materialization.materialization_id);
    assert.equal(root.jobContext.reviewedMemory?.entries[0]?.key, materialization.entries[0]?.key);
    const consumptionNames = await readdir(join(memoryStore, "consumptions"));
    assert.equal(consumptionNames.length, 1);
    const consumption = JSON.parse(
      await readFile(join(memoryStore, "consumptions", consumptionNames[0]), "utf8"),
    ) as { run_id: string; snapshot: { materialization_id: string } };
    assert.equal(consumption.run_id, acknowledgement.runtimeId);
    assert.equal(consumption.snapshot.materialization_id, materialization.materialization_id);
  } finally {
    await cleanup(runtime);
    await rm(memoryStore, { recursive: true, force: true });
  }
});

test("host start fails closed when the requested materialization is absent from the memory store", async () => {
  const memoryStore = await mkdtemp(join(tmpdir(), "studio-runtime-memory-empty-"));
  await mkdir(join(memoryStore, "materializations"), { recursive: true });
  const runtime = await hostHarness({ reviewedMemoryStore: memoryStore });
  try {
    await assert.rejects(
      () => runtime.service.start({
        ...runtime.request,
        materializationId: `memory-materialization:sha256:${"0".repeat(64)}`,
      }),
      /not present in the host memory review store/,
    );
    assert.equal((await runtime.store.list()).length, 0);
  } finally {
    await cleanup(runtime);
    await rm(memoryStore, { recursive: true, force: true });
  }
});

test("memory-bound and unbound starts remain distinct durable commands", async () => {
  const memoryStore = await mkdtemp(join(tmpdir(), "studio-runtime-memory-distinct-"));
  await copyReviewedMemoryStore(memoryStore);
  const materializationNames = await readdir(join(memoryStore, "materializations"));
  const materialization = JSON.parse(
    await readFile(join(memoryStore, "materializations", materializationNames[0]), "utf8"),
  ) as { materialization_id: string };
  const runtime = await hostHarness({
    reviewedMemoryStore: memoryStore,
    orchestratorMode: "empty_research_synthesis_only",
  });
  try {
    const unbound = await runtime.service.start(runtime.request);
    const bound = await runtime.service.start({
      ...runtime.request,
      materializationId: materialization.materialization_id,
    });
    assert.notEqual(unbound.commandId, bound.commandId);
    assert.notEqual(unbound.runtimeId, bound.runtimeId);
    await Promise.all([
      waitForLifecycle(runtime.service, unbound.commandId, "terminal"),
      waitForLifecycle(runtime.service, bound.commandId, "terminal"),
    ]);
  } finally {
    await cleanup(runtime);
    await rm(memoryStore, { recursive: true, force: true });
  }
});
