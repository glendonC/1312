import assert from "node:assert/strict";
import { appendFile, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import {
  canonicalSha256,
  ContentAddressedArtifactStore,
} from "../src/studio/runtime/production/artifactStore.ts";
import type {
  CurrentRunRecognizerDescriptor,
  ExecutorSpanReceipt,
  RuntimeArtifact,
  RuntimeLimits,
  SourceArtifactDescriptor,
  StudyCoverageRange,
  TaskRecord,
} from "../src/studio/runtime/production/model.ts";
import type {
  CurrentRunRecognizerInput,
  CurrentRunRecognizerResult,
  CurrentRunSpeechRecognizer,
} from "../src/studio/runtime/production/currentRunSpeechRecognizer.ts";
import { BoundedParentArtifactReadBridge } from "../src/studio/runtime/production/executor/parentArtifactReadBridge.ts";
import {
  buildStudyReportEnvelope,
  validateWorkerResult,
} from "../src/studio/runtime/production/executor/workerContract.ts";
import { MemoryEventJournal, RuntimeLedger } from "../src/studio/runtime/production/journal.ts";
import { ParentArtifactAdmissionHost } from "../src/studio/runtime/production/parentArtifactAdmissionHost.ts";
import { reopenParentArtifactDisposition } from "../src/studio/runtime/production/parentArtifactAdmissionAudit.ts";
import { ParentArtifactReadHost } from "../src/studio/runtime/production/parentArtifactReadHost.ts";
import type { PendingRuntimeEvent } from "../src/studio/runtime/production/protocol.ts";
import { projectRuntimeEvents } from "../src/studio/runtime/production/projection.ts";
import { BoundedReportHost } from "../src/studio/runtime/production/reportHost.ts";
import { reopenSemanticEvidence, semanticEvidenceCitation } from "../src/studio/runtime/production/semanticEvidenceAudit.ts";
import { SpeechTranscribeCapabilityHost } from "../src/studio/runtime/production/semanticEvidenceHost.ts";
import { BoundedRuntimeScheduler, type RuntimeIdentityFactory } from "../src/studio/runtime/production/scheduler.ts";
import { adaptAuthenticatedProductionRuntime } from "../src/studio/runtime/production/authenticatedStudioProjection.ts";
import { projectProductionRuntimeJournal } from "../src/studio/runtime/production/studioProjection.ts";
import { loadRuntimeInspectorJournal } from "../src/studio/runtime/production/runtimeInspector/journalLoader.ts";
import { validateCoveragePartition } from "../src/studio/runtime/production/validation/studyReports.ts";
import { runtimeTestJobContext } from "./runtime-test-job-context.ts";

const FIXTURE = resolve("public/demo/runs/run-005");

class Identities implements RuntimeIdentityFactory {
  private value = 0;
  next(kind: "request" | "task" | "agent" | "grant"): string {
    this.value += 1;
    return `${kind}:study-${this.value}`;
  }
  secret(): string {
    this.value += 1;
    return `secret:${this.value}`;
  }
}

async function sourceDescriptor(): Promise<SourceArtifactDescriptor> {
  const source = JSON.parse(await readFile(join(FIXTURE, "source.json"), "utf8")) as {
    receipt_id: string;
    content: { hash: { digest: string }; id: string; bytes: number };
  };
  const probe = JSON.parse(await readFile(join(FIXTURE, "media-probe.json"), "utf8")) as {
    duration: number;
    tracks: Array<{ index: number; type: "audio"; codec: string; duration: number }>;
  };
  return {
    schema: "studio.source-artifact.v1",
    adapterId: "owned-local-source-adapter.v1",
    sourceReceiptRef: source.receipt_id,
    publication: "private",
    path: join(FIXTURE, "clip.m4a"),
    content: {
      algorithm: "sha256",
      digest: source.content.hash.digest,
      contentId: source.content.id,
      bytes: source.content.bytes,
    },
    durationMs: Math.round(probe.duration * 1_000),
    tracks: probe.tracks.map((track) => ({
      id: `stream:${track.index}`,
      index: track.index,
      kind: track.type,
      codec: track.codec,
      durationMs: Math.round(track.duration * 1_000),
    })),
  };
}

function recognizerDescriptor(): CurrentRunRecognizerDescriptor {
  const configuration = {
    id: "studio.study-report-test-recognizer.v1",
    language: "ko",
    timestampMode: "segment" as const,
    segmentation: "producer_defined" as const,
  };
  return {
    id: "studio.study-report-test-recognizer",
    version: "1",
    model: "deterministic-current-run-test-model",
    runtime: { id: "node.test", version: process.version },
    configuration: { ...configuration, contentId: `sha256:${canonicalSha256(configuration)}` },
    executionScope: "current_run",
    fixtureContentId: null,
  };
}

class Recognizer implements CurrentRunSpeechRecognizer {
  async describe(): Promise<CurrentRunRecognizerDescriptor> {
    return recognizerDescriptor();
  }
  async recognize(input: CurrentRunRecognizerInput): Promise<CurrentRunRecognizerResult> {
    return {
      availability: "available",
      reason: "current_run_hypotheses_returned",
      segments: [{
        startMs: input.range.startMs,
        endMs: input.range.endMs,
        state: "available",
        text: "Current-run timed hypothesis; correctness is not assessed.",
      }],
    };
  }
}

const LIMITS: RuntimeLimits = {
  maxDepth: 1,
  maxActiveWorkers: 3,
  runBudget: { wallMs: 90_000, toolCalls: 12 },
  grantableCapabilities: ["task.spawn.request", "report.submit", "speech.transcribe"],
};

interface Harness {
  directory: string;
  artifactRoot: string;
  journal: MemoryEventJournal;
  ledger: RuntimeLedger;
  artifacts: ContentAddressedArtifactStore;
  scheduler: BoundedRuntimeScheduler;
  source: RuntimeArtifact;
  root: TaskRecord;
  child: TaskRecord;
  reportId: string;
  studyArtifactId: string;
  semanticArtifactId: string;
  semanticReceiptContentId: string;
  executorReceiptContentId: string;
}

async function harness(): Promise<Harness> {
  const directory = await mkdtemp(join(tmpdir(), "studio-study-admission-"));
  const artifactRoot = join(directory, "artifacts");
  const artifacts = new ContentAddressedArtifactStore(artifactRoot);
  const journal = new MemoryEventJournal();
  const ledger = await RuntimeLedger.open("runtime:study-admission-test", journal, {
    now: () => new Date("2026-07-16T15:00:00.000Z"),
  });
  const source = await artifacts.registerSource(ledger.runId, await sourceDescriptor());
  await artifacts.record(ledger, source);
  const scheduler = new BoundedRuntimeScheduler(ledger, LIMITS, new Identities());
  const scope = { artifactId: source.id, trackId: "stream:0", startMs: 0, endMs: 1_000 };
  const rootPermit = await scheduler.createRoot({
    workloadKey: "root:study-admission",
    objective: "Delegate coverage-bearing study work without making a quality claim.",
    workerKind: "orchestrator",
    workerLabel: "study-parent",
    mediaScope: [scope],
    inputArtifactIds: [source.id],
    requiredOutputs: [{ name: "root terminal", artifactKind: "root-terminal", required: true }],
    requiredCapabilities: ["task.spawn.request"],
    dependencies: [],
    budget: { wallMs: 30_000, toolCalls: 4 },
  }, runtimeTestJobContext({ source, range: { startMs: 0, endMs: 1_000 } }));
  await scheduler.claimTaskLaunch(rootPermit, "deterministic_test", "2026-07-16T15:00:00.000Z");
  await scheduler.registerAgent(rootPermit);
  await scheduler.transitionTask(rootPermit.taskId, rootPermit.agentId, "working");
  const decision = await scheduler.requestSpawn(rootPermit.taskId, rootPermit.agentId, {
    workloadKey: "study:0-1000",
    objective: "Create one typed coverage partition from current-run timed hypotheses.",
    workerKind: "analysis",
    workerLabel: "coverage-worker",
    mediaScope: [scope],
    inputArtifactIds: [source.id],
    requiredOutputs: [{ name: "coverage study", artifactKind: "studio.study-report.v1", required: true }],
    requiredCapabilities: ["speech.transcribe", "report.submit"],
    dependencies: [],
    budget: { wallMs: 20_000, toolCalls: 2 },
  });
  assert.ok(decision.permit);
  const claim = await scheduler.claimTaskLaunch(decision.permit, "deterministic_test", "2026-07-16T15:00:00.000Z");
  await scheduler.registerAgent(decision.permit);
  await scheduler.transitionTask(decision.permit.taskId, decision.permit.agentId, "working");
  const child = ledger.state().tasks[decision.permit.taskId];
  const executionId = "execution:study-worker";
  await ledger.transact(
    { producer: { kind: "launcher", id: "study-report-test-executor" }, causationId: decision.requestId },
    () => ({
      pending: [{ type: "executor.started", data: {
        executionId,
        taskId: child.id,
        agentId: child.assignedAgentId,
        launchClaimId: claim.claim.id,
        startedAt: "2026-07-16T15:00:00.000Z",
      } }] satisfies PendingRuntimeEvent[],
      result: undefined,
    }),
  );
  const semantic = await new SpeechTranscribeCapabilityHost(ledger, artifacts, { recognizer: new Recognizer() }).transcribe({
    operationId: "operation:study-semantic",
    taskId: child.id,
    agentId: child.assignedAgentId,
    ...scope,
  });
  const citation = semanticEvidenceCitation(await reopenSemanticEvidence(ledger.state(), artifacts, semantic.envelope.operationId));
  const worker = validateWorkerResult({
    summary: "A typed coverage partition was returned; correctness and semantic quality were not assessed.",
    semanticEvidenceInputs: [citation],
    outputs: [{
      name: "coverage study",
      kind: "studio.study-report.v1",
      coverage: [{ ...scope, state: "supported", claimIds: ["claim:study:0"], reason: null }],
      claims: [{
        claimId: "claim:study:0",
        ...scope,
        statement: "The current-run recognizer returned one timed transcript hypothesis for this exact range.",
        citations: [citation],
      }],
    }],
  }, child, [citation]);
  const output = worker.outputs[0];
  assert.equal(output.kind, "studio.study-report.v1");
  assert.ok("coverage" in output);
  const prepared = await artifacts.prepareStudyReport(ledger.runId, buildStudyReportEnvelope(child, output, [citation]));
  const spanBody = {
    executionId,
    taskId: child.id,
    agentId: child.assignedAgentId,
    phase: "active" as const,
    producer: { id: "studio.deterministic-test-executor" as const, version: "1" as const, sandbox: "read-only" as const, ephemeral: true as const },
    startedAt: "2026-07-16T15:00:00.000Z",
    endedAt: "2026-07-16T15:00:01.000Z",
    monotonicDurationMs: 1_000,
    outcome: "completed" as const,
    process: { exitCode: 0, signal: null },
    outputArtifactIds: [prepared.artifactId],
    modelUsageReceiptId: null,
    failure: null,
  };
  const span: ExecutorSpanReceipt = {
    schema: "studio.executor-span.receipt.v1",
    receiptId: `span:${canonicalSha256(spanBody)}`,
    ...spanBody,
  };
  const storedSpan = await artifacts.storeJson(span);
  const studyArtifact = artifacts.buildStudyReportArtifact({
    runId: ledger.runId,
    receipt: span,
    receiptContentId: storedSpan.content.contentId,
    prepared,
  });
  await artifacts.record(ledger, studyArtifact, executionId);
  await ledger.transact(
    { producer: { kind: "launcher", id: "study-report-test-executor" }, causationId: executionId },
    () => ({ pending: [{ type: "executor.finished", data: { receipt: span } }] satisfies PendingRuntimeEvent[], result: undefined }),
  );
  const report = await new BoundedReportHost(ledger, () => "report:coverage-study", artifacts).submit({
    taskId: child.id,
    agentId: child.assignedAgentId,
    outputArtifactIds: [studyArtifact.id],
    summary: worker.summary,
  });
  return {
    directory,
    artifactRoot,
    journal,
    ledger,
    artifacts,
    scheduler,
    source,
    root: ledger.state().tasks[rootPermit.taskId],
    child: ledger.state().tasks[child.id],
    reportId: report.id,
    studyArtifactId: studyArtifact.id,
    semanticArtifactId: semantic.artifact.id,
    semanticReceiptContentId: semantic.receiptContentId,
    executorReceiptContentId: storedSpan.content.contentId,
  };
}

async function accept(runtime: Harness) {
  return new ParentArtifactAdmissionHost(runtime.ledger, runtime.artifacts).record({
    reportId: runtime.reportId,
    parentTaskId: runtime.root.id,
    parentAgentId: runtime.root.assignedAgentId,
    outputArtifactId: runtime.studyArtifactId,
    outcome: "accepted",
    reason: "Accept exact structured content and grant only its bounded path-free read.",
  });
}

async function cleanup(runtime: Harness): Promise<void> {
  await rm(runtime.directory, { recursive: true, force: true });
}

function objectPath(root: string, contentId: string): string {
  const digest = contentId.slice("sha256:".length);
  return join(root, "objects", "sha256", digest.slice(0, 2), digest);
}

test("typed coverage report binds submission, admission, path-free least-privilege read, projection, and cold replay", async () => {
  const runtime = await harness();
  try {
    const submission = runtime.ledger.state().reports[runtime.reportId].study!;
    assert.deepEqual(submission.counts, {
      ranges: { supported: 1, withheld: 0, unknown: 0, failed: 0 },
      durationMs: { supported: 1_000, withheld: 0, unknown: 0, failed: 0 },
      claims: 1,
      citations: 1,
      observationCitations: 1,
    });
    assert.equal("percentage" in submission, false);
    assert.equal(submission.executor.receiptContentId, runtime.executorReceiptContentId);
    assert.deepEqual(submission.parentEdge, {
      childTaskId: runtime.child.id,
      childAgentId: runtime.child.assignedAgentId,
      parentTaskId: runtime.root.id,
      parentAgentId: runtime.root.assignedAgentId,
    });

    const admitted = await accept(runtime);
    assert.ok(admitted.admissionReceipt && admitted.grant);
    assert.equal(admitted.grant.capability, "artifact.read");
    assert.deepEqual(admitted.grant.contentScope.map((scope) => scope.contentId), [submission.output.contentId]);
    assert.equal(admitted.grant.maxBytes, submission.output.bytes);
    assert.equal(admitted.grant.maxItems, 1);
    const recursive = await reopenParentArtifactDisposition(
      runtime.ledger.state(), runtime.artifacts, admitted.dispositionReceipt.dispositionId,
    );
    assert.equal(recursive.study.semanticOperationIds[0], "operation:study-semantic");

    const bridge = new BoundedParentArtifactReadBridge(
      runtime.ledger.state().tasks[runtime.root.id],
      admitted.grant,
      new ParentArtifactReadHost(runtime.ledger, runtime.artifacts),
      () => "operation:parent-read:1",
    );
    assert.deepEqual(Object.keys(bridge.manifest().tool).sort(), ["admittedContentIds", "capability", "maxBytes", "maxItems", "name"].sort());
    const read = await bridge.call({ contentIds: [submission.output.contentId] });
    assert.equal(read.artifacts[0].content.schema, "studio.study-report.v1");
    assert.equal(JSON.stringify(read).includes(runtime.directory), false);
    assert.equal("path" in read.artifacts[0], false);
    await assert.rejects(
      new ParentArtifactReadHost(runtime.ledger, runtime.artifacts).read({
        operationId: "operation:parent-read:overflow",
        parentTaskId: runtime.root.id,
        parentAgentId: runtime.root.assignedAgentId,
        grantId: admitted.grant.id,
        contentIds: [submission.output.contentId],
      }),
      /byte or item ceiling/,
    );
    await assert.rejects(bridge.call({ contentIds: [`sha256:${"f".repeat(64)}`] }), /least-privilege grant/);
    await assert.rejects(
      new ParentArtifactReadHost(runtime.ledger, runtime.artifacts).read({
        operationId: "operation:prose-only",
        parentTaskId: runtime.root.id,
        parentAgentId: runtime.root.assignedAgentId,
        grantId: `Mentioned ${runtime.studyArtifactId} in prompt prose`,
        contentIds: [submission.output.contentId],
      }),
      /least-privilege grant/,
    );

    const projection = projectProductionRuntimeJournal(await runtime.ledger.events());
    assert.equal(projection.studyReports.length, 1);
    assert.equal(projection.studyReports[0].counts.durationMs.supported, 1_000);
    assert.equal(projection.studyReports[0].claims[0].citations[0].operationId, "operation:study-semantic");
    assert.equal(projection.studyReports[0].disposition.state, "accepted");
    assert.equal(projection.studyReports[0].admission.state, "admitted");
    assert.equal(projection.studyReports[0].reads[0].status, "completed");
    assert.equal(projection.studyReportStates[0].state, "accepted");
    const authenticated = await adaptAuthenticatedProductionRuntime(runtime.ledger.state(), runtime.artifacts);
    assert.equal(authenticated.studyReports[0].audit, "verified_on_reopen");
    const replayed = projectRuntimeEvents(runtime.ledger.runId, await runtime.ledger.events());
    assert.deepEqual(replayed, runtime.ledger.state());
    const events = await runtime.ledger.events();
    const inspected = await loadRuntimeInspectorJournal(`${events.map((event) => JSON.stringify(event)).join("\n")}\n`);
    assert.equal(inspected.projection.studyReports[0].admission.state, "admitted");
  } finally {
    await cleanup(runtime);
  }
});

test("coverage partitions reject gaps, overlaps, escape, and free-text-only or unsupported claims", async () => {
  const scope = [{ artifactId: "artifact:source", trackId: "stream:0", startMs: 0, endMs: 1_000 }];
  const closed = (startMs: number, endMs: number): StudyCoverageRange => ({
    artifactId: "artifact:source", trackId: "stream:0", startMs, endMs,
    state: "unknown", claimIds: [], reason: { code: "unobserved_range", detail: "No current-run semantic observation closed this range." },
  });
  assert.throws(() => validateCoveragePartition([closed(0, 400), closed(500, 1_000)], scope), /uncovered gap/);
  assert.throws(() => validateCoveragePartition([closed(0, 600), closed(500, 1_000)], scope), /overlaps/);
  assert.throws(() => validateCoveragePartition([closed(0, 1_001)], scope), /escapes/);

  const runtime = await harness();
  try {
    const task = runtime.child;
    const citation = semanticEvidenceCitation(await reopenSemanticEvidence(runtime.ledger.state(), runtime.artifacts, "operation:study-semantic"));
    assert.throws(() => validateWorkerResult({
      summary: "Prose-only ids are not a typed report.",
      semanticEvidenceInputs: [citation],
      outputs: [{ name: "coverage study", kind: "studio.study-report.v1", content: `Claim cites ${citation.artifactId}` }],
    }, task, [citation]), /typed study-report contract|open shape/);
    assert.throws(() => validateWorkerResult({
      summary: "A supported claim without citations must fail.",
      semanticEvidenceInputs: [citation],
      outputs: [{
        name: "coverage study", kind: "studio.study-report.v1",
        coverage: [{ ...task.mediaScope[0], state: "supported", claimIds: ["claim:unsupported"], reason: null }],
        claims: [{ claimId: "claim:unsupported", ...task.mediaScope[0], statement: "Unsupported prose.", citations: [] }],
      }],
    }, task, [citation]), /must cite exact semantic evidence/);
    const forged = structuredClone(citation);
    forged.operationId = "operation:another-run";
    assert.throws(() => validateWorkerResult({
      summary: "Cross-run citation must fail.", semanticEvidenceInputs: [citation],
      outputs: [{
        name: "coverage study", kind: "studio.study-report.v1",
        coverage: [{ ...task.mediaScope[0], state: "supported", claimIds: ["claim:cross-run"], reason: null }],
        claims: [{ claimId: "claim:cross-run", ...task.mediaScope[0], statement: "Cross-run.", citations: [forged] }],
      }],
    }, task, [citation]), /unsupported semantic citation/);
    assert.throws(() => validateWorkerResult({
      summary: "Wrong slot.", semanticEvidenceInputs: [citation],
      outputs: [{
        name: "wrong slot", kind: "studio.study-report.v1",
        coverage: [{ ...task.mediaScope[0], state: "unknown", claimIds: [], reason: { code: "unobserved_range", detail: "Closed." } }],
        claims: [],
      }],
    }, task, [citation]), /named artifact contracts/);
  } finally {
    await cleanup(runtime);
  }
});

test("rejection remains visible, grants nothing, rejects reads, and every artifact has one immutable disposition", async () => {
  const runtime = await harness();
  try {
    const reports = new BoundedReportHost(runtime.ledger, undefined, runtime.artifacts);
    await assert.rejects(reports.decide({
      reportId: runtime.reportId,
      decidedByTaskId: runtime.root.id,
      decidedByAgentId: runtime.root.assignedAgentId,
      accepted: true,
      reason: "A legacy decision must not create typed acceptance without admission.",
    }), /atomic parent artifact disposition/);
    const host = new ParentArtifactAdmissionHost(runtime.ledger, runtime.artifacts);
    await assert.rejects(host.record({
      reportId: runtime.reportId,
      parentTaskId: "task:wrong-parent",
      parentAgentId: runtime.root.assignedAgentId,
      outputArtifactId: runtime.studyArtifactId,
      outcome: "accepted",
      reason: "Forged acceptance by the wrong parent.",
    }), /exact active parent task owner/);
    await assert.rejects(host.record({
      reportId: runtime.reportId,
      parentTaskId: runtime.root.id,
      parentAgentId: runtime.root.assignedAgentId,
      outputArtifactId: runtime.source.id,
      outcome: "rejected",
      reason: "Wrong output slot.",
    }), /outside the typed report slot/);
    const rejected = await host.record({
      reportId: runtime.reportId,
      parentTaskId: runtime.root.id,
      parentAgentId: runtime.root.assignedAgentId,
      outputArtifactId: runtime.studyArtifactId,
      outcome: "rejected",
      reason: "Reject exact structured content and create no read authority.",
    });
    assert.equal(rejected.admissionReceipt, null);
    assert.equal(rejected.grant, null);
    assert.equal(Object.keys(runtime.ledger.state().parentArtifactReadGrants).length, 0);
    await assert.rejects(new ParentArtifactReadHost(runtime.ledger, runtime.artifacts).read({
      operationId: "operation:rejected-read",
      parentTaskId: runtime.root.id,
      parentAgentId: runtime.root.assignedAgentId,
      grantId: "grant:forged-from-prompt",
      contentIds: [runtime.ledger.state().artifacts[runtime.studyArtifactId].content.contentId],
    }), /least-privilege grant/);
    await assert.rejects(host.record({
      reportId: runtime.reportId,
      parentTaskId: runtime.root.id,
      parentAgentId: runtime.root.assignedAgentId,
      outputArtifactId: runtime.studyArtifactId,
      outcome: "rejected",
      reason: "Duplicate.",
    }), /already exists/);
    const projection = projectProductionRuntimeJournal(await runtime.ledger.events());
    assert.equal(projection.studyReports[0].disposition.state, "rejected");
    assert.equal(projection.studyReports[0].admission.state, "absent");
    assert.equal(projection.studyReportStates[0].state, "rejected");
  } finally {
    await cleanup(runtime);
  }
});

test("stored-byte drift anywhere in the recursive chain fails closed", async (t) => {
  const targets = [
    "source",
    "semantic-artifact",
    "semantic-receipt",
    "study-artifact",
    "executor-receipt",
    "admission-receipt",
    "disposition-receipt",
  ] as const;
  for (const target of targets) await t.test(target, async () => {
    const runtime = await harness();
    try {
      const admitted = await accept(runtime);
      const state = runtime.ledger.state();
      const contentId = target === "source" ? runtime.source.content.contentId
        : target === "semantic-artifact" ? state.artifacts[runtime.semanticArtifactId].content.contentId
          : target === "semantic-receipt" ? runtime.semanticReceiptContentId
            : target === "study-artifact" ? state.artifacts[runtime.studyArtifactId].content.contentId
              : target === "executor-receipt" ? runtime.executorReceiptContentId
                : target === "admission-receipt" ? admitted.admissionReceiptContentId!
                  : admitted.dispositionReceiptContentId;
      await appendFile(objectPath(runtime.artifactRoot, contentId), "drift");
      await assert.rejects(
        reopenParentArtifactDisposition(state, runtime.artifacts, admitted.dispositionReceipt.dispositionId),
        /content identity|registered content|canonical|changed/,
      );
      const authenticated = await adaptAuthenticatedProductionRuntime(state, runtime.artifacts);
      assert.equal(authenticated.studyReports[0].audit, "absent_or_invalid");
      assert.deepEqual(authenticated.studyReports[0].coverage, []);
      assert.equal(authenticated.studyReports[0].admission.state, "absent");
    } finally {
      await cleanup(runtime);
    }
  });
});

test("journal mutations for submission, acceptance/admission, and read accounting fail closed", async (t) => {
  const runtime = await harness();
  try {
    const admitted = await accept(runtime);
    const bridge = new BoundedParentArtifactReadBridge(
      runtime.ledger.state().tasks[runtime.root.id], admitted.grant!,
      new ParentArtifactReadHost(runtime.ledger, runtime.artifacts), () => "operation:mutation-read",
    );
    await bridge.call({ contentIds: [admitted.grant!.contentScope[0].contentId] });
    const original = await runtime.ledger.events();
    await t.test("report binding", async () => {
      const events = structuredClone(original);
      const event = events.find((candidate) => candidate.type === "report.submitted");
      assert.ok(event?.type === "report.submitted" && event.data.report.study);
      event.data.report.study.outputSlot.name = "forged-slot";
      assert.throws(() => projectRuntimeEvents(runtime.ledger.runId, events), /output slot|typed output binding|study content|report, context, output/i);
    });
    await t.test("forged acceptance grant", async () => {
      const events = structuredClone(original);
      const event = events.find((candidate) => candidate.type === "parent.artifact_disposition_recorded");
      assert.ok(event?.type === "parent.artifact_disposition_recorded" && event.data.admissionReceipt);
      event.data.admissionReceipt.grant.maxItems = 2;
      assert.throws(() => projectRuntimeEvents(runtime.ledger.runId, events), /admission|grant/);
    });
    await t.test("disposition parent", async () => {
      const events = structuredClone(original);
      const event = events.find((candidate) => candidate.type === "parent.artifact_disposition_recorded");
      assert.ok(event?.type === "parent.artifact_disposition_recorded");
      event.data.dispositionReceipt.parent.taskId = "task:forged-parent";
      assert.throws(() => projectRuntimeEvents(runtime.ledger.runId, events), /parent edge|report, context|binding/i);
    });
    await t.test("read byte accounting", async () => {
      const events = structuredClone(original);
      const event = events.find((candidate) => candidate.type === "parent.artifact_read_completed");
      assert.ok(event?.type === "parent.artifact_read_completed");
      event.data.receipt.consumed.bytes -= 1;
      assert.throws(() => projectRuntimeEvents(runtime.ledger.runId, events), /read result|counts|ceilings|content/i);
    });
    await t.test("read artifact byte substitution", async () => {
      const events = structuredClone(original);
      const event = events.find((candidate) => candidate.type === "parent.artifact_read_completed");
      assert.ok(event?.type === "parent.artifact_read_completed");
      event.data.receipt.returned[0].bytes -= 1;
      event.data.receipt.consumed.bytes -= 1;
      assert.throws(() => projectRuntimeEvents(runtime.ledger.runId, events), /read result|counts|content/i);
    });
    await t.test("read receipt identity", async () => {
      const events = structuredClone(original);
      const event = events.find((candidate) => candidate.type === "parent.artifact_read_completed");
      assert.ok(event?.type === "parent.artifact_read_completed");
      event.data.receipt.receiptId = "parent-artifact-read-receipt:forged";
      assert.throws(() => projectRuntimeEvents(runtime.ledger.runId, events), /read result|receiptId/i);
    });
    await t.test("stored study versus journal citations", async () => {
      const events = structuredClone(original);
      const event = events.find((candidate) => candidate.type === "report.submitted");
      assert.ok(event?.type === "report.submitted" && event.data.report.study);
      event.data.report.study.claims[0].statement = "Journal-only mutation";
      const state = projectRuntimeEvents(runtime.ledger.runId, events);
      await assert.rejects(
        reopenParentArtifactDisposition(state, runtime.artifacts, admitted.dispositionReceipt.dispositionId),
        /submission changed/,
      );
    });
  } finally {
    await cleanup(runtime);
  }
});
