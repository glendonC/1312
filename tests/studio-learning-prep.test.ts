import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import type { CaptionProductionExecutor } from "../src/studio/runtime/production/captions/captionProductionExecutor.ts";
import type {
  GeneratedLearningPrepOutput,
  LearningFineTune,
  LearningPrepExecutorInput,
  LearningPrepLensKind,
  LearningPrepTemperature,
} from "../src/studio/runtime/production/model.ts";
import { projectRuntimeEvents } from "../src/studio/runtime/production/projection.ts";
import type { LearningPrepExecutor } from "../src/studio/runtime/production/learningPrep/executor.ts";
import {
  DeterministicLearningPrepTestExecutor,
  DeterministicRuntimeExecutor,
  DurableRuntimeCommandStore,
  RuntimeSourceRegistry,
  RuntimeStartService,
  createRuntimeHostHttpServer,
  deterministicOrchestratorLauncherFactory,
  listenRuntimeHost,
} from "../src/studio/runtime/production/runtimeHost/index.ts";
import { LocalRuntimeHostClient } from "../src/studio/localRuntime/client.ts";
import { ProductionLearningPrepController } from "../src/studio/localRuntime/productionLearningPrepController.ts";
import { projectVerifiedProductionLearningSource } from "../src/studio/learning/productionSourceAdapter.ts";
import { learningPrepKey, type LearningFineTuneDraft } from "../src/studio/learning/presentation.ts";
import { readValidatedRuntimeJournal } from "../src/studio/runtime/production/runtimeHost/journalPolling.ts";
import type {
  RuntimeHostCaptionProductionRequest,
  RuntimeHostPublishReviewDecisionResponse,
  RuntimeHostStartRequest,
} from "../src/studio/runtime/production/runtimeHost/model.ts";

const FIXTURE = resolve("public/demo/runs/run-005");
const ALL_LENSES: LearningPrepLensKind[] = [
  "word_order",
  "grammar_salience",
  "situating",
  "culture_reference",
  "historical_reference",
];

interface Harness {
  directory: string;
  store: DurableRuntimeCommandStore;
  service: RuntimeStartService;
  request: RuntimeHostStartRequest;
}

async function harness(options: {
  captionExecutor?: CaptionProductionExecutor;
  learningPrepExecutor?: LearningPrepExecutor;
} = {}): Promise<Harness> {
  const directory = await mkdtemp(join(tmpdir(), "studio-learning-prep-test-"));
  const sources = await RuntimeSourceRegistry.open({ sourceDirectories: [FIXTURE] });
  const store = await DurableRuntimeCommandStore.open(join(directory, "host"));
  const service = await RuntimeStartService.open({
    store,
    sources,
    launcherFactory: new DeterministicRuntimeExecutor().factory(),
    orchestratorLauncherFactory: deterministicOrchestratorLauncherFactory(),
    studyContractVersion: "v1" as const,
    captionExecutor: options.captionExecutor,
    learningPrepExecutor: options.learningPrepExecutor,
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

interface CaptionAuthority {
  jobId: string;
  artifactId: string;
  contentId: string;
  receiptArtifactId: string;
  receiptId: string;
  receiptContentId: string;
}

async function producedCaption(runtime: Harness, approval: Awaited<ReturnType<typeof approved>>): Promise<CaptionAuthority> {
  await runtime.service.createCaptionProduction(approval.runtimeId, approval.request);
  const caption = (await runtime.service.captionProductionResults(approval.runtimeId)).results[0];
  return {
    jobId: caption.verification.jobId,
    artifactId: caption.verification.captionArtifactId,
    contentId: caption.verification.captionContentId,
    receiptArtifactId: caption.verification.receiptArtifactId,
    receiptId: caption.verification.receiptId,
    receiptContentId: caption.verification.receiptContentId,
  };
}

function fineTune(
  armedLenses: LearningPrepLensKind[],
  temperature: LearningPrepTemperature,
): LearningFineTune {
  return { schema: "studio.learning-fine-tune.v1", armedLenses, temperature };
}

function prepRequest(
  caption: CaptionAuthority,
  armedLenses: LearningPrepLensKind[],
  temperature: LearningPrepTemperature,
): { caption: CaptionAuthority; fineTune: LearningFineTune } {
  return { caption: structuredClone(caption), fineTune: fineTune(armedLenses, temperature) };
}

const richPrep = new DeterministicLearningPrepTestExecutor((input: LearningPrepExecutorInput): GeneratedLearningPrepOutput => {
  const line = input.lines[0];
  return {
    segmentation: { mode: "beats", beats: [{ lineIds: input.lines.map((entry) => entry.lineId) }] },
    candidates: [
      {
        lens: "word_order",
        lineId: line.lineId,
        availability: "available",
        reasonCode: null,
        content: {
          sourcePhrase: "현재 실행",
          targetPhrase: "Current run",
          note: "The Korean modifier precedes the noun and English keeps the same order in this moment.",
        },
      },
      {
        lens: "grammar_salience",
        lineId: line.lineId,
        availability: "available",
        reasonCode: null,
        content: { construction: "bare noun phrase", note: "No particle follows the noun in this caption." },
      },
      {
        lens: "situating",
        lineId: line.lineId,
        availability: "available",
        reasonCode: null,
        content: { situation: "One caption names the current run without additional scene context." },
      },
      {
        lens: "culture_reference",
        lineId: line.lineId,
        availability: "withheld",
        reasonCode: "external_grounding_unavailable",
        content: null,
      },
    ],
    lensAbstentions: [{ lens: "historical_reference", reasonCode: "no_reference_detected" }],
  };
});

const abstainingPrep = new DeterministicLearningPrepTestExecutor((input: LearningPrepExecutorInput): GeneratedLearningPrepOutput => ({
  segmentation: { mode: "watch_through", reasonCode: "no_beat_boundaries_warranted" },
  candidates: [],
  lensAbstentions: input.grant.fineTune.armedLenses.map((lens) => ({
    lens,
    reasonCode: "insufficient_caption_context",
  })),
}));

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

test("armed lenses produce one private receipted learning prep with beats, honest withholding, and cold replay", async () => {
  const runtime = await harness({ captionExecutor: currentRunCaptionExecutor, learningPrepExecutor: richPrep });
  try {
    const approval = await approved(runtime);
    const caption = await producedCaption(runtime, approval);
    const response = await runtime.service.createLearningPrep(
      approval.runtimeId,
      prepRequest(caption, ALL_LENSES, "high"),
    );
    assert.equal(response.results.length, 1);
    const prep = response.results[0];
    assert.equal(prep.verification.integrity, "stored_learning_prep_and_receipt_with_verified_current_caption");
    assert.equal(prep.artifact.executor.classification, "deterministic_test");
    assert.equal(prep.artifact.rights.publication, "private");
    assert.equal(prep.artifact.rights.exportEligibility, "unavailable");
    assert.equal(prep.artifact.semanticReview.state, "not_reviewed");
    assert.deepEqual(prep.artifact.grant.fineTune, fineTune(ALL_LENSES, "high"));
    assert.equal(prep.artifact.segmentation.mode, "beats");
    if (prep.artifact.segmentation.mode === "beats") {
      assert.equal(prep.artifact.segmentation.beats.length, 1);
      assert.equal(prep.artifact.segmentation.beats[0].beatId, "beat:0");
      assert.equal(prep.artifact.segmentation.beats[0].startMs, prep.artifact.input.lines[0].startMs);
      assert.equal(prep.artifact.segmentation.beats[0].endMs, prep.artifact.input.lines[0].endMs);
    }
    assert.equal(prep.artifact.result.status, "partial");
    assert.equal(prep.artifact.result.candidateCount, 4);
    assert.equal(prep.artifact.result.availableCandidateCount, 3);
    assert.equal(prep.artifact.result.withheldCandidateCount, 1);
    assert.equal(prep.artifact.result.unavailableCandidateCount, 0);
    assert.equal(prep.artifact.result.surfacedLensCount, 4);
    assert.equal(prep.artifact.result.abstainedLensCount, 1);
    assert.equal(prep.artifact.result.beatCount, 1);
    assert.equal(prep.artifact.candidates[0].anchor.lineId, prep.artifact.input.lines[0].lineId);
    assert.equal(prep.artifact.candidates[0].anchor.startMs, prep.artifact.input.lines[0].startMs);
    assert.deepEqual(prep.artifact.candidates[0].externalCitationIds, []);
    assert.equal(prep.artifact.candidates[0].semanticReview, "not_reviewed");
    assert.equal(prep.artifact.candidates[0].grounding, "caption_context_inference");
    const withheld = prep.artifact.candidates.find((candidate) => candidate.lens === "culture_reference");
    assert.equal(withheld?.availability, "withheld");
    assert.equal(withheld?.reasonCode, "external_grounding_unavailable");
    assert.equal(withheld?.grounding, "none");
    const abstained = prep.artifact.lenses.find((lens) => lens.lens === "historical_reference");
    assert.equal(abstained?.state, "abstained");
    assert.equal(abstained?.reasonCode, "no_reference_detected");
    assert.deepEqual(prep.receipt.result.lenses.map((lens) => lens.state), [
      "surfaced", "surfaced", "surfaced", "surfaced", "abstained",
    ]);

    assert.deepEqual((await runtime.service.learningPreps(approval.runtimeId)).results, response.results);
    const loaded = await journal(runtime, approval.runtimeId);
    assert.deepEqual(projectRuntimeEvents(approval.runtimeId, loaded.events), loaded.state);
    assert.equal(Object.keys(loaded.state.learningPreps).length, 1);

    const prepPath = objectPath(runtime, approval.runtimeId, prep.verification.contentId);
    const prepBytes = await readFile(prepPath);
    await writeFile(prepPath, "{}\n", "utf8");
    await assert.rejects(
      runtime.service.learningPreps(approval.runtimeId),
      /stored learning prep, receipt, or exact caption lineage failed closed/i,
    );
    await writeFile(prepPath, prepBytes);
    const receiptPath = objectPath(runtime, approval.runtimeId, prep.verification.receiptContentId);
    const receiptBytes = await readFile(receiptPath);
    await writeFile(receiptPath, "{}\n", "utf8");
    await assert.rejects(
      runtime.service.learningPreps(approval.runtimeId),
      /stored learning prep, receipt, or exact caption lineage failed closed/i,
    );
    await writeFile(receiptPath, receiptBytes);
    assert.equal((await runtime.service.learningPreps(approval.runtimeId)).results.length, 1);
  } finally {
    await cleanup(runtime);
  }
});

test("an all-abstained prep is receipted as honestly unavailable instead of invented content", async () => {
  const runtime = await harness({ captionExecutor: currentRunCaptionExecutor, learningPrepExecutor: abstainingPrep });
  try {
    const approval = await approved(runtime);
    const caption = await producedCaption(runtime, approval);
    const response = await runtime.service.createLearningPrep(
      approval.runtimeId,
      prepRequest(caption, ["situating", "culture_reference", "historical_reference"], "low"),
    );
    const prep = response.results[0];
    assert.equal(prep.artifact.result.status, "unavailable");
    assert.equal(prep.artifact.result.candidateCount, 0);
    assert.equal(prep.artifact.result.availableCandidateCount, 0);
    assert.equal(prep.artifact.result.abstainedLensCount, 3);
    assert.equal(prep.artifact.result.beatCount, null);
    assert.equal(prep.artifact.segmentation.mode, "watch_through");
    assert.equal(prep.artifact.candidates.length, 0);
    assert.deepEqual(prep.artifact.lenses.map((lens) => lens.state), ["abstained", "abstained", "abstained"]);
    assert.deepEqual((await runtime.service.learningPreps(approval.runtimeId)).results, response.results);
  } finally {
    await cleanup(runtime);
  }
});

test("the default unconfigured executor is unavailable and records no attempt lineage", async () => {
  const runtime = await harness({ captionExecutor: currentRunCaptionExecutor });
  try {
    const approval = await approved(runtime);
    const caption = await producedCaption(runtime, approval);
    await assert.rejects(
      runtime.service.createLearningPrep(approval.runtimeId, prepRequest(caption, ["situating"], "low")),
      /unavailable until a model is explicitly configured/,
    );
    const state = await runtime.service.learningPreps(approval.runtimeId);
    assert.deepEqual(state.attempts, []);
    assert.deepEqual(state.results, []);
  } finally {
    await cleanup(runtime);
  }
});

test("open fields, invalid fine-tune, and stale caption identity fail closed without lineage", async () => {
  const runtime = await harness({ captionExecutor: currentRunCaptionExecutor, learningPrepExecutor: richPrep });
  try {
    const approval = await approved(runtime);
    const caption = await producedCaption(runtime, approval);
    const valid = prepRequest(caption, ["situating"], "low");
    for (const open of [
      { ...valid, prompt: "explain everything" },
      { ...valid, sourcePath: "/tmp/media" },
      { caption: valid.caption, fineTune: { ...valid.fineTune, armedLenses: [] } },
      { caption: valid.caption, fineTune: { ...valid.fineTune, armedLenses: ["situating", "situating"] } },
      { caption: valid.caption, fineTune: { ...valid.fineTune, temperature: "maximal" } },
      { caption: valid.caption, fineTune: { ...valid.fineTune, armedLenses: ["course_mode"] } },
    ]) {
      await assert.rejects(
        runtime.service.createLearningPrep(approval.runtimeId, open),
        /invalid or contains open fields/,
      );
    }
    const stale = prepRequest(
      { ...caption, contentId: `sha256:${"a".repeat(64)}` },
      ["situating"],
      "low",
    );
    await assert.rejects(
      runtime.service.createLearningPrep(approval.runtimeId, stale),
      /exact verified production caption result/,
    );
    const state = await runtime.service.learningPreps(approval.runtimeId);
    assert.deepEqual(state.attempts, []);
    assert.deepEqual(state.results, []);
  } finally {
    await cleanup(runtime);
  }
});

test("temperature ceilings reject over-surfaced output and bounded retries exhaust closed", async () => {
  const overSurfacing = new DeterministicLearningPrepTestExecutor((input: LearningPrepExecutorInput): GeneratedLearningPrepOutput => {
    const line = input.lines[0];
    return {
      segmentation: { mode: "watch_through", reasonCode: "no_beat_boundaries_warranted" },
      candidates: [
        {
          lens: "word_order",
          lineId: line.lineId,
          availability: "available",
          reasonCode: null,
          content: { sourcePhrase: "현재", targetPhrase: "Current", note: "Order note." },
        },
        {
          lens: "grammar_salience",
          lineId: line.lineId,
          availability: "available",
          reasonCode: null,
          content: { construction: "noun", note: "Grammar note." },
        },
      ],
      lensAbstentions: [],
    };
  });
  const runtime = await harness({ captionExecutor: currentRunCaptionExecutor, learningPrepExecutor: overSurfacing });
  try {
    const approval = await approved(runtime);
    const caption = await producedCaption(runtime, approval);
    const request = prepRequest(caption, ["word_order", "grammar_salience"], "low");
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await assert.rejects(
        runtime.service.createLearningPrep(approval.runtimeId, request),
        /generation failed closed/,
      );
    }
    const failed = await runtime.service.learningPreps(approval.runtimeId);
    assert.equal(failed.attempts.length, 3);
    assert.deepEqual(failed.attempts.map((attempt) => attempt.status), ["failed", "failed", "failed"]);
    assert.equal(failed.attempts[0].failure, "Learning prep generation failed closed");
    assert.deepEqual(failed.results, []);
    await assert.rejects(
      runtime.service.createLearningPrep(approval.runtimeId, request),
      /exhausted its bounded retry attempts/,
    );
  } finally {
    await cleanup(runtime);
  }
});

test("an invalid beat partition and unavailable-target word-order help fail closed", async () => {
  const badPartition = new DeterministicLearningPrepTestExecutor((): GeneratedLearningPrepOutput => ({
    segmentation: { mode: "beats", beats: [{ lineIds: ["line-not-in-captions"] }] },
    candidates: [],
    lensAbstentions: [{ lens: "situating", reasonCode: "generator_abstained" }],
  }));
  const partitionRuntime = await harness({ captionExecutor: currentRunCaptionExecutor, learningPrepExecutor: badPartition });
  try {
    const approval = await approved(partitionRuntime);
    const caption = await producedCaption(partitionRuntime, approval);
    await assert.rejects(
      partitionRuntime.service.createLearningPrep(approval.runtimeId, prepRequest(caption, ["situating"], "low")),
      /generation failed closed/,
    );
    assert.equal((await partitionRuntime.service.learningPreps(approval.runtimeId)).attempts[0].status, "failed");
  } finally {
    await cleanup(partitionRuntime);
  }

  const wordOrderOnMissingTarget = new DeterministicLearningPrepTestExecutor((input: LearningPrepExecutorInput): GeneratedLearningPrepOutput => ({
    segmentation: { mode: "watch_through", reasonCode: "no_beat_boundaries_warranted" },
    candidates: [{
      lens: "word_order",
      lineId: input.lines[0].lineId,
      availability: "available",
      reasonCode: null,
      content: { sourcePhrase: "번역 대기", targetPhrase: "Pending", note: "Invented mapping." },
    }],
    lensAbstentions: [],
  }));
  const targetRuntime = await harness({
    captionExecutor: incompleteCurrentRunCaptionExecutor,
    learningPrepExecutor: wordOrderOnMissingTarget,
  });
  try {
    const approval = await approved(targetRuntime);
    const caption = await producedCaption(targetRuntime, approval);
    await assert.rejects(
      targetRuntime.service.createLearningPrep(approval.runtimeId, prepRequest(caption, ["word_order"], "low")),
      /generation failed closed/,
    );
    assert.equal((await targetRuntime.service.learningPreps(approval.runtimeId)).attempts[0].status, "failed");
  } finally {
    await cleanup(targetRuntime);
  }
});

test("failed prep attempts remain visible, a host-numbered retry completes once, and duplicates are rejected", async () => {
  let calls = 0;
  const flaky: LearningPrepExecutor = {
    describe: () => richPrep.describe(),
    async generate(input, signal) {
      calls += 1;
      if (calls === 1) throw new Error("transient provider detail must not leak");
      return richPrep.generate(input, signal);
    },
  };
  const runtime = await harness({ captionExecutor: currentRunCaptionExecutor, learningPrepExecutor: flaky });
  try {
    const approval = await approved(runtime);
    const caption = await producedCaption(runtime, approval);
    const request = prepRequest(caption, ALL_LENSES, "high");
    await assert.rejects(
      runtime.service.createLearningPrep(approval.runtimeId, request),
      /generation failed closed/,
    );
    const failed = await runtime.service.learningPreps(approval.runtimeId);
    assert.deepEqual(failed.results, []);
    assert.equal(failed.attempts.length, 1);
    assert.equal(failed.attempts[0].attempt, 0);
    assert.equal(failed.attempts[0].status, "failed");
    assert.equal(failed.attempts[0].failure, "Learning prep generation failed closed");

    const completed = await runtime.service.createLearningPrep(approval.runtimeId, request);
    assert.equal(completed.results.length, 1);
    assert.equal(completed.results[0].artifact.grant.attempt, 1);
    assert.deepEqual(completed.attempts.map((attempt) => attempt.status).sort(), ["completed", "failed"]);
    await assert.rejects(
      runtime.service.createLearningPrep(approval.runtimeId, request),
      /already active or completed/,
    );
    assert.equal(calls, 2);
  } finally {
    await cleanup(runtime);
  }
});

test("revoked caption authority cannot mint a new learning-prep attempt", async () => {
  const runtime = await harness({ captionExecutor: currentRunCaptionExecutor, learningPrepExecutor: richPrep });
  try {
    const approval = await approved(runtime);
    const caption = await producedCaption(runtime, approval);
    await runtime.service.createPublishReviewRevocation(approval.runtimeId, {
      approval: approval.request.approval,
      reviewer: {
        id: approval.response.reviewer.id,
        attestation: approval.response.reviewer.revocationAttestation,
      },
      revocation: { reasonCodes: ["new_review_required"], note: null },
    });
    await assert.rejects(
      runtime.service.createLearningPrep(approval.runtimeId, prepRequest(caption, ["situating"], "low")),
      /cannot be produced after caption authority is revoked/,
    );
    assert.deepEqual((await runtime.service.learningPreps(approval.runtimeId)).attempts, []);
  } finally {
    await cleanup(runtime);
  }
});

test("runtime-host recovery closes an interrupted prep attempt without inventing a result", async () => {
  const firstCall = { release: null as (() => void) | null };
  let calls = 0;
  const interruptible: LearningPrepExecutor = {
    describe: () => richPrep.describe(),
    async generate(input, signal) {
      calls += 1;
      if (calls === 1) await new Promise<void>((resolveWait) => { firstCall.release = resolveWait; });
      return richPrep.generate(input, signal);
    },
  };
  const runtime = await harness({ captionExecutor: currentRunCaptionExecutor, learningPrepExecutor: interruptible });
  try {
    const approval = await approved(runtime);
    const caption = await producedCaption(runtime, approval);
    const request = prepRequest(caption, ALL_LENSES, "high");
    const inFlight = runtime.service.createLearningPrep(approval.runtimeId, request);
    const deadline = Date.now() + 3_000;
    while (Date.now() < deadline) {
      const loaded = await journal(runtime, approval.runtimeId);
      if (firstCall.release && Object.values(loaded.state.learningPreps).some((attempt) => attempt.status === "started")) break;
      await new Promise((resolveWait) => setTimeout(resolveWait, 10));
    }
    assert.ok(firstCall.release, "executor must start before recovery");
    await runtime.service.recover();
    firstCall.release();
    await assert.rejects(inFlight, /generation failed closed/);
    const recovered = await runtime.service.learningPreps(approval.runtimeId);
    assert.equal(recovered.attempts[0].status, "failed");
    assert.match(recovered.attempts[0].failure ?? "", /explicit runtime-host recovery/);
    assert.deepEqual(recovered.results, []);

    const retried = await runtime.service.createLearningPrep(approval.runtimeId, request);
    assert.equal(retried.results[0].artifact.grant.attempt, 1);
    assert.equal(calls, 2);
  } finally {
    firstCall.release?.();
    await cleanup(runtime);
  }
});

async function overHttp<T>(
  runtime: Harness,
  operate: (client: LocalRuntimeHostClient) => Promise<T>,
): Promise<T> {
  const token = "d".repeat(64);
  const server = createRuntimeHostHttpServer({
    service: runtime.service,
    token,
    allowedOrigins: ["http://127.0.0.1:4321"],
  });
  try {
    const address = await listenRuntimeHost(server, { port: 0 });
    const client = new LocalRuntimeHostClient({
      baseUrl: `http://${address.host}:${address.port}`,
      token,
    });
    return await operate(client);
  } finally {
    await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
  }
}

test("the strict client and prep controller close armed fine-tune to a moments projection over real HTTP", async () => {
  let generatorCalls = 0;
  const counting: LearningPrepExecutor = {
    describe: () => richPrep.describe(),
    async generate(input, signal) {
      generatorCalls += 1;
      return richPrep.generate(input, signal);
    },
  };
  const runtime = await harness({ captionExecutor: currentRunCaptionExecutor, learningPrepExecutor: counting });
  try {
    const approval = await approved(runtime);
    await runtime.service.createCaptionProduction(approval.runtimeId, approval.request);
    const caption = (await runtime.service.captionProductionResults(approval.runtimeId)).results[0];
    const projection = projectVerifiedProductionLearningSource(caption);
    assert.equal(projection.state, "ready");
    if (projection.state !== "ready") return;
    const source = projection.source;
    if (source.context.origin !== "verified_production_caption") assert.fail("expected production source");
    const fineTune: LearningFineTuneDraft = { armedLenses: [...ALL_LENSES], temperature: "high" };

    await overHttp(runtime, async (client) => {
      const controller = new ProductionLearningPrepController(client);
      const input = { runtimeId: approval.runtimeId, source, fineTune };
      const first = await controller.request(input);
      assert.equal(first.state, "ready");
      if (first.state !== "ready") return;
      assert.equal(first.prepKey, learningPrepKey(source, fineTune));
      assert.equal(first.resultState, "partial");
      assert.equal(first.moments.length, 4);
      assert.equal(first.moments.filter((moment) => moment.availability === "available").length, 3);
      assert.equal(first.moments[0].lineId, source.moments[0].lineId);
      assert.equal(first.moments[0].startMs, source.moments[0].startMs);
      assert.equal(first.moments[0].endMs, source.moments[0].endMs);
      assert.equal(first.moments[0].semanticReviewState, "not_reviewed");
      assert.deepEqual(first.moments[0].externalCitationIds, []);
      assert.equal(first.segmentation.mode, "beats");
      assert.deepEqual(first.lenses.map((lens) => lens.state), [
        "surfaced", "surfaced", "surfaced", "surfaced", "abstained",
      ]);
      assert.equal(first.authority.semanticReviewState, "not_reviewed");
      assert.ok(first.nonClaims.includes("caption_context_not_culture_or_history_authority"));

      const again = await controller.request(input);
      assert.equal(again.state, "ready");
      assert.equal(generatorCalls, 1);

      const parsed = await client.learningPreps(approval.runtimeId);
      assert.equal(parsed.results.length, 1);
      assert.equal(parsed.attempts.length, 1);
      assert.equal(parsed.attempts[0].status, "completed");
    });

    const response = await runtime.service.learningPreps(approval.runtimeId);
    const tamperedFineTune = structuredClone(response);
    tamperedFineTune.results[0].verification.fineTune.temperature = "low";
    const tamperedClient = new LocalRuntimeHostClient({
      baseUrl: "http://127.0.0.1:4312",
      token: "learning-prep-test-token",
      fetch: async () => new Response(JSON.stringify(tamperedFineTune), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    });
    await assert.rejects(
      tamperedClient.learningPreps(approval.runtimeId),
      /completed attempts and verified results do not close one-to-one|verification identities, fine-tune, executor, or counts do not match/,
    );

    const tamperedReceipt = structuredClone(response);
    tamperedReceipt.results[0].verification.receiptId = "learning-prep-receipt:tampered";
    const tamperedReceiptClient = new LocalRuntimeHostClient({
      baseUrl: "http://127.0.0.1:4312",
      token: "learning-prep-test-token",
      fetch: async () => new Response(JSON.stringify(tamperedReceipt), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    });
    await assert.rejects(
      tamperedReceiptClient.learningPreps(approval.runtimeId),
      /receipt bytes or closure do not match/,
    );

    const tamperedNote = structuredClone(response);
    const tamperedCandidate = tamperedNote.results[0].artifact.candidates[0];
    if (tamperedCandidate.availability === "available" && tamperedCandidate.lens === "word_order") {
      tamperedCandidate.content.note = "tampered note";
    }
    const tamperedNoteClient = new LocalRuntimeHostClient({
      baseUrl: "http://127.0.0.1:4312",
      token: "learning-prep-test-token",
      fetch: async () => new Response(JSON.stringify(tamperedNote), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    });
    await assert.rejects(
      tamperedNoteClient.learningPreps(approval.runtimeId),
      /artifact bytes do not match/,
    );
  } finally {
    await cleanup(runtime);
  }
});

test("over HTTP an unconfigured prep executor is a non-retryable unavailable face state", async () => {
  const runtime = await harness({ captionExecutor: currentRunCaptionExecutor });
  try {
    const approval = await approved(runtime);
    await runtime.service.createCaptionProduction(approval.runtimeId, approval.request);
    const caption = (await runtime.service.captionProductionResults(approval.runtimeId)).results[0];
    const projection = projectVerifiedProductionLearningSource(caption);
    assert.equal(projection.state, "ready");
    if (projection.state !== "ready" || projection.source.context.origin !== "verified_production_caption") return;
    const source = projection.source;
    await overHttp(runtime, async (client) => {
      const controller = new ProductionLearningPrepController(client);
      const state = await controller.request({
        runtimeId: approval.runtimeId,
        source,
        fineTune: { armedLenses: ["situating"], temperature: "low" },
      });
      assert.equal(state.state, "unavailable");
      if (state.state !== "unavailable") return;
      assert.equal(state.reasonCode, "production_prep_executor_unavailable");
      assert.equal(state.retry, "unavailable");
      const parsed = await client.learningPreps(approval.runtimeId);
      assert.deepEqual(parsed.attempts, []);
      assert.deepEqual(parsed.results, []);
    });
  } finally {
    await cleanup(runtime);
  }
});

test("over HTTP an all-abstained prep projects an honest empty overlay surface", async () => {
  const runtime = await harness({ captionExecutor: currentRunCaptionExecutor, learningPrepExecutor: abstainingPrep });
  try {
    const approval = await approved(runtime);
    await runtime.service.createCaptionProduction(approval.runtimeId, approval.request);
    const caption = (await runtime.service.captionProductionResults(approval.runtimeId)).results[0];
    const projection = projectVerifiedProductionLearningSource(caption);
    assert.equal(projection.state, "ready");
    if (projection.state !== "ready" || projection.source.context.origin !== "verified_production_caption") return;
    const source = projection.source;
    await overHttp(runtime, async (client) => {
      const controller = new ProductionLearningPrepController(client);
      const state = await controller.request({
        runtimeId: approval.runtimeId,
        source,
        fineTune: { armedLenses: ["situating", "culture_reference", "historical_reference"], temperature: "low" },
      });
      assert.equal(state.state, "ready");
      if (state.state !== "ready") return;
      assert.equal(state.resultState, "unavailable");
      assert.equal(state.moments.length, 0);
      assert.equal(state.segmentation.mode, "watch_through");
      assert.deepEqual(state.lenses.map((lens) => lens.state), ["abstained", "abstained", "abstained"]);
    });
  } finally {
    await cleanup(runtime);
  }
});

test("a runtime without caption production returns an honest empty prep surface", async () => {
  const runtime = await harness({ captionExecutor: currentRunCaptionExecutor, learningPrepExecutor: richPrep });
  try {
    const acknowledgement = await runtime.service.start(runtime.request);
    await terminal(runtime.service, acknowledgement.commandId);
    const state = await runtime.service.learningPreps(acknowledgement.runtimeId);
    assert.deepEqual(state.attempts, []);
    assert.deepEqual(state.results, []);
    const fabricated: CaptionAuthority = {
      jobId: "caption-production:missing",
      artifactId: "artifact:missing",
      contentId: `sha256:${"b".repeat(64)}`,
      receiptArtifactId: "artifact:missing-receipt",
      receiptId: "caption-production-receipt:missing",
      receiptContentId: `sha256:${"c".repeat(64)}`,
    };
    await assert.rejects(
      runtime.service.createLearningPrep(acknowledgement.runtimeId, prepRequest(fabricated, ["situating"], "low")),
      /exact verified production caption result/,
    );
  } finally {
    await cleanup(runtime);
  }
});
