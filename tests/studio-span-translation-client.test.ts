import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import type { CaptionProductionExecutor } from "../src/studio/runtime/production/captions/captionProductionExecutor.ts";
import {
  DeterministicRuntimeExecutor,
  DeterministicSpanTranslationTestExecutor,
  DurableRuntimeCommandStore,
  RuntimeSourceRegistry,
  RuntimeStartService,
  deterministicOrchestratorLauncherFactory,
} from "../src/studio/runtime/production/runtimeHost/index.ts";
import type {
  RuntimeHostSpanTranslationResponse,
  RuntimeHostStartRequest,
} from "../src/studio/runtime/production/runtimeHost/model.ts";
import { LocalRuntimeHostClient, RuntimeHostClientError } from "../src/studio/localRuntime/client.ts";
import {
  ProductionSpanTranslationController,
  type ProductionSpanTranslationRuntimeClient,
} from "../src/studio/localRuntime/productionSpanTranslationController.ts";
import { productionSelectionRequest } from "../src/studio/localRuntime/productionLearningController.ts";
import { projectVerifiedProductionLearningSource } from "../src/studio/learning/productionSourceAdapter.ts";
import { projectVerifiedProductionSpanTranslation } from "../src/studio/learning/productionTranslationAdapter.ts";

const FIXTURE = resolve("public/demo/runs/run-005");

interface Harness {
  directory: string;
  store: DurableRuntimeCommandStore;
  service: RuntimeStartService;
  request: RuntimeHostStartRequest;
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

const deterministicSpanTranslation = new DeterministicSpanTranslationTestExecutor(() => ({
  availability: "available",
  reasonCode: null,
  text: "now",
}));

async function harness(): Promise<Harness> {
  const directory = await mkdtemp(join(tmpdir(), "studio-span-translation-client-test-"));
  const sources = await RuntimeSourceRegistry.open({ sourceDirectories: [FIXTURE] });
  const store = await DurableRuntimeCommandStore.open(join(directory, "host"));
  const service = await RuntimeStartService.open({
    store,
    sources,
    launcherFactory: new DeterministicRuntimeExecutor({}).factory(),
    orchestratorLauncherFactory: deterministicOrchestratorLauncherFactory({}),
    studyContractVersion: "v1" as const,
    captionExecutor: currentRunCaptionExecutor,
    spanTranslationExecutor: deterministicSpanTranslation,
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

async function terminal(service: RuntimeStartService, commandId: string): Promise<void> {
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    if ((await service.statusByCommand(commandId)).terminal) return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 10));
  }
  assert.fail("runtime did not become terminal");
}

async function producedResponse(runtime: Harness) {
  const acknowledgement = await runtime.service.start(runtime.request);
  await terminal(runtime.service, acknowledgement.commandId);
  const intake = (await runtime.service.publishReviewIntakes(acknowledgement.runtimeId)).intakes[0];
  const authority = await runtime.service.publishReviewDecisions(acknowledgement.runtimeId);
  const decision = await runtime.service.createPublishReviewDecision(acknowledgement.runtimeId, {
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
  await runtime.service.createCaptionProduction(acknowledgement.runtimeId, {
    approval: {
      reviewId: approval.reviewId,
      artifactId: approval.artifactId,
      receiptId: approval.receiptId,
      receiptContentId: approval.receiptContentId,
    },
  });
  const caption = (await runtime.service.captionProductionResults(acknowledgement.runtimeId)).results[0];
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
  };
  const response = await runtime.service.createSpanTranslation(acknowledgement.runtimeId, request);
  return { runtimeId: acknowledgement.runtimeId, caption, request, response };
}

function stubClient(payload: unknown): LocalRuntimeHostClient {
  return new LocalRuntimeHostClient({
    baseUrl: "http://127.0.0.1:4312",
    token: "span-translation-test-token",
    fetch: async () => new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  });
}

async function cleanup(runtime: Harness): Promise<void> {
  await rm(runtime.directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
}

test("the strict client re-hashes real span translations and rejects every tamper", async () => {
  const runtime = await harness();
  try {
    const { runtimeId, caption, request, response } = await producedResponse(runtime);

    const clientResult = await stubClient(response).spanTranslations(runtimeId);
    assert.equal(clientResult.results[0].verification.contentId, response.results[0].verification.contentId);
    assert.equal(clientResult.results[0].artifact.translation.text, "now");

    const tamperedCaption = structuredClone(response);
    tamperedCaption.results[0].verification.caption.contentId = `sha256:${"f".repeat(64)}`;
    await assert.rejects(
      stubClient(tamperedCaption).spanTranslations(runtimeId),
      /verification identities, selection, executor, or result do not match/,
    );

    const tamperedReceipt = structuredClone(response);
    tamperedReceipt.results[0].verification.receiptId = "span-translation-receipt:tampered";
    await assert.rejects(
      stubClient(tamperedReceipt).spanTranslations(runtimeId),
      /receipt bytes or closure do not match/,
    );

    const tamperedText = structuredClone(response);
    tamperedText.results[0].artifact.translation.text = "invented gloss";
    await assert.rejects(
      stubClient(tamperedText).spanTranslations(runtimeId),
      /artifact bytes do not match/,
    );

    const orphanResult = structuredClone(response);
    orphanResult.attempts = [];
    await assert.rejects(
      stubClient(orphanResult).spanTranslations(runtimeId),
      /verified result has no completed attempt|do not close one-to-one/,
    );

    const duplicated = structuredClone(response);
    duplicated.results.push(structuredClone(duplicated.results[0]));
    await assert.rejects(
      stubClient(duplicated).spanTranslations(runtimeId),
      /is duplicated/,
    );

    const learningSource = projectVerifiedProductionLearningSource(caption);
    assert.equal(learningSource.state, "ready");
    if (learningSource.state === "ready") {
      const learningRequest = productionSelectionRequest(learningSource.source, request.lineId, request.selection);
      const presented = projectVerifiedProductionSpanTranslation(
        learningSource.source,
        learningRequest,
        clientResult.results[0],
      );
      assert.equal(presented.state, "translated");
      if (presented.state === "translated") {
        assert.deepEqual(presented.translation, { language: "en", text: "now" });
        assert.equal(presented.authority.executionAuthority, "host_receipted");
        assert.equal(presented.authority.semanticReviewState, "not_reviewed");
        assert.equal(JSON.stringify(presented).includes("design_fixture"), false);
      }

      const otherSpan = productionSelectionRequest(learningSource.source, request.lineId, {
        side: "source",
        unit: "unicode_code_point",
        start: 3,
        end: 5,
        text: "실행",
      });
      const mismatched = projectVerifiedProductionSpanTranslation(
        learningSource.source,
        otherSpan,
        clientResult.results[0],
      );
      assert.equal(mismatched.state, "failed");
      if (mismatched.state === "failed") {
        assert.equal(mismatched.reasonCode, "invalid_translation_binding");
        assert.equal(mismatched.retry, "unavailable");
      }
    }
  } finally {
    await cleanup(runtime);
  }
});

test("the controller cold-reads, creates once, coalesces, and surfaces closed failure states", async () => {
  const runtime = await harness();
  try {
    const { runtimeId, caption, request, response } = await producedResponse(runtime);
    const learningSource = projectVerifiedProductionLearningSource(caption);
    assert.equal(learningSource.state, "ready");
    if (learningSource.state !== "ready") return;
    const learningRequest = productionSelectionRequest(learningSource.source, request.lineId, request.selection);

    let coldReads = 0;
    let creates = 0;
    const servedClient: ProductionSpanTranslationRuntimeClient = {
      async spanTranslations() {
        coldReads += 1;
        return structuredClone(response);
      },
      async createSpanTranslation() {
        creates += 1;
        throw new Error("an existing verified result must never re-create");
      },
    };
    const controller = new ProductionSpanTranslationController(servedClient);
    const input = { runtimeId, source: learningSource.source, request: learningRequest };
    const [first, second] = await Promise.all([controller.request(input), controller.request(input)]);
    assert.equal(first.state, "translated");
    assert.equal(second.state, "translated");
    assert.equal(coldReads, 1);
    assert.equal(creates, 0);

    const empty: RuntimeHostSpanTranslationResponse = {
      ...structuredClone(response),
      attempts: [],
      results: [],
    };
    let createCalls = 0;
    const creatingClient: ProductionSpanTranslationRuntimeClient = {
      async spanTranslations() {
        return structuredClone(empty);
      },
      async createSpanTranslation() {
        createCalls += 1;
        return structuredClone(response);
      },
    };
    const creatingController = new ProductionSpanTranslationController(creatingClient);
    const created = await creatingController.request({ runtimeId, source: learningSource.source, request: learningRequest });
    assert.equal(created.state, "translated");
    assert.equal(createCalls, 1);

    const unconfiguredClient: ProductionSpanTranslationRuntimeClient = {
      async spanTranslations() {
        return structuredClone(empty);
      },
      async createSpanTranslation() {
        throw new RuntimeHostClientError(
          "Span translation is unavailable until a model is explicitly configured",
          "span_translation_unavailable",
          409,
        );
      },
    };
    const unconfigured = await new ProductionSpanTranslationController(unconfiguredClient)
      .request({ runtimeId, source: learningSource.source, request: learningRequest });
    assert.equal(unconfigured.state, "unavailable");
    if (unconfigured.state === "unavailable") {
      assert.equal(unconfigured.reasonCode, "production_translation_executor_unavailable");
      assert.equal(unconfigured.retry, "unavailable");
    }

    const exhaustedResponse: RuntimeHostSpanTranslationResponse = {
      ...structuredClone(empty),
      attempts: [0, 1, 2].map((attempt) => ({
        jobId: `span-translation-job-${attempt}`,
        attempt,
        caption: structuredClone(request.caption),
        lineId: request.lineId,
        selection: structuredClone(request.selection),
        status: "failed" as const,
        failure: "Span translation failed closed",
      })),
    };
    const exhaustedClient: ProductionSpanTranslationRuntimeClient = {
      async spanTranslations() {
        return structuredClone(exhaustedResponse);
      },
      async createSpanTranslation() {
        throw new Error("the exhausted ceiling must not re-create");
      },
    };
    const exhausted = await new ProductionSpanTranslationController(exhaustedClient)
      .request({ runtimeId, source: learningSource.source, request: learningRequest });
    assert.equal(exhausted.state, "failed");
    if (exhausted.state === "failed") {
      assert.equal(exhausted.reasonCode, "translation_retry_exhausted");
      assert.equal(exhausted.retry, "unavailable");
    }

    const staleController = new ProductionSpanTranslationController({
      async spanTranslations() {
        staleController.invalidate();
        return structuredClone(response);
      },
      async createSpanTranslation() {
        throw new Error("a superseded request must not create");
      },
    });
    const stale = await staleController.request({ runtimeId, source: learningSource.source, request: learningRequest });
    assert.equal(stale.state, "failed");
    if (stale.state === "failed") assert.equal(stale.reasonCode, "invalid_translation_binding");

    const revokedSource = structuredClone(learningSource.source);
    revokedSource.context.authorityState = "revoked_after_completion";
    const revoked = await new ProductionSpanTranslationController(servedClient)
      .request({ runtimeId, source: revokedSource, request: learningRequest });
    assert.equal(revoked.state, "failed");
    if (revoked.state === "failed") {
      assert.equal(revoked.reasonCode, "invalid_translation_binding");
      assert.match(revoked.detail, /revoked/);
    }
  } finally {
    await cleanup(runtime);
  }
});
