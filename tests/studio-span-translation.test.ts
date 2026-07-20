import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import type { CaptionProductionExecutor } from "../src/studio/runtime/production/captions/captionProductionExecutor.ts";
import { projectRuntimeEvents } from "../src/studio/runtime/production/projection.ts";
import {
  DeterministicRuntimeExecutor,
  DeterministicSpanTranslationTestExecutor,
  DurableRuntimeCommandStore,
  RuntimeSourceRegistry,
  RuntimeStartService,
  deterministicOrchestratorLauncherFactory,
} from "../src/studio/runtime/production/runtimeHost/index.ts";
import type { SpanTranslationExecutor } from "../src/studio/runtime/production/spanTranslations/executor.ts";
import {
  createSpanTranslationGrantId,
  createSpanTranslationJobId,
} from "../src/studio/runtime/production/spanTranslations/identity.ts";
import type {
  RuntimeHostStartRequest,
  RuntimeHostCaptionProductionRequest,
  RuntimeHostPublishReviewDecisionResponse,
} from "../src/studio/runtime/production/runtimeHost/model.ts";
import { readValidatedRuntimeJournal } from "../src/studio/runtime/production/runtimeHost/journalPolling.ts";

const FIXTURE = resolve("public/demo/runs/run-005");

interface Harness {
  directory: string;
  store: DurableRuntimeCommandStore;
  service: RuntimeStartService;
  request: RuntimeHostStartRequest;
}

async function harness(options: {
  spanTranslationExecutor?: SpanTranslationExecutor;
} = {}): Promise<Harness> {
  const directory = await mkdtemp(join(tmpdir(), "studio-span-translation-test-"));
  const sources = await RuntimeSourceRegistry.open({ sourceDirectories: [FIXTURE] });
  const store = await DurableRuntimeCommandStore.open(join(directory, "host"));
  const service = await RuntimeStartService.open({
    store,
    sources,
    launcherFactory: new DeterministicRuntimeExecutor({}).factory(),
    orchestratorLauncherFactory: deterministicOrchestratorLauncherFactory({}),
    studyContractVersion: "v1" as const,
    captionExecutor: currentRunCaptionExecutor,
    spanTranslationExecutor: options.spanTranslationExecutor,
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

const deterministicSpanTranslation = new DeterministicSpanTranslationTestExecutor((input) => ({
  availability: "available",
  reasonCode: null,
  text: `now (${input.grant.selection.text})`,
}));

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

async function captionRequestBase(runtime: Harness) {
  const approval = await approved(runtime);
  await runtime.service.createCaptionProduction(approval.runtimeId, approval.request);
  const caption = (await runtime.service.captionProductionResults(approval.runtimeId)).results[0];
  return {
    approval,
    caption,
    request: {
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

test("exact selected caption spans produce private receipted translations and cold replay", async () => {
  const runtime = await harness({ spanTranslationExecutor: deterministicSpanTranslation });
  try {
    const { approval, caption, request } = await captionRequestBase(runtime);
    const line = caption.artifact.lines[0];
    const response = await runtime.service.createSpanTranslation(approval.runtimeId, request);
    assert.equal(response.results.length, 1);
    const result = response.results[0];
    assert.equal(result.verification.integrity, "stored_translation_and_receipt_with_verified_current_caption");
    assert.equal(result.artifact.input.line.startMs, line.startMs);
    assert.equal(result.artifact.input.line.endMs, line.endMs);
    assert.deepEqual(result.artifact.input.selection, request.selection);
    assert.equal(result.artifact.executor.classification, "deterministic_test");
    assert.equal(result.artifact.rights.publication, "private");
    assert.equal(result.artifact.rights.exportEligibility, "unavailable");
    assert.equal(result.artifact.semanticReview.state, "not_reviewed");
    assert.equal(result.artifact.result.status, "completed");
    assert.equal(result.artifact.translation.language, "en");
    assert.equal(result.artifact.translation.availability, "available");
    assert.equal(result.artifact.translation.text, "now (현재)");
    assert.equal(result.artifact.translation.semanticReview, "not_reviewed");
    assert.deepEqual(result.artifact.translation.externalCitationIds, []);
    assert.equal(result.receipt.result.availability, "available");
    assert.ok(result.artifact.input.inputContextLineage.semanticEvidenceArtifactIds.length > 0);
    assert.deepEqual((await runtime.service.spanTranslations(approval.runtimeId)).results, response.results);

    const receiptPath = objectPath(runtime, approval.runtimeId, result.verification.receiptContentId);
    const receiptBytes = await readFile(receiptPath);
    await writeFile(receiptPath, "{}\n", "utf8");
    await assert.rejects(
      runtime.service.spanTranslations(approval.runtimeId),
      /stored span translation, receipt, or exact caption lineage failed closed/i,
    );
    await writeFile(receiptPath, receiptBytes);

    await writeFile(objectPath(runtime, approval.runtimeId, result.verification.contentId), "{}\n", "utf8");
    await assert.rejects(
      runtime.service.spanTranslations(approval.runtimeId),
      /stored span translation, receipt, or exact caption lineage failed closed/i,
    );
  } finally {
    await cleanup(runtime);
  }
});

test("abstaining and withheld translations stay honest and target-side spans translate to Korean", async () => {
  const abstaining = new DeterministicSpanTranslationTestExecutor(() => ({
    availability: "withheld",
    reasonCode: "generator_abstained",
    text: null,
  }));
  const runtime = await harness({ spanTranslationExecutor: abstaining });
  try {
    const { approval, request } = await captionRequestBase(runtime);
    const withheld = await runtime.service.createSpanTranslation(approval.runtimeId, request);
    assert.equal(withheld.results[0].artifact.result.status, "withheld");
    assert.equal(withheld.results[0].artifact.translation.text, null);
    assert.equal(withheld.results[0].artifact.translation.grounding, "none");
    assert.equal(withheld.results[0].receipt.result.reasonCode, "generator_abstained");

    const targetRequest = {
      ...request,
      selection: { side: "target" as const, unit: "unicode_code_point" as const, start: 0, end: 7, text: "Current" },
    };
    const targetResponse = await runtime.service.createSpanTranslation(approval.runtimeId, targetRequest);
    const targetResult = targetResponse.results.find((candidate) =>
      candidate.verification.selection.side === "target");
    assert.ok(targetResult);
    assert.equal(targetResult.artifact.translation.language, "ko");
  } finally {
    await cleanup(runtime);
  }
});

test("failed span-translation attempts remain visible and a host-numbered retry can complete once", async () => {
  let calls = 0;
  const flaky: SpanTranslationExecutor = {
    describe: () => deterministicSpanTranslation.describe(),
    async generate(input, signal) {
      calls += 1;
      if (calls === 1) throw new Error("transient provider detail must not leak");
      return deterministicSpanTranslation.generate(input, signal);
    },
  };
  const runtime = await harness({ spanTranslationExecutor: flaky });
  try {
    const { approval, request } = await captionRequestBase(runtime);
    await assert.rejects(
      runtime.service.createSpanTranslation(approval.runtimeId, request),
      /translation failed closed/,
    );
    const failed = await runtime.service.spanTranslations(approval.runtimeId);
    assert.deepEqual(failed.results, []);
    assert.equal(failed.attempts.length, 1);
    assert.equal(failed.attempts[0].attempt, 0);
    assert.equal(failed.attempts[0].status, "failed");
    assert.equal(failed.attempts[0].failure, "Span translation failed closed");

    const completed = await runtime.service.createSpanTranslation(approval.runtimeId, request);
    assert.equal(completed.results.length, 1);
    assert.equal(completed.results[0].artifact.grant.attempt, 1);
    assert.deepEqual(completed.attempts.map((attempt) => attempt.status).sort(), ["completed", "failed"]);
    await assert.rejects(
      runtime.service.createSpanTranslation(approval.runtimeId, request),
      /already active or completed/,
    );
    assert.equal(calls, 2);
  } finally {
    await cleanup(runtime);
  }
});

test("revoked caption authority cannot mint a new span-translation attempt", async () => {
  const runtime = await harness({ spanTranslationExecutor: deterministicSpanTranslation });
  try {
    const { approval, request } = await captionRequestBase(runtime);
    await runtime.service.createPublishReviewRevocation(approval.runtimeId, {
      approval: approval.request.approval,
      reviewer: {
        id: approval.response.reviewer.id,
        attestation: approval.response.reviewer.revocationAttestation,
      },
      revocation: { reasonCodes: ["new_review_required"], note: null },
    });
    await assert.rejects(
      runtime.service.createSpanTranslation(approval.runtimeId, request),
      /cannot be produced after caption authority is revoked/,
    );
    assert.deepEqual((await runtime.service.spanTranslations(approval.runtimeId)).attempts, []);
  } finally {
    await cleanup(runtime);
  }
});

test("runtime-host recovery closes an interrupted span translation without inventing a result", async () => {
  const firstCall = { release: null as (() => void) | null };
  let calls = 0;
  const interruptible: SpanTranslationExecutor = {
    describe: () => deterministicSpanTranslation.describe(),
    async generate(input, signal) {
      calls += 1;
      if (calls === 1) await new Promise<void>((resolveWait) => { firstCall.release = resolveWait; });
      return deterministicSpanTranslation.generate(input, signal);
    },
  };
  const runtime = await harness({ spanTranslationExecutor: interruptible });
  try {
    const { approval, request } = await captionRequestBase(runtime);
    const inFlight = runtime.service.createSpanTranslation(approval.runtimeId, request);
    const deadline = Date.now() + 3_000;
    while (Date.now() < deadline) {
      const loaded = await journal(runtime, approval.runtimeId);
      if (firstCall.release && Object.values(loaded.state.spanTranslations).some((attempt) => attempt.status === "started")) break;
      await new Promise((resolveWait) => setTimeout(resolveWait, 10));
    }
    assert.ok(firstCall.release, "executor must start before recovery");
    await runtime.service.recover();
    firstCall.release();
    await assert.rejects(inFlight, /translation failed closed/);
    const recovered = await runtime.service.spanTranslations(approval.runtimeId);
    assert.equal(recovered.attempts[0].status, "failed");
    assert.match(recovered.attempts[0].failure ?? "", /explicit runtime-host recovery/);
    assert.deepEqual(recovered.results, []);

    const retried = await runtime.service.createSpanTranslation(approval.runtimeId, request);
    assert.equal(retried.results[0].artifact.grant.attempt, 1);
    assert.equal(calls, 2);
  } finally {
    firstCall.release?.();
    await cleanup(runtime);
  }
});

test("span-translation retries stop at the fixed per-request ceiling", async () => {
  let calls = 0;
  const unavailableProvider: SpanTranslationExecutor = {
    describe: () => deterministicSpanTranslation.describe(),
    async generate() {
      calls += 1;
      throw new Error("transient provider failure");
    },
  };
  const runtime = await harness({ spanTranslationExecutor: unavailableProvider });
  try {
    const { approval, request } = await captionRequestBase(runtime);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await assert.rejects(runtime.service.createSpanTranslation(approval.runtimeId, request), /translation failed closed/);
    }
    await assert.rejects(
      runtime.service.createSpanTranslation(approval.runtimeId, request),
      /exhausted its bounded retry attempts/,
    );
    const response = await runtime.service.spanTranslations(approval.runtimeId);
    assert.equal(response.attempts.length, 3);
    assert.ok(response.attempts.every((attempt) => attempt.status === "failed"));
    assert.equal(calls, 3);
    const loaded = await journal(runtime, approval.runtimeId);
    const startedEvents = loaded.events.filter((event) => event.type === "translation.span_started");
    const lastStarted = startedEvents.at(-1);
    assert.ok(lastStarted);
    const forged = structuredClone(lastStarted);
    forged.seq = loaded.head + 1;
    forged.eventId = `event:${approval.runtimeId}:${forged.seq}`;
    forged.recordedAt = new Date(new Date(lastStarted.recordedAt).getTime() + 1).toISOString();
    forged.data.grant.attempt = 3;
    forged.data.grant.grantId = createSpanTranslationGrantId({
      runId: approval.runtimeId,
      requestFingerprint: forged.data.grant.requestFingerprint,
      caption: forged.data.grant.caption,
      attempt: forged.data.grant.attempt,
    });
    forged.data.jobId = createSpanTranslationJobId(forged.data.grant.grantId);
    assert.throws(
      () => projectRuntimeEvents(approval.runtimeId, [...loaded.events, forged]),
      /below the fixed retry ceiling/,
    );
  } finally {
    await cleanup(runtime);
  }
});

test("span translation rejects open prompts, mixed identities, and incorrect code-point spans", async () => {
  const runtime = await harness({ spanTranslationExecutor: deterministicSpanTranslation });
  try {
    const { approval, request } = await captionRequestBase(runtime);
    await assert.rejects(
      runtime.service.createSpanTranslation(approval.runtimeId, { ...request, prompt: "trust caller prose" }),
      /invalid or contains open fields/,
    );
    await assert.rejects(
      runtime.service.createSpanTranslation(approval.runtimeId, {
        ...request,
        caption: { ...request.caption, contentId: `sha256:${"a".repeat(64)}` },
      }),
      /exact verified production caption result/,
    );
    await assert.rejects(
      runtime.service.createSpanTranslation(approval.runtimeId, {
        ...request,
        selection: { ...request.selection, text: "실행" },
      }),
      /does not match the stored caption text/,
    );
    await assert.rejects(
      runtime.service.createSpanTranslation(approval.runtimeId, {
        ...request,
        lineId: "line-missing",
      }),
      /selected caption line does not exist/,
    );
    assert.deepEqual((await runtime.service.spanTranslations(approval.runtimeId)).results, []);
  } finally {
    await cleanup(runtime);
  }
});

test("span translation is explicitly unavailable without configured model authority", async () => {
  const runtime = await harness();
  try {
    const { approval, request } = await captionRequestBase(runtime);
    await assert.rejects(
      runtime.service.createSpanTranslation(approval.runtimeId, request),
      /unavailable until a model is explicitly configured/,
    );
    const loaded = await journal(runtime, approval.runtimeId);
    assert.equal(Object.keys(loaded.state.spanTranslations).length, 0);
  } finally {
    await cleanup(runtime);
  }
});

test("oversized executor output fails closed and stores no artifact", async () => {
  const oversized = new DeterministicSpanTranslationTestExecutor(() => ({
    availability: "available",
    reasonCode: null,
    text: "x".repeat(1_900),
  }));
  const runtime = await harness({ spanTranslationExecutor: oversized });
  try {
    const { approval, request } = await captionRequestBase(runtime);
    // 1900 bytes sits under the translation-text field bound and must store cleanly.
    const response = await runtime.service.createSpanTranslation(approval.runtimeId, request);
    assert.equal(response.results.length, 1);

    const tooLarge = new DeterministicSpanTranslationTestExecutor(() => ({
      availability: "available",
      reasonCode: null,
      text: "y".repeat(3_000),
    }));
    const second = await harness({ spanTranslationExecutor: tooLarge });
    try {
      const base = await captionRequestBase(second);
      await assert.rejects(
        second.service.createSpanTranslation(base.approval.runtimeId, base.request),
        /translation failed closed/,
      );
      const loaded = await journal(second, base.approval.runtimeId);
      assert.equal(Object.values(loaded.state.spanTranslations)[0].status, "failed");
      assert.equal(Object.values(loaded.state.artifacts).filter((artifact) =>
        artifact.origin.kind === "span_translation_output" || artifact.origin.kind === "span_translation_receipt").length, 0);
    } finally {
      await cleanup(second);
    }
  } finally {
    await cleanup(runtime);
  }
});
