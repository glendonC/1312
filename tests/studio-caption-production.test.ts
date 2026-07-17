import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import { ContentAddressedArtifactStore } from "../src/studio/runtime/production/artifactStore.ts";
import type { CaptionProductionExecutor } from "../src/studio/runtime/production/captionProductionExecutor.ts";
import { FileEventJournal, RuntimeLedger } from "../src/studio/runtime/production/journal.ts";
import { CAPTION_PRODUCTION_LIMITS } from "../src/studio/runtime/production/model.ts";
import { projectRuntimeEvents } from "../src/studio/runtime/production/projection.ts";
import { PublishReviewHost } from "../src/studio/runtime/production/publishReviewHost.ts";
import {
  DeterministicRuntimeExecutor,
  DurableRuntimeCommandStore,
  RuntimeSourceRegistry,
  RuntimeStartService,
  deterministicOrchestratorLauncherFactory,
} from "../src/studio/runtime/production/runtimeHost/index.ts";
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
} = {}): Promise<Harness> {
  const directory = await mkdtemp(join(tmpdir(), "studio-caption-production-test-"));
  const sources = await RuntimeSourceRegistry.open({ sourceDirectories: [FIXTURE] });
  const store = await DurableRuntimeCommandStore.open(join(directory, "host"));
  const service = await RuntimeStartService.open({
    store,
    sources,
    launcherFactory: new DeterministicRuntimeExecutor({ mode: options.executionMode }).factory(),
    orchestratorLauncherFactory: deterministicOrchestratorLauncherFactory({ mode: options.orchestratorMode }),
    captionExecutor: options.captionExecutor,
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
  } finally {
    await cleanup(runtime);
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
