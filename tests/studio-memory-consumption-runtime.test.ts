import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import { FileEventJournal, RuntimeLedger } from "../src/studio/runtime/production/journal.ts";
import {
  bindReviewedMemoryForRun,
  consumeAcceptedMemorySnapshotForRun,
  inspectMemoryReviewArtifacts,
  memoryContentId,
} from "../src/studio/runtime/production/memory/inspection.ts";
import {
  MEMORY_REVIEW_SCHEMAS,
  type MemoryConsumptionReceipt,
  type MemoryDecision,
  type MemoryLegacySnapshot,
  type MemoryMaterialization,
  type MemoryProposal,
} from "../src/studio/runtime/production/memory/model.ts";
import { createProductionAnalysisRequest } from "../src/studio/runtime/production/runStart/analysisRequest.ts";
import { loadOwnedSourceSession } from "../src/studio/runtime/production/runStart/sourceSessionLoader.ts";
import {
  DeterministicRuntimeExecutor,
  deterministicOrchestratorLauncherFactory,
  initializeRuntimeApplication,
  runBoundedRuntimeApplication,
} from "../src/studio/runtime/production/runtimeHost/index.ts";
import { assertTaskJobContext } from "../src/studio/runtime/production/validation/taskJobContext.ts";
import { createRootTaskJobContext } from "../src/studio/runtime/production/jobContext.ts";
import { orchestratorPrompt } from "../src/studio/runtime/production/executor/orchestratorContract.ts";
import { adaptProductionRuntime } from "../src/studio/runtime/production/studioProjection.ts";

const EVIDENCE = {
  path: "runs/memory-runtime/evidence.json",
  content_id: `sha256:${"e".repeat(64)}`,
  bytes: 128,
};

async function identified<K extends string, T extends Record<string, unknown>>(
  prefix: string,
  idKey: K,
  body: T,
): Promise<T & Record<K, string>> {
  return { [idKey]: `${prefix}:${await memoryContentId(body)}`, ...body } as T & Record<K, string>;
}

async function makeProposal(): Promise<MemoryProposal> {
  const body: Omit<MemoryProposal, "proposal_id"> = {
    schema: MEMORY_REVIEW_SCHEMAS.proposal,
    namespace: "language/ko/glossary",
    kind: "glossary",
    key: "파인만",
    value: { gloss: "Feynman", language: "ko" },
    proposed_by: "producer:runtime-memory",
    created_at: "2026-07-19T12:00:00.000Z",
    source: { run_id: "run:memory-runtime", cue_ids: ["cue:1"] },
    evidence: [EVIDENCE],
    supersedes: null,
    review_requirements: null,
  };
  return identified("memory-proposal", "proposal_id", body);
}

async function makeDecision(proposal: MemoryProposal): Promise<MemoryDecision> {
  const body: Omit<MemoryDecision, "decision_id"> = {
    schema: MEMORY_REVIEW_SCHEMAS.decision,
    proposal_id: proposal.proposal_id,
    proposal_content_id: await memoryContentId(proposal),
    action: "accept",
    decided_by: "reviewer:runtime-memory",
    reason: "Selected evidence supports the glossary spelling.",
    created_at: "2026-07-19T12:01:00.000Z",
    benchmark_receipt: null,
  };
  return identified("memory-decision", "decision_id", body);
}

async function makeLegacy(): Promise<MemoryLegacySnapshot> {
  const source = {
    path: "memory/glossary/ko.json",
    content_id: `sha256:${"7".repeat(64)}`,
    bytes: 512,
  };
  const identity = {
    namespace: "language/ko/glossary",
    status: "legacy_unreviewed" as const,
    source_content_id: source.content_id,
  };
  return {
    schema: MEMORY_REVIEW_SCHEMAS.legacy,
    snapshot_id: `memory-legacy:${await memoryContentId(identity)}`,
    namespace: identity.namespace,
    status: identity.status,
    created_at: "2026-07-19T11:00:00.000Z",
    source,
    entry_count: 4,
    note: "Legacy input remains unreviewed and is never an accepted entry.",
  };
}

async function makeMaterialization(
  proposal: MemoryProposal,
  acceptance: MemoryDecision,
  legacy: MemoryLegacySnapshot,
): Promise<MemoryMaterialization> {
  const body: Omit<MemoryMaterialization, "materialization_id"> = {
    schema: MEMORY_REVIEW_SCHEMAS.materialization,
    created_at: "2026-07-19T12:02:00.000Z",
    entries: [{
      namespace: proposal.namespace,
      kind: proposal.kind,
      key: proposal.key,
      value: proposal.value,
      proposal_id: proposal.proposal_id,
      proposal_content_id: acceptance.proposal_content_id,
      decision_id: acceptance.decision_id,
      evidence: proposal.evidence,
    }],
    proposal_receipts: [{
      id: proposal.proposal_id,
      content_id: await memoryContentId(proposal),
      status: "accepted",
      superseded_by: null,
    }],
    decision_receipts: [{
      id: acceptance.decision_id,
      content_id: await memoryContentId(acceptance),
    }],
    legacy_inputs: [{
      snapshot_id: legacy.snapshot_id,
      namespace: legacy.namespace,
      status: legacy.status,
      source: legacy.source,
    }],
  };
  return identified("memory-materialization", "materialization_id", body);
}

async function reviewedArtifacts() {
  const legacy = await makeLegacy();
  const proposal = await makeProposal();
  const acceptance = await makeDecision(proposal);
  const materialization = await makeMaterialization(proposal, acceptance, legacy);
  return {
    legacy,
    proposal,
    acceptance,
    materialization,
    artifacts: [legacy, proposal, acceptance, materialization],
  };
}

test("bindReviewedMemoryForRun records consumption before exposing path-free job binding", async () => {
  const fixture = await reviewedArtifacts();
  const recorded: MemoryConsumptionReceipt[] = [];
  const binding = await bindReviewedMemoryForRun("runtime:memory-binding", {
    artifacts: fixture.artifacts,
    materializationId: fixture.materialization.materialization_id,
    consumedAt: "2026-07-19T12:03:00.000Z",
    record: async (receipt) => {
      recorded.push(receipt);
    },
  });

  assert.equal(recorded.length, 1);
  assert.equal(binding.consumptionId, recorded[0].consumption_id);
  assert.equal(binding.materializationId, fixture.materialization.materialization_id);
  assert.equal(binding.entryCount, 1);
  assert.equal(binding.entries[0].key, "파인만");
  assert.equal(binding.entries[0].proposalId, fixture.proposal.proposal_id);
  assert.deepEqual(binding.policy, {
    promotion: "reviewed_materialization_only",
    legacy_unreviewed: "excluded",
    unavailable: "fail_closed",
  });
  assert.equal("evidence" in binding.entries[0], false);

  const inspection = await inspectMemoryReviewArtifacts([...fixture.artifacts, recorded[0]]);
  assert.equal(inspection.consumptions[0].runId, "runtime:memory-binding");
  assert.equal(inspection.legacyInputs[0].status, "legacy_unreviewed");
  assert.equal(
    binding.entries.some((entry) => entry.key === "legacy" || entry.proposalId === fixture.legacy.snapshot_id),
    false,
  );
});

test("reviewedMemory job context validates and appears in orchestrator prompt JSON", async () => {
  const fixture = await reviewedArtifacts();
  const binding = await bindReviewedMemoryForRun("runtime:memory-prompt", {
    artifacts: fixture.artifacts,
    materializationId: fixture.materialization.materialization_id,
    consumedAt: "2026-07-19T12:04:00.000Z",
    record: async () => {},
  });
  const loadedSource = await loadOwnedSourceSession(resolve("public/demo/runs/run-005"));
  const analysisRequest = createProductionAnalysisRequest(loadedSource.session, {
    range: { startMs: 0, endMs: 1_000 },
    requestedSource: { mode: "declared", languages: ["ko"], reason: null },
    targetLanguage: "en",
    selectedLanguagePackId: "ko-v3",
    outputDepth: "evidence",
  });
  const directory = await mkdtemp(join(tmpdir(), "studio-memory-prompt-"));
  try {
    const initialized = await initializeRuntimeApplication({
      runtimeRoot: join(directory, "runtime"),
      journalPath: join(directory, "runtime", "events.ndjson"),
      artifactStoreRoot: join(directory, "runtime", "artifact-store"),
      runStartPath: join(directory, "runtime", "run-start.json"),
      runtimeId: "runtime:memory-prompt",
      journalId: "journal:memory-prompt",
      acceptedBy: "operator:test",
      startedAt: "2026-07-19T12:04:00.000Z",
      loadedSource,
      analysisRequest,
    });
    const jobContext = createRootTaskJobContext({
      sourceArtifact: initialized.sourceArtifact,
      evidenceArtifacts: initialized.evidenceArtifacts,
      analysisRequest,
      reviewedMemory: binding,
    });
    assertTaskJobContext(jobContext);
    assert.equal(jobContext.reviewedMemory?.consumptionId, binding.consumptionId);
    const prompt = orchestratorPrompt({
      id: "task:root",
      runId: initialized.runStart.runtimeId,
      workloadKey: "root",
      objective: "Delegate at least two bounded coverage-study tasks for probe.",
      workerKind: "orchestrator",
      workerLabel: "local-orchestrator",
      parentTaskId: null,
      parentAgentId: null,
      depth: 0,
      assignedAgentId: "agent:root",
      ownerAgentId: "agent:root",
      jobContext,
      mediaScope: [],
      inputArtifactIds: [initialized.sourceArtifact.id],
      requiredOutputs: [{ name: "owned-media study", artifactKind: "studio.owned-media-study.v3", required: true }],
      dependencies: [],
      budget: { wallMs: 1_000, toolCalls: 1 },
      grants: [{
        id: "grant:synthesize",
        capability: "study.synthesize",
        taskId: "task:root",
        agentId: "agent:root",
        mediaScope: [],
        evidenceScope: [],
        assessmentScope: null,
        decisionScope: null,
      }],
      status: "working",
      terminalReason: null,
    });
    assert.match(prompt, /jobContext\.reviewedMemory is host-injected/);
    assert.match(prompt, new RegExp(binding.consumptionId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(prompt, /파인만/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
test("runBoundedRuntimeApplication binds reviewed memory on the root before launch", async () => {
  const fixture = await reviewedArtifacts();
  const directory = await mkdtemp(join(tmpdir(), "studio-memory-runtime-"));
  const recorded: MemoryConsumptionReceipt[] = [];
  try {
    const loadedSource = await loadOwnedSourceSession(resolve("public/demo/runs/run-005"));
    const analysisRequest = createProductionAnalysisRequest(loadedSource.session, {
      range: { startMs: 0, endMs: 1_000 },
      requestedSource: { mode: "declared", languages: ["ko"], reason: null },
      targetLanguage: "en",
      selectedLanguagePackId: "ko-v3",
      outputDepth: "evidence",
    });
    const runtimeRoot = join(directory, "runtime");
    await writeFile(join(directory, ".keep"), "", { flag: "wx" });
    const initialized = await initializeRuntimeApplication({
      runtimeRoot,
      journalPath: join(runtimeRoot, "events.ndjson"),
      artifactStoreRoot: join(runtimeRoot, "artifact-store"),
      runStartPath: join(runtimeRoot, "run-start.json"),
      runtimeId: "runtime:memory-consume-root",
      journalId: "journal:memory-consume-root",
      acceptedBy: "operator:test",
      startedAt: "2026-07-19T12:05:00.000Z",
      loadedSource,
      analysisRequest,
    });
    await runBoundedRuntimeApplication(
      initialized,
      new DeterministicRuntimeExecutor().factory(),
      deterministicOrchestratorLauncherFactory({ mode: "empty_research_synthesis_only" }),
      "v2",
      {
        reviewedMemory: {
          artifacts: fixture.artifacts,
          materializationId: fixture.materialization.materialization_id,
          consumedAt: "2026-07-19T12:05:01.000Z",
          record: async (receipt) => {
            recorded.push(structuredClone(receipt));
          },
        },
      },
    );
    assert.equal(recorded.length, 1);
    const ledger = await RuntimeLedger.open(
      initialized.runStart.runtimeId,
      new FileEventJournal(initialized.journalPath),
    );
    const root = Object.values(ledger.state().tasks).find((task) => task.parentTaskId === null)!;
    assertTaskJobContext(root.jobContext);
    assert.equal(root.jobContext.reviewedMemory?.consumptionId, recorded[0].consumption_id);
    assert.equal(root.jobContext.reviewedMemory?.entries[0].key, "파인만");
    assert.equal(root.jobContext.reviewedMemory?.policy.legacy_unreviewed, "excluded");
    const child = Object.values(ledger.state().tasks).find((task) => task.parentTaskId === root.id);
    if (child) {
      assert.equal(child.jobContext.reviewedMemory?.consumptionId, recorded[0].consumption_id);
    }
    const inspection = await inspectMemoryReviewArtifacts([...fixture.artifacts, recorded[0]]);
    assert.equal(inspection.consumptions[0].runId, initialized.runStart.runtimeId);
    const projection = adaptProductionRuntime(ledger.state());
    const projectedRoot = projection.tasks.find((task) => task.parentTaskId === null);
    assert.ok(projectedRoot);
    assert.equal(projectedRoot.jobContext.reviewedMemory?.consumptionId, recorded[0].consumption_id);
    assert.equal(projectedRoot.jobContext.reviewedMemory?.entries[0]?.key, "파인만");
    assert.equal(
      projectedRoot.jobContext.reviewedMemory?.entries[0] &&
        "value" in projectedRoot.jobContext.reviewedMemory.entries[0],
      false,
    );
    assert.ok(
      projection.tasks.every((task) =>
        task.jobContext.reviewedMemory?.consumptionId === recorded[0].consumption_id
      ),
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("runBoundedRuntimeApplication without reviewedMemory keeps binding unavailable", async () => {
  const directory = await mkdtemp(join(tmpdir(), "studio-memory-absent-"));
  try {
    const loadedSource = await loadOwnedSourceSession(resolve("public/demo/runs/run-005"));
    const analysisRequest = createProductionAnalysisRequest(loadedSource.session, {
      range: { startMs: 0, endMs: 1_000 },
      requestedSource: { mode: "declared", languages: ["ko"], reason: null },
      targetLanguage: "en",
      selectedLanguagePackId: "ko-v3",
      outputDepth: "evidence",
    });
    const runtimeRoot = join(directory, "runtime");
    const initialized = await initializeRuntimeApplication({
      runtimeRoot,
      journalPath: join(runtimeRoot, "events.ndjson"),
      artifactStoreRoot: join(runtimeRoot, "artifact-store"),
      runStartPath: join(runtimeRoot, "run-start.json"),
      runtimeId: "runtime:memory-absent",
      journalId: "journal:memory-absent",
      acceptedBy: "operator:test",
      startedAt: "2026-07-19T12:06:00.000Z",
      loadedSource,
      analysisRequest,
    });
    await runBoundedRuntimeApplication(
      initialized,
      new DeterministicRuntimeExecutor().factory(),
      deterministicOrchestratorLauncherFactory({ mode: "empty_research_synthesis_only" }),
      "v2",
    );
    const ledger = await RuntimeLedger.open(
      initialized.runStart.runtimeId,
      new FileEventJournal(initialized.journalPath),
    );
    const root = Object.values(ledger.state().tasks).find((task) => task.parentTaskId === null)!;
    assert.equal(root.jobContext.reviewedMemory, null);
    const projection = adaptProductionRuntime(ledger.state());
    assert.ok(projection.tasks.length > 0);
    assert.ok(projection.tasks.every((task) => task.jobContext.reviewedMemory === null));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("runBoundedRuntimeApplication fails closed for missing materialization before createRoot", async () => {
  const fixture = await reviewedArtifacts();
  const directory = await mkdtemp(join(tmpdir(), "studio-memory-missing-"));
  try {
    const loadedSource = await loadOwnedSourceSession(resolve("public/demo/runs/run-005"));
    const analysisRequest = createProductionAnalysisRequest(loadedSource.session, {
      range: { startMs: 0, endMs: 1_000 },
      requestedSource: { mode: "declared", languages: ["ko"], reason: null },
      targetLanguage: "en",
      selectedLanguagePackId: "ko-v3",
      outputDepth: "evidence",
    });
    const runtimeRoot = join(directory, "runtime");
    const initialized = await initializeRuntimeApplication({
      runtimeRoot,
      journalPath: join(runtimeRoot, "events.ndjson"),
      artifactStoreRoot: join(runtimeRoot, "artifact-store"),
      runStartPath: join(runtimeRoot, "run-start.json"),
      runtimeId: "runtime:memory-missing",
      journalId: "journal:memory-missing",
      acceptedBy: "operator:test",
      startedAt: "2026-07-19T12:07:00.000Z",
      loadedSource,
      analysisRequest,
    });
    await assert.rejects(
      () => runBoundedRuntimeApplication(
        initialized,
        new DeterministicRuntimeExecutor().factory(),
        deterministicOrchestratorLauncherFactory({ mode: "empty_research_synthesis_only" }),
        "v2",
        {
          reviewedMemory: {
            artifacts: fixture.artifacts,
            materializationId: `memory-materialization:sha256:${"0".repeat(64)}`,
            consumedAt: "2026-07-19T12:07:01.000Z",
            record: async () => {},
          },
        },
      ),
      /not a validated selected materialization/,
    );
    const ledger = await RuntimeLedger.open(
      initialized.runStart.runtimeId,
      new FileEventJournal(initialized.journalPath),
    );
    assert.equal(Object.keys(ledger.state().tasks).length, 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("runBoundedRuntimeApplication fails closed when the consumption recorder fails", async () => {
  const fixture = await reviewedArtifacts();
  const directory = await mkdtemp(join(tmpdir(), "studio-memory-recorder-"));
  try {
    const loadedSource = await loadOwnedSourceSession(resolve("public/demo/runs/run-005"));
    const analysisRequest = createProductionAnalysisRequest(loadedSource.session, {
      range: { startMs: 0, endMs: 1_000 },
      requestedSource: { mode: "declared", languages: ["ko"], reason: null },
      targetLanguage: "en",
      selectedLanguagePackId: "ko-v3",
      outputDepth: "evidence",
    });
    const runtimeRoot = join(directory, "runtime");
    const initialized = await initializeRuntimeApplication({
      runtimeRoot,
      journalPath: join(runtimeRoot, "events.ndjson"),
      artifactStoreRoot: join(runtimeRoot, "artifact-store"),
      runStartPath: join(runtimeRoot, "run-start.json"),
      runtimeId: "runtime:memory-recorder-fail",
      journalId: "journal:memory-recorder-fail",
      acceptedBy: "operator:test",
      startedAt: "2026-07-19T12:08:00.000Z",
      loadedSource,
      analysisRequest,
    });
    await assert.rejects(
      () => runBoundedRuntimeApplication(
        initialized,
        new DeterministicRuntimeExecutor().factory(),
        deterministicOrchestratorLauncherFactory({ mode: "empty_research_synthesis_only" }),
        "v2",
        {
          reviewedMemory: {
            artifacts: fixture.artifacts,
            materializationId: fixture.materialization.materialization_id,
            consumedAt: "2026-07-19T12:08:01.000Z",
            record: async () => {
              throw new Error("receipt store unavailable");
            },
          },
        },
      ),
      /receipt store unavailable/,
    );
    const ledger = await RuntimeLedger.open(
      initialized.runStart.runtimeId,
      new FileEventJournal(initialized.journalPath),
    );
    assert.equal(Object.keys(ledger.state().tasks).length, 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("duplicate consumption for the same runId remains fail-closed", async () => {
  const fixture = await reviewedArtifacts();
  const first = await consumeAcceptedMemorySnapshotForRun(
    fixture.artifacts,
    {
      runId: "runtime:memory-duplicate",
      materializationId: fixture.materialization.materialization_id,
      consumedAt: "2026-07-19T12:09:00.000Z",
    },
    async () => {},
  );
  await assert.rejects(
    () => consumeAcceptedMemorySnapshotForRun(
      [...fixture.artifacts, first.receipt],
      {
        runId: "runtime:memory-duplicate",
        materializationId: fixture.materialization.materialization_id,
        consumedAt: "2026-07-19T12:09:01.000Z",
      },
      async () => {},
    ),
    /already has a selected memory consumption receipt/,
  );
});
