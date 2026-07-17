import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import { canonicalSha256 } from "../../../src/studio/runtime/production/artifactStore.ts";
import { createProductionAnalysisRequest } from "../../../src/studio/runtime/production/runStart/analysisRequest.ts";
import { createRuntimeStartCommand } from "../../../src/studio/runtime/production/runStart/runtimeStart.ts";
import { loadOwnedSourceSession } from "../../../src/studio/runtime/production/runStart/sourceSessionLoader.ts";
import {
  DurableRuntimeCommandStore,
  DeterministicExecutionControl,
  DeterministicRuntimeExecutor,
  RuntimeSourceRegistry,
  RuntimeStartService,
  readValidatedRuntimeJournal,
  validatePollCursor,
} from "../../../src/studio/runtime/production/runtimeHost/index.ts";
import type { RuntimeHostCommandRecord } from "../../../src/studio/runtime/production/runtimeHost/model.ts";
import { initializeRuntimeApplication } from "../../../src/studio/runtime/production/runtimeHost/runtimeApplication.ts";
import { cleanup, FIXTURE, hostHarness, waitForLifecycle } from "./harness.ts";

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
      assert.equal(runtime.executor.launchInvocations, 2);
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
    assert.equal(inconsistent.executor.launchInvocations, 2);
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
