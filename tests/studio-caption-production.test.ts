import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import { ContentAddressedArtifactStore } from "../src/studio/runtime/production/artifactStore.ts";
import {
  OpenAiCaptionProductionExecutor,
  type CaptionProductionExecutor,
} from "../src/studio/runtime/production/captions/captionProductionExecutor.ts";
import { FileEventJournal, RuntimeLedger } from "../src/studio/runtime/production/journal.ts";
import { CAPTION_PRODUCTION_LIMITS } from "../src/studio/runtime/production/model.ts";
import { projectRuntimeEvents } from "../src/studio/runtime/production/projection.ts";
import { PublishReviewHost } from "../src/studio/runtime/production/review/publishReviewHost.ts";
import {
  DeterministicLanguageExplanationTestExecutor,
  DeterministicRuntimeExecutor,
  DurableRuntimeCommandStore,
  RuntimeSourceRegistry,
  RuntimeStartService,
  deterministicOrchestratorLauncherFactory,
} from "../src/studio/runtime/production/runtimeHost/index.ts";
import type { LanguageExplanationExecutor } from "../src/studio/runtime/production/languageExplanations/executor.ts";
import {
  createLanguageExplanationGrantId,
  createLanguageExplanationJobId,
} from "../src/studio/runtime/production/languageExplanations/identity.ts";
import type {
  RuntimeHostCaptionProductionRequest,
  RuntimeHostPublishReviewDecisionResponse,
  RuntimeHostStartRequest,
} from "../src/studio/runtime/production/runtimeHost/model.ts";
import { readValidatedRuntimeJournal } from "../src/studio/runtime/production/runtimeHost/journalPolling.ts";
import type { DeterministicOrchestratorMode } from "../src/studio/runtime/production/runtimeHost/deterministicOrchestrator.ts";
import { adaptProductionRuntime } from "../src/studio/runtime/production/studioProjection.ts";
import {
  deriveCaptionProductionResult,
  validateCaptionProductionArtifact,
} from "../src/studio/runtime/production/validation/captionProduction.ts";
import { LocalRuntimeHostClient } from "../src/studio/localRuntime/client.ts";
import { productionSelectionRequest } from "../src/studio/localRuntime/productionLearningController.ts";
import { projectVerifiedProductionLearningExplanation } from "../src/studio/learning/productionExplanationAdapter.ts";
import { projectVerifiedProductionLearningSource } from "../src/studio/learning/productionSourceAdapter.ts";

const FIXTURE = resolve("public/demo/runs/run-005");

interface Harness {
  directory: string;
  store: DurableRuntimeCommandStore;
  service: RuntimeStartService;
  request: RuntimeHostStartRequest;
}

async function harness(options: {
  captionExecutor?: CaptionProductionExecutor;
  executionMode?: "completed" | "failed" | "timed_out" | "interrupted";
  orchestratorMode?: DeterministicOrchestratorMode;
  defaultU4?: boolean;
  languageExplanationExecutor?: LanguageExplanationExecutor;
} = {}): Promise<Harness> {
  const directory = await mkdtemp(join(tmpdir(), "studio-caption-production-test-"));
  const sources = await RuntimeSourceRegistry.open({ sourceDirectories: [FIXTURE] });
  const store = await DurableRuntimeCommandStore.open(join(directory, "host"));
  const service = await RuntimeStartService.open({
    store,
    sources,
    launcherFactory: new DeterministicRuntimeExecutor({ mode: options.executionMode }).factory(),
    orchestratorLauncherFactory: deterministicOrchestratorLauncherFactory({ mode: options.orchestratorMode }),
    ...(!options.defaultU4 ? { studyContractVersion: "v1" as const } : {}),
    captionExecutor: options.captionExecutor,
    languageExplanationExecutor: options.languageExplanationExecutor,
    recoverOnOpen: false,
  });
  const source = sources.list()[0];
  return {
    directory,
    store,
    service,
    request: {
      sourceSessionId: source.sourceSessionId,
      sourceRevisionId: source.sourceRevisionId,
      range: { startMs: 0, endMs: 47_200 },
      requestedSourceLanguage: { mode: "declared", languages: ["ko"], reason: null },
      targetLanguage: "en",
      selectedLanguagePackId: "ko-v3",
      outputDepth: "captions",
    },
  };
}

const currentRunCaptionExecutor: CaptionProductionExecutor = {
  async describe() {
    return {
      id: "studio.deterministic-current-run-caption-test-seam",
      version: "1",
      classification: "deterministic_current_run_test_seam",
      executionScope: "current_run",
      cognitionClaim: "none",
      recognizer: "test-seam-current-run-recognizer",
      translator: "test-seam-current-run-translator",
      sourceCaptionContentId: null,
    };
  },
  async execute(input) {
    return [{
      id: "line-current-run-001",
      startMs: input.range.startMs,
      endMs: Math.min(input.range.endMs, input.range.startMs + 1_000),
      source: { language: "ko", state: "available", text: "현재 실행", reasonCode: null },
      target: { language: "en", state: "available", text: "Current run", reasonCode: null },
    }];
  },
};

const incompleteCurrentRunCaptionExecutor: CaptionProductionExecutor = {
  describe: currentRunCaptionExecutor.describe,
  async execute(input) {
    return [{
      id: "line-current-run-incomplete-001",
      startMs: input.range.startMs,
      endMs: Math.min(input.range.endMs, input.range.startMs + 1_000),
      source: { language: "ko", state: "available", text: "번역 대기", reasonCode: null },
      target: { language: "en", state: "unavailable", text: null, reasonCode: "translator_unavailable" },
    }];
  },
};

const uncoveredCurrentRunCaptionExecutor: CaptionProductionExecutor = {
  describe: currentRunCaptionExecutor.describe,
  async execute() {
    return [{
      id: "line-current-run-uncovered-001",
      startMs: 23_000,
      endMs: 24_000,
      source: { language: "ko", state: "available", text: "경계", reasonCode: null },
      target: { language: "en", state: "available", text: "Boundary", reasonCode: null },
    }];
  },
};

async function terminal(service: RuntimeStartService, commandId: string): Promise<void> {
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    if ((await service.statusByCommand(commandId)).terminal) return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 10));
  }
  assert.fail("runtime did not become terminal");
}

async function approved(
  runtime: Harness,
): Promise<{ runtimeId: string; response: RuntimeHostPublishReviewDecisionResponse; request: RuntimeHostCaptionProductionRequest }> {
  const acknowledgement = await runtime.service.start(runtime.request);
  await terminal(runtime.service, acknowledgement.commandId);
  const intake = (await runtime.service.publishReviewIntakes(acknowledgement.runtimeId)).intakes[0];
  assert.ok(intake, "a proceed study must create one review intake");
  assert.equal(intake.outcome, "queued");
  const authority = await runtime.service.publishReviewDecisions(acknowledgement.runtimeId);
  const response = await runtime.service.createPublishReviewDecision(acknowledgement.runtimeId, {
    intake: {
      intakeId: intake.intakeId,
      artifactId: intake.artifactId,
      receiptId: intake.receiptId,
      receiptContentId: intake.receiptContentId,
    },
    reviewer: { id: authority.reviewer.id, attestation: authority.reviewer.decisionAttestation },
    decision: {
      outcome: "approve_for_caption_production",
      reasonCodes: ["reviewer_attested_caption_production_may_proceed"],
      note: null,
    },
  });
  const approval = response.reviews[0];
  assert.equal(approval.readiness.readinessId, intake.readiness.readinessId);
  return {
    runtimeId: acknowledgement.runtimeId,
    response,
    request: {
      approval: {
        reviewId: approval.reviewId,
        artifactId: approval.artifactId,
        receiptId: approval.receiptId,
        receiptContentId: approval.receiptContentId,
      },
    },
  };
}

function objectPath(runtime: Harness, runtimeId: string, contentId: string): string {
  const digest = contentId.replace("sha256:", "");
  return join(runtime.store.paths(runtimeId).artifactStoreRoot, "objects", "sha256", digest.slice(0, 2), digest);
}

async function journal(runtime: Harness, runtimeId: string) {
  return readValidatedRuntimeJournal(runtime.store.paths(runtimeId).journalPath, runtimeId);
}

async function cleanup(runtime: Harness): Promise<void> {
  await rm(runtime.directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
}

test("child-only or unapproved authority cannot start caption production and callers cannot inject paths or prose", async () => {
  const runtime = await harness({ captionExecutor: currentRunCaptionExecutor });
  try {
    const acknowledgement = await runtime.service.start(runtime.request);
    await terminal(runtime.service, acknowledgement.commandId);
    const fake = {
      approval: {
        reviewId: "publish-review:child-only",
        artifactId: "artifact:child-only",
        receiptId: "publish-review-decision-receipt:child-only",
        receiptContentId: `sha256:${"a".repeat(64)}`,
      },
    };
    await assert.rejects(runtime.service.createCaptionProduction(acknowledgement.runtimeId, fake), /exact recursively verified unrevoked approval/);
    for (const open of [
      { ...fake, childArtifactId: "artifact:worker-output" },
      { ...fake, sourcePath: "/tmp/media" },
      { ...fake, captions: [{ ko: "caller", en: "final" }] },
    ]) await assert.rejects(runtime.service.createCaptionProduction(acknowledgement.runtimeId, open), /invalid or contains open fields/);
    assert.deepEqual((await runtime.service.captionProductions(acknowledgement.runtimeId)).captions, []);
  } finally {
    await cleanup(runtime);
  }
});

test("full owned-run current-run captions and independent QC close under cold replay", async () => {
  const runtime = await harness({ captionExecutor: currentRunCaptionExecutor });
  try {
    const approval = await approved(runtime);
    const produced = await runtime.service.createCaptionProduction(approval.runtimeId, approval.request);
    assert.equal(produced.captions.length, 1);
    const caption = produced.captions[0];
    assert.equal(caption.integrity, "stored_caption_and_receipt_with_verified_study_readiness_approval");
    assert.equal(caption.authorityState, "unrevoked");
    assert.equal(caption.executor.executionScope, "current_run");
    assert.equal(caption.executor.cognitionClaim, "none");
    assert.equal(caption.result.status, "completed");
    assert.equal(caption.result.lineCount, 1);
    assert.ok(caption.reopened.semanticEvidenceArtifactIds.length >= 2);
    assert.ok(caption.reopened.reportArtifactIds.length >= 2);
    assert.ok(caption.reopened.admissionIds.length >= 2);
    assert.equal(caption.readiness.readinessId, approval.response.reviews[0].readiness.readinessId);

    const results = await runtime.service.captionProductionResults(approval.runtimeId);
    const line = results.results[0].artifact.lines[0];
    assert.equal(line.lineage.derivation, "current_run_source_execution");
    assert.equal(line.lineage.study.studyId, caption.study.studyId);
    assert.equal(line.lineage.study.coverage.state, "supported");
    assert.equal(line.lineage.study.coverage.reasonCode, null);
    assert.equal(line.lineage.study.claimIds.length, 1);
    assert.equal(line.lineage.study.semanticCitations.length, 1);
    assert.equal(line.lineage.study.childReports.length, 1);
    assert.equal(line.lineage.readiness.readinessId, caption.readiness.readinessId);
    assert.equal(line.lineage.approval.reviewId, caption.approval.reviewId);
    assert.equal(line.lineage.captionExecutor.jobId, caption.jobId);
    assert.equal(line.lineage.captionExecutor.cognitionClaim, "none");

    const controls = await runtime.service.captionQualityControls(approval.runtimeId);
    assert.equal(controls.qualityControls.length, 1);
    const qc = controls.qualityControls[0];
    assert.equal(qc.outcome, "accepted");
    assert.deepEqual(qc.reasonCodes, ["current_run_candidate_structurally_complete"]);
    assert.deepEqual(qc.acceptedLineIds, [line.id]);
    assert.equal(qc.candidate.study.studyId, caption.study.studyId);
    assert.equal(qc.candidate.readiness.readinessId, caption.readiness.readinessId);
    assert.equal(qc.candidate.source.contentId, caption.source.contentId);
    assert.equal(qc.candidate.result.lineCount, 1);
    assert.equal(qc.candidate.authorityState, "unrevoked");

    const loaded = await journal(runtime, approval.runtimeId);
    assert.deepEqual(projectRuntimeEvents(approval.runtimeId, loaded.events), loaded.state);
    assert.equal(Object.values(loaded.state.tasks).filter((task) => task.parentTaskId !== null).length, 2);
    assert.equal(Object.values(loaded.state.semanticEvidence).filter((entry) => entry.status === "completed").length, 2);
    assert.equal(Object.values(loaded.state.parentArtifactDispositions).filter((entry) => entry.outcome === "accepted").length, 2);
    assert.equal(Object.keys(loaded.state.ownedMediaStudies).length, 1);
    assert.equal(Object.values(loaded.state.studyReadiness)[0].outcome, "proceed_to_caption_review");
    assert.equal(Object.keys(loaded.state.captionProductions).length, 1);
    assert.equal(Object.keys(loaded.state.captionQualityControls).length, 1);

    const projection = adaptProductionRuntime(loaded.state);
    assert.equal(projection.captionProductions[0].study.studyId, caption.study.studyId);
    assert.equal(projection.captionProductions[0].readiness.readinessId, caption.readiness.readinessId);
    assert.equal(projection.captionProductions[0].approvalReviewId, caption.approval.reviewId);
    assert.equal(projection.captionProductions[0].lines[0].coverageState, "supported");
    assert.deepEqual(projection.captionProductions[0].lines[0].claimIds, line.lineage.study.claimIds);
    assert.equal(projection.captionQualityControls[0].lines[0].causality.lineId, line.id);
    assert.equal("results" in projection, false);
    assert.equal("publicationState" in projection, false);

    const client = new LocalRuntimeHostClient({
      baseUrl: "http://127.0.0.1:4312",
      token: "caption-test-token",
      fetch: async () => new Response(JSON.stringify(results), { status: 200, headers: { "Content-Type": "application/json" } }),
    });
    assert.deepEqual(await client.captionProductionResults(approval.runtimeId), results);

    const realV2Summary = structuredClone(produced);
    realV2Summary.captions[0].executor = {
      id: "studio.openai-caption-producer",
      version: "2",
      classification: "real_recognizer_translator",
      executionScope: "current_run",
      cognitionClaim: "none",
      recognizer: "gpt-4o-transcribe-diarize (per host-derived production range)",
      translator: "gpt-5 (strict structured output)",
      sourceCaptionContentId: null,
    };
    const summaryClient = new LocalRuntimeHostClient({
      baseUrl: "http://127.0.0.1:4312",
      token: "caption-test-token",
      fetch: async () => new Response(JSON.stringify(realV2Summary), { status: 200, headers: { "Content-Type": "application/json" } }),
    });
    assert.equal((await summaryClient.captionProductions(approval.runtimeId)).captions[0].executor.version, "2");
  } finally {
    await cleanup(runtime);
  }
});

test("default U4 approval produces a v4 caption artifact with durable pass-aware causality", async () => {
  const runtime = await harness({ captionExecutor: currentRunCaptionExecutor, defaultU4: true });
  try {
    const approval = await approved(runtime);
    const produced = await runtime.service.createCaptionProduction(approval.runtimeId, approval.request);
    assert.equal(produced.captions.length, 1);
    const results = await runtime.service.captionProductionResults(approval.runtimeId);
    const artifact = results.results[0].artifact;
    assert.equal(artifact.schema, "studio.caption-production.artifact.v4");
    assert.equal(artifact.lines.length, 1);
    const causality = artifact.lines[0].lineage.generalizedCausality;
    assert.equal(causality?.schema, "studio.caption-line-causality.v4");
    assert.equal(causality?.lineage.coverageState, "supported");
    assert.ok((causality?.lineage.citationIds.length ?? 0) > 0);
    const loaded = await journal(runtime, approval.runtimeId);
    assert.equal(Object.keys(loaded.state.ownedMediaStudies).length, 0);
    assert.equal(Object.keys(loaded.state.generalizedOwnedMediaStudies).length, 1);
    assert.equal(Object.keys(loaded.state.studyReadiness).length, 0);
    assert.equal(Object.keys(loaded.state.generalizedStudyReadiness).length, 1);
  } finally {
    await cleanup(runtime);
  }
});

test("default U4 binds real-caption execution to the exact supported current-source study ranges", async () => {
  let observedRanges: Array<{ startMs: number; endMs: number }> = [];
  const evidenceBoundedExecutor: CaptionProductionExecutor = {
    describe: currentRunCaptionExecutor.describe,
    async execute(input) {
      observedRanges = structuredClone(input.productionRanges);
      const first = input.productionRanges[0];
      return [{
        id: "line-evidence-bounded-001",
        startMs: first.startMs,
        endMs: Math.min(first.endMs, first.startMs + 1_000),
        source: { language: "ko", state: "available", text: "근거 구간", reasonCode: null },
        target: { language: "en", state: "available", text: "Evidence range", reasonCode: null },
      }];
    },
  };
  const runtime = await harness({ captionExecutor: evidenceBoundedExecutor, defaultU4: true });
  try {
    const approval = await approved(runtime);
    await runtime.service.createCaptionProduction(approval.runtimeId, approval.request);
    const loaded = await journal(runtime, approval.runtimeId);
    const study = Object.values(loaded.state.generalizedOwnedMediaStudies)[0];
    assert.deepEqual(observedRanges, study.coverage
      .filter((entry) => entry.state === "supported")
      .map((entry) => ({ startMs: entry.startMs, endMs: entry.endMs }))
      .sort((left, right) => left.startMs - right.startMs || left.endMs - right.endMs));
  } finally {
    await cleanup(runtime);
  }
});

test("real caption executor recognizes each host-derived range and requests strict translation output", async () => {
  const originalFetch = globalThis.fetch;
  let transcriptionCalls = 0;
  let translationCalls = 0;
  try {
    globalThis.fetch = async (request, init) => {
      const url = typeof request === "string" ? request : request instanceof URL ? request.href : request.url;
      if (url.endsWith("/audio/transcriptions")) {
        transcriptionCalls += 1;
        assert.ok(init?.body instanceof FormData);
        assert.equal(init.body.get("chunking_strategy"), "auto");
        return new Response(JSON.stringify({
          segments: [{ start: 0, end: 0.4, text: transcriptionCalls === 1 ? "첫 구간" : "둘째 구간" }],
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (url.endsWith("/chat/completions")) {
        translationCalls += 1;
        const body = JSON.parse(String(init?.body)) as {
          response_format?: { type?: unknown; json_schema?: { strict?: unknown } };
        };
        assert.equal(body.response_format?.type, "json_schema");
        assert.equal(body.response_format?.json_schema?.strict, true);
        return new Response(JSON.stringify({
          choices: [{ message: { content: JSON.stringify({ lines: [
            { id: "line-001-001", en: "First range" },
            { id: "line-002-001", en: "Second range" },
          ] }) } }],
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      assert.fail(`unexpected provider URL ${url}`);
    };
    const executor = new OpenAiCaptionProductionExecutor({ apiKey: "test-key" });
    const lines = await executor.execute({
      sourcePath: resolve("public/demo/runs/run-005/clip.m4a"),
      fixtureCaptionPath: "",
      range: { startMs: 0, endMs: 2_000 },
      productionRanges: [{ startMs: 0, endMs: 500 }, { startMs: 1_000, endMs: 1_500 }],
    }, new AbortController().signal);
    assert.equal(transcriptionCalls, 2);
    assert.equal(translationCalls, 1);
    assert.deepEqual(lines.map((line) => ({ id: line.id, startMs: line.startMs, endMs: line.endMs, target: line.target.text })), [
      { id: "line-001-001", startMs: 0, endMs: 400, target: "First range" },
      { id: "line-002-001", startMs: 1_000, endMs: 1_400, target: "Second range" },
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("partial coverage and unresolved conflict produce withheld readiness and no approval/caption authority", async (t) => {
  for (const [mode, reasons] of [
    ["synthesize_gaps", ["non_supported_root_coverage"]],
    ["conflict", ["non_supported_root_coverage", "unresolved_conflict"]],
  ] as const) await t.test(mode, async () => {
    const runtime = await harness({ captionExecutor: currentRunCaptionExecutor, orchestratorMode: mode });
    try {
      const acknowledgement = await runtime.service.start(runtime.request);
      await terminal(runtime.service, acknowledgement.commandId);
      const loaded = await journal(runtime, acknowledgement.runtimeId);
      const readiness = Object.values(loaded.state.studyReadiness)[0];
      assert.equal(readiness.outcome, "withheld");
      assert.deepEqual(readiness.reasonCodes, reasons);
      const intake = (await runtime.service.publishReviewIntakes(acknowledgement.runtimeId)).intakes[0];
      assert.equal(intake.outcome, "rejected");
      const authority = await runtime.service.publishReviewDecisions(acknowledgement.runtimeId);
      await assert.rejects(runtime.service.createPublishReviewDecision(acknowledgement.runtimeId, {
        intake: { intakeId: intake.intakeId, artifactId: intake.artifactId, receiptId: intake.receiptId, receiptContentId: intake.receiptContentId },
        reviewer: { id: authority.reviewer.id, attestation: authority.reviewer.decisionAttestation },
        decision: { outcome: "approve_for_caption_production", reasonCodes: ["reviewer_attested_caption_production_may_proceed"], note: null },
      }), /verified queued intake/);
      assert.deepEqual((await runtime.service.captionProductions(acknowledgement.runtimeId)).captions, []);
    } finally {
      await cleanup(runtime);
    }
  });
});

test("withheld, unknown, failed, conflict, uncovered, and citation-mismatch line identities remain null and closed", async () => {
  const runtime = await harness({ captionExecutor: currentRunCaptionExecutor });
  try {
    const approval = await approved(runtime);
    await runtime.service.createCaptionProduction(approval.runtimeId, approval.request);
    const original = (await runtime.service.captionProductionResults(approval.runtimeId)).results[0].artifact;
    const cases = [
      ["withheld", "worker_withheld", "study_coverage_withheld"],
      ["unknown", "unobserved_range", "study_coverage_unknown"],
      ["failed", "operation_failed", "study_coverage_failed"],
      ["conflict", "unresolved_conflict", "study_coverage_conflict"],
      ["uncovered", "uncovered", "study_coverage_uncovered"],
      ["supported", "citation_mismatch", "study_citation_mismatch"],
    ] as const;
    for (const [state, coverageReason, lineReason] of cases) {
      const artifact = structuredClone(original);
      const line = artifact.lines[0];
      line.lineage.study.coverage.state = state;
      line.lineage.study.coverage.reasonCode = coverageReason;
      if (state === "uncovered") line.lineage.study.coverage.coverageId = null;
      line.lineage.study.claimIds = [];
      line.lineage.study.semanticCitations = [];
      line.lineage.study.childReports = [];
      line.source = { language: "ko", state: "withheld", text: null, reasonCode: lineReason };
      line.target = { language: "en", state: "withheld", text: null, reasonCode: lineReason };
      artifact.result = deriveCaptionProductionResult(artifact.lines);
      const validated = validateCaptionProductionArtifact(artifact);
      assert.equal(validated.lines[0].source.text, null);
      assert.equal(validated.lines[0].target.text, null);
      assert.equal(validated.lines[0].target.reasonCode, lineReason);
    }
    const dialogueScoped = structuredClone(original);
    dialogueScoped.lines[0].source = { language: "ko", state: "withheld", text: null, reasonCode: "not_in_requested_dialogue_scope" };
    dialogueScoped.lines[0].target = { language: "en", state: "withheld", text: null, reasonCode: "not_in_requested_dialogue_scope" };
    dialogueScoped.result = deriveCaptionProductionResult(dialogueScoped.lines);
    assert.throws(() => validateCaptionProductionArtifact(dialogueScoped), /reasonCode/);
    dialogueScoped.schema = "studio.caption-production.artifact.v2";
    assert.equal(validateCaptionProductionArtifact(dialogueScoped).schema, "studio.caption-production.artifact.v2");
    const mismatched = structuredClone(original);
    mismatched.lines[0].lineage.study.semanticCitations[0].observations[0].startMs = mismatched.lines[0].endMs;
    mismatched.lines[0].lineage.study.semanticCitations[0].observations[0].endMs = mismatched.lines[0].endMs + 1;
    assert.throws(() => validateCaptionProductionArtifact(mismatched), /does not close supported coverage\/citations/);
  } finally {
    await cleanup(runtime);
  }
});

test("executor output outside one supported study range is nulled and independently withheld", async () => {
  const runtime = await harness({ captionExecutor: uncoveredCurrentRunCaptionExecutor });
  try {
    const approval = await approved(runtime);
    await runtime.service.createCaptionProduction(approval.runtimeId, approval.request);
    const result = (await runtime.service.captionProductionResults(approval.runtimeId)).results[0];
    const line = result.artifact.lines[0];
    assert.equal(line.lineage.study.coverage.state, "uncovered");
    assert.equal(line.source.text, null);
    assert.equal(line.target.text, null);
    assert.equal(line.target.reasonCode, "study_coverage_uncovered");
    const qc = (await runtime.service.captionQualityControls(approval.runtimeId)).qualityControls[0];
    assert.equal(qc.outcome, "withheld");
    assert.deepEqual(qc.reasonCodes, ["candidate_has_unavailable_or_withheld_lines"]);
  } finally {
    await cleanup(runtime);
  }
});

test("incomplete current-run translation is retained as unavailable and structurally withheld", async () => {
  const runtime = await harness({ captionExecutor: incompleteCurrentRunCaptionExecutor });
  try {
    const approval = await approved(runtime);
    await runtime.service.createCaptionProduction(approval.runtimeId, approval.request);
    const qc = (await runtime.service.captionQualityControls(approval.runtimeId)).qualityControls[0];
    assert.equal(qc.outcome, "withheld");
    assert.deepEqual(qc.withheldLineIds, ["line-current-run-incomplete-001"]);
  } finally {
    await cleanup(runtime);
  }
});

test("recorded caption fixtures are refused as production and never reach QC acceptance", async () => {
  const runtime = await harness();
  try {
    const approval = await approved(runtime);
    await assert.rejects(runtime.service.createCaptionProduction(approval.runtimeId, approval.request), /Recorded caption fixtures.*refused/);
    const loaded = await journal(runtime, approval.runtimeId);
    assert.equal(loaded.events.some((event) => event.type.startsWith("caption.production_")), false);
    assert.deepEqual((await runtime.service.captionQualityControls(approval.runtimeId)).qualityControls, []);
  } finally {
    await cleanup(runtime);
  }
});

test("child report, study, readiness, and approval tamper each fail before caption execution", async (t) => {
  for (const target of ["child", "study", "readiness", "approval"] as const) await t.test(target, async () => {
    const runtime = await harness({ captionExecutor: currentRunCaptionExecutor });
    try {
      const approval = await approved(runtime);
      const loaded = await journal(runtime, approval.runtimeId);
      const study = Object.values(loaded.state.ownedMediaStudies)[0];
      const readiness = Object.values(loaded.state.studyReadiness)[0];
      const review = Object.values(loaded.state.publishReviewDecisions)[0];
      const child = Object.values(loaded.state.artifacts).find((artifact) => artifact.origin.kind === "study_report")!;
      const contentId = target === "child" ? child.content.contentId
        : target === "study" ? study.contentId
          : target === "readiness" ? readiness.receiptContentId
            : review.receiptContentId!;
      await writeFile(objectPath(runtime, approval.runtimeId, contentId), "{}\n", "utf8");
      await assert.rejects(runtime.service.createCaptionProduction(approval.runtimeId, approval.request), /failed closed|recursive|content|lineage/i);
      assert.equal((await journal(runtime, approval.runtimeId)).events.some((event) => event.type === "caption.production_started"), false);
    } finally {
      await cleanup(runtime);
    }
  });
});

test("caption and QC content tamper fail authenticated reads", async (t) => {
  for (const target of ["caption", "qc"] as const) await t.test(target, async () => {
    const runtime = await harness({ captionExecutor: currentRunCaptionExecutor });
    try {
      const approval = await approved(runtime);
      const produced = await runtime.service.createCaptionProduction(approval.runtimeId, approval.request);
      const qc = (await runtime.service.captionQualityControls(approval.runtimeId)).qualityControls[0];
      const contentId = target === "caption" ? produced.captions[0].captionContentId : qc.receiptContentId;
      await writeFile(objectPath(runtime, approval.runtimeId, contentId), "{}\n", "utf8");
      await assert.rejects(runtime.service.captionQualityControls(approval.runtimeId), /failed closed validation/);
      if (target === "caption") await assert.rejects(runtime.service.captionProductionResults(approval.runtimeId), /failed closed validation/);
    } finally {
      await cleanup(runtime);
    }
  });
});

test("duplicate caption job and duplicate QC fail closed", async () => {
  const runtime = await harness({ captionExecutor: currentRunCaptionExecutor });
  try {
    const approval = await approved(runtime);
    const produced = await runtime.service.createCaptionProduction(approval.runtimeId, approval.request);
    await assert.rejects(runtime.service.createCaptionProduction(approval.runtimeId, approval.request), /already has immutable caption-production lineage/);
    const caption = produced.captions[0];
    await assert.rejects(runtime.service.createCaptionQualityControl(approval.runtimeId, {
      candidate: {
        jobId: caption.jobId,
        captionArtifactId: caption.captionArtifactId,
        captionContentId: caption.captionContentId,
        captionReceiptId: caption.receiptId,
        captionReceiptContentId: caption.receiptContentId,
      },
    }), /already has one immutable independent QC decision/);
  } finally {
    await cleanup(runtime);
  }
});

test("revocation before, during, and after caption execution preserves exact authority state", async (t) => {
  await t.test("before", async () => {
    const runtime = await harness({ captionExecutor: currentRunCaptionExecutor });
    try {
      const approval = await approved(runtime);
      await runtime.service.createPublishReviewRevocation(approval.runtimeId, {
        approval: approval.request.approval,
        reviewer: { id: approval.response.reviewer.id, attestation: approval.response.reviewer.revocationAttestation },
        revocation: { reasonCodes: ["new_review_required"], note: null },
      });
      await assert.rejects(runtime.service.createCaptionProduction(approval.runtimeId, approval.request), /unrevoked approval/);
    } finally {
      await cleanup(runtime);
    }
  });

  await t.test("during", async () => {
    let enteredResolve!: () => void;
    let releaseResolve!: () => void;
    const entered = new Promise<void>((resolvePromise) => { enteredResolve = resolvePromise; });
    const release = new Promise<void>((resolvePromise) => { releaseResolve = resolvePromise; });
    const gated: CaptionProductionExecutor = {
      describe: currentRunCaptionExecutor.describe,
      async execute(input, signal) {
        enteredResolve();
        await release;
        if (signal.aborted) throw new Error("aborted");
        return currentRunCaptionExecutor.execute(input, signal);
      },
    };
    const runtime = await harness({ captionExecutor: gated });
    try {
      const approval = await approved(runtime);
      const producing = runtime.service.createCaptionProduction(approval.runtimeId, approval.request);
      await entered;
      const paths = runtime.store.paths(approval.runtimeId);
      const ledger = await RuntimeLedger.open(approval.runtimeId, new FileEventJournal(paths.journalPath));
      await new PublishReviewHost(
        ledger,
        new ContentAddressedArtifactStore(paths.artifactStoreRoot),
        { id: approval.response.reviewer.id, label: approval.response.reviewer.label },
      ).revoke({
        approval: approval.request.approval,
        reviewer: { id: approval.response.reviewer.id, attestation: approval.response.reviewer.revocationAttestation },
        revocation: { reasonCodes: ["new_review_required"], note: null },
      });
      releaseResolve();
      await assert.rejects(producing, /failed closed verification|changed while caption production was running|revoked/);
      const loaded = await journal(runtime, approval.runtimeId);
      assert.equal(Object.values(loaded.state.captionProductions)[0].status, "failed");
      assert.equal(
        Object.values(loaded.state.captionProductions)[0].failure,
        "Caption production failed closed during authority revalidation.",
      );
      assert.equal(Object.keys(loaded.state.captionQualityControls).length, 0);
    } finally {
      releaseResolve();
      await cleanup(runtime);
    }
  });

  await t.test("after", async () => {
    const runtime = await harness({ captionExecutor: currentRunCaptionExecutor });
    try {
      const approval = await approved(runtime);
      const produced = await runtime.service.createCaptionProduction(approval.runtimeId, approval.request);
      await runtime.service.createPublishReviewRevocation(approval.runtimeId, {
        approval: approval.request.approval,
        reviewer: { id: approval.response.reviewer.id, attestation: approval.response.reviewer.revocationAttestation },
        revocation: { reasonCodes: ["new_review_required"], note: null },
      });
      const retained = (await runtime.service.captionProductions(approval.runtimeId)).captions[0];
      const qc = (await runtime.service.captionQualityControls(approval.runtimeId)).qualityControls[0];
      assert.equal(retained.authorityState, "revoked_after_completion");
      assert.equal(retained.captionArtifactId, produced.captions[0].captionArtifactId);
      assert.equal(qc.candidate.authorityState, "revoked_after_completion");
    } finally {
      await cleanup(runtime);
    }
  });
});

test("caption executor failure and wall timeout record bounded failed jobs without artifacts or QC", async (t) => {
  await t.test("failure", async () => {
    const runtime = await harness({
      captionExecutor: {
        describe: currentRunCaptionExecutor.describe,
        async execute() { throw new Error("simulated caption executor failure"); },
      },
    });
    try {
      const approval = await approved(runtime);
      await assert.rejects(runtime.service.createCaptionProduction(approval.runtimeId, approval.request), /bounded caption executor/);
      const loaded = await journal(runtime, approval.runtimeId);
      assert.equal(Object.values(loaded.state.captionProductions)[0].status, "failed");
      assert.equal(
        Object.values(loaded.state.captionProductions)[0].failure,
        "Caption production failed closed within its bounded current-run executor.",
      );
      assert.equal(Object.keys(loaded.state.captionQualityControls).length, 0);
    } finally {
      await cleanup(runtime);
    }
  });

  await t.test("timeout", async () => {
    const mutableLimits = CAPTION_PRODUCTION_LIMITS as unknown as { maxWallMs: number };
    const originalWallMs = mutableLimits.maxWallMs;
    mutableLimits.maxWallMs = 5;
    const runtime = await harness({
      captionExecutor: {
        describe: currentRunCaptionExecutor.describe,
        async execute(_input, signal) {
          await new Promise<void>((_resolve, reject) => signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true }));
          return [];
        },
      },
    });
    try {
      const approval = await approved(runtime);
      await assert.rejects(runtime.service.createCaptionProduction(approval.runtimeId, approval.request), /wall-time ceiling/);
      const loaded = await journal(runtime, approval.runtimeId);
      assert.equal(Object.values(loaded.state.captionProductions)[0].status, "failed");
    } finally {
      mutableLimits.maxWallMs = originalWallMs;
      await cleanup(runtime);
    }
  });
});

test("client rejects tampered verified line bytes", async () => {
  const runtime = await harness({ captionExecutor: currentRunCaptionExecutor });
  try {
    const approval = await approved(runtime);
    await runtime.service.createCaptionProduction(approval.runtimeId, approval.request);
    const results = await runtime.service.captionProductionResults(approval.runtimeId);
    const tampered = structuredClone(results);
    tampered.results[0].artifact.lines[0].target.text = "tampered";
    const client = new LocalRuntimeHostClient({
      baseUrl: "http://127.0.0.1:4312",
      token: "caption-test-token",
      fetch: async () => new Response(JSON.stringify(tampered), { status: 200, headers: { "Content-Type": "application/json" } }),
    });
    await assert.rejects(client.captionProductionResults(approval.runtimeId), /artifact bytes do not match/);
    const digest = results.results[0].verification.captionContentId.replace("sha256:", "");
    assert.ok((await readFile(join(runtime.store.paths(approval.runtimeId).artifactStoreRoot, "objects", "sha256", digest.slice(0, 2), digest))).byteLength > 0);
  } finally {
    await cleanup(runtime);
  }
});

const deterministicLanguageExplanation = new DeterministicLanguageExplanationTestExecutor((input) =>
  input.grant.facetKinds.map((kind) => {
    if (kind === "meaning") {
      return {
        kind,
        availability: "available",
        reasonCode: null,
        content: { sceneMeaning: "In this caption, the selected word identifies the current moment or run." },
      };
    }
    if (kind === "word") {
      return {
        kind,
        availability: "available",
        reasonCode: null,
        content: { form: input.grant.selection.text, sense: "current or present", role: "modifier" },
      };
    }
    return {
      kind,
      availability: "unavailable",
      reasonCode: "insufficient_caption_context",
      content: null,
    };
  }));

test("exact selected caption spans produce private receipted explanations and cold/client replay", async () => {
  const runtime = await harness({
    captionExecutor: currentRunCaptionExecutor,
    languageExplanationExecutor: deterministicLanguageExplanation,
  });
  try {
    const approval = await approved(runtime);
    await runtime.service.createCaptionProduction(approval.runtimeId, approval.request);
    const captions = await runtime.service.captionProductionResults(approval.runtimeId);
    const caption = captions.results[0];
    const line = caption.artifact.lines[0];
    const response = await runtime.service.createLanguageExplanation(approval.runtimeId, {
      caption: {
        jobId: caption.verification.jobId,
        artifactId: caption.verification.captionArtifactId,
        contentId: caption.verification.captionContentId,
        receiptArtifactId: caption.verification.receiptArtifactId,
        receiptId: caption.verification.receiptId,
        receiptContentId: caption.verification.receiptContentId,
      },
      lineId: line.id,
      selection: {
        side: "source",
        unit: "unicode_code_point",
        start: 0,
        end: 2,
        text: "현재",
      },
      facetKinds: ["meaning", "word", "grammar"],
    });
    assert.equal(response.results.length, 1);
    const explanation = response.results[0];
    assert.equal(explanation.verification.integrity, "stored_explanation_and_receipt_with_verified_current_caption");
    assert.equal(explanation.artifact.input.line.startMs, line.startMs);
    assert.equal(explanation.artifact.input.line.endMs, line.endMs);
    assert.deepEqual(explanation.artifact.input.selection, {
      side: "source",
      unit: "unicode_code_point",
      start: 0,
      end: 2,
      text: "현재",
    });
    assert.equal(explanation.artifact.executor.classification, "deterministic_test");
    assert.equal(explanation.artifact.rights.publication, "private");
    assert.equal(explanation.artifact.rights.exportEligibility, "unavailable");
    assert.equal(explanation.artifact.semanticReview.state, "not_reviewed");
    assert.equal(explanation.artifact.result.status, "partial");
    assert.equal(explanation.artifact.facets[0].availability, "available");
    assert.equal(explanation.artifact.facets[2].availability, "unavailable");
    assert.deepEqual(explanation.artifact.facets[0].externalCitationIds, []);
    assert.ok(explanation.artifact.input.inputContextLineage.semanticEvidenceArtifactIds.length > 0);
    assert.deepEqual((await runtime.service.languageExplanations(approval.runtimeId)).results, response.results);

    const client = new LocalRuntimeHostClient({
      baseUrl: "http://127.0.0.1:4312",
      token: "language-explanation-test-token",
      fetch: async () => new Response(JSON.stringify(response), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    });
    const clientResult = await client.languageExplanations(approval.runtimeId);
    assert.equal(clientResult.results[0].verification.contentId, explanation.verification.contentId);

    const learningSource = projectVerifiedProductionLearningSource(caption);
    assert.equal(learningSource.state, "ready");
    if (learningSource.state === "ready") {
      assert.deepEqual(learningSource.source.context.timeline, {
        analysisRange: caption.verification.source.range,
        timestampOrigin: { kind: "source_media_zero", offsetMs: 0 },
      });
      const learningRequest = productionSelectionRequest(learningSource.source, line.id, {
        side: "source",
        unit: "unicode_code_point",
        start: 0,
        end: 2,
        text: "현재",
      });
      const presented = projectVerifiedProductionLearningExplanation(
        learningSource.source,
        learningRequest,
        clientResult.results[0],
      );
      assert.equal(presented.state, "partial");
      if (presented.state === "partial") {
        assert.equal(presented.selection.authority.executionAuthority, "host_receipted");
        assert.equal(presented.selection.authority.semanticReviewState, "not_reviewed");
        assert.equal(JSON.stringify(presented).includes("design_fixture"), false);
      }
    }

    const tamperedClientResponse = structuredClone(response);
    tamperedClientResponse.results[0].verification.caption.contentId = `sha256:${"f".repeat(64)}`;
    const tamperedClient = new LocalRuntimeHostClient({
      baseUrl: "http://127.0.0.1:4312",
      token: "language-explanation-test-token",
      fetch: async () => new Response(JSON.stringify(tamperedClientResponse), { status: 200 }),
    });
    await assert.rejects(
      tamperedClient.languageExplanations(approval.runtimeId),
      /verification identities, selection, executor, or counts do not match/,
    );

    const tamperedReceiptResponse = structuredClone(response);
    tamperedReceiptResponse.results[0].verification.receiptId = "language-explanation-receipt:tampered";
    const tamperedReceiptClient = new LocalRuntimeHostClient({
      baseUrl: "http://127.0.0.1:4312",
      token: "language-explanation-test-token",
      fetch: async () => new Response(JSON.stringify(tamperedReceiptResponse), { status: 200 }),
    });
    await assert.rejects(
      tamperedReceiptClient.languageExplanations(approval.runtimeId),
      /receipt bytes or closure do not match/,
    );

    const receiptPath = objectPath(runtime, approval.runtimeId, explanation.verification.receiptContentId);
    const receiptBytes = await readFile(receiptPath);
    await writeFile(receiptPath, "{}\n", "utf8");
    await assert.rejects(
      runtime.service.languageExplanations(approval.runtimeId),
      /stored language explanation, receipt, or exact caption lineage failed closed/i,
    );
    await writeFile(receiptPath, receiptBytes);

    await writeFile(objectPath(runtime, approval.runtimeId, explanation.verification.contentId), "{}\n", "utf8");
    await assert.rejects(
      runtime.service.languageExplanations(approval.runtimeId),
      /stored language explanation, receipt, or exact caption lineage failed closed/i,
    );
  } finally {
    await cleanup(runtime);
  }
});

test("failed language-explanation attempts remain visible and a host-numbered retry can complete once", async () => {
  let calls = 0;
  const flaky: LanguageExplanationExecutor = {
    describe: () => deterministicLanguageExplanation.describe(),
    async generate(input, signal) {
      calls += 1;
      if (calls === 1) throw new Error("transient provider detail must not leak");
      return deterministicLanguageExplanation.generate(input, signal);
    },
  };
  const runtime = await harness({ captionExecutor: currentRunCaptionExecutor, languageExplanationExecutor: flaky });
  try {
    const approval = await approved(runtime);
    await runtime.service.createCaptionProduction(approval.runtimeId, approval.request);
    const caption = (await runtime.service.captionProductionResults(approval.runtimeId)).results[0];
    const request = {
      caption: {
        jobId: caption.verification.jobId,
        artifactId: caption.verification.captionArtifactId,
        contentId: caption.verification.captionContentId,
        receiptArtifactId: caption.verification.receiptArtifactId,
        receiptId: caption.verification.receiptId,
        receiptContentId: caption.verification.receiptContentId,
      },
      lineId: caption.artifact.lines[0].id,
      selection: { side: "source" as const, unit: "unicode_code_point" as const, start: 0, end: 2, text: "현재" },
      facetKinds: ["meaning" as const],
    };
    await assert.rejects(
      runtime.service.createLanguageExplanation(approval.runtimeId, request),
      /generation failed closed/,
    );
    const failed = await runtime.service.languageExplanations(approval.runtimeId);
    assert.deepEqual(failed.results, []);
    assert.equal(failed.attempts.length, 1);
    assert.equal(failed.attempts[0].attempt, 0);
    assert.equal(failed.attempts[0].status, "failed");
    assert.equal(failed.attempts[0].failure, "Language explanation generation failed closed");

    const completed = await runtime.service.createLanguageExplanation(approval.runtimeId, request);
    assert.equal(completed.results.length, 1);
    assert.equal(completed.results[0].artifact.grant.attempt, 1);
    assert.deepEqual(completed.attempts.map((attempt) => attempt.status).sort(), ["completed", "failed"]);
    await assert.rejects(
      runtime.service.createLanguageExplanation(approval.runtimeId, request),
      /already active or completed/,
    );
    assert.equal(calls, 2);
  } finally {
    await cleanup(runtime);
  }
});

test("revoked caption authority cannot mint a new language-explanation attempt", async () => {
  const runtime = await harness({
    captionExecutor: currentRunCaptionExecutor,
    languageExplanationExecutor: deterministicLanguageExplanation,
  });
  try {
    const approval = await approved(runtime);
    await runtime.service.createCaptionProduction(approval.runtimeId, approval.request);
    const caption = (await runtime.service.captionProductionResults(approval.runtimeId)).results[0];
    await runtime.service.createPublishReviewRevocation(approval.runtimeId, {
      approval: approval.request.approval,
      reviewer: {
        id: approval.response.reviewer.id,
        attestation: approval.response.reviewer.revocationAttestation,
      },
      revocation: { reasonCodes: ["new_review_required"], note: null },
    });
    await assert.rejects(runtime.service.createLanguageExplanation(approval.runtimeId, {
      caption: {
        jobId: caption.verification.jobId,
        artifactId: caption.verification.captionArtifactId,
        contentId: caption.verification.captionContentId,
        receiptArtifactId: caption.verification.receiptArtifactId,
        receiptId: caption.verification.receiptId,
        receiptContentId: caption.verification.receiptContentId,
      },
      lineId: caption.artifact.lines[0].id,
      selection: { side: "source", unit: "unicode_code_point", start: 0, end: 2, text: "현재" },
      facetKinds: ["meaning"],
    }), /cannot be produced after caption authority is revoked/);
    assert.deepEqual((await runtime.service.languageExplanations(approval.runtimeId)).attempts, []);
  } finally {
    await cleanup(runtime);
  }
});

test("runtime-host recovery closes an interrupted explanation attempt without inventing a result", async () => {
  const firstCall = { release: null as (() => void) | null };
  let calls = 0;
  const interruptible: LanguageExplanationExecutor = {
    describe: () => deterministicLanguageExplanation.describe(),
    async generate(input, signal) {
      calls += 1;
      if (calls === 1) await new Promise<void>((resolveWait) => { firstCall.release = resolveWait; });
      return deterministicLanguageExplanation.generate(input, signal);
    },
  };
  const runtime = await harness({ captionExecutor: currentRunCaptionExecutor, languageExplanationExecutor: interruptible });
  try {
    const approval = await approved(runtime);
    await runtime.service.createCaptionProduction(approval.runtimeId, approval.request);
    const caption = (await runtime.service.captionProductionResults(approval.runtimeId)).results[0];
    const request = {
      caption: {
        jobId: caption.verification.jobId,
        artifactId: caption.verification.captionArtifactId,
        contentId: caption.verification.captionContentId,
        receiptArtifactId: caption.verification.receiptArtifactId,
        receiptId: caption.verification.receiptId,
        receiptContentId: caption.verification.receiptContentId,
      },
      lineId: caption.artifact.lines[0].id,
      selection: { side: "source" as const, unit: "unicode_code_point" as const, start: 0, end: 2, text: "현재" },
      facetKinds: ["meaning" as const],
    };
    const inFlight = runtime.service.createLanguageExplanation(approval.runtimeId, request);
    const deadline = Date.now() + 3_000;
    while (Date.now() < deadline) {
      const loaded = await journal(runtime, approval.runtimeId);
      if (firstCall.release && Object.values(loaded.state.languageExplanations).some((attempt) => attempt.status === "started")) break;
      await new Promise((resolveWait) => setTimeout(resolveWait, 10));
    }
    assert.ok(firstCall.release, "executor must start before recovery");
    await runtime.service.recover();
    firstCall.release();
    await assert.rejects(inFlight, /generation failed closed/);
    const recovered = await runtime.service.languageExplanations(approval.runtimeId);
    assert.equal(recovered.attempts[0].status, "failed");
    assert.match(recovered.attempts[0].failure ?? "", /explicit runtime-host recovery/);
    assert.deepEqual(recovered.results, []);

    const retried = await runtime.service.createLanguageExplanation(approval.runtimeId, request);
    assert.equal(retried.results[0].artifact.grant.attempt, 1);
    assert.equal(calls, 2);
  } finally {
    firstCall.release?.();
    await cleanup(runtime);
  }
});

test("language-explanation retries stop at the fixed per-request ceiling", async () => {
  let calls = 0;
  const unavailableProvider: LanguageExplanationExecutor = {
    describe: () => deterministicLanguageExplanation.describe(),
    async generate() {
      calls += 1;
      throw new Error("transient provider failure");
    },
  };
  const runtime = await harness({ captionExecutor: currentRunCaptionExecutor, languageExplanationExecutor: unavailableProvider });
  try {
    const approval = await approved(runtime);
    await runtime.service.createCaptionProduction(approval.runtimeId, approval.request);
    const caption = (await runtime.service.captionProductionResults(approval.runtimeId)).results[0];
    const request = {
      caption: {
        jobId: caption.verification.jobId,
        artifactId: caption.verification.captionArtifactId,
        contentId: caption.verification.captionContentId,
        receiptArtifactId: caption.verification.receiptArtifactId,
        receiptId: caption.verification.receiptId,
        receiptContentId: caption.verification.receiptContentId,
      },
      lineId: caption.artifact.lines[0].id,
      selection: { side: "source" as const, unit: "unicode_code_point" as const, start: 0, end: 2, text: "현재" },
      facetKinds: ["meaning" as const],
    };
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await assert.rejects(runtime.service.createLanguageExplanation(approval.runtimeId, request), /generation failed closed/);
    }
    await assert.rejects(
      runtime.service.createLanguageExplanation(approval.runtimeId, request),
      /exhausted its bounded retry attempts/,
    );
    const response = await runtime.service.languageExplanations(approval.runtimeId);
    assert.equal(response.attempts.length, 3);
    assert.ok(response.attempts.every((attempt) => attempt.status === "failed"));
    assert.equal(calls, 3);
    const loaded = await journal(runtime, approval.runtimeId);
    const startedEvents = loaded.events.filter((event) => event.type === "language.explanation_started");
    const lastStarted = startedEvents.at(-1);
    assert.ok(lastStarted);
    const forged = structuredClone(lastStarted);
    forged.seq = loaded.head + 1;
    forged.eventId = `event:${approval.runtimeId}:${forged.seq}`;
    forged.recordedAt = new Date(new Date(lastStarted.recordedAt).getTime() + 1).toISOString();
    forged.data.grant.attempt = 3;
    forged.data.grant.grantId = createLanguageExplanationGrantId({
      runId: approval.runtimeId,
      requestFingerprint: forged.data.grant.requestFingerprint,
      caption: forged.data.grant.caption,
      attempt: forged.data.grant.attempt,
    });
    forged.data.jobId = createLanguageExplanationJobId(forged.data.grant.grantId);
    assert.throws(
      () => projectRuntimeEvents(approval.runtimeId, [...loaded.events, forged]),
      /below the fixed retry ceiling/,
    );
  } finally {
    await cleanup(runtime);
  }
});

test("translation choice can close as target_unavailable and oversized executor output stores no artifact", async (t) => {
  await t.test("target unavailable", async () => {
    const executor = new DeterministicLanguageExplanationTestExecutor((input) => input.grant.facetKinds.map((kind) => ({
      kind,
      availability: "unavailable" as const,
      reasonCode: "target_unavailable" as const,
      content: null,
    })));
    const runtime = await harness({ captionExecutor: incompleteCurrentRunCaptionExecutor, languageExplanationExecutor: executor });
    try {
      const approval = await approved(runtime);
      await runtime.service.createCaptionProduction(approval.runtimeId, approval.request);
      const caption = (await runtime.service.captionProductionResults(approval.runtimeId)).results[0];
      const response = await runtime.service.createLanguageExplanation(approval.runtimeId, {
        caption: {
          jobId: caption.verification.jobId,
          artifactId: caption.verification.captionArtifactId,
          contentId: caption.verification.captionContentId,
          receiptArtifactId: caption.verification.receiptArtifactId,
          receiptId: caption.verification.receiptId,
          receiptContentId: caption.verification.receiptContentId,
        },
        lineId: caption.artifact.lines[0].id,
        selection: { side: "source", unit: "unicode_code_point", start: 0, end: 2, text: "번역" },
        facetKinds: ["translation_choice"],
      });
      assert.equal(response.results[0].artifact.result.status, "unavailable");
      assert.equal(response.results[0].artifact.facets[0].reasonCode, "target_unavailable");
    } finally {
      await cleanup(runtime);
    }
  });

  await t.test("output bound", async () => {
    const oversized = new DeterministicLanguageExplanationTestExecutor(() => [{
      kind: "grammar" as const,
      availability: "available" as const,
      reasonCode: null,
      content: {
        construction: "large bounded construction",
        explanation: "Each field is bounded, but the combined executor output is not.",
        segments: Array.from({ length: 16 }, () => ({ form: "f".repeat(4_096), role: "r".repeat(4_096) })),
      },
    }]);
    const runtime = await harness({ captionExecutor: currentRunCaptionExecutor, languageExplanationExecutor: oversized });
    try {
      const approval = await approved(runtime);
      await runtime.service.createCaptionProduction(approval.runtimeId, approval.request);
      const caption = (await runtime.service.captionProductionResults(approval.runtimeId)).results[0];
      await assert.rejects(runtime.service.createLanguageExplanation(approval.runtimeId, {
        caption: {
          jobId: caption.verification.jobId,
          artifactId: caption.verification.captionArtifactId,
          contentId: caption.verification.captionContentId,
          receiptArtifactId: caption.verification.receiptArtifactId,
          receiptId: caption.verification.receiptId,
          receiptContentId: caption.verification.receiptContentId,
        },
        lineId: caption.artifact.lines[0].id,
        selection: { side: "source", unit: "unicode_code_point", start: 0, end: 2, text: "현재" },
        facetKinds: ["grammar"],
      }), /byte ceiling/);
      const loaded = await journal(runtime, approval.runtimeId);
      assert.equal(Object.values(loaded.state.languageExplanations)[0].status, "failed");
      assert.equal(Object.values(loaded.state.artifacts).filter((artifact) =>
        artifact.origin.kind === "language_explanation_output" || artifact.origin.kind === "language_explanation_receipt").length, 0);
    } finally {
      await cleanup(runtime);
    }
  });
});

test("language explanation rejects open prompts, mixed identities, and incorrect code-point spans", async () => {
  const runtime = await harness({
    captionExecutor: currentRunCaptionExecutor,
    languageExplanationExecutor: deterministicLanguageExplanation,
  });
  try {
    const approval = await approved(runtime);
    await runtime.service.createCaptionProduction(approval.runtimeId, approval.request);
    const caption = (await runtime.service.captionProductionResults(approval.runtimeId)).results[0];
    const base = {
      caption: {
        jobId: caption.verification.jobId,
        artifactId: caption.verification.captionArtifactId,
        contentId: caption.verification.captionContentId,
        receiptArtifactId: caption.verification.receiptArtifactId,
        receiptId: caption.verification.receiptId,
        receiptContentId: caption.verification.receiptContentId,
      },
      lineId: caption.artifact.lines[0].id,
      selection: { side: "source" as const, unit: "unicode_code_point" as const, start: 0, end: 2, text: "현재" },
      facetKinds: ["meaning" as const],
    };
    await assert.rejects(
      runtime.service.createLanguageExplanation(approval.runtimeId, { ...base, prompt: "trust caller prose" }),
      /invalid or contains open fields/,
    );
    await assert.rejects(
      runtime.service.createLanguageExplanation(approval.runtimeId, {
        ...base,
        caption: { ...base.caption, contentId: `sha256:${"a".repeat(64)}` },
      }),
      /exact verified production caption result/,
    );
    await assert.rejects(
      runtime.service.createLanguageExplanation(approval.runtimeId, {
        ...base,
        selection: { ...base.selection, text: "실행" },
      }),
      /does not match the stored caption text/,
    );
    await assert.rejects(
      runtime.service.createLanguageExplanation(approval.runtimeId, {
        ...base,
        facetKinds: ["meaning", "culture"],
      } as never),
      /invalid|facet/i,
    );
    assert.deepEqual((await runtime.service.languageExplanations(approval.runtimeId)).results, []);
  } finally {
    await cleanup(runtime);
  }
});

test("language explanation is explicitly unavailable without configured model authority", async () => {
  const runtime = await harness({ captionExecutor: currentRunCaptionExecutor });
  try {
    const approval = await approved(runtime);
    await runtime.service.createCaptionProduction(approval.runtimeId, approval.request);
    const caption = (await runtime.service.captionProductionResults(approval.runtimeId)).results[0];
    await assert.rejects(runtime.service.createLanguageExplanation(approval.runtimeId, {
      caption: {
        jobId: caption.verification.jobId,
        artifactId: caption.verification.captionArtifactId,
        contentId: caption.verification.captionContentId,
        receiptArtifactId: caption.verification.receiptArtifactId,
        receiptId: caption.verification.receiptId,
        receiptContentId: caption.verification.receiptContentId,
      },
      lineId: caption.artifact.lines[0].id,
      selection: { side: "source", unit: "unicode_code_point", start: 0, end: 2, text: "현재" },
      facetKinds: ["meaning"],
    }), /unavailable until a model is explicitly configured/);
    const loaded = await journal(runtime, approval.runtimeId);
    assert.equal(Object.keys(loaded.state.languageExplanations).length, 0);
  } finally {
    await cleanup(runtime);
  }
});
