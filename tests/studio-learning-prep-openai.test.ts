import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";

import type { CaptionProductionExecutor } from "../src/studio/runtime/production/captions/captionProductionExecutor.ts";
import type { LearningPrepExecutorInput } from "../src/studio/runtime/production/model.ts";
import { LEARNING_PREP_LIMITS, LEARNING_PREP_NON_CLAIMS } from "../src/studio/runtime/production/model.ts";
import { LEARNING_PREP_PROMPT } from "../src/studio/runtime/production/learningPrep/executor.ts";
import { OpenAiLearningPrepExecutor } from "../src/studio/runtime/production/learningPrep/openAiExecutor.ts";
import { resolveLearningPrepExecutorConfiguration } from "../src/studio/runtime/production/learningPrep/configuration.ts";
import {
  DeterministicRuntimeExecutor,
  DurableRuntimeCommandStore,
  RuntimeSourceRegistry,
  RuntimeStartService,
  deterministicOrchestratorLauncherFactory,
} from "../src/studio/runtime/production/runtimeHost/index.ts";
import type { RuntimeHostStartRequest } from "../src/studio/runtime/production/runtimeHost/model.ts";

const input = {
  grant: {
    fineTune: {
      schema: "studio.learning-fine-tune.v1",
      armedLenses: ["word_order", "situating"],
      temperature: "medium",
    },
  },
  lines: [{
    lineId: "line:1",
    startMs: 0,
    endMs: 1_000,
    source: { language: "ko", state: "available", text: "현재 실행", reasonCode: null },
    target: { language: "en", state: "available", text: "Current run", reasonCode: null },
  }],
} as unknown as LearningPrepExecutorInput;

const closedOutput = {
  segmentation: { mode: "beats", beats: [{ lineIds: ["line:1"] }] },
  candidates: [{
    lens: "word_order",
    lineId: "line:1",
    availability: "available",
    reasonCode: null,
    content: { sourcePhrase: "현재 실행", targetPhrase: "Current run", note: "Subject-final verb order." },
  }],
  lensAbstentions: [{ lens: "situating", reasonCode: "generator_abstained" }],
};

function completedResponse(text: string, overrides: Record<string, unknown> = {}): Response {
  return new Response(JSON.stringify({
    id: "resp_learning_prep_test",
    status: "completed",
    output: [{ type: "message", content: [{ type: "output_text", text }] }],
    usage: { input_tokens: 240, output_tokens: 60 },
    ...overrides,
  }), { status: 200, headers: { "Content-Type": "application/json" } });
}

test("OpenAI learning-prep adapter sends a bounded stored-false structured Responses request", async () => {
  const originalFetch = globalThis.fetch;
  const captured: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = async (url, init) => {
    captured.push({ url: String(url), init });
    return completedResponse(JSON.stringify(closedOutput));
  };
  try {
    const executor = new OpenAiLearningPrepExecutor({ model: "explicit-test-model", apiKey: "test-key" });
    const result = await executor.generate(input, new AbortController().signal);
    assert.equal(result.output.segmentation.mode, "beats");
    assert.equal(result.output.candidates[0].availability, "available");
    assert.deepEqual(result.output.lensAbstentions, [{ lens: "situating", reasonCode: "generator_abstained" }]);
    assert.deepEqual(result.execution, {
      providerResponseId: "resp_learning_prep_test",
      inputTokens: 240,
      outputTokens: 60,
    });
    const request = captured[0];
    assert.ok(request);
    assert.equal(request.url, "https://api.openai.com/v1/responses");
    assert.equal(request.init?.method, "POST");
    const body = JSON.parse(String(request.init?.body)) as {
      model: string;
      store: boolean;
      instructions: string;
      input: string;
      text: { format: { type: string; strict: boolean; schema: unknown } };
      max_output_tokens: number;
      prompt?: unknown;
    };
    assert.equal(body.model, "explicit-test-model");
    assert.equal(body.store, false);
    assert.equal(body.instructions, LEARNING_PREP_PROMPT);
    assert.equal(body.text.format.type, "json_schema");
    assert.equal(body.text.format.strict, true);
    assert.doesNotMatch(JSON.stringify(body.text.format.schema), /"const":/);
    assert.match(JSON.stringify(body.text.format.schema), /"enum":\["word_order"\]/);
    assert.equal(body.max_output_tokens, LEARNING_PREP_LIMITS.maxCompletionTokens);
    assert.equal("prompt" in body, false);
    const modelInput = JSON.parse(body.input) as {
      fineTune: { armedLenses: string[]; temperature: string };
      lines: Array<{ lineId: string }>;
    };
    assert.deepEqual(modelInput.fineTune.armedLenses, ["word_order", "situating"]);
    assert.equal(modelInput.fineTune.temperature, "medium");
    assert.equal(modelInput.lines[0].lineId, "line:1");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("OpenAI learning-prep adapter fails closed on HTTP, incomplete, open, and invalid structured output", async (t) => {
  const originalFetch = globalThis.fetch;
  try {
    const executor = new OpenAiLearningPrepExecutor({ model: "explicit-test-model", apiKey: "test-key" });
    await t.test("HTTP failure", async () => {
      globalThis.fetch = async () => new Response("provider failure", { status: 503 });
      await assert.rejects(executor.generate(input, new AbortController().signal), /HTTP 503/);
    });
    await t.test("incomplete response", async () => {
      globalThis.fetch = async () => completedResponse("{}", { status: "incomplete" });
      await assert.rejects(executor.generate(input, new AbortController().signal), /did not complete/);
    });
    await t.test("open output envelope", async () => {
      globalThis.fetch = async () => completedResponse(JSON.stringify({ ...closedOutput, extra: "caller-open" }));
      await assert.rejects(executor.generate(input, new AbortController().signal), /closed output envelope/);
    });
    await t.test("missing provider receipt identity", async () => {
      globalThis.fetch = async () => completedResponse(JSON.stringify(closedOutput), { id: null });
      await assert.rejects(executor.generate(input, new AbortController().signal), /provider response id/);
    });
    await t.test("mixed refusal content", async () => {
      globalThis.fetch = async () => new Response(JSON.stringify({
        id: "resp_mixed",
        status: "completed",
        output: [{
          type: "message",
          content: [
            { type: "output_text", text: JSON.stringify(closedOutput) },
            { type: "refusal", refusal: "cannot answer" },
          ],
        }],
      }), { status: 200 });
      await assert.rejects(executor.generate(input, new AbortController().signal), /refusal or unsupported/);
    });
    await t.test("model prose that breaks the beat partition is rejected, not coerced", async () => {
      globalThis.fetch = async () => completedResponse(JSON.stringify({
        ...closedOutput,
        segmentation: { mode: "beats", beats: [{ lineIds: ["line:invented"] }] },
      }));
      await assert.rejects(
        executor.generate(input, new AbortController().signal),
        /partition every caption line contiguously, completely, and in order/,
      );
    });
    await t.test("oversized provider envelope", async () => {
      globalThis.fetch = async () => new Response("x".repeat(LEARNING_PREP_LIMITS.maxProviderResponseBytes + 1), { status: 200 });
      await assert.rejects(executor.generate(input, new AbortController().signal), /response byte ceiling/);
    });
    await t.test("oversized declared provider envelope", async () => {
      globalThis.fetch = async () => new Response("{}", {
        status: 200,
        headers: { "Content-Length": String(LEARNING_PREP_LIMITS.maxProviderResponseBytes + 1) },
      });
      await assert.rejects(executor.generate(input, new AbortController().signal), /response byte ceiling/);
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("OpenAI learning-prep adapter requires explicit bounded configuration", () => {
  assert.throws(() => new OpenAiLearningPrepExecutor({ model: "", apiKey: "test-key" }), /explicit bounded model id/);
  assert.throws(() => new OpenAiLearningPrepExecutor({ model: "explicit-test-model", apiKey: "" }), /requires an API key/);
});

test("runtime-host learning-prep configuration requires both explicit real opt-in and model", () => {
  assert.deepEqual(resolveLearningPrepExecutorConfiguration({ mode: null, allowReal: false, model: null }), {
    mode: "unavailable",
    model: null,
  });
  assert.throws(
    () => resolveLearningPrepExecutorConfiguration({ mode: "other", allowReal: false, model: null }),
    /must be unavailable or openai/,
  );
  assert.throws(
    () => resolveLearningPrepExecutorConfiguration({ mode: "openai", allowReal: false, model: "explicit-model" }),
    /requires --allow-real-learning-prep/,
  );
  assert.throws(
    () => resolveLearningPrepExecutorConfiguration({ mode: "openai", allowReal: true, model: null }),
    /requires an explicit --learning-prep-model identity/,
  );
  assert.deepEqual(
    resolveLearningPrepExecutorConfiguration({ mode: "openai", allowReal: true, model: "explicit-model" }),
    { mode: "openai", model: "explicit-model" },
  );
});

// Guarded live proof. Skipped by default; a skip is not proof of anything. A
// successful run proves real execution and stored lineage only: it is not
// semantic quality, culture or history truth, alignment evidence, or ranking
// truth, and the stored notes remain not_reviewed caption-context inference.
const LIVE = process.env.STUDIO_RUN_REAL_LEARNING_PREP === "1";
const FIXTURE = resolve("public/demo/runs/run-005");

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
  async execute(captionInput) {
    return [{
      id: "line-current-run-001",
      startMs: captionInput.range.startMs,
      endMs: Math.min(captionInput.range.endMs, captionInput.range.startMs + 1_000),
      source: { language: "ko", state: "available", text: "현재 실행", reasonCode: null },
      target: { language: "en", state: "available", text: "Current run", reasonCode: null },
    }];
  },
};

async function openAiKey(): Promise<string> {
  const environmentKey = process.env.OPENAI_API_KEY?.trim();
  if (environmentKey) return environmentKey;
  const contents = await readFile(resolve(".env"), "utf8").catch(() => "");
  const key = (contents.match(/^OPENAI_API_KEY=(.+)$/m) ?? [])[1]?.trim();
  if (!key) throw new Error("The real learning-prep proof requires OPENAI_API_KEY in the environment or .env");
  return key;
}

async function terminal(service: RuntimeStartService, commandId: string): Promise<void> {
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    if ((await service.statusByCommand(commandId)).terminal) return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 10));
  }
  assert.fail("runtime did not become terminal");
}

test("guarded real OpenAI learning prep stores one receipted live prep with verified lineage", {
  skip: !LIVE,
  timeout: 300_000,
}, async () => {
  const model = process.env.STUDIO_LEARNING_PREP_MODEL?.trim();
  if (!model) throw new Error("STUDIO_LEARNING_PREP_MODEL is required when the real learning-prep proof is enabled");
  const apiKey = await openAiKey();
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const proofRoot = resolve(process.env.STUDIO_LEARNING_PREP_PROOF_ROOT?.trim() || ".studio/learning-prep-proofs");
  const runtimeRoot = join(proofRoot, `proof-${stamp}-${process.pid}`);
  await mkdir(proofRoot, { recursive: true });
  await mkdir(runtimeRoot, { recursive: false });
  const sources = await RuntimeSourceRegistry.open({ sourceDirectories: [FIXTURE] });
  const store = await DurableRuntimeCommandStore.open(runtimeRoot);
  const service = await RuntimeStartService.open({
    store,
    sources,
    launcherFactory: new DeterministicRuntimeExecutor().factory(),
    orchestratorLauncherFactory: deterministicOrchestratorLauncherFactory(),
    studyContractVersion: "v1" as const,
    captionExecutor: currentRunCaptionExecutor,
    learningPrepExecutor: new OpenAiLearningPrepExecutor({ apiKey, model }),
    recoverOnOpen: false,
  });
  const source = sources.list()[0];
  const startRequest: RuntimeHostStartRequest = {
    sourceSessionId: source.sourceSessionId,
    sourceRevisionId: source.sourceRevisionId,
    range: { startMs: 0, endMs: 47_200 },
    requestedSourceLanguage: { mode: "declared", languages: ["ko"], reason: null },
    targetLanguage: "en",
    selectedLanguagePackId: "ko-v3",
    outputDepth: "captions",
  };
  const acknowledgement = await service.start(startRequest);
  await terminal(service, acknowledgement.commandId);
  const runtimeId = acknowledgement.runtimeId;
  const intake = (await service.publishReviewIntakes(runtimeId)).intakes[0];
  assert.ok(intake, "a proceed study must create one review intake");
  const authority = await service.publishReviewDecisions(runtimeId);
  const decision = await service.createPublishReviewDecision(runtimeId, {
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
  const approval = decision.reviews[0];
  await service.createCaptionProduction(runtimeId, {
    approval: {
      reviewId: approval.reviewId,
      artifactId: approval.artifactId,
      receiptId: approval.receiptId,
      receiptContentId: approval.receiptContentId,
    },
  });
  const caption = (await service.captionProductionResults(runtimeId)).results[0];

  const response = await service.createLearningPrep(runtimeId, {
    caption: {
      jobId: caption.verification.jobId,
      artifactId: caption.verification.captionArtifactId,
      contentId: caption.verification.captionContentId,
      receiptArtifactId: caption.verification.receiptArtifactId,
      receiptId: caption.verification.receiptId,
      receiptContentId: caption.verification.receiptContentId,
    },
    fineTune: {
      schema: "studio.learning-fine-tune.v1",
      armedLenses: ["word_order", "grammar_salience", "situating", "culture_reference", "historical_reference"],
      temperature: "medium",
    },
  });
  assert.equal(response.results.length, 1);
  const prep = response.results[0];
  assert.equal(prep.verification.integrity, "stored_learning_prep_and_receipt_with_verified_current_caption");
  assert.equal(prep.artifact.executor.id, "studio.openai-learning-prep-generator");
  assert.equal(prep.artifact.executor.classification, "real_model");
  assert.equal(prep.artifact.executor.model, model);
  assert.deepEqual(prep.receipt.producer.executor, prep.artifact.executor);
  assert.equal(typeof prep.receipt.execution.providerResponseId, "string");
  assert.ok(prep.receipt.execution.providerResponseId, "a live call must carry its provider response id");
  assert.equal(prep.artifact.semanticReview.state, "not_reviewed");
  assert.equal(prep.artifact.rights.publication, "private");
  assert.equal(prep.artifact.rights.exportEligibility, "unavailable");
  assert.deepEqual(prep.artifact.nonClaims, LEARNING_PREP_NON_CLAIMS);
  for (const candidate of prep.artifact.candidates) {
    assert.equal(candidate.semanticReview, "not_reviewed");
    assert.deepEqual(candidate.externalCitationIds, []);
  }
  assert.ok(
    ["completed", "partial", "unavailable"].includes(prep.artifact.result.status),
    "any closed result status, including honest all-withheld, is a valid live outcome",
  );
  const cold = await service.learningPreps(runtimeId);
  assert.deepEqual(cold.results, response.results);
  console.log(`retained learning-prep live proof: ${runtimeRoot}`);
});
