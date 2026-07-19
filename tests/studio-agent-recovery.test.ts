import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import { FileEventJournal, MemoryEventJournal, RuntimeLedger } from "../src/studio/runtime/production/journal.ts";
import type { ExecutorFailureCode, RuntimeProjection } from "../src/studio/runtime/production/model.ts";
import { projectRuntimeEvents } from "../src/studio/runtime/production/projection.ts";
import { interruptAmbiguousRuntime } from "../src/studio/runtime/production/recovery.ts";
import {
  GENERALIZED_BASELINE_RUN_BUDGET,
  GENERALIZED_INITIAL_COVERAGE_BUDGET,
  GENERALIZED_RECOVERY_CONTINGENCY_BUDGET,
  GENERALIZED_RUN_BUDGET,
} from "../src/studio/runtime/production/executor/generalizedBudgetContract.ts";
import { createAgentRecoveryPolicy } from "../src/studio/runtime/production/recovery/agentRecoveryPolicy.ts";
import { BoundedRuntimeScheduler } from "../src/studio/runtime/production/scheduler.ts";
import {
  DeterministicRuntimeExecutor,
  DurableRuntimeCommandStore,
  RuntimeSourceRegistry,
  RuntimeStartService,
  deterministicOrchestratorLauncherFactory,
  readValidatedRuntimeJournal,
} from "../src/studio/runtime/production/runtimeHost/index.ts";
import { PROOF_RUNTIME_LIMITS } from "../src/studio/runtime/production/runtimeHost/runtimeApplication.ts";
import type { DeterministicOrchestratorMode } from "../src/studio/runtime/production/runtimeHost/deterministicOrchestrator.ts";

const FIXTURE = resolve("public/demo/runs/run-005");
type RetryableCode = Extract<ExecutorFailureCode,
  "process_failed" | "executor_timed_out" | "required_tool_omitted" | "invalid_structured_output" | "provider_transport_failed">;

let runIndex = 0;

async function runRecovery(input: {
  code: RetryableCode;
  exhaust?: boolean;
  failAllInitial?: boolean;
}): Promise<{
  directory: string;
  store: DurableRuntimeCommandStore;
  runtimeId: string;
  lifecycle: string;
  state: RuntimeProjection;
  events: Awaited<ReturnType<RuntimeLedger["events"]>>;
}> {
  runIndex += 1;
  const directory = await mkdtemp(join(tmpdir(), "studio-agent-recovery-"));
  const store = await DurableRuntimeCommandStore.open(join(directory, "host"));
  const sources = await RuntimeSourceRegistry.open({ sourceDirectories: [FIXTURE] });
  const source = sources.list()[0];
  const runtimeId = `runtime:90000000-0000-4000-8000-${runIndex.toString().padStart(12, "0")}`;
  const executor = new DeterministicRuntimeExecutor(input.failAllInitial
    ? { mode: "failed" }
    : input.exhaust
      ? { exhaustInitialCoverageCode: input.code }
      : { failFirstInitialCoverageCode: input.code });
  const service = await RuntimeStartService.open({
    store,
    sources,
    launcherFactory: executor.factory(),
    orchestratorLauncherFactory: deterministicOrchestratorLauncherFactory({ mode: "spawn_one" }),
    runtimeIdForCommand: () => runtimeId,
    recoverOnOpen: false,
  });
  const started = await service.start({
    sourceSessionId: source.sourceSessionId,
    sourceRevisionId: source.sourceRevisionId,
    range: { startMs: 0, endMs: 1_000 },
    requestedSourceLanguage: { mode: "declared", languages: ["ko"], reason: null },
    targetLanguage: "en",
    selectedLanguagePackId: "ko-v3",
    outputDepth: "evidence",
  });
  const deadline = Date.now() + 10_000;
  let status = await service.statusByRuntime(started.runtimeId);
  while (!new Set(["terminal", "failed", "interrupted"]).has(status.lifecycle) && Date.now() < deadline) {
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 10));
    status = await service.statusByRuntime(started.runtimeId);
  }
  if (!new Set(["terminal", "failed", "interrupted"]).has(status.lifecycle)) {
    assert.fail(`recovery runtime for ${input.code} did not terminate`);
  }
  const loaded = await readValidatedRuntimeJournal(store.paths(runtimeId).journalPath, runtimeId);
  const ledger = await RuntimeLedger.open(runtimeId, new FileEventJournal(store.paths(runtimeId).journalPath));
  return { directory, store, runtimeId, lifecycle: status.lifecycle, state: loaded.state, events: await ledger.events() };
}

async function runEvidenceOutcome(mode: DeterministicOrchestratorMode): Promise<{
  directory: string;
  state: RuntimeProjection;
}> {
  runIndex += 1;
  const directory = await mkdtemp(join(tmpdir(), "studio-agent-recovery-evidence-outcome-"));
  const store = await DurableRuntimeCommandStore.open(join(directory, "host"));
  const sources = await RuntimeSourceRegistry.open({ sourceDirectories: [FIXTURE] });
  const source = sources.list()[0];
  const runtimeId = `runtime:a0000000-0000-4000-8000-${runIndex.toString().padStart(12, "0")}`;
  const service = await RuntimeStartService.open({
    store,
    sources,
    launcherFactory: new DeterministicRuntimeExecutor({
      restudyPassResult: mode === "restudy_exhausted" ? "withheld" : "supported",
    }).factory(),
    orchestratorLauncherFactory: deterministicOrchestratorLauncherFactory({ mode }),
    runtimeIdForCommand: () => runtimeId,
    recoverOnOpen: false,
  });
  await service.start({
    sourceSessionId: source.sourceSessionId,
    sourceRevisionId: source.sourceRevisionId,
    range: { startMs: 0, endMs: 1_000 },
    requestedSourceLanguage: { mode: "declared", languages: ["ko"], reason: null },
    targetLanguage: "en",
    selectedLanguagePackId: "ko-v3",
    outputDepth: "evidence",
  });
  const deadline = Date.now() + 10_000;
  let status = await service.statusByRuntime(runtimeId);
  while (!new Set(["terminal", "failed", "interrupted"]).has(status.lifecycle) && Date.now() < deadline) {
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 10));
    status = await service.statusByRuntime(runtimeId);
  }
  const loaded = await readValidatedRuntimeJournal(store.paths(runtimeId).journalPath, runtimeId);
  return { directory, state: loaded.state };
}

function normalizedGrants(task: RuntimeProjection["tasks"][string]) {
  return [...task.grants].sort((left, right) => left.capability.localeCompare(right.capability)).map((grant) => ({
    ...grant,
    id: "grant",
    taskId: "task",
    agentId: "agent",
  }));
}

async function cleanup(directory: string): Promise<void> {
  await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
}

test("retryable initial-coverage faults autonomously issue one exact replacement and preserve ordinary evidence closure", async (suite) => {
  const codes: RetryableCode[] = [
    "process_failed",
    "executor_timed_out",
    "required_tool_omitted",
    "invalid_structured_output",
    "provider_transport_failed",
  ];
  for (const code of codes) {
    await suite.test(code, async () => {
      const runtime = await runRecovery({ code });
      try {
        assert.equal(runtime.lifecycle, "terminal");
        const recoveries = Object.values(runtime.state.agentRecoveries);
        assert.equal(recoveries.length, 1);
        const recovery = recoveries[0];
        assert.equal(recovery.terminal?.outcome, "replacement_reported");
        assert.equal(recovery.authorization.failedAttempt.failureCode, code);
        assert.deepEqual(recovery.authorization.reservedSpend, GENERALIZED_INITIAL_COVERAGE_BUDGET);
        assert.deepEqual(recovery.authorization.policy.baselineBudget, GENERALIZED_BASELINE_RUN_BUDGET);
        assert.deepEqual(recovery.authorization.policy.recoveryContingency, GENERALIZED_RECOVERY_CONTINGENCY_BUDGET);
        assert.deepEqual(PROOF_RUNTIME_LIMITS.runBudget, GENERALIZED_RUN_BUDGET);

        const failed = runtime.state.tasks[recovery.authorization.failedAttempt.taskId];
        const replacement = runtime.state.tasks[recovery.authorization.replacement.taskId];
        assert.equal(failed.status, "failed");
        assert.equal(replacement.status, "completed");
        assert.notEqual(failed.id, replacement.id);
        assert.notEqual(failed.assignedAgentId, replacement.assignedAgentId);
        assert.deepEqual(replacement.mediaScope, failed.mediaScope);
        assert.deepEqual(replacement.inputArtifactIds, failed.inputArtifactIds);
        assert.deepEqual(replacement.requiredOutputs, failed.requiredOutputs);
        assert.deepEqual(replacement.dependencies, failed.dependencies);
        assert.deepEqual(replacement.budget, failed.budget);
        assert.deepEqual(normalizedGrants(replacement), normalizedGrants(failed));

        const root = runtime.state.tasks[recovery.authorization.parent.taskId];
        const originalChildren = Object.values(runtime.state.spawnRequests)
          .filter((request) => request.authoredByExecutionId === recovery.authorization.parent.executionId && request.accepted)
          .map((request) => runtime.state.tasks[request.taskId!]);
        assert.equal(originalChildren.length, 2);
        const healthy = originalChildren.find((task) => task.id !== failed.id)!;
        assert.equal(healthy.status, "completed");
        assert.equal(Object.values(runtime.state.taskLaunches).filter((launch) => launch.taskId === healthy.id).length, 1);
        assert.equal(Object.values(runtime.state.executions).filter((execution) => execution.taskId === healthy.id).length, 1);
        assert.equal(Object.values(runtime.state.tasks).filter((task) => task.parentTaskId === root.id).length, 3);

        const reportTaskIds = new Set(Object.values(runtime.state.reports).map((report) => report.taskId));
        assert.equal(reportTaskIds.has(failed.id), false);
        assert.equal(reportTaskIds.has(healthy.id), true);
        assert.equal(reportTaskIds.has(replacement.id), true);
        assert.equal(Object.keys(runtime.state.generalizedParentArtifactAdmissions).length, 2);
        assert.equal(Object.keys(runtime.state.generalizedParentArtifactReads).length, 2);
        assert.equal(Object.keys(runtime.state.generalizedOwnedMediaStudies).length, 1);
        assert.equal(Object.values(runtime.state.generalizedParentArtifactAdmissions).some((entry) => entry.childTaskId === failed.id), false);

        const wait = Object.values(runtime.state.reportWaits).find((entry) =>
          entry.children.some((child) => child.taskId === replacement.id));
        assert.equal(wait?.result, "all_terminal");
        assert.equal(wait?.failure, null);
        assert.equal(wait?.children.length, 3);
        assert.equal(wait?.children.find((child) => child.taskId === failed.id)?.status, "failed");

        for (let length = 1; length <= runtime.events.length; length += 1) {
          assert.doesNotThrow(() => projectRuntimeEvents(runtime.runtimeId, runtime.events.slice(0, length)));
        }
        const replayed = projectRuntimeEvents(runtime.runtimeId, runtime.events);
        assert.equal(Object.keys(replayed.agentRecoveries).length, 1);
        assert.equal(replayed.tasks[failed.id].terminalReason, failed.terminalReason);

        const tamperedWork = structuredClone(runtime.events);
        const authorization = tamperedWork.find((event) => event.type === "agent.recovery_authorized");
        assert.ok(authorization?.type === "agent.recovery_authorized");
        authorization.data.receipt.work.workId = `${authorization.data.receipt.work.workId}:forged`;
        assert.throws(() => projectRuntimeEvents(runtime.runtimeId, tamperedWork), /content-addressed identity/);

        const tamperedTask = structuredClone(runtime.events);
        const replacementCreated = tamperedTask.find((event) =>
          event.type === "task.created" && event.data.task.id === replacement.id);
        assert.ok(replacementCreated?.type === "task.created");
        replacementCreated.data.task.requiredOutputs[0].artifactKind = "forged-output";
        assert.throws(() => projectRuntimeEvents(runtime.runtimeId, tamperedTask), /broadened or changed failed work authority/);

        if (code === "process_failed") {
          const alteredContracts = [
            {
              name: "range",
              mutate(events: typeof runtime.events): void {
                const created = events.find((event) => event.type === "task.created" && event.data.task.id === replacement.id);
                assert.ok(created?.type === "task.created");
                created.data.task.mediaScope[0].endMs -= 1;
              },
            },
            {
              name: "capability",
              mutate(events: typeof runtime.events): void {
                const requested = events.find((event) =>
                  event.type === "spawn.requested" && event.data.requestId === recovery.authorization.replacement.spawnRequestId);
                assert.ok(requested?.type === "spawn.requested");
                requested.data.input.requiredCapabilities = requested.data.input.requiredCapabilities.slice(1);
              },
            },
            {
              name: "budget",
              mutate(events: typeof runtime.events): void {
                const created = events.find((event) => event.type === "task.created" && event.data.task.id === replacement.id);
                assert.ok(created?.type === "task.created");
                created.data.task.budget.wallMs += 1;
              },
            },
          ];
          for (const altered of alteredContracts) {
            const events = structuredClone(runtime.events);
            altered.mutate(events);
            assert.throws(
              () => projectRuntimeEvents(runtime.runtimeId, events),
              /recovery|broadened|authority|grant|budget|job context/,
              `${altered.name} authority must fail cold replay`,
            );
          }

          const authorizationIndex = runtime.events.findIndex((event) => event.type === "agent.recovery_authorized");
          assert.ok(authorizationIndex > 0);
          const boundaryJournal = new MemoryEventJournal();
          await boundaryJournal.appendBatch(runtime.events.slice(0, authorizationIndex));
          const boundaryLedger = await RuntimeLedger.open(runtime.runtimeId, boundaryJournal);
          const boundaryScheduler = new BoundedRuntimeScheduler(boundaryLedger, PROOF_RUNTIME_LIMITS, undefined, {
            agentRecovery: createAgentRecoveryPolicy({
              baselineBudget: GENERALIZED_BASELINE_RUN_BUDGET,
              recoveryContingency: GENERALIZED_RECOVERY_CONTINGENCY_BUDGET,
              replacementBudget: GENERALIZED_INITIAL_COVERAGE_BUDGET,
            }),
          });
          const stale = await boundaryScheduler.authorizeInitialCoverageRecovery("execution:stale-root", failed.id);
          assert.equal(stale.decision, "rejected");
          assert.equal(stale.rejection, "recovery_stale_or_ineligible");
          const concurrent = await Promise.all([
            boundaryScheduler.authorizeInitialCoverageRecovery(recovery.authorization.parent.executionId, failed.id),
            boundaryScheduler.authorizeInitialCoverageRecovery(recovery.authorization.parent.executionId, failed.id),
          ]);
          assert.equal(concurrent.filter((entry) => entry.decision === "authorized").length, 1);
          assert.equal(concurrent.filter((entry) => entry.rejection === "recovery_duplicate_work").length, 1);
          assert.equal(Object.keys(boundaryLedger.state().agentRecoveries).length, 1);
          assert.equal(Object.values(boundaryLedger.state().tasks).filter((task) =>
            task.parentTaskId === recovery.authorization.parent.taskId).length, 3);
          const equivalent = await boundaryScheduler.requestSpawn(
            recovery.authorization.parent.taskId,
            recovery.authorization.parent.agentId,
            recovery.authorization.work.initialInput,
            null,
          );
          assert.equal(equivalent.accepted, false);
          assert.equal(equivalent.rejection, "recovery_authority_required");
          const reorderedEquivalent = await boundaryScheduler.requestSpawn(
            recovery.authorization.parent.taskId,
            recovery.authorization.parent.agentId,
            {
              ...structuredClone(recovery.authorization.work.initialInput),
              workloadKey: "model-authored-equivalent-under-another-label",
              requiredCapabilities: [...recovery.authorization.work.initialInput.requiredCapabilities].reverse(),
            },
            null,
          );
          assert.equal(reorderedEquivalent.accepted, false);
          assert.equal(reorderedEquivalent.rejection, "recovery_authority_required");

          assert.equal(await interruptAmbiguousRuntime(boundaryLedger), true);
          const interruptedTaskCount = Object.keys(boundaryLedger.state().tasks).length;
          const restartedScheduler = new BoundedRuntimeScheduler(boundaryLedger, PROOF_RUNTIME_LIMITS, undefined, {
            agentRecovery: createAgentRecoveryPolicy({
              baselineBudget: GENERALIZED_BASELINE_RUN_BUDGET,
              recoveryContingency: GENERALIZED_RECOVERY_CONTINGENCY_BUDGET,
              replacementBudget: GENERALIZED_INITIAL_COVERAGE_BUDGET,
            }),
          });
          const afterRestart = await restartedScheduler.authorizeInitialCoverageRecovery(
            recovery.authorization.parent.executionId,
            failed.id,
          );
          assert.equal(afterRestart.decision, "rejected");
          assert.equal(afterRestart.rejection, "recovery_duplicate_work");
          assert.equal(Object.keys(boundaryLedger.state().tasks).length, interruptedTaskCount);
          assert.equal(Object.values(boundaryLedger.state().agentRecoveries)[0].terminal, null);
        }

        const reopened = await RuntimeLedger.open(runtime.runtimeId, new FileEventJournal(runtime.store.paths(runtime.runtimeId).journalPath));
        const scheduler = new BoundedRuntimeScheduler(reopened, PROOF_RUNTIME_LIMITS, undefined, {
          agentRecovery: createAgentRecoveryPolicy({
            baselineBudget: GENERALIZED_BASELINE_RUN_BUDGET,
            recoveryContingency: GENERALIZED_RECOVERY_CONTINGENCY_BUDGET,
            replacementBudget: GENERALIZED_INITIAL_COVERAGE_BUDGET,
          }),
        });
        const duplicate = await scheduler.authorizeInitialCoverageRecovery(
          recovery.authorization.parent.executionId,
          failed.id,
        );
        assert.equal(duplicate.decision, "rejected");
        assert.equal(duplicate.rejection, "recovery_duplicate_work");
        await assert.rejects(
          scheduler.claimTaskLaunch({
            requestId: recovery.authorization.replacement.spawnRequestId,
            taskId: replacement.id,
            agentId: replacement.assignedAgentId,
            registrationSecret: "forged-after-restart",
          }, "deterministic_test", "2026-07-18T00:00:00.000Z"),
          /permit is missing or invalid/,
        );
      } finally {
        await cleanup(runtime.directory);
      }
    });
  }
});

test("a failed replacement closes exhausted, withholds the root, and cannot create a third attempt", async () => {
  const runtime = await runRecovery({ code: "process_failed", exhaust: true });
  try {
    const recoveries = Object.values(runtime.state.agentRecoveries);
    assert.equal(recoveries.length, 1);
    const recovery = recoveries[0];
    assert.equal(recovery.terminal?.outcome, "exhausted");
    assert.equal(recovery.terminal?.attemptsConsumed, 2);
    assert.equal(recovery.terminal?.remainingAttempts, 0);
    assert.equal(recovery.terminal?.replacementReportId, null);
    assert.equal(runtime.state.tasks[recovery.authorization.failedAttempt.taskId].status, "failed");
    assert.equal(runtime.state.tasks[recovery.authorization.replacement.taskId].status, "failed");
    assert.equal(runtime.state.tasks[recovery.authorization.parent.taskId].status, "withheld");
    assert.equal(Object.values(runtime.state.tasks).filter((task) => task.parentTaskId === recovery.authorization.parent.taskId).length, 3);
    assert.equal(Object.keys(runtime.state.generalizedParentArtifactAdmissions).length, 0);
    assert.equal(Object.keys(runtime.state.generalizedOwnedMediaStudies).length, 0);
    const wait = Object.values(runtime.state.reportWaits).find((entry) =>
      entry.children.some((child) => child.taskId === recovery.authorization.replacement.taskId));
    assert.equal(wait?.result, "closed_failure");
    assert.equal(wait?.failure, "child_failed");
  } finally {
    await cleanup(runtime.directory);
  }
});

test("the explicit recovery contingency can be fully consumed but never escaped", async () => {
  const runtime = await runRecovery({ code: "process_failed", failAllInitial: true });
  try {
    const recoveries = Object.values(runtime.state.agentRecoveries);
    assert.equal(recoveries.length, 2);
    assert.ok(recoveries.every((entry) => entry.terminal?.outcome === "exhausted"));
    const reserved = recoveries.reduce(
      (sum, entry) => ({
        wallMs: sum.wallMs + entry.authorization.reservedSpend.wallMs,
        toolCalls: sum.toolCalls + entry.authorization.reservedSpend.toolCalls,
      }),
      { wallMs: 0, toolCalls: 0 },
    );
    assert.deepEqual(reserved, GENERALIZED_RECOVERY_CONTINGENCY_BUDGET);
    assert.equal(Object.values(runtime.state.tasks).filter((task) => task.parentTaskId !== null).length, 4);
    const root = Object.values(runtime.state.tasks).find((task) => task.parentTaskId === null)!;
    assert.equal(root.status, "withheld");
    assert.equal(Object.keys(runtime.state.generalizedParentArtifactAdmissions).length, 0);
    assert.equal(Object.keys(runtime.state.generalizedOwnedMediaStudies).length, 0);
  } finally {
    await cleanup(runtime.directory);
  }
});

test("weak/exhausted and conflicting evidence never enter execution recovery", async (suite) => {
  for (const mode of ["restudy_exhausted", "restudy_disagreement"] as const) {
    await suite.test(mode, async () => {
      const runtime = await runEvidenceOutcome(mode);
      try {
        assert.equal(Object.keys(runtime.state.agentRecoveries).length, 0);
        assert.equal(Object.keys(runtime.state.executorFailureClassifications).length, 0);
        if (mode === "restudy_exhausted") {
          assert.ok(Object.values(runtime.state.rangePasses).some((entry) => entry.terminal?.outcome === "withheld_exhausted"));
        } else {
          assert.ok(Object.values(runtime.state.generalizedOwnedMediaStudies).some((study) =>
            study.coverage.some((entry) => entry.preservedStates.includes("conflicting"))));
        }
      } finally {
        await cleanup(runtime.directory);
      }
    });
  }
});
