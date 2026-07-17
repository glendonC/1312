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
import { adaptProductionRuntime } from "../src/studio/runtime/production/studioProjection.ts";
import { loadRuntimeInspectorJournal } from "../src/studio/runtime/production/runtimeInspector/journalLoader.ts";
import { createProductionAnalysisRequest } from "../src/studio/runtime/production/runStart/analysisRequest.ts";
import { createRuntimeStartCommand } from "../src/studio/runtime/production/runStart/runtimeStart.ts";
import { loadOwnedSourceSession } from "../src/studio/runtime/production/runStart/sourceSessionLoader.ts";
import {
  DurableRuntimeCommandStore,
  DeterministicExecutionControl,
  DeterministicRuntimeExecutor,
  OwnedMediaIngestService,
  RuntimeSourceRegistry,
  RuntimeStartService,
  assertRuntimeHostBindAddress,
  createRuntimeHostHttpServer,
  listenRuntimeHost,
  readValidatedRuntimeJournal,
  validatePollCursor,
} from "../src/studio/runtime/production/runtimeHost/index.ts";
import type {
  OwnedMediaIngestStatus,
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

function runtimeIds(): (commandId: string) => string {
  let count = 0;
  const identities = new Map<string, string>();
  return (commandId) => {
    const existing = identities.get(commandId);
    if (existing) return existing;
    count += 1;
    const identity = `runtime:00000000-0000-4000-8000-${count.toString().padStart(12, "0")}`;
    identities.set(commandId, identity);
    return identity;
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
    runtimeIdForCommand: runtimeIds(),
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
  await rm(harness.directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
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
    await assert.rejects(runtime.service.start(runtime.request), /no longer passes owned-source/);
    assert.equal((await runtime.store.list()).length, 0);
  } finally {
    await cleanup(runtime);
    await rm(source, { recursive: true, force: true });
  }
});

test.skip("legacy slice-2 polling assertions await study-first projection replacement", async () => {
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
    await assert.rejects(runtime.service.poll(ack.runtimeId, Number.MAX_SAFE_INTEGER, 1), /cursor is beyond/);

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
    assert.equal(await runtime.store.hasLaunchClaim(ack.commandId), true);
    const direct = await readValidatedRuntimeJournal(runtime.store.paths(ack.runtimeId).journalPath, ack.runtimeId);
    assert.deepEqual(collected, direct.events);
    assert.deepEqual(projectRuntimeEvents(ack.runtimeId, collected), direct.state);
    const roundTripTypes = [
      "spawn.requested",
      "spawn.decided",
      "executor.finished",
      "report.submitted",
      "report.decided",
      "root.output_disposition_recorded",
    ];
    const roundTripIndexes = roundTripTypes.map((type) =>
      direct.events.findIndex((event) => event.type === type));
    assert.ok(roundTripIndexes.every((index) => index >= 0));
    assert.deepEqual(roundTripIndexes, [...roundTripIndexes].sort((left, right) => left - right));
    const rootDispositionEvent = direct.events.find((event) =>
      event.type === "root.output_disposition_recorded");
    assert.ok(rootDispositionEvent?.type === "root.output_disposition_recorded");
    const rootDisposition = rootDispositionEvent.data.receipt;
    const childRegisteredIndex = direct.events.findIndex((event) =>
      event.type === "agent.registered" &&
      event.data.agent.id === rootDisposition.delegation.childAgentId);
    assert.ok(childRegisteredIndex > roundTripIndexes[1] && childRegisteredIndex < roundTripIndexes[2]);
    assert.equal(rootDisposition.schema, "studio.root-output-disposition.receipt.v1");
    assert.equal(rootDisposition.decision.outcome, "promoted_to_root");
    assert.equal(rootDisposition.delegation.workerKind, "analysis");
    assert.deepEqual(
      rootDisposition.delegation.grants,
      direct.state.tasks[rootDisposition.delegation.childTaskId].grants,
    );
    assert.deepEqual(
      rootDisposition.delegation.mediaScope,
      direct.state.tasks[rootDisposition.delegation.childTaskId].mediaScope,
    );
    assert.equal(rootDisposition.input.artifactId, direct.state.reports[rootDisposition.report.reportId].outputArtifactIds[0]);
    assert.equal(Object.keys(direct.state.rootOutputDispositions).length, 1);
    assert.equal(
      direct.state.rootOutputDispositions[rootDisposition.dispositionId].outputArtifactId,
      rootDispositionEvent.data.outputArtifactId,
    );
    const rootDispositionArtifact = direct.state.artifacts[rootDispositionEvent.data.outputArtifactId];
    assert.equal(rootDispositionArtifact.origin.kind, "root_output_disposition");
    assert.deepEqual(rootDispositionArtifact.sourceArtifactIds, [rootDisposition.input.artifactId]);
    assert.equal(rootDispositionArtifact.producerTaskId, rootDisposition.authority.rootTaskId);
    assert.equal(rootDispositionArtifact.producerAgentId, rootDisposition.authority.rootAgentId);
    const changedGrant = structuredClone(direct.events);
    const changedGrantEvent = changedGrant.find((event) =>
      event.type === "root.output_disposition_recorded");
    assert.ok(changedGrantEvent?.type === "root.output_disposition_recorded");
    const mediaGrant = changedGrantEvent.data.receipt.delegation.grants.find((grant) =>
      grant.capability === "media.seek");
    assert.ok(mediaGrant?.mediaScope[0]);
    mediaGrant.mediaScope[0].startMs += 1;
    assert.throws(
      () => projectRuntimeEvents(ack.runtimeId, changedGrant),
      /changed spawn, scope, or grant lineage/,
    );
    const changedArtifactIdentity = structuredClone(direct.events);
    const changedArtifactEvent = changedArtifactIdentity.find((event) =>
      event.type === "root.output_disposition_recorded");
    assert.ok(changedArtifactEvent?.type === "root.output_disposition_recorded");
    changedArtifactEvent.data.receipt.input.contentId = `sha256:${"0".repeat(64)}`;
    assert.throws(
      () => projectRuntimeEvents(ack.runtimeId, changedArtifactIdentity),
      /changed child output identity/,
    );
    const inspector = await loadRuntimeInspectorJournal(
      await readFile(runtime.store.paths(ack.runtimeId).journalPath, "utf8"),
    );
    assert.equal(inspector.projection.runId, ack.runtimeId);
    assert.equal(inspector.projection.lastSeq, cursor);
    assert.equal(inspector.projection.tasks.length, 2);
    assert.equal(inspector.projection.workers.length, 2);
    assert.deepEqual(
      inspector.projection.grants.map((grant) => grant.capability).sort(),
      ["analysis.evidence.assess", "analysis.evidence.decide", "evidence.read", "media.seek", "report.submit", "task.reports.wait", "task.spawn.request"],
    );
    assert.equal(inspector.projection.reports.length, 1);
    assert.equal(inspector.projection.reports[0].status, "accepted");
    assert.equal(inspector.projection.spawnRequests.length, 1);
    assert.equal(inspector.projection.spawnRequests[0].decision, "accepted");
    assert.equal(inspector.projection.spawnRequests[0].requestedByTaskId, inspector.projection.tasks[0].taskId);
    assert.deepEqual(
      inspector.projection.spawnRequests[0].requiredCapabilities,
      ["analysis.evidence.assess", "analysis.evidence.decide", "evidence.read", "media.seek", "report.submit"],
    );
    assert.equal(inspector.projection.operations.length, 1);
    assert.equal(inspector.projection.operations[0].capability, "media.seek");
    assert.equal(inspector.projection.operations[0].status, "completed");
    assert.equal(inspector.projection.operations[0].observation?.kind, "audio_activity");
    assert.equal(inspector.projection.operations[0].observation?.value, "signal");
    assert.deepEqual(inspector.projection.operations[0].observation?.range, { startMs: 0, endMs: 1_000 });
    assert.equal(inspector.projection.evidenceArtifacts.length, 2);
    assert.deepEqual(
      inspector.projection.evidenceArtifacts.map((artifact) => artifact.evidenceKind).sort(),
      ["language_ranges", "speech_activity"],
    );
    assert.equal(inspector.projection.evidenceReads.length, 2);
    assert.ok(inspector.projection.evidenceReads.every((read) =>
      read.status === "completed" &&
      read.returnedItems !== null &&
      read.returnedFactBytes !== null &&
      read.returnedFactBytes <= read.maxBytes &&
      read.returnedItems <= read.maxItems &&
      read.receiptId !== null &&
      read.receiptContentId !== null));
    const evidenceGrant = inspector.projection.grants.find((grant) => grant.capability === "evidence.read");
    assert.ok(evidenceGrant);
    assert.equal(evidenceGrant.evidenceScope.length, 2);
    assert.ok(evidenceGrant.evidenceScope.every((scope) =>
      scope.sourceArtifactId === inspector.projection.sourceArtifacts[0].artifactId &&
      scope.startMs === 0 &&
      scope.endMs === 1_000 &&
      scope.maxBytes === 32 * 1024 &&
      scope.maxItems === 64));
    const completedReads = direct.events.filter((event) => event.type === "evidence.read_completed");
    assert.equal(completedReads.length, 2);
    assert.ok(completedReads.every((event) =>
      event.data.receipt.authorization.startMs === 0 &&
      event.data.receipt.authorization.endMs === 1_000 &&
      event.data.receipt.facts.every((fact) => fact.startMs >= 0 && fact.endMs <= 1_000)));
    assert.equal(inspector.projection.evidenceAssessments.length, 1);
    const assessment = inspector.projection.evidenceAssessments[0];
    assert.equal(assessment.status, "completed");
    assert.equal(assessment.readReceiptIds.length, 2);
    assert.equal(assessment.claimCount, 2);
    assert.ok(assessment.citationCount !== null && assessment.citationCount <= assessment.maxCitations);
    assert.ok(assessment.tokenCount !== null && assessment.tokenCount <= assessment.maxTokens);
    const assessmentGrant = inspector.projection.grants.find((grant) => grant.capability === "analysis.evidence.assess");
    assert.ok(assessmentGrant?.assessmentScope);
    assert.equal(assessmentGrant.assessmentScope.maxAssessments, 1);
    assert.equal(assessmentGrant.assessmentScope.maxClaims, 8);
    assert.equal(assessmentGrant.assessmentScope.maxCitations, 32);
    assert.equal(assessmentGrant.assessmentScope.maxTokens, 512);
    assert.equal(inspector.projection.assessmentArtifacts.length, 1);
    assert.equal(inspector.projection.assessmentArtifacts[0].receiptId, assessment.receiptId);
    assert.equal(inspector.projection.evidenceDecisions.length, 1);
    const decision = inspector.projection.evidenceDecisions[0];
    assert.equal(decision.status, "completed");
    assert.deepEqual(decision.assessmentOperationIds, [assessment.operationId]);
    assert.equal(decision.outcome === "withheld" || decision.outcome === "proceed_to_publish_review", true);
    assert.ok(decision.reasonCodes.length > 0);
    const decisionGrant = inspector.projection.grants.find((grant) => grant.capability === "analysis.evidence.decide");
    assert.ok(decisionGrant?.decisionScope);
    assert.equal(decisionGrant.decisionScope.maxDecisions, 1);
    assert.equal(decisionGrant.decisionScope.maxAuditedAssessments, 4);
    assert.equal(inspector.projection.decisionArtifacts.length, 1);
    assert.equal(inspector.projection.decisionArtifacts[0].receiptId, decision.receiptId);
    assert.equal(inspector.projection.publishReviewIntakes.length, 1);
    assert.equal(inspector.projection.publishReviewIntakes[0].status, "completed");
    assert.equal(inspector.projection.publishReviewIntakes[0].outcome, "queued");
    assert.deepEqual(inspector.projection.publishReviewIntakes[0].reasonCodes, [
      "all_audited_claims_supported",
    ]);
    assert.equal(inspector.projection.publishReviewIntakeArtifacts.length, 1);
    assert.equal(
      inspector.projection.publishReviewIntakeArtifacts[0].readinessArtifactId,
      inspector.projection.studyReadiness[0].artifactId,
    );
    assert.equal(inspector.projection.outputArtifacts.length, 2);
    const workerOutput = inspector.projection.outputArtifacts.find((artifact) => artifact.origin.kind === "worker_output");
    const seekObservation = inspector.projection.outputArtifacts.find((artifact) => artifact.origin.kind === "media_observation");
    assert.ok(workerOutput);
    assert.ok(seekObservation);
    assert.equal(workerOutput.kind, "worker-execution-report");
    assert.deepEqual(workerOutput.sourceArtifactIds, []);
    assert.deepEqual(seekObservation.sourceArtifactIds, [inspector.projection.sourceArtifacts[0].artifactId]);
    assert.deepEqual(
      workerOutput.reportIds,
      [inspector.projection.reports[0].reportId],
    );
    assert.deepEqual(seekObservation.reportIds, []);

    const assessmentAudit = await runtime.service.assessmentAudits(ack.runtimeId);
    assert.equal(assessmentAudit.schema, "studio.local-runtime-assessment-audits.v1");
    assert.equal(assessmentAudit.commandId, ack.commandId);
    assert.equal(assessmentAudit.journalHead, cursor);
    assert.equal(assessmentAudit.audits.length, 1);
    assert.equal(assessmentAudit.audits[0].integrity, "stored_receipt_and_citations_verified");
    assert.equal(assessmentAudit.audits[0].claims.length, 2);
    assert.ok(assessmentAudit.audits[0].claims.every((claim) =>
      claim.range.endMs > claim.range.startMs &&
      claim.states.length > 0 &&
      claim.citations.length > 0 &&
      claim.citations.every((citation) =>
        citation.receiptId.startsWith("evidence-read:") &&
        citation.receiptContentId.startsWith("sha256:") &&
        citation.factIndexes.length > 0)));
    const completedAssessmentEvent = direct.events.find((event) =>
      event.type === "analysis.evidence.assessment_completed");
    assert.ok(completedAssessmentEvent?.type === "analysis.evidence.assessment_completed");
    assert.deepEqual(
      assessmentAudit.audits[0].claims.map((claim) => ({
        claimIndex: claim.claimIndex,
        kind: claim.kind,
        value: claim.value,
        range: claim.range,
        states: claim.states,
        citations: claim.citations.map(({ receiptId, receiptContentId, factIndexes }) => ({
          receiptId,
          receiptContentId,
          factIndexes,
        })),
      })),
      completedAssessmentEvent.data.receipt.claims,
    );
    const decisionReceipts = await runtime.service.decisionReceipts(ack.runtimeId);
    assert.equal(decisionReceipts.schema, "studio.local-runtime-decision-receipts.v1");
    assert.equal(decisionReceipts.commandId, ack.commandId);
    assert.equal(decisionReceipts.journalHead, cursor);
    assert.equal(decisionReceipts.decisions.length, 1);
    assert.equal(decisionReceipts.decisions[0].integrity, "stored_decision_and_audited_inputs_verified");
    assert.equal(decisionReceipts.decisions[0].producer, "deterministic_audit_state_gate_v1");
    assert.equal(decisionReceipts.decisions[0].outcome, decision.outcome);
    assert.deepEqual(decisionReceipts.decisions[0].reasonCodes, decision.reasonCodes);
    assert.deepEqual(decisionReceipts.decisions[0].inputs, [{
      operationId: assessment.operationId,
      artifactId: assessment.outputArtifactId,
      receiptId: assessment.receiptId,
      receiptContentId: assessment.receiptContentId,
    }]);
    const publishReviewIntakes = await runtime.service.publishReviewIntakes(ack.runtimeId);
    assert.equal(publishReviewIntakes.schema, "studio.local-runtime-publish-review-intakes.v1");
    assert.equal(publishReviewIntakes.commandId, ack.commandId);
    assert.equal(publishReviewIntakes.journalHead, cursor);
    assert.equal(publishReviewIntakes.intakes.length, 1);
    assert.equal(publishReviewIntakes.intakes[0].integrity, "stored_intake_and_verified_study_readiness");
    assert.equal(publishReviewIntakes.intakes[0].producer, "host_publish_review_intake_v1");
    assert.equal(publishReviewIntakes.intakes[0].outcome, "queued");
    assert.deepEqual(publishReviewIntakes.intakes[0].reasonCodes, []);
    assert.deepEqual(publishReviewIntakes.intakes[0].readiness, {
      readinessId: inspector.projection.studyReadiness[0].readinessId,
      artifactId: inspector.projection.studyReadiness[0].artifactId,
      receiptId: inspector.projection.studyReadiness[0].receiptId,
      receiptContentId: inspector.projection.studyReadiness[0].receiptContentId,
    });

    const reopened = await RuntimeStartService.open({
      store: runtime.store,
      sources: runtime.sources,
      launcherFactory: new DeterministicRuntimeExecutor().factory(),
      recoverOnOpen: true,
    });
    const continued = await reopened.poll(ack.runtimeId, cursor, 3);
    assert.deepEqual(continued.events, []);
    assert.equal(continued.nextCursor, cursor);
    assert.deepEqual(await reopened.assessmentAudits(ack.runtimeId), assessmentAudit);
    assert.deepEqual(await reopened.decisionReceipts(ack.runtimeId), decisionReceipts);
    assert.deepEqual(await reopened.publishReviewIntakes(ack.runtimeId), publishReviewIntakes);
  } finally {
    await cleanup(runtime);
  }
});

test("verified queued intake can be approved once and revoked only by a separate immutable receipt", async () => {
  const runtime = await hostHarness();
  try {
    const acknowledgement = await runtime.service.start(runtime.request);
    await waitForLifecycle(runtime.service, acknowledgement.commandId, "terminal");
    const intakeResponse = await runtime.service.publishReviewIntakes(acknowledgement.runtimeId);
    const intake = intakeResponse.intakes[0];
    assert.ok(intake);
    const empty = await runtime.service.publishReviewDecisions(acknowledgement.runtimeId);
    assert.deepEqual(empty.reviews, []);
    assert.deepEqual(empty.reviewer, {
      id: "reviewer:local-operator",
      label: "Local review operator",
      decisionAttestation: "I attest that I am the named reviewer and made this review decision.",
      revocationAttestation: "I attest that I am the named reviewer and made this revocation decision.",
    });

    const approved = await runtime.service.createPublishReviewDecision(acknowledgement.runtimeId, {
      intake: {
        intakeId: intake.intakeId,
        artifactId: intake.artifactId,
        receiptId: intake.receiptId,
        receiptContentId: intake.receiptContentId,
      },
      reviewer: {
        id: empty.reviewer.id,
        attestation: empty.reviewer.decisionAttestation,
      },
      decision: {
        outcome: "approve_for_caption_production",
        reasonCodes: ["reviewer_attested_caption_production_may_proceed"],
        note: "Ready for a future bounded caption producer.",
      },
    });
    assert.equal(approved.reviews.length, 1);
    assert.equal(approved.reviews[0].state, "approved_for_caption_production");
    assert.equal(approved.reviews[0].outcome, "approve_for_caption_production");
    assert.equal(approved.reviews[0].reviewer.id, empty.reviewer.id);
    assert.equal(approved.reviews[0].revocation, null);

    const approval = approved.reviews[0];
    const revoked = await runtime.service.createPublishReviewRevocation(acknowledgement.runtimeId, {
      approval: {
        reviewId: approval.reviewId,
        artifactId: approval.artifactId,
        receiptId: approval.receiptId,
        receiptContentId: approval.receiptContentId,
      },
      reviewer: {
        id: approved.reviewer.id,
        attestation: approved.reviewer.revocationAttestation,
      },
      revocation: {
        reasonCodes: ["new_review_required"],
        note: "New review is required before any caption producer may consume approval.",
      },
    });
    assert.equal(revoked.reviews[0].state, "approval_revoked");
    assert.equal(revoked.reviews[0].revocation?.integrity, "stored_revocation_and_verified_approval");
    assert.deepEqual(revoked.reviews[0].revocation?.reasonCodes, ["new_review_required"]);

    const journal = await readValidatedRuntimeJournal(
      runtime.store.paths(acknowledgement.runtimeId).journalPath,
      acknowledgement.runtimeId,
    );
    assert.equal(Object.keys(journal.state.publishReviewDecisions).length, 1);
    assert.equal(Object.keys(journal.state.publishReviewRevocations).length, 1);
    assert.equal(Object.values(journal.state.publishReviewDecisions)[0].status, "completed");
    assert.equal(Object.values(journal.state.publishReviewRevocations)[0].status, "completed");
    assert.equal(journal.events.filter((event) => event.type === "publish.review.decision_started").length, 1);
    assert.equal(journal.events.filter((event) => event.type === "publish.review.decision_completed").length, 1);
    assert.equal(journal.events.filter((event) => event.type === "publish.review.revocation_started").length, 1);
    assert.equal(journal.events.filter((event) => event.type === "publish.review.revocation_completed").length, 1);
    const productProjection = adaptProductionRuntime(journal.state);
    assert.equal(productProjection.publishReviewDecisions[0].outcome, "approve_for_caption_production");
    assert.equal(productProjection.publishReviewRevocations[0].status, "completed");
    assert.equal(productProjection.publishReviewDecisionArtifacts.length, 1);
    assert.equal(productProjection.publishReviewRevocationArtifacts.length, 1);
  } finally {
    await cleanup(runtime);
  }
});

test("rejected review cannot be replaced by approval and forged reviewer or open input is rejected", async () => {
  const runtime = await hostHarness();
  try {
    const acknowledgement = await runtime.service.start(runtime.request);
    await waitForLifecycle(runtime.service, acknowledgement.commandId, "terminal");
    const intake = (await runtime.service.publishReviewIntakes(acknowledgement.runtimeId)).intakes[0];
    const authority = (await runtime.service.publishReviewDecisions(acknowledgement.runtimeId)).reviewer;
    const identity = {
      intakeId: intake.intakeId,
      artifactId: intake.artifactId,
      receiptId: intake.receiptId,
      receiptContentId: intake.receiptContentId,
    };

    await assert.rejects(
      runtime.service.createPublishReviewDecision(acknowledgement.runtimeId, {
        intake: identity,
        reviewer: { id: "reviewer:forged", attestation: authority.decisionAttestation },
        decision: {
          outcome: "reject_with_reasons",
          reasonCodes: ["evidence_requires_additional_review"],
          note: null,
        },
      }),
      /does not match this host's configured review operator/,
    );
    await assert.rejects(
      runtime.service.createPublishReviewDecision(acknowledgement.runtimeId, {
        intake: identity,
        reviewer: { id: authority.id, attestation: authority.decisionAttestation },
        decision: {
          outcome: "reject_with_reasons",
          reasonCodes: ["evidence_requires_additional_review"],
          note: null,
        },
        captions: "caller-authored output is forbidden",
      }),
      /invalid or contains open fields/,
    );

    const rejected = await runtime.service.createPublishReviewDecision(acknowledgement.runtimeId, {
      intake: identity,
      reviewer: { id: authority.id, attestation: authority.decisionAttestation },
      decision: {
        outcome: "reject_with_reasons",
        reasonCodes: ["evidence_requires_additional_review"],
        note: "The rejection remains visible.",
      },
    });
    assert.equal(rejected.reviews[0].state, "rejected");
    await assert.rejects(
      runtime.service.createPublishReviewDecision(acknowledgement.runtimeId, {
        intake: identity,
        reviewer: { id: authority.id, attestation: authority.decisionAttestation },
        decision: {
          outcome: "approve_for_caption_production",
          reasonCodes: ["reviewer_attested_caption_production_may_proceed"],
          note: null,
        },
      }),
      /already has immutable review decision lineage/,
    );
    assert.equal((await runtime.service.publishReviewDecisions(acknowledgement.runtimeId)).reviews[0].state, "rejected");
  } finally {
    await cleanup(runtime);
  }
});

test("publish-review read fails closed when stored human decision bytes are tampered", async () => {
  const runtime = await hostHarness();
  try {
    const acknowledgement = await runtime.service.start(runtime.request);
    await waitForLifecycle(runtime.service, acknowledgement.commandId, "terminal");
    const intake = (await runtime.service.publishReviewIntakes(acknowledgement.runtimeId)).intakes[0];
    const authority = (await runtime.service.publishReviewDecisions(acknowledgement.runtimeId)).reviewer;
    const reviewed = await runtime.service.createPublishReviewDecision(acknowledgement.runtimeId, {
      intake: {
        intakeId: intake.intakeId,
        artifactId: intake.artifactId,
        receiptId: intake.receiptId,
        receiptContentId: intake.receiptContentId,
      },
      reviewer: { id: authority.id, attestation: authority.decisionAttestation },
      decision: {
        outcome: "approve_for_caption_production",
        reasonCodes: ["reviewer_attested_caption_production_may_proceed"],
        note: null,
      },
    });
    const digest = reviewed.reviews[0].receiptContentId.replace("sha256:", "");
    const objectPath = join(
      runtime.store.paths(acknowledgement.runtimeId).artifactStoreRoot,
      "objects",
      "sha256",
      digest.slice(0, 2),
      digest,
    );
    await writeFile(objectPath, "{}\n", "utf8");
    await assert.rejects(
      runtime.service.publishReviewDecisions(acknowledgement.runtimeId),
      /failed closed validation/,
    );
  } finally {
    await cleanup(runtime);
  }
});

test.skip("assessment audit fails closed after restart for stored-byte, content, receipt-lineage, or journal drift", async () => {
  const runtime = await hostHarness();
  try {
    const ack = await runtime.service.start(runtime.request);
    await waitForLifecycle(runtime.service, ack.commandId, "terminal");
    const paths = runtime.store.paths(ack.runtimeId);
    const journal = await readValidatedRuntimeJournal(paths.journalPath, ack.runtimeId);
    const healthy = await runtime.service.assessmentAudits(ack.runtimeId);
    assert.equal(healthy.audits.length, 1);
    const healthyDecision = await runtime.service.decisionReceipts(ack.runtimeId);
    assert.equal(healthyDecision.decisions.length, 1);
    const healthyIntake = await runtime.service.publishReviewIntakes(ack.runtimeId);
    assert.equal(healthyIntake.intakes.length, 1);
    const receiptContentId = healthy.audits[0].receiptContentId;
    const receiptDigest = receiptContentId.slice("sha256:".length);
    const receiptPath = join(
      paths.artifactStoreRoot,
      "objects",
      "sha256",
      receiptDigest.slice(0, 2),
      receiptDigest,
    );
    const originalReceiptBytes = await readFile(receiptPath);

    await appendFile(receiptPath, "tampered");
    const reopenedAfterTamper = await RuntimeStartService.open({
      store: runtime.store,
      sources: runtime.sources,
      launcherFactory: new DeterministicRuntimeExecutor().factory(),
      recoverOnOpen: true,
    });
    await assert.rejects(
      reopenedAfterTamper.assessmentAudits(ack.runtimeId),
      (error: unknown) => (error as { code?: string }).code === "stored_content_inconsistent",
    );
    await assert.rejects(
      reopenedAfterTamper.decisionReceipts(ack.runtimeId),
      (error: unknown) => (error as { code?: string }).code === "stored_content_inconsistent",
    );
    await assert.rejects(
      reopenedAfterTamper.publishReviewIntakes(ack.runtimeId),
      (error: unknown) => (error as { code?: string }).code === "stored_content_inconsistent",
    );
    await writeFile(receiptPath, originalReceiptBytes);
    assert.equal((await reopenedAfterTamper.assessmentAudits(ack.runtimeId)).audits.length, 1);

    const decisionContentId = healthyDecision.decisions[0].receiptContentId;
    const decisionDigest = decisionContentId.slice("sha256:".length);
    const decisionPath = join(
      paths.artifactStoreRoot,
      "objects",
      "sha256",
      decisionDigest.slice(0, 2),
      decisionDigest,
    );
    const originalDecisionBytes = await readFile(decisionPath);
    await appendFile(decisionPath, "tampered");
    await assert.rejects(
      reopenedAfterTamper.decisionReceipts(ack.runtimeId),
      (error: unknown) => (error as { code?: string }).code === "stored_content_inconsistent",
    );
    await assert.rejects(
      reopenedAfterTamper.publishReviewIntakes(ack.runtimeId),
      (error: unknown) => (error as { code?: string }).code === "stored_content_inconsistent",
    );
    await writeFile(decisionPath, originalDecisionBytes);
    assert.equal((await reopenedAfterTamper.decisionReceipts(ack.runtimeId)).decisions.length, 1);

    const intakeContentId = healthyIntake.intakes[0].receiptContentId;
    const intakeDigest = intakeContentId.slice("sha256:".length);
    const intakePath = join(
      paths.artifactStoreRoot,
      "objects",
      "sha256",
      intakeDigest.slice(0, 2),
      intakeDigest,
    );
    const originalIntakeBytes = await readFile(intakePath);
    await appendFile(intakePath, "tampered");
    await assert.rejects(
      reopenedAfterTamper.publishReviewIntakes(ack.runtimeId),
      (error: unknown) => (error as { code?: string }).code === "stored_content_inconsistent",
    );
    await writeFile(intakePath, originalIntakeBytes);
    assert.equal((await reopenedAfterTamper.publishReviewIntakes(ack.runtimeId)).intakes.length, 1);

    const originalJournal = await readFile(paths.journalPath, "utf8");
    const assessmentArtifactEvent = journal.events.find((event) =>
      event.type === "artifact.recorded" && event.data.artifact.origin.kind === "evidence_assessment");
    const assessmentCompletion = journal.events.find((event) =>
      event.type === "analysis.evidence.assessment_completed");
    const readCompletion = journal.events.find((event) => event.type === "evidence.read_completed");
    assert.ok(assessmentArtifactEvent?.type === "artifact.recorded");
    assert.ok(assessmentCompletion?.type === "analysis.evidence.assessment_completed");
    assert.ok(readCompletion?.type === "evidence.read_completed");

    const expectJournalAuditFailure = async (
      mutate: (events: Array<Record<string, unknown>>) => void,
    ): Promise<void> => {
      const events = structuredClone(journal.events) as unknown as Array<Record<string, unknown>>;
      mutate(events);
      await writeFile(paths.journalPath, `${events.map((event) => JSON.stringify(event)).join("\n")}\n`);
      await assert.rejects(
        runtime.service.assessmentAudits(ack.runtimeId),
        (error: unknown) => ["stored_content_inconsistent", "invalid_journal_chain"].includes(
          (error as { code?: string }).code ?? "",
        ),
      );
      await writeFile(paths.journalPath, originalJournal);
      assert.equal((await runtime.service.assessmentAudits(ack.runtimeId)).audits.length, 1);
    };

    await expectJournalAuditFailure((events) => {
      const artifactEvent = events.find((event) => event.type === "artifact.recorded" &&
        (event.data as { artifact?: { origin?: { kind?: string } } }).artifact?.origin?.kind === "evidence_assessment") as {
          data: { artifact: { content: { digest: string; contentId: string; bytes: number }; storageKey: string; origin: { receiptContentId: string } } };
        };
      const completion = events.find((event) => event.type === "analysis.evidence.assessment_completed") as {
        data: { receiptContentId: string };
      };
      const read = readCompletion.data.receiptContentId;
      const digest = read.slice("sha256:".length);
      artifactEvent.data.artifact.content.digest = digest;
      artifactEvent.data.artifact.content.contentId = read;
      artifactEvent.data.artifact.content.bytes = Buffer.byteLength(JSON.stringify(readCompletion.data.receipt));
      artifactEvent.data.artifact.storageKey = `objects/sha256/${digest.slice(0, 2)}/${digest}`;
      artifactEvent.data.artifact.origin.receiptContentId = read;
      completion.data.receiptContentId = read;
    });

    await expectJournalAuditFailure((events) => {
      const artifactEvent = events.find((event) => event.type === "artifact.recorded" &&
        (event.data as { artifact?: { origin?: { kind?: string } } }).artifact?.origin?.kind === "evidence_assessment") as {
          data: { artifact: { origin: { readReceiptIds: string[] } } };
        };
      artifactEvent.data.artifact.origin.readReceiptIds[0] = "evidence-read:out-of-lineage";
    });

    await expectJournalAuditFailure((events) => {
      const completion = events.find((event) => event.type === "analysis.evidence.assessment_completed") as {
        data: { receipt: { claims: Array<{ range: { startMs: number } }> } };
      };
      completion.data.receipt.claims[0].range.startMs += 1;
    });
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

    const preflight = await fetch(`${base}/v1/source-sessions`, {
      method: "OPTIONS",
      headers: {
        Origin: origin,
        "Access-Control-Request-Method": "GET",
        "Access-Control-Request-Headers": "authorization",
      },
    });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get("content-length"), null);
    assert.equal(await preflight.text(), "");
    assert.equal(preflight.headers.get("access-control-allow-origin"), origin);

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

    const planned = await fetch(`${base}/v1/runtime-plans`, {
      method: "POST",
      headers: { ...authorized, "Content-Type": "application/json" },
      body: JSON.stringify(runtime.request),
    });
    assert.equal(planned.status, 200);
    const planBody = await planned.json() as {
      commandId: string;
      runtimeId: string;
      forecast: { content: { contentId: string } };
      acceptance: { status: string; frozenForecastId: null };
    };
    assert.equal(planBody.acceptance.status, "not_started");
    assert.equal(planBody.acceptance.frozenForecastId, null);
    assert.equal((await runtime.store.list()).length, 0);

    const started = await fetch(`${base}/v1/runtime-starts`, {
      method: "POST",
      headers: { ...authorized, "Content-Type": "application/json" },
      body: JSON.stringify(runtime.request),
    });
    assert.equal(started.status, 202);
    const ack = await started.json() as {
      commandId: string;
      runtimeId: string;
      forecast: { contentId: string };
    };
    assert.equal(ack.commandId, planBody.commandId);
    assert.equal(ack.runtimeId, planBody.runtimeId);
    assert.equal(ack.forecast.contentId, planBody.forecast.content.contentId);
    const status = await fetch(`${base}/v1/runtime-starts/${encodeURIComponent(ack.commandId)}`, { headers: authorized });
    assert.equal(status.status, 200);
    const events = await fetch(`${base}/v1/runtimes/${encodeURIComponent(ack.runtimeId)}/events?after=0&limit=2`, { headers: authorized });
    assert.equal(events.status, 200);
    const publicBodies = JSON.stringify([planBody, ack, await status.json(), await events.json()]);
    assert.equal(publicBodies.includes(runtime.directory), false);
    assert.equal(publicBodies.includes(FIXTURE), false);

    const negative = await fetch(`${base}/v1/runtimes/${encodeURIComponent(ack.runtimeId)}/events?after=-1`, { headers: authorized });
    assert.equal(negative.status, 400);
    const unknownField = await fetch(`${base}/v1/runtimes/${encodeURIComponent(ack.runtimeId)}/events?path=/tmp/x`, { headers: authorized });
    assert.equal(unknownField.status, 400);
    const method = await fetch(`${base}/v1/source-sessions`, { method: "POST", headers: authorized });
    assert.equal(method.status, 405);
    await waitForLifecycle(runtime.service, ack.commandId, "terminal");
    const audits = await fetch(
      `${base}/v1/runtimes/${encodeURIComponent(ack.runtimeId)}/assessment-audits`,
      { headers: authorized },
    );
    assert.equal(audits.status, 200);
    const auditBody = await audits.json() as { schema: string; audits: unknown[] };
    assert.equal(auditBody.schema, "studio.local-runtime-assessment-audits.v1");
    assert.equal(auditBody.audits.length, 0);
    assert.equal(JSON.stringify(auditBody).includes(runtime.directory), false);
    assert.equal(JSON.stringify(auditBody).includes(FIXTURE), false);
    const decisions = await fetch(
      `${base}/v1/runtimes/${encodeURIComponent(ack.runtimeId)}/decision-receipts`,
      { headers: authorized },
    );
    assert.equal(decisions.status, 200);
    const decisionBody = await decisions.json() as {
      schema: string;
      decisions: Array<{ integrity: string; outcome: string; producer: string }>;
    };
    assert.equal(decisionBody.schema, "studio.local-runtime-decision-receipts.v1");
    assert.equal(decisionBody.decisions.length, 0);
    assert.equal(JSON.stringify(decisionBody).includes(runtime.directory), false);
    assert.equal(JSON.stringify(decisionBody).includes(FIXTURE), false);
    const intakes = await fetch(
      `${base}/v1/runtimes/${encodeURIComponent(ack.runtimeId)}/publish-review-intakes`,
      { headers: authorized },
    );
    assert.equal(intakes.status, 200);
    const intakeBody = await intakes.json() as {
      schema: string;
      intakes: Array<{
        intakeId: string;
        artifactId: string;
        receiptId: string;
        receiptContentId: string;
        integrity: string;
        outcome: string;
        producer: string;
        reasonCodes: string[];
      }>;
    };
    assert.equal(intakeBody.schema, "studio.local-runtime-publish-review-intakes.v1");
    assert.equal(intakeBody.intakes.length, 1);
    assert.equal(intakeBody.intakes[0].integrity, "stored_intake_and_verified_study_readiness");
    assert.equal(intakeBody.intakes[0].producer, "host_publish_review_intake_v1");
    assert.equal(intakeBody.intakes[0].outcome, "queued");
    assert.deepEqual(intakeBody.intakes[0].reasonCodes, []);
    assert.equal(JSON.stringify(intakeBody).includes(runtime.directory), false);
    assert.equal(JSON.stringify(intakeBody).includes(FIXTURE), false);
    const reviewAuthorityResponse = await fetch(
      `${base}/v1/runtimes/${encodeURIComponent(ack.runtimeId)}/publish-review-decisions`,
      { headers: authorized },
    );
    assert.equal(reviewAuthorityResponse.status, 200);
    const reviewAuthority = await reviewAuthorityResponse.json() as {
      reviewer: { id: string; decisionAttestation: string; revocationAttestation: string };
      reviews: unknown[];
    };
    assert.deepEqual(reviewAuthority.reviews, []);
    const emptyCaptions = await fetch(
      `${base}/v1/runtimes/${encodeURIComponent(ack.runtimeId)}/caption-productions`,
      { headers: authorized },
    );
    assert.equal(emptyCaptions.status, 200);
    assert.deepEqual((await emptyCaptions.json() as { captions: unknown[] }).captions, []);
    const createReview = await fetch(
      `${base}/v1/runtimes/${encodeURIComponent(ack.runtimeId)}/publish-review-decisions`,
      {
        method: "POST",
        headers: { ...authorized, "Content-Type": "application/json" },
        body: JSON.stringify({
          intake: {
            intakeId: intakeBody.intakes[0].intakeId,
            artifactId: intakeBody.intakes[0].artifactId,
            receiptId: intakeBody.intakes[0].receiptId,
            receiptContentId: intakeBody.intakes[0].receiptContentId,
          },
          reviewer: {
            id: reviewAuthority.reviewer.id,
            attestation: reviewAuthority.reviewer.decisionAttestation,
          },
          decision: {
            outcome: "approve_for_caption_production",
            reasonCodes: ["reviewer_attested_caption_production_may_proceed"],
            note: null,
          },
        }),
      },
    );
    assert.equal(createReview.status, 201);
    const reviewBody = await createReview.json() as {
      reviews: Array<{
        reviewId: string;
        artifactId: string;
        receiptId: string;
        receiptContentId: string;
        state: string;
      }>;
    };
    assert.equal(reviewBody.reviews[0].state, "approved_for_caption_production");
    const createCaptions = await fetch(
      `${base}/v1/runtimes/${encodeURIComponent(ack.runtimeId)}/caption-productions`,
      {
        method: "POST",
        headers: { ...authorized, "Content-Type": "application/json" },
        body: JSON.stringify({
          approval: {
            reviewId: reviewBody.reviews[0].reviewId,
            artifactId: reviewBody.reviews[0].artifactId,
            receiptId: reviewBody.reviews[0].receiptId,
            receiptContentId: reviewBody.reviews[0].receiptContentId,
          },
        }),
      },
    );
    assert.equal(createCaptions.status, 409);
    assert.match(
      JSON.stringify(await createCaptions.json()),
      /Recorded caption fixtures cannot consume current-run study authority and are refused for production/,
    );
    assert.deepEqual(
      (await (await fetch(
        `${base}/v1/runtimes/${encodeURIComponent(ack.runtimeId)}/caption-productions`,
        { headers: authorized },
      )).json() as { captions: unknown[] }).captions,
      [],
    );
    const revokeReview = await fetch(
      `${base}/v1/runtimes/${encodeURIComponent(ack.runtimeId)}/publish-review-revocations`,
      {
        method: "POST",
        headers: { ...authorized, "Content-Type": "application/json" },
        body: JSON.stringify({
          approval: {
            reviewId: reviewBody.reviews[0].reviewId,
            artifactId: reviewBody.reviews[0].artifactId,
            receiptId: reviewBody.reviews[0].receiptId,
            receiptContentId: reviewBody.reviews[0].receiptContentId,
          },
          reviewer: {
            id: reviewAuthority.reviewer.id,
            attestation: reviewAuthority.reviewer.revocationAttestation,
          },
          revocation: { reasonCodes: ["new_review_required"], note: null },
        }),
      },
    );
    assert.equal(revokeReview.status, 201);
    assert.equal((await revokeReview.json() as { reviews: Array<{ state: string }> }).reviews[0].state, "approval_revoked");
    const retainedCaptions = await fetch(
      `${base}/v1/runtimes/${encodeURIComponent(ack.runtimeId)}/caption-productions`,
      { headers: authorized },
    );
    assert.deepEqual((await retainedCaptions.json() as { captions: unknown[] }).captions, []);
  } finally {
    await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
    await cleanup(runtime);
  }
});

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
