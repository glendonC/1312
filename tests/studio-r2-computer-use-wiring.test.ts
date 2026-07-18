import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test, { type TestContext } from "node:test";
import { deflateSync } from "node:zlib";

import { ContentAddressedArtifactStore } from "../src/studio/runtime/production/artifactStore.ts";
import { RuntimeComputerUseHost } from "../src/studio/runtime/production/computerUse/runtimeComputerUseHost.ts";
import { auditComputerUseSession } from "../src/studio/runtime/production/computerUse/computerUseAudit.ts";
import {
  FixtureExternalScreenDriver,
  fixtureExternalScreenContentId,
  type FixtureExternalScreenState,
} from "../src/studio/runtime/production/computerUse/fixtureDriver.ts";
import {
  BoundedChildComputerUseBridge,
  callChildComputerUseBridge,
  fetchChildComputerUseManifest,
  openChildComputerUseBridge,
} from "../src/studio/runtime/production/executor/childComputerUseBridge.ts";
import { buildStudyReportEnvelopeV2, validateWorkerResult } from "../src/studio/runtime/production/executor/workerContract.ts";
import { MemoryEventJournal, RuntimeLedger } from "../src/studio/runtime/production/journal.ts";
import {
  COMPUTER_USE_LIMITS,
  RESEARCH_LIMITS,
  type CapabilityGrant,
  type ComputerUseEvidenceSourceIdentity,
  type ComputerUseSurface,
  type LaunchPermit,
  type TaskRecord,
} from "../src/studio/runtime/production/model.ts";
import { projectRuntimeEvents } from "../src/studio/runtime/production/projection.ts";
import type { PendingRuntimeEvent, RuntimeEvent } from "../src/studio/runtime/production/protocol.ts";
import { BoundedResearchHost } from "../src/studio/runtime/production/research/researchHost.ts";
import { ResearchExhaustionHost } from "../src/studio/runtime/production/research/researchExhaustionHost.ts";
import { FixtureResearchProvider } from "../src/studio/runtime/production/research/provider.ts";
import {
  BoundedRuntimeScheduler,
  type RuntimeIdentityFactory,
} from "../src/studio/runtime/production/scheduler.ts";
import { GeneralizedEvidenceAdmissionHost } from "../src/studio/runtime/production/admission/generalizedEvidenceAdmissionHost.ts";
import { ComputerUseRequestExecutionHost } from "../src/studio/runtime/production/study/computerUseRequestExecutionHost.ts";
import {
  DeterministicRuntimeExecutor,
  DurableRuntimeCommandStore,
  RuntimeSourceRegistry,
  RuntimeStartService,
  deterministicOrchestratorLauncherFactory,
  readValidatedRuntimeJournal,
} from "../src/studio/runtime/production/runtimeHost/index.ts";

const FIXTURE = resolve("public/demo/runs/run-005");
const NOW = "2026-07-18T12:00:00.000Z";
let runtimeIndex = 0;

class Identities implements RuntimeIdentityFactory {
  private nextValue = 0;
  next(kind: "request" | "task" | "agent" | "grant"): string {
    this.nextValue += 1;
    return `${kind}:r2-wiring:${this.nextValue}`;
  }
  secret(): string {
    this.nextValue += 1;
    return `secret:r2-wiring:${this.nextValue}`;
  }
}

const CRC_TABLE = Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit += 1) crc = (crc & 1) !== 0 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  return crc >>> 0;
});

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const name = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, checksum]);
}

function rgbPng(width: number, height: number): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  const raw = Buffer.alloc(height * (1 + width * 3));
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function fixturePolicy(): { surface: ComputerUseSurface; driver: FixtureExternalScreenDriver } {
  const screenshotPng = rgbPng(2, 2);
  const origin = "https://offline-reference.example";
  const entryUrl = `${origin}/context`;
  const states: FixtureExternalScreenState[] = [{
    stateId: "state:context",
    url: entryUrl,
    title: "Offline context fixture",
    visibleText: "A sealed, static external-screen fixture for one unresolved range.",
    viewport: { width: 2, height: 2 },
    screenshotPng,
    transitions: { details: "state:details" },
  }, {
    stateId: "state:details",
    url: `${origin}/context/details`,
    title: "Offline context fixture details",
    visibleText: "A second sealed state reached through one declared read-only transition.",
    viewport: { width: 2, height: 2 },
    screenshotPng,
    transitions: {},
  }];
  const surface: ComputerUseSurface = {
    surfaceId: "surface:r2-wiring",
    origin,
    entryUrl,
    source: {
      mode: "offline_fixture",
      fixtureId: "fixture:r2-wiring",
      fixtureContentId: fixtureExternalScreenContentId({
        fixtureId: "fixture:r2-wiring",
        surfaceId: "surface:r2-wiring",
        origin,
        entryUrl,
        states,
        initialStateId: "state:context",
        transitionScript: ["details"],
      }),
    },
  };
  return {
    surface,
    driver: new FixtureExternalScreenDriver({
      surface,
      states,
      initialStateId: "state:context",
      transitionScript: ["details"],
    }),
  };
}

interface ActiveBasis {
  directory: string;
  ledger: RuntimeLedger;
  artifacts: ContentAddressedArtifactStore;
  scheduler: BoundedRuntimeScheduler;
  root: TaskRecord;
  researchTask: TaskRecord;
  researchExecutionId: string;
  researchLaunchClaimId: string;
  driver: FixtureExternalScreenDriver;
}

async function createActiveR1Basis(t: TestContext): Promise<ActiveBasis> {
  runtimeIndex += 1;
  const directory = await mkdtemp(join(tmpdir(), "studio-r2-wiring-"));
  t.after(async () => rm(directory, { recursive: true, force: true }));
  const commandStore = await DurableRuntimeCommandStore.open(join(directory, "host"));
  const sources = await RuntimeSourceRegistry.open({ sourceDirectories: [FIXTURE] });
  const source = sources.list()[0];
  const runtimeId = `runtime:20000000-0000-4000-8000-${runtimeIndex.toString().padStart(12, "0")}`;
  const service = await RuntimeStartService.open({
    store: commandStore,
    sources,
    launcherFactory: new DeterministicRuntimeExecutor().factory(),
    orchestratorLauncherFactory: deterministicOrchestratorLauncherFactory({ mode: "restudy_research" }),
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
  const deadline = Date.now() + 30_000;
  let status = await service.statusByRuntime(runtimeId);
  while (!new Set(["terminal", "failed", "interrupted"]).has(status.lifecycle) && Date.now() < deadline) {
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 10));
    status = await service.statusByRuntime(runtimeId);
  }
  assert.equal(status.lifecycle, "terminal");
  const loaded = await readValidatedRuntimeJournal(commandStore.paths(runtimeId).journalPath, runtimeId);
  const researchTaskEventIndex = loaded.events.findIndex((event) =>
    event.type === "task.created" && event.data.task.workloadKey.startsWith("research:"));
  assert.ok(researchTaskEventIndex > 0);
  const events = structuredClone(loaded.events.slice(0, researchTaskEventIndex + 1));
  const rootTaskEvent = events.find((event) => event.type === "task.created" && event.data.task.parentTaskId === null);
  assert.ok(rootTaskEvent?.type === "task.created");
  const rootTask = rootTaskEvent.data.task;
  const computerRequestGrant: CapabilityGrant = {
    id: "grant:r2-root-request",
    taskId: rootTask.id,
    agentId: rootTask.assignedAgentId,
    capability: "study.computer-use",
    mediaScope: [],
    evidenceScope: [],
    assessmentScope: null,
    decisionScope: null,
  };
  rootTask.grants.push(computerRequestGrant);
  const rootAgentEvent = events.find((event) => event.type === "agent.registered" && event.data.agent.taskId === rootTask.id);
  assert.ok(rootAgentEvent?.type === "agent.registered");
  rootAgentEvent.data.agent.grants.push(structuredClone(computerRequestGrant));

  const memory = new MemoryEventJournal();
  await memory.appendBatch(events as RuntimeEvent[]);
  const ledger = await RuntimeLedger.open(runtimeId, memory, { now: () => new Date(NOW) });
  const artifacts = new ContentAddressedArtifactStore(commandStore.paths(runtimeId).artifactStoreRoot);
  const policy = fixturePolicy();
  const scheduler = new BoundedRuntimeScheduler(ledger, {
    maxDepth: 2,
    maxActiveWorkers: 8,
    runBudget: { wallMs: 1_000_000, toolCalls: 128 },
    grantableCapabilities: ["task.spawn.request", "report.submit", "research.investigate", "computer.use.readonly", "study.research", "study.computer-use"],
  }, new Identities(), { computerUse: { surface: policy.surface, driver: policy.driver.identity } });
  const state = ledger.state();
  const root = state.tasks[rootTask.id];
  const researchTask = Object.values(state.tasks).find((task) => task.workloadKey.startsWith("research:"));
  assert.ok(researchTask);
  const decision = events.find((event) => event.type === "spawn.decided" && event.data.taskId === researchTask.id);
  assert.ok(decision?.type === "spawn.decided");
  const researchLaunchClaimId = `launch:${researchTask.id}`;
  await ledger.transact(
    { producer: { kind: "launcher", id: "r2-wiring-launcher" }, causationId: decision.data.requestId },
    () => ({ pending: [{ type: "task.launch_claimed", data: { claim: {
      id: researchLaunchClaimId,
      requestId: decision.data.requestId,
      taskId: researchTask.id,
      agentId: researchTask.assignedAgentId,
      executorKind: "deterministic_test",
      claimedAt: NOW,
      executionId: null,
    } } }] satisfies PendingRuntimeEvent[], result: undefined }),
  );
  await ledger.transact(
    { producer: { kind: "registry", id: "r2-wiring-registry" }, causationId: decision.data.requestId },
    () => ({ pending: [{ type: "agent.registered", data: { agent: {
      id: researchTask.assignedAgentId,
      taskId: researchTask.id,
      parentTaskId: researchTask.parentTaskId,
      parentAgentId: researchTask.parentAgentId,
      kind: researchTask.workerKind,
      label: researchTask.workerLabel,
      grants: structuredClone(researchTask.grants),
      status: "registered",
    } } }] satisfies PendingRuntimeEvent[], result: undefined }),
  );
  await scheduler.transitionTask(researchTask.id, researchTask.assignedAgentId, "working");
  const researchExecutionId = "execution:r2-wiring:research";
  await ledger.transact(
    { producer: { kind: "launcher", id: "r2-wiring-research-executor" }, causationId: decision.data.requestId },
    () => ({ pending: [{ type: "executor.started", data: {
      executionId: researchExecutionId,
      taskId: researchTask.id,
      agentId: researchTask.assignedAgentId,
      launchClaimId: researchLaunchClaimId,
      startedAt: NOW,
    } }] satisfies PendingRuntimeEvent[], result: undefined }),
  );
  return {
    directory,
    ledger,
    artifacts,
    scheduler,
    root: ledger.state().tasks[root.id],
    researchTask: ledger.state().tasks[researchTask.id],
    researchExecutionId,
    researchLaunchClaimId,
    driver: policy.driver,
  };
}

async function recordR1Exhaustion(runtime: ActiveBasis): Promise<void> {
  const grant = runtime.researchTask.grants.find((candidate) => candidate.capability === "research.investigate");
  assert.ok(grant?.capability === "research.investigate");
  const host = new BoundedResearchHost(
    runtime.ledger.runId,
    { taskId: runtime.researchTask.id, agentId: runtime.researchTask.assignedAgentId, grants: [grant] },
    runtime.artifacts,
    {
      searchProvider: new FixtureResearchProvider({}),
      now: () => NOW,
      binding: { ledger: runtime.ledger, execution: { executionId: runtime.researchExecutionId, launchClaimId: runtime.researchLaunchClaimId } },
    },
  );
  for (let index = 0; index < RESEARCH_LIMITS.maxQueries; index += 1) {
    const result = await host.search({
      operationId: `operation:r2-wiring:empty:${index}`,
      taskId: runtime.researchTask.id,
      agentId: runtime.researchTask.assignedAgentId,
      grantId: grant.id,
      op: "search",
      query: `bounded empty query ${index}`,
    });
    assert.equal(result.receipt.state, "empty");
  }
  await new ResearchExhaustionHost(
    runtime.ledger.runId,
    { taskId: runtime.researchTask.id, agentId: runtime.researchTask.assignedAgentId, grants: [grant] },
    runtime.artifacts,
    { ledger: runtime.ledger, execution: { executionId: runtime.researchExecutionId, launchClaimId: runtime.researchLaunchClaimId } },
  ).record();
}

async function startComputerTask(runtime: ActiveBasis, permit: LaunchPermit): Promise<{ task: TaskRecord; executionId: string; launchClaimId: string }> {
  const claim = await runtime.scheduler.claimTaskLaunch(permit, "deterministic_test", NOW);
  assert.equal(claim.won, true);
  await runtime.scheduler.registerAgent(permit);
  await runtime.scheduler.transitionTask(permit.taskId, permit.agentId, "working");
  const task = runtime.ledger.state().tasks[permit.taskId];
  const executionId = "execution:r2-wiring:computer";
  await runtime.ledger.transact(
    { producer: { kind: "launcher", id: "r2-wiring-computer-executor" }, causationId: permit.requestId },
    () => ({ pending: [{ type: "executor.started", data: {
      executionId,
      taskId: task.id,
      agentId: task.assignedAgentId,
      launchClaimId: claim.claim.id,
      startedAt: NOW,
    } }] satisfies PendingRuntimeEvent[], result: undefined }),
  );
  return { task: runtime.ledger.state().tasks[task.id], executionId, launchClaimId: claim.claim.id };
}

test("R2 admits only the exact R1 cause and journals one cite-only offline screen session", async (t) => {
  const runtime = await createActiveR1Basis(t);
  await recordR1Exhaustion(runtime);

  const gap = Object.values(runtime.ledger.state().researchExhaustions)[0].gap;
  const mediaScope = {
    artifactId: gap.media.artifactId,
    trackId: gap.media.trackId,
    startMs: gap.media.startMs,
    endMs: gap.media.endMs,
  };
  const ambient = await runtime.scheduler.requestSpawn(runtime.root.id, runtime.root.assignedAgentId, {
    workloadKey: "ambient-computer-use",
    objective: "Attempt an ordinary computer-use spawn.",
    workerKind: "analysis",
    workerLabel: "ambient-computer-use",
    mediaScope: [structuredClone(mediaScope)],
    inputArtifactIds: [gap.media.artifactId],
    requiredOutputs: [{ name: "context", artifactKind: "studio.study-report.v2", required: true }],
    requiredCapabilities: ["computer.use.readonly", "report.submit"],
    dependencies: [],
    budget: { wallMs: COMPUTER_USE_LIMITS.maxWallMs, toolCalls: COMPUTER_USE_LIMITS.maxCalls },
  });
  assert.equal(ambient.accepted, false);
  assert.equal(ambient.rejection, "capability_not_grantable");

  await assert.rejects(
    runtime.scheduler.requestSpawn(runtime.root.id, runtime.root.assignedAgentId, {
      workloadKey: "impersonate-computer-use",
      objective: "Attempt to author a host-only session receipt.",
      workerKind: "analysis",
      workerLabel: "host-artifact-impersonation",
      mediaScope: [structuredClone(mediaScope)],
      inputArtifactIds: [gap.media.artifactId],
      requiredOutputs: [{ name: "forged", artifactKind: "studio.external-screen-session.receipt.v1", required: true }],
      requiredCapabilities: ["report.submit"],
      dependencies: [],
      budget: { wallMs: 1_000, toolCalls: 1 },
    }),
    /host-only frame artifact kind/,
  );

  const requestHost = new ComputerUseRequestExecutionHost(runtime.ledger, runtime.artifacts, runtime.scheduler);
  const input = await requestHost.inspect(Object.values(runtime.ledger.state().executions).find((execution) => execution.taskId === runtime.root.id)!.id);
  assert.equal(input.candidates.length, 1);
  const callId = "tool-call:r2-wiring:computer-request";
  const rootExecutionId = input.candidates.length > 0
    ? Object.values(runtime.ledger.state().executions).find((execution) => execution.taskId === runtime.root.id)!.id
    : "unreachable";
  await runtime.ledger.transact(
    { producer: { kind: "launcher", id: "r2-wiring-root-bridge" }, causationId: rootExecutionId },
    () => ({ pending: [{ type: "orchestrator.tool_called", data: {
      callId,
      executionId: rootExecutionId,
      taskId: runtime.root.id,
      tool: "study_computer_use_request",
    } }] satisfies PendingRuntimeEvent[], result: undefined }),
  );
  await assert.rejects(
    requestHost.request(rootExecutionId, callId, { inputId: input.inputId, candidateId: `${input.candidates[0].candidateId}:forged` }),
    /one current cold-audited R1 cause/,
  );
  const decision = await requestHost.request(rootExecutionId, callId, {
    inputId: input.inputId,
    candidateId: input.candidates[0].candidateId,
  });
  assert.ok(decision.permit, decision.rejection ?? "computer-use child rejected");
  const started = await startComputerTask(runtime, decision.permit);
  const grant = started.task.grants.find((candidate) => candidate.capability === "computer.use.readonly");
  assert.ok(grant?.capability === "computer.use.readonly");
  assert.deepEqual(grant.computerUseScope.gap, gap);
  assert.equal(grant.computerUseScope.r1Cause.receiptId, Object.values(runtime.ledger.state().researchExhaustions)[0].id);
  assert.equal(grant.computerUseScope.surface.source.mode, "offline_fixture");

  const runtimeHost = new RuntimeComputerUseHost(
    runtime.ledger,
    runtime.artifacts,
    started.task,
    grant,
    { executionId: started.executionId, launchClaimId: started.launchClaimId },
    runtime.driver,
  );
  const runtimeVerified = await runtimeHost.inspect({
    operationId: "operation:r2-wiring:computer",
    taskId: started.task.id,
    agentId: started.task.assignedAgentId,
    grantId: grant.id,
  });
  const bridge = await openChildComputerUseBridge(new BoundedChildComputerUseBridge(
    { taskId: started.task.id, agentId: started.task.assignedAgentId, grants: [grant] },
    { inspect: async (request) => {
      assert.deepEqual(request, {
        operationId: "operation:r2-wiring:computer",
        taskId: started.task.id,
        agentId: started.task.assignedAgentId,
        grantId: grant.id,
      });
      return runtimeVerified;
    } },
    { nextOperationId: () => "operation:r2-wiring:computer" },
  ));
  t.after(() => bridge.close());
  const manifest = await fetchChildComputerUseManifest(bridge.endpoint, bridge.token);
  assert.deepEqual(manifest.gap.media, gap.media);
  await assert.rejects(
    callChildComputerUseBridge(bridge.endpoint, bridge.token, { url: "https://example.com" } as never),
    /empty object/,
  );
  const result = await callChildComputerUseBridge(bridge.endpoint, bridge.token, {});
  assert.equal(result.states.length, 2);
  assert.equal(result.receipt.actions.length, 1);
  assert.equal(result.receipt.accounting.egressRequests, 0);
  assert.equal(result.receipt.accounting.downloads, 0);
  assert.equal(result.receipt.nonClaims.liveExternalState, "not_observed");

  const projected = runtime.ledger.state().computerUseOperations[result.operationId];
  assert.equal(projected.status, "completed");
  assert.equal(projected.executionId, started.executionId);
  assert.equal(projected.launchClaimId, started.launchClaimId);
  assert.equal(projected.sessionArtifactId, result.sessionArtifactId);
  const verified = await auditComputerUseSession(runtime.artifacts, runtime.ledger.runId, result.sessionReceiptContentId);
  const expected: ComputerUseEvidenceSourceIdentity = {
    operationId: result.operationId,
    sessionArtifactId: verified.receiptArtifactId,
    sessionReceiptId: verified.receipt.receiptId,
    sessionReceiptContentId: verified.receiptContentId,
    screenshots: verified.states.map((state) => ({
      stateId: state.identity.stateId,
      ordinal: state.identity.ordinal,
      artifactId: state.identity.screenshot.artifactId,
      contentId: state.identity.screenshot.content.contentId,
      width: state.identity.screenshot.width,
      height: state.identity.screenshot.height,
    })),
  };
  const workerValue = {
    summary: "Withhold the unresolved media range while retaining one cite-only offline screenshot region.",
    computerUseEvidenceInputs: [{
      operationId: result.operationId,
      sessionArtifactId: verified.receiptArtifactId,
      sessionReceiptId: verified.receipt.receiptId,
      sessionReceiptContentId: verified.receiptContentId,
      stateId: verified.states[0].identity.stateId,
      screenshotArtifactId: verified.states[0].identity.screenshot.artifactId,
      screenshotContentId: verified.states[0].identity.screenshot.content.contentId,
      region: { x: 0, y: 0, width: 1, height: 1 },
    }],
    outputs: [{
      name: "external screen context note",
      kind: "studio.study-report.v2",
      coverage: [{
        artifactId: gap.media.artifactId,
        trackId: gap.media.trackId,
        startMs: gap.media.startMs,
        endMs: gap.media.endMs,
        claimIds: [],
        reason: { code: "worker_withheld", detail: "Offline screen context cannot resolve the media claim." },
      }],
      claims: [],
    }],
  };
  const worker = validateWorkerResult(workerValue, started.task, [], [], [], [], [expected]);
  const output = worker.outputs[0];
  assert.equal(output.kind, "studio.study-report.v2");
  if (output.kind !== "studio.study-report.v2" || !("coverage" in output)) assert.fail("expected a v2 report output");
  const report = buildStudyReportEnvelopeV2({
    task: started.task,
    executionId: started.executionId,
    output,
    semanticEvidenceInputs: [],
    verifiedSemanticEvidence: [],
    ocrEvidenceInputs: [],
    verifiedOcrEvidence: [],
    computerUseEvidenceInputs: worker.computerUseEvidenceInputs,
    verifiedComputerUseEvidence: [verified],
    dialogueScopePolicy: null,
  });
  assert.equal(report.evidenceCitations.length, 1);
  assert.equal(report.evidenceCitations[0].evidenceKind, "external_screen_region");
  assert.equal(report.evidenceCitations[0].use, "cite_only");
  assert.deepEqual(report.coverage[0].citationIds, []);
  assert.deepEqual(report.claims, []);
  const admitted = await new GeneralizedEvidenceAdmissionHost(runtime.ledger.state(), runtime.artifacts, {
    dialogueScopePolicyResolver: async () => null,
  }).admit(report);
  assert.equal(admitted.reportEnvelope.evidenceCitations[0].evidenceKind, "external_screen_region");

  const foreign = structuredClone(runtime.ledger.state());
  foreign.computerUseOperations[result.operationId].executionId = "execution:foreign";
  await assert.rejects(
    new GeneralizedEvidenceAdmissionHost(foreign, runtime.artifacts, { dialogueScopePolicyResolver: async () => null }).admit(report),
    /cross-task, cross-executor, or outside its completed session/,
  );
  const replayed = projectRuntimeEvents(runtime.ledger.runId, await runtime.ledger.events());
  assert.deepEqual(replayed, runtime.ledger.state());
});
