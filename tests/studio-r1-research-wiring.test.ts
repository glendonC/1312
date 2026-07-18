import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test, { type TestContext } from "node:test";

import { ContentAddressedArtifactStore } from "../src/studio/runtime/production/artifactStore.ts";
import { canonicalJsonContentId } from "../src/studio/runtime/production/artifactStore/contentIdentity.ts";
import {
  buildOwnedMediaStudyArtifact,
  buildStudyPlanningDecisionArtifact,
} from "../src/studio/runtime/production/artifactStore/studyArtifacts.ts";
import { FileEventJournal, RuntimeLedger } from "../src/studio/runtime/production/journal.ts";
import { loadOwnedSourceSession } from "../src/studio/runtime/production/runStart/sourceSessionLoader.ts";
import {
  BoundedRuntimeScheduler,
  type RuntimeIdentityFactory,
} from "../src/studio/runtime/production/scheduler.ts";
import { BoundedResearchHost } from "../src/studio/runtime/production/research/researchHost.ts";
import { auditResearchSnapshot } from "../src/studio/runtime/production/research/researchAudit.ts";
import {
  externalDocumentSpanCitation,
  reopenResearchCitationSource,
} from "../src/studio/runtime/production/research/researchCitation.ts";
import { FixtureResearchProvider } from "../src/studio/runtime/production/research/provider.ts";
import type { ResearchFetcher } from "../src/studio/runtime/production/research/egressPolicy.ts";
import { ResearchRequestExecutionHost } from "../src/studio/runtime/production/study/researchRequestExecutionHost.ts";
import { GeneralizedEvidenceAdmissionHost } from "../src/studio/runtime/production/admission/generalizedEvidenceAdmissionHost.ts";
import {
  launcherChildCapabilityContext,
  launcherChildCapabilityEnvironment,
  configureLauncherChildCapabilityMcp,
  openLauncherChildCapabilityBridges,
  closeLauncherChildCapabilityBridges,
} from "../src/studio/runtime/production/launcher/childCapabilityBridges.ts";
import { callChildResearchBridge, fetchChildResearchManifest } from "../src/studio/runtime/production/executor/childResearchBridge.ts";
import { FfmpegCapabilityHost } from "../src/studio/runtime/production/mediaHost.ts";
import { BoundedFrameSamplingHost } from "../src/studio/runtime/production/frameHost.ts";
import { BoundedOcrHost } from "../src/studio/runtime/production/ocrHost.ts";
import { BoundedSpeakerOverlapHost } from "../src/studio/runtime/production/speakerHost.ts";
import { BoundedConditionalSeparationHost } from "../src/studio/runtime/production/separationHost.ts";
import { BoundedEvidenceReadHost } from "../src/studio/runtime/production/evidenceHost.ts";
import { BoundedEvidenceAssessmentHost } from "../src/studio/runtime/production/evidenceAssessmentHost.ts";
import { BoundedEvidenceDecisionHost } from "../src/studio/runtime/production/evidenceDecisionHost.ts";
import { SpeechTranscribeCapabilityHost } from "../src/studio/runtime/production/semantic/semanticEvidenceHost.ts";
import { projectRuntimeEvents } from "../src/studio/runtime/production/projection.ts";
import {
  OWNED_MEDIA_STUDY_LIMITS,
  RESEARCH_LIMITS,
  STUDY_REPORT_V2_LIMITS,
  type LaunchPermit,
  type MediaScope,
  type OwnedMediaStudyArtifact,
  type OwnedMediaStudyExecutorReceipt,
  type RuntimeArtifact,
  type StudyPlanningDecisionReceipt,
  type StudyReportArtifactV2,
  type TaskRecord,
} from "../src/studio/runtime/production/model.ts";
import type { PendingRuntimeEvent } from "../src/studio/runtime/production/protocol.ts";
import { researchTriggerId } from "../src/studio/runtime/production/validation/research.ts";
import { runtimeTestJobContext } from "./runtime-test-job-context.ts";

const FIXTURE = resolve("public/demo/runs/run-005");
const NOW = "2026-07-17T14:00:00.000Z";
const ALLOWED_DOMAINS = ["example.com", "docs.example.com"];
const PLAIN_BODY = "Plain fixture text.\r\nSecond line about the festival.";

class Identities implements RuntimeIdentityFactory {
  private value = 0;
  next(kind: "request" | "task" | "agent" | "grant"): string { this.value += 1; return `${kind}:r1-${this.value}`; }
  secret(): string { this.value += 1; return `secret:r1-${this.value}`; }
}

function provider(): FixtureResearchProvider {
  return new FixtureResearchProvider({
    "harvest festival toast": [
      { url: "https://example.com/article", title: "Harvest Festival", snippet: "The autumn toast honors the harvest moon." },
      { url: "https://docs.example.com/direct", title: "Direct document", snippet: "A plain text festival reference." },
    ],
  });
}

function fetcher(): ResearchFetcher {
  return async (url) => url === "https://docs.example.com/direct"
    ? new Response(PLAIN_BODY, { status: 200, headers: { "content-type": "text/plain; charset=utf-8" } })
    : new Response("missing", { status: 404 });
}

const publicLookup = async () => [{ address: "93.184.216.34", family: 4 }];

interface WiringHarness {
  directory: string;
  journalPath: string;
  artifacts: ContentAddressedArtifactStore;
  ledger: RuntimeLedger;
  scheduler: BoundedRuntimeScheduler;
  source: RuntimeArtifact;
  evidence: RuntimeArtifact[];
  scope: MediaScope;
  root: TaskRecord;
  rootExecutionId: string;
}

let harnessIndex = 0;

async function startTask(runtime: WiringHarness, permit: LaunchPermit, executionId: string): Promise<{ task: TaskRecord; launchClaimId: string }> {
  const claim = await runtime.scheduler.claimTaskLaunch(permit, "deterministic_test", NOW);
  assert.equal(claim.won, true);
  await runtime.scheduler.registerAgent(permit);
  await runtime.scheduler.transitionTask(permit.taskId, permit.agentId, "working");
  const task = runtime.ledger.state().tasks[permit.taskId];
  await runtime.ledger.transact(
    { producer: { kind: "launcher", id: "r1-test-executor" }, causationId: permit.requestId },
    () => ({ pending: [{ type: "executor.started", data: { executionId, taskId: task.id, agentId: task.assignedAgentId, launchClaimId: claim.claim.id, startedAt: NOW } }] satisfies PendingRuntimeEvent[], result: undefined }),
  );
  return { task: runtime.ledger.state().tasks[permit.taskId], launchClaimId: claim.claim.id };
}

async function harness(t: TestContext, options: { rootResearchGrant?: boolean } = {}): Promise<WiringHarness> {
  harnessIndex += 1;
  const runId = `runtime:r1-wiring:${harnessIndex}`;
  const directory = await mkdtemp(join(tmpdir(), "studio-r1-wiring-"));
  t.after(async () => rm(directory, { recursive: true, force: true }));
  const journalPath = join(directory, "events.ndjson");
  const artifacts = new ContentAddressedArtifactStore(join(directory, "artifacts"));
  const ledger = await RuntimeLedger.open(runId, new FileEventJournal(journalPath), { now: () => new Date(NOW) });
  const loaded = await loadOwnedSourceSession(FIXTURE);
  const source = await artifacts.registerSource(runId, loaded.descriptor);
  await artifacts.record(ledger, source);
  const evidence: RuntimeArtifact[] = [];
  for (const descriptor of loaded.evidenceDescriptors) {
    const artifact = await artifacts.registerPreflightEvidence(runId, source.id, descriptor);
    await artifacts.record(ledger, artifact);
    evidence.push(artifact);
  }
  assert.ok(evidence.length >= 2, "the wiring harness needs two admitted-report stand-in artifacts");
  const scheduler = new BoundedRuntimeScheduler(ledger, {
    maxDepth: 2,
    maxActiveWorkers: 4,
    runBudget: { wallMs: 240_000, toolCalls: 24 },
    grantableCapabilities: ["task.spawn.request", "report.submit", "research.investigate", "study.research"],
  }, new Identities(), { researchAllowedDomains: ALLOWED_DOMAINS });
  const scope: MediaScope = { artifactId: source.id, trackId: "stream:0", startMs: 0, endMs: 1_000 };
  const rootPermit = await scheduler.createRoot({
    workloadKey: `root:r1:${harnessIndex}`,
    objective: "Authorize only host-derived research triggers for unresolved study conflicts.",
    workerKind: "orchestrator",
    workerLabel: "r1-root",
    mediaScope: [scope],
    inputArtifactIds: [source.id, ...evidence.map((entry) => entry.id)],
    requiredOutputs: [{ name: "study", artifactKind: "studio.owned-media-study.v1", required: true }],
    requiredCapabilities: options.rootResearchGrant === false ? ["task.spawn.request"] : ["task.spawn.request", "study.research"],
    dependencies: [],
    budget: { wallMs: 60_000, toolCalls: 8 },
  }, runtimeTestJobContext({ source, evidence, range: { startMs: 0, endMs: 1_000 } }));
  const runtime: WiringHarness = {
    directory, journalPath, artifacts, ledger, scheduler, source, evidence, scope,
    root: null as unknown as TaskRecord,
    rootExecutionId: `execution:r1-root:${harnessIndex}`,
  };
  runtime.root = (await startTask(runtime, rootPermit, runtime.rootExecutionId)).task;
  return runtime;
}

const CONFLICT_DETAIL = "Which festival the overlapping toast references is unresolved.";

/**
 * Journal a real v1 owned-media study with one unresolved conflict through the production
 * validators, artifact builders, and reducers. The planning receipt's two admitted-report
 * entries are identity stand-ins pointing at registered preflight evidence artifacts; every
 * invariant the projection enforces for planning and synthesis lineage is satisfied for real.
 */
async function craftConflictStudy(runtime: WiringHarness): Promise<{ studyId: string; studyContentId: string }> {
  const root = runtime.ledger.state().tasks[runtime.root.id];
  const reports = runtime.evidence.slice(0, 2).map((artifact, index) => ({
    reportId: `report:r1-standin:${index + 1}`,
    childTaskId: `task:r1-standin:${index + 1}`,
    childAgentId: `agent:r1-standin:${index + 1}`,
    artifactId: artifact.id,
    contentId: artifact.content.contentId,
    dispositionId: `disposition:r1-standin:${index + 1}`,
    dispositionReceiptId: `receipt:disposition:r1-standin:${index + 1}`,
    dispositionReceiptContentId: canonicalJsonContentId({ disposition: index + 1 }),
    admissionId: `admission:r1-standin:${index + 1}`,
    admissionReceiptId: `receipt:admission:r1-standin:${index + 1}`,
    admissionReceiptContentId: canonicalJsonContentId({ admission: index + 1 }),
    readOperationId: `operation:read:r1-standin:${index + 1}`,
    readReceiptId: `receipt:read:r1-standin:${index + 1}`,
  }));
  const range = { ...runtime.scope };
  const planningReceipt: StudyPlanningDecisionReceipt = {
    schema: "studio.study-planning-decision.receipt.v1",
    receiptId: "receipt:planning:r1",
    decisionId: "decision:planning:r1",
    input: {
      schema: "studio.study-planning-input.v1",
      inputId: "input:planning:r1",
      runId: runtime.ledger.runId,
      rootTaskId: root.id,
      rootAgentId: root.ownerAgentId!,
      rootExecutionId: runtime.rootExecutionId,
      jobContextId: root.jobContext.contextId,
      reports,
      coverage: [{
        coverageId: "coverage:1",
        range,
        aggregate: "conflict",
        childRanges: reports.map((report, index) => ({
          reportId: report.reportId,
          artifactId: report.artifactId,
          state: "supported",
          claimIds: [`claim:r1-standin:${index + 1}`],
          reasonCode: null,
        })),
      }],
      gaps: [],
      conflicts: [{
        conflictId: "conflict:1",
        coverageId: "coverage:1",
        range,
        claims: reports.map((report, index) => ({
          reportId: report.reportId,
          artifactId: report.artifactId,
          claimId: `claim:r1-standin:${index + 1}`,
          statement: `Stand-in conflicting claim ${index + 1} over the toast range.`,
        })),
      }],
    },
    modelExecutor: { executionId: runtime.rootExecutionId, taskId: root.id, agentId: root.ownerAgentId! },
    decision: {
      outcome: "synthesize_with_gaps",
      citedGapIds: [],
      citedConflictIds: ["conflict:1"],
      reason: "The wiring test synthesizes with the unresolved conflict preserved to derive one exact research trigger.",
    },
    nonClaims: { semanticCorrectness: "not_assessed", truthArbitration: "not_performed", readiness: "not_decided" },
  };
  const storedPlanning = await runtime.artifacts.storeJson(planningReceipt);
  const planningArtifact = buildStudyPlanningDecisionArtifact({ runId: runtime.ledger.runId, receipt: planningReceipt, storedReceipt: storedPlanning });
  await runtime.ledger.transact(
    { producer: { kind: "study_planning_host", id: "r1-wiring-planning" }, causationId: planningReceipt.decisionId },
    () => ({ pending: [
      { type: "artifact.recorded", data: { artifact: planningArtifact } },
      { type: "study.planning_decision_recorded", data: { outputArtifactId: planningArtifact.id, receiptContentId: storedPlanning.content.contentId, receipt: planningReceipt } },
    ] satisfies PendingRuntimeEvent[], result: undefined }),
  );
  const envelope: OwnedMediaStudyArtifact = {
    schema: "studio.owned-media-study.v1",
    runId: runtime.ledger.runId,
    root: { taskId: root.id, agentId: root.ownerAgentId!, executionId: runtime.rootExecutionId, jobContext: structuredClone(root.jobContext) },
    planning: {
      decisionId: planningReceipt.decisionId,
      receiptId: planningReceipt.receiptId,
      receiptContentId: storedPlanning.content.contentId,
      outcome: "synthesize_with_gaps",
      inputId: planningReceipt.input.inputId,
    },
    reports: [],
    childDispositions: [],
    followUpHistory: [],
    coverage: [{
      coverageId: "coverage:1",
      artifactId: range.artifactId,
      trackId: range.trackId,
      startMs: range.startMs,
      endMs: range.endMs,
      state: "withheld",
      claimIds: [],
      reason: { code: "unresolved_conflict", detail: CONFLICT_DETAIL },
    }],
    claims: [],
    conflicts: [{ conflictId: "conflict:1", coverageId: "coverage:1", status: "unresolved", detail: CONFLICT_DETAIL }],
    limitations: [],
    sourceArtifacts: [{ artifactId: runtime.source.id, contentId: runtime.source.content.contentId }],
    limits: OWNED_MEDIA_STUDY_LIMITS,
    nonClaims: {
      semanticCorrectness: "not_assessed",
      translationQuality: "not_assessed",
      truthArbitration: "not_performed",
      publication: "not_authorized",
    },
  };
  const prepared = await runtime.artifacts.prepareOwnedMediaStudy(runtime.ledger.runId, envelope);
  const executorReceipt: OwnedMediaStudyExecutorReceipt = {
    schema: "studio.owned-media-study.executor-receipt.v1",
    receiptId: "receipt:study-executor:r1",
    synthesisId: "synthesis:r1",
    execution: { executionId: runtime.rootExecutionId, taskId: root.id, agentId: root.ownerAgentId! },
    planning: {
      decisionId: planningReceipt.decisionId,
      receiptId: planningReceipt.receiptId,
      receiptContentId: storedPlanning.content.contentId,
    },
    output: {
      artifactId: prepared.artifactId,
      contentId: prepared.content.contentId,
      bytes: prepared.content.bytes,
      schema: "studio.owned-media-study.v1",
    },
    producer: { id: "studio.model-root-study-synthesis", version: "1", authorship: "active_root_executor_tool_call" },
    outcome: "completed",
  };
  const storedReceipt = await runtime.artifacts.storeJson(executorReceipt);
  const studyArtifact = buildOwnedMediaStudyArtifact({
    runId: runtime.ledger.runId,
    receipt: executorReceipt,
    receiptContentId: storedReceipt.content.contentId,
    prepared,
  });
  await runtime.ledger.transact(
    { producer: { kind: "study_synthesis_host", id: "r1-wiring-synthesis" }, causationId: prepared.studyId },
    () => ({ pending: [
      { type: "artifact.recorded", data: { artifact: studyArtifact } },
      { type: "study.synthesis_completed", data: {
        studyId: prepared.studyId,
        outputArtifactId: studyArtifact.id,
        outputContentId: prepared.content.contentId,
        executorReceiptContentId: storedReceipt.content.contentId,
        executorReceipt,
        projection: { coverage: structuredClone(envelope.coverage), conflicts: structuredClone(envelope.conflicts) },
      } },
    ] satisfies PendingRuntimeEvent[], result: undefined }),
  );
  return { studyId: prepared.studyId, studyContentId: prepared.content.contentId };
}

async function recordResearchToolCall(runtime: WiringHarness): Promise<string> {
  const callId = `tool-call:r1:${Object.keys(runtime.ledger.state().orchestratorToolCalls).length + 1}`;
  await runtime.ledger.transact(
    { producer: { kind: "launcher", id: "r1-test-orchestrator" }, causationId: runtime.rootExecutionId },
    () => ({ pending: [{ type: "orchestrator.tool_called", data: { callId, executionId: runtime.rootExecutionId, taskId: runtime.root.id, tool: "study_research_request" } }] satisfies PendingRuntimeEvent[], result: undefined }),
  );
  return callId;
}

async function admitResearchChild(runtime: WiringHarness): Promise<{ trigger: { triggerId: string }; permit: LaunchPermit; inputId: string }> {
  const host = new ResearchRequestExecutionHost(runtime.ledger, runtime.artifacts, runtime.scheduler);
  const input = await host.inspect(runtime.rootExecutionId);
  assert.equal(input.triggers.length, 1);
  const callId = await recordResearchToolCall(runtime);
  const decision = await host.request(runtime.rootExecutionId, callId, { inputId: input.inputId, triggerId: input.triggers[0].triggerId });
  assert.ok(decision.permit, decision.rejection ?? "research child rejected");
  return { trigger: input.triggers[0], permit: decision.permit, inputId: input.inputId };
}

function researchChildHost(runtime: WiringHarness, task: TaskRecord, executionId: string, launchClaimId: string): BoundedResearchHost {
  const grant = task.grants.find((candidate) => candidate.capability === "research.investigate");
  assert.ok(grant && grant.capability === "research.investigate");
  return new BoundedResearchHost(
    runtime.ledger.runId,
    { taskId: task.id, agentId: task.assignedAgentId, grants: [grant] },
    runtime.artifacts,
    {
      searchProvider: provider(),
      fetcher: fetcher(),
      lookup: publicLookup,
      now: () => NOW,
      binding: { ledger: runtime.ledger, execution: { executionId, launchClaimId } },
    },
  );
}

test("research admission mints the exact gap grant only through the recorded root tool path", async (t) => {
  const runtime = await harness(t);
  const requestHost = new ResearchRequestExecutionHost(runtime.ledger, runtime.artifacts, runtime.scheduler);
  const empty = await requestHost.inspect(runtime.rootExecutionId);
  assert.deepEqual(empty.triggers, []);

  await craftConflictStudy(runtime);
  const { trigger, permit, inputId } = await admitResearchChild(runtime);
  const child = runtime.ledger.state().tasks[permit.taskId];
  assert.equal(child.workloadKey, `research:${trigger.triggerId}`);
  assert.deepEqual(child.budget, { wallMs: RESEARCH_LIMITS.maxWallMs, toolCalls: RESEARCH_LIMITS.maxCalls });
  const grant = child.grants.find((candidate) => candidate.capability === "research.investigate");
  assert.ok(grant && grant.capability === "research.investigate");
  assert.deepEqual(grant.mediaScope, []);
  assert.deepEqual(grant.researchScope.limits, RESEARCH_LIMITS);
  assert.deepEqual(grant.researchScope.allowedDomains, ALLOWED_DOMAINS);
  assert.equal(grant.researchScope.gap.inputId, inputId);
  assert.equal(grant.researchScope.gap.triggerId, trigger.triggerId);
  assert.equal(grant.researchScope.gap.hypothesis, CONFLICT_DETAIL);
  assert.deepEqual(grant.researchScope.gap.media, {
    artifactId: runtime.scope.artifactId,
    contentId: runtime.source.content.contentId,
    trackId: runtime.scope.trackId,
    startMs: runtime.scope.startMs,
    endMs: runtime.scope.endMs,
  });
  assert.ok(child.grants.some((candidate) => candidate.capability === "report.submit"));

  const callId = await recordResearchToolCall(runtime);
  const duplicate = await requestHost.request(runtime.rootExecutionId, callId, { inputId, triggerId: trigger.triggerId });
  assert.equal(duplicate.accepted, false);
  assert.equal(duplicate.rejection, "duplicate_owner");
});

test("ambient, ungranted, stale, and forged research requests fail closed", async (t) => {
  const ungranted = await harness(t, { rootResearchGrant: false });
  await craftConflictStudy(ungranted);
  const ungrantedHost = new ResearchRequestExecutionHost(ungranted.ledger, ungranted.artifacts, ungranted.scheduler);
  await assert.rejects(ungrantedHost.inspect(ungranted.rootExecutionId), /study\.research grant/);

  const runtime = await harness(t);
  await craftConflictStudy(runtime);

  const ambient = await runtime.scheduler.requestSpawn(runtime.root.id, runtime.root.assignedAgentId, {
    workloadKey: "ambient-research",
    objective: "Attempt ambient research without a host trigger.",
    workerKind: "analysis",
    workerLabel: "ambient-research",
    mediaScope: [runtime.scope],
    inputArtifactIds: [runtime.source.id],
    requiredOutputs: [{ name: "note", artifactKind: "studio.study-report.v2", required: true }],
    requiredCapabilities: ["research.investigate", "report.submit"],
    dependencies: [],
    budget: { wallMs: RESEARCH_LIMITS.maxWallMs, toolCalls: RESEARCH_LIMITS.maxCalls },
  });
  assert.equal(ambient.accepted, false);
  assert.equal(ambient.rejection, "capability_not_grantable");

  const requestHost = new ResearchRequestExecutionHost(runtime.ledger, runtime.artifacts, runtime.scheduler);
  const input = await requestHost.inspect(runtime.rootExecutionId);
  const trigger = input.triggers[0];
  const callId = await recordResearchToolCall(runtime);
  await assert.rejects(
    requestHost.request(runtime.rootExecutionId, callId, { inputId: "research-request-input:stale", triggerId: trigger.triggerId }),
    /stale or forged host input/,
  );
  await assert.rejects(
    requestHost.request(runtime.rootExecutionId, callId, { inputId: input.inputId, triggerId: "research-trigger:forged" }),
    /one exact audited trigger/,
  );

  const forgedBody = structuredClone(trigger) as unknown as Record<string, unknown>;
  delete forgedBody.triggerId;
  (forgedBody.gap as Record<string, unknown>).detail = "A widened hypothesis the host never derived.";
  const forgedTrigger = { triggerId: researchTriggerId(forgedBody as never), ...structuredClone(forgedBody) } as typeof trigger;
  forgedTrigger.gap.detail = "A widened hypothesis the host never derived.";
  const forged = await runtime.scheduler.requestResearch({
    inputId: input.inputId,
    trigger: forgedTrigger,
    authorship: { executionId: runtime.rootExecutionId, toolCallId: callId, taskId: runtime.root.id, agentId: runtime.root.assignedAgentId },
    child: {
      workloadKey: `research:${forgedTrigger.triggerId}`,
      objective: "Forged trigger detail.",
      workerKind: "analysis",
      workerLabel: "gap-context-research",
      mediaScope: [runtime.scope],
      inputArtifactIds: [runtime.source.id],
      requiredOutputs: [{ name: "research context note", artifactKind: "studio.study-report.v2", required: true }],
      requiredCapabilities: ["research.investigate", "report.submit"],
      dependencies: [],
      budget: { wallMs: RESEARCH_LIMITS.maxWallMs, toolCalls: RESEARCH_LIMITS.maxCalls },
    },
  });
  assert.equal(forged.accepted, false);
  assert.equal(forged.rejection, "requester_not_authorized");

  await assert.rejects(
    runtime.scheduler.requestResearch({
      inputId: input.inputId,
      trigger,
      authorship: { executionId: runtime.rootExecutionId, toolCallId: "tool-call:never-recorded", taskId: runtime.root.id, agentId: runtime.root.assignedAgentId },
      child: {
        workloadKey: `research:${trigger.triggerId}`,
        objective: "Missing recorded root tool call.",
        workerKind: "analysis",
        workerLabel: "gap-context-research",
        mediaScope: [runtime.scope],
        inputArtifactIds: [runtime.source.id],
        requiredOutputs: [{ name: "research context note", artifactKind: "studio.study-report.v2", required: true }],
        requiredCapabilities: ["research.investigate", "report.submit"],
        dependencies: [],
        budget: { wallMs: RESEARCH_LIMITS.maxWallMs, toolCalls: RESEARCH_LIMITS.maxCalls },
      },
    }),
    /no matching tool call/,
  );
});

test("the granted child runs ledger-bound research, projects receipted operations, and closes the trigger", async (t) => {
  const runtime = await harness(t);
  await craftConflictStudy(runtime);
  const { trigger, permit, inputId } = await admitResearchChild(runtime);
  const started = await startTask(runtime, permit, "execution:r1-child");
  const host = researchChildHost(runtime, started.task, "execution:r1-child", started.launchClaimId);
  const grant = started.task.grants.find((candidate) => candidate.capability === "research.investigate")!;

  const search = await host.search({
    operationId: "operation:r1:search:1", taskId: started.task.id, agentId: started.task.assignedAgentId,
    grantId: grant.id, op: "search", query: "harvest festival toast",
  });
  const snapshot = await host.snapshotDocument({
    operationId: "operation:r1:snapshot:1", taskId: started.task.id, agentId: started.task.assignedAgentId,
    grantId: grant.id, op: "document_snapshot", searchOperationId: "operation:r1:search:1", resultIndex: 1,
  });

  const state = runtime.ledger.state();
  const searchOperation = state.researchOperations["operation:r1:search:1"];
  const snapshotOperation = state.researchOperations["operation:r1:snapshot:1"];
  assert.equal(searchOperation.status, "completed");
  assert.equal(snapshotOperation.status, "completed");
  assert.equal(searchOperation.executionId, "execution:r1-child");
  assert.equal(searchOperation.launchClaimId, started.launchClaimId);
  assert.equal(snapshotOperation.gap.triggerId, trigger.triggerId);
  assert.ok("executionId" in search.receipt.authorization && search.receipt.authorization.executionId === "execution:r1-child");
  assert.ok("executionId" in snapshot.receipt.authorization && snapshot.receipt.authorization.launchClaimId === started.launchClaimId);
  assert.equal(state.artifacts[search.receiptArtifactId]?.origin.kind, "research_search_receipt");
  assert.equal(state.artifacts[snapshot.receiptArtifactId]?.origin.kind, "research_snapshot_receipt");
  assert.equal(state.artifacts[snapshot.document.artifactId]?.origin.kind, "research_document_snapshot");
  assert.equal(state.artifacts[snapshot.extraction.artifactId]?.origin.kind, "research_extraction");

  const verified = await auditResearchSnapshot(runtime.artifacts, runtime.ledger.runId, snapshot.receiptContentId);
  assert.equal(verified.receipt.nonClaims.speechEvidenceAuthority, "not_granted");
  assert.equal(verified.receipt.egressPolicy.dnsRebindingWindow, "checked_before_fetch_not_pinned");

  const callId = await recordResearchToolCall(runtime);
  const consumed = await new ResearchRequestExecutionHost(runtime.ledger, runtime.artifacts, runtime.scheduler)
    .request(runtime.rootExecutionId, callId, { inputId, triggerId: trigger.triggerId });
  assert.equal(consumed.accepted, false);
  assert.equal(consumed.rejection, "research_duplicate_work");

  const journalLines = (await readFile(runtime.journalPath, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
  const replayed = projectRuntimeEvents(runtime.ledger.runId, journalLines);
  assert.deepEqual(replayed, runtime.ledger.state());
});

test("the launcher context mounts child research tools only under the grant", async (t) => {
  const runtime = await harness(t);
  await craftConflictStudy(runtime);
  const { permit } = await admitResearchChild(runtime);
  const started = await startTask(runtime, permit, "execution:r1-launch");
  const host = researchChildHost(runtime, started.task, "execution:r1-launch", started.launchClaimId);

  const plain = await runtime.scheduler.requestSpawn(runtime.root.id, runtime.root.assignedAgentId, {
    workloadKey: "plain-report-child",
    objective: "A child with no research grant sees no research tools.",
    workerKind: "analysis",
    workerLabel: "plain-report",
    mediaScope: [],
    inputArtifactIds: [runtime.source.id],
    requiredOutputs: [{ name: "note", artifactKind: "worker-note", required: true }],
    requiredCapabilities: ["report.submit"],
    dependencies: [],
    budget: { wallMs: 10_000, toolCalls: 1 },
  });
  assert.ok(plain.permit, plain.rejection ?? "plain child rejected");
  const plainTask = runtime.ledger.state().tasks[plain.permit.taskId];
  const plainContext = launcherChildCapabilityContext(plainTask);
  assert.equal(plainContext.researchGrant, undefined);
  assert.ok(!("STUDIO_CHILD_RESEARCH_BRIDGE_URL" in launcherChildCapabilityEnvironment(plainContext)));

  const context = launcherChildCapabilityContext(started.task);
  assert.ok(context.researchGrant);
  const hosts = {
    media: new FfmpegCapabilityHost(runtime.ledger, runtime.artifacts),
    frame: new BoundedFrameSamplingHost(runtime.ledger, runtime.artifacts),
    ocr: new BoundedOcrHost(runtime.ledger, runtime.artifacts, {}),
    speaker: new BoundedSpeakerOverlapHost(runtime.ledger, runtime.artifacts, {}),
    separation: new BoundedConditionalSeparationHost(runtime.ledger, runtime.artifacts, {}),
    research: host,
    evidence: new BoundedEvidenceReadHost(runtime.ledger, runtime.artifacts),
    assessment: new BoundedEvidenceAssessmentHost(runtime.ledger, runtime.artifacts),
    decision: new BoundedEvidenceDecisionHost(runtime.ledger, runtime.artifacts),
    semanticEvidence: new SpeechTranscribeCapabilityHost(runtime.ledger, runtime.artifacts, {}),
  };
  await openLauncherChildCapabilityBridges(started.task, hosts, { maximumWallMs: 60_000 }, context);
  try {
    assert.ok(context.researchBridge);
    const environment = launcherChildCapabilityEnvironment(context);
    assert.equal(environment.STUDIO_CHILD_RESEARCH_BRIDGE_URL, context.researchBridge.endpoint);
    assert.equal(environment.STUDIO_CHILD_RESEARCH_BRIDGE_TOKEN, context.researchBridge.token);
    const args: string[] = [];
    configureLauncherChildCapabilityMcp(args, started.task, { maximumWallMs: 60_000 }, context);
    const joined = args.join(" ");
    assert.match(joined, /mcp_servers\.studio_research\.command=/);
    assert.match(joined, /mcp_servers\.studio_research\.enabled_tools=\["research_search","research_document_snapshot"\]/);
    assert.match(joined, /STUDIO_CHILD_RESEARCH_BRIDGE_URL/);

    const manifest = await fetchChildResearchManifest(context.researchBridge.endpoint, context.researchBridge.token);
    assert.deepEqual(manifest.tools.map((tool) => tool.name), ["research_search", "research_document_snapshot"]);
    const result = await callChildResearchBridge(context.researchBridge.endpoint, context.researchBridge.token, "research_search", { query: "harvest festival toast" });
    assert.equal(result.op, "search");
    const operations = Object.values(runtime.ledger.state().researchOperations).filter((operation) => operation.taskId === started.task.id);
    assert.equal(operations.length, 1);
    assert.equal(operations[0].status, "completed");
  } finally {
    await closeLauncherChildCapabilityBridges(context);
  }
});

test("wired external_document_span citations admit cite-only and never upgrade", async (t) => {
  const runtime = await harness(t);
  await craftConflictStudy(runtime);
  const { permit } = await admitResearchChild(runtime);
  const started = await startTask(runtime, permit, "execution:r1-admit");
  const host = researchChildHost(runtime, started.task, "execution:r1-admit", started.launchClaimId);
  const grant = started.task.grants.find((candidate) => candidate.capability === "research.investigate")!;
  await host.search({
    operationId: "operation:r1:search:a", taskId: started.task.id, agentId: started.task.assignedAgentId,
    grantId: grant.id, op: "search", query: "harvest festival toast",
  });
  const snapshot = await host.snapshotDocument({
    operationId: "operation:r1:snapshot:a", taskId: started.task.id, agentId: started.task.assignedAgentId,
    grantId: grant.id, op: "document_snapshot", searchOperationId: "operation:r1:search:a", resultIndex: 1,
  });

  const verified = await reopenResearchCitationSource(runtime.artifacts, runtime.ledger.runId, snapshot.receiptContentId);
  assert.ok(grant.capability === "research.investigate");
  const gap = grant.researchScope.gap;
  const citation = externalDocumentSpanCitation({
    verified,
    target: {
      kind: "media_context",
      qualifiesMedia: { artifactId: gap.media.artifactId, trackId: gap.media.trackId, startMs: gap.media.startMs, endMs: gap.media.endMs },
    },
    spans: [{ start: 0, end: 19 }],
  });
  assert.equal(citation.use, "cite_only");

  const report: StudyReportArtifactV2 = {
    schema: "studio.study-report.v2",
    runId: runtime.ledger.runId,
    task: { taskId: started.task.id, agentId: started.task.assignedAgentId, executionId: "execution:r1-admit", jobContextId: started.task.jobContext.contextId },
    parent: { taskId: runtime.root.id, agentId: runtime.root.assignedAgentId },
    assignment: { source: { artifactId: runtime.source.id, contentId: runtime.source.content.contentId }, mediaScope: [runtime.scope] },
    coverage: [{
      ...runtime.scope,
      state: "withheld",
      claimIds: [],
      citationIds: [],
      rawStates: ["worker_withheld"],
      reason: { code: "worker_withheld", detail: "Research context qualifies this range without claiming dialogue support." },
    }],
    claims: [],
    evidenceCitations: [citation],
    sourceArtifacts: (() => {
      const expected = new Map<string, string>([[runtime.source.id, runtime.source.content.contentId]]);
      expected.set(citation.evidence.artifactId, citation.evidence.contentId);
      if (citation.receipt.artifactId) expected.set(citation.receipt.artifactId, citation.receipt.contentId);
      return [...expected.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([artifactId, contentId]) => ({ artifactId, contentId }));
    })(),
    limits: STUDY_REPORT_V2_LIMITS,
    nonClaims: {
      correctness: "not_assessed",
      completeness: "partition_only",
      semanticQuality: "not_assessed",
      modalityReliabilityEquivalence: "not_claimed",
      independentCorroboration: "not_assessed",
    },
  };
  const admitted = await new GeneralizedEvidenceAdmissionHost(runtime.ledger.state(), runtime.artifacts).admit(report);
  const admittedCitation = admitted.reportEnvelope.evidenceCitations[0];
  assert.equal(admittedCitation.evidenceKind, "external_document_span");
  assert.equal(admittedCitation.use, "cite_only");

  const upgraded: StudyReportArtifactV2 = structuredClone(report);
  (upgraded.evidenceCitations[0] as unknown as Record<string, unknown>).use = "claim_support";
  await assert.rejects(
    new GeneralizedEvidenceAdmissionHost(runtime.ledger.state(), runtime.artifacts).admit(upgraded),
    /claim support requires available current-run speech|canonical|identity/,
  );

  const foreign = structuredClone(runtime.ledger.state());
  foreign.researchOperations["operation:r1:snapshot:a"].executionId = "execution:someone-else";
  await assert.rejects(
    new GeneralizedEvidenceAdmissionHost(foreign, runtime.artifacts).admit(report),
    /cross-task or cross-executor/,
  );
});
