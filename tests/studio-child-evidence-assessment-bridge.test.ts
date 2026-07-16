import assert from "node:assert/strict";
import { appendFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

import { ContentAddressedArtifactStore } from "../src/studio/runtime/production/artifactStore.ts";
import { BoundedEvidenceAssessmentHost } from "../src/studio/runtime/production/evidenceAssessmentHost.ts";
import { BoundedEvidenceDecisionHost } from "../src/studio/runtime/production/evidenceDecisionHost.ts";
import { BoundedEvidenceReadHost } from "../src/studio/runtime/production/evidenceHost.ts";
import {
  BoundedChildEvidenceAssessmentBridge,
  callChildEvidenceAssessmentBridge,
  openChildEvidenceAssessmentBridge,
} from "../src/studio/runtime/production/executor/childEvidenceAssessmentBridge.ts";
import {
  BoundedChildEvidenceBridge,
  type ChildEvidenceToolResult,
} from "../src/studio/runtime/production/executor/childEvidenceBridge.ts";
import {
  BoundedChildEvidenceDecisionBridge,
  callChildEvidenceDecisionBridge,
  openChildEvidenceDecisionBridge,
} from "../src/studio/runtime/production/executor/childEvidenceDecisionBridge.ts";
import { MemoryEventJournal, RuntimeLedger } from "../src/studio/runtime/production/journal.ts";
import { CodexExecWorkerLauncher } from "../src/studio/runtime/production/launcher.ts";
import { PublishReviewIntakeHost } from "../src/studio/runtime/production/publishReviewIntakeHost.ts";
import { PublishReviewHost } from "../src/studio/runtime/production/publishReviewHost.ts";
import type {
  EvidenceAssessmentClaim,
  SpawnRequestInput,
} from "../src/studio/runtime/production/model.ts";
import { BoundedReportHost } from "../src/studio/runtime/production/reportHost.ts";
import { loadOwnedSourceSession } from "../src/studio/runtime/production/runStart/sourceSessionLoader.ts";
import { BoundedRuntimeScheduler, type RuntimeIdentityFactory } from "../src/studio/runtime/production/scheduler.ts";
import { projectProductionRuntimeJournal } from "../src/studio/runtime/production/studioProjection.ts";
import { countAssessmentTokens } from "../src/studio/runtime/production/validation/assessment.ts";

const FIXTURE = resolve("public/demo/runs/run-005");
const MCP_SERVER = resolve("src/studio/runtime/production/executor/evidenceAssessmentMcpServer.ts");
const DECISION_MCP_SERVER = resolve("src/studio/runtime/production/executor/evidenceDecisionMcpServer.ts");

class SequenceIdentities implements RuntimeIdentityFactory {
  private value = 0;

  next(kind: "request" | "task" | "agent" | "grant"): string {
    this.value += 1;
    return `${kind}:evidence-assessment-${this.value}`;
  }

  secret(): string {
    this.value += 1;
    return `secret-${this.value}`;
  }
}

async function assessmentHarness(registerChild = true) {
  const directory = await mkdtemp(join(tmpdir(), "studio-child-evidence-assessment-"));
  const loaded = await loadOwnedSourceSession(FIXTURE);
  const artifacts = new ContentAddressedArtifactStore(join(directory, "artifacts"));
  const source = await artifacts.registerSource("runtime:child-evidence-assessment", loaded.descriptor);
  const evidence = await Promise.all(loaded.evidenceDescriptors.map((descriptor) =>
    artifacts.registerPreflightEvidence("runtime:child-evidence-assessment", source.id, descriptor)));
  const ledger = await RuntimeLedger.open("runtime:child-evidence-assessment", new MemoryEventJournal(), {
    now: () => new Date("2026-07-15T12:00:00.000Z"),
  });
  await artifacts.record(ledger, source);
  for (const artifact of evidence) await artifacts.record(ledger, artifact);
  const scheduler = new BoundedRuntimeScheduler(ledger, {
    maxDepth: 1,
    maxActiveWorkers: 2,
    runBudget: { wallMs: 30_000, toolCalls: 8 },
    grantableCapabilities: [
      "task.spawn.request",
      "report.submit",
      "evidence.read",
      "analysis.evidence.assess",
      "analysis.evidence.decide",
    ],
  }, new SequenceIdentities());
  const inputArtifactIds = [source.id, ...evidence.map((artifact) => artifact.id)];
  const mediaScope = [{ artifactId: source.id, trackId: "stream:0", startMs: 0, endMs: 3_000 }];
  const root = await scheduler.createRoot({
    workloadKey: "root:child-evidence-assessment",
    objective: "Authorize one bounded child evidence-assessment test.",
    workerKind: "orchestrator",
    workerLabel: "evidence-assessment-root",
    mediaScope,
    inputArtifactIds,
    requiredOutputs: [{ name: "run report", artifactKind: "run-report", required: true }],
    requiredCapabilities: ["task.spawn.request"],
    dependencies: [],
    budget: { wallMs: 10_000, toolCalls: 1 },
  });
  await scheduler.registerAgent(root);
  await scheduler.transitionTask(root.taskId, root.agentId, "working");
  const child: SpawnRequestInput = {
    workloadKey: "child:evidence-assessment",
    objective: "Read pinned receipts, then assess only their returned facts under hard bounds.",
    workerKind: "analysis",
    workerLabel: "evidence-assessor",
    mediaScope,
    inputArtifactIds,
    requiredOutputs: [{ name: "evidence report", artifactKind: "worker-execution-report", required: true }],
    requiredCapabilities: [
      "evidence.read",
      "analysis.evidence.assess",
      "analysis.evidence.decide",
      "report.submit",
    ],
    dependencies: [],
    budget: { wallMs: 20_000, toolCalls: 4 },
  };
  const decision = await scheduler.requestSpawn(root.taskId, root.agentId, child);
  assert.ok(decision.permit);
  if (registerChild) {
    await scheduler.registerAgent(decision.permit);
    await scheduler.transitionTask(decision.permit.taskId, decision.permit.agentId, "working");
  }
  const task = ledger.state().tasks[decision.permit.taskId];
  return { directory, artifacts, ledger, scheduler, source, evidence, task, permit: decision.permit };
}

async function readAll(runtime: Awaited<ReturnType<typeof assessmentHarness>>): Promise<ChildEvidenceToolResult[]> {
  let operation = 0;
  const bridge = new BoundedChildEvidenceBridge(
    runtime.task,
    new BoundedEvidenceReadHost(runtime.ledger, runtime.artifacts),
    { nextOperationId: () => `operation:assessment-read:${++operation}` },
  );
  const results = [];
  for (const artifact of runtime.evidence) results.push(await bridge.call({ artifactId: artifact.id }));
  return results;
}

function claimsFor(results: ChildEvidenceToolResult[]): EvidenceAssessmentClaim[] {
  return results.map((result) => {
    const languageIndex = result.receipt.facts.findIndex((fact) =>
      fact.kind === "language_range" && fact.decision.status !== "classified");
    const factIndex = languageIndex >= 0 ? languageIndex : 0;
    const fact = result.receipt.facts[factIndex];
    assert.ok(fact);
    const citations = [{
      receiptId: result.receiptId,
      receiptContentId: result.receiptContentId,
      factIndexes: [factIndex],
    }];
    const range = { startMs: fact.startMs, endMs: fact.endMs };
    if (fact.kind === "language_range") {
      return {
        kind: "language_identity",
        value: fact.decision.status === "classified" ? fact.decision.code : null,
        range,
        citations,
      };
    }
    return {
      kind: "speech_activity",
      value: fact.kind === "speech_window" ? "speech" : "non_speech",
      range,
      citations,
    };
  });
}

function assessmentArgs(results: ChildEvidenceToolResult[]) {
  return {
    readReceipts: results.map((result) => ({
      receiptId: result.receiptId,
      receiptContentId: result.receiptContentId,
    })),
    claims: claimsFor(results),
  };
}

async function completeAssessment(
  runtime: Awaited<ReturnType<typeof assessmentHarness>>,
  reads: ChildEvidenceToolResult[],
  operationId: string,
) {
  return new BoundedChildEvidenceAssessmentBridge(
    runtime.task,
    new BoundedEvidenceAssessmentHost(runtime.ledger, runtime.artifacts),
    { nextOperationId: () => operationId },
  ).call(assessmentArgs(reads));
}

function auditedAssessmentIdentity(
  assessment: Awaited<ReturnType<typeof completeAssessment>>,
) {
  return {
    operationId: assessment.operationId,
    artifactId: assessment.outputArtifactId,
    receiptId: assessment.receiptId,
    receiptContentId: assessment.receiptContentId,
  };
}

test("stdio evidence_assess emits a content-addressed range/citation receipt over completed reads", async () => {
  const runtime = await assessmentHarness();
  const reads = await readAll(runtime);
  const bridge = new BoundedChildEvidenceAssessmentBridge(
    runtime.task,
    new BoundedEvidenceAssessmentHost(runtime.ledger, runtime.artifacts),
    { nextOperationId: () => "operation:evidence-assessment:happy" },
  );
  const opened = await openChildEvidenceAssessmentBridge(bridge);
  const client = new Client({ name: "studio-child-evidence-assessment-test", version: "1" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [MCP_SERVER],
    env: {
      STUDIO_CHILD_EVIDENCE_ASSESSMENT_BRIDGE_URL: opened.endpoint,
      STUDIO_CHILD_EVIDENCE_ASSESSMENT_BRIDGE_TOKEN: opened.token,
    },
    stderr: "pipe",
  });
  try {
    await client.connect(transport);
    assert.deepEqual((await client.listTools()).tools.map((tool) => tool.name), ["evidence_assess"]);
    const called = await client.callTool({ name: "evidence_assess", arguments: assessmentArgs(reads) });
    assert.equal(called.isError, undefined);
    if (!Array.isArray(called.content)) assert.fail("MCP assessment result must be an array");
    const result = JSON.parse((called.content[0] as { text?: string }).text ?? "{}") as Awaited<ReturnType<typeof callChildEvidenceAssessmentBridge>>;
    assert.equal(result.schema, "studio.child-evidence-assessment-tool-result.v1");
    assert.equal(result.receipt.schema, "studio.evidence-assessment.receipt.v1");
    assert.equal(result.receipt.inputs.length, 2);
    assert.equal(result.receipt.claims.length, 2);
    assert.ok(result.receipt.claims.every((claim) => claim.citations.length > 0));
    assert.ok(result.receipt.claims.every((claim) => claim.range.endMs > claim.range.startMs));
    assert.ok(result.receipt.result.claimCount <= result.receipt.authorization.maxClaims);
    assert.ok(result.receipt.result.citationCount <= result.receipt.authorization.maxCitations);
    assert.ok(result.receipt.result.tokenCount <= result.receipt.authorization.maxTokens);
    const uncertain = result.receipt.claims.find((claim) => claim.kind === "language_identity" && claim.value === null);
    if (uncertain) assert.ok(uncertain.states.includes("unknown") || uncertain.states.includes("withheld"));
    assert.equal("path" in result, false);

    const events = await runtime.ledger.events();
    assert.equal(events.filter((event) => event.type === "analysis.evidence.assessment_started").length, 1);
    assert.equal(events.filter((event) => event.type === "analysis.evidence.assessment_completed").length, 1);
    const product = projectProductionRuntimeJournal(events);
    assert.equal(product.evidenceAssessments.length, 1);
    assert.equal(product.evidenceAssessments[0].status, "completed");
    assert.equal(product.assessmentArtifacts.length, 1);
    assert.equal(product.assessmentArtifacts[0].receiptId, result.receiptId);
  } finally {
    await client.close().catch(() => undefined);
    await opened.close();
    await rm(runtime.directory, { recursive: true, force: true });
  }
});

test("assessment rejects raw/open inputs, unread receipts, and out-of-bounds fact indexes", async () => {
  const runtime = await assessmentHarness();
  const host = new BoundedEvidenceAssessmentHost(runtime.ledger, runtime.artifacts);
  const bridge = new BoundedChildEvidenceAssessmentBridge(runtime.task, host, {
    nextOperationId: () => "operation:evidence-assessment:negative",
  });
  try {
    await assert.rejects(
      bridge.call({ readReceipts: [], claims: [], path: "speech-activity.json" }),
      /accepts only completed read-receipt identities/,
    );
    const fakeId = `sha256:${"a".repeat(64)}`;
    await assert.rejects(bridge.call({
      readReceipts: [{ receiptId: "evidence-read:unread", receiptContentId: fakeId }],
      claims: [{
        kind: "speech_activity",
        value: "speech",
        range: { startMs: 0, endMs: 1 },
        citations: [{ receiptId: "evidence-read:unread", receiptContentId: fakeId, factIndexes: [0] }],
      }],
    }), /rejected or failed/);
    assert.equal(Object.keys(runtime.ledger.state().evidenceAssessments).length, 0);

    const reads = await readAll(runtime);
    const args = assessmentArgs(reads);
    args.claims[0].citations[0].factIndexes = [reads[0].receipt.facts.length];
    await assert.rejects(bridge.call(args), /rejected or failed/);
    const events = await runtime.ledger.events();
    assert.equal(events.filter((event) => event.type === "analysis.evidence.assessment_started").length, 1);
    assert.equal(events.filter((event) => event.type === "analysis.evidence.assessment_failed").length, 1);
    assert.equal(events.some((event) => event.type === "analysis.evidence.assessment_completed"), false);
  } finally {
    await rm(runtime.directory, { recursive: true, force: true });
  }
});

test("stdio evidence_decide emits one withheld receipt over a live audited assessment identity", async () => {
  const runtime = await assessmentHarness();
  const reads = await readAll(runtime);
  const assessment = await completeAssessment(runtime, reads, "operation:evidence-assessment:decision-happy");
  const bridge = new BoundedChildEvidenceDecisionBridge(
    runtime.task,
    new BoundedEvidenceDecisionHost(runtime.ledger, runtime.artifacts),
    { nextOperationId: () => "operation:evidence-decision:happy" },
  );
  const opened = await openChildEvidenceDecisionBridge(bridge);
  const client = new Client({ name: "studio-child-evidence-decision-test", version: "1" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [DECISION_MCP_SERVER],
    env: {
      STUDIO_CHILD_EVIDENCE_DECISION_BRIDGE_URL: opened.endpoint,
      STUDIO_CHILD_EVIDENCE_DECISION_BRIDGE_TOKEN: opened.token,
    },
    stderr: "pipe",
  });
  try {
    await client.connect(transport);
    assert.deepEqual((await client.listTools()).tools.map((tool) => tool.name), ["evidence_decide"]);
    const called = await client.callTool({
      name: "evidence_decide",
      arguments: { auditedAssessments: [auditedAssessmentIdentity(assessment)] },
    });
    assert.equal(called.isError, undefined);
    if (!Array.isArray(called.content)) assert.fail("MCP decision result must be an array");
    const result = JSON.parse(
      (called.content[0] as { text?: string }).text ?? "{}",
    ) as Awaited<ReturnType<typeof callChildEvidenceDecisionBridge>>;
    assert.equal(result.schema, "studio.child-evidence-decision-tool-result.v1");
    assert.equal(result.receipt.schema, "studio.evidence-decision.receipt.v1");
    assert.equal(result.receipt.producer.id, "studio.deterministic-audited-assessment-decision");
    assert.equal(result.receipt.decision.outcome, "withheld");
    assert.ok(result.receipt.decision.reasonCodes.some((reason) =>
      reason === "audited_claim_withheld" ||
      reason === "audited_claim_unknown" ||
      reason === "audited_claim_truncated"));
    assert.deepEqual(result.receipt.inputs, [auditedAssessmentIdentity(assessment)]);
    assert.equal("path" in result, false);
    assert.equal("caption" in result.receipt, false);
    assert.equal("publication" in result.receipt, false);

    const events = await runtime.ledger.events();
    assert.equal(events.filter((event) => event.type === "analysis.evidence.decision_started").length, 1);
    assert.equal(events.filter((event) => event.type === "analysis.evidence.decision_completed").length, 1);
    const product = projectProductionRuntimeJournal(events);
    assert.equal(product.evidenceDecisions.length, 1);
    assert.equal(product.evidenceDecisions[0].outcome, "withheld");
    assert.equal(product.decisionArtifacts.length, 1);
    assert.equal(product.decisionArtifacts[0].receiptId, result.receiptId);

    const intakeHost = new PublishReviewIntakeHost(runtime.ledger, runtime.artifacts);
    const intakeRequest = {
      decision: {
        operationId: result.operationId,
        artifactId: result.outputArtifactId,
        receiptId: result.receiptId,
        receiptContentId: result.receiptContentId,
      },
    };
    await assert.rejects(
      intakeHost.create({
        ...intakeRequest,
        rawDecisionBytes: JSON.stringify(result.receipt),
        path: "decision.json",
        caption: "caller-authored caption",
        prose: "queue this",
      }),
      /Publish-review intake request/,
    );
    const intake = await intakeHost.create(intakeRequest);
    assert.equal(intake.receipt.schema, "studio.publish-review-intake.receipt.v1");
    assert.equal(intake.receipt.result.outcome, "rejected");
    assert.deepEqual(intake.receipt.result.reasonCodes, result.receipt.decision.reasonCodes);
    assert.deepEqual(intake.receipt.input.decision, intakeRequest.decision);
    assert.equal("caption" in intake.receipt, false);
    assert.equal("publication" in intake.receipt, false);
    assert.equal("path" in intake.receipt, false);
    assert.equal("prose" in intake.receipt, false);
    const intakeEvents = await runtime.ledger.events();
    assert.equal(intakeEvents.filter((event) => event.type === "publish.review.intake_started").length, 1);
    assert.equal(intakeEvents.filter((event) => event.type === "publish.review.intake_completed").length, 1);
    const intakeProduct = projectProductionRuntimeJournal(intakeEvents);
    assert.equal(intakeProduct.publishReviewIntakes.length, 1);
    assert.equal(intakeProduct.publishReviewIntakes[0].outcome, "rejected");
    assert.equal(intakeProduct.publishReviewIntakeArtifacts.length, 1);
    await assert.rejects(
      new PublishReviewHost(
        runtime.ledger,
        runtime.artifacts,
        { id: "reviewer:test-operator", label: "Test review operator" },
      ).decide({
        intake: {
          intakeId: intake.receipt.intakeId,
          artifactId: intake.outputArtifactId,
          receiptId: intake.receipt.receiptId,
          receiptContentId: intake.receiptContentId,
        },
        reviewer: {
          id: "reviewer:test-operator",
          attestation: "I attest that I am the named reviewer and made this review decision.",
        },
        decision: {
          outcome: "reject_with_reasons",
          reasonCodes: ["evidence_requires_additional_review"],
          note: null,
        },
      }),
      /host-verified queued intake identity/,
    );
    assert.equal(
      (await runtime.ledger.events()).some((event) => event.type === "publish.review.decision_started"),
      false,
    );
  } finally {
    await client.close().catch(() => undefined);
    await opened.close();
    await rm(runtime.directory, { recursive: true, force: true });
  }
});

test("decision bridge rejects raw, path-like, caller-authored outcomes and non-audited identities", async () => {
  const runtime = await assessmentHarness();
  const reads = await readAll(runtime);
  const assessment = await completeAssessment(runtime, reads, "operation:evidence-assessment:decision-negative");
  let operation = 0;
  const bridge = new BoundedChildEvidenceDecisionBridge(
    runtime.task,
    new BoundedEvidenceDecisionHost(runtime.ledger, runtime.artifacts),
    { nextOperationId: () => `operation:evidence-decision:negative:${++operation}` },
  );
  try {
    const identity = auditedAssessmentIdentity(assessment);
    await assert.rejects(
      new PublishReviewIntakeHost(runtime.ledger, runtime.artifacts).create({
        decision: identity,
      }),
      /requires one exact host-verified decision receipt identity/,
    );
    await assert.rejects(
      bridge.call({
        auditedAssessments: [identity],
        path: "assessment.json",
        rawAssessmentBytes: "{}",
      }),
      /accepts only audited assessment operation, artifact, receipt, and content identities/,
    );
    await assert.rejects(
      bridge.call({ auditedAssessments: [identity], outcome: "proceed_to_publish_review", prose: "looks good" }),
      /accepts only audited assessment operation, artifact, receipt, and content identities/,
    );
    await assert.rejects(
      bridge.call({
        auditedAssessments: [{
          ...identity,
          artifactId: "artifact:assessment:not-audited",
        }],
      }),
      /rejected or failed/,
    );
    const events = await runtime.ledger.events();
    assert.equal(events.some((event) => event.type === "analysis.evidence.decision_started"), false);
    assert.equal(Object.keys(runtime.ledger.state().evidenceDecisions).length, 0);
  } finally {
    await rm(runtime.directory, { recursive: true, force: true });
  }
});

test("decision starts then fails closed when an assessment receipt changes after authorization", async () => {
  const runtime = await assessmentHarness();
  const reads = await readAll(runtime);
  const assessment = await completeAssessment(runtime, reads, "operation:evidence-assessment:decision-tamper");
  const digest = assessment.receiptContentId.slice("sha256:".length);
  const receiptPath = join(runtime.directory, "artifacts", "objects", "sha256", digest.slice(0, 2), digest);
  const bridge = new BoundedChildEvidenceDecisionBridge(
    runtime.task,
    new BoundedEvidenceDecisionHost(runtime.ledger, runtime.artifacts),
    { nextOperationId: () => "operation:evidence-decision:tamper" },
  );
  try {
    await appendFile(receiptPath, "tampered");
    await assert.rejects(
      bridge.call({ auditedAssessments: [auditedAssessmentIdentity(assessment)] }),
      /rejected or failed/,
    );
    const events = await runtime.ledger.events();
    assert.equal(events.filter((event) => event.type === "analysis.evidence.decision_started").length, 1);
    assert.equal(events.filter((event) => event.type === "analysis.evidence.decision_failed").length, 1);
    assert.equal(events.some((event) => event.type === "analysis.evidence.decision_completed"), false);
    assert.equal(runtime.ledger.state().evidenceDecisions["operation:evidence-decision:tamper"].status, "failed");
  } finally {
    await rm(runtime.directory, { recursive: true, force: true });
  }
});

test("assessment count and structured claim budgets fail closed", async () => {
  const runtime = await assessmentHarness();
  const reads = await readAll(runtime);
  let operation = 0;
  const bridge = new BoundedChildEvidenceAssessmentBridge(
    runtime.task,
    new BoundedEvidenceAssessmentHost(runtime.ledger, runtime.artifacts),
    { nextOperationId: () => `operation:evidence-assessment:budget:${++operation}` },
  );
  try {
    const args = assessmentArgs(reads);
    const tokenHeavyClaims = Array.from({ length: 8 }, () => ({
      ...structuredClone(args.claims[0]),
      citations: [{
        ...structuredClone(args.claims[0].citations[0]),
        factIndexes: [0, 1, 2, 3],
      }],
    }));
    assert.ok(countAssessmentTokens(tokenHeavyClaims) > 512);
    await assert.rejects(
      bridge.call({ ...args, claims: tokenHeavyClaims }),
      /structured tokens|rejected/,
    );
    assert.equal(Object.values(runtime.ledger.state().evidenceAssessments).length, 0);
    await bridge.call(args);
    await assert.rejects(bridge.call(args), /rejected or failed/);
    assert.equal(Object.values(runtime.ledger.state().evidenceAssessments).length, 1);
    await assert.rejects(
      bridge.call({ ...args, claims: Array.from({ length: 9 }, () => args.claims[0]) }),
      /range-bound claims|claim, citation, or token budget|rejected/,
    );
  } finally {
    await rm(runtime.directory, { recursive: true, force: true });
  }
});

async function fakeAssessmentCodex(
  directory: string,
  mode: "complete" | "skip-decision" | "skip-assessment",
): Promise<{ executable: string; prefix: string[] }> {
  const path = join(directory, `fake-assessment-codex-${mode}.mjs`);
  await writeFile(path, `
import { readFile } from "node:fs/promises";
const mode = ${JSON.stringify(mode)};
const shouldAssess = mode !== "skip-assessment";
const shouldDecide = mode === "complete";
const args = process.argv.slice(2);
if (args[0] === "--version") { process.stdout.write("codex-cli fake-assessment-1.0.0\\n"); process.exit(0); }
let prompt = "";
for await (const chunk of process.stdin) prompt += chunk;
if (!prompt.includes("invoke evidence_assess exactly once")) throw new Error("bounded assessment prompt was not supplied");
if (!prompt.includes("invoke evidence_decide exactly once")) throw new Error("bounded decision prompt was not supplied");
const contract = JSON.parse(prompt.split("\\n\\n").at(-1));
const reads = [];
for (const scope of contract.grantedEvidence) {
  const response = await fetch(process.env.STUDIO_CHILD_EVIDENCE_BRIDGE_URL + "/v1/call", {
    method: "POST",
    headers: { Authorization: "Bearer " + process.env.STUDIO_CHILD_EVIDENCE_BRIDGE_TOKEN, "Content-Type": "application/json" },
    body: JSON.stringify({ name: "evidence_read", arguments: { artifactId: scope.artifactId } }),
  });
  const body = await response.json();
  if (!response.ok || body.ok !== true) throw new Error("evidence read failed");
  reads.push(body.result);
}
let assessment = null;
let decision = null;
if (shouldAssess) {
  const claims = reads.map((result) => {
    const fact = result.receipt.facts[0];
    const citation = [{ receiptId: result.receiptId, receiptContentId: result.receiptContentId, factIndexes: [0] }];
    const range = { startMs: fact.startMs, endMs: fact.endMs };
    return fact.kind === "language_range"
      ? { kind: "language_identity", value: fact.decision.status === "classified" ? fact.decision.code : null, range, citations: citation }
      : { kind: "speech_activity", value: fact.kind === "speech_window" ? "speech" : "non_speech", range, citations: citation };
  });
  const response = await fetch(process.env.STUDIO_CHILD_EVIDENCE_ASSESSMENT_BRIDGE_URL + "/v1/call", {
    method: "POST",
    headers: { Authorization: "Bearer " + process.env.STUDIO_CHILD_EVIDENCE_ASSESSMENT_BRIDGE_TOKEN, "Content-Type": "application/json" },
    body: JSON.stringify({ name: "evidence_assess", arguments: {
      readReceipts: reads.map((result) => ({ receiptId: result.receiptId, receiptContentId: result.receiptContentId })), claims,
    } }),
  });
  const body = await response.json();
  if (!response.ok || body.ok !== true) throw new Error("evidence assessment failed");
  assessment = body.result;
}
if (shouldDecide) {
  const response = await fetch(process.env.STUDIO_CHILD_EVIDENCE_DECISION_BRIDGE_URL + "/v1/call", {
    method: "POST",
    headers: { Authorization: "Bearer " + process.env.STUDIO_CHILD_EVIDENCE_DECISION_BRIDGE_TOKEN, "Content-Type": "application/json" },
    body: JSON.stringify({ name: "evidence_decide", arguments: { auditedAssessments: [{
      operationId: assessment.operationId,
      artifactId: assessment.outputArtifactId,
      receiptId: assessment.receiptId,
      receiptContentId: assessment.receiptContentId,
    }] } }),
  });
  const body = await response.json();
  if (!response.ok || body.ok !== true) throw new Error("evidence decision failed");
  decision = body.result;
}
const schemaPath = args[args.indexOf("--output-schema") + 1];
const schema = JSON.parse(await readFile(schemaPath, "utf8"));
const output = {
  summary: decision ? "Completed bounded evidence assessment and decision." : assessment ? "Skipped bounded evidence decision." : "Skipped bounded evidence assessment.",
  outputs: [{
    name: schema.properties.outputs.items.properties.name.enum[0],
    kind: schema.properties.outputs.items.properties.kind.enum[0],
    content: decision ? decision.operationId + "; " + decision.receiptId + "; " + decision.receiptContentId + "; " + decision.receipt.decision.outcome : assessment ? assessment.operationId + "; " + assessment.receiptId + "; " + assessment.receiptContentId : "No assessment completed.",
  }],
};
const events = [
  { type: "thread.started", thread_id: "thread:fake-assessment" },
  { type: "turn.started" },
  { type: "item.completed", item: { id: "item:fake-assessment", type: "agent_message", text: JSON.stringify(output) } },
  { type: "turn.completed", usage: { input_tokens: 80, cached_input_tokens: 10, output_tokens: 30, reasoning_output_tokens: 5 } },
];
process.stdout.write(events.map((event) => JSON.stringify(event)).join("\\n") + "\\n");
`, { encoding: "utf8", mode: 0o600, flag: "wx" });
  return { executable: process.execPath, prefix: [path] };
}

test("launcher requires completed granted assessment and decision calls before accepting child output", async (suite) => {
  for (const [name, mode] of [
    ["completed assessment and decision", "complete"],
    ["skipped granted decision", "skip-decision"],
    ["skipped granted assessment", "skip-assessment"],
  ] as const) {
    await suite.test(name, async () => {
      const runtime = await assessmentHarness(false);
      try {
        const fake = await fakeAssessmentCodex(runtime.directory, mode);
        let readOperation = 0;
        const launcher = new CodexExecWorkerLauncher(
          runtime.ledger,
          runtime.scheduler,
          runtime.artifacts,
          new BoundedReportHost(runtime.ledger),
          {
            executable: fake.executable,
            executableArgsPrefix: fake.prefix,
            nextExecutionId: () => `execution:fake-assessment:${mode}`,
            nextEvidenceOperationId: () => `operation:fake-assessment-read:${++readOperation}`,
            nextAssessmentOperationId: () => "operation:fake-assessment",
            nextDecisionOperationId: () => "operation:fake-decision",
            maximumWallMs: 5_000,
          },
        );
        if (mode === "complete") {
          const result = await launcher.launch(runtime.permit);
          assert.equal(result.execution.outcome, "completed");
          assert.equal(Object.values(runtime.ledger.state().evidenceAssessments)[0].status, "completed");
          assert.equal(Object.values(runtime.ledger.state().evidenceDecisions)[0].status, "completed");
          const completedDecision = Object.values(runtime.ledger.state().evidenceDecisions)[0];
          assert.ok(completedDecision.artifactId && completedDecision.receiptId && completedDecision.receiptContentId);
          const intake = await new PublishReviewIntakeHost(runtime.ledger, runtime.artifacts).create({
            decision: {
              operationId: completedDecision.id,
              artifactId: completedDecision.artifactId,
              receiptId: completedDecision.receiptId,
              receiptContentId: completedDecision.receiptContentId,
            },
          });
          assert.equal(
            intake.receipt.result.outcome,
            completedDecision.outcome === "proceed_to_publish_review" ? "queued" : "rejected",
          );
          assert.equal(Object.values(runtime.ledger.state().publishReviewIntakes)[0].status, "completed");
        } else if (mode === "skip-decision") {
          await assert.rejects(launcher.launch(runtime.permit), /did not complete its granted evidence decision/);
          assert.equal(runtime.ledger.state().tasks[runtime.permit.taskId].status, "failed");
          assert.equal(Object.values(runtime.ledger.state().evidenceAssessments)[0].status, "completed");
          assert.equal(Object.keys(runtime.ledger.state().evidenceDecisions).length, 0);
        } else {
          await assert.rejects(launcher.launch(runtime.permit), /did not complete its granted evidence assessment/);
          assert.equal(runtime.ledger.state().tasks[runtime.permit.taskId].status, "failed");
          assert.equal(Object.keys(runtime.ledger.state().evidenceAssessments).length, 0);
        }
      } finally {
        await rm(runtime.directory, { recursive: true, force: true });
      }
    });
  }
});
