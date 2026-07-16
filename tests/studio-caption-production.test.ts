import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import {
  DurableRuntimeCommandStore,
  DeterministicRuntimeExecutor,
  RuntimeSourceRegistry,
  RuntimeStartService,
  type CaptionProductionExecutor,
  type DeterministicExecutionMode,
} from "../src/studio/runtime/production/runtimeHost/index.ts";
import type {
  RuntimeHostCaptionProductionRequest,
  RuntimeHostPublishReviewDecisionResponse,
  RuntimeHostStartRequest,
} from "../src/studio/runtime/production/runtimeHost/model.ts";
import { readValidatedRuntimeJournal } from "../src/studio/runtime/production/runtimeHost/journalPolling.ts";
import { validateCaptionProductionArtifact } from "../src/studio/runtime/production/validation/captionProduction.ts";
import { LocalRuntimeHostClient } from "../src/studio/localRuntime/client.ts";
import { adaptProductionRuntime } from "../src/studio/runtime/production/studioProjection.ts";
import { buildRuntimeObservabilityIndex } from "../src/studio/runtime/production/observability/indexer.ts";

const FIXTURE = resolve("public/demo/runs/run-005");

interface Harness {
  directory: string;
  store: DurableRuntimeCommandStore;
  service: RuntimeStartService;
  request: RuntimeHostStartRequest;
}

async function harness(options: {
  captionExecutor?: CaptionProductionExecutor;
  executionMode?: DeterministicExecutionMode;
} = {}): Promise<Harness> {
  const directory = await mkdtemp(join(tmpdir(), "studio-caption-production-test-"));
  const sources = await RuntimeSourceRegistry.open({ sourceDirectories: [FIXTURE] });
  const store = await DurableRuntimeCommandStore.open(join(directory, "host"));
  const service = await RuntimeStartService.open({
    store,
    sources,
    launcherFactory: new DeterministicRuntimeExecutor({ mode: options.executionMode }).factory(),
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
      id: "studio.openai-caption-producer",
      version: "1",
      classification: "real_recognizer_translator",
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
  const deadline = Date.now() + 4_000;
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
  assert.ok(intake);
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

test("V1 and an unapproved run expose no captions; raw bytes, paths, and final prose are rejected", async () => {
  const runtime = await harness();
  try {
    const acknowledgement = await runtime.service.start(runtime.request);
    await terminal(runtime.service, acknowledgement.commandId);
    assert.deepEqual((await runtime.service.captionProductions(acknowledgement.runtimeId)).captions, []);
    assert.deepEqual((await runtime.service.captionProductionResults(acknowledgement.runtimeId)).results, []);
    assert.deepEqual((await runtime.service.captionQualityControls(acknowledgement.runtimeId)).qualityControls, []);
    const fake = {
      approval: {
        reviewId: "publish-review:unapproved",
        artifactId: "artifact:unapproved",
        receiptId: "publish-review-decision-receipt:unapproved",
        receiptContentId: `sha256:${"a".repeat(64)}`,
      },
    };
    await assert.rejects(
      runtime.service.createCaptionProduction(acknowledgement.runtimeId, fake),
      /exact recursively verified unrevoked approval/,
    );
    for (const open of [
      { ...fake, reviewBytes: "already reviewed" },
      { ...fake, sourcePath: "/tmp/media" },
      { ...fake, captions: [{ ko: "caller", en: "final" }] },
    ]) {
      await assert.rejects(
        runtime.service.createCaptionProduction(acknowledgement.runtimeId, open),
        /invalid or contains open fields/,
      );
    }
    const journal = await readValidatedRuntimeJournal(
      runtime.store.paths(acknowledgement.runtimeId).journalPath,
      acknowledgement.runtimeId,
    );
    assert.equal(Object.keys(journal.state.captionProductions).length, 0);
    assert.equal(journal.events.some((event) => event.type.startsWith("caption.production_")), false);
  } finally {
    await rm(runtime.directory, { recursive: true, force: true });
  }
});

test("exact approval produces immutable timed KO+EN artifacts with honest withheld counts", async () => {
  const runtime = await harness();
  try {
    const approval = await approved(runtime);
    const result = await runtime.service.createCaptionProduction(approval.runtimeId, approval.request);
    assert.equal(result.schema, "studio.local-runtime-caption-productions.v1");
    assert.equal(result.captions.length, 1);
    const caption = result.captions[0];
    assert.equal(caption.integrity, "stored_caption_and_receipt_with_verified_approval");
    assert.equal(caption.authorityState, "unrevoked");
    assert.equal(caption.executor.classification, "recorded_real_pipeline_fixture");
    assert.equal(caption.executor.executionScope, "test_demo_only");
    assert.equal(caption.executor.cognitionClaim, "none");
    assert.deepEqual(caption.result, {
      status: "partial",
      lineCount: 16,
      sourceAvailableCount: 15,
      targetAvailableCount: 13,
      withheldCount: 2,
      unavailableCount: 1,
    });
    const productionResults = await runtime.service.captionProductionResults(approval.runtimeId);
    assert.equal(productionResults.schema, "studio.local-runtime-caption-production-results.v1");
    assert.equal(productionResults.results.length, 1);
    assert.deepEqual(productionResults.results[0].verification, caption);
    assert.equal(productionResults.results[0].artifact.runId, approval.runtimeId);
    assert.equal(productionResults.results[0].artifact.lines.length, 16);
    assert.deepEqual(
      productionResults.results[0].artifact.lines.map((line) => [line.source.language, line.target.language]),
      Array.from({ length: 16 }, () => ["ko", "en"]),
    );
    const digest = caption.captionContentId.replace("sha256:", "");
    const value = JSON.parse(await readFile(join(
      runtime.store.paths(approval.runtimeId).artifactStoreRoot,
      "objects",
      "sha256",
      digest.slice(0, 2),
      digest,
    ), "utf8")) as unknown;
    const artifact = validateCaptionProductionArtifact(value);
    assert.deepEqual(artifact.lines.map((line) => [line.source.language, line.target.language]),
      Array.from({ length: 16 }, () => ["ko", "en"]));
    assert.equal(artifact.lines.filter((line) => line.target.state === "withheld").length, 2);
    assert.ok(artifact.lines.filter((line) => line.target.state === "withheld")
      .every((line) => line.target.text === null && line.target.reasonCode === "recorded_quality_gate_withheld"));
    assert.ok(artifact.lines.every((line) =>
      line.lineage.derivation === "recorded_fixture_test_demo_only" &&
      line.lineage.source.artifactId === artifact.input.sourceArtifactId &&
      line.lineage.source.contentId === artifact.input.sourceContentId &&
      line.lineage.source.window.startMs === line.startMs &&
      line.lineage.source.window.endMs === line.endMs &&
      JSON.stringify(line.lineage.acceptedChildOutput) === JSON.stringify(artifact.input.acceptedChildOutput) &&
      JSON.stringify(line.lineage.rootPromotion) === JSON.stringify(artifact.input.rootPromotion)
    ));
    const changedWindow = structuredClone(artifact);
    changedWindow.lines[0].lineage.source.window.startMs += 1;
    assert.throws(() => validateCaptionProductionArtifact(changedWindow), /must equal the exact caption line window/);
    const changedPromotion = structuredClone(artifact);
    changedPromotion.lines[0].lineage.rootPromotion.dispositionId = "root-output-disposition:forged";
    assert.throws(() => validateCaptionProductionArtifact(changedPromotion), /does not match the current run input/);
    const falseLiveFixture = structuredClone(artifact);
    falseLiveFixture.executor.executionScope = "current_run";
    assert.throws(() => validateCaptionProductionArtifact(falseLiveFixture), /executor identity, classification, and evidence must agree/);
    const falseCognition = structuredClone(artifact) as unknown as { executor: { cognitionClaim: string } };
    falseCognition.executor.cognitionClaim = "live_cognition";
    assert.throws(() => validateCaptionProductionArtifact(falseCognition), /cognitionClaim must equal none/);

    const qualityControls = await runtime.service.captionQualityControls(approval.runtimeId);
    assert.equal(qualityControls.schema, "studio.local-runtime-caption-quality-controls.v1");
    assert.equal(qualityControls.qualityControls.length, 1);
    assert.equal(qualityControls.qualityControls[0].outcome, "withheld");
    assert.deepEqual(qualityControls.qualityControls[0].reasonCodes, ["recorded_fixture_test_demo_only"]);
    assert.deepEqual(qualityControls.qualityControls[0].acceptedLineIds, []);
    assert.equal(qualityControls.qualityControls[0].withheldLineIds.length, 16);

    const journal = await readValidatedRuntimeJournal(
      runtime.store.paths(approval.runtimeId).journalPath,
      approval.runtimeId,
    );
    assert.equal(journal.events.filter((event) => event.type === "caption.production_started").length, 1);
    assert.equal(journal.events.filter((event) => event.type === "caption.production_completed").length, 1);
    assert.equal(journal.events.filter((event) => event.type === "caption.quality_control_decided").length, 1);
    assert.equal(Object.values(journal.state.captionProductions)[0].status, "completed");
    assert.equal(Object.values(journal.state.captionQualityControls)[0].outcome, "withheld");
    const projection = adaptProductionRuntime(journal.state);
    assert.equal(projection.captionProductions.length, 1);
    assert.equal(projection.captionProductions[0].lineCount, 16);
    assert.equal(projection.captionProductions[0].withheldCount, 2);
    assert.equal(projection.captionArtifacts.length, 2);
    const observability = await buildRuntimeObservabilityIndex(await readFile(
      runtime.store.paths(approval.runtimeId).journalPath,
      "utf8",
    ));
    assert.equal(observability.sources.receipts.filter((source) =>
      source.kind === "caption_production").length, 1);
    assert.equal(observability.sources.receipts.filter((source) =>
      source.kind === "caption_quality_control").length, 1);
    assert.equal(observability.sources.artifacts.filter((source) =>
      source.kind.startsWith("caption-production-")).length, 2);

    let requestedPath = "";
    let requestedBody = "";
    const client = new LocalRuntimeHostClient({
      baseUrl: "http://127.0.0.1:4312",
      token: "caption-test-token",
      fetch: async (input, init) => {
        requestedPath = String(input);
        requestedBody = String(init?.body ?? "");
        return new Response(JSON.stringify(result), {
          status: 201,
          headers: { "Content-Type": "application/json" },
        });
      },
    });
    assert.deepEqual(await client.createCaptionProduction(approval.runtimeId, approval.request), result);
    assert.match(requestedPath, /\/caption-productions$/);
    assert.deepEqual(JSON.parse(requestedBody), approval.request);
    const resultsClient = new LocalRuntimeHostClient({
      baseUrl: "http://127.0.0.1:4312",
      token: "caption-test-token",
      fetch: async () => new Response(JSON.stringify(productionResults), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    });
    assert.deepEqual(await resultsClient.captionProductionResults(approval.runtimeId), productionResults);
    let qcRequestedPath = "";
    let qcRequestedBody = "";
    const qualityControlsClient = new LocalRuntimeHostClient({
      baseUrl: "http://127.0.0.1:4312",
      token: "caption-test-token",
      fetch: async (input, init) => {
        qcRequestedPath = String(input);
        qcRequestedBody = String(init?.body ?? "");
        return new Response(JSON.stringify(qualityControls), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    });
    assert.deepEqual(await qualityControlsClient.captionQualityControls(approval.runtimeId), qualityControls);
    const qcRequest = {
      candidate: {
        jobId: caption.jobId,
        captionArtifactId: caption.captionArtifactId,
        captionContentId: caption.captionContentId,
        captionReceiptId: caption.receiptId,
        captionReceiptContentId: caption.receiptContentId,
      },
    };
    assert.deepEqual(
      await qualityControlsClient.createCaptionQualityControl(approval.runtimeId, qcRequest),
      qualityControls,
    );
    assert.match(qcRequestedPath, /\/caption-quality-controls$/);
    assert.deepEqual(JSON.parse(qcRequestedBody), qcRequest);
    const falseAccept = structuredClone(qualityControls);
    falseAccept.qualityControls[0].outcome = "accepted";
    const falseAcceptClient = new LocalRuntimeHostClient({
      baseUrl: "http://127.0.0.1:4312",
      token: "caption-test-token",
      fetch: async () => new Response(JSON.stringify(falseAccept), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    });
    await assert.rejects(
      falseAcceptClient.captionQualityControls(approval.runtimeId),
      /outcome, reason, and line decisions do not agree/,
    );
    const mismatchedResults = structuredClone(productionResults);
    mismatchedResults.results[0].artifact.jobId = "caption-production:mismatched";
    const mismatchedClient = new LocalRuntimeHostClient({
      baseUrl: "http://127.0.0.1:4312",
      token: "caption-test-token",
      fetch: async () => new Response(JSON.stringify(mismatchedResults), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    });
    await assert.rejects(
      mismatchedClient.captionProductionResults(approval.runtimeId),
      /verified identities, executor, or result counts do not match the artifact/,
    );
    const tamperedResults = structuredClone(productionResults);
    const originalSourceText = tamperedResults.results[0].artifact.lines[0].source.text;
    assert.notEqual(originalSourceText, null);
    tamperedResults.results[0].artifact.lines[0].source.text = `${originalSourceText} tampered`;
    const tamperedClient = new LocalRuntimeHostClient({
      baseUrl: "http://127.0.0.1:4312",
      token: "caption-test-token",
      fetch: async () => new Response(JSON.stringify(tamperedResults), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    });
    await assert.rejects(
      tamperedClient.captionProductionResults(approval.runtimeId),
      /artifact bytes do not match the verified caption content identity/,
    );
    const tamperedResponse = structuredClone(result) as unknown as {
      captions: Array<{ result: { lineCount: number } }>;
    };
    tamperedResponse.captions[0].result.lineCount = 65;
    const rejectingClient = new LocalRuntimeHostClient({
      baseUrl: "http://127.0.0.1:4312",
      token: "caption-test-token",
      fetch: async () => new Response(JSON.stringify(tamperedResponse), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    });
    await assert.rejects(
      rejectingClient.captionProductions(approval.runtimeId),
      /counts exceed the closed line ceiling/,
    );
  } finally {
    await rm(runtime.directory, { recursive: true, force: true });
  }
});

test("a current-run complete candidate receives an independent accept receipt", async () => {
  const runtime = await harness({ captionExecutor: currentRunCaptionExecutor });
  try {
    const approval = await approved(runtime);
    await runtime.service.createCaptionProduction(approval.runtimeId, approval.request);
    const result = (await runtime.service.captionProductionResults(approval.runtimeId)).results[0];
    assert.equal(result.artifact.executor.executionScope, "current_run");
    assert.equal(result.artifact.executor.cognitionClaim, "none");
    assert.equal(result.artifact.lines.length, 1);
    assert.equal(result.artifact.lines[0].lineage.derivation, "current_run_source_execution");
    assert.deepEqual(result.artifact.lines[0].lineage.source.window, {
      startMs: result.artifact.lines[0].startMs,
      endMs: result.artifact.lines[0].endMs,
    });
    const response = await runtime.service.captionQualityControls(approval.runtimeId);
    assert.equal(response.qualityControls.length, 1);
    assert.equal(response.qualityControls[0].outcome, "accepted");
    assert.deepEqual(response.qualityControls[0].reasonCodes, ["current_run_candidate_structurally_complete"]);
    assert.deepEqual(response.qualityControls[0].acceptedLineIds, ["line-current-run-001"]);
    assert.deepEqual(response.qualityControls[0].withheldLineIds, []);
    assert.equal(response.qualityControls[0].policy, "structural_current_run_gate_without_semantic_quality_score");
  } finally {
    await rm(runtime.directory, { recursive: true, force: true });
  }
});

test("an incomplete current-run candidate receives an independent withhold receipt", async () => {
  const runtime = await harness({ captionExecutor: incompleteCurrentRunCaptionExecutor });
  try {
    const approval = await approved(runtime);
    await runtime.service.createCaptionProduction(approval.runtimeId, approval.request);
    const response = await runtime.service.captionQualityControls(approval.runtimeId);
    assert.equal(response.qualityControls[0].outcome, "withheld");
    assert.deepEqual(response.qualityControls[0].reasonCodes, ["candidate_has_unavailable_or_withheld_lines"]);
    assert.deepEqual(response.qualityControls[0].acceptedLineIds, []);
    assert.deepEqual(response.qualityControls[0].withheldLineIds, ["line-current-run-incomplete-001"]);
  } finally {
    await rm(runtime.directory, { recursive: true, force: true });
  }
});

test("caption QC rejects forged candidates and duplicate decisions", async () => {
  const runtime = await harness({ captionExecutor: currentRunCaptionExecutor });
  try {
    const approval = await approved(runtime);
    const produced = await runtime.service.createCaptionProduction(approval.runtimeId, approval.request);
    const caption = produced.captions[0];
    await assert.rejects(runtime.service.createCaptionQualityControl(approval.runtimeId, {
      candidate: {
        jobId: caption.jobId,
        captionArtifactId: caption.captionArtifactId,
        captionContentId: `sha256:${"f".repeat(64)}`,
        captionReceiptId: caption.receiptId,
        captionReceiptContentId: caption.receiptContentId,
      },
    }), /requires one exact recursively verified caption candidate identity/);
    await assert.rejects(runtime.service.createCaptionQualityControl(approval.runtimeId, {
      candidate: {
        jobId: caption.jobId,
        captionArtifactId: caption.captionArtifactId,
        captionContentId: caption.captionContentId,
        captionReceiptId: caption.receiptId,
        captionReceiptContentId: caption.receiptContentId,
      },
      outcome: "accepted",
    }), /caption QC request is invalid or contains open fields/);
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
    await rm(runtime.directory, { recursive: true, force: true });
  }
});

test("caption production fails closed when the accepted root promotion receipt is tampered", async () => {
  const runtime = await harness({ captionExecutor: currentRunCaptionExecutor });
  try {
    const approval = await approved(runtime);
    const journal = await readValidatedRuntimeJournal(
      runtime.store.paths(approval.runtimeId).journalPath,
      approval.runtimeId,
    );
    const promotion = Object.values(journal.state.rootOutputDispositions)[0];
    assert.ok(promotion);
    const digest = promotion.receiptContentId.replace("sha256:", "");
    await writeFile(join(
      runtime.store.paths(approval.runtimeId).artifactStoreRoot,
      "objects",
      "sha256",
      digest.slice(0, 2),
      digest,
    ), "{}\n", "utf8");
    await assert.rejects(
      runtime.service.createCaptionProduction(approval.runtimeId, approval.request),
      /Stored caption authority or source lineage failed closed verification/,
    );
    await assert.rejects(
      runtime.service.captionProductions(approval.runtimeId),
      /failed closed validation/,
    );
  } finally {
    await rm(runtime.directory, { recursive: true, force: true });
  }
});

test("caption production fails closed when the current run has no promoted child output", async () => {
  const runtime = await harness({
    captionExecutor: currentRunCaptionExecutor,
    executionMode: "failed",
  });
  try {
    const acknowledgement = await runtime.service.start(runtime.request);
    await terminal(runtime.service, acknowledgement.commandId);
    await assert.rejects(runtime.service.createCaptionProduction(acknowledgement.runtimeId, {
      approval: {
        reviewId: "publish-review:missing-promotion",
        artifactId: "artifact:missing-promotion",
        receiptId: "publish-review-decision-receipt:missing-promotion",
        receiptContentId: `sha256:${"a".repeat(64)}`,
      },
    }), /require one exact verified current-run promoted child output/);
    assert.deepEqual((await runtime.service.captionProductions(acknowledgement.runtimeId)).captions, []);
  } finally {
    await rm(runtime.directory, { recursive: true, force: true });
  }
});

test("caption production fails closed when the accepted child artifact is tampered", async () => {
  const runtime = await harness({ captionExecutor: currentRunCaptionExecutor });
  try {
    const approval = await approved(runtime);
    const journal = await readValidatedRuntimeJournal(
      runtime.store.paths(approval.runtimeId).journalPath,
      approval.runtimeId,
    );
    const promotion = Object.values(journal.state.rootOutputDispositions)[0];
    assert.ok(promotion);
    const child = journal.state.artifacts[promotion.inputArtifactId];
    assert.ok(child);
    const digest = child.content.contentId.replace("sha256:", "");
    await writeFile(join(
      runtime.store.paths(approval.runtimeId).artifactStoreRoot,
      "objects",
      "sha256",
      digest.slice(0, 2),
      digest,
    ), "{}\n", "utf8");
    await assert.rejects(
      runtime.service.createCaptionProduction(approval.runtimeId, approval.request),
      /Stored caption authority or source lineage failed closed verification/,
    );
  } finally {
    await rm(runtime.directory, { recursive: true, force: true });
  }
});

test("caption QC read fails closed when its receipt bytes are tampered", async () => {
  const runtime = await harness({ captionExecutor: currentRunCaptionExecutor });
  try {
    const approval = await approved(runtime);
    await runtime.service.createCaptionProduction(approval.runtimeId, approval.request);
    const qc = (await runtime.service.captionQualityControls(approval.runtimeId)).qualityControls[0];
    const digest = qc.receiptContentId.replace("sha256:", "");
    await writeFile(join(
      runtime.store.paths(approval.runtimeId).artifactStoreRoot,
      "objects",
      "sha256",
      digest.slice(0, 2),
      digest,
    ), "{}\n", "utf8");
    await assert.rejects(
      runtime.service.captionQualityControls(approval.runtimeId),
      /failed closed validation/,
    );
  } finally {
    await rm(runtime.directory, { recursive: true, force: true });
  }
});

test("revocation blocks new starts and later revocation supersedes authority without deleting prior artifacts", async () => {
  const blocked = await harness();
  try {
    const approval = await approved(blocked);
    await blocked.service.createPublishReviewRevocation(approval.runtimeId, {
      approval: approval.request.approval,
      reviewer: {
        id: approval.response.reviewer.id,
        attestation: approval.response.reviewer.revocationAttestation,
      },
      revocation: { reasonCodes: ["new_review_required"], note: null },
    });
    await assert.rejects(
      blocked.service.createCaptionProduction(approval.runtimeId, approval.request),
      /exact recursively verified unrevoked approval/,
    );
    assert.deepEqual((await blocked.service.captionProductions(approval.runtimeId)).captions, []);
    assert.deepEqual((await blocked.service.captionProductionResults(approval.runtimeId)).results, []);
  } finally {
    await rm(blocked.directory, { recursive: true, force: true });
  }

  const completed = await harness();
  try {
    const approval = await approved(completed);
    const produced = await completed.service.createCaptionProduction(approval.runtimeId, approval.request);
    const identities = produced.captions[0];
    await completed.service.createPublishReviewRevocation(approval.runtimeId, {
      approval: approval.request.approval,
      reviewer: {
        id: approval.response.reviewer.id,
        attestation: approval.response.reviewer.revocationAttestation,
      },
      revocation: { reasonCodes: ["new_review_required"], note: null },
    });
    const retained = (await completed.service.captionProductions(approval.runtimeId)).captions[0];
    const retainedResult = (await completed.service.captionProductionResults(approval.runtimeId)).results[0];
    assert.equal(retained.authorityState, "revoked_after_completion");
    assert.equal(retainedResult.verification.authorityState, "revoked_after_completion");
    assert.equal(retained.captionArtifactId, identities.captionArtifactId);
    assert.equal(retained.receiptArtifactId, identities.receiptArtifactId);
  } finally {
    await rm(completed.directory, { recursive: true, force: true });
  }
});

test("caption read fails closed when content-addressed timed output is tampered", async () => {
  const runtime = await harness();
  try {
    const approval = await approved(runtime);
    const produced = await runtime.service.createCaptionProduction(approval.runtimeId, approval.request);
    const digest = produced.captions[0].captionContentId.replace("sha256:", "");
    await writeFile(join(
      runtime.store.paths(approval.runtimeId).artifactStoreRoot,
      "objects",
      "sha256",
      digest.slice(0, 2),
      digest,
    ), "{}\n", "utf8");
    await assert.rejects(
      runtime.service.captionProductions(approval.runtimeId),
      /failed closed validation/,
    );
    await assert.rejects(
      runtime.service.captionProductionResults(approval.runtimeId),
      /failed closed validation/,
    );
    await assert.rejects(
      runtime.service.captionQualityControls(approval.runtimeId),
      /failed closed validation/,
    );
  } finally {
    await rm(runtime.directory, { recursive: true, force: true });
  }
});
