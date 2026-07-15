import assert from "node:assert/strict";
import {
  appendFile,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import { canonicalSha256, identifyFile } from "../src/studio/runtime/production/artifactStore.ts";
import { projectRuntimeEvents } from "../src/studio/runtime/production/projection.ts";
import { loadRuntimeInspectorJournal } from "../src/studio/runtime/production/runtimeInspector/journalLoader.ts";
import { createProductionAnalysisRequest } from "../src/studio/runtime/production/runStart/analysisRequest.ts";
import { createRuntimeStartCommand } from "../src/studio/runtime/production/runStart/runtimeStart.ts";
import { loadOwnedSourceSession } from "../src/studio/runtime/production/runStart/sourceSessionLoader.ts";
import {
  DurableRuntimeCommandStore,
  DeterministicExecutionControl,
  DeterministicRuntimeExecutor,
  RuntimeSourceRegistry,
  RuntimeStartService,
  assertRuntimeHostBindAddress,
  createRuntimeHostHttpServer,
  listenRuntimeHost,
  readValidatedRuntimeJournal,
  validatePollCursor,
} from "../src/studio/runtime/production/runtimeHost/index.ts";
import type {
  RuntimeHostCommandRecord,
  RuntimeHostStartRequest,
} from "../src/studio/runtime/production/runtimeHost/model.ts";
import { initializeRuntimeApplication } from "../src/studio/runtime/production/runtimeHost/runtimeApplication.ts";

const FIXTURE = resolve("public/demo/runs/run-005");

interface HostHarness {
  directory: string;
  store: DurableRuntimeCommandStore;
  sources: RuntimeSourceRegistry;
  executor: DeterministicRuntimeExecutor;
  service: RuntimeStartService;
  request: RuntimeHostStartRequest;
}

function runtimeIds(): () => string {
  let count = 0;
  return () => {
    count += 1;
    return `runtime:00000000-0000-4000-8000-${count.toString().padStart(12, "0")}`;
  };
}

async function hostHarness(options: {
  control?: DeterministicExecutionControl;
  mode?: "completed" | "failed" | "timed_out" | "interrupted";
  sourceDirectory?: string;
  recoverOnOpen?: boolean;
} = {}): Promise<HostHarness> {
  const directory = await mkdtemp(join(tmpdir(), "studio-runtime-host-test-"));
  const sources = await RuntimeSourceRegistry.open({
    sourceDirectories: [options.sourceDirectory ?? FIXTURE],
  });
  const store = await DurableRuntimeCommandStore.open(join(directory, "host"));
  const executor = new DeterministicRuntimeExecutor({ mode: options.mode, control: options.control });
  const service = await RuntimeStartService.open({
    store,
    sources,
    launcherFactory: executor.factory(),
    nextRuntimeId: runtimeIds(),
    recoverOnOpen: options.recoverOnOpen ?? false,
  });
  const source = sources.list()[0];
  return {
    directory,
    store,
    sources,
    executor,
    service,
    request: {
      sourceSessionId: source.sourceSessionId,
      sourceRevisionId: source.sourceRevisionId,
      range: { startMs: 0, endMs: 1_000 },
      requestedSourceLanguage: { mode: "declared", languages: ["ko"], reason: null },
      targetLanguage: "en",
      selectedLanguagePackId: "ko-v3",
      outputDepth: "evidence",
    },
  };
}

async function cleanup(harness: HostHarness): Promise<void> {
  await rm(harness.directory, { recursive: true, force: true });
}

async function waitForLifecycle(
  service: RuntimeStartService,
  commandId: string,
  expected: "terminal" | "failed" | "interrupted" | "running",
): Promise<Awaited<ReturnType<RuntimeStartService["statusByCommand"]>>> {
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline) {
    const status = await service.statusByCommand(commandId);
    if (status.lifecycle === expected) return status;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail(`runtime did not reach ${expected}`);
}

test("ten identical starts durably acknowledge one runtime and invoke one executor", async () => {
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
    assert.equal(runtime.executor.launchInvocations, 1);

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

test("two service instances sharing one store select one durable command and launch winner", async () => {
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
      nextRuntimeId: () => "runtime:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      recoverOnOpen: false,
    });
    const serviceB = await RuntimeStartService.open({
      store: storeB,
      sources,
      launcherFactory: executorB.factory(),
      nextRuntimeId: () => "runtime:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
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
    while (executorA.launchInvocations + executorB.launchInvocations === 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(executorA.launchInvocations + executorB.launchInvocations, 1);
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
    assert.equal(runtime.executor.launchInvocations, 4);

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
    await assert.rejects(runtime.service.start(runtime.request), /no longer passes owned-source/);
    assert.equal((await runtime.store.list()).length, 0);
  } finally {
    await cleanup(runtime);
    await rm(source, { recursive: true, force: true });
  }
});

test("polling is exclusive, bounded, restart-safe, and projects the complete validated stream", async () => {
  const control = new DeterministicExecutionControl({ pauseBeforeFirstEvent: true });
  const runtime = await hostHarness({ control });
  try {
    const ack = await runtime.service.start(runtime.request);
    await new Promise((resolve) => setTimeout(resolve, 20));
    const first = await runtime.service.poll(ack.runtimeId, 0, 2);
    assert.equal(first.requestedCursor, 0);
    assert.ok(first.events.length > 0 && first.events.length <= 2);
    assert.equal(first.nextCursor, first.events.at(-1)?.seq);
    assert.equal(first.events[0].seq, 1);
    await assert.rejects(runtime.service.poll(ack.runtimeId, first.journalHead + 1, 1), /cursor is beyond/);

    control.releaseBeforeFirstEvent();
    const terminalStatus = await waitForLifecycle(runtime.service, ack.commandId, "terminal");
    const collected = [];
    let cursor = 0;
    while (true) {
      const batch = await runtime.service.poll(ack.runtimeId, cursor, 3);
      collected.push(...batch.events);
      cursor = batch.nextCursor;
      if (batch.reachedHead) {
        assert.equal(batch.terminal, true);
        break;
      }
    }
    const atHead = await runtime.service.poll(ack.runtimeId, cursor, 3);
    assert.deepEqual(atHead.events, []);
    assert.equal(atHead.nextCursor, cursor);
    assert.equal(atHead.reachedHead, true);
    assert.equal(cursor, terminalStatus.journalHead);
    const direct = await readValidatedRuntimeJournal(runtime.store.paths(ack.runtimeId).journalPath, ack.runtimeId);
    assert.deepEqual(collected, direct.events);
    assert.deepEqual(projectRuntimeEvents(ack.runtimeId, collected), direct.state);
    const inspector = await loadRuntimeInspectorJournal(
      await readFile(runtime.store.paths(ack.runtimeId).journalPath, "utf8"),
    );
    assert.equal(inspector.projection.runId, ack.runtimeId);
    assert.equal(inspector.projection.lastSeq, cursor);

    const reopened = await RuntimeStartService.open({
      store: runtime.store,
      sources: runtime.sources,
      launcherFactory: new DeterministicRuntimeExecutor().factory(),
      recoverOnOpen: true,
    });
    const continued = await reopened.poll(ack.runtimeId, cursor, 3);
    assert.deepEqual(continued.events, []);
    assert.equal(continued.nextCursor, cursor);
  } finally {
    await cleanup(runtime);
  }
});

test("journal polling rejects malformed tails, events, duplicate/gapped sequences, and cross-run content", async () => {
  const runtime = await hostHarness();
  try {
    const ack = await runtime.service.start(runtime.request);
    await waitForLifecycle(runtime.service, ack.commandId, "terminal");
    const originalPath = runtime.store.paths(ack.runtimeId).journalPath;
    const raw = await readFile(originalPath, "utf8");
    const lines = raw.trimEnd().split("\n");
    const mutations: Array<[string, string, RegExp]> = [];
    mutations.push(["partial", raw.trimEnd(), /incomplete line/]);
    mutations.push(["malformed-json", `${lines[0]}\nnot-json\n`, /not valid JSON/]);
    const openEvent = JSON.parse(lines[0]) as Record<string, unknown>;
    mutations.push(["malformed-event", `${JSON.stringify({ ...openEvent, extra: true })}\n`, /failed runtime-event validation/]);
    mutations.push(["duplicate-sequence", `${lines[0]}\n${lines[0]}\n`, /gapped, duplicated, cross-run/]);
    const gapped = JSON.parse(lines[1]) as { seq: number; eventId: string };
    gapped.seq += 1;
    gapped.eventId = `event:${ack.runtimeId}:${gapped.seq}`;
    mutations.push(["gapped-sequence", `${lines[0]}\n${JSON.stringify(gapped)}\n`, /gapped, duplicated, cross-run/]);
    const crossRun = JSON.parse(lines[0]) as { runId: string; eventId: string };
    crossRun.runId = "runtime:11111111-1111-4111-8111-111111111111";
    crossRun.eventId = `event:${crossRun.runId}:1`;
    mutations.push(["cross-run", `${JSON.stringify(crossRun)}\n`, /gapped, duplicated, cross-run/]);

    for (const [name, value, expected] of mutations) {
      const path = join(runtime.directory, `${name}.ndjson`);
      await writeFile(path, value);
      await assert.rejects(readValidatedRuntimeJournal(path, ack.runtimeId), expected);
    }
    const empty = join(runtime.directory, "empty.ndjson");
    await writeFile(empty, "");
    assert.equal((await readValidatedRuntimeJournal(empty, ack.runtimeId)).head, 0);
    assert.deepEqual(validatePollCursor(null, null), { after: 0, limit: 100 });
    assert.throws(() => validatePollCursor("-1", null), /non-negative/);
    assert.throws(() => validatePollCursor("abc", null), /non-negative/);
    assert.throws(() => validatePollCursor("0", "201"), /no greater than 200/);
  } finally {
    await cleanup(runtime);
  }
});

async function manualCommand(
  store: DurableRuntimeCommandStore,
  runtimeId: string,
): Promise<{ record: RuntimeHostCommandRecord; loaded: Awaited<ReturnType<typeof loadOwnedSourceSession>>; analysis: ReturnType<typeof createProductionAnalysisRequest> }> {
  const loaded = await loadOwnedSourceSession(FIXTURE);
  const analysis = createProductionAnalysisRequest(loaded.session, {
    range: { startMs: 0, endMs: 1_000 },
    requestedSource: { mode: "declared", languages: ["ko"], reason: null },
    targetLanguage: "en",
    selectedLanguagePackId: "ko-v3",
    outputDepth: "evidence",
  });
  const command = createRuntimeStartCommand(loaded.session, analysis);
  const acceptedAt = "2026-07-15T12:00:00.000Z";
  const record: RuntimeHostCommandRecord = {
    schema: "studio.local-runtime-command.v1",
    producer: { id: "studio.local-runtime-host", version: "1" },
    commandId: command.commandId,
    requestContentId: `sha256:${canonicalSha256({ analysis, workPlan: command.workPlan })}`,
    sourceSessionId: loaded.session.sessionId,
    sourceRevisionId: loaded.session.revisionId,
    analysisRequestId: analysis.requestId,
    runtimeId,
    journalId: `journal:${runtimeId}`,
    acceptedAt,
    lifecycle: "initializing",
    lastTransitionAt: acceptedAt,
    reason: null,
    runStartReceiptContentId: null,
    forecastContentId: null,
    frozenForecastId: null,
    journalHead: 0,
  };
  assert.equal((await store.claim(record)).won, true);
  return { record, loaded, analysis };
}

test("recovery distinguishes claim, receipt, journal, launch, and nonterminal crash stages", async (suite) => {
  const cases = [
    ["claim before receipt", "host_stopped_before_start_receipt"],
    ["runtime directory before receipt", "host_stopped_before_start_receipt"],
    ["receipt before journal", "host_stopped_before_journal"],
    ["empty journal before launch", "host_stopped_before_executor_launch"],
    ["launch claim before first event", "executor_launch_unconfirmed"],
  ] as const;
  for (const [name, expectedCode] of cases) {
    await suite.test(name, async () => {
      const directory = await mkdtemp(join(tmpdir(), "studio-runtime-recovery-test-"));
      try {
        const store = await DurableRuntimeCommandStore.open(join(directory, "host"));
        const runtimeId = "runtime:22222222-2222-4222-8222-222222222222";
        const manual = await manualCommand(store, runtimeId);
        const paths = store.paths(runtimeId);
        if (name === "runtime directory before receipt") {
          await store.createRuntimeDirectory(runtimeId);
        } else if (name !== "claim before receipt") {
          await store.createRuntimeDirectory(runtimeId);
          const initialized = await initializeRuntimeApplication({
            ...paths,
            runtimeId,
            journalId: manual.record.journalId,
            acceptedBy: "operator:test",
            startedAt: manual.record.acceptedAt,
            loadedSource: manual.loaded,
            analysisRequest: manual.analysis,
          });
          if (name === "receipt before journal") await rm(paths.journalPath);
          if (name === "launch claim before first event") {
            assert.equal(await store.claimLaunch(manual.record.commandId, {
              schema: "studio.local-runtime-launch-claim.v1",
              hostInstanceId: "host:test",
              processId: 1,
              claimedAt: manual.record.acceptedAt,
            }), true);
          }
          assert.equal(initialized.runStart.runtimeId, runtimeId);
        }
        const sources = await RuntimeSourceRegistry.open({ sourceDirectories: [FIXTURE] });
        const service = await RuntimeStartService.open({
          store,
          sources,
          launcherFactory: new DeterministicRuntimeExecutor().factory(),
          recoverOnOpen: true,
        });
        const status = await service.statusByCommand(manual.record.commandId);
        assert.equal(status.lifecycle, "interrupted");
        assert.equal(status.reason?.code, expectedCode);
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    });
  }

  await suite.test("nonterminal journal after restart", async () => {
    const control = new DeterministicExecutionControl({ pauseMidRun: true });
    const runtime = await hostHarness({ control });
    try {
      const ack = await runtime.service.start(runtime.request);
      await waitForLifecycle(runtime.service, ack.commandId, "running");
      const restarted = await RuntimeStartService.open({
        store: runtime.store,
        sources: runtime.sources,
        launcherFactory: new DeterministicRuntimeExecutor().factory(),
        recoverOnOpen: true,
      });
      const status = await restarted.statusByCommand(ack.commandId);
      assert.equal(status.lifecycle, "interrupted");
      assert.equal(status.reason?.code, "nonterminal_journal_after_restart");
    } finally {
      await cleanup(runtime);
    }
  });
});

test("terminal evidence repairs stale lifecycle and failed/interrupted executors remain inspectable", async () => {
  const terminalRuntime = await hostHarness();
  try {
    const ack = await terminalRuntime.service.start(terminalRuntime.request);
    await waitForLifecycle(terminalRuntime.service, ack.commandId, "terminal");
    const record = (await terminalRuntime.store.read(ack.commandId))!;
    await terminalRuntime.store.replace({
      ...record,
      lifecycle: "initializing",
      reason: null,
      journalHead: 0,
    });
    const restarted = await RuntimeStartService.open({
      store: terminalRuntime.store,
      sources: terminalRuntime.sources,
      launcherFactory: new DeterministicRuntimeExecutor().factory(),
      recoverOnOpen: true,
    });
    assert.equal((await restarted.statusByCommand(ack.commandId)).lifecycle, "terminal");
  } finally {
    await cleanup(terminalRuntime);
  }

  for (const mode of ["failed", "timed_out", "interrupted"] as const) {
    const runtime = await hostHarness({ mode });
    try {
      const ack = await runtime.service.start(runtime.request);
      const expected = mode === "interrupted" ? "interrupted" : "failed";
      const status = await waitForLifecycle(runtime.service, ack.commandId, expected);
      assert.ok(status.reason);
      assert.ok(status.journalHead > 0);
      assert.equal(runtime.executor.launchInvocations, 1);
    } finally {
      await cleanup(runtime);
    }
  }
});

test("duplicate runtime directory and inconsistent command content fail closed without another launch", async () => {
  const runtime = await hostHarness();
  try {
    const allocated = "runtime:00000000-0000-4000-8000-000000000001";
    await mkdir(runtime.store.paths(allocated).runtimeRoot, { recursive: true });
    const failed = await runtime.service.start(runtime.request);
    assert.equal(failed.lifecycle, "failed");
    assert.equal(failed.reason?.code, "initialization_failed");
    assert.equal(runtime.executor.launchInvocations, 0);
  } finally {
    await cleanup(runtime);
  }

  const inconsistent = await hostHarness();
  try {
    const ack = await inconsistent.service.start(inconsistent.request);
    await waitForLifecycle(inconsistent.service, ack.commandId, "terminal");
    const commandFile = (await readdir(join(inconsistent.store.root, "commands"))).find((name) => /^[a-f0-9]{64}\.json$/.test(name))!;
    const path = join(inconsistent.store.root, "commands", commandFile);
    const record = JSON.parse(await readFile(path, "utf8")) as RuntimeHostCommandRecord;
    record.requestContentId = `sha256:${"f".repeat(64)}`;
    await writeFile(path, `${JSON.stringify(record, null, 2)}\n`);
    await assert.rejects(inconsistent.service.start(inconsistent.request), /already bound to different accepted content/);
    assert.equal(inconsistent.executor.launchInvocations, 1);
  } finally {
    await cleanup(inconsistent);
  }
});

test("the opt-in CLI smoke retains its explicit run-005 fixture while shared composition stays fixture-neutral", async () => {
  const packageValue = JSON.parse(await readFile(resolve("package.json"), "utf8")) as {
    scripts: Record<string, string>;
  };
  assert.match(packageValue.scripts["runtime:smoke:codex"], /--source-directory public\/demo\/runs\/run-005/);
  const cli = await readFile(resolve("scripts/run-local-worker.ts"), "utf8");
  const application = await readFile(
    resolve("src/studio/runtime/production/runtimeHost/runtimeApplication.ts"),
    "utf8",
  );
  assert.equal(cli.includes("run-005"), false);
  assert.equal(application.includes("run-005"), false);
});

test("HTTP adapter enforces loopback, token, origin, content, shape, and path-redaction boundaries", async () => {
  assert.throws(() => assertRuntimeHostBindAddress("0.0.0.0"), /unsafe-development/);
  assert.doesNotThrow(() => assertRuntimeHostBindAddress("0.0.0.0", true));

  const runtime = await hostHarness();
  const token = "t".repeat(64);
  const origin = "http://127.0.0.1:4321";
  assert.throws(
    () => createRuntimeHostHttpServer({ service: runtime.service, token, allowedOrigins: ["*"] }),
    /Wildcard Studio origins/,
  );
  const server = createRuntimeHostHttpServer({
    service: runtime.service,
    token,
    allowedOrigins: [origin],
    maximumBodyBytes: 2_048,
  });
  try {
    const address = await listenRuntimeHost(server, { port: 0 });
    const base = `http://${address.host}:${address.port}`;
    const authorized = { Authorization: `Bearer ${token}`, Origin: origin };
    const missingToken = await fetch(`${base}/v1/source-sessions`, { headers: { Origin: origin } });
    assert.equal(missingToken.status, 401);
    const badToken = await fetch(`${base}/v1/source-sessions`, { headers: { Authorization: "Bearer bad", Origin: origin } });
    assert.equal(badToken.status, 401);
    const badOrigin = await fetch(`${base}/v1/source-sessions`, { headers: { Authorization: `Bearer ${token}`, Origin: "http://evil.invalid" } });
    assert.equal(badOrigin.status, 403);
    assert.equal(badOrigin.headers.get("access-control-allow-origin"), null);

    const listed = await fetch(`${base}/v1/source-sessions`, { headers: authorized });
    assert.equal(listed.status, 200);
    assert.equal(listed.headers.get("access-control-allow-origin"), origin);
    const listedBody = await listed.json() as { sourceSessions: unknown[] };
    assert.equal(listedBody.sourceSessions.length, 1);
    assert.equal(JSON.stringify(listedBody).includes(FIXTURE), false);
    const unknownCommand = await fetch(`${base}/v1/runtime-starts/${encodeURIComponent(`runtime-start:${"f".repeat(64)}`)}`, { headers: authorized });
    assert.equal(unknownCommand.status, 404);

    const unsupported = await fetch(`${base}/v1/runtime-starts`, {
      method: "POST",
      headers: authorized,
      body: JSON.stringify(runtime.request),
    });
    assert.equal(unsupported.status, 415);
    const pathField = await fetch(`${base}/v1/runtime-starts`, {
      method: "POST",
      headers: { ...authorized, "Content-Type": "application/json" },
      body: JSON.stringify({ ...runtime.request, journalPath: "/tmp/client.ndjson" }),
    });
    assert.equal(pathField.status, 400);
    assert.equal((await pathField.json() as { error: { code: string } }).error.code, "invalid_start_request");
    const oversized = await fetch(`${base}/v1/runtime-starts`, {
      method: "POST",
      headers: { ...authorized, "Content-Type": "application/json" },
      body: JSON.stringify({ ...runtime.request, padding: "x".repeat(3_000) }),
    });
    assert.equal(oversized.status, 413);

    const started = await fetch(`${base}/v1/runtime-starts`, {
      method: "POST",
      headers: { ...authorized, "Content-Type": "application/json" },
      body: JSON.stringify(runtime.request),
    });
    assert.equal(started.status, 202);
    const ack = await started.json() as { commandId: string; runtimeId: string };
    const status = await fetch(`${base}/v1/runtime-starts/${encodeURIComponent(ack.commandId)}`, { headers: authorized });
    assert.equal(status.status, 200);
    const events = await fetch(`${base}/v1/runtimes/${encodeURIComponent(ack.runtimeId)}/events?after=0&limit=2`, { headers: authorized });
    assert.equal(events.status, 200);
    const publicBodies = JSON.stringify([ack, await status.json(), await events.json()]);
    assert.equal(publicBodies.includes(runtime.directory), false);
    assert.equal(publicBodies.includes(FIXTURE), false);

    const negative = await fetch(`${base}/v1/runtimes/${encodeURIComponent(ack.runtimeId)}/events?after=-1`, { headers: authorized });
    assert.equal(negative.status, 400);
    const unknownField = await fetch(`${base}/v1/runtimes/${encodeURIComponent(ack.runtimeId)}/events?path=/tmp/x`, { headers: authorized });
    assert.equal(unknownField.status, 400);
    const method = await fetch(`${base}/v1/source-sessions`, { method: "POST", headers: authorized });
    assert.equal(method.status, 405);
    await waitForLifecycle(runtime.service, ack.commandId, "terminal");
  } finally {
    await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
    await cleanup(runtime);
  }
});
